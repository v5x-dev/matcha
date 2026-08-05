/**
 * Per-address limits on the mail anyone can make us send.
 *
 * `sendVerificationEmail` and `requestPasswordReset` both take an arbitrary address from an
 * unauthenticated caller, so without this anyone can point a loop at somebody else's inbox: the
 * target gets buried, and the sending domain's reputation goes with it. better-auth's own rate
 * limiting is keyed by client ip, which is the wrong axis for this — a pool of addresses walks
 * straight through it while still hitting one victim.
 *
 * The decision is pure and the storage is a single upsert, so the cost is one round trip on a path
 * that was about to make a network call to Resend anyway.
 */

import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { emailThrottle, type EmailKind } from './db/schema';

export type ThrottlePolicy = {
	/** shortest gap between two messages of this kind to one address. */
	cooldownSeconds: number;
	/** how many may be sent inside `windowSeconds` before the address is cut off. */
	max: number;
	windowSeconds: number;
};

/**
 * Deliberately generous per send and tight per hour: someone who mistypes their address and
 * retries twice should never notice this, and someone automating it gets four messages in.
 */
export const EMAIL_POLICIES: Record<EmailKind, ThrottlePolicy> = {
	verification: { cooldownSeconds: 60, max: 4, windowSeconds: 60 * 60 },
	'password-reset': { cooldownSeconds: 60, max: 4, windowSeconds: 60 * 60 },
	'account-deletion': { cooldownSeconds: 60, max: 3, windowSeconds: 60 * 60 }
};

export type ThrottleState = {
	windowStart: Date;
	count: number;
	lastSentAt: Date;
};

export type ThrottleDecision =
	| { allowed: true; next: ThrottleState }
	| { allowed: false; reason: 'cooldown' | 'window'; retryAfterSeconds: number };

/**
 * The whole rule, as a function of the row we have and the clock. Split out from the storage so the
 * window arithmetic can be tested without a database.
 */
export function decideEmailThrottle(
	previous: ThrottleState | null,
	policy: ThrottlePolicy,
	now: Date
): ThrottleDecision {
	if (!previous) {
		return { allowed: true, next: { windowStart: now, count: 1, lastSentAt: now } };
	}

	const windowAge = now.getTime() - previous.windowStart.getTime();
	// a window that has run out starts a fresh allowance rather than sliding
	if (windowAge >= policy.windowSeconds * 1000) {
		return { allowed: true, next: { windowStart: now, count: 1, lastSentAt: now } };
	}

	const sinceLast = now.getTime() - previous.lastSentAt.getTime();
	if (sinceLast < policy.cooldownSeconds * 1000) {
		return {
			allowed: false,
			reason: 'cooldown',
			retryAfterSeconds: Math.ceil((policy.cooldownSeconds * 1000 - sinceLast) / 1000)
		};
	}

	if (previous.count >= policy.max) {
		return {
			allowed: false,
			reason: 'window',
			retryAfterSeconds: Math.ceil((policy.windowSeconds * 1000 - windowAge) / 1000)
		};
	}

	return {
		allowed: true,
		next: { windowStart: previous.windowStart, count: previous.count + 1, lastSentAt: now }
	};
}

/**
 * Claims one send for this address, recording it if it is allowed.
 *
 * Returns whether the caller should go ahead. Callers must not surface the answer to the user: a
 * refusal here would otherwise tell an anonymous caller that an address is registered, which is the
 * one thing the "we sent a link if that address exists" wording exists to avoid.
 */
export async function claimEmailSend(
	kind: EmailKind,
	address: string,
	now = new Date()
): Promise<boolean> {
	const key = address.trim().toLowerCase();
	const policy = EMAIL_POLICIES[kind];

	try {
		const [row] = await db
			.select({
				windowStart: emailThrottle.windowStart,
				count: emailThrottle.count,
				lastSentAt: emailThrottle.lastSentAt
			})
			.from(emailThrottle)
			.where(and(eq(emailThrottle.kind, kind), eq(emailThrottle.address, key)));

		const decision = decideEmailThrottle(row ?? null, policy, now);
		if (!decision.allowed) {
			console.info(
				`[email] throttled a ${kind} message to ${key} (${decision.reason}), retry in ${decision.retryAfterSeconds}s`
			);

			return false;
		}

		await db
			.insert(emailThrottle)
			.values({ kind, address: key, ...decision.next })
			.onConflictDoUpdate({
				target: [emailThrottle.kind, emailThrottle.address],
				set: decision.next
			});

		return true;
	} catch (error) {
		// a throttle that cannot read its own table must not take signup down with it
		console.error('[email] could not apply the send throttle; allowing the message', error);

		return true;
	}
}
