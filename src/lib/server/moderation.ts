/**
 * The stateful half of chat moderation: who is allowed to post right now, how fast, and what
 * happens when automod refuses the same person over and over. The rules themselves live in
 * `$lib/server/automod`, which stays pure so it can be reasoned about on its own.
 */

import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { automodStrike, matchMessage, user, userSanction, type UserRole } from './db/schema';
import type { AutomodVerdict } from './automod';

/**
 * Bootstrap moderators. Without this the first moderator could only be created with the manual SQL
 * statement this whole change exists to get rid of. Comma-separated, matched case-insensitively.
 */
function bootstrapAdmins(): string[] {
	return (env.MODERATOR_EMAILS ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
}

export type Actor = { id: string; email: string; role?: UserRole | null };

export function roleOf(actor: Actor): UserRole {
	if (bootstrapAdmins().includes(actor.email.toLowerCase())) return 'admin';

	return actor.role ?? 'user';
}

export function canModerate(actor: Actor | null | undefined): boolean {
	if (!actor) return false;
	const role = roleOf(actor);

	return role === 'moderator' || role === 'admin';
}

export function isAdmin(actor: Actor | null | undefined): boolean {
	return Boolean(actor) && roleOf(actor!) === 'admin';
}

/** `locals.user` carries whatever better-auth selected, which does not include our role column. */
export async function loadActor(userId: string): Promise<Actor | null> {
	const [row] = await db
		.select({ id: user.id, email: user.email, role: user.role })
		.from(user)
		.where(eq(user.id, userId));

	return row ?? null;
}

export type ActiveSanction = {
	kind: 'mute' | 'ban';
	reason: string;
	expiresAt: number | null;
};

/** The sanction currently keeping someone out of chat, if any. Bans outrank mutes. */
export async function activeSanction(
	userId: string,
	now = new Date()
): Promise<ActiveSanction | null> {
	const rows = await db
		.select({
			kind: userSanction.kind,
			reason: userSanction.reason,
			expiresAt: userSanction.expiresAt
		})
		.from(userSanction)
		.where(
			and(
				eq(userSanction.userId, userId),
				isNull(userSanction.liftedAt),
				or(isNull(userSanction.expiresAt), gt(userSanction.expiresAt, now))
			)
		);

	if (rows.length === 0) return null;

	const ban = rows.find((row) => row.kind === 'ban');
	const chosen =
		ban ??
		// among mutes, the one that keeps them out longest is the one worth reporting
		rows.reduce((longest, row) => {
			if (longest.expiresAt === null) return longest;
			if (row.expiresAt === null) return row;

			return row.expiresAt > longest.expiresAt ? row : longest;
		});

	return {
		kind: chosen.kind,
		reason: chosen.reason,
		expiresAt: chosen.expiresAt?.getTime() ?? null
	};
}

export type RateLimitWindow = { seconds: number; max: number; reason: string };

/**
 * Counted against the database rather than an in-process map on purpose: the app runs on a
 * serverless adapter, so a per-instance counter would reset every cold start and multiply by the
 * number of instances. Three windows: a burst allowance, a per-minute floor, and a daily ceiling
 * that a determined flooder cannot walk around by pacing themselves.
 */
export const RATE_LIMITS: RateLimitWindow[] = [
	{ seconds: 10, max: 5, reason: 'you are sending messages too quickly' },
	{ seconds: 60, max: 20, reason: 'slow down for a minute' },
	{ seconds: 60 * 60 * 24, max: 400, reason: 'you have hit the daily message limit' }
];

export type RateLimitResult =
	{ allowed: true } | { allowed: false; reason: string; retryAfter: number };

export async function checkRateLimit(userId: string, now = new Date()): Promise<RateLimitResult> {
	for (const window of RATE_LIMITS) {
		const since = new Date(now.getTime() - window.seconds * 1000);
		const [row] = await db
			.select({ total: count() })
			.from(matchMessage)
			.where(and(eq(matchMessage.userId, userId), gt(matchMessage.createdAt, since)));

		if ((row?.total ?? 0) >= window.max) {
			return { allowed: false, reason: window.reason, retryAfter: window.seconds };
		}
	}

	return { allowed: true };
}

/** how long the same text is treated as a repeat rather than a new message. */
const DUPLICATE_WINDOW_SECONDS = 60;

export async function isDuplicate(
	userId: string,
	body: string,
	now = new Date()
): Promise<boolean> {
	const since = new Date(now.getTime() - DUPLICATE_WINDOW_SECONDS * 1000);
	const [row] = await db
		.select({ id: matchMessage.id })
		.from(matchMessage)
		.where(
			and(
				eq(matchMessage.userId, userId),
				gt(matchMessage.createdAt, since),
				// sqlite's default collation is case-sensitive, and shouting the same line back with
				// different capitalisation is the same line
				sql`lower(${matchMessage.body}) = lower(${body})`
			)
		)
		.limit(1);

	return Boolean(row);
}

/**
 * Escalation ladder. A first swear is a nudge, not a punishment; someone who keeps going gets
 * progressively longer time-outs. Severity 3 skips the ladder entirely — there is no version of a
 * slur that deserves a warning first.
 */
const STRIKE_WINDOW_SECONDS = 60 * 60;

const MUTE_LADDER_MINUTES = [0, 0, 5, 15, 60, 60 * 12];

const SEVERITY_THREE_MUTE_MINUTES = 60 * 24;

export type StrikeOutcome = { mutedUntil: Date | null; strikes: number };

/**
 * Records a refusal and issues a mute once someone has earned one. Returns what happened so the
 * caller can tell the sender they are now muted rather than silently swallowing the next message.
 */
export async function recordStrike(
	userId: string,
	verdict: AutomodVerdict,
	context: { eventId: number; matchId: number },
	now = new Date()
): Promise<StrikeOutcome> {
	await db.insert(automodStrike).values({
		userId,
		rule: verdict.rule ?? 'unknown',
		severity: verdict.severity,
		body: verdict.body.slice(0, 500),
		eventId: context.eventId,
		matchId: context.matchId,
		createdAt: now
	});

	if (verdict.severity >= 3) {
		const expiresAt = new Date(now.getTime() + SEVERITY_THREE_MUTE_MINUTES * 60_000);
		await issueSanction({
			userId,
			kind: 'mute',
			reason: `automod: ${verdict.rule}`,
			expiresAt,
			issuedBy: null,
			now
		});

		return { mutedUntil: expiresAt, strikes: 1 };
	}

	const since = new Date(now.getTime() - STRIKE_WINDOW_SECONDS * 1000);
	const [row] = await db
		.select({ total: count() })
		.from(automodStrike)
		.where(and(eq(automodStrike.userId, userId), gt(automodStrike.createdAt, since)));

	const strikes = row?.total ?? 1;
	const minutes =
		MUTE_LADDER_MINUTES[Math.min(strikes, MUTE_LADDER_MINUTES.length) - 1] ??
		MUTE_LADDER_MINUTES[MUTE_LADDER_MINUTES.length - 1];

	if (minutes <= 0) return { mutedUntil: null, strikes };

	const expiresAt = new Date(now.getTime() + minutes * 60_000);
	await issueSanction({
		userId,
		kind: 'mute',
		reason: `automod: ${strikes} blocked messages in an hour`,
		expiresAt,
		issuedBy: null,
		now
	});

	return { mutedUntil: expiresAt, strikes };
}

export async function issueSanction(input: {
	userId: string;
	kind: 'mute' | 'ban';
	reason: string;
	expiresAt: Date | null;
	issuedBy: string | null;
	now?: Date;
}): Promise<void> {
	await db.insert(userSanction).values({
		userId: input.userId,
		kind: input.kind,
		reason: input.reason,
		expiresAt: input.expiresAt,
		issuedBy: input.issuedBy,
		createdAt: input.now ?? new Date()
	});
}

/** Lifts every sanction currently in force against someone. */
export async function liftSanctions(
	userId: string,
	moderatorId: string,
	now = new Date()
): Promise<void> {
	await db
		.update(userSanction)
		.set({ liftedAt: now, liftedBy: moderatorId })
		.where(and(eq(userSanction.userId, userId), isNull(userSanction.liftedAt)));
}

/** Recent automod refusals for one person, for the moderator reviewing an auto-mute. */
export async function recentStrikes(userId: string, limit = 20) {
	return db
		.select({
			rule: automodStrike.rule,
			severity: automodStrike.severity,
			body: automodStrike.body,
			createdAt: automodStrike.createdAt
		})
		.from(automodStrike)
		.where(eq(automodStrike.userId, userId))
		.orderBy(desc(automodStrike.createdAt))
		.limit(limit);
}
