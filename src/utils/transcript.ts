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
 * Clips a transcript from start time to end time and resets timestamps to start at 0
 * @param transcript SRT format transcript string
 * @param startTime Start time in format "HH:mm:ss,SSS"
 * @param endTime End time in format "HH:mm:ss,SSS"
 * @returns Clipped and adjusted SRT transcript
 */
export function clipTranscript(
  transcript: string,
  startTime: string,
  endTime: string,
): string {
  // Parse the transcript
  const entries = parseSRT(transcript);

  // Convert times to milliseconds for easier comparison
  const startMs = moment.duration(startTime.replace(',', '.')).asMilliseconds();
  const endMs = moment.duration(endTime.replace(',', '.')).asMilliseconds();

  // Filter entries that overlap the time range
  const clippedEntries = entries.filter((entry) => {
    const entryStartMs = moment
      .duration(entry.startTime.replace(',', '.'))
      .asMilliseconds();
    const entryEndMs = moment
      .duration(entry.endTime.replace(',', '.'))
      .asMilliseconds();
    return entryStartMs < endMs && entryEndMs > startMs;
  });

  // Adjust timestamps to start from 0 and trim to fit within the range
  const adjustedEntries = clippedEntries.map((entry) => {
    const entryStartMs = moment
      .duration(entry.startTime.replace(',', '.'))
      .asMilliseconds();
    const entryEndMs = moment
      .duration(entry.endTime.replace(',', '.'))
      .asMilliseconds();

    const newStartMs = Math.max(entryStartMs, startMs) - startMs;
    const newEndMs = Math.min(entryEndMs, endMs) - startMs;

    return {
      ...entry,
      startTime: moment.utc(newStartMs).format('HH:mm:ss,SSS'),
      endTime: moment.utc(newEndMs).format('HH:mm:ss,SSS'),
    };
  });

  // Convert back to SRT format
  return entriesToSRT(adjustedEntries);
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
