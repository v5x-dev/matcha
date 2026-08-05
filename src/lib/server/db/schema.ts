import type { EventData, MatchData } from 'events.vex';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { EventVideo } from '../youtube';

/**
 * better-auth core tables. The shapes are dictated by better-auth's drizzle adapter, so keep the
 * column names in sync with it rather than renaming them to match the rest of the schema.
 */
export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	/**
	 * Chat privilege level. Not a better-auth field: it is only read by our own moderation code, so
	 * it needs a default for the rows better-auth inserts on sign-up.
	 */
	role: text('role').$type<UserRole>().notNull().default('user'),
	/**
	 * The age screen answer, given once at sign-up. Sign-up refuses to proceed without a `true`, so
	 * every account created since the screen existed has one; the default covers the accounts that
	 * predate it and were never asked. `createdAt` is when the answer was given.
	 */
	overThirteen: integer('over_thirteen', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export type UserRole = 'user' | 'moderator' | 'admin';

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		token: text('token').notNull().unique(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('session_user_idx').on(t.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('account_user_idx').on(t.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

/**
 * better-auth's own rate limit counters, keyed by client ip and endpoint. Stored here rather than
 * in memory because the app runs on a serverless adapter: an in-process counter resets on every
 * cold start and does not add up across instances, which makes the limit decorative.
 *
 * Written and pruned entirely by better-auth. `id` is not part of its rate limit model, but its
 * adapter generates one for every create, so the column has to exist.
 */
export const rateLimit = sqliteTable(
	'rate_limit',
	{
		id: text('id').primaryKey(),
		key: text('key').notNull(),
		count: integer('count').notNull(),
		/** epoch milliseconds, written as a plain number rather than a timestamp by better-auth. */
		lastRequest: integer('last_request').notNull()
	},
	(t) => [index('rate_limit_key_idx').on(t.key)]
);

/**
 * Per-address cooldown for the mail we send to people who are not signed in: verification and
 * password reset. better-auth's rate limiting is keyed by ip, which stops one client hammering the
 * endpoint but does nothing about a pool of clients all pointed at the same inbox.
 */
export const emailThrottle = sqliteTable(
	'email_throttle',
	{
		kind: text('kind').$type<EmailKind>().notNull(),
		/** lowercased, so casing tricks do not buy a fresh allowance. */
		address: text('address').notNull(),
		/** start of the allowance window this row is counting. */
		windowStart: integer('window_start', { mode: 'timestamp_ms' }).notNull(),
		count: integer('count').notNull().default(0),
		lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.kind, t.address] })]
);

export type EmailKind = 'verification' | 'password-reset' | 'account-deletion';

/**
 * Chat for one match. `eventId` is denormalised off the match so the sidebar can read a match's
 * messages without joining, and so a stale match id can never leak another event's chat.
 */
export const matchMessage = sqliteTable(
	'match_message',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		eventId: integer('event_id').notNull(),
		matchId: integer('match_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		/** set when automod let the message through but wants a human to look at it. */
		flaggedRule: text('flagged_rule'),
		/** soft delete: the row stays so moderators can still see what was said and who said it. */
		deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
		/** null with `deletedAt` set means automod or the author's own account removal did it. */
		deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
		deletedReason: text('deleted_reason'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		index('match_message_match_idx').on(t.matchId, t.createdAt),
		// rate limiting counts a user's recent messages on every send, so it gets its own index
		index('match_message_author_idx').on(t.userId, t.createdAt)
	]
);

/** A mute or ban, issued by automod (`issuedBy` null) or by a moderator. */
export const userSanction = sqliteTable(
	'user_sanction',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind').$type<'mute' | 'ban'>().notNull(),
		reason: text('reason').notNull(),
		/** null means automod. */
		issuedBy: text('issued_by').references(() => user.id, { onDelete: 'set null' }),
		/** null means it never expires on its own and has to be lifted by hand. */
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
		liftedAt: integer('lifted_at', { mode: 'timestamp_ms' }),
		liftedBy: text('lifted_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('user_sanction_user_idx').on(t.userId, t.expiresAt)]
);

/** Every message automod refused, kept so repeat offences can escalate into a mute. */
export const automodStrike = sqliteTable(
	'automod_strike',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rule: text('rule').notNull(),
		severity: integer('severity').notNull(),
		/** the rejected text, so a moderator reviewing an auto-mute can see what triggered it. */
		body: text('body').notNull(),
		eventId: integer('event_id'),
		matchId: integer('match_id'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('automod_strike_user_idx').on(t.userId, t.createdAt)]
);

/** A viewer flagging a message for moderator attention. */
export const messageReport = sqliteTable(
	'message_report',
	{
		messageId: text('message_id')
			.notNull()
			.references(() => matchMessage.id, { onDelete: 'cascade' }),
		reporterId: text('reporter_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		reason: text('reason').$type<ReportReason>().notNull(),
		status: text('status').$type<'open' | 'actioned' | 'dismissed'>().notNull().default('open'),
		resolvedBy: text('resolved_by').references(() => user.id, { onDelete: 'set null' }),
		resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		// one report per person per message; reporting twice is not extra signal
		primaryKey({ columns: [t.messageId, t.reporterId] }),
		index('message_report_status_idx').on(t.status, t.createdAt)
	]
);

export type ReportReason = 'harassment' | 'hate' | 'spam' | 'sexual' | 'other';

/** A personal mute: `blockerId` stops seeing anything `blockedId` posts. */
export const userBlock = sqliteTable(
	'user_block',
	{
		blockerId: text('blocker_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		blockedId: text('blocked_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })]
);

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
