import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { Job, NewJob, JobModel } from '../models/job';
import {
  generateTranscriptJson,
  getBestSegmentsFromWords,
  detectTranscriptLanguage,
} from '../utils/openai';
import {
  addCaptions,
  calculateClosestKeyframeTime,
  copyAudio,
  extractAudio,
  getKeyframeTimes,
  trimVideo,
} from '../utils/ffmpeg';
import fs from 'fs';
import { clipWordsToSRT, formatSRTTime, wordsToSRT } from '../utils/transcript';
import { saveStringToFile } from '../utils/file';
import { VideoModel } from '../models/video';
import { cropLandscapeToPortrait } from '../utils/land2port';

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
    if (file.mimetype === 'video/mp4' || file.mimetype === 'video/webm') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 and WEBM files are allowed'));
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
        optimizeForAccuracy: req.body.optimizeForAccuracy === 'on',
        keepGraphics: req.body.keepGraphics === 'on',
        useStackCrop: req.body.useStackCrop === 'on',
        status: 'starting',
        createdAt: new Date(),
      };

      // Add job to the jobs array
      const job = await JobModel.create(newJob);
      runJob(job).then(() => {
        console.log('job completed');
      });

      // Redirect to the job status page
      console.log('redirecting to job status page');
      res.redirect(`/jobStatus.html?id=${job.id}`);
    } catch (error) {
      next(error);
    }
  });
};

const runJob = async (job: Job) => {
  const { filePath, pickSegments, id: jobId } = job;
  const baseUrl = `${process.env.BASE_URL}/generated/${jobId}/`;
  const outputDir = path.join(process.cwd(), 'public', 'generated', jobId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await JobModel.update(jobId, { status: 'extracting-audio' });

  // Extract audio from video
  const audioPath = path.join(outputDir, 'audio.mp3');
  await extractAudio(filePath, audioPath);

  // Generate transcript
  await JobModel.update(jobId, { status: 'generating-transcript' });
  const transcriptPath = path.join(outputDir, 'transcript.srt');
  const words = await generateTranscriptJson(audioPath);
  if (!words) {
    console.error('Failed to generate transcript');
    await JobModel.update(jobId, { status: 'failed' });
    return;
  }
  const transcript = wordsToSRT(words);
  await saveStringToFile(transcriptPath, transcript);
  await JobModel.update(jobId, { transcript, words });

  // Detect language
  await JobModel.update(jobId, { status: 'detecting-language' });
  const language = await detectTranscriptLanguage(words);
  await JobModel.update(jobId, { language });

  if (pickSegments) {
    await JobModel.update(jobId, { status: 'generating-segments' });

    const segments = await getBestSegmentsFromWords(words);
    console.log(segments);
    await JobModel.update(jobId, { segments, status: 'clipping-segments' });

    const keyframeTimes = job.optimizeForAccuracy
      ? ''
      : await getKeyframeTimes(filePath);

    const segmentPromises = segments.segments.map(async (segment, index) => {
      try {
        const clipPublicId = `${jobId}-${index + 1}`;
        const videoSegmentPath = path.join(outputDir, `${clipPublicId}.mp4`);
        console.log(
          `trimming video segment ${segment.title} to ${videoSegmentPath} with id ${clipPublicId}`,
        );

        const segmentStart = job.optimizeForAccuracy
          ? formatSRTTime(segment.start).replace(',', '.')
          : await calculateClosestKeyframeTime(
              keyframeTimes,
              segment.start,
              true,
            );
        const segmentEnd = job.optimizeForAccuracy
          ? formatSRTTime(segment.end).replace(',', '.')
          : await calculateClosestKeyframeTime(
              keyframeTimes,
              segment.end,
              false,
            );

        const video = await VideoModel.create({
          jobId: jobId,
          filePath: videoSegmentPath,
          publicId: clipPublicId,
          transcript: '',
          title: segment.title,
          description: segment.summary,
          caption: segment.caption,
          startTime: segmentStart,
          endTime: segmentEnd,
        });

        await trimVideo(
          filePath,
          videoSegmentPath,
          segmentStart,
          segmentEnd,
          job.optimizeForAccuracy,
        );

        const clippedTranscript: string = clipWordsToSRT(
          words,
          segmentStart,
          segmentEnd,
        );
        const transcriptPublicId = `${clipPublicId}-transcript.srt`;
        const segmentTranscriptPath = path.join(outputDir, transcriptPublicId);
        saveStringToFile(segmentTranscriptPath, clippedTranscript);

        await VideoModel.update(video.id, {
          transcript: clippedTranscript,
          clippedVideoUrl: baseUrl + clipPublicId + '.mp4',
        });

        await JobModel.update(jobId, { status: 'cropping-segments' });

        const portraitVideoFilename = `${clipPublicId}-portrait.mp4`;
        const portraitVideoPath = path.join(outputDir, portraitVideoFilename);
        await cropLandscapeToPortrait(
          videoSegmentPath,
          portraitVideoPath,
          job.keepGraphics,
          job.useStackCrop,
        );
        console.log(`generated portrait video for ${clipPublicId}`);
        const croppedVideoUrl = baseUrl + portraitVideoFilename;
        await VideoModel.update(video.id, { croppedVideoUrl });
        await JobModel.update(video.jobId, { status: 'adding-captions' });

        const captionVideoFilename = `${clipPublicId}-captions.mp4`;
        const captionVideoPath = path.join(outputDir, captionVideoFilename);
        await addCaptions(
          portraitVideoPath,
          segmentTranscriptPath,
          language,
          captionVideoPath,
        );
        const captionVideoUrl = baseUrl + captionVideoFilename;
        await VideoModel.update(video.id, { captionVideoUrl });
        console.log(`added captions to ${clipPublicId}`);

        const finalVideoFilename = `${clipPublicId}-final.mp4`;
        const finalVideoPath = path.join(outputDir, finalVideoFilename);
        await copyAudio(videoSegmentPath, captionVideoPath, finalVideoPath);
        const finalVideoUrl = baseUrl + finalVideoFilename;
        await VideoModel.update(video.id, { finalVideoUrl });
        console.log(`generated final video for ${clipPublicId}`);
      } catch (error) {
        console.error(`Error processing segment ${index + 1}:`, error);
        throw error;
      }
    });

    const results = await Promise.allSettled(segmentPromises);
    const hasFailure = results.some((r) => r.status === 'rejected');
    await JobModel.update(jobId, {
      status: hasFailure ? 'failed' : 'completed',
    });
  } else {
    await JobModel.update(jobId, { status: 'cropping-full-video' });
    const inputVideoPath = path.join(process.cwd(), filePath);
    const video = await VideoModel.create({
      jobId: jobId,
      filePath: inputVideoPath,
      publicId: jobId,
      transcript: transcript,
      title: 'Full Video',
      description: 'Full Video',
      caption: 'Full Video',
      startTime: '00:00:00',
      endTime: '00:00:00',
    });

    const portraitVideoFilename = `${jobId}-portrait.mp4`;
    const portraitVideoPath = path.join(outputDir, portraitVideoFilename);

    cropLandscapeToPortrait(
      inputVideoPath,
      portraitVideoPath,
      job.keepGraphics,
      job.useStackCrop,
    ).then(async () => {
      const croppedVideoUrl = baseUrl + portraitVideoFilename;
      await VideoModel.update(video.id, { croppedVideoUrl });
      console.log(`generated portrait video for ${jobId}`);

      const captionVideoFilename = `${jobId}-captions.mp4`;
      const captionVideoPath = path.join(outputDir, captionVideoFilename);
      addCaptions(portraitVideoPath, transcriptPath, language, captionVideoPath).then(
        async () => {
          const captionVideoUrl = baseUrl + captionVideoFilename;
          await VideoModel.update(video.id, { captionVideoUrl });
          console.log(`added captions to ${jobId}`);

          const finalVideoFilename = `${jobId}-final.mp4`;
          const finalVideoPath = path.join(outputDir, finalVideoFilename);
          copyAudio(filePath, captionVideoPath, finalVideoPath).then(
            async () => {
              const finalVideoUrl = baseUrl + finalVideoFilename;
              await VideoModel.update(video.id, { finalVideoUrl });
              console.log(`generated final video for ${jobId}`);
              await JobModel.update(video.jobId, { status: 'completed' });
            },
            async (error: any) => {
              console.error(`Error copying audio for ${jobId}:`, error);
              await JobModel.update(video.jobId, { status: 'failed' });
            },
          );
        },
        async (error: any) => {
          console.error(`Error adding captions to ${jobId}:`, error);
          await JobModel.update(video.jobId, { status: 'failed' });
        },
      );
    });
  }
};
