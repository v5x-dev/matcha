import { error } from '@sveltejs/kit';

/**
 * SvelteKit only sends the *body* of an `error()` to the client when the failure travels through a
 * streamed load or a remote function, so the status is dropped and every one of them looks like a
 * 500 to the error UI. Putting the status in the body as well is what lets a missing event read as
 * "nothing lives here" instead of "something brewed wrong".
 *
 * Use this instead of `error()` anywhere the throw can happen after the response has started —
 * inside a streamed promise, or inside a remote function.
 */
export function httpError(status: number, message: string): never {
	error(status, { message, status });
}
