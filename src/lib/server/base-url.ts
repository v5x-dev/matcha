/**
 * Where better-auth builds its absolute urls from — most visibly the links in verification and
 * password-reset emails, which have to land on a deployment that shares this database.
 *
 * Kept apart from `./auth` and free of any sveltekit import so it can be exercised directly: this
 * is the piece that decides whether a stranger's confirmation link works, and it is not something
 * anyone wants to find out about from a deploy.
 */

export type BaseURLEnvironment = {
	BETTER_AUTH_URL?: string;
	/** "1" on every vercel build and runtime, whether or not the rest of these are exposed. */
	VERCEL?: string;
	VERCEL_ENV?: string;
	VERCEL_URL?: string;
	VERCEL_BRANCH_URL?: string;
	VERCEL_PROJECT_PRODUCTION_URL?: string;
};

export type BaseURLSource =
	'override' | 'vercel-production' | 'vercel-deployment' | 'request' | 'dev-request';

export type BaseURLResolution = {
	/**
	 * `undefined` asks better-auth to read the origin off the incoming request. That is the right
	 * answer more often than a guess is: it follows whatever host the user actually reached.
	 */
	baseURL: string | undefined;
	source: BaseURLSource;
	/** something the operator has to act on, logged once at startup. */
	warning: string | null;
};

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

/** vercel hands out bare hostnames, never schemes. */
export const httpsOrigin = (host: string) => `https://${stripTrailingSlashes(host.trim())}`;

export function resolveBaseURL(
	env: BaseURLEnvironment,
	options: { dev: boolean }
): BaseURLResolution {
	if (env.BETTER_AUTH_URL?.trim()) {
		return {
			baseURL: stripTrailingSlashes(env.BETTER_AUTH_URL.trim()),
			source: 'override',
			warning:
				env.VERCEL_ENV === 'preview'
					? 'BETTER_AUTH_URL is set on a preview deployment, so its emails link to whatever that url points at rather than to this preview. Scope the variable to production only.'
					: null
		};
	}

	// the canonical production domain, custom domain included. only trustworthy on production
	// deployments: preview builds get it too, and it points at production there.
	if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
		return {
			baseURL: httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
			source: 'vercel-production',
			warning: null
		};
	}

	// the deployment's own immutable url, which is what a preview should authenticate against
	if (env.VERCEL_URL) {
		return {
			baseURL: httpsOrigin(env.VERCEL_URL),
			source: 'vercel-deployment',
			warning:
				env.VERCEL_ENV === 'preview'
					? 'This preview signs in against its own deployment url. If the project has vercel deployment protection turned on, links in its emails land on the authentication wall rather than on the app.'
					: null
		};
	}

	// on vercel with none of the system variables in reach: they are not being exposed to the
	// runtime, so every derivation above silently did nothing.
	if (env.VERCEL === '1') {
		return {
			baseURL: undefined,
			source: 'request',
			warning:
				'Running on vercel but VERCEL_URL is not readable at runtime. Turn on "Automatically expose System Environment Variables" for the project, or set BETTER_AUTH_URL, otherwise email links depend on the host header of whatever request happened to trigger them.'
		};
	}

	// locally and on any other host, the request is the most reliable thing there is: it follows a
	// non-default `--port`, a tunnel, or a container hostname without being told about any of them.
	return {
		baseURL: undefined,
		source: options.dev ? 'dev-request' : 'request',
		warning: options.dev
			? null
			: 'No base url could be derived, so email links follow the host header of the request that sent them. Set BETTER_AUTH_URL to pin them to a domain you control.'
	};
}

/**
 * Origins better-auth accepts a request from beyond the base url. Everything here is an origin the
 * app can legitimately be reached at while its emails point somewhere else: a preview behind its
 * branch alias, or a dev server on a port other than the one vite picked first.
 */
export function resolveTrustedOrigins(
	env: BaseURLEnvironment,
	options: { dev: boolean }
): string[] {
	const origins = [
		env.VERCEL_URL && httpsOrigin(env.VERCEL_URL),
		env.VERCEL_BRANCH_URL && httpsOrigin(env.VERCEL_BRANCH_URL),
		env.VERCEL_PROJECT_PRODUCTION_URL && httpsOrigin(env.VERCEL_PROJECT_PRODUCTION_URL),
		// vite's dev and preview servers, plus anything else served from the loopback interface:
		// a dev server on a custom port is a normal thing to be running.
		options.dev && 'http://localhost:*',
		options.dev && 'http://127.0.0.1:*'
	];

	return [...new Set(origins.filter((origin): origin is string => Boolean(origin)))];
}
