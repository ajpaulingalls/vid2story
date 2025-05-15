import { eq } from 'drizzle-orm';
import { db } from './database';
import { videos } from './schema';

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;

export const VideoModel = {
  async create(data: NewVideo): Promise<Video> {
    const result = await db.insert(videos).values(data).returning();
    return result[0];
  },

  async findById(id: string): Promise<Video | undefined> {
    const result = await db.select().from(videos).where(eq(videos.id, id));
    return result[0];
  },

  async findByJobId(jobId: string): Promise<Video[]> {
    return await db.select().from(videos).where(eq(videos.jobId, jobId));
  },

  async findAll(): Promise<Video[]> {
    return await db.select().from(videos);
  },

  async update(id: string, data: Partial<NewVideo>): Promise<Video | undefined> {
    const result = await db.update(videos)
      .set(data)
      .where(eq(videos.id, id))
      .returning();
    return result[0];
  },

  async delete(id: string): Promise<void> {
    await db.delete(videos).where(eq(videos.id, id));
  }
}; 