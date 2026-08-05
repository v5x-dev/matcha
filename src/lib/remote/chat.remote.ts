import { command, getRequestEvent, query } from '$app/server';
import { httpError } from '$lib/server/http-error';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { match, matchMessage, messageReport, user, userBlock } from '$lib/server/db/schema';
import type { ReportReason, UserRole } from '$lib/server/db/schema';
import { MAX_MESSAGE_LENGTH, MESSAGE_LIMIT } from '$lib/chat';
import { reviewMessage } from '$lib/server/automod';
import {
	activeSanction,
	canModerate,
	checkRateLimit,
	isDuplicate,
	loadActor,
	recordStrike,
	type ActiveSanction
} from '$lib/server/moderation';

export type MatchMessage = {
	id: string;
	body: string;
	createdAt: number;
	authorId: string;
	authorName: string;
	authorRole: UserRole;
	/** set when automod wanted a human to look at this. only ever sent to moderators. */
	flaggedRule: string | null;
};

/** everything the chat panel needs to decide which controls to render for this viewer. */
export type ChatViewerState = {
	canModerate: boolean;
	sanction: ActiveSanction | null;
	blockedIds: string[];
};

const matchRef = z.object({
	eventId: z.number().int().positive(),
	matchId: z.number().int().positive()
});

async function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) httpError(401, 'sign in to chat');

	const actor = await loadActor(locals.user.id);
	if (!actor) httpError(401, 'sign in to chat');

	return { actor, name: locals.user.name };
}

/** ids this viewer has blocked, used to filter the message list. anonymous viewers block nobody. */
async function blockedBy(userId: string | undefined): Promise<string[]> {
	if (!userId) return [];

	const rows = await db
		.select({ blockedId: userBlock.blockedId })
		.from(userBlock)
		.where(eq(userBlock.blockerId, userId));

	return rows.map((row) => row.blockedId);
}

export const chatViewerState = query(async (): Promise<ChatViewerState> => {
	const { locals } = getRequestEvent();
	if (!locals.user) return { canModerate: false, sanction: null, blockedIds: [] };

	try {
		const actor = await loadActor(locals.user.id);
		const [sanction, blockedIds] = await Promise.all([
			activeSanction(locals.user.id),
			blockedBy(locals.user.id)
		]);

		return { canModerate: canModerate(actor), sanction, blockedIds };
	} catch (error) {
		console.error('could not resolve chat permissions; falling back to a plain viewer', error);
		return { canModerate: false, sanction: null, blockedIds: [] };
	}
});

export const listMatchMessages = query(
	matchRef,
	async ({ eventId, matchId }): Promise<MatchMessage[]> => {
		const { locals } = getRequestEvent();

		let rows;
		let viewerCanModerate = false;
		let blockedSet = new Set<string>();
		try {
			const actor = locals.user ? await loadActor(locals.user.id) : null;
			viewerCanModerate = canModerate(actor);
			blockedSet = new Set(await blockedBy(locals.user?.id));

			rows = await db
				.select({
					id: matchMessage.id,
					body: matchMessage.body,
					createdAt: matchMessage.createdAt,
					flaggedRule: matchMessage.flaggedRule,
					deletedAt: matchMessage.deletedAt,
					authorId: user.id,
					authorName: user.name,
					authorRole: user.role
				})
				.from(matchMessage)
				.innerJoin(user, eq(user.id, matchMessage.userId))
				.where(and(eq(matchMessage.eventId, eventId), eq(matchMessage.matchId, matchId)))
				.orderBy(desc(matchMessage.createdAt))
				.limit(MESSAGE_LIMIT);
		} catch (error) {
			console.error(`match ${matchId} chat unavailable; continuing with an empty chat`, error);
			return [];
		}

		// read newest-first so the limit keeps the *latest* messages, then flip back to reading order
		return rows
			.reverse()
			.filter((row) => row.deletedAt === null && !blockedSet.has(row.authorId))
			.map((row) => ({
				id: row.id,
				body: row.body,
				createdAt: row.createdAt.getTime(),
				authorId: row.authorId,
				authorName: row.authorName,
				authorRole: row.authorRole,
				// the rule name is a moderation signal, not something the room needs to see
				flaggedRule: viewerCanModerate ? row.flaggedRule : null
			}));
	}
);

const sendSchema = matchRef.extend({
	body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH)
});

function describeUntil(expiresAt: number | null): string {
	if (expiresAt === null) return 'indefinitely';

	const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000));
	if (minutes < 60) return `for another ${minutes} minute${minutes === 1 ? '' : 's'}`;

	const hours = Math.ceil(minutes / 60);

	return `for another ${hours} hour${hours === 1 ? '' : 's'}`;
}

export const sendMatchMessage = command(sendSchema, async (input): Promise<MatchMessage> => {
	const { actor, name } = await requireUser();

	// a match id from another event would otherwise file the message under a chat nobody can read
	const [cachedMatch] = await db
		.select({ id: match.id })
		.from(match)
		.where(and(eq(match.id, input.matchId), eq(match.eventId, input.eventId)));

	if (!cachedMatch) httpError(404, 'match not found');

	const sanction = await activeSanction(actor.id);
	if (sanction) {
		const noun = sanction.kind === 'ban' ? 'banned from chat' : 'muted';
		httpError(403, `you are ${noun} ${describeUntil(sanction.expiresAt)}: ${sanction.reason}`);
	}

	const rate = await checkRateLimit(actor.id);
	if (!rate.allowed) httpError(429, rate.reason);

	const verdict = reviewMessage(input.body);
	if (verdict.action === 'block') {
		const outcome = await recordStrike(actor.id, verdict, input);
		const suffix = outcome.mutedUntil
			? `. you are now muted ${describeUntil(outcome.mutedUntil.getTime())}`
			: '';

		httpError(422, `${verdict.reason ?? 'that message was not allowed'}${suffix}`);
	}

	// checked after automod so a flooder cannot use the duplicate check as a cheaper oracle
	if (await isDuplicate(actor.id, verdict.body)) {
		httpError(429, 'you just said that');
	}

	const createdAt = new Date();
	const [row] = await db
		.insert(matchMessage)
		.values({
			eventId: input.eventId,
			matchId: input.matchId,
			userId: actor.id,
			body: verdict.body,
			flaggedRule: verdict.action === 'flag' ? verdict.rule : null,
			createdAt
		})
		.returning({ id: matchMessage.id });

	const message: MatchMessage = {
		id: row.id,
		body: verdict.body,
		createdAt: createdAt.getTime(),
		authorId: actor.id,
		authorName: name,
		authorRole: actor.role ?? 'user',
		flaggedRule: null
	};

	await listMatchMessages({ eventId: input.eventId, matchId: input.matchId }).refresh();

	return message;
});

const messageRef = z.object({ messageId: z.string().min(1) });

export const deleteMatchMessage = command(messageRef, async ({ messageId }): Promise<void> => {
	const { actor } = await requireUser();

	const [row] = await db
		.select({
			id: matchMessage.id,
			userId: matchMessage.userId,
			eventId: matchMessage.eventId,
			matchId: matchMessage.matchId,
			deletedAt: matchMessage.deletedAt
		})
		.from(matchMessage)
		.where(eq(matchMessage.id, messageId));

	if (!row || row.deletedAt) httpError(404, 'message not found');

	const ownMessage = row.userId === actor.id;
	if (!ownMessage && !canModerate(actor)) httpError(403, 'you cannot delete that message');

	await db
		.update(matchMessage)
		.set({
			deletedAt: new Date(),
			deletedBy: actor.id,
			deletedReason: ownMessage ? 'removed by author' : 'removed by a moderator'
		})
		.where(eq(matchMessage.id, messageId));

	// a moderator deleting a message answers every report against it
	if (!ownMessage) {
		await db
			.update(messageReport)
			.set({ status: 'actioned', resolvedBy: actor.id, resolvedAt: new Date() })
			.where(and(eq(messageReport.messageId, messageId), eq(messageReport.status, 'open')));
	}

	await listMatchMessages({ eventId: row.eventId, matchId: row.matchId }).refresh();
});

const reportSchema = messageRef.extend({
	reason: z.enum(['harassment', 'hate', 'spam', 'sexual', 'other'])
});

export const reportMatchMessage = command(reportSchema, async (input): Promise<void> => {
	const { actor } = await requireUser();

	const [row] = await db
		.select({ id: matchMessage.id, userId: matchMessage.userId })
		.from(matchMessage)
		.where(eq(matchMessage.id, input.messageId));

	if (!row) httpError(404, 'message not found');
	if (row.userId === actor.id) httpError(400, 'you cannot report your own message');

	await db
		.insert(messageReport)
		.values({
			messageId: input.messageId,
			reporterId: actor.id,
			reason: input.reason as ReportReason,
			createdAt: new Date()
		})
		// reporting twice is not extra signal, and it should not read as an error either
		.onConflictDoNothing();
});

const userRef = z.object({ userId: z.string().min(1) });

export const blockChatUser = command(userRef, async ({ userId }): Promise<void> => {
	const { actor } = await requireUser();
	if (userId === actor.id) httpError(400, 'you cannot block yourself');

	await db
		.insert(userBlock)
		.values({ blockerId: actor.id, blockedId: userId, createdAt: new Date() })
		.onConflictDoNothing();

	await chatViewerState().refresh();
});

export const unblockChatUser = command(userRef, async ({ userId }): Promise<void> => {
	const { actor } = await requireUser();

	await db
		.delete(userBlock)
		.where(and(eq(userBlock.blockerId, actor.id), eq(userBlock.blockedId, userId)));

	await chatViewerState().refresh();
});

export type BlockedChatUser = { id: string; name: string };

export const listBlockedChatUsers = query(async (): Promise<BlockedChatUser[]> => {
	const { locals } = getRequestEvent();
	if (!locals.user) return [];

	const ids = await blockedBy(locals.user.id);
	if (ids.length === 0) return [];

	return db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(inArray(user.id, ids))
		.orderBy(user.name);
});
