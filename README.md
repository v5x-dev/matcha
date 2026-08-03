# matcha

freshly brewed v5rc film analysis.

matcha helps teams turn tournament broadcasts into useful scouting clips. it pulls event and match data from vex, finds the event's youtube recordings, and lines the recording up with the official match schedule so you can jump straight to the match you want to watch.

it is built for easy scouting and yelling at your drivers about how they suck.

## what it does

- lists v5rc tournament events for the configured season
- searches and filters events by name, location, level, and timeframe
- shows an event's divisions, matches, scores, and participating teams
- discovers event recordings from vex event pages, vex webcasts, and youtube channels
- maps matches to the recording and opens each match at its inferred start time
- provides match navigation, play/pause, seeking, mute, and youtube controls
- lets scouts correct a recording-wide clock offset or save a match's end boundary
- stores event and match data in a local database cache, with stale-data fallback when an upstream request fails

## stack

- [sveltekit](https://svelte.dev/docs/kit) with svelte 5 runes and remote functions
- [vite](https://vite.dev/) and [tailwind css](https://tailwindcss.com/)
- [shadcn-svelte](https://www.shadcn-svelte.com/) and [lucide](https://lucide.dev/) icons
- [drizzle orm](https://orm.drizzle.team/) with sqlite/libsql
- [vex events](https://www.npmjs.com/package/events.vex) for event and match data
- [youtube data api](https://developers.google.com/youtube/v3) and [youtube player](https://www.npmjs.com/package/youtube-player) for film discovery and playback
- [fuse.js](https://www.fusejs.io/) for fuzzy event search

## getting started

### prerequisites

- [bun](https://bun.sh/)
- a vex events api token
- a youtube data api v3 key

### install

```sh
bun install
cp .env.example .env
```

Add the upstream credentials to `.env`:

```dotenv
VEX_EVENTS_TOKEN=your_vex_events_token
YOUTUBE_API_KEY=your_youtube_data_api_key
DATABASE_URL=file:local.db
```

`DATABASE_URL` defaults to a local sqlite database. libsql/turso URLs are also supported by the libsql client.

Initialize or update the local schema, then start the development server:

```sh
bun run db:push
bun run dev
```

Open [http://localhost:5173](http://localhost:5173).

## scouting workflow

1. Open **get started** to load the event index.
2. Search for an event or narrow the list with the filters.
3. Open an event and choose a match from the sidebar.
4. Matcha searches for recordings, selects the recording that covers the match, and starts playback at the inferred match boundary.
5. Use the previous/next controls to move through the event. Playback loops inside the selected match window.
6. If a broadcast clock is off, set a recording offset. If the inferred boundary needs refinement, set the match end. Both are saved in the database for future scouting sessions.

some matches do not have film, and some recordings are uploaded in separate stream-day segments. matcha keeps those cases separate rather than showing the wrong day's recording.

## scripts

| command               | purpose                                            |
| --------------------- | -------------------------------------------------- |
| `bun run dev`         | start the development server                       |
| `bun run build`       | create a production build                          |
| `bun run preview`     | preview the production build locally               |
| `bun run check`       | run svelte and typescript checks                   |
| `bun run lint`        | check prettier formatting and eslint               |
| `bun run format`      | format the repository                              |
| `bun run db:push`     | push the drizzle schema to the configured database |
| `bun run db:generate` | generate drizzle migrations                        |
| `bun run db:migrate`  | apply drizzle migrations                           |
| `bun run db:studio`   | open drizzle studio                                |

## project layout

```text
src/
├── routes/                 pages and server-side route loaders
│   └── (app)/events/       event index and match playback views
├── lib/components/         reusable ui and shadcn-svelte components
├── lib/remote/             sveltekit remote queries and commands
└── lib/server/             vex/youtube integrations and database cache
```

the app uses server-side remote functions and `+page.server.ts`/`+layout.server.ts` loaders for data access. upstream data is cached in sqlite/libsql and in memory; cache freshness varies by resource, with active-event matches refreshed more frequently than completed events.

## configuration notes

- the event index currently targets v5rc season `197` (`2025-2026`, push back) and tournament events.
- youtube discovery can take a few seconds because it reads vex webcast references and may search the youtube data api.
- youtube api quota is intentionally limited when expanding a referenced channel's uploads.
- there is no authentication layer yet; anyone with access to the running app can view and edit saved playback corrections.

## development conventions

reusable ui belongs in `src/lib/components`, server-only code belongs in `src/lib/server`, and new server interactions should use sveltekit remote functions or route loaders instead of api routes. the interface follows the project's lower-case copy and twitch-inspired v5 styling.
