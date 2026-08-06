CREATE TABLE `match_clip` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`match_id` integer NOT NULL,
	`video_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`start_seconds` integer NOT NULL,
	`end_seconds` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	`deleted_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deleted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `match_clip_event_idx` ON `match_clip` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_clip_match_idx` ON `match_clip` (`match_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_clip_author_idx` ON `match_clip` (`user_id`,`created_at`);