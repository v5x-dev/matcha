import { describe, expect, it } from 'vitest';
import { resolveBaseURL, resolveTrustedOrigins } from './base-url';

describe('resolveBaseURL', () => {
	it('follows the request locally, so a non-default port or a tunnel still works', () => {
		expect(resolveBaseURL({}, { dev: true })).toMatchObject({
			baseURL: undefined,
			source: 'dev-request',
			warning: null
		});
	});

	it('uses the production domain on a production deployment', () => {
		const resolution = resolveBaseURL(
			{
				VERCEL: '1',
				VERCEL_ENV: 'production',
				VERCEL_PROJECT_PRODUCTION_URL: 'matcha.example.com',
				VERCEL_URL: 'matcha-abc123.vercel.app'
			},
			{ dev: false }
		);

		expect(resolution.baseURL).toBe('https://matcha.example.com');
	});

	it('keeps a preview pointed at itself rather than at production', () => {
		const resolution = resolveBaseURL(
			{
				VERCEL: '1',
				VERCEL_ENV: 'preview',
				// previews are handed this too, which is the trap: it points at production
				VERCEL_PROJECT_PRODUCTION_URL: 'matcha.example.com',
				VERCEL_URL: 'matcha-git-branch-abc.vercel.app'
			},
			{ dev: false }
		);

		expect(resolution.baseURL).toBe('https://matcha-git-branch-abc.vercel.app');
		expect(resolution.warning).toMatch(/deployment protection/);
	});

	it('lets an explicit override win everywhere, without its trailing slash', () => {
		expect(
			resolveBaseURL(
				{ BETTER_AUTH_URL: 'https://matcha.example.com/', VERCEL_URL: 'ignored.vercel.app' },
				{ dev: false }
			).baseURL
		).toBe('https://matcha.example.com');
	});

	it('warns when the override is set on a preview, which sends its emails to production', () => {
		const resolution = resolveBaseURL(
			{ BETTER_AUTH_URL: 'https://matcha.example.com', VERCEL_ENV: 'preview' },
			{ dev: false }
		);

		expect(resolution.warning).toMatch(/production only/);
	});

	it('says so when it is on vercel but the system variables are not exposed', () => {
		const resolution = resolveBaseURL({ VERCEL: '1' }, { dev: false });

		expect(resolution.baseURL).toBeUndefined();
		expect(resolution.warning).toMatch(/System Environment Variables/);
	});

	it('warns on any other host that email links follow the host header', () => {
		const resolution = resolveBaseURL({}, { dev: false });

		expect(resolution.baseURL).toBeUndefined();
		expect(resolution.warning).toMatch(/BETTER_AUTH_URL/);
	});
});

describe('resolveTrustedOrigins', () => {
	it('covers the loopback ports a dev server can end up on', () => {
		const origins = resolveTrustedOrigins({}, { dev: true });

		expect(origins).toContain('http://localhost:*');
		expect(origins).toContain('http://127.0.0.1:*');
	});

	it('covers a preview reached through its branch alias as well as its own url', () => {
		const origins = resolveTrustedOrigins(
			{
				VERCEL_URL: 'matcha-abc123.vercel.app',
				VERCEL_BRANCH_URL: 'matcha-git-branch.vercel.app',
				VERCEL_PROJECT_PRODUCTION_URL: 'matcha.example.com'
			},
			{ dev: false }
		);

		expect(origins).toEqual([
			'https://matcha-abc123.vercel.app',
			'https://matcha-git-branch.vercel.app',
			'https://matcha.example.com'
		]);
	});

	it('does not trust loopback in production', () => {
		expect(resolveTrustedOrigins({}, { dev: false })).toEqual([]);
	});
});
