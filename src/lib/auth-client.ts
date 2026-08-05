import { createAuthClient } from 'better-auth/svelte';
import { inferAdditionalFields } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	// spelled out rather than inferred from `typeof auth`: that type lives in $lib/server, and
	// importing it here would reach across the server boundary for a shape this small.
	plugins: [inferAdditionalFields({ user: { overThirteen: { type: 'boolean' } } })]
});

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	sendVerificationEmail,
	resetPassword,
	deleteUser
} = authClient;

/**
 * Hands the wait off a rate-limited response to `sink`, in seconds.
 *
 * better-auth puts it in `X-Retry-After` and leaves it out of the error body, so without reading the
 * response there is nothing to tell the user beyond "later".
 */
export function captureRetryAfter(sink: (seconds: number | null) => void) {
	return {
		onError(context: { response: Response }) {
			const seconds = Number(context.response.headers.get('X-Retry-After'));

			sink(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
		}
	};
}

function describeWait(seconds: number): string {
	if (seconds < 60) return `${Math.ceil(seconds)} seconds`;

	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) return minutes === 1 ? 'a minute' : `${minutes} minutes`;

	const hours = Math.ceil(minutes / 60);

	return hours === 1 ? 'an hour' : `${hours} hours`;
}

/**
 * The line to show under a failed auth form, lowercased for the ui.
 *
 * A tripped rate limit gets its own wording: better-auth's "Too many requests. Please try again
 * later." reads as a dead end, when the wait is usually short and always known.
 */
export function authErrorMessage(
	error: { message?: string | null; status?: number } | null | undefined,
	retryAfterSeconds?: number | null
): string {
	if (error?.status === 429) {
		return retryAfterSeconds
			? `too many attempts. try again in ${describeWait(retryAfterSeconds)}.`
			: 'too many attempts. try again in a few minutes.';
	}

	return (error?.message ?? 'something went wrong').toLowerCase();
}

/** where better-auth's verification link drops the user once the token has been checked. */
export const VERIFY_CALLBACK_URL = '/verify';

/** where the reset link drops the user, with `?token=` for the form to hand back. */
export const RESET_CALLBACK_URL = '/reset-password';

/**
 * How long a "send it again" button has to stay disabled for pressing it to actually do anything.
 *
 * Mirrors the per-address cooldown in `$lib/server/email-throttle`, which drops a send inside that
 * window *silently* — it has to, since answering would tell an anonymous caller whether the address
 * is registered. So the server cannot report this and the button has to count it out itself. If the
 * policy there changes, this has to follow it.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Asks for a fresh confirmation link. Every caller has to pass the same callback url or the link
 * lands on `/` with better-auth's raw error code in the query and nothing to explain it.
 */
export function resendVerificationEmail(
	email: string,
	fetchOptions?: Parameters<typeof sendVerificationEmail>[0]['fetchOptions']
) {
	return sendVerificationEmail({ email, callbackURL: VERIFY_CALLBACK_URL, fetchOptions });
}

/**
 * Starts a password reset.
 *
 * This resolves the same way whether or not the address has an account, and callers have to keep
 * it that way: a form that answers "no account with that email" is an account checker, and the
 * addresses it would be answering about mostly belong to teenagers.
 */
export function requestPasswordReset(
	email: string,
	fetchOptions?: Parameters<typeof authClient.requestPasswordReset>[0]['fetchOptions']
) {
	return authClient.requestPasswordReset({ email, redirectTo: RESET_CALLBACK_URL, fetchOptions });
}
