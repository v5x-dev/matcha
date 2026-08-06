import { describe, expect, it } from 'vitest';
import { CLIP_RATE_LIMITS, decideClipRateLimit } from './clips';

describe('decideClipRateLimit', () => {
	it('lets a normal amount of clips through', () => {
		expect(decideClipRateLimit([2, 8, 40])).toEqual({ allowed: true });
	});

	it('stops a burst on the shortest window first', () => {
		const result = decideClipRateLimit([CLIP_RATE_LIMITS[0].max, 0, 0]);

		expect(result).toMatchObject({ allowed: false, retryAfter: CLIP_RATE_LIMITS[0].seconds });
	});

	it('stops someone pacing themselves under the daily ceiling', () => {
		const result = decideClipRateLimit([1, 2, CLIP_RATE_LIMITS[2].max]);

		expect(result).toMatchObject({ allowed: false, retryAfter: CLIP_RATE_LIMITS[2].seconds });
	});

	it('treats a missing count as zero rather than as a limit hit', () => {
		expect(decideClipRateLimit([])).toEqual({ allowed: true });
	});
});
