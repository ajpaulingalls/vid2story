import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { Job, NewJob, JobModel } from '../models/job';
import {
  generateTranscriptJson,
  getBestSegmentsFromWords,
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
import { Video, VideoModel } from '../models/video';
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
      runJob(job).then(() => {
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

const runJob = async (job: Job) => {
  const { filePath, pickSegments, id: jobId } = job;
  const baseUrl = `${process.env.BASE_URL}/generated/${jobId}/`;
  const outputDir = path.join(process.cwd(), 'public', 'generated', jobId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await JobModel.update(jobId, { status: 'generating-transcript' });

  // Extract audio from video
  const audioPath = path.join(outputDir, 'audio.mp3');
  await extractAudio(filePath, audioPath);

  // Generate transcript
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

  if (pickSegments) {
    await JobModel.update(jobId, { status: 'generating-segments' });

    const segments = await getBestSegmentsFromWords(words);
    console.log(segments);
    await JobModel.update(jobId, { segments, status: 'cropping-segments' });

    const keyframeTimes = await getKeyframeTimes(filePath);
    console.log(keyframeTimes);

    segments.segments.forEach(async (segment, index) => {
      const clipPublicId = `${jobId}-${index + 1}`;
      const videoSegmentPath = path.join(outputDir, `${clipPublicId}.mp4`);
      console.log(
        `trimming video segment ${segment.title} to ${videoSegmentPath} with id ${clipPublicId}`,
      );
      const segmentStart = await calculateClosestKeyframeTime(
        keyframeTimes,
        segment.start,
        true,
      );
      const segmentEnd = await calculateClosestKeyframeTime(
        keyframeTimes,
        segment.end,
        false,
      );
      await trimVideo(
        filePath,
        videoSegmentPath,
        segmentStart,
        segmentEnd,
      );

      const clippedTranscript: string = clipWordsToSRT(
        words,
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
        clippedVideoUrl: baseUrl + clipPublicId + '.mp4',
        transcript: clippedTranscript,
        title: segment.title,
        description: segment.summary,
        startTime: segmentStart,
        endTime: segmentEnd,
      });

      const portraitVideoFilename = `${clipPublicId}-portrait.mp4`;
      const portraitVideoPath = path.join(outputDir, portraitVideoFilename);
      cropLandscapeToPortrait(videoSegmentPath, portraitVideoPath)
        .then(async () => {
          console.log(`generated portrait video for ${clipPublicId}`);
          const croppedVideoUrl = baseUrl + portraitVideoFilename;
          await VideoModel.update(video.id, { croppedVideoUrl });
          await JobModel.update(video.jobId, { status: 'adding-captions' });

          const captionVideoFilename = `${clipPublicId}-captions.mp4`;
          const captionVideoPath = path.join(outputDir, captionVideoFilename);
          addCaptions(croppedVideoUrl, transcriptPath, captionVideoPath)
            .then(async () => {
              const captionVideoUrl = baseUrl + captionVideoFilename;
              await VideoModel.update(video.id, { captionVideoUrl });
              console.log(`added captions to ${clipPublicId}`);

              const finalVideoFilename = `${clipPublicId}-final.mp4`;
              const finalVideoPath = path.join(outputDir, finalVideoFilename);
              copyAudio(videoSegmentPath, captionVideoPath, finalVideoPath)
                .then(async () => {
                  const finalVideoUrl = baseUrl + finalVideoFilename;
                  await VideoModel.update(video.id, { finalVideoUrl });
                  console.log(`generated final video for ${clipPublicId}`);
                  await JobModel.update(video.jobId, { status: 'completed' });
                })
                .catch(async (error: any) => {
                  console.error(
                    `Error copying audio for ${clipPublicId}:`,
                    error,
                  );
                  await JobModel.update(video.jobId, { status: 'failed' });
                });
            })
            .catch(async (error: any) => {
              console.error(`Error adding captions to ${clipPublicId}:`, error);
              await JobModel.update(video.jobId, { status: 'failed' });
            });
        })
        .catch(async (error: any) => {
          console.error(
            `Error cropping video segment: ${JSON.stringify(error)}`,
          );
          await JobModel.update(video.jobId, { status: 'failed' });
        });
    });
  } else {
    await JobModel.update(jobId, { status: 'cropping-full-video' });
    const video = await VideoModel.create({
      jobId: jobId,
      filePath: filePath,
      publicId: jobId,
      transcript: transcript,
      title: 'Full Video',
      description: 'Full Video',
      startTime: '00:00:00',
      endTime: '00:00:00',
    });

    const portraitVideoFilename = `${jobId}-portrait.mp4`;
    const portraitVideoPath = path.join(outputDir, portraitVideoFilename);

    cropLandscapeToPortrait(filePath, portraitVideoPath).then(async () => {
      const croppedVideoUrl = baseUrl + portraitVideoFilename;
      await VideoModel.update(video.id, { croppedVideoUrl });
      console.log(`generated portrait video for ${jobId}`);

      const captionVideoFilename = `${jobId}-captions.mp4`;
      const captionVideoPath = path.join(outputDir, captionVideoFilename);
      addCaptions(croppedVideoUrl, transcriptPath, captionVideoPath).then(
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
