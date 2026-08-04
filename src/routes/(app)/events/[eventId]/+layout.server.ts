import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as cache from '$lib/server/event-cache';
import { db } from '$lib/server/db';
import {
	eventPlaybackOffset,
	matchPlaybackStart,
	matchPlaybackWindow
} from '$lib/server/db/schema';
import { measureServer } from '$lib/server/instrumentation';

async function optionalDatabaseRows<T>(query: Promise<T>, name: string): Promise<T | []> {
	try {
		return await query;
	} catch (error) {
		console.error(`${name} unavailable; continuing without saved playback data`, error);
		return [];
	}
}

export async function load({ params }) {
	const eventId = Number(params.eventId);

	if (!Number.isInteger(eventId) || eventId <= 0) error(404, 'event not found');

	const event = await measureServer('event.load', () => cache.getEvent(eventId), { eventId });
	if (!event) error(404, 'event not found');

	const [matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets] = await Promise.all([
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
		)
	]);

	if (!matches) error(404, 'event not found');

	return { event, matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets };
}
