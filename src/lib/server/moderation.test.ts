import { describe, expect, it } from 'vitest';
import { decideRateLimit, muteMinutesFor, RATE_LIMITS } from './moderation';

describe('decideRateLimit', () => {
	it('lets a normal amount of chat through', () => {
		expect(decideRateLimit([2, 8, 40])).toEqual({ allowed: true });
	});

	it('stops a burst on the shortest window first', () => {
		const result = decideRateLimit([RATE_LIMITS[0].max, 0, 0]);

		expect(result).toMatchObject({ allowed: false, retryAfter: RATE_LIMITS[0].seconds });
	});

	it('stops someone pacing themselves under the daily ceiling', () => {
		const result = decideRateLimit([1, 2, RATE_LIMITS[2].max]);

		expect(result).toMatchObject({ allowed: false, retryAfter: RATE_LIMITS[2].seconds });
	});

	it('reports the window that ran out, so the sender is told something true', () => {
		const result = decideRateLimit([0, RATE_LIMITS[1].max, 0]);

		expect(result).toMatchObject({ allowed: false, reason: RATE_LIMITS[1].reason });
	});

	it('treats a missing count as zero rather than as a limit hit', () => {
		expect(decideRateLimit([])).toEqual({ allowed: true });
	});
});

describe('muteMinutesFor', () => {
	it('nudges rather than punishes for the first couple of blocked messages', () => {
		expect(muteMinutesFor(1, 1)).toBe(0);
		expect(muteMinutesFor(1, 2)).toBe(0);
	});

	it('escalates as the strikes pile up inside the window', () => {
		const ladder = [3, 4, 5, 6].map((strikes) => muteMinutesFor(1, strikes));

		expect(ladder).toEqual([5, 15, 60, 60 * 12]);
	});

	it('stays on the last rung rather than falling off the end of the ladder', () => {
		expect(muteMinutesFor(1, 40)).toBe(60 * 12);
	});

	it('does not turn a miscounted first strike into a twelve hour mute', () => {
		expect(muteMinutesFor(1, 0)).toBe(0);
	});

	it('skips the ladder entirely for a slur', () => {
		expect(muteMinutesFor(3, 1)).toBe(60 * 24);
	});
});
