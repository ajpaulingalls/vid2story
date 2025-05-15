import fs from 'fs';
import https from 'https';
import path from 'path';
import { IncomingMessage } from 'http';

export const saveStringToFile = (filePath: string, content: string) => {
  fs.writeFileSync(filePath, content);
};

export async function downloadVideo(
  videoUrl: string,
  videoPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading MP4 to ${videoPath}...`);
    const file = fs.createWriteStream(videoPath);

    https
      .get(videoUrl, (response: IncomingMessage) => {
        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('MP4 download completed\n');
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(videoPath, () => {});
          reject(err);
        });
      })
      .on('error', (err: Error) => {
        fs.unlink(videoPath, () => {}); // Delete the file if download fails
        console.error('Error downloading MP4:', err.message);
        reject(err);
      });
  });
}
