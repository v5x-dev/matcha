import { httpError } from '$lib/server/http-error';
import { and, desc, eq, isNull } from 'drizzle-orm';
import * as cache from '$lib/server/event-cache';
import { db } from '$lib/server/db';
import {
	event as eventTable,
	match as matchTable,
	eventPlaybackOffset,
	matchClip,
	matchPlaybackStart,
	matchPlaybackWindow,
	user
} from '$lib/server/db/schema';
import { measureServer } from '$lib/server/instrumentation';
import { CLIP_LIMIT } from '$lib/clips';

async function optionalDatabaseRows<T>(query: Promise<T>, name: string): Promise<T | []> {
	try {
		return await query;
	} catch (error) {
		console.error(`${name} unavailable; continuing without saved event data`, error);
		return [];
	}
}

async function loadEventPage(eventId: number) {
	const event = await measureServer('event.load', () => cache.getEvent(eventId), { eventId });
	if (!event) httpError(404, 'event not found');

	const [matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets, clips] =
		await Promise.all([
			measureServer('match.load', () => cache.listMatches(eventId), { eventId }),
			optionalDatabaseRows(
				db
					.select({
						matchId: matchPlaybackWindow.matchId,
						videoId: matchPlaybackWindow.videoId,
						startSeconds: matchPlaybackWindow.startSeconds,
						endSeconds: matchPlaybackWindow.endSeconds
					})
					.from(matchPlaybackWindow)
					.where(eq(matchPlaybackWindow.eventId, eventId)),
				'match playback windows'
			),
			optionalDatabaseRows(
				db
					.select({
						matchId: matchPlaybackStart.matchId,
						videoId: matchPlaybackStart.videoId,
						startSeconds: matchPlaybackStart.startSeconds
					})
					.from(matchPlaybackStart)
					.where(eq(matchPlaybackStart.eventId, eventId)),
				'match playback starts'
			),
			optionalDatabaseRows(
				db
					.select({
						videoId: eventPlaybackOffset.videoId,
						offsetSeconds: eventPlaybackOffset.offsetSeconds
					})
					.from(eventPlaybackOffset)
					.where(eq(eventPlaybackOffset.eventId, eventId)),
				'event playback offsets'
			),
			optionalDatabaseRows(
				db
					.select({
						id: matchClip.id,
						matchId: matchClip.matchId,
						videoId: matchClip.videoId,
						title: matchClip.title,
						startSeconds: matchClip.startSeconds,
						endSeconds: matchClip.endSeconds,
						authorId: matchClip.userId,
						authorName: user.name,
						createdAt: matchClip.createdAt
					})
					.from(matchClip)
					.innerJoin(user, eq(user.id, matchClip.userId))
					.where(and(eq(matchClip.eventId, eventId), isNull(matchClip.deletedAt)))
					.orderBy(desc(matchClip.createdAt))
					.limit(CLIP_LIMIT)
					.then((rows) => rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() }))),
				'match clips'
			)
		]);

	if (!matches) httpError(404, 'event not found');

	return { event, matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets, clips };
}

export async function load({ params, url }) {
	const eventId = Number(params.eventId);

	if (!Number.isInteger(eventId) || eventId <= 0) httpError(404, 'event not found');

	const clipId = url.searchParams.get('clip');
	// The clip landing page has to render useful Open Graph tags before any client-side JS runs —
	// Discord and friends never execute our remote functions. This lookup is small and only happens
	// when the link carries a clip id, so it is fine to wait on it eagerly.
	const clipMeta = clipId ? await loadClipMeta(eventId, clipId) : null;

	// Keep remote cache/database work out of SvelteKit's navigation gate. The layout renders a small
	// pending state while this nested promise streams to the client.
	return { eventPage: loadEventPage(eventId), clipMeta };
}

/** the clip's own metadata for share cards: title, match, event, and a video thumbnail. */
function loadClipMeta(eventId: number, clipId: string) {
	return db
		.select({
			id: matchClip.id,
			title: matchClip.title,
			videoId: matchClip.videoId,
			authorName: user.name,
			matchId: matchClip.matchId,
			matchName: matchTable.name,
			eventName: eventTable.name
		})
		.from(matchClip)
		.innerJoin(user, eq(user.id, matchClip.userId))
		.innerJoin(matchTable, eq(matchTable.id, matchClip.matchId))
		.innerJoin(eventTable, eq(eventTable.id, matchClip.eventId))
		.where(
			and(eq(matchClip.id, clipId), eq(matchClip.eventId, eventId), isNull(matchClip.deletedAt))
		)
		.limit(1)
		.then((rows) => rows[0] ?? null)
		.catch((error) => {
			console.error('clip metadata unavailable; rendering without og tags', error);
			return null;
		});
}
