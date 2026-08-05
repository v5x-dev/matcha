CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automod_strike` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rule` text NOT NULL,
	`severity` integer NOT NULL,
	`body` text NOT NULL,
	`event_id` integer,
	`match_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `automod_strike_user_idx` ON `automod_strike` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cache_sync` (
	`key` text PRIMARY KEY NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `email_throttle` (
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_sent_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `address`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event` (
	`id` integer PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`start` text,
	`end` text,
	`season_id` integer NOT NULL,
	`program_id` integer NOT NULL,
	`level` text,
	`event_type` text,
	`location_venue` text DEFAULT '' NOT NULL,
	`location_city` text DEFAULT '' NOT NULL,
	`location_region` text DEFAULT '' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`ongoing` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`cached_at` integer NOT NULL,
	`listed_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_season_idx` ON `event` (`season_id`,`listed_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_search_idx` ON `event` (`season_id`,`start`,`id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_level_idx` ON `event` (`season_id`,`level`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_region_idx` ON `event` (`season_id`,`location_region`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_playback_offset` (
	`event_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`offset_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `video_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_video` (
	`event_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`data` text NOT NULL,
	`cached_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `video_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_video_event_idx` ON `event_video` (`event_id`,`cached_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_video_sync` (
	`event_id` integer PRIMARY KEY NOT NULL,
	`synced_at` integer NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`warnings` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `match` (
	`id` integer PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`division_id` integer NOT NULL,
	`round` integer NOT NULL,
	`instance` integer NOT NULL,
	`matchnum` integer NOT NULL,
	`name` text NOT NULL,
	`field` text,
	`scheduled` text,
	`started` text,
	`scored` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	`cached_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_event_idx` ON `match` (`event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `match_message` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`match_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`flagged_rule` text,
	`deleted_at` integer,
	`deleted_by` text,
	`deleted_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deleted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_message_match_idx` ON `match_message` (`match_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_message_author_idx` ON `match_message` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `match_playback_start` (
	`match_id` integer PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`start_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_playback_start_event_idx` ON `match_playback_start` (`event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `match_playback_window` (
	`match_id` integer PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`start_seconds` integer NOT NULL,
	`end_seconds` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `match_playback_window_event_idx` ON `match_playback_window` (`event_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message_report` (
	`message_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `reporter_id`),
	FOREIGN KEY (`message_id`) REFERENCES `match_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_report_status_idx` ON `message_report` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rate_limit_key_idx` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_block` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_sanction` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`issued_by` text,
	`expires_at` integer,
	`lifted_at` integer,
	`lifted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issued_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lifted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_sanction_user_idx` ON `user_sanction` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`);