# matcha

This project is a v5rc film analysis web app. Designed for easy scouting and yelling at your drivers about how they suck.

## conventions

- Use sveltekit remote functions instead of api routes, or +page.server.ts/+page.layout.ts load functions
- Prefer svelte 5 runes over any stores
- Put reusable UI in `src/lib/components`, and server-only code in `src/lib/server`.
- Use `@lucide/svelte` for icons.
- Use `fuse.js` for fuzzy searching.

## design guidelines

- All text rendered to end users inside the app UI has to be lowercase.
- **NEVER apply the UI lowercase style outside the rendered app UI.** Use normal capitalization for commit messages, pull request titles and descriptions, conversations with the developer, documentation, code comments, changelogs, issue text, and other developer-facing prose.
- Git commit subjects must use normal sentence capitalization and begin with a capital letter.
- Use shadcn-svelte components wherever you can put them.
- Design in a similar style to twitch.tv, with a v5 inspired twitch.
- Follow all colors from `src/routes/layout.css`, do not make up your own colors in this design, unless explicitly told to.
- Never use tabular-nums. It's so ugly.

## testing

Use the agent-browser skill to test your changes in this project.

- For preview environments, do not use the T3 Code MCP; use the agent-browser skill only.
