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

	test: {
		// server-side rules only for now: these are the parts where being wrong is expensive and
		// invisible, and none of them need a dom
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
