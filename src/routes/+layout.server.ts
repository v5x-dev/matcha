/** the signed-in user, resolved once in `hooks.server.ts` and shared with every page. */
export async function load({ locals }) {
	return { user: locals.user };
}
