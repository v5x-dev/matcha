// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthSession } from '$lib/server/auth';

declare global {
	namespace App {
		interface Error {
			message: string;
			// see `httpError` in $lib/server/http-error: the status only survives a streamed load or a
			// remote function if it rides along in the body
			status?: number;
		}
		interface Locals {
			user: AuthSession['user'] | null;
			session: AuthSession['session'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
