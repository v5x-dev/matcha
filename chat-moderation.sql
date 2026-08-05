-- Chat moderation schema. Additive only: no existing column or row is touched.
--
-- `npm run db:push` is still the normal way to apply schema changes, but it needs an interactive
-- terminal, so this is the same set of statements for anywhere that does not have one (Turso's
-- shell, CI, a container). Safe to run once against an existing database.

ALTER TABLE `user` ADD `role` text DEFAULT 'user' NOT NULL;

ALTER TABLE `match_message` ADD `flagged_rule` text;
ALTER TABLE `match_message` ADD `deleted_at` integer;
ALTER TABLE `match_message` ADD `deleted_by` text REFERENCES `user`(`id`) ON DELETE SET NULL;
ALTER TABLE `match_message` ADD `deleted_reason` text;

CREATE INDEX `match_message_author_idx` ON `match_message` (`user_id`, `created_at`);

CREATE TABLE `user_sanction` (
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

CREATE INDEX `user_sanction_user_idx` ON `user_sanction` (`user_id`, `expires_at`);

CREATE TABLE `automod_strike` (
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

CREATE INDEX `automod_strike_user_idx` ON `automod_strike` (`user_id`, `created_at`);

CREATE TABLE `message_report` (
	`message_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`message_id`, `reporter_id`),
	FOREIGN KEY (`message_id`) REFERENCES `match_message`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `message_report_status_idx` ON `message_report` (`status`, `created_at`);

CREATE TABLE `user_block` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`blocker_id`, `blocked_id`),
	FOREIGN KEY (`blocker_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
