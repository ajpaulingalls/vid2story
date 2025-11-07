import { JobModel } from '../src/models/job';

const statuses = [
  'starting',
  'extracting-audio',
  'generating-transcript',
  'detecting-language',
  'generating-segments',
  'clipping-segments',
  'cropping-segments',
  'cropping-full-video',
  'adding-captions',
  'completed',
  'failed',
] as const;

// Generate test jobs with different timestamps
async function seedJobs() {
  const now = Date.now();
  const jobsToCreate = 35; // Create 35 jobs to test pagination (more than 1 page with 20 per page)

  console.log(`Creating ${jobsToCreate} test jobs...`);

  for (let i = 0; i < jobsToCreate; i++) {
    // Create jobs with timestamps spread over the last 30 days
    // Most recent jobs will be at the end (so they appear first when sorted DESC)
    const daysAgo = Math.floor(i / 2); // Spread jobs over time
    const hoursOffset = i % 24; // Add some hour variation
    const createdAt = new Date(now - (daysAgo * 24 * 60 * 60 * 1000) - (hoursOffset * 60 * 60 * 1000));

    const job = await JobModel.create({
      name: `Test Job ${i + 1} - ${createdAt.toLocaleDateString()}`,
      filePath: `/uploads/test-video-${i + 1}.mp4`,
      originalVideoUrl: `/uploads/test-video-${i + 1}.mp4`,
      originalVideoDuration: 120.5 + i * 10,
      transcript: `This is a test transcript for job ${i + 1}. It contains some sample text to simulate a real transcript.`,
      language: 'en',
      pickSegments: i % 3 === 0, // Every third job picks segments
      optimizeForAccuracy: i % 4 === 0,
      keepGraphics: true,
      useStackCrop: true,
      prioritizeGraphics: i % 5 === 0,
      additionalInstructions: i % 2 === 0 ? `Additional instructions for job ${i + 1}` : null,
      status: statuses[i % statuses.length],
      createdAt: createdAt,
    });

    console.log(`Created job ${i + 1}/${jobsToCreate}: ${job.id} - ${job.name}`);
  }

  console.log(`\nSuccessfully created ${jobsToCreate} test jobs!`);
  console.log('Jobs are ordered by createdAt in reverse chronological order (newest first).');
}

// Run the seed function
seedJobs()
  .then(() => {
    console.log('Seeding completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error seeding jobs:', error);
    process.exit(1);
  });

