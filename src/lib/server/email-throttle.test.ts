import { describe, expect, it } from 'vitest';
import { decideEmailThrottle, EMAIL_POLICIES, type ThrottleState } from './email-throttle';

const policy = EMAIL_POLICIES.verification;
const at = (minutes: number) => new Date(Date.UTC(2026, 7, 5, 12, 0, 0) + minutes * 60_000);

const state = (
	windowStartMinutes: number,
	count: number,
	lastSentMinutes: number
): ThrottleState => ({
	windowStart: at(windowStartMinutes),
	count,
	lastSentAt: at(lastSentMinutes)
});

describe('decideEmailThrottle', () => {
	it('lets the first message through', () => {
		const decision = decideEmailThrottle(null, policy, at(0));

		expect(decision).toMatchObject({ allowed: true, next: { count: 1 } });
	});

	it('holds a second message inside the cooldown', () => {
		const decision = decideEmailThrottle(state(0, 1, 0), policy, at(0.5));

		expect(decision).toMatchObject({ allowed: false, reason: 'cooldown', retryAfterSeconds: 30 });
	});

	it('lets a retry through once the cooldown has passed', () => {
		expect(decideEmailThrottle(state(0, 1, 0), policy, at(2))).toMatchObject({
			allowed: true,
			next: { count: 2 }
		});
	});

	it('cuts the address off once the hourly allowance is gone', () => {
		const decision = decideEmailThrottle(state(0, policy.max, 10), policy, at(30));

		expect(decision).toMatchObject({ allowed: false, reason: 'window' });
	});

	it('keeps counting against the original window rather than sliding it', () => {
		const decision = decideEmailThrottle(state(0, 2, 10), policy, at(30));

		// still the window that opened at 0, so the allowance does not renew by trickling requests
		expect(decision).toMatchObject({ allowed: true, next: { windowStart: at(0), count: 3 } });
	});

	it('opens a fresh allowance once the window has run out', () => {
		const decision = decideEmailThrottle(state(0, policy.max, 10), policy, at(61));

		expect(decision).toMatchObject({ allowed: true, next: { windowStart: at(61), count: 1 } });
	});

	it('tells the caller how long the block lasts', () => {
		const decision = decideEmailThrottle(state(0, policy.max, 10), policy, at(30));

		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.retryAfterSeconds).toBe(30 * 60);
	});
});
