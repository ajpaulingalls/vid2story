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

function calculateDuration(trimStart: string, trimStop: string): string {
  const start = moment.duration(trimStart);
  const stop = moment.duration(trimStop);
  const duration = stop.subtract(start);
  return moment.utc(duration.asMilliseconds()).format('HH:mm:ss.SSS');
}
