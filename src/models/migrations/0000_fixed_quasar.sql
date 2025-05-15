CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`transcript` text NOT NULL,
	`segments` text,
	`pick_segments` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`created_at` integer DEFAULT '"2025-05-15T19:16:12.284Z"' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`public_id` text NOT NULL,
	`file_path` text NOT NULL,
	`video_url` text NOT NULL,
	`cropped_video_url` text NOT NULL,
	`pre_caption_video_url` text NOT NULL,
	`pre_caption_video_public_id` text NOT NULL,
	`caption_video_url` text NOT NULL,
	`transcript` text NOT NULL,
	`transcript_public_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` integer DEFAULT '"2025-05-15T19:16:12.284Z"' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
