import type { Timeline } from '../editor/Timeline';
import { findIssues } from '../script/segments';
import type { CaptionCue } from './captions.api';

/** The server's limit on one caption's text. */
export const MAX_CUE_CHARS = 300;

/** Problems that would make the server reject the captions, keyed by cue id. */
export function findCueIssues(cues: CaptionCue[]): Map<string, string> {
  const issues = findIssues(cues);
  for (const cue of cues) {
    if (issues.has(cue.id)) continue;
    if (!cue.text.trim()) issues.set(cue.id, 'Write some text or delete this caption');
    else if (cue.text.trim().length > MAX_CUE_CHARS) issues.set(cue.id, `Keep captions under ${MAX_CUE_CHARS} characters`);
  }
  return issues;
}

/** A stretch of the script's clock that plays at `atMs` in the edit. */
interface Span {
  fromMs: number;
  toMs: number;
  atMs: number;
}

/**
 * Same rule as the server's export: captions follow the voiceover clips when the edit has any,
 * otherwise the scenes cut from the script's source video. Null when the edit uses neither.
 */
export function cuesOnTimeline(cues: CaptionCue[], timeline: Timeline, sourceMediaId: string | null): CaptionCue[] | null {
  const voiceover = timeline.audioTracks.flatMap((t) => t.clips.filter((c) => c.source.type === 'voiceover'));
  let spans: Span[] = voiceover.map((c) => ({ fromMs: c.inMs, toMs: c.outMs, atMs: c.startMs }));
  if (spans.length === 0) {
    spans = timeline
      .placements()
      .filter((p) => p.scene.mediaId === sourceMediaId)
      .map((p) => ({ fromMs: p.scene.inMs, toMs: p.scene.outMs, atMs: p.startMs }));
  }
  if (spans.length === 0) return null;
  return spans
    .flatMap((span) =>
      cues
        .filter((c) => c.endMs > span.fromMs && c.startMs < span.toMs)
        .map((c) => ({
          ...c,
          startMs: span.atMs + Math.max(c.startMs, span.fromMs) - span.fromMs,
          endMs: span.atMs + Math.min(c.endMs, span.toMs) - span.fromMs,
        })),
    )
    .sort((a, b) => a.startMs - b.startMs);
}
