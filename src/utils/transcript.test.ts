import { describe, expect, it } from '@jest/globals';
import { wordsToSRT, clipWordsToSRT, formatSRTTime } from './transcript';
import { REAL_SEGMENTS_PRE_ADJUSTMENT, REAL_WORDS } from './testData';
import { adjustSegmentsToWordBoundaries } from './segment';

describe('wordsToSRT', () => {
  it('should handle empty array', () => {
    const result = wordsToSRT([]);
    expect(result).toBe('');
  });

  it('should handle single word', () => {
    const words = [
      {
        word: 'Hello',
        start: 1.0,
        end: 1.5,
      },
    ];
    const result = wordsToSRT(words);
    const expected = `1
00:00:01,000 --> 00:00:01,500
Hello`;
    expect(result).toBe(expected);
  });

  it('should group words into captions based on pauses', () => {
    const words = [
      { word: "It's", start: 9.539999961853027, end: 10.34000015258789 },
      {
        word: 'September',
        start: 10.34000015258789,
        end: 10.9399995803833,
      },
      { word: '2000', start: 10.9399995803833, end: 12.140000343322754 },
      { word: "We're", start: 13.020000457763672, end: 13.0600004196167 },
      { word: 'in', start: 13.0600004196167, end: 13.319999694824219 },
      { word: 'a', start: 13.319999694824219, end: 13.460000038146973 },
      {
        word: 'courtroom',
        start: 13.460000038146973,
        end: 13.800000190734863,
      },
      { word: 'in', start: 13.800000190734863, end: 14.260000228881836 },
      { word: 'New', start: 14.260000228881836, end: 14.760000228881836 },
      { word: 'York', start: 14.760000228881836, end: 15.160000228881836 },
      {
        word: "There's",
        start: 15.720000267028809,
        end: 15.779999732971191,
      },
      { word: 'a', start: 15.779999732971191, end: 16.020000457763672 },
      { word: 'man', start: 16.020000457763672, end: 16.360000610351562 },
      { word: 'standing', start: 16.360000610351562, end: 17 },
      { word: 'in', start: 17, end: 17.200000762939453 },
      { word: 'the', start: 17.200000762939453, end: 17.3799991607666 },
      { word: 'dock', start: 17.3799991607666, end: 17.65999984741211 },
    ];
    const result = wordsToSRT(words);
    const expected = `1
00:00:09,540 --> 00:00:12,140
It's September 2000

2
00:00:13,020 --> 00:00:15,160
We're in a courtroom in New York

3
00:00:15,720 --> 00:00:17,660
There's a man standing in the dock`;
    expect(result).toBe(expected);
  });

  it('should split long captions based on duration', () => {
    const words = [
      { word: 'This', start: 1.0, end: 1.2 },
      { word: 'is', start: 1.3, end: 1.4 },
      { word: 'a', start: 1.5, end: 1.6 },
      { word: 'very', start: 1.7, end: 1.9 },
      { word: 'long', start: 2.0, end: 2.2 },
      { word: 'sentence', start: 2.3, end: 2.6 },
      { word: 'that', start: 2.7, end: 2.9 },
      { word: 'should', start: 3.0, end: 3.2 },
      { word: 'be', start: 3.3, end: 3.4 },
      { word: 'split', start: 3.5, end: 3.7 },
      { word: 'at', start: 3.8, end: 4.0 },
      { word: 'the', start: 4.1, end: 4.3 },
      { word: 'end', start: 4.4, end: 4.6 },
      { word: 'of', start: 4.7, end: 4.9 },
      { word: 'four', start: 5.1, end: 5.2 },
      { word: 'seconds', start: 5.3, end: 5.5 },
    ];
    const result = wordsToSRT(words);
    const expected = `1
00:00:01,000 --> 00:00:04,900
This is a very long sentence that should be split at the end of

2
00:00:05,100 --> 00:00:05,500
four seconds`;
    expect(result).toBe(expected);
  });

  it('should handle words with millisecond precision', () => {
    const words = [
      { word: 'Hello', start: 1.123, end: 1.456 },
      { word: 'world', start: 1.789, end: 2.123 },
    ];
    const result = wordsToSRT(words);
    const expected = `1
00:00:01,123 --> 00:00:02,123
Hello world`;
    expect(result).toBe(expected);
  });

  it('should handle hours in timestamps', () => {
    const words = [
      { word: 'Hello', start: 3600, end: 3601 }, // 1 hour
      { word: 'world', start: 3601.5, end: 3603 }, // 1 hour, 1.5 seconds
    ];
    const result = wordsToSRT(words);
    const expected = `1
01:00:00,000 --> 01:00:03,000
Hello world`;
    expect(result).toBe(expected);
  });
});

describe('formatSRTTime', () => {
  // Import the function directly for testing
  const { formatSRTTime } = jest.requireActual('./transcript');

  it('should format zero seconds as 00:00:00,000', () => {
    expect(formatSRTTime(0)).toBe('00:00:00,000');
  });

  it('should format seconds with milliseconds', () => {
    expect(formatSRTTime(1.234)).toBe('00:00:01,234');
  });

  it('should format minutes and seconds', () => {
    expect(formatSRTTime(65.5)).toBe('00:01:05,500');
  });

  it('should format hours, minutes, and seconds', () => {
    expect(formatSRTTime(3661.789)).toBe('01:01:01,789');
  });

  it('should pad single digits with zeros', () => {
    expect(formatSRTTime(5.7)).toBe('00:00:05,700');
  });

  it('should round milliseconds correctly', () => {
    expect(formatSRTTime(1.999)).toBe('00:00:01,999');
    expect(formatSRTTime(1.995)).toBe('00:00:01,995');
  });
});

describe('clipWordsToSRT', () => {
  const sampleWords = [
    { word: 'Hello', start: 1.0, end: 1.5 },
    { word: 'world', start: 1.8, end: 2.2 },
    { word: 'This', start: 4.0, end: 4.3 },
    { word: 'is', start: 4.4, end: 4.6 },
    { word: 'a', start: 4.7, end: 4.8 },
    { word: 'test', start: 4.9, end: 5.2 },
    { word: 'Goodbye', start: 8.0, end: 8.5 },
    { word: 'everyone', start: 8.6, end: 9.0 },
  ];

  it('should clip words to specified time range and start at 0', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:04.000',
      '00:00:06.000',
    );
    const expected = `1
00:00:00,000 --> 00:00:01,200
This is a test`;
    expect(result).toBe(expected);
  });

  it('should handle empty words array', () => {
    const result = clipWordsToSRT([], '00:00:01.000', '00:00:04.000');
    expect(result).toBe('');
  });

  it('should handle words with no entries in time range', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:20.000',
      '00:00:25.000',
    );
    expect(result).toBe('');
  });

  it('should handle partial overlap with start time', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:01.500',
      '00:00:03.000',
    );
    const expected = `1
00:00:00,000 --> 00:00:00,400
world`;
    expect(result).toBe(expected);
  });

  it('should handle partial overlap with end time', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:07.000',
      '00:00:08.500',
    );
    const expected = `1
00:00:00,000 --> 00:00:00,500
Goodbye`;
    expect(result).toBe(expected);
  });

  it('should handle words that span across the time range', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:00.500',
      '00:00:09.500',
    );
    const expected = `1
00:00:00,000 --> 00:00:01,200
Hello world

2
00:00:03,000 --> 00:00:04,200
This is a test

3
00:00:07,000 --> 00:00:08,000
Goodbye everyone`;
    expect(result).toBe(expected);
  });

  it('should handle single word in time range', () => {
    const result = clipWordsToSRT(
      sampleWords,
      '00:00:01.500',
      '00:00:02.000',
    );
    const expected = `1
00:00:00,000 --> 00:00:00,200
world`;
    expect(result).toBe(expected);
  });

  it('should handle words ending exactly at end boundary', () => {
    const words = [
      { word: 'Hello', start: 1.0, end: 1.5 },
      { word: 'world', start: 1.8, end: 2.2 },
      { word: 'test', start: 2.2, end: 2.2 }, // Zero duration word ending at boundary
    ];
    const result = clipWordsToSRT(
      words,
      '00:00:01.000',
      '00:00:02.200',
    );
    expect(result).toContain('test');
    expect(result).toContain('Hello world');
  });

  it('should handle real words and segments', () => {
    const result = clipWordsToSRT(
      REAL_WORDS,
      formatSRTTime(REAL_SEGMENTS_PRE_ADJUSTMENT.segments[2].start).replace(',', '.'),
      formatSRTTime(REAL_SEGMENTS_PRE_ADJUSTMENT.segments[2].end).replace(',', '.'),
    );
    expect(result).toContain('Wanjiru has lived it firsthand');
  });

  it('should handle real words and adjusted segments', () => {
    const adjustedSegments = adjustSegmentsToWordBoundaries(REAL_SEGMENTS_PRE_ADJUSTMENT.segments, REAL_WORDS);
    const result = clipWordsToSRT(
      REAL_WORDS,
      formatSRTTime(adjustedSegments[2].start).replace(',', '.'),
      formatSRTTime(adjustedSegments[2].end).replace(',', '.'),
    );
    expect(result).toContain('Wanjiru has lived it firsthand');
  });
});
