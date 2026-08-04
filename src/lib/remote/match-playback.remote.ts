import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import {
	eventPlaybackOffset,
	match,
	matchPlaybackStart,
	matchPlaybackWindow
} from '$lib/server/db/schema';

export type SavedMatchPlaybackWindow = {
	matchId: number;
	videoId: string;
	startSeconds: number;
	endSeconds: number;
};

export type SavedMatchPlaybackStart = {
	matchId: number;
	videoId: string;
	startSeconds: number;
};

/** the saved correction for each of an event's recordings, keyed by video id. */
export type SavedPlaybackOffset = { videoId: string; offsetSeconds: number };

export const listPlaybackOffsets = query(
	z.number(),
	async (eventId: number): Promise<SavedPlaybackOffset[]> =>
		db
			.select({
				videoId: eventPlaybackOffset.videoId,
				offsetSeconds: eventPlaybackOffset.offsetSeconds
			})
			.from(eventPlaybackOffset)
			.where(eq(eventPlaybackOffset.eventId, eventId))
);

export const listMatchPlaybackWindows = query(
	z.number(),
	async (eventId: number): Promise<SavedMatchPlaybackWindow[]> =>
		db
			.select({
				matchId: matchPlaybackWindow.matchId,
				videoId: matchPlaybackWindow.videoId,
				startSeconds: matchPlaybackWindow.startSeconds,
				endSeconds: matchPlaybackWindow.endSeconds
			})
			.from(matchPlaybackWindow)
			.where(eq(matchPlaybackWindow.eventId, eventId))
);

export const listMatchPlaybackStarts = query(
	z.number(),
	async (eventId: number): Promise<SavedMatchPlaybackStart[]> =>
		db
			.select({
				matchId: matchPlaybackStart.matchId,
				videoId: matchPlaybackStart.videoId,
				startSeconds: matchPlaybackStart.startSeconds
			})
			.from(matchPlaybackStart)
			.where(eq(matchPlaybackStart.eventId, eventId))
);

const saveSchema = z
	.object({
		eventId: z.number().int().positive(),
		matchId: z.number().int().positive(),
		videoId: z.string().min(1),
		startSeconds: z.number().int().nonnegative(),
		endSeconds: z.number().int().positive()
	})
	.refine(({ startSeconds, endSeconds }) => endSeconds > startSeconds, {
		message: 'end must be after start'
	});

const offsetSchema = z.object({
	eventId: z.number().int().positive(),
	matchId: z.number().int().positive(),
	videoId: z.string().min(1),
	offsetSeconds: z.number().int()
});

const startSchema = z.object({
	eventId: z.number().int().positive(),
	matchId: z.number().int().positive(),
	videoId: z.string().min(1),
	startSeconds: z.number().int().nonnegative()
});

function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'sign in to change playback calibration');
	return locals.user;
}

export const savePlaybackOffset = command(
	offsetSchema,
	async (input): Promise<SavedPlaybackOffset> => {
		requireUser();
		const [cachedMatch] = await db
			.select({ id: match.id })
			.from(match)
			.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId)));

		if (!cachedMatch) error(404, 'match not found');

		await db
			.insert(eventPlaybackOffset)
			.values({
				eventId: input.eventId,
				videoId: input.videoId,
				offsetSeconds: input.offsetSeconds,
				updatedAt: new Date()
			})
			.onConflictDoUpdate({
				target: [eventPlaybackOffset.eventId, eventPlaybackOffset.videoId],
				set: { offsetSeconds: input.offsetSeconds, updatedAt: new Date() }
			});

		return { videoId: input.videoId, offsetSeconds: input.offsetSeconds };
	}
);

const clearOffsetSchema = z.object({
	eventId: z.number().int().positive(),
	videoId: z.string().min(1)
});

/** remove the stream-wide calibration and return to the inferred event clock. */
export const clearPlaybackOffset = command(
	clearOffsetSchema,
	async (input): Promise<{ videoId: string }> => {
		requireUser();
		const [saved] = await db
			.select({ videoId: eventPlaybackOffset.videoId })
			.from(eventPlaybackOffset)
			.where(
				and(
					eq(eventPlaybackOffset.eventId, input.eventId),
					eq(eventPlaybackOffset.videoId, input.videoId)
				)
			);

		if (!saved) error(400, 'this recording is still using its inferred event clock');

		await db
			.delete(eventPlaybackOffset)
			.where(
				and(
					eq(eventPlaybackOffset.eventId, input.eventId),
					eq(eventPlaybackOffset.videoId, input.videoId)
				)
			);

		return { videoId: input.videoId };
	}
);

export const saveMatchPlaybackStart = command(
	startSchema,
	async (input): Promise<SavedMatchPlaybackStart> => {
		requireUser();
		const [cachedMatch] = await db
			.select({ id: match.id })
			.from(match)
			.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId)));

		if (!cachedMatch) error(404, 'match not found');

		await db
			.insert(matchPlaybackStart)
			.values({ ...input, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: matchPlaybackStart.matchId,
				set: {
					eventId: input.eventId,
					videoId: input.videoId,
					startSeconds: input.startSeconds,
					updatedAt: new Date()
				}
			});

		return input;
	}
);

export const saveMatchPlaybackWindow = command(
	saveSchema,
	async (input): Promise<SavedMatchPlaybackWindow> => {
		requireUser();
		const [cachedMatch] = await db
			.select({ id: match.id })
			.from(match)
			.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId)));

		if (!cachedMatch) error(404, 'match not found');

		await db
			.insert(matchPlaybackWindow)
			.values({ ...input, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: matchPlaybackWindow.matchId,
				set: {
					eventId: input.eventId,
					videoId: input.videoId,
					startSeconds: input.startSeconds,
					endSeconds: input.endSeconds,
					updatedAt: new Date()
				}
			});

		return input;
	}
);
