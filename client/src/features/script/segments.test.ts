import { describe, expect, it } from 'vitest';
import type { ScriptSegment } from './script.api';
import {
  findIssues,
  gapAfter,
  insertAfter,
  mergeWithNext,
  msToSeconds,
  pace,
  removeSegment,
  secondsToMs,
  segmentAt,
  splitSegment,
  updateSegment,
} from './segments';

const list: ScriptSegment[] = [
  { id: 'a', startMs: 0, endMs: 4000, text: 'Open the dashboard and pick a project.' },
  { id: 'b', startMs: 4000, endMs: 6000, text: 'Click save.' },
  { id: 'c', startMs: 9000, endMs: 12000, text: 'Done.' },
];

describe('script segment helpers', () => {
  it('measures pace against the slot length', () => {
    expect(pace(list[0])).toEqual({ words: 7, budget: 10, tooLong: false });
    expect(pace({ ...list[1], text: 'one two three four five six' })).toMatchObject({ budget: 5, tooLong: true });
  });

  it('updates and removes segments by id', () => {
    expect(updateSegment(list, 'b', { text: 'Save.' })[1].text).toBe('Save.');
    expect(removeSegment(list, 'b').map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('splits a segment in half by time and words', () => {
    const result = splitSegment(list, 'a', 'new');
    expect(result.map(({ id, startMs, endMs }) => [id, startMs, endMs])).toEqual([
      ['a', 0, 2000],
      ['new', 2000, 4000],
      ['b', 4000, 6000],
      ['c', 9000, 12000],
    ]);
    expect(result[0].text).toBe('Open the dashboard and');
    expect(result[1].text).toBe('pick a project.');
    // Too short to split.
    expect(splitSegment([{ id: 'x', startMs: 0, endMs: 800, text: 'Hi' }], 'x', 'y')).toHaveLength(1);
  });

  it('merges a segment with the next one', () => {
    const merged = mergeWithNext(list, 'b');
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual({ id: 'b', startMs: 4000, endMs: 12000, text: 'Click save. Done.' });
    expect(mergeWithNext(list, 'c')).toBe(list);
  });

  it('inserts into gaps only when there is room', () => {
    expect(gapAfter(list, 0)).toBe(0);
    expect(gapAfter(list, 1)).toBe(3000);
    expect(insertAfter(list, 'a', 'n')).toBe(list);
    const inserted = insertAfter(list, 'b', 'n');
    expect(inserted[2]).toEqual({ id: 'n', startMs: 6000, endMs: 9000, text: '' });
    expect(insertAfter([], null, 'n')).toEqual([{ id: 'n', startMs: 0, endMs: 3000, text: '' }]);
  });

  it('finds timing problems', () => {
    const broken = [
      { ...list[0], endMs: 5000 },
      { ...list[1] },
      { ...list[2], endMs: 8000 },
      { id: 'd', startMs: Number.NaN, endMs: 20000, text: '' },
    ];
    expect(Object.fromEntries(findIssues(broken))).toEqual({
      b: 'Starts before the previous segment ends',
      c: 'The end time must be after the start time',
      d: 'Enter a valid start and end time',
    });
    expect(findIssues(list).size).toBe(0);
  });

  it('finds the segment playing at a time and converts seconds', () => {
    expect(segmentAt(list, 4500)?.id).toBe('b');
    expect(segmentAt(list, 7000)).toBeUndefined();
    expect(msToSeconds(1234)).toBe('1.2');
    expect(secondsToMs('2.5')).toBe(2500);
  });
});
