import { eq, desc, count } from 'drizzle-orm';
import { db } from './database';
import { jobs, videos } from './schema';
import { Video } from './video';

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobWithVideos = Job & { videos: Video[] };

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const JobModel = {
  async create(data: NewJob): Promise<Job> {
    const result = await db.insert(jobs).values(data).returning();
    return result[0];
  },

  async findById(id: string): Promise<JobWithVideos | undefined> {
    const job = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!job[0]) return undefined;

    const jobVideos = await db.select().from(videos).where(eq(videos.jobId, id));
    return { ...job[0], videos: jobVideos };
  },

  async findAll(): Promise<Job[]> {
    return await db.select().from(jobs);
  },

  async findAllPaginated(params: PaginationParams): Promise<PaginatedResult<Job>> {
    const { page, limit } = params;
    const offset = (page - 1) * limit;

    // Get total count
    const totalResult = await db.select({ count: count(jobs.id) }).from(jobs);
    const total = totalResult[0]?.count || 0;

    // Get paginated jobs ordered by createdAt descending (newest first)
    const data = await db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async update(id: string, data: Partial<NewJob>): Promise<Job | undefined> {
    const result = await db.update(jobs)
      .set(data)
      .where(eq(jobs.id, id))
      .returning();
    return result[0];
  },

  async delete(id: string): Promise<void> {
    await db.delete(jobs).where(eq(jobs.id, id));
  }
};
