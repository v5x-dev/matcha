import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { dev } from '$app/environment';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';
import { resolveBaseURL, resolveTrustedOrigins } from './base-url';
import { claimEmailSend } from './email-throttle';
import { accountDeletionEmail, passwordResetEmail, sendEmail, verificationEmail } from './email';

if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

const resolution = resolveBaseURL(env, { dev });

if (resolution.warning) console.warn(`[auth] ${resolution.warning}`);

/**
 * The anonymous endpoints where an attempt costs somebody else something: an email they did not ask
 * for, or a guess at their password. better-auth's own defaults for `/sign-in` and `/sign-up` are
 * looser than these.
 *
 * Keyed by client ip, so it is a brake rather than a wall — `claimEmailSend` is what stops a
 * distributed loop pointed at one inbox.
 */
const ANONYMOUS_LIMITS = {
	'/sign-in/email': { window: 60, max: 10 },
	'/sign-up/email': { window: 60 * 60, max: 6 },
	'/send-verification-email': { window: 60 * 60, max: 6 },
	'/request-password-reset': { window: 60 * 60, max: 6 },
	'/reset-password': { window: 60 * 60, max: 10 },
	'/delete-user': { window: 60 * 60, max: 6 }
};

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: resolution.baseURL,
	// the base url covers the common case; these cover the origins that legitimately differ from
	// it — a preview reached through its branch alias, or a dev server on a non-default port.
	trustedOrigins: resolveTrustedOrigins(env, { dev }),
	rateLimit: {
		// better-auth only turns this on in production by default, which leaves the rules untested
		// until the moment they are load bearing. running them locally too means a broken rule shows
		// up on a laptop instead of in an incident.
		enabled: true,
		window: 60,
		max: 100,
		// serverless: an in-process counter resets on every cold start and does not add up across
		// instances, so it enforces nothing under exactly the traffic that needs enforcing.
		storage: 'database',
		modelName: 'rateLimit',
		customRules: ANONYMOUS_LIMITS
	},
	database: drizzleAdapter(db, {
		provider: 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification,
			rateLimit: schema.rateLimit
		}
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		// sign-up would otherwise hand out a session before the address is confirmed, which is the
		// exact thing `requireEmailVerification` is there to stop
		autoSignIn: false,
		minPasswordLength: 8,
		resetPasswordTokenExpiresIn: 60 * 60,
		// a reset is either the owner locking out whoever had the old password, or the owner
		// recovering an account somebody else reached. both want every other session gone.
		revokeSessionsOnPasswordReset: true,
		async sendResetPassword({ user, url }) {
			// dropped silently on purpose: telling the caller they were throttled would tell them the
			// address is registered, which is what the "we sent a link if it exists" wording avoids
			if (!(await claimEmailSend('password-reset', user.email))) return;

			await sendEmail(passwordResetEmail({ to: user.email, name: user.name, url }));
		}
	},
	emailVerification: {
		sendOnSignUp: true,
		// the dialog resends with its own callback url when a sign-in is turned away, so letting
		// better-auth also send from here would put two near-identical links in the inbox
		sendOnSignIn: false,
		autoSignInAfterVerification: true,
		async sendVerificationEmail({ user, url }) {
			if (!(await claimEmailSend('verification', user.email))) return;

			await sendEmail(verificationEmail({ to: user.email, name: user.name, url }));
		}
	},
	user: {
		additionalFields: {
			/**
			 * The age screen. `required` makes better-auth insist the field is present in a sign-up
			 * body; it does not care what the answer is, so the `before` hook is what turns a "no"
			 * away. Stored rather than checked and discarded: an answer nobody kept is not a record
			 * that the question was ever asked.
			 */
			overThirteen: { type: 'boolean', required: true, input: true }
		},
		// the display name doubles as the chat handle, so it is worth keeping changeable
		changeEmail: { enabled: false },
		deleteUser: {
			enabled: true,
			deleteTokenExpiresIn: 60 * 60,
			// deletion cascades through every table that references the user, so it is worth one more
			// round trip through the inbox before any of it goes
			async sendDeleteAccountVerification({ user, url }) {
				if (!(await claimEmailSend('account-deletion', user.email))) return;

				await sendEmail(accountDeletionEmail({ to: user.email, name: user.name, url }));
			}
		}
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			if (ctx.path !== '/sign-up/email') return;

			// the field being `required` only guarantees it arrived, and an unticked box arrives as a
			// perfectly valid `false`. refusing it here is the whole point of asking.
			if ((ctx.body as { overThirteen?: unknown })?.overThirteen !== true) {
				throw new APIError('BAD_REQUEST', {
					message: 'You have to confirm you are over 13 to create an account'
				});
			}
		})
	},
	// must stay last: it lets better-auth set its cookies through sveltekit's own cookie api
	plugins: [sveltekitCookies(getRequestEvent)]
});

export type AuthSession = typeof auth.$Infer.Session;
