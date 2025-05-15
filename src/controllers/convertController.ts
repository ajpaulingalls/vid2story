import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { Job, NewJob, JobModel } from '../models/job';
import {
  uploadTranscriptToCloudinary,
  uploadVideoToCloudinaryForCaptions,
  uploadVideoToCloudinaryWithCrop as uploadVideoToCloudinaryForCrop,
} from '../utils/cloudinary';
import {
  generateTranscriptJson,
  getBestSegmentsFromWords,
} from '../utils/openai';
import { extractAudio, trimVideo } from '../utils/ffmpeg';
import fs from 'fs';
import { clipTranscript, formatSRTTime, wordsToSRT } from '../utils/transcript';
import { saveStringToFile, downloadVideo } from '../utils/file';
import { Video, VideoModel } from '../models/video';

// Configure multer for video upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 files are allowed'));
    }
  },
  limits: {
    fileSize: 10000 * 1024 * 1024, // 10GB limit
  },
}).single('video');

export const convertToPortrait = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  upload(req, res, async (err) => {
    if (err) {
      return next(err);
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    try {
      // Create a new job
      const newJob: NewJob = {
        name: req.file.originalname,
        filePath: req.file.path,
        transcript: '',
        pickSegments: req.body.pickSegments === 'on',
        status: 'starting',
        createdAt: new Date(),
      };

      // Add job to the jobs array
      const job = await JobModel.create(newJob);
      startJob(job).then(() => {
        console.log('job started');
      });

      // Redirect to the job status page
      console.log('redirecting to job status page');
      res.redirect(`/jobStatus.html?id=${job.id}`);
    } catch (error) {
      next(error);
    }
  });
};

export async function addCaptions(req: Request, res: Response) {
  console.log('addCaptions', req.body);
  try {
    const videoId = req.query.videoId as string;
    let video = await VideoModel.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const { eager } = req.body;
    const croppedVideoUrl = eager[0].secure_url;
    video = await VideoModel.update(video.id, { croppedVideoUrl });
    if (!video) {
      return res.status(404).json({ error: 'Unable to update video' });
    }
    addCaptionsToVideo(video).then(() => {
      console.log('captions submitted for processing for video', video.title);
    });

    res.json({ message: 'Captions added' });
  } catch (error: any) {
    res
      .status(500)
      .json({ error: 'Failed to add captions', details: error.message });
  }
}

export async function captionsComplete(req: Request, res: Response) {
  console.log('captionsComplete', req.body);
  const videoId = req.query.videoId as string;
  const video = await VideoModel.findById(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });  
  }
  const { eager } = req.body;
  const captionVideoUrl = eager[0].secure_url;
  await VideoModel.update(video.id, { captionVideoUrl });

  console.log('completed video', video.title, captionVideoUrl);

  await JobModel.update(video.jobId, { status: 'completed' });
  res.json({ message: 'complete' });
}

const startJob = async (job: Job) => {
  const { filePath, pickSegments, id: jobId } = job;
  const outputDir = path.join(process.cwd(), 'public', 'generated', jobId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await JobModel.update(jobId, { status: 'generating-transcript' });

  // Extract audio from video
  const audioPath = path.join(outputDir, 'audio.mp3');
  await extractAudio(filePath, audioPath);

  // // Generate transcript
  const transcriptPath = path.join(outputDir, 'transcript.srt');
  const words = await generateTranscriptJson(audioPath);
  if (!words) {
    console.error('Failed to generate transcript');
    await JobModel.update(jobId, { status: 'failed' });
    return;
  }
  const transcript = wordsToSRT(words);
  await saveStringToFile(transcriptPath, transcript);
  await JobModel.update(jobId, { transcript });


  if (pickSegments) {
    await JobModel.update(jobId, { status: 'generating-segments' });

    const segments = await getBestSegmentsFromWords(words);
    console.log(segments);
    await JobModel.update(jobId, { segments, status: 'uploading-segments' });

    segments.segments.forEach(async (segment, index) => {
      const clipPublicId = `${jobId}-${index + 1}`;
      const videoSegmentPath = path.join(outputDir, `${clipPublicId}.mp4`);
      console.log(
        `trimming video segment ${segment.title} to ${videoSegmentPath} with id ${clipPublicId}`,
      );
      const segmentStart = formatSRTTime(segment.start).replace(',', '.');
      const segmentEnd = formatSRTTime(segment.end).replace(',', '.');
      await trimVideo(filePath, videoSegmentPath, segmentStart, segmentEnd);

      const clippedTranscript: string = clipTranscript(
        transcript,
        segmentStart,
        segmentEnd,
      );
      const transcriptPublicId = `${clipPublicId}-transcript.srt`;
      const transcriptPath = path.join(outputDir, transcriptPublicId);
      saveStringToFile(transcriptPath, clippedTranscript);

      const video = await VideoModel.create({
        jobId: jobId,
        filePath: videoSegmentPath,
        publicId: clipPublicId,
        videoUrl: '',
        croppedVideoUrl: '',
        preCaptionVideoUrl: '',
        preCaptionVideoPublicId: '',
        captionVideoUrl: '',
        transcript: clippedTranscript,
        transcriptPublicId,
        title: segment.title,
        description: segment.summary,
        startTime: segmentStart,
        endTime: segmentEnd,
      });

      try {
        const videoUrl = await uploadVideoToCloudinaryForCrop(
          videoSegmentPath,
          clipPublicId,
          video.id,
        );
        await VideoModel.update(video.id, { videoUrl });
        console.log(`uploaded video segment ${clipPublicId}`);
      } catch (error: any) {
        console.error(
          `Error uploading video segment: ${JSON.stringify(error)}`,
        );
      }

      try {
        await uploadTranscriptToCloudinary(transcriptPath, transcriptPublicId);
        console.log(`uploaded transcript`);
      } catch (error: any) {
        console.error(`Error uploading transcript: ${JSON.stringify(error)}`);
      }
      await JobModel.update(jobId, { status: 'waiting-for-cloudinary' });
    });
  } else {
    await JobModel.update(jobId, { status: 'uploading-full-video' });
    const transcriptPublicId = `${jobId}-transcript.srt`;
    const transcriptPath = path.join(outputDir, transcriptPublicId);
    const video = await VideoModel.create({
      jobId: jobId,
      filePath: filePath,
      publicId: jobId,
      videoUrl: '',
      croppedVideoUrl: '',
      preCaptionVideoUrl: '',
      preCaptionVideoPublicId: '',
      captionVideoUrl: '',
      transcript: transcript,
      transcriptPublicId,
      title: 'Full Video',
      description: 'Full Video',
      startTime: '00:00:00',
      endTime: '00:00:00',
    });

    // Upload video to Cloudinary
    const videoUrl = await uploadVideoToCloudinaryForCrop(filePath, jobId, video.id);
    await VideoModel.update(video.id, { videoUrl });
    saveStringToFile(transcriptPath, transcript);
    await uploadTranscriptToCloudinary(transcriptPath, transcriptPublicId);
    await JobModel.update(jobId, { status: 'waiting-for-cloudinary' });
  }
};

async function addCaptionsToVideo(video: Video) {
  const outputDir = path.join(
    process.cwd(),
    'public',
    'generated',
    video.jobId,
    video.publicId,
  );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await JobModel.update(video.jobId, { status: 'downloading-portrait-video' });

  const videoPath = path.join(outputDir, 'portrait.mp4');
  await downloadVideo(video.croppedVideoUrl, videoPath);

  const preCaptionVideoPublicId = `${video.publicId}-captions`;
  const preCaptionVideoUrl = await uploadVideoToCloudinaryForCaptions(
    videoPath,
    preCaptionVideoPublicId,
    video.transcriptPublicId,
    video.id, 
  );

  await VideoModel.update(video.id, { preCaptionVideoUrl, preCaptionVideoPublicId });
  await JobModel.update(video.jobId, { status: 'waiting-for-cloudinary' });
}
