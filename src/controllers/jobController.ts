import { Request, Response, NextFunction } from 'express';
import { JobModel } from '../models/job';

// Read all jobs
export const getJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jobs = await JobModel.findAll();
    res.json(jobs);
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
    res.json(job);
  } catch (error) {
    next(error);
  }
};
