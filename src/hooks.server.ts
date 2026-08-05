import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { building } from '$app/environment';

export async function handle({ event, resolve }) {
	// resolved once per request so load functions and remote functions share the same lookup.
	// prerendering has no request to authenticate, and hitting the db there would fail the build.
	// Better Auth still has to initialize its request context when there is no cookie. Most scouting
	// traffic is anonymous, so avoid putting that work in front of every navigation.
	const cookie = event.request.headers.get('cookie') ?? '';
	const hasSessionCookie = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token(?:\.\d+)?=/.test(
		cookie
	);
	const session =
		building || !hasSessionCookie
			? null
			: await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;

	return svelteKitHandler({ event, resolve, auth, building });
}
