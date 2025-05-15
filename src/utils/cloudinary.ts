import { v2 as cloudinary } from 'cloudinary';
import config from '../config/config';

cloudinary.config({
  secure: true,
  cloud_name: config.cloudinaryApiName,
  api_key: config.cloudinaryApiKey,
  api_secret: config.cloudinaryApiSecret,
});


export async function uploadVideoToCloudinaryWithCrop(
  videoPath: string,
  publicId: string,
  videoId: string,
) {
  console.log('Uploading Video to Cloudinary...');
  const videoUploadResult = await cloudinary.uploader.upload(videoPath, {
    resource_type: 'video',
    upload_preset: 'test-preset',
    public_id: publicId,
    eager: [
      {
        aspect_ratio: '9:16',
        gravity: 'auto:faces',
        width: 320,
        crop: 'fill',
      },
    ],
    eager_async: true,
    eager_notification_url: process.env.BASE_URL + '/api/addCaptions?videoId=' + videoId,
  });
  console.log(
    `Video uploaded to Cloudinary: ${videoUploadResult.secure_url}\n`,
  );
  return videoUploadResult.secure_url;
}

export async function uploadVideoToCloudinaryForCaptions(
  videoPath: string,
  publicId: string,
  transcriptPublicId: string,
  videoId: string,
) {
  console.log('Uploading Video to Cloudinary...');
  const verticalUploadResult = await cloudinary.uploader.upload(
    videoPath,
    {
      resource_type: "video",
      upload_preset: "test-preset",
      public_id: publicId,
      eager: [
        {
          transformation: [
            {
              background: "#00000066",
              color: "orange",
              overlay: {
                font_family: "arial",
                font_size: 18,
                resource_type: "subtitles",
                public_id: transcriptPublicId,
              },
            },
            { flags: "layer_apply" },
          ],
        },
      ],
      eager_async: true,
      eager_notification_url: process.env.BASE_URL + '/api/captionsComplete?videoId=' + videoId,
    }
  );
  console.log(
    `Vertical video uploaded to Cloudinary: ${verticalUploadResult.secure_url}\n`
  );  
  return verticalUploadResult.secure_url;
}

export async function uploadTranscriptToCloudinary(
  transcriptFilePath: string,
  publicId: string,
) {
  console.log('Uploading transcript to Cloudinary...');
  const uploadResult = await cloudinary.uploader.upload(transcriptFilePath, {
    resource_type: 'raw',
    upload_preset: 'test-preset',
    public_id: publicId,
  });
  console.log(
    `Transcript uploaded to Cloudinary: ${uploadResult.secure_url}\n`,
  );
}

