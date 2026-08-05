import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient();

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	sendVerificationEmail,
	resetPassword,
	deleteUser
} = authClient;

/** where better-auth's verification link drops the user once the token has been checked. */
export const VERIFY_CALLBACK_URL = '/verify';

/** where the reset link drops the user, with `?token=` for the form to hand back. */
export const RESET_CALLBACK_URL = '/reset-password';

/**
 * Asks for a fresh confirmation link. Every caller has to pass the same callback url or the link
 * lands on `/` with better-auth's raw error code in the query and nothing to explain it.
 */
export function resendVerificationEmail(email: string) {
	return sendVerificationEmail({ email, callbackURL: VERIFY_CALLBACK_URL });
}

/**
 * Starts a password reset.
 *
 * This resolves the same way whether or not the address has an account, and callers have to keep
 * it that way: a form that answers "no account with that email" is an account checker, and the
 * addresses it would be answering about mostly belong to teenagers.
 */
export function requestPasswordReset(email: string) {
	return authClient.requestPasswordReset({ email, redirectTo: RESET_CALLBACK_URL });
}
