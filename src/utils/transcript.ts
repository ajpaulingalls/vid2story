import moment from 'moment';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';

interface SRTEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

/**
 * Parses an SRT string into an array of entries
 */
function parseSRT(srt: string): SRTEntry[] {
  const entries: SRTEntry[] = [];
  const blocks = srt.trim().split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0]);
    const [startTime, endTime] = lines[1].split(' --> ');
    const text = lines.slice(2).join('\n');

    entries.push({
      index,
      startTime,
      endTime,
      text,
    });
  }

  return entries;
}

/**
 * Converts an array of SRT entries back to SRT format
 */
function entriesToSRT(entries: SRTEntry[]): string {
  return entries
    .map((entry, index) => {
      return `${index + 1}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`;
    })
    .join('\n\n');
}


/**
 * Formats a time in seconds to SRT format (HH:mm:ss,SSS)
 */
export function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Converts an array of TranscriptionWord objects into SRT format
 * @param words Array of Word objects with start/end times in seconds
 * @returns SRT formatted string
 */
export function wordsToSRT(words: TranscriptionWord[]): string {
  if (words.length === 0) return '';

  const MAX_DURATION = 4.0;
  const PAUSE_THRESHOLD = 0.5;
  const captions: { text: string; start: number; end: number }[] = [];
  let currentCaptionWords: TranscriptionWord[] = [];
  let captionStart = words[0].start;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = words[i + 1];
    const pause = nextWord ? nextWord.start - word.end : 0;

    if (pause > PAUSE_THRESHOLD) {
      currentCaptionWords.push(word);
      captions.push({
        text: currentCaptionWords.map((w) => w.word).join(' '),
        start: captionStart,
        end: word.end,
      });
      currentCaptionWords = [];
      captionStart = nextWord.start;
    } else if (word.start - captionStart > MAX_DURATION) {
      captions.push({
        text: currentCaptionWords.map((w) => w.word).join(' '),
        start: captionStart,
        end: words[i - 1] ? words[i - 1].end : captionStart,
      });
      currentCaptionWords = [word];
      captionStart = word.start;
    } else {
      currentCaptionWords.push(word);
    }
  }
  captions.push({
    text: currentCaptionWords.map((w) => w.word).join(' '),
    start: captionStart,
    end: words[words.length - 1].end,
  });

  return captions
    .map((caption, idx) => {
      const startTime = formatSRTTime(caption.start);
      const endTime = formatSRTTime(caption.end);
      return `${idx + 1}\n${startTime} --> ${endTime}\n${caption.text}`;
    })
    .join('\n\n');
}

/**
 * Clips words to a specified time range and converts them to SRT format starting at 0
 * @param words Array of Word objects with start/end times in seconds
 * @param startTime Start time in format "HH:mm:ss.SSS"
 * @param endTime End time in format "HH:mm:ss.SSS"
 * @returns SRT formatted string for the clipped words
 */
export function clipWordsToSRT(
  words: TranscriptionWord[],
  startTime: string,
  endTime: string,
): string {
  if (words.length === 0) return '';

  // Convert times to seconds for easier comparison
  const startSeconds = moment.duration(startTime).asSeconds();
  const endSeconds = moment.duration(endTime).asSeconds();

  // Filter words that overlap the time range
  // Include words that start exactly at startSeconds or end exactly at endSeconds (even with zero duration)
  // Use a small epsilon for floating point comparison
  const EPSILON = 0.0001;
  const clippedWords = words
    .filter((word) => {
      const startsAtBoundary = Math.abs(word.start - startSeconds) < EPSILON;
      const endsAtBoundary = Math.abs(word.end - endSeconds) < EPSILON;
      // Include if word overlaps the range, or starts at start boundary, or ends at end boundary
      const overlaps = word.start < endSeconds && word.end > startSeconds;
      return overlaps || startsAtBoundary || endsAtBoundary;
    })
    .sort((a, b) => {
      // Sort by start time, then by end time for words with same start
      if (a.start !== b.start) return a.start - b.start;
      return a.end - b.end;
    });

  if (clippedWords.length === 0) return '';

  // Adjust word timestamps to start from 0 and trim to fit within the range
  const adjustedWords = clippedWords.map((word) => {
    const adjustedStart = Math.max(word.start, startSeconds) - startSeconds;
    const adjustedEnd = Math.min(word.end, endSeconds) - startSeconds;
    // Ensure zero-duration words have a minimum duration to be processed correctly
    const finalEnd = adjustedEnd <= adjustedStart ? adjustedStart + 0.001 : adjustedEnd;
    return {
      ...word,
      start: adjustedStart,
      end: finalEnd,
    };
  });

  // Convert adjusted words to SRT format
  const srtResult = wordsToSRT(adjustedWords);
  
  // If the result is empty, return it
  if (!srtResult) return srtResult;
  
  // Parse the SRT result and adjust all timestamps to start from 0
  const entries = parseSRT(srtResult);
  const firstStartTime = moment.duration(entries[0].startTime.replace(',', '.')).asMilliseconds();
  
  const normalizedEntries = entries.map((entry) => {
    const startMs = moment.duration(entry.startTime.replace(',', '.')).asMilliseconds();
    const endMs = moment.duration(entry.endTime.replace(',', '.')).asMilliseconds();
    
    return {
      ...entry,
      startTime: moment.utc(startMs - firstStartTime).format('HH:mm:ss,SSS'),
      endTime: moment.utc(endMs - firstStartTime).format('HH:mm:ss,SSS'),
    };
  });
  
  return entriesToSRT(normalizedEntries);
}
