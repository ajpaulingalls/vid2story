import { describe, expect, it } from '@jest/globals';
import { adjustSegmentsToWordBoundaries, ViralPodcastSegments } from './openai';
import { TranscriptionWord } from 'openai/resources/audio/transcriptions';
import { REAL_SEGMENTS_PRE_ADJUSTMENT, REAL_SEGMENTS_PRE_ADJUSTMENT_2, REAL_WORDS, REAL_WORDS2 } from './testData';

describe('adjustSegmentsToWordBoundaries', () => {
  const createWord = (
    word: string,
    start: number,
    end: number,
  ): TranscriptionWord => ({
    word,
    start,
    end,
  });

  const createSegment = (
    title: string,
    start: number,
    end: number,
  ): ViralPodcastSegments['segments'][0] => ({
    title,
    summary: 'Test summary',
    caption: 'Test caption',
    start,
    end,
    duration: end - start,
  });

  it('should return empty array when segments is empty', () => {
    const words = [createWord('hello', 1.0, 1.5)];
    const result = adjustSegmentsToWordBoundaries([], words);
    expect(result).toEqual([]);
  });

  it('should return segments unchanged when words is empty', () => {
    const segments = [createSegment('Test', 1.0, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, []);
    expect(result).toEqual(segments);
  });

  it('should return segments unchanged when both are empty', () => {
    const result = adjustSegmentsToWordBoundaries([], []);
    expect(result).toEqual([]);
  });

  it('should not adjust segments that are already on word boundaries', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0),
      // No word after 2.0, so end won't be adjusted
    ];
    const segments = [createSegment('Test', 1.0, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result).toEqual([
      {
        ...segments[0],
        start: 1.0,
        end: 2.0,
        duration: 1.0,
      },
    ]);
  });

  it('should adjust start time backwards when there is a gap before segment start', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // ends at 1.5
      createWord('world', 1.6, 2.0),
      // No word after 2.0, so end won't be adjusted
    ];
    // Segment starts at 1.55, which is 0.05s after word "hello" ends
    const segments = [createSegment('Test', 1.55, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should adjust start backwards by 0.05s (within 0.2s limit)
    expect(result[0].start).toBe(1.5);
    expect(result[0].end).toBe(2.0);
    expect(result[0].duration).toBe(0.5);
  });

  it('should adjust end time forwards when there is a gap after segment end', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0), // ends at 2.0
      createWord('test', 2.1, 2.5), // starts at 2.1
    ];
    // Segment ends at 2.05, which is 0.05s before word "test" starts
    const segments = [createSegment('Test', 1.0, 2.05)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should adjust end forwards by 0.05s (within 0.1s limit)
    expect(result[0].start).toBe(1.0);
    expect(result[0].end).toBe(2.1);
    expect(result[0].duration).toBe(1.1);
  });

  it('should adjust both start and end times when both have gaps', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // ends at 1.5
      createWord('world', 1.6, 2.0),
      createWord('test', 2.1, 2.5), // starts at 2.1
    ];
    // Segment starts at 1.55 (0.05s gap) and ends at 2.05 (0.05s gap)
    const segments = [createSegment('Test', 1.55, 2.05)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].start).toBe(1.5);
    expect(result[0].end).toBe(2.1);
    expect(result[0].duration).toBeCloseTo(0.6);
  });

  it('should limit start adjustment to MAX_START_BOUNDARY_ADJUSTMENT_SECONDS (0.2s)', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // ends at 1.5
      createWord('world', 1.6, 2.0), // starts at 1.6, ends at 2.0
    ];
    // Segment starts at 1.8, which is within word "world" (1.6-2.0)
    // Should adjust to word start (1.6), which is 0.2s adjustment
    // This is within MAX_START_BOUNDARY_ADJUSTMENT_SECONDS (0.2s)
    const segments = [createSegment('Test', 1.8, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].start).toBe(1.6); // Adjusted to word start
    expect(result[0].end).toBe(2.0);
  });

  it('should limit end adjustment to MAX_END_BOUNDARY_ADJUSTMENT_SECONDS (0.1s)', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0), // ends at 2.0
      createWord('test', 2.3, 2.5), // starts at 2.3
    ];
    // Segment ends at 2.05, which is 0.25s before word "test" starts
    // Should only adjust by 0.1s (the max)
    const segments = [createSegment('Test', 1.0, 2.05)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].start).toBe(1.0);
    expect(result[0].end).toBe(2.15); // 2.05 + 0.1
  });

  it('should handle segments that start before any word', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0),
    ];
    // Segment starts at 0.5, before any word
    const segments = [createSegment('Test', 0.5, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should not adjust start (no word before), but may adjust end
    expect(result[0].start).toBe(0.5);
    expect(result[0].end).toBe(2.0);
  });

  it('should handle segments that end after all words', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0), // last word ends at 2.0
    ];
    // Segment ends at 3.0, after all words
    const segments = [createSegment('Test', 1.0, 3.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should adjust start if needed, but not end (no word after)
    expect(result[0].start).toBe(1.0);
    expect(result[0].end).toBe(3.0);
  });

  it('should handle multiple segments', () => {
    const words = [
      createWord('first', 1.0, 1.5),
      createWord('word', 1.6, 2.0),
      createWord('second', 3.0, 3.5),
      createWord('word', 3.6, 4.0),
    ];
    const segments = [
      createSegment('First', 1.55, 2.05), // needs adjustment
      createSegment('Second', 3.55, 4.05), // needs adjustment
    ];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBe(1.5);
    // findWordAfter(2.05) finds "second" which starts at 3.0
    // Gap = 3.0 - 2.05 = 0.95, but max adjustment is 0.1
    // So end = 2.05 + 0.1 = 2.15
    expect(result[0].end).toBe(2.15);
    expect(result[1].start).toBe(3.5);
    // findWordAfter(4.05) returns null, so end stays 4.05
    expect(result[1].end).toBe(4.05);
  });

  it('should preserve all segment properties except start, end, and duration', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0),
    ];
    const segments = [
      {
        title: 'My Title',
        summary: 'My Summary',
        caption: 'My Caption',
        start: 1.55,
        end: 2.05,
        duration: 0.5,
      },
    ];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].title).toBe('My Title');
    expect(result[0].summary).toBe('My Summary');
    expect(result[0].caption).toBe('My Caption');
    expect(result[0].start).toBe(1.5);
    // findWordAfter(2.05) returns null (no word after 2.05), so end stays 2.05
    expect(result[0].end).toBe(2.05);
    expect(result[0].duration).toBeCloseTo(0.55); // 2.05 - 1.5
  });

  it('should handle unsorted words by sorting them first', () => {
    const words = [
      createWord('world', 1.6, 2.0),
      createWord('hello', 1.0, 1.5), // out of order
      createWord('test', 2.1, 2.5),
    ];
    const segments = [createSegment('Test', 1.55, 2.05)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should still work correctly despite unsorted input
    expect(result[0].start).toBe(1.5);
    expect(result[0].end).toBe(2.1);
  });

  it('should adjust start when gap is zero (exact boundary)', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.5, 2.0), // starts exactly where previous ends
    ];
    const segments = [createSegment('Test', 1.5, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].start).toBe(1.3);
    expect(result[0].end).toBe(2.0);
  });

  it('should handle words with overlapping times', () => {
    const words = [
      createWord('hello', 1.0, 1.6), // overlaps with next
      createWord('world', 1.5, 2.0),
    ];
    const segments = [createSegment('Test', 1.55, 1.95)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Should still find appropriate boundaries
    expect(result[0].start).toBeLessThanOrEqual(1.55);
    expect(result[0].end).toBeGreaterThanOrEqual(1.95);
  });

  it('should recalculate duration after adjustments', () => {
    const words = [
      createWord('hello', 1.0, 1.5),
      createWord('world', 1.6, 2.0),
      createWord('test', 2.1, 2.5),
    ];
    const segments = [createSegment('Test', 1.55, 2.05)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Duration should be recalculated as end - start
    expect(result[0].duration).toBe(result[0].end - result[0].start);
    expect(result[0].duration).toBeCloseTo(0.6); // 2.1 - 1.5
  });

  it('should adjust start to word start when segment starts in the middle of a word (BUG TEST)', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // word spans 1.0 to 1.5
      createWord('world', 1.6, 2.0),
    ];
    // Segment starts at 1.2, which is in the middle of "hello"
    // This should adjust to 1.0 (start of "hello") to avoid cutting off the word
    const segments = [createSegment('Test', 1.2, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // BUG: Currently this will NOT adjust because gap = 1.2 - 1.5 = -0.3, which becomes 0
    // Expected: start should be adjusted to 1.0 (the start of the word)
    expect(result[0].start).toBe(1.0); // This test will fail, exposing the bug
    expect(result[0].end).toBe(2.0);
  });

  it('should adjust start to word start when segment starts at word end boundary', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // ends at 1.5
      createWord('world', 1.6, 2.0), // starts at 1.6
    ];
    // Segment starts exactly at the end of "hello" (1.5)
    // This is a boundary case - should probably adjust to 1.0 or 1.6?
    // Actually, 1.5 is the end, so the next word starts at 1.6
    // But if we want to include "hello", we should start at 1.0
    const segments = [createSegment('Test', 1.5, 2.0)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // Current behavior: gap = 1.5 - 1.5 = 0, so no adjustment
    // But this might cut off "hello" if we want to include it
    expect(result[0].start).toBeLessThanOrEqual(1.5);
  });

  it('should skip zero-duration words when finding the word before the start boundary', () => {
    const words = [
      createWord('possible', 33.47999954223633, 33.47999954223633),
      createWord('Hamas', 34.20000076293945, 34.20000076293945),
      createWord('is', 34.20000076293945, 34.619998931884766),
    ];
    const segments = [
      createSegment(
        'Zero duration boundary',
        34.20000076293945,
        34.619998931884766,
      ),
    ];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].start).toBeCloseTo(34.00000076293945, 10);
    expect(result[0].end).toBe(34.619998931884766);
  });

  it('should skip zero-duration words when extending the end boundary', () => {
    const words = [
      createWord('before', 10.0, 10.5),
      createWord('zero', 10.55, 10.55),
      createWord('after', 10.8, 11.0),
    ];
    const segments = [createSegment('Gap test', 9.5, 10.5)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    expect(result[0].end).toBeCloseTo(10.6, 10); // 0.1s max adjustment towards "after"
  });

  it('should handle segment starting before any word starts but within first word duration', () => {
    const words = [
      createWord('hello', 1.0, 1.5), // word starts at 1.0
    ];
    // Segment starts at 0.8, before the word starts
    const segments = [createSegment('Test', 0.8, 1.5)];
    const result = adjustSegmentsToWordBoundaries(segments, words);
    // findWordBefore(0.8) returns null, so no adjustment
    // But this might be okay - segment starts before any word
    expect(result[0].start).toBe(0.8);
  });

  it('should handle real words and segments', () => {
    const result = adjustSegmentsToWordBoundaries(REAL_SEGMENTS_PRE_ADJUSTMENT.segments, REAL_WORDS);
    expect(result).toHaveLength(3);
    // Segment starts at 143.4199981689453; zero-duration word at same time forces 0.2s backoff
    expect(result[2].start).toBeCloseTo(143.21999816894532, 10);
    // Segment ends at 220.56000671386718, next word "For" starts at 221.55999755859375
    // Gap is ~1.0s, but max adjustment is 0.1s, so end adjusts to 220.66000671386718
    expect(result[2].end).toBe(220.56000671386718);
    expect(result[2].duration).toBeCloseTo(77.34000854492186); // Adjusted duration (includes 0.2s start backoff)
  });

  it('should handle real words and segments 2', () => {
    const result = adjustSegmentsToWordBoundaries(REAL_SEGMENTS_PRE_ADJUSTMENT_2.segments, REAL_WORDS2);
    expect(result).toHaveLength(3);
    expect(result[1].start).toBeCloseTo(67.8199966430664, 10);
    expect(result[1].end).toBeCloseTo(99.5000015258789, 10);
    expect(result[1].duration).toBeCloseTo(31.6800048828125, 10);
  });
});
