import { command, getRequestEvent, query } from '$app/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { eventVideo, matchClip, match, user } from '$lib/server/db/schema';
import { httpError } from '$lib/server/http-error';
import { reviewMessage } from '$lib/server/automod';
import { activeSanction, canModerate, loadActor, recordStrike } from '$lib/server/moderation';
import { checkClipRateLimit } from '$lib/server/clips';
import {
	canDeleteClip,
	CLIP_LIMIT,
	isValidClipSpan,
	MAX_CLIP_TITLE_LENGTH,
	MAX_CLIP_SECONDS,
	MIN_CLIP_SECONDS
} from '$lib/clips';

export type EventClip = {
	id: string;
	matchId: number;
	videoId: string;
	title: string;
	startSeconds: number;
	endSeconds: number;
	authorId: string;
	authorName: string;
	createdAt: number;
};

export const listEventClips = query(
	z.number().int().positive(),
	async (eventId: number): Promise<EventClip[]> => {
		const rows = await db
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
			.limit(CLIP_LIMIT);

		return rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() }));
	}
);

export const getEventClip = query(
	z.object({ eventId: z.number().int().positive(), clipId: z.string().min(1) }),
	async ({ eventId, clipId }): Promise<EventClip | null> => {
		const [row] = await db
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
			.where(
				and(eq(matchClip.eventId, eventId), eq(matchClip.id, clipId), isNull(matchClip.deletedAt))
			)
			.limit(1);

		return row ? { ...row, createdAt: row.createdAt.getTime() } : null;
	}
);

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const createSchema = z
	.object({
		eventId: z.number().int().positive(),
		matchId: z.number().int().positive(),
		videoId: z.string().regex(YOUTUBE_VIDEO_ID, 'video not found'),
		title: z.string().trim().min(1).max(MAX_CLIP_TITLE_LENGTH),
		startSeconds: z.number().int().nonnegative(),
		endSeconds: z.number().int().positive()
	})
	.refine(({ startSeconds, endSeconds }) => isValidClipSpan(startSeconds, endSeconds), {
		message: `clip must be between ${MIN_CLIP_SECONDS} and ${MAX_CLIP_SECONDS} seconds`
	});

function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) httpError(401, 'sign in to save clips');

	return locals.user;
}

function describeUntil(expiresAt: number | null): string {
	if (expiresAt === null) return 'indefinitely';

	const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000));
	if (minutes < 60) return `for another ${minutes} minute${minutes === 1 ? '' : 's'}`;

	const hours = Math.ceil(minutes / 60);
	return `for another ${hours} hour${hours === 1 ? '' : 's'}`;
}

export const createClip = command(createSchema, async (input): Promise<EventClip> => {
	const actor = requireUser();

	const [cachedMatch, cachedVideo, sanction, rate] = await Promise.all([
		db
			.select({ id: match.id })
			.from(match)
			.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId))),
		db
			.select({ data: eventVideo.data })
			.from(eventVideo)
			.where(and(eq(eventVideo.eventId, input.eventId), eq(eventVideo.videoId, input.videoId))),
		activeSanction(actor.id),
		checkClipRateLimit(actor.id)
	]);

	if (cachedMatch.length === 0) httpError(404, 'match not found');
	if (cachedVideo.length === 0) httpError(404, 'video not found for this event');

	const durationSeconds = cachedVideo[0]?.data.durationSeconds;
	if (durationSeconds && input.endSeconds > durationSeconds) {
		httpError(422, 'clip ends after the recording');
	}

	if (sanction) {
		const noun = sanction.kind === 'ban' ? 'banned from creating clips' : 'muted';
		httpError(403, `you are ${noun} ${describeUntil(sanction.expiresAt)}: ${sanction.reason}`);
	}

	if (!rate.allowed) httpError(429, rate.reason);

	const verdict = reviewMessage(input.title);
	if (verdict.action === 'block') {
		const outcome = await recordStrike(actor.id, verdict, input);
		const suffix = outcome.mutedUntil
			? `. you are now muted ${describeUntil(outcome.mutedUntil.getTime())}`
			: '';

		httpError(422, `${verdict.reason ?? 'that title was not allowed'}${suffix}`);
	}

	if (!verdict.body) httpError(422, 'clip title cannot be empty');

	const createdAt = new Date();
	const [row] = await db
		.insert(matchClip)
		.values({
			eventId: input.eventId,
			matchId: input.matchId,
			videoId: input.videoId,
			userId: actor.id,
			title: verdict.body,
			flaggedRule: verdict.action === 'flag' ? verdict.rule : null,
			startSeconds: input.startSeconds,
			endSeconds: input.endSeconds,
			createdAt
		})
		.returning({ id: matchClip.id });

	const clip: EventClip = {
		id: row.id,
		matchId: input.matchId,
		videoId: input.videoId,
		title: verdict.body,
		startSeconds: input.startSeconds,
		endSeconds: input.endSeconds,
		authorId: actor.id,
		authorName: actor.name,
		createdAt: createdAt.getTime()
	};

	await listEventClips(input.eventId).refresh();

	return clip;
});

const deleteSchema = z.object({
	clipId: z.string().min(1),
	reason: z.string().trim().max(200).optional()
});

export const deleteClip = command(deleteSchema, async ({ clipId, reason }): Promise<void> => {
	const actor = requireUser();
	const moderator = canModerate(await loadActor(actor.id));

	const [row] = await db
		.select({
			id: matchClip.id,
			userId: matchClip.userId,
			eventId: matchClip.eventId,
			deletedAt: matchClip.deletedAt
		})
		.from(matchClip)
		.where(eq(matchClip.id, clipId));

	if (!row || row.deletedAt) httpError(404, 'clip not found');

	if (!canDeleteClip(row.userId, actor.id, moderator)) {
		httpError(403, 'you cannot delete that clip');
	}

	const ownClip = row.userId === actor.id;
	await db
		.update(matchClip)
		.set({
			deletedAt: new Date(),
			deletedBy: actor.id,
			deletedReason: ownClip ? 'removed by author' : reason || 'removed by a moderator'
		})
		.where(eq(matchClip.id, clipId));

	await Promise.all([
		listEventClips(row.eventId).refresh(),
		getEventClip({ eventId: row.eventId, clipId }).refresh()
	]);
});
