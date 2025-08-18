import { Request, Response, NextFunction } from 'express';
import { VideoModel } from '../models/video';

export const getVideoById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    const video = await VideoModel.findById(id);
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json(video);
  } catch (error) {
    next(error);
  }
};
