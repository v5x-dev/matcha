import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession, sendVerificationEmail } = authClient;

/** where better-auth's verification link drops the user once the token has been checked. */
export const VERIFY_CALLBACK_URL = '/verify';

/**
 * Asks for a fresh confirmation link. Every caller has to pass the same callback url or the link
 * lands on `/` with better-auth's raw error code in the query and nothing to explain it.
 */
export function resendVerificationEmail(email: string) {
	return sendVerificationEmail({ email, callbackURL: VERIFY_CALLBACK_URL });
}
