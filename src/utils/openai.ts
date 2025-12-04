import { AuthenticationError, OpenAI, PermissionDeniedError } from 'openai';
import config from '../config/config';
import fs from 'fs';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';
import {
  adjustSegmentsToWordBoundaries,
  buildTranscriptChunks,
  dedupeSegments,
} from './segment';
import type { ViralPodcastSegments } from './segment';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const MAX_TRANSCRIPTION_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

const sleep = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export const generateTranscriptJson = async (
  videoPath: string,
  language: string = 'en',
): Promise<TranscriptionWord[]> => {
  console.log('Transcripting audio...');

  for (let attempt = 0; attempt <= MAX_TRANSCRIPTION_RETRIES; attempt++) {
    try {
      const transcript = await openai.audio.transcriptions.create({
        file: fs.createReadStream(videoPath),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
        language,
      });

      console.log('Transcripting complete');
      return transcript.words ?? [];
    } catch (error) {
      const isPermissionError =
        error instanceof PermissionDeniedError ||
        error instanceof AuthenticationError;

      if (isPermissionError) {
        console.error('Transcripting failed due to permission error', error);
        throw error;
      }

      const finalAttempt = attempt === MAX_TRANSCRIPTION_RETRIES;
      console.warn(
        `Transcripting attempt ${attempt + 1} failed${
          finalAttempt ? '' : ', retrying with backoff...'
        }`,
        error,
      );

      if (finalAttempt) {
        throw error;
      }

      const backoffDelay = BASE_RETRY_DELAY_MS * 2 ** attempt;
      await sleep(backoffDelay);
    }
  }

  // Should not be reached, but keeps TypeScript satisfied.
  return [];
};

const SPLIT_TRANSCRIPT_SYSTEM_PROMPT = `
You are a podcast editor responsible for creating viral social media posts from a video transcript.
You are an expert at taking a json representation of a video transcript and using the transcript to identify the best short segments to become viral Youtube shorts.
* These segments should be the most engaging and interesting parts of the video, but still be short enough to be used in a social media post to platforms like TikTok, Instagram, and Youtube Shorts.  
* The segments should be complete thoughts or ideas, not just random phrases.  They should start at the beginning of a sentence and finish on a natural stopping point at the end of a sentence.
* They can be as short as 30 seconds, but should be no more than 180 seconds in duration.

To provide your best segments, generate json with entries like the following:
{ 
  "segments": [{
    "title":"title of the segment", 
    "summary": "a paragraph summary of the segment",
    "caption": "a caption for the segment appropriate for a social media post",
    "start": 52.520234, // start time in seconds
    "end": 192.923234, // end time in seconds
    "duration": 140.40334 // duration of the segment in seconds, less than 180 seconds
  }]
}

A video transcript will be given by the user and will be an array of TranscriptionWord objects that look like the following:
[{
  "word": "the", // the word in the transcript
  "start": 0.0, // start time of the word in seconds
  "end": 0.143245 // end time of the word in seconds
}]

Take it step by step.
1. First, combine all the words in the transcript into a series of sentences, adding punctuation as necessary.
2. Then, identify the three to five segments in the transcript that are the best short segments to make into viral social media posts for platforms like TikTok, Instagram, and Youtube Shorts.
3. Next, check which of the segments are not less than 30 seconds and NO MORE THAN 180 seconds in duration.
4. Then, for each segment that meets the criteria, create a title, summary, and caption.
5. Finally, return the json with the segments. Make sure the segment start is at the start time of the first word in the segment and the segment end is at the end time of the last word in the segment.
`;

const requestSegmentsForChunk = async (
  chunkWords: TranscriptionWord[],
  systemPrompt: string,
): Promise<ViralPodcastSegments['segments']> => {
  if (!chunkWords.length) {
    return [];
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(chunkWords) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'viralPodcastSegments',
        description:
          'The best 180 second or less duration segments in a video for use as Youtube shorts, each with a start and end time in seconds',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            segments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                  },
                  summary: {
                    type: 'string',
                  },
                  caption: {
                    type: 'string',
                  },
                  start: {
                    type: 'number',
                  },
                  end: {
                    type: 'number',
                  },
                  duration: {
                    type: 'number',
                  },
                },
                required: [
                  'title',
                  'summary',
                  'caption',
                  'start',
                  'end',
                  'duration',
                ],
                additionalProperties: false,
              },
            },
          },
          required: ['segments'],
          additionalProperties: false,
        },
      },
    },
  });

  const parsed = JSON.parse(
    response.choices[0].message.content || '{}',
  ) as ViralPodcastSegments;

  console.log('Segments for chunk:', parsed.segments);
  return parsed.segments ?? [];
};

export const getBestSegmentsFromWords = async (
  words: TranscriptionWord[],
  additionalInstructions?: string | null,
): Promise<ViralPodcastSegments> => {
  console.log('Generating segments...');

  if (!words || words.length === 0) {
    return { segments: [] };
  }

  // Build the system prompt with additional instructions if provided
  let systemPrompt = SPLIT_TRANSCRIPT_SYSTEM_PROMPT;
  if (additionalInstructions) {
    console.log(
      'Additional Instructions from the user for this segment selection:',
      additionalInstructions,
    );
    systemPrompt += `\nAdditional Instructions from the user for this segment selection: ${additionalInstructions}\nPlease pay close attention to these instructions as you generate the segments`;
  }

  const chunks = buildTranscriptChunks(words);
  const aggregatedSegments: ViralPodcastSegments['segments'] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunks.length > 1) {
      console.log(
        `Processing transcript chunk ${i + 1}/${chunks.length} (${chunk.words.length} words, ${Math.round(chunk.start)}s-${Math.round(chunk.end)}s)`,
      );
    }
    const chunkSegments = await requestSegmentsForChunk(
      chunk.words,
      systemPrompt,
    );
    aggregatedSegments.push(...chunkSegments);
  }

  const dedupedSegments = dedupeSegments(aggregatedSegments);
  const adjustedSegments = adjustSegmentsToWordBoundaries(
    dedupedSegments,
    words,
  );

  console.log('Generating segments complete');

  return { segments: adjustedSegments };
};
