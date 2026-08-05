import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';
import { sendEmail, verificationEmail } from './email';

if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL || undefined,
	database: drizzleAdapter(db, {
		provider: 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification
		}
	}),
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		// sign-up would otherwise hand out a session before the address is confirmed, which is the
		// exact thing `requireEmailVerification` is there to stop
		autoSignIn: false,
		minPasswordLength: 8
	},
	emailVerification: {
		sendOnSignUp: true,
		// the dialog resends with its own callback url when a sign-in is turned away, so letting
		// better-auth also send from here would put two near-identical links in the inbox
		sendOnSignIn: false,
		autoSignInAfterVerification: true,
		async sendVerificationEmail({ user, url }) {
			await sendEmail(verificationEmail({ to: user.email, name: user.name, url }));
		}
	},
	user: {
		// the display name doubles as the chat handle, so it is worth keeping changeable
		changeEmail: { enabled: false }
	},
	// must stay last: it lets better-auth set its cookies through sveltekit's own cookie api
	plugins: [sveltekitCookies(getRequestEvent)]
});

export type AuthSession = typeof auth.$Infer.Session;
