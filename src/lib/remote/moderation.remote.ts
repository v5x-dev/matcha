import { command, getRequestEvent, query } from '$app/server';
import { httpError } from '$lib/server/http-error';
import { and, count, desc, eq, gt, isNull, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { matchMessage, messageReport, user, userSanction } from '$lib/server/db/schema';
import type { UserRole } from '$lib/server/db/schema';
import {
	canModerate,
	isAdmin,
	issueSanction,
	liftSanctions,
	loadActor,
	recentStrikes,
	roleOf,
	type Actor
} from '$lib/server/moderation';

async function requireModerator(): Promise<Actor> {
	const { locals } = getRequestEvent();
	if (!locals.user) httpError(401, 'sign in first');

	const actor = await loadActor(locals.user.id);
	if (!canModerate(actor)) httpError(403, 'you are not a moderator');

	return actor!;
}

async function requireAdmin(): Promise<Actor> {
	const actor = await requireModerator();
	if (!isAdmin(actor)) httpError(403, 'that is an admin action');

	return actor;
}

/** whether the current viewer should see the moderation tools at all. */
export const moderationAccess = query(
	async (): Promise<{ canModerate: boolean; isAdmin: boolean }> => {
		const { locals } = getRequestEvent();
		if (!locals.user) return { canModerate: false, isAdmin: false };

		const actor = await loadActor(locals.user.id);

		return { canModerate: canModerate(actor), isAdmin: isAdmin(actor) };
	}
);

export type ReportedMessage = {
	messageId: string;
	body: string;
	createdAt: number;
	deleted: boolean;
	flaggedRule: string | null;
	authorId: string;
	authorName: string;
	eventId: number;
	matchId: number;
	reports: number;
	reasons: string;
	lastReportedAt: number;
};

/** The queue: one row per reported message, newest report first. */
export const listReportedMessages = query(async (): Promise<ReportedMessage[]> => {
	await requireModerator();

	const rows = await db
		.select({
			messageId: messageReport.messageId,
			body: matchMessage.body,
			createdAt: matchMessage.createdAt,
			deletedAt: matchMessage.deletedAt,
			flaggedRule: matchMessage.flaggedRule,
			authorId: user.id,
			authorName: user.name,
			eventId: matchMessage.eventId,
			matchId: matchMessage.matchId,
			reports: count(),
			reasons: sql<string>`group_concat(distinct ${messageReport.reason})`,
			lastReportedAt: max(messageReport.createdAt)
		})
		.from(messageReport)
		.innerJoin(matchMessage, eq(matchMessage.id, messageReport.messageId))
		.innerJoin(user, eq(user.id, matchMessage.userId))
		.where(eq(messageReport.status, 'open'))
		.groupBy(messageReport.messageId)
		.orderBy(desc(max(messageReport.createdAt)))
		.limit(100);

	return rows.map((row) => ({
		messageId: row.messageId,
		body: row.body,
		createdAt: row.createdAt.getTime(),
		deleted: row.deletedAt !== null,
		flaggedRule: row.flaggedRule,
		authorId: row.authorId,
		authorName: row.authorName,
		eventId: row.eventId,
		matchId: row.matchId,
		reports: row.reports,
		reasons: row.reasons ?? '',
		lastReportedAt: Number(row.lastReportedAt ?? row.createdAt.getTime())
	}));
});

/** Messages automod let through but wanted a second opinion on. */
export const listFlaggedMessages = query(async (): Promise<ReportedMessage[]> => {
	await requireModerator();

	const rows = await db
		.select({
			messageId: matchMessage.id,
			body: matchMessage.body,
			createdAt: matchMessage.createdAt,
			deletedAt: matchMessage.deletedAt,
			flaggedRule: matchMessage.flaggedRule,
			authorId: user.id,
			authorName: user.name,
			eventId: matchMessage.eventId,
			matchId: matchMessage.matchId
		})
		.from(matchMessage)
		.innerJoin(user, eq(user.id, matchMessage.userId))
		.where(and(isNull(matchMessage.deletedAt), sql`${matchMessage.flaggedRule} is not null`))
		.orderBy(desc(matchMessage.createdAt))
		.limit(50);

	return rows.map((row) => ({
		messageId: row.messageId,
		body: row.body,
		createdAt: row.createdAt.getTime(),
		deleted: row.deletedAt !== null,
		flaggedRule: row.flaggedRule,
		authorId: row.authorId,
		authorName: row.authorName,
		eventId: row.eventId,
		matchId: row.matchId,
		reports: 0,
		reasons: 'automod',
		lastReportedAt: row.createdAt.getTime()
	}));
});

export const dismissReports = command(
	z.object({ messageId: z.string().min(1) }),
	async ({ messageId }): Promise<void> => {
		const actor = await requireModerator();

		await db
			.update(messageReport)
			.set({ status: 'dismissed', resolvedBy: actor.id, resolvedAt: new Date() })
			.where(and(eq(messageReport.messageId, messageId), eq(messageReport.status, 'open')));

		await listReportedMessages().refresh();
	}
);

/** Clearing the flag says "a human looked at this and it is fine". */
export const clearMessageFlag = command(
	z.object({ messageId: z.string().min(1) }),
	async ({ messageId }): Promise<void> => {
		await requireModerator();

		await db.update(matchMessage).set({ flaggedRule: null }).where(eq(matchMessage.id, messageId));

		await listFlaggedMessages().refresh();
	}
);

/** Removes a message from the moderation queue rather than from the chat panel. */
export const removeMessage = command(
	z.object({ messageId: z.string().min(1), reason: z.string().trim().max(200).optional() }),
	async ({ messageId, reason }): Promise<void> => {
		const actor = await requireModerator();
		const now = new Date();

		await db
			.update(matchMessage)
			.set({
				deletedAt: now,
				deletedBy: actor.id,
				deletedReason: reason || 'removed by a moderator'
			})
			.where(and(eq(matchMessage.id, messageId), isNull(matchMessage.deletedAt)));

		await db
			.update(messageReport)
			.set({ status: 'actioned', resolvedBy: actor.id, resolvedAt: now })
			.where(and(eq(messageReport.messageId, messageId), eq(messageReport.status, 'open')));

		await Promise.all([listReportedMessages().refresh(), listFlaggedMessages().refresh()]);
	}
);

const sanctionSchema = z.object({
	userId: z.string().min(1),
	kind: z.enum(['mute', 'ban']),
	/** null is a sanction with no end date, which only an admin can hand out. */
	minutes: z
		.number()
		.int()
		.positive()
		.max(60 * 24 * 365)
		.nullable(),
	reason: z.string().trim().min(1).max(200)
});

export const sanctionChatUser = command(sanctionSchema, async (input): Promise<void> => {
	const actor = await requireModerator();
	if (input.userId === actor.id) httpError(400, 'you cannot sanction yourself');

	const target = await loadActor(input.userId);
	if (!target) httpError(404, 'user not found');

	// a moderator outranking another moderator turns the tools into a weapon
	if (roleOf(target) !== 'user' && !isAdmin(actor)) {
		httpError(403, 'only an admin can sanction a moderator');
	}

	if (input.minutes === null && !isAdmin(actor)) {
		httpError(403, 'only an admin can issue a permanent sanction');
	}

	await issueSanction({
		userId: input.userId,
		kind: input.kind,
		reason: input.reason,
		expiresAt: input.minutes === null ? null : new Date(Date.now() + input.minutes * 60_000),
		issuedBy: actor.id
	});

	await listActiveSanctions().refresh();
});

export const liftUserSanctions = command(
	z.object({ userId: z.string().min(1) }),
	async ({ userId }): Promise<void> => {
		const actor = await requireModerator();
		await liftSanctions(userId, actor.id);
		await listActiveSanctions().refresh();
	}
);

export type ActiveSanctionRow = {
	userId: string;
	userName: string;
	kind: 'mute' | 'ban';
	reason: string;
	expiresAt: number | null;
	createdAt: number;
	automated: boolean;
};

export const listActiveSanctions = query(async (): Promise<ActiveSanctionRow[]> => {
	await requireModerator();

	const rows = await db
		.select({
			userId: userSanction.userId,
			userName: user.name,
			kind: userSanction.kind,
			reason: userSanction.reason,
			expiresAt: userSanction.expiresAt,
			createdAt: userSanction.createdAt,
			issuedBy: userSanction.issuedBy
		})
		.from(userSanction)
		.innerJoin(user, eq(user.id, userSanction.userId))
		.where(
			and(
				isNull(userSanction.liftedAt),
				or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, new Date()))
			)
		)
		.orderBy(desc(userSanction.createdAt))
		.limit(100);

	return rows.map((row) => ({
		userId: row.userId,
		userName: row.userName,
		kind: row.kind,
		reason: row.reason,
		expiresAt: row.expiresAt?.getTime() ?? null,
		createdAt: row.createdAt.getTime(),
		automated: row.issuedBy === null
	}));
});

export type StrikeRow = { rule: string; severity: number; body: string; createdAt: number };

export const listUserStrikes = query(
	z.object({ userId: z.string().min(1) }),
	async ({ userId }): Promise<StrikeRow[]> => {
		await requireModerator();
		const rows = await recentStrikes(userId);

		return rows.map((row) => ({ ...row, createdAt: row.createdAt.getTime() }));
	}
);

/** Promoting a moderator is the one piece of this that still needs a human with the keys. */
export const setChatUserRole = command(
	z.object({ email: z.string().email(), role: z.enum(['user', 'moderator', 'admin']) }),
	async ({ email, role }): Promise<{ id: string; name: string; role: UserRole }> => {
		const actor = await requireAdmin();

		const [target] = await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(eq(user.email, email.toLowerCase()));

		if (!target) httpError(404, 'no account with that email');
		if (target.id === actor.id) httpError(400, 'you cannot change your own role');

		await db.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, target.id));

		return { id: target.id, name: target.name, role };
	}
);
