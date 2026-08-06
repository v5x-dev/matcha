import { httpError } from '$lib/server/http-error';
import { and, desc, eq, isNull } from 'drizzle-orm';
import * as cache from '$lib/server/event-cache';
import { db } from '$lib/server/db';
import {
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

export function load({ params }) {
	const eventId = Number(params.eventId);

	if (!Number.isInteger(eventId) || eventId <= 0) httpError(404, 'event not found');

	// Keep remote cache/database work out of SvelteKit's navigation gate. The layout renders a small
	// pending state while this nested promise streams to the client.
	return { eventPage: loadEventPage(eventId) };
}
