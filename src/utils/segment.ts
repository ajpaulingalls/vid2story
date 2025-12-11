import { TranscriptionWord } from 'openai/resources/audio/transcriptions';

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

const CHUNK_DURATION_SECONDS = 35 * 60; // 35 minutes
const CHUNK_OVERLAP_SECONDS = 3 * 60; // 3 minutes
const SEGMENT_DEDUPE_TOLERANCE_SECONDS = 1;
const MAX_START_BOUNDARY_ADJUSTMENT_SECONDS = 0.2;
const MAX_END_BOUNDARY_ADJUSTMENT_SECONDS = 0.1;
const ZERO_DURATION_WORD_EPSILON = 1e-6;

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

const isEffectivelyZeroDuration = (word: TranscriptionWord): boolean => {
  const duration = Math.abs(getWordEndTime(word) - getWordStartTime(word));
  return duration <= ZERO_DURATION_WORD_EPSILON;
};

const startsAtSameMoment = (word: TranscriptionWord, time: number): boolean =>
  Math.abs(getWordStartTime(word) - time) <= ZERO_DURATION_WORD_EPSILON;

export const buildTranscriptChunks = (
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

export const dedupeSegments = (
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

      // Segment starts within a word, so back up to the start of that word
      if (segment.start > wordStart && segment.start <= wordEnd) {
        const adjustmentNeeded = segment.start - wordStart;
        const adjustment = Math.min(
          adjustmentNeeded,
          MAX_START_BOUNDARY_ADJUSTMENT_SECONDS,
        );
        newStart = segment.start - adjustment;
      } else {
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

