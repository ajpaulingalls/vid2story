import { AuthenticationError, OpenAI, PermissionDeniedError } from 'openai';
import config from '../config/config';
import fs from 'fs';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

const MAX_TRANSCRIPTION_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;
const CHUNK_DURATION_SECONDS = 45 * 60; // 45 minutes
const CHUNK_OVERLAP_SECONDS = 3 * 60; // 3 minutes
const SEGMENT_DEDUPE_TOLERANCE_SECONDS = 1;
const MAX_START_BOUNDARY_ADJUSTMENT_SECONDS = 0.2;
const MAX_END_BOUNDARY_ADJUSTMENT_SECONDS = 0.1;
const ZERO_DURATION_WORD_EPSILON = 1e-6;

const isEffectivelyZeroDuration = (word: TranscriptionWord): boolean => {
  const duration = Math.abs(getWordEndTime(word) - getWordStartTime(word));
  return duration <= ZERO_DURATION_WORD_EPSILON;
};

const startsAtSameMoment = (word: TranscriptionWord, time: number): boolean =>
  Math.abs(getWordStartTime(word) - time) <= ZERO_DURATION_WORD_EPSILON;

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

type TranscriptChunk = {
  words: TranscriptionWord[];
  start: number;
  end: number;
};

const getWordStartTime = (word: TranscriptionWord): number =>
  typeof word.start === 'number'
    ? word.start
    : typeof word.end === 'number'
      ? word.end
      : 0;

const getWordEndTime = (word: TranscriptionWord): number =>
  typeof word.end === 'number'
    ? word.end
    : typeof word.start === 'number'
      ? word.start
      : 0;

const buildTranscriptChunks = (
  words: TranscriptionWord[],
): TranscriptChunk[] => {
  if (!words.length) {
    return [];
  }

  const sortedWords = [...words].sort(
    (a, b) => getWordStartTime(a) - getWordStartTime(b),
  );

  const overallStart = getWordStartTime(sortedWords[0]);
  const overallEnd = getWordEndTime(sortedWords[sortedWords.length - 1]);
  const totalDuration = overallEnd - overallStart;

  if (totalDuration <= CHUNK_DURATION_SECONDS) {
    return [
      {
        words: sortedWords,
        start: overallStart,
        end: overallEnd,
      },
    ];
  }

  const chunks: TranscriptChunk[] = [];
  let windowStart = overallStart;

  while (windowStart < overallEnd) {
    const windowEnd = Math.min(
      windowStart + CHUNK_DURATION_SECONDS,
      overallEnd,
    );
    const chunkWords = sortedWords.filter(
      (word) =>
        getWordEndTime(word) > windowStart &&
        getWordStartTime(word) < windowEnd,
    );

    if (chunkWords.length > 0) {
      chunks.push({
        words: chunkWords,
        start: windowStart,
        end: getWordEndTime(chunkWords[chunkWords.length - 1]),
      });
    }

    if (windowEnd >= overallEnd) {
      break;
    }

    windowStart = windowEnd - CHUNK_OVERLAP_SECONDS;
  }

  return chunks;
};

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

const dedupeSegments = (
  segments: ViralPodcastSegments['segments'],
): ViralPodcastSegments['segments'] => {
  const uniqueSegments: ViralPodcastSegments['segments'] = [];

  for (const segment of segments) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start >= segment.end
    ) {
      continue;
    }

    const alreadyExists = uniqueSegments.some((existing) => {
      const startDelta = Math.abs(existing.start - segment.start);
      const endDelta = Math.abs(existing.end - segment.end);
      return (
        startDelta <= SEGMENT_DEDUPE_TOLERANCE_SECONDS &&
        endDelta <= SEGMENT_DEDUPE_TOLERANCE_SECONDS
      );
    });

    if (!alreadyExists) {
      uniqueSegments.push({
        ...segment,
        duration: segment.end - segment.start,
      });
    }
  }

  return uniqueSegments.sort((a, b) => a.start - b.start);
};

export const adjustSegmentsToWordBoundaries = (
  segments: ViralPodcastSegments['segments'],
  words: TranscriptionWord[],
): ViralPodcastSegments['segments'] => {
  if (!segments.length || !words.length) {
    return segments;
  }

  const findWordBefore = (time: number): TranscriptionWord | null => {
    const boundaryHasZeroDuration = words.some(
      (word) =>
        startsAtSameMoment(word, time) && isEffectivelyZeroDuration(word),
    );

    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i];
      const startTime = getWordStartTime(word);

      if (startTime < time) {
        if (startsAtSameMoment(word, time) && boundaryHasZeroDuration) {
          continue;
        }

        return word;
      }
    }
    return null;
  };

  const findWordAfter = (time: number): TranscriptionWord | null => {
    for (const word of words) {
      const startTime = getWordStartTime(word);
      if (startTime <= time + ZERO_DURATION_WORD_EPSILON) {
        continue;
      }
      if (isEffectivelyZeroDuration(word)) {
        continue;
      }
      return word;
    }
    return null;
  };

  return segments.map((segment) => {
    const wordBeforeStart = findWordBefore(segment.start);
    let newStart = segment.start;
    if (wordBeforeStart) {
      const wordStart = getWordStartTime(wordBeforeStart);
      const wordEnd = getWordEndTime(wordBeforeStart);

      // Check if segment starts within a word (between word.start and word.end)
      if (segment.start > wordStart && segment.start <= wordEnd) {
        // Segment starts in the middle of a word - adjust to word start
        const adjustmentNeeded = segment.start - wordStart;
        const adjustment = Math.min(
          adjustmentNeeded,
          MAX_START_BOUNDARY_ADJUSTMENT_SECONDS,
        );
        newStart = segment.start - adjustment;
      } else {
        // Segment starts after word ends - check for gap
        const gap = Math.max(0, segment.start - wordEnd);
        const adjustment = Math.min(gap, MAX_START_BOUNDARY_ADJUSTMENT_SECONDS);
        newStart = segment.start - adjustment;
      }
    }

    const wordAfterEnd = findWordAfter(segment.end);
    let newEnd = segment.end;
    if (wordAfterEnd) {
      const gap = Math.max(0, getWordStartTime(wordAfterEnd) - segment.end);
      const adjustment = Math.min(gap, MAX_END_BOUNDARY_ADJUSTMENT_SECONDS);
      newEnd = segment.end + adjustment;
    }

    return {
      ...segment,
      start: newStart,
      end: newEnd,
      duration: newEnd - newStart,
    };
  });
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
  const pickIndex = (ratio: number) =>
    Math.min(totalWords - 1, Math.max(0, Math.floor(totalWords * ratio)));
  const indices = Array.from(
    new Set([pickIndex(0.05), pickIndex(0.5), pickIndex(0.95)]),
  );

  const snippets: string[] = indices
    .map((center) => {
      const start = Math.max(0, center - Math.floor(windowSize / 2));
      const end = Math.min(totalWords, start + windowSize);
      return words
        .slice(start, end)
        .map((w) => w.word)
        .join(' ');
    })
    .filter(Boolean);

  let sampleText = snippets.join(' ... ').trim();
  if (!sampleText) {
    sampleText = words
      .slice(0, Math.min(totalWords, 50))
      .map((w) => w.word)
      .join(' ');
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
    const parsed = JSON.parse(response.choices[0].message.content || '{}') as {
      lang?: string;
    };
    const code = (parsed.lang || '').toLowerCase();
    if (/^[a-z]{2}$/.test(code)) return code;
  } catch (_) {
    // Ignore and fall back below
  }

  // Heuristic fallback if the model output is unavailable or malformed
  if (/[\u0600-\u06FF]/.test(sampleText)) return 'ar';
  return 'en';
};
