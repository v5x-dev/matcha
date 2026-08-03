import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { Event, type EventData, type MatchData } from 'events.vex';
import { toEventListItem, type EventListItem } from '$lib/event-types';
import { db } from './db';
import { cacheSync, event, match } from './db/schema';
import vex from './vex';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** v5rc 2025-2026 (push back). */
export const SEASON = 197;

const EVENT_LIST_TTL = 6 * HOUR;
const EVENT_TTL = HOUR;

const eventListKey = `events:season:${SEASON}:tournament`;
const matchesKey = (eventId: number) => `matches:event:${eventId}`;

const eventMemoryCache = new Map<number, { data: EventData; cachedAt: number }>();
const eventListMemoryCache: { data: EventListItem[]; syncedAt: number } = {
	data: [],
	syncedAt: 0
};
const matchMemoryCache = new Map<number, { data: MatchData[]; syncedAt: number }>();
const pendingEventRequests = new Map<number, Promise<EventData | null>>();
const pendingMatchRequests = new Map<number, Promise<MatchData[] | null>>();
let pendingEventListRequest: Promise<EventListItem[]> | null = null;

type Executor = typeof db | Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/**
 * matches move fast while an event is running and never again once it is over, so the ttl follows
 * the event rather than being a single global number.
 */
function matchesTtl(data: EventData): number {
	const now = Date.now();
	const start = data.start ? Date.parse(data.start) : NaN;
	const end = data.end ? Date.parse(data.end) : start;

	if (data.ongoing) return 30 * SECOND;
	// event dates are day-granular, so pad the window before calling it live
	if (Number.isFinite(start) && now >= start - DAY && now <= end + DAY) return MINUTE;
	if (Number.isFinite(end) && now > end + DAY) return 30 * DAY;
	return HOUR;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
	for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

async function syncedAt(key: string): Promise<Date | null> {
	const [row] = await db
		.select({ syncedAt: cacheSync.syncedAt })
		.from(cacheSync)
		.where(eq(cacheSync.key, key));

	return row?.syncedAt ?? null;
}

async function isFresh(key: string, ttl: number): Promise<boolean> {
	const at = await syncedAt(key);
	return at !== null && Date.now() - at.getTime() < ttl;
}

async function markSynced(key: string, tx: Executor = db) {
	const syncedAt = new Date();

	await tx
		.insert(cacheSync)
		.values({ key, syncedAt })
		.onConflictDoUpdate({ target: cacheSync.key, set: { syncedAt } });
}

function eventRow(data: EventData, cachedAt: Date, listedAt: Date | null = null) {
	return {
		id: data.id,
		sku: data.sku,
		name: data.name,
		start: data.start ?? null,
		end: data.end ?? null,
		seasonId: data.season.id,
		programId: data.program.id,
		level: data.level ?? null,
		eventType: data.event_type ?? null,
		ongoing: data.ongoing ?? false,
		data,
		cachedAt,
		listedAt
	};
}

function matchRow(data: MatchData, cachedAt: Date) {
	return {
		id: data.id,
		eventId: data.event.id,
		divisionId: data.division.id,
		round: data.round,
		instance: data.instance,
		matchnum: data.matchnum,
		name: data.name,
		field: data.field ?? null,
		scheduled: data.scheduled ?? null,
		started: data.started ?? null,
		scored: data.scored,
		data,
		cachedAt
	};
}

async function upsertEvents(rows: ReturnType<typeof eventRow>[], tx: Executor = db) {
	for (const chunk of chunks(rows, 100)) {
		await tx
			.insert(event)
			.values(chunk)
			.onConflictDoUpdate({
				target: event.id,
				set: {
					sku: sql`excluded.sku`,
					name: sql`excluded.name`,
					start: sql`excluded.start`,
					end: sql`excluded.end`,
					seasonId: sql`excluded.season_id`,
					programId: sql`excluded.program_id`,
					level: sql`excluded.level`,
					// the listing search omits event_type, so never overwrite a known value with null
					eventType: sql`coalesce(excluded.event_type, ${event.eventType})`,
					ongoing: sql`excluded.ongoing`,
					data: sql`excluded.data`,
					cachedAt: sql`excluded.cached_at`,
					listedAt: sql`coalesce(excluded.listed_at, ${event.listedAt})`
				}
			});
	}
}

function readCachedEvents(): Promise<EventListItem[]> {
	return db
		.select({
			id: event.id,
			sku: event.sku,
			name: event.name,
			start: event.start,
			end: event.end,
			level: event.level,
			ongoing: event.ongoing,
			venue: sql<string | null>`json_extract(${event.data}, '$.location.venue')`,
			city: sql<string | null>`json_extract(${event.data}, '$.location.city')`,
			region: sql<string | null>`json_extract(${event.data}, '$.location.region')`
		})
		.from(event)
		.where(and(eq(event.seasonId, SEASON), isNotNull(event.listedAt)))
		.orderBy(event.start, event.id)
		.then((rows) =>
			rows.map((row) => ({
				id: row.id,
				sku: row.sku,
				name: row.name,
				start: row.start ?? undefined,
				end: row.end ?? undefined,
				level: row.level ?? undefined,
				ongoing: row.ongoing,
				location: {
					venue: row.venue ?? undefined,
					city: row.city ?? undefined,
					region: row.region ?? undefined
				}
			}))
		);
}

function readCachedMatches(eventId: number): Promise<MatchData[]> {
	return db
		.select({ data: match.data })
		.from(match)
		.where(eq(match.eventId, eventId))
		.orderBy(match.round, match.instance, match.matchnum)
		.then((rows) => rows.map((row) => row.data));
}

/**
 * drops events that vanished from the season listing out of the listing. the rows stick around so a
 * direct link to one still resolves from cache.
 */
async function unlistEvents(before: Date, tx: Executor) {
	await tx
		.update(event)
		.set({ listedAt: null })
		.where(and(eq(event.seasonId, SEASON), lt(event.listedAt, before)));
}

/**
 * every v5rc tournament this season, read through the sqlite cache. a failed upstream call falls
 * back to whatever we already have rather than blowing up the page.
 */
export async function listEvents(): Promise<EventListItem[]> {
	if (
		eventListMemoryCache.syncedAt &&
		Date.now() - eventListMemoryCache.syncedAt < EVENT_LIST_TTL
	) {
		return eventListMemoryCache.data;
	}

	if (await isFresh(eventListKey, EVENT_LIST_TTL)) {
		const cached = await readCachedEvents();
		eventListMemoryCache.data = cached;
		eventListMemoryCache.syncedAt = Date.now();
		return cached;
	}

	if (pendingEventListRequest) return pendingEventListRequest;

	const request = (async () => {
		try {
			const { data, error, response } = await vex.events.search({
				'season[]': [SEASON],
				'eventTypes[]': ['tournament']
			});

			// never let an upstream failure be written down as "the season has no events"
			if (!data)
				throw new Error(`event search failed (${response.status}): ${JSON.stringify(error)}`);

			const events = data.map((item) => item.getData());
			const cachedAt = new Date();

			await db.transaction(async (tx) => {
				await upsertEvents(
					events.map((data) => eventRow(data, cachedAt, cachedAt)),
					tx
				);
				await unlistEvents(cachedAt, tx);
				await markSynced(eventListKey, tx);
			});
			eventMemoryCache.clear();

			const summaries = events.map(toEventListItem);
			eventListMemoryCache.data = summaries;
			eventListMemoryCache.syncedAt = Date.now();
			return summaries;
		} catch (err) {
			const stale =
				eventListMemoryCache.data.length > 0 ? eventListMemoryCache.data : await readCachedEvents();
			if (stale.length > 0) return stale;
			throw err;
		}
	})();

	pendingEventListRequest = request;
	try {
		return await request;
	} finally {
		if (pendingEventListRequest === request) pendingEventListRequest = null;
	}
}

/** a single event, read through the cache. `null` when the event does not exist upstream. */
async function getEventUncoalesced(id: number): Promise<EventData | null> {
	const memory = eventMemoryCache.get(id);
	if (memory && Date.now() - memory.cachedAt < EVENT_TTL) return memory.data;

	const [row] = await db
		.select({ data: event.data, cachedAt: event.cachedAt })
		.from(event)
		.where(eq(event.id, id));

	if (row && Date.now() - row.cachedAt.getTime() < EVENT_TTL) {
		eventMemoryCache.set(id, { data: row.data, cachedAt: row.cachedAt.getTime() });
		return row.data;
	}

	try {
		const { data, error, response } = await vex.events.get(id);

		if (!data) {
			if (response.status === 404) return null;
			throw new Error(`event ${id} fetch failed (${response.status}): ${JSON.stringify(error)}`);
		}

		const fresh = data.getData();
		await upsertEvents([eventRow(fresh, new Date())]);
		eventMemoryCache.set(id, { data: fresh, cachedAt: Date.now() });

		return fresh;
	} catch (err) {
		if (memory) return memory.data;
		if (row) {
			eventMemoryCache.set(id, { data: row.data, cachedAt: row.cachedAt.getTime() });
			return row.data;
		}
		throw err;
	}
}

export async function getEvent(id: number): Promise<EventData | null> {
	const pending = pendingEventRequests.get(id);
	if (pending) return pending;

	const request = getEventUncoalesced(id);
	pendingEventRequests.set(id, request);
	try {
		return await request;
	} finally {
		if (pendingEventRequests.get(id) === request) pendingEventRequests.delete(id);
	}
}

/**
 * every match across every division of an event, read through the cache. `null` when the event does
 * not exist upstream.
 */
async function listMatchesUncoalesced(eventId: number): Promise<MatchData[] | null> {
	const eventData = await getEvent(eventId);
	if (!eventData) return null;

	const key = matchesKey(eventId);
	const ttl = matchesTtl(eventData);
	const memory = matchMemoryCache.get(eventId);
	if (memory && Date.now() - memory.syncedAt < ttl) return memory.data;
	if (await isFresh(key, ttl)) {
		const cached = await readCachedMatches(eventId);
		matchMemoryCache.set(eventId, { data: cached, syncedAt: Date.now() });
		return cached;
	}

	try {
		const wrapper = new Event(eventData, vex.api);

		const results = await Promise.all(
			(eventData.divisions ?? []).map(async (division) => {
				const { data, error, response } = await wrapper.matches(division.id!);

				// same as above: a failed division must not be cached as an empty schedule
				if (!data) {
					throw new Error(
						`matches for event ${eventId} division ${division.id} failed (${response.status}): ${JSON.stringify(error)}`
					);
				}

				return data.map((item) => item.getData());
			})
		);

		const matches = results.flat();
		const cachedAt = new Date();

		await db.transaction(async (tx) => {
			// divisions and matches can disappear from the schedule, so replace rather than merge
			await tx.delete(match).where(eq(match.eventId, eventId));

			for (const chunk of chunks(matches, 100)) {
				await tx.insert(match).values(chunk.map((data) => matchRow(data, cachedAt)));
			}

			await markSynced(key, tx);
		});

		matchMemoryCache.set(eventId, { data: matches, syncedAt: Date.now() });
		return matches;
	} catch (err) {
		// an empty match list is a legitimate cached answer, so trust the sync marker, not the rows
		if ((await syncedAt(key)) !== null) return readCachedMatches(eventId);
		throw err;
	}
}

export async function listMatches(eventId: number): Promise<MatchData[] | null> {
	const pending = pendingMatchRequests.get(eventId);
	if (pending) return pending;

	const request = listMatchesUncoalesced(eventId);
	pendingMatchRequests.set(eventId, request);
	try {
		return await request;
	} finally {
		if (pendingMatchRequests.get(eventId) === request) pendingMatchRequests.delete(eventId);
	}
}
