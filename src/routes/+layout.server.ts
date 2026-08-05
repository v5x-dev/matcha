import { env } from '$env/dynamic/private';

/** the signed-in user, resolved once in `hooks.server.ts` and shared with every page. */
export async function load({ locals }) {
	return {
		user: locals.user,
		/**
		 * Where somebody appeals a mute or asks about their data. Read here rather than from a public
		 * env var so it can change without a rebuild, and null when nobody has set one — every page
		 * that uses it has wording for both.
		 */
		supportEmail: env.SUPPORT_EMAIL?.trim() || null
	};
}
