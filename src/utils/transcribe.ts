import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ffmpegPath } from 'ffmpeg-ffprobe-static';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';
import { generateTranscriptJson } from './openai';
import { getVideoDuration } from './ffmpeg';

const MAX_AUDIO_UPLOAD_BYTES = 24 * 1024 * 1024;
const SAFETY_BUFFER_BYTES = 512 * 1024; // 0.5 MB buffer to stay under limit

export const transcribeFile = async (
  audioPath: string,
  language: string = 'en',
): Promise<TranscriptionWord[]> => {
  const stats = await fs.promises.stat(audioPath);
  if (stats.size <= (MAX_AUDIO_UPLOAD_BYTES - SAFETY_BUFFER_BYTES)) {
    return (await generateTranscriptJson(audioPath, language)) ?? [];
  }

  return generateTranscriptJsonFromLargeFile(audioPath, language);
};

export const generateTranscriptJsonFromLargeFile = async (
  audioPath: string,
  language: string = 'en',
): Promise<TranscriptionWord[]> => {
  const stats = await fs.promises.stat(audioPath);
  const totalDuration = await getVideoDuration(audioPath);

  if (!Number.isFinite(totalDuration) || totalDuration <= 0) {
    throw new Error('Unable to determine audio duration for transcription chunking');
  }

  const chunkDurationSeconds = calculateChunkDurationSeconds(
    stats.size,
    totalDuration,
  );
  const chunksDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'vid2story-audio-chunks-'),
  );

  try {
    const chunkPaths = await splitAudioIntoChunks(
      audioPath,
      chunksDir,
      chunkDurationSeconds,
    );

    if (chunkPaths.length === 0) {
      throw new Error('Audio chunking did not produce any files');
    }

    const combinedWords: TranscriptionWord[] = [];
    let offsetSeconds = 0;

    for (const chunkPath of chunkPaths) {
      const chunkWords = (await generateTranscriptJson(chunkPath, language)) ?? [];
      const adjustedWords = chunkWords.map((word) => ({
        ...word,
        start: word.start + offsetSeconds,
        end: word.end + offsetSeconds,
      }));

      combinedWords.push(...adjustedWords);
      const chunkDuration = await getVideoDuration(chunkPath);
      if (Number.isFinite(chunkDuration)) {
        offsetSeconds += chunkDuration;
      }
    }

    return combinedWords;
  } finally {
    await fs.promises.rm(chunksDir, { recursive: true, force: true });
  }
};

const calculateChunkDurationSeconds = (
  fileSizeBytes: number,
  totalDurationSeconds: number,
): number => {
  const effectiveLimit = Math.max(
    1,
    MAX_AUDIO_UPLOAD_BYTES - SAFETY_BUFFER_BYTES,
  );
  const bytesPerSecond = fileSizeBytes / totalDurationSeconds;
  const rawDuration = effectiveLimit / Math.max(bytesPerSecond, 1);

  const duration = Math.floor(rawDuration);
  return Math.max(1, Math.min(duration || 1, totalDurationSeconds));
};

const splitAudioIntoChunks = async (
  audioPath: string,
  outputDir: string,
  chunkDurationSeconds: number,
): Promise<string[]> => {
  const ffmpegBinaryPath = ffmpegPath;
  if (!ffmpegBinaryPath) {
    throw new Error('FFmpeg path not found');
  }

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-i',
      audioPath,
      '-y',
      '-f',
      'segment',
      '-segment_time',
      chunkDurationSeconds.toFixed(2),
      '-c',
      'copy',
      path.join(outputDir, 'chunk_%03d.mp3'),
    ];

    const ffmpegProcess = spawn(ffmpegBinaryPath, args);

    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg chunking failed with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err: Error) => {
      reject(err);
    });
  });

  const files = await fs.promises.readdir(outputDir);
  return files
    .filter((file) => file.startsWith('chunk_'))
    .sort()
    .map((file) => path.join(outputDir, file));
};


