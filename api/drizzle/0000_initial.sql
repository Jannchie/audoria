CREATE TABLE `music_import_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`song_name` text NOT NULL,
	`singers` text NOT NULL,
	`album` text NOT NULL,
	`ext` text NOT NULL,
	`file_size` text NOT NULL,
	`duration` text NOT NULL,
	`cover_url` text,
	`downloadable` integer NOT NULL,
	`song_info_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `music_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`song_name` text NOT NULL,
	`singers` text NOT NULL,
	`status` text NOT NULL,
	`song_info_json` text NOT NULL,
	`track_id` text,
	`error_message` text,
	`progress_bytes` integer,
	`total_bytes` integer,
	`progress_percent` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `playlist_tracks` (
	`playlist_id` text NOT NULL,
	`track_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `track_id`)
);
--> statement-breakpoint
CREATE INDEX `playlist_tracks_playlist_position_idx` ON `playlist_tracks` (`playlist_id`,`position`);--> statement-breakpoint
CREATE INDEX `playlist_tracks_track_idx` ON `playlist_tracks` (`track_id`);--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`storage_backend` text NOT NULL,
	`storage_key` text NOT NULL,
	`cover_storage_backend` text,
	`cover_storage_key` text,
	`cover_content_type` text,
	`cover_thumb_storage_backend` text,
	`cover_thumb_storage_key` text,
	`cover_thumb_content_type` text,
	`cover_thumbhash` text,
	`title` text,
	`artists` text,
	`album` text,
	`source` text,
	`source_identifier` text,
	`duration_text` text,
	`duration_seconds` integer,
	`size` integer NOT NULL,
	`content_type` text,
	`lyrics` text,
	`created_at` integer NOT NULL
);
