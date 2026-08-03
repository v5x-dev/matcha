import type { EventData, MatchData } from 'events.vex';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { EventVideo } from '../youtube';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

/**
 * Cached robotevents events. Columns that we filter or sort on are lifted out of the payload, the
 * rest of the event is kept verbatim in `data` so reads can hand back a real `EventData`.
 */
export const event = sqliteTable(
	'event',
	{
		id: integer('id').primaryKey(),
		sku: text('sku').notNull(),
		name: text('name').notNull(),
		start: text('start'),
		end: text('end'),
		seasonId: integer('season_id').notNull(),
		programId: integer('program_id').notNull(),
		level: text('level').$type<EventData['level']>(),
		eventType: text('event_type').$type<EventData['event_type']>(),
		locationVenue: text('location_venue').notNull().default(''),
		locationCity: text('location_city').notNull().default(''),
		locationRegion: text('location_region').notNull().default(''),
		searchText: text('search_text').notNull().default(''),
		ongoing: integer('ongoing', { mode: 'boolean' }).notNull().default(false),
		data: text('data', { mode: 'json' }).$type<EventData>().notNull(),
		cachedAt: integer('cached_at', { mode: 'timestamp_ms' }).notNull(),
		/**
		 * when this event last showed up in the season listing. null for events we only know about
		 * because someone opened them directly — the listing search does not return `event_type`, so
		 * membership has to be recorded rather than inferred from the payload.
		 */
		listedAt: integer('listed_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('event_season_idx').on(t.seasonId, t.listedAt),
		index('event_search_idx').on(t.seasonId, t.start, t.id),
		index('event_level_idx').on(t.seasonId, t.level),
		index('event_region_idx').on(t.seasonId, t.locationRegion)
	]
);

/** Cached matches, scoped to the event they were fetched for. */
export const match = sqliteTable(
	'match',
	{
		id: integer('id').primaryKey(),
		eventId: integer('event_id').notNull(),
		divisionId: integer('division_id').notNull(),
		round: integer('round').notNull(),
		instance: integer('instance').notNull(),
		matchnum: integer('matchnum').notNull(),
		name: text('name').notNull(),
		field: text('field'),
		scheduled: text('scheduled'),
		started: text('started'),
		scored: integer('scored', { mode: 'boolean' }).notNull().default(false),
		data: text('data', { mode: 'json' }).$type<MatchData>().notNull(),
		cachedAt: integer('cached_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('match_event_idx').on(t.eventId)]
);

/** User-adjusted playback boundaries for a match in a specific event recording. */
export const matchPlaybackWindow = sqliteTable(
	'match_playback_window',
	{
		matchId: integer('match_id').primaryKey(),
		eventId: integer('event_id').notNull(),
		videoId: text('video_id').notNull(),
		startSeconds: integer('start_seconds').notNull(),
		endSeconds: integer('end_seconds').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('match_playback_window_event_idx').on(t.eventId)]
);

/** A manually chosen start that overrides the recording-wide calibration for one match only. */
export const matchPlaybackStart = sqliteTable(
	'match_playback_start',
	{
		matchId: integer('match_id').primaryKey(),
		eventId: integer('event_id').notNull(),
		videoId: text('video_id').notNull(),
		startSeconds: integer('start_seconds').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('match_playback_start_event_idx').on(t.eventId)]
);

/**
 * Correction applied to every match boundary inferred against one recording. Keyed by video rather
 * than by event: each stream day is encoded and uploaded separately, so the lag between the field
 * clock and the recording is a property of the recording, not of the event.
 */
export const eventPlaybackOffset = sqliteTable(
	'event_playback_offset',
	{
		eventId: integer('event_id').notNull(),
		videoId: text('video_id').notNull(),
		offsetSeconds: integer('offset_seconds').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.eventId, t.videoId] })]
);

/**
 * Freshness markers for cached collections, e.g. `events:season:197:tournament` or
 * `matches:event:12345`. Needed because an empty result is still a valid cached answer.
 */
export const cacheSync = sqliteTable('cache_sync', {
	key: text('key').primaryKey(),
	syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull()
});

/** Persisted discovery output. A sync row below makes an empty or partial result cacheable too. */
export const eventVideo = sqliteTable(
	'event_video',
	{
		eventId: integer('event_id').notNull(),
		videoId: text('video_id').notNull(),
		data: text('data', { mode: 'json' }).$type<EventVideo>().notNull(),
		cachedAt: integer('cached_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.eventId, t.videoId] }),
		index('event_video_event_idx').on(t.eventId, t.cachedAt)
	]
);

export const eventVideoSync = sqliteTable('event_video_sync', {
	eventId: integer('event_id').primaryKey(),
	syncedAt: integer('synced_at', { mode: 'timestamp_ms' }).notNull(),
	resultCount: integer('result_count').notNull().default(0),
	warnings: text('warnings', { mode: 'json' }).$type<string[]>().notNull().default([])
});
