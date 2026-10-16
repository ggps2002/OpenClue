import type { ScriptSegment } from './script.api';

/** Comfortable narration pace; the server's script writer uses the same figure. */
export const WORDS_PER_SECOND = 2.5;
/** Smallest slot the editor will create by splitting or inserting. */
export const MIN_SEGMENT_MS = 500;
const DEFAULT_NEW_SEGMENT_MS = 3000;

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Words in the segment versus how many fit its slot at a comfortable pace. */
export function pace(segment: ScriptSegment): { words: number; budget: number; tooLong: boolean } {
  const words = wordCount(segment.text);
  const budget = Math.floor(((segment.endMs - segment.startMs) / 1000) * WORDS_PER_SECOND);
  return { words, budget, tooLong: words > budget };
}

export function updateSegment(list: ScriptSegment[], id: string, patch: Partial<Omit<ScriptSegment, 'id'>>): ScriptSegment[] {
  return list.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export function removeSegment(list: ScriptSegment[], id: string): ScriptSegment[] {
  return list.filter((s) => s.id !== id);
}

/** Splits a segment in half by time, dividing its words at the middle. */
export function splitSegment(list: ScriptSegment[], id: string, newId: string): ScriptSegment[] {
  return list.flatMap((s) => {
    if (s.id !== id || s.endMs - s.startMs < MIN_SEGMENT_MS * 2) return [s];
    const mid = Math.round((s.startMs + s.endMs) / 2);
    const words = s.text.trim().split(/\s+/).filter(Boolean);
    const cut = Math.ceil(words.length / 2);
    return [
      { ...s, endMs: mid, text: words.slice(0, cut).join(' ') },
      { id: newId, startMs: mid, endMs: s.endMs, text: words.slice(cut).join(' ') },
    ];
  });
}

/** Joins a segment with the one after it. */
export function mergeWithNext(list: ScriptSegment[], id: string): ScriptSegment[] {
  const i = list.findIndex((s) => s.id === id);
  const next = list[i + 1];
  if (i < 0 || !next) return list;
  const merged = { ...list[i], endMs: next.endMs, text: [list[i].text, next.text].filter(Boolean).join(' ') };
  return [...list.slice(0, i), merged, ...list.slice(i + 2)];
}

/** Free time after the segment at `index`, up to the next one (unbounded after the last). */
export function gapAfter(list: ScriptSegment[], index: number): number {
  const next = list[index + 1];
  return next ? next.startMs - list[index].endMs : Number.POSITIVE_INFINITY;
}

/**
 * Inserts an empty segment into the gap after `afterId` (or at the start when null).
 * Returns the list unchanged when there is no room.
 */
export function insertAfter(list: ScriptSegment[], afterId: string | null, newId: string): ScriptSegment[] {
  const index = afterId === null ? -1 : list.findIndex((s) => s.id === afterId);
  const startMs = index < 0 ? 0 : list[index].endMs;
  const nextStart = list[index + 1]?.startMs ?? Number.POSITIVE_INFINITY;
  const endMs = Math.min(startMs + DEFAULT_NEW_SEGMENT_MS, nextStart);
  if (endMs - startMs < MIN_SEGMENT_MS) return list;
  const segment = { id: newId, startMs, endMs, text: '' };
  return [...list.slice(0, index + 1), segment, ...list.slice(index + 1)];
}

/** Problems that would make the server reject the script, keyed by segment id. */
export function findIssues(list: ScriptSegment[]): Map<string, string> {
  const issues = new Map<string, string>();
  list.forEach((s, i) => {
    const previous = list[i - 1];
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs) || s.startMs < 0) {
      issues.set(s.id, 'Enter a valid start and end time');
    } else if (s.endMs <= s.startMs) {
      issues.set(s.id, 'The end time must be after the start time');
    } else if (previous && s.startMs < previous.endMs) {
      issues.set(s.id, 'Starts before the previous segment ends');
    }
  });
  return issues;
}

/** The segment playing at `ms`, if any. */
export function segmentAt(list: ScriptSegment[], ms: number): ScriptSegment | undefined {
  return list.find((s) => ms >= s.startMs && ms < s.endMs);
}

/** Seconds with one decimal for time inputs, e.g. 1234 -> "1.2". */
export function msToSeconds(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

export function secondsToMs(value: string): number {
  return Math.round(Number.parseFloat(value) * 1000);
}
