import { OpenAI } from 'openai';
import config from '../config/config';
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
  console.log('Transcripting complete');

  return transcript.words;
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

export type ViralPodcastSegments = {
  segments: {
    title: string;
    summary: string;
    caption: string;
    start: number;
    end: number;
    duration: number;
  }[];
};

export const getBestSegmentsFromWords = async (
  words: TranscriptionWord[],
): Promise<ViralPodcastSegments> => {
  console.log('Generating segments...');
  const response = await openai.chat.completions.create({
    model: 'gpt-5',
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
                required: ['title', 'summary', 'caption', 'start', 'end', 'duration'],
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

  console.log('Generating segments complete');

  const result = JSON.parse(response.choices[0].message.content || '{}') as ViralPodcastSegments;
  
  // Helper function to find the word just before a given time
  const findWordBefore = (time: number): TranscriptionWord | null => {
    let lastWord: TranscriptionWord | null = null;
    for (const word of words) {
      if (word.start >= time) {
        break;
      }
      lastWord = word;
    }
    return lastWord;
  };

  // Helper function to find the word just after a given time
  const findWordAfter = (time: number): TranscriptionWord | null => {
    for (const word of words) {
      if (word.start > time) {
        return word;
      }
    }
    return null;
  };

  // Adjust timing using word boundaries
  result.segments = result.segments.map(segment => {
    // Find the word just before the start time and calculate the difference
    const wordBeforeStart = findWordBefore(segment.start);
    let newStart = segment.start;
    if (wordBeforeStart) {
      const wordBoundaryDifference = segment.start - wordBeforeStart.end;
      const maxAdjustment = 0.2; // Maximum 0.2 seconds adjustment
      const adjustment = Math.min(wordBoundaryDifference, maxAdjustment);
      newStart = segment.start - adjustment;
    }

    // Find the word just after the end time and calculate the difference
    const wordAfterEnd = findWordAfter(segment.end);
    let newEnd = segment.end;
    if (wordAfterEnd) {
      const wordBoundaryDifference = wordAfterEnd.start - segment.end;
      const maxAdjustment = 0.1; // Maximum 0.1 seconds adjustment
      const adjustment = Math.min(wordBoundaryDifference, maxAdjustment);
      newEnd = segment.end + adjustment;
    }

    return {
      ...segment,
      start: newStart,
      end: newEnd,
      duration: newEnd - newStart
    };
  });

  return result;
};

const DETECT_LANGUAGE_SYSTEM_PROMPT = `
You are a speech language detection engine. Given several short snippets formed by concatenating recognized words from a transcript, determine the primary spoken language.

Return JSON only, with a single key "lang" whose value is a valid ISO 639-1 two-letter lowercase language code (e.g., "en", "ar", "es", "fr", "de", "zh", "hi"). If unsure, choose the most likely language.`;

export const detectTranscriptLanguage = async (
  words: TranscriptionWord[],
): Promise<string> => {
  if (!words || words.length === 0) return 'en';

  const totalWords = words.length;

  // Build representative snippets from across the transcript
  const windowSize = Math.min(30, Math.max(5, Math.floor(totalWords * 0.05)));
  const pickIndex = (ratio: number) => Math.min(totalWords - 1, Math.max(0, Math.floor(totalWords * ratio)));
  const indices = Array.from(new Set([pickIndex(0.05), pickIndex(0.5), pickIndex(0.95)]));

  const snippets: string[] = indices
    .map((center) => {
      const start = Math.max(0, center - Math.floor(windowSize / 2));
      const end = Math.min(totalWords, start + windowSize);
      return words.slice(start, end).map((w) => w.word).join(' ');
    })
    .filter(Boolean);

  let sampleText = snippets.join(' ... ').trim();
  if (!sampleText) {
    sampleText = words.slice(0, Math.min(totalWords, 50)).map((w) => w.word).join(' ');
  }
  if (sampleText.length > 600) sampleText = sampleText.slice(0, 600);

  const response = await openai.chat.completions.create({
    model: 'gpt-5',
    messages: [
      { role: 'system', content: DETECT_LANGUAGE_SYSTEM_PROMPT },
      { role: 'user', content: sampleText },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'languageCode',
        description: 'Primary language code',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            lang: {
              type: 'string',
              description: 'ISO 639-1 two-letter lowercase language code',
              pattern: '^[a-z]{2}$',
            },
          },
          required: ['lang'],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const parsed = JSON.parse(response.choices[0].message.content || '{}') as { lang?: string };
    const code = (parsed.lang || '').toLowerCase();
    if (/^[a-z]{2}$/.test(code)) return code;
  } catch (_) {
    // Ignore and fall back below
  }

  // Heuristic fallback if the model output is unavailable or malformed
  if (/[\u0600-\u06FF]/.test(sampleText)) return 'ar';
  return 'en';
};
