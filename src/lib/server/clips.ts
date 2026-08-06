import { sql } from 'drizzle-orm';
import { db } from './db';

export type ClipRateLimitWindow = { seconds: number; max: number; reason: string };

export const CLIP_RATE_LIMITS: ClipRateLimitWindow[] = [
	{ seconds: 10, max: 5, reason: 'you are creating clips too quickly' },
	{ seconds: 60, max: 20, reason: 'slow down for a minute' },
	{ seconds: 60 * 60 * 24, max: 400, reason: 'you have hit the daily clip limit' }
];

export type ClipRateLimitResult =
	{ allowed: true } | { allowed: false; reason: string; retryAfter: number };

export function decideClipRateLimit(counts: number[]): ClipRateLimitResult {
	for (const [index, window] of CLIP_RATE_LIMITS.entries()) {
		if ((counts[index] ?? 0) >= window.max) {
			return { allowed: false, reason: window.reason, retryAfter: window.seconds };
		}
	}

	return { allowed: true };
}

/** Count recent clip rows through the author index rather than using an in-memory counter. */
export async function checkClipRateLimit(
	userId: string,
	now = new Date()
): Promise<ClipRateLimitResult> {
	const windows = CLIP_RATE_LIMITS.map((window) => ({
		...window,
		since: now.getTime() - window.seconds * 1000
	}));
	const oldest = Math.min(...windows.map((window) => window.since));
	const totals = sql.join(
		windows.map(
			(window, index) =>
				sql`sum(case when created_at > ${window.since} then 1 else 0 end) as ${sql.raw(`w${index}`)}`
		),
		sql`, `
	);

	const [row] = await db.all<Record<string, number>>(sql`
		select ${totals}
		from (
			select created_at
			from match_clip
			where user_id = ${userId} and created_at > ${oldest}
			union all
			select created_at
			from automod_strike
			where user_id = ${userId} and created_at > ${oldest}
		)
	`);

	return decideClipRateLimit(windows.map((_, index) => Number(row?.[`w${index}`] ?? 0)));
}
