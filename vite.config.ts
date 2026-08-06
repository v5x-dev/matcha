import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			},

			// Pinned to the Vercel adapter rather than adapter-auto: adapter-auto installs the
			// adapter mid-build, which resolves @vercel/nft's dependencies against an already
			// hoisted tree. See https://svelte.dev/docs/kit/adapter-vercel for options.
			// The runtime is pinned so the build does not depend on the Node version of whatever
			// machine runs it; it matches the project's Node.js version on Vercel.
			adapter: adapter({ runtime: 'nodejs24.x' }),
			experimental: { remoteFunctions: true },

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	],

	// Two dev servers in this directory both regenerate `.svelte-kit/generated/**` and both watch it,
	// so each one's writes trigger the other's full-reload handler and the pair reload each other
	// forever — the page never settles and edits appear to "break" the server. Without strictPort a
	// second `vite dev` silently starts on 5174 and you get that loop instead of an error, so fail
	// fast on a busy port rather than joining the fight.
	//
	// strictPort alone is not enough: the default host `localhost` resolves to both ::1 and
	// 127.0.0.1, so two servers can each grab port 5173 on a different address family and neither
	// sees the port as busy. The browser then resolves `localhost` per request and can fetch the
	// document from one server and the modules from the other, which shows up as
	// `hydration_mismatch` and a blank page. Pin a single literal address so the collision is real.
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true
	},

	test: {
		// server-side rules only for now: these are the parts where being wrong is expensive and
		// invisible, and none of them need a dom
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
