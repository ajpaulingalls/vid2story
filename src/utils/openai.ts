import { OpenAI } from 'openai';
import config from '../config/config';
import { saveStringToFile } from './file';
import fs from 'fs';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

export const generateTranscriptJson = async (videoPath: string) => {
  console.log('Transcripting audio...');
  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(videoPath),
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  return transcript.words;
};

const SPLIT_TRANSCRIPT_SYSTEM_PROMPT = `
You are a podcast editor responsible for creating viral social media posts from a video transcript.
You are an expert at taking a json representation of a video transcript and using the transcript to identify the best short segments to become viral Youtube shorts.
* These segments should be the most engaging and interesting parts of the video, but still be short enough to be used in a social media post.  
*The segments should be complete thoughts or ideas, not just random phrases, and finish on a natural stopping point at the end of a sentence or thought.
* They can be as short as 30 seconds, but should be no more than 180 seconds in duration.

To provide your best segments, generate json with entries like the following:
{ 
  "segments": [{
    "title":"title of the segment", 
    "summary": "a paragraph summary of the segment", 
    "start": 52.520234, // start time in seconds
    "end": 192.923234, // end time in seconds
    "duration": 140.40334 // duration of the segment in seconds
  }]
}

A video transcript will be given by the user and will be an array of TranscriptionWord objects that look like the following:
[{
  "word": "the", // the word in the transcript
  "start": 0.0, // start time in seconds
  "end": 0.143245 // end time in seconds
}]

Take it step by step.
1. First, combine the transcript into a single series of sentences.
2. Then, identify the best segments in the transcript.
3. Next, check with segments are no less than 30 seconds and NO MORE THAN 180 seconds in duration.
4. Then, for each segment, create a title and summary.
5. Finally, return the json with the segments.
`;

export type ViralPodcastSegments = {
  segments: {
    title: string;
    summary: string;
    start: number;
    end: number;
    duration: number;
  }[];
};

export const getBestSegmentsFromWords = async (
  words: TranscriptionWord[],
): Promise<ViralPodcastSegments> => {
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: SPLIT_TRANSCRIPT_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(words) },
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
                required: ['title', 'summary', 'start', 'end', 'duration'],
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

  return JSON.parse(response.choices[0].message.content || '{}');
};
