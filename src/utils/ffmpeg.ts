import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import moment from 'moment';

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);

export const extractAudio = async (videoPath: string, outputPath: string) => {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .output(outputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioQuality(5) // 0-9, lower means better quality
      .on('end', () => {
        console.log('Audio extraction completed successfully\n');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error extracting audio:', err.message);
        reject(err);
      })
      .run();
  });
};

export const trimVideo = async (
  videoPath: string,
  outputPath: string,
  trimStart: string,
  trimStop: string,
) => {
  const duration = calculateDuration(trimStart, trimStop);
  return new Promise<string>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .setStartTime(trimStart)
      .setDuration(duration)
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (e) => {
        console.error('Error trimming audio file', e);
        reject(e);
      })
      .run();
  });
};

export const addCaptions = async (
  videoPath: string,
  srtPath: string,
  outputPath: string,
) => {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .input(srtPath)
      .outputOptions([
        '-vf',
        `subtitles=${srtPath}:force_style='FontName=Arial,FontSize=8,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=1,Alignment=2,MarginV=20'`
      ])
      .output(outputPath)
      .on('end', () => {
        console.log('Captions burned in successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error burning in captions:', err.message);
        reject(err);
      })
      .run();
  });
};

export const copyAudio = async (
  inputVideoPath: string,
  targetVideoPath: string,
  outputPath: string,
) => {
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(targetVideoPath) // Target video (to keep video stream)
      .input(inputVideoPath)  // Input video (to copy audio from)
      .outputOptions([
        '-map 0:v',           // Map video from first input (target video)
        '-map 1:a',           // Map audio from second input (input video)
        '-c:v copy',          // Copy video stream without recompressing
        '-c:a copy'           // Copy audio stream without recompressing
      ])
      .output(outputPath)
      .on('end', () => {
        console.log('Audio copy completed successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error copying audio:', err.message);
        reject(err);
      })
      .run();
  });
};

function calculateDuration(trimStart: string, trimStop: string): string {
  const start = moment.duration(trimStart);
  const stop = moment.duration(trimStop);
  const duration = stop.subtract(start);
  return moment.utc(duration.asMilliseconds()).format('HH:mm:ss.SSS');
}
