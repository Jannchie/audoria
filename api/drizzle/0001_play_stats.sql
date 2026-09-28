CREATE TABLE `play_events` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`listened_seconds` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`counted` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`end_reason` text
);
--> statement-breakpoint
CREATE INDEX `play_events_track_idx` ON `play_events` (`track_id`);--> statement-breakpoint
CREATE INDEX `play_events_started_at_idx` ON `play_events` (`started_at`);--> statement-breakpoint
ALTER TABLE `tracks` ADD `sort_order` integer;--> statement-breakpoint
ALTER TABLE `tracks` ADD `play_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `skip_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `listened_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tracks` ADD `last_played_at` integer;