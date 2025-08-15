import { relations } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { ViralPodcastSegments } from '../utils/openai';
import { createId } from '@paralleldrive/cuid2';

export const jobs = sqliteTable('jobs', {
  id: text('id')
    .$defaultFn(() => createId())
    .primaryKey(),
  name: text('name').notNull(),
  filePath: text('file_path').notNull(),
  transcript: text('transcript').notNull(),
  segments: text('segments', { mode: 'json' }).$type<ViralPodcastSegments>(),
  pickSegments: integer('pick_segments', { mode: 'boolean' })
    .notNull()
    .default(false),
  status: text('status', {
    enum: [
      'starting',
      'cropping-portrait-video',
      'generating-transcript',
      'generating-segments',
      'cropping-segments',
      'cropping-full-video',
      'adding-captions',
      'completed',
      'failed',
    ],
  })
    .notNull()
    .default('starting'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(new Date()),
});

export const jobRelations = relations(jobs, ({ many }) => ({
  videos: many(videos),
}));

export const videos = sqliteTable('videos', {
  id: text('id')
    .$defaultFn(() => createId())
    .primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id),
  publicId: text('public_id').notNull(),
  filePath: text('file_path').notNull(),
  clippedVideoUrl: text('clipped_video_url'),
  croppedVideoUrl: text('cropped_video_url'),
  captionVideoUrl: text('caption_video_url'),
  finalVideoUrl: text('final_video_url'),
  transcript: text('transcript').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(new Date()),
});

export const videoRelations = relations(videos, ({ one }) => ({
  job: one(jobs, {
    fields: [videos.jobId],
    references: [jobs.id],
  }),
}));
