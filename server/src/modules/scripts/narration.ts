import type { TimedText } from '../../lib/speech';

/** Comfortable narration pace used to judge whether text fits its time slot. */
export const WORDS_PER_SECOND = 2.5;

/** Segments shorter than this get merged with their neighbour in the offline draft. */
const MIN_DRAFT_CHARS = 60;
const MAX_MERGE_GAP_MS = 1000;

/**
 * Deterministic cleanup of spoken narration: drops filler words, verbal tics, leading
 * conjunctions and stutters, then fixes spacing, capitalisation and the final punctuation.
 */
export function cleanNarration(raw: string): string {
  let text = ` ${raw} `
    .replace(/,?\s*\b(?:uh-huh|u+m+|u+h+|erm|hmm+)\b,?/gi, ' ')
    .replace(/,\s*(?:like|you know|i mean|sort of|kind of),/gi, ',')
    .replace(/\b(?:you know|i mean),\s*/gi, '')
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Leading "so", "and", "okay" etc. (possibly stacked) add nothing to a script line.
  let previous = '';
  while (previous !== text) {
    previous = text;
    text = text.replace(/^(?:so|and|okay|ok|well|right|alright)\b[,.]?\s*/i, '').replace(/^[,.;:\s]+/, '');
  }
  if (!text) return '';
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text.replace(/[,;:]$/, '')}.`;
}

/** Offline first draft: clean every line and merge short neighbours so segments read as sentences. */
export function draftOffline(transcript: TimedText[]): TimedText[] {
  const draft: TimedText[] = [];
  for (const segment of normalizeTimedText(transcript)) {
    const text = cleanNarration(segment.text);
    if (!text) continue;
    const last = draft.at(-1);
    if (last && last.text.length < MIN_DRAFT_CHARS && segment.startMs - last.endMs <= MAX_MERGE_GAP_MS) {
      last.text = `${last.text} ${text}`;
      last.endMs = segment.endMs;
    } else {
      draft.push({ startMs: segment.startMs, endMs: segment.endMs, text });
    }
  }
  return draft;
}

/**
 * Makes timed text safe to store: rounds and clamps times, sorts, trims overlaps against the
 * previous segment and drops empty or zero-length entries.
 */
export function normalizeTimedText(segments: TimedText[]): TimedText[] {
  const sorted = segments
    .map((s) => ({ startMs: Math.max(0, Math.round(s.startMs)), endMs: Math.round(s.endMs), text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs);
  const result: TimedText[] = [];
  for (const segment of sorted) {
    const previous = result.at(-1);
    const startMs = previous ? Math.max(segment.startMs, previous.endMs) : segment.startMs;
    if (segment.endMs > startMs) result.push({ ...segment, startMs });
  }
  return result;
}

/** How many words fit in a slot at the comfortable narration pace. */
export function wordBudget(startMs: number, endMs: number): number {
  return Math.floor(((endMs - startMs) / 1000) * WORDS_PER_SECOND);
}
