import { and, count, eq, gt, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { Event, type EventData, type MatchData } from 'events.vex';
import type {
	EventFacet,
	EventListItem,
	EventSearchInput,
	EventSearchResult
} from '$lib/event-types';
import { toEventListItem } from '$lib/event-types';
import { db } from './db';
import { cacheSync, event, match } from './db/schema';
import { measureExternalRequest, measureServer } from './instrumentation';
import vex from './vex';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** v5rc 2025-2026 (push back). */
export const SEASON = 197;

const EVENT_LIST_TTL = 6 * HOUR;
const EVENT_TTL = HOUR;
const INITIAL_EVENT_PAGE_SIZE = 50;
const MAX_EVENT_PAGE_SIZE = 100;
const MAX_EVENT_MEMORY_ENTRIES = 128;
const MAX_MATCH_MEMORY_ENTRIES = 32;

// v2 forces one refresh after the denormalized searchable location columns are introduced.
const eventListKey = `events:season:${SEASON}:tournament:v2`;
const matchesKey = (eventId: number) => `matches:event:${eventId}`;

const eventMemoryCache = new Map<number, { data: EventData; cachedAt: number }>();
const eventListMemoryCache: { syncedAt: number } = { syncedAt: 0 };
const matchMemoryCache = new Map<number, { data: MatchData[]; syncedAt: number }>();
const pendingEventRequests = new Map<number, Promise<EventData | null>>();
const pendingMatchRequests = new Map<number, Promise<MatchData[] | null>>();
let pendingEventListRequest: Promise<void> | null = null;
let fallbackEventList: { events: EventData[]; fetchedAt: number } | null = null;
let eventDatabaseUnavailableUntil = 0;

function boundedGet<K, V>(cache: Map<K, V>, key: K): V | undefined {
	const value = cache.get(key);
	if (value !== undefined) {
		cache.delete(key);
		cache.set(key, value);
	}
	return value;
}

function boundedSet<K, V>(cache: Map<K, V>, key: K, value: V, maxEntries: number) {
	cache.delete(key);
	cache.set(key, value);
	while (cache.size > maxEntries) cache.delete(cache.keys().next().value as K);
}

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
	const location = data.location ?? {};
	const locationParts = [location.venue, location.city, location.region]
		.filter((value): value is string => Boolean(value))
		.join(' ');
	const searchText = [data.name, data.sku, locationParts]
		.filter((value): value is string => Boolean(value))
		.join(' ')
		.toLowerCase();

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
		locationVenue: location.venue ?? '',
		locationCity: location.city ?? '',
		locationRegion: location.region ?? '',
		searchText,
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
					locationVenue: sql`excluded.location_venue`,
					locationCity: sql`excluded.location_city`,
					locationRegion: sql`excluded.location_region`,
					searchText: sql`excluded.search_text`,
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

const eventProjection = {
	id: event.id,
	sku: event.sku,
	name: event.name,
	start: event.start,
	end: event.end,
	level: event.level,
	ongoing: event.ongoing,
	venue: event.locationVenue,
	city: event.locationCity,
	region: event.locationRegion
};

type EventProjectionRow = {
	id: number;
	sku: string;
	name: string;
	start: string | null;
	end: string | null;
	level: EventListItem['level'] | null;
	ongoing: boolean;
	venue: string;
	city: string;
	region: string;
};

function toListItem(row: EventProjectionRow): EventListItem {
	return {
		id: row.id,
		sku: row.sku,
		name: row.name,
		start: row.start ?? undefined,
		end: row.end ?? undefined,
		level: row.level ?? undefined,
		ongoing: row.ongoing,
		location: {
			venue: row.venue || undefined,
			city: row.city || undefined,
			region: row.region || undefined
		}
	};
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

const NULL_EVENT_SORT = '9999-12-31T23:59:59.999Z';

type EventCursor = { start: string; id: number };

function encodeCursor(cursor: EventCursor): string {
	return encodeURIComponent(JSON.stringify(cursor));
}

function decodeCursor(cursor: string | null | undefined): EventCursor | null {
	if (!cursor) return null;
	try {
		const value = JSON.parse(decodeURIComponent(cursor)) as Partial<EventCursor>;
		return typeof value.start === 'string' &&
			typeof value.id === 'number' &&
			Number.isInteger(value.id)
			? { start: value.start, id: value.id }
			: null;
	} catch {
		return null;
	}
}

function eventSortStart() {
	return sql<string>`coalesce(${event.start}, ${NULL_EVENT_SORT})`;
}

function searchTerms(value: string): string[] {
	return value
		.toLowerCase()
		.trim()
		.split(/\s+/)
		.map((term) => term.replace(/[%_]/g, ''))
		.filter((term) => term.length > 0)
		.slice(0, 8);
}

async function searchEventsWithoutDatabase(input: EventSearchInput): Promise<EventSearchResult> {
	if (!fallbackEventList || Date.now() - fallbackEventList.fetchedAt >= EVENT_LIST_TTL) {
		const { data, error, response } = await measureExternalRequest(
			'vex.events.search',
			() =>
				vex.events.search({
					'season[]': [SEASON],
					'eventTypes[]': ['tournament']
				}),
			{ season: SEASON, eventType: 'tournament', databaseFallback: true }
		);
		if (!data)
			throw new Error(`event search failed (${response.status}): ${JSON.stringify(error)}`);
		fallbackEventList = { events: data.map((item) => item.getData()), fetchedAt: Date.now() };
	}

	const terms = searchTerms(input.query);
	const now = Date.now();
	const matches = (item: EventData, without?: 'levels' | 'regions') => {
		const haystack = [
			item.name,
			item.sku,
			item.location.venue,
			item.location.city,
			item.location.region
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		if (terms.some((term) => !haystack.includes(term))) return false;
		if (
			without !== 'levels' &&
			input.levels.length &&
			(!item.level || !input.levels.includes(item.level))
		)
			return false;
		if (
			without !== 'regions' &&
			input.regions.length &&
			!input.regions.includes(item.location.region ?? '')
		)
			return false;
		const start = item.start ? Date.parse(item.start) : NaN;
		const end = item.end ? Date.parse(item.end) : start;
		if (input.timeframe === 'upcoming' && !(start > now)) return false;
		if (input.timeframe === 'ongoing' && !(start <= now && end >= now)) return false;
		if (input.timeframe === 'past' && !(end < now)) return false;
		return true;
	};
	const facet = (values: Array<string | undefined>) =>
		[
			...values.reduce((counts, value) => {
				if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
				return counts;
			}, new Map<string, number>())
		]
			.map(([value, count]) => ({ value, count }))
			.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
	const filtered = fallbackEventList.events
		.filter((item) => matches(item))
		.sort(
			(a, b) =>
				(a.start ?? NULL_EVENT_SORT).localeCompare(b.start ?? NULL_EVENT_SORT) || a.id - b.id
		);
	const cursor = decodeCursor(input.cursor);
	const afterCursor = cursor
		? filtered.filter((item) => {
				const start = item.start ?? NULL_EVENT_SORT;
				return start > cursor.start || (start === cursor.start && item.id > cursor.id);
			})
		: filtered;
	const limit = Math.max(1, Math.min(input.limit ?? INITIAL_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE));
	const page = afterCursor.slice(0, limit);
	const last = page.at(-1);

	return {
		events: page.map(toEventListItem),
		total: filtered.length,
		nextCursor:
			afterCursor.length > limit && last
				? encodeCursor({ start: last.start ?? NULL_EVENT_SORT, id: last.id })
				: null,
		facets: {
			levels: facet(
				fallbackEventList.events.filter((item) => matches(item, 'levels')).map((item) => item.level)
			),
			regions: facet(
				fallbackEventList.events
					.filter((item) => matches(item, 'regions'))
					.map((item) => item.location.region)
			)
		}
	};
}

function eventWhere(input: EventSearchInput, without?: 'levels' | 'regions') {
	const conditions = [eq(event.seasonId, SEASON), isNotNull(event.listedAt)];

	const terms = searchTerms(input.query);
	if (terms.length > 0) {
		conditions.push(...terms.map((term) => sql`lower(${event.searchText}) like ${`%${term}%`}`));
	}
	if (without !== 'levels' && input.levels.length > 0)
		conditions.push(inArray(event.level, input.levels));
	if (without !== 'regions' && input.regions.length > 0)
		conditions.push(inArray(event.locationRegion, input.regions));

	const now = new Date().toISOString();
	if (input.timeframe === 'upcoming') conditions.push(gt(event.start, now));
	if (input.timeframe === 'ongoing') {
		conditions.push(lte(event.start, now), gte(event.end, now));
	}
	if (input.timeframe === 'past') conditions.push(lt(event.end, now));

	return and(...conditions);
}

function cursorWhere(cursor: EventCursor | null) {
	if (!cursor) return undefined;
	const sortStart = eventSortStart();
	return or(gt(sortStart, cursor.start), and(eq(sortStart, cursor.start), gt(event.id, cursor.id)));
}

async function hasCachedEventListing() {
	const [row] = await db
		.select({ count: count() })
		.from(event)
		.where(and(eq(event.seasonId, SEASON), isNotNull(event.listedAt)));
	return Number(row?.count ?? 0) > 0;
}

/** refresh the season index without putting the entire collection in the SSR payload. */
async function ensureEventListing(): Promise<void> {
	if (
		eventListMemoryCache.syncedAt &&
		Date.now() - eventListMemoryCache.syncedAt < EVENT_LIST_TTL
	) {
		return;
	}

	if (await isFresh(eventListKey, EVENT_LIST_TTL)) {
		eventListMemoryCache.syncedAt = Date.now();
		return;
	}

	if (pendingEventListRequest) return pendingEventListRequest;

	const request = (async () => {
		try {
			const { data, error, response } = await measureExternalRequest(
				'vex.events.search',
				() =>
					vex.events.search({
						'season[]': [SEASON],
						'eventTypes[]': ['tournament']
					}),
				{ season: SEASON, eventType: 'tournament' }
			);

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
			eventListMemoryCache.syncedAt = Date.now();
		} catch (error) {
			// stale rows are still useful when the upstream index is unavailable; an empty database is
			// the only case where the failure should reach the page.
			if (!(await hasCachedEventListing())) throw error;
			eventListMemoryCache.syncedAt = Date.now();
		}
	})();

	pendingEventListRequest = request;
	try {
		return await request;
	} finally {
		if (pendingEventListRequest === request) pendingEventListRequest = null;
	}
}

/** cursor-paginated, server-filtered event search used by both SSR and the remote query. */
export async function searchEvents(input: EventSearchInput): Promise<EventSearchResult> {
	return measureServer(
		'event.search',
		async () => {
			if (Date.now() < eventDatabaseUnavailableUntil) return searchEventsWithoutDatabase(input);
			try {
				await ensureEventListing();
			} catch (error) {
				eventDatabaseUnavailableUntil = Date.now() + MINUTE;
				console.error('event database unavailable; using the upstream event index', error);
				return searchEventsWithoutDatabase(input);
			}
			const limit = Math.max(
				1,
				Math.min(input.limit ?? INITIAL_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SIZE)
			);
			const baseWhere = eventWhere(input);
			const levelFacetWhere = eventWhere(input, 'levels');
			const regionFacetWhere = eventWhere(input, 'regions');
			const cursor = decodeCursor(input.cursor);
			const where = and(baseWhere, cursorWhere(cursor));

			const [rows, totalRows, levelRows, regionRows] = await Promise.all([
				db
					.select(eventProjection)
					.from(event)
					.where(where)
					.orderBy(eventSortStart(), event.id)
					.limit(limit + 1),
				db.select({ count: count() }).from(event).where(baseWhere),
				db
					.select({ value: event.level, count: count() })
					.from(event)
					.where(levelFacetWhere)
					.groupBy(event.level),
				db
					.select({ value: event.locationRegion, count: count() })
					.from(event)
					.where(regionFacetWhere)
					.groupBy(event.locationRegion)
			]);

			const hasMore = rows.length > limit;
			const pageRows = rows.slice(0, limit);
			const last = pageRows.at(-1);
			return {
				events: pageRows.map((row) => toListItem(row as EventProjectionRow)),
				total: Number(totalRows[0]?.count ?? 0),
				nextCursor:
					hasMore && last
						? encodeCursor({ start: last.start ?? NULL_EVENT_SORT, id: last.id })
						: null,
				facets: {
					levels: levelRows
						.filter(
							(row): row is { value: NonNullable<typeof row.value>; count: number } =>
								row.value !== null
						)
						.map((row): EventFacet => ({ value: row.value, count: Number(row.count) }))
						.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
					regions: regionRows
						.filter((row): row is { value: string; count: number } => Boolean(row.value))
						.map((row): EventFacet => ({ value: row.value, count: Number(row.count) }))
						.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
				}
			};
		},
		{ season: SEASON }
	);
}

/** retained for non-paginated callers; the event route uses searchEvents directly. */
export async function listEvents(): Promise<EventListItem[]> {
	return (
		await searchEvents({
			query: '',
			levels: [],
			regions: [],
			timeframe: 'any',
			limit: MAX_EVENT_PAGE_SIZE
		})
	).events;
}

/** a single event, read through the cache. `null` when the event does not exist upstream. */
async function getEventUncoalesced(id: number): Promise<EventData | null> {
	const memory = boundedGet(eventMemoryCache, id);
	if (memory && Date.now() - memory.cachedAt < EVENT_TTL) return memory.data;

	let row: { data: EventData; cachedAt: Date } | undefined;
	try {
		[row] = await db
			.select({ data: event.data, cachedAt: event.cachedAt })
			.from(event)
			.where(eq(event.id, id));
	} catch (error) {
		console.error(`event ${id} database read unavailable; using the upstream event`, error);
	}

	if (row && Date.now() - row.cachedAt.getTime() < EVENT_TTL) {
		boundedSet(
			eventMemoryCache,
			id,
			{ data: row.data, cachedAt: row.cachedAt.getTime() },
			MAX_EVENT_MEMORY_ENTRIES
		);
		return row.data;
	}

	try {
		const { data, error, response } = await measureExternalRequest(
			'vex.events.get',
			() => vex.events.get(id),
			{ eventId: id }
		);

		if (!data) {
			if (response.status === 404) return null;
			throw new Error(`event ${id} fetch failed (${response.status}): ${JSON.stringify(error)}`);
		}

		const fresh = data.getData();
		try {
			await upsertEvents([eventRow(fresh, new Date())]);
		} catch (error) {
			console.error(`event ${id} database write unavailable; keeping the event in memory`, error);
		}
		boundedSet(
			eventMemoryCache,
			id,
			{ data: fresh, cachedAt: Date.now() },
			MAX_EVENT_MEMORY_ENTRIES
		);

		return fresh;
	} catch (err) {
		if (memory) return memory.data;
		if (row) {
			boundedSet(
				eventMemoryCache,
				id,
				{ data: row.data, cachedAt: row.cachedAt.getTime() },
				MAX_EVENT_MEMORY_ENTRIES
			);
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
	const memory = boundedGet(matchMemoryCache, eventId);
	if (memory && Date.now() - memory.syncedAt < ttl) return memory.data;
	let databaseAvailable = true;
	try {
		if (await isFresh(key, ttl)) {
			const cached = await readCachedMatches(eventId);
			boundedSet(
				matchMemoryCache,
				eventId,
				{ data: cached, syncedAt: Date.now() },
				MAX_MATCH_MEMORY_ENTRIES
			);
			return cached;
		}
	} catch (error) {
		databaseAvailable = false;
		console.error(`event ${eventId} match cache unavailable; using the upstream schedule`, error);
	}

	try {
		const wrapper = new Event(eventData, vex.api);

		const results = await Promise.all(
			(eventData.divisions ?? []).map(async (division) => {
				const { data, error, response } = await measureExternalRequest(
					'vex.matches.list',
					() => wrapper.matches(division.id!),
					{ eventId, divisionId: division.id! }
				);

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

		try {
			await db.transaction(async (tx) => {
				// divisions and matches can disappear from the schedule, so replace rather than merge
				await tx.delete(match).where(eq(match.eventId, eventId));

				for (const chunk of chunks(matches, 100)) {
					await tx.insert(match).values(chunk.map((data) => matchRow(data, cachedAt)));
				}

				await markSynced(key, tx);
			});
		} catch (error) {
			console.error(
				`event ${eventId} match cache write unavailable; keeping matches in memory`,
				error
			);
		}

		boundedSet(
			matchMemoryCache,
			eventId,
			{ data: matches, syncedAt: Date.now() },
			MAX_MATCH_MEMORY_ENTRIES
		);
		return matches;
	} catch (err) {
		// an empty match list is a legitimate cached answer, so trust the sync marker, not the rows
		if (databaseAvailable && (await syncedAt(key)) !== null) return readCachedMatches(eventId);
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
