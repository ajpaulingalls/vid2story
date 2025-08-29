import { ffmpegPath, ffprobePath } from 'ffmpeg-ffprobe-static';
import moment from 'moment';
import { spawn } from 'child_process';

/**
 * Extract audio from a video file using FFmpeg.
 * @param videoPath - Path to the input video file
 * @param outputPath - Path where the output audio file should be saved
 * @returns Promise<void> - Promise that resolves when the audio extraction is complete
 */
export const extractAudio = async (
  videoPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg path not found'));
      return;
    }

    const args = [
      '-i',
      videoPath,
      '-vn', // No video
      '-acodec',
      'libmp3lame',
      '-aq',
      '5', // Audio quality 0-9, lower means better quality
      outputPath,
    ];

    const ffmpegProcess = spawn(ffmpegPath, args);

    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        console.log('Audio extraction completed successfully\n');
        resolve();
      } else {
        reject(new Error(`FFmpeg process failed with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err: Error) => {
      console.error('Error extracting audio:', err.message);
      reject(err);
    });
  });
};

/**
 * Trim a video file using FFmpeg.
 * @param videoPath - Path to the input video file
 * @param outputPath - Path where the output trimmed video should be saved
 * @param trimStart - Start time of the trimmed video in HH:mm:ss.SSS format
 * @param trimStop - End time of the trimmed video in HH:mm:ss.SSS format
 * @param optimizeForAccuracy - Whether to optimize for accuracy
 * @returns Promise<string> - URL to the new trimmed video file
 */
export const trimVideo = async (
  videoPath: string,
  outputPath: string,
  trimStart: string,
  trimStop: string,
  optimizeForAccuracy: boolean,
): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg path not found'));
      return;
    }

    const duration = calculateDuration(trimStart, trimStop);

    const args = [
      '-i',
      videoPath,
      '-ss',
      trimStart,
      '-t',
      duration,
      ...(optimizeForAccuracy ? [] : ['-c', 'copy']),
      outputPath,
    ];

    const ffmpegProcess = spawn(ffmpegPath, args);

    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg process failed with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err: Error) => {
      console.error('Error trimming audio file', err);
      reject(err);
    });
  });
};

/**
 * Add captions to a video file using FFmpeg.
 * @param videoPath - Path to the input video file
 * @param srtPath - Path to the SRT file containing the captions
 * @param outputPath - Path where the output video file with captions should be saved
 * @returns Promise<void> - Promise that resolves when the captions are added
 */
export const addCaptions = async (
  videoPath: string,
  srtPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg path not found'));
      return;
    }

    console.log(`adding captions to ${videoPath} from ${srtPath} and saving to ${outputPath}`);

    const args = [
      '-i',
      videoPath,
      '-nostdin',
      '-y',
      '-vf',
      `"subtitles=${srtPath}:force_style='FontName=Arial,FontSize=8,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=1,Alignment=2,MarginV=20'"`,
      outputPath,
    ];

    const ffmpegProcess = spawn(ffmpegPath, args);

    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        console.log('Captions burned in successfully');
        resolve();
      } else {
        reject(new Error(`FFmpeg process failed with code ${code}`));
      }
    });

    ffmpegProcess.stdout.on('data', (data) => {
      console.log('ffmpegProcess stdout:', data.toString());
    });

    ffmpegProcess.stderr.on('data', (data) => {
      console.warn('ffmpegProcess stderr:', data.toString());
    });


    ffmpegProcess.on('error', (err: Error) => {
      console.error('Error burning in captions:', err.message);
      reject(err);
    });
  });
};

/**
 * Copy audio from one video file to another using FFmpeg.
 * @param inputVideoPath - Path to the input video file
 * @param targetVideoPath - Path to the target video file
 * @param outputPath - Path where the output video file with copied audio should be saved
 * @returns Promise<void> - Promise that resolves when the audio is copied
 */
export const copyAudio = async (
  inputVideoPath: string,
  targetVideoPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg path not found'));
      return;
    }

    const args = [
      '-i',
      targetVideoPath, // Target video (to keep video stream)
      '-i',
      inputVideoPath, // Input video (to copy audio from)
      '-map',
      '0:v', // Map video from first input (target video)
      '-map',
      '1:a', // Map audio from second input (input video)
      '-c:v',
      'copy', // Copy video stream without recompressing
      '-c:a',
      'copy', // Copy audio stream without recompressing
      outputPath,
    ];

    const ffmpegProcess = spawn(ffmpegPath, args);

    ffmpegProcess.on('close', (code: number) => {
      if (code === 0) {
        console.log('Audio copy completed successfully');
        resolve();
      } else {
        reject(new Error(`FFmpeg process failed with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err: Error) => {
      console.error('Error copying audio:', err.message);
      reject(err);
    });
  });
};

function calculateDuration(trimStart: string, trimStop: string): string {
  const start = moment.duration(trimStart);
  const stop = moment.duration(trimStop);
  const duration = stop.subtract(start);
  return moment.utc(duration.asMilliseconds()).format('HH:mm:ss.SSS');
}

export const getKeyframeTimes = async (filepath: string): Promise<string> => {
  return new Promise<string>((resolve, reject) => {
    if (!ffprobePath) {
      reject(new Error('FFprobe path not found'));
      return;
    }

    // Use ffprobe to get frame information
    const args = [
      '-v',
      'quiet',
      '-skip_frame',
      'nokey',
      '-select_streams',
      'v:0',
      '-show_frames',
      '-show_entries',
      'frame=pts_time,pict_type',
      '-of',
      'csv',
      filepath,
    ];

    const ffprobeProcess = spawn(ffprobePath, args);
    let output = '';
    let errorOutput = '';

    ffprobeProcess.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    ffprobeProcess.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    ffprobeProcess.on('close', (code: number) => {
      if (code !== 0) {
        reject(
          new Error(`FFprobe process failed with code ${code}: ${errorOutput}`),
        );
        return;
      }

      resolve(output);
    });

    ffprobeProcess.on('error', (processError: Error) => {
      reject(new Error(`FFprobe process error: ${processError.message}`));
    });
  });
};

/**
 * Calculate the closest keyframe time to a given time in seconds.
 * @param csvData - CSV data containing keyframe times
 * @param timeInSeconds - The time in seconds to find the closest keyframe to
 * @param before - Whether to find the closest keyframe before or after the given time
 * @returns Promise<string> - The closest keyframe time in HH:mm:ss.SSS format
 */
export const calculateClosestKeyframeTime = async (
  csvData: string,
  timeInSeconds: number,
  before: boolean,
): Promise<string> => {
  try {
    // Parse CSV output to extract keyframe times
    const lines = csvData.trim().split('\n');
    const keyframeTimes: number[] = [];

    // each line looks like this: frame,1149.600000,I
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const timeStr = parts[1];
        if (timeStr) {
          const time = parseFloat(timeStr);
          if (!isNaN(time)) {
            keyframeTimes.push(time);
          }
        }
      }
    }

    if (keyframeTimes.length === 0) {
      throw new Error('No keyframes found in video');
    }

    // Sort keyframe times
    keyframeTimes.sort((a, b) => a - b);

    let closestKeyframeTime: number;

    if (before) {
      // Find closest keyframe before or at target time
      closestKeyframeTime =
        keyframeTimes.filter((time) => time <= timeInSeconds).pop() ||
        keyframeTimes[0];
    } else {
      // Find closest keyframe after or at target time
      closestKeyframeTime =
        keyframeTimes.find((time) => time >= timeInSeconds) ||
        keyframeTimes[keyframeTimes.length - 1];
    }

    // Convert back to time string format
    return moment.utc(closestKeyframeTime * 1000).format('HH:mm:ss.SSS');
  } catch (parseError) {
    throw new Error(`Error parsing keyframe data: ${parseError}`);
  }
};
