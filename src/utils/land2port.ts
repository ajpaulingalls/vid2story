import { spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';

/**
 * Crop a landscape video to a portrait video using the land2port tool.
 * @param videoSegmentPath - Path to the input landscape video file
 * @param outputPath - Path where the output portrait video should be saved
 * @param keepGraphics - Whether to keep graphics
 * @param useStackCrop - Whether to use stack crop
 * @param prioritizeGraphics - Whether to prioritize graphics
 * @returns Promise<string> - URL to the new cropped video file
 */
export const cropLandscapeToPortrait = (
  videoSegmentPath: string,
  outputPath: string,
  keepGraphics: boolean,
  useStackCrop: boolean,
  prioritizeGraphics: boolean,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Get the land2port executable path from environment variable
    const land2portPath = process.env.LAND2PORT_PATH;
    const land2portDevice = process.env.LAND2PORT_DEVICE;

    if (!land2portPath || !land2portDevice) {
      reject(
        new Error(
          'LAND2PORT_PATH or LAND2PORT_DEVICE environment variable is not set',
        ),
      );
      return;
    }

    const args = [
      'run',
      '--release',
      '--',
      '--device',
      land2portDevice,
      ...(keepGraphics ? ['--keep-graphic'] : []),
      ...(useStackCrop ? ['--use-stack-crop'] : []),
      ...(prioritizeGraphics ? ['--prioritize-graphic'] : []),
      '--object-area-threshold',
      '0.009',
      '--headless',
      '--source',
      videoSegmentPath,
      '--output-filepath',
      outputPath,
    ];

    // Spawn the land2port process
    const land2portProcess = spawn('cargo', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: land2portPath,
    });

    land2portProcess.stdout.on('data', (data) => {
      console.log('land2port stdout:', data.toString());
    });

    land2portProcess.stderr.on('data', (data) => {
      console.warn('land2port stderr:', data.toString());
    });

    land2portProcess.on('close', (code) => {
      if (code === 0) {
        // Check if the output file was created successfully
        const fs = require('fs');
        if (fs.existsSync(outputPath)) {
          resolve();
        } else {
          reject(new Error(`Output file was not created at: ${outputPath}`));
        }
      } else {
        reject(new Error(`land2port process exited with code ${code}`));
      }
    });

    land2portProcess.on('error', (error) => {
      reject(new Error(`Failed to start land2port process: ${error.message}`));
    });
  });
};
