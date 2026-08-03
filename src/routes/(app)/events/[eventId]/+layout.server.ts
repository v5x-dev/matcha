import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as cache from '$lib/server/event-cache';
import { db } from '$lib/server/db';
import {
	eventPlaybackOffset,
	matchPlaybackStart,
	matchPlaybackWindow
} from '$lib/server/db/schema';

export async function load({ params }) {
	const eventId = Number(params.eventId);

	if (!Number.isInteger(eventId) || eventId <= 0) error(404, 'event not found');

	const event = await cache.getEvent(eventId);
	if (!event) error(404, 'event not found');

	const [matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets] = await Promise.all([
		cache.listMatches(eventId),
		db
			.select({
				matchId: matchPlaybackWindow.matchId,
				videoId: matchPlaybackWindow.videoId,
				startSeconds: matchPlaybackWindow.startSeconds,
				endSeconds: matchPlaybackWindow.endSeconds
			})
			.from(matchPlaybackWindow)
			.where(eq(matchPlaybackWindow.eventId, eventId)),
		db
			.select({
				matchId: matchPlaybackStart.matchId,
				videoId: matchPlaybackStart.videoId,
				startSeconds: matchPlaybackStart.startSeconds
			})
			.from(matchPlaybackStart)
			.where(eq(matchPlaybackStart.eventId, eventId)),
		db
			.select({
				videoId: eventPlaybackOffset.videoId,
				offsetSeconds: eventPlaybackOffset.offsetSeconds
			})
			.from(eventPlaybackOffset)
			.where(eq(eventPlaybackOffset.eventId, eventId))
	]);

	if (!matches) error(404, 'event not found');

	return { event, matches, savedMatchWindows, savedMatchStarts, savedPlaybackOffsets };
}
