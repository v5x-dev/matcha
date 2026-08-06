import { describe, expect, it } from 'vitest';
import { canDeleteClip, isValidClipSpan, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from './clips';

describe('clip spans', () => {
	it('accepts the configured boundaries', () => {
		expect(isValidClipSpan(10, 10 + MIN_CLIP_SECONDS)).toBe(true);
		expect(isValidClipSpan(10, 10 + MAX_CLIP_SECONDS)).toBe(true);
	});

	it('rejects spans outside the configured boundaries', () => {
		expect(isValidClipSpan(10, 10)).toBe(false);
		expect(isValidClipSpan(10, 9)).toBe(false);
		expect(isValidClipSpan(10, 10 + MIN_CLIP_SECONDS - 1)).toBe(false);
		expect(isValidClipSpan(10, 10 + MAX_CLIP_SECONDS + 1)).toBe(false);
	});
});

describe('clip deletion permissions', () => {
	it('allows the author', () => {
		expect(canDeleteClip('user-1', 'user-1', false)).toBe(true);
	});

	it('allows a moderator', () => {
		expect(canDeleteClip('user-1', 'mod-1', true)).toBe(true);
	});

	it('rejects an unrelated viewer', () => {
		expect(canDeleteClip('user-1', 'user-2', false)).toBe(false);
	});
});
