CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`file_path` text NOT NULL,
	`transcript` text NOT NULL,
	`words` text,
	`segments` text,
	`pick_segments` integer DEFAULT false NOT NULL,
	`optimize_for_accuracy` integer DEFAULT false NOT NULL,
	`keep_graphics` integer DEFAULT true NOT NULL,
	`use_stack_crop` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`created_at` integer DEFAULT '"2025-08-21T19:53:37.729Z"' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`public_id` text NOT NULL,
	`file_path` text NOT NULL,
	`clipped_video_url` text,
	`cropped_video_url` text,
	`caption_video_url` text,
	`final_video_url` text,
	`transcript` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`caption` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`created_at` integer DEFAULT '"2025-08-21T19:53:37.730Z"' NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
