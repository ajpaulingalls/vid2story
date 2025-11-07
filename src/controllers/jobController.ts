import { Request, Response, NextFunction } from 'express';
import { JobModel } from '../models/job';

// Read all jobs with pagination
export const getJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    // Validate pagination parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Limit max to 100 per page

    const result = await JobModel.findAllPaginated({
      page: validPage,
      limit: validLimit,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Read single job
export const getJobById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id;
    const job = await JobModel.findById(id);
    if (!job) {
      res.status(404).json({ message: 'Job not found' });
      return;
    }

    const videos = Array.isArray(job.videos) ? job.videos : [];

    const deriveVideoStatus = (v: any): string => {
      if (v.finalVideoUrl) return 'finalized';
      if (v.captionVideoUrl) return 'captioned';
      if (v.croppedVideoUrl) return 'cropped';
      if (v.clippedVideoUrl) return 'clipped';
      return 'pending';
    };

    const enrichedVideos = videos.map((v) => ({ ...v, status: deriveVideoStatus(v) }));

    const totalFromSegments = (job as any).segments && (job as any).segments.segments ? (job as any).segments.segments.length : 0;
    const total = job.pickSegments ? (totalFromSegments || enrichedVideos.length) : 1;
    const clipped = enrichedVideos.filter(v => v.status === 'clipped' || v.status === 'cropped' || v.status === 'captioned' || v.status === 'finalized').length;
    const cropped = enrichedVideos.filter(v => v.status === 'cropped' || v.status === 'captioned' || v.status === 'finalized').length;
    const captioned = enrichedVideos.filter(v => v.status === 'captioned' || v.status === 'finalized').length;
    const finalized = enrichedVideos.filter(v => v.status === 'finalized').length;

    const responseBody = {
      ...job,
      videos: enrichedVideos,
      progress: { total, clipped, cropped, captioned, finalized },
    };

    res.json(responseBody);
  } catch (error) {
    next(error);
  }
};
