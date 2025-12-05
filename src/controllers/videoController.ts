import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { JobModel } from '../models/job';
import { VideoModel } from '../models/video';
import { addCaptions, copyAudio } from '../utils/ffmpeg';
import { saveStringToFile } from '../utils/file';

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

export const updateVideoTranscript = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params;
    const { transcript } = req.body || {};

    if (!id) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const video = await VideoModel.findById(id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const job = await JobModel.findById(video.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Parent job not found' });
    }

    const updatedTranscript = transcript.trim();
    const outputDir = path.dirname(video.filePath);
    const transcriptPath = path.join(outputDir, `${video.publicId}-transcript.srt`);
    saveStringToFile(transcriptPath, updatedTranscript);

    const portraitVideoPath = path.join(outputDir, `${video.publicId}-portrait.mp4`);
    if (!fs.existsSync(portraitVideoPath)) {
      return res
        .status(409)
        .json({ error: 'Cropped video is not available for regeneration' });
    }

    const timestamp = Date.now();
    const captionVideoFilename = `${video.publicId}-captions-${timestamp}.mp4`;
    const finalVideoFilename = `${video.publicId}-final-${timestamp}.mp4`;
    const captionVideoPath = path.join(outputDir, captionVideoFilename);
    const finalVideoPath = path.join(outputDir, finalVideoFilename);

    await addCaptions(
      portraitVideoPath,
      transcriptPath,
      job.language || 'en',
      captionVideoPath,
    );

    await copyAudio(video.filePath, captionVideoPath, finalVideoPath);

    const baseUrlRoot = (process.env.BASE_URL || '').replace(/\/$/, '');
    const baseUrl = `${baseUrlRoot}/generated/${video.jobId}/`;

    const captionVideoUrl = `${baseUrl}${captionVideoFilename}`;
    const finalVideoUrl = `${baseUrl}${finalVideoFilename}`;

    const updatedVideo = await VideoModel.update(id, {
      transcript: updatedTranscript,
      captionVideoUrl,
      finalVideoUrl,
    });

    res.json({ video: updatedVideo });
  } catch (error) {
    next(error);
  }
};
