import type { TimelineDoc } from '../timelines/timelines.schema';
import type { CaptionCue, CaptionStyle } from './captions.schema';

/** A stretch of narration to caption: one script segment, ending where its speech ends. */
export interface CaptionWindow {
  startMs: number;
  endMs: number;
  text: string;
}

export interface CueLayout {
  maxCharsPerLine: number;
  maxLines: 1 | 2;
}

type TimedCue = Omit<CaptionCue, 'id'>;

const SENTENCE_END = /[.!?…]["')\]»”]*$/;

/** Words packed greedily into lines of at most `max` characters (a longer word gets a line of its own). */
function packLines(words: string[], max: number): string[][] {
  const lines: string[][] = [];
  let length = 0;
  for (const word of words) {
    const line = lines.at(-1);
    if (line && length + 1 + word.length <= max) {
      line.push(word);
      length += 1 + word.length;
    } else {
      lines.push([word]);
      length = word.length;
    }
  }
  return lines;
}

/** Lays a cue's words out on as few lines as fit, splitting two lines where they come out most even. */
function layout(words: string[], { maxCharsPerLine, maxLines }: CueLayout): string {
  const text = words.join(' ');
  if (maxLines === 1 || text.length <= maxCharsPerLine || words.length < 2) return text;
  let best = { at: 1, longest: Infinity };
  for (let at = 1; at < words.length; at++) {
    const longest = Math.max(words.slice(0, at).join(' ').length, words.slice(at).join(' ').length);
    if (longest < best.longest) best = { at, longest };
  }
  return `${words.slice(0, best.at).join(' ')}\n${words.slice(best.at).join(' ')}`;
}

const fits = (words: string[], opts: CueLayout) => packLines(words, opts.maxCharsPerLine).length <= opts.maxLines;

/** Words split greedily into as few cues as fit the layout. */
function packCues(words: string[], opts: CueLayout): string[][] {
  const cues: string[][] = [];
  for (const word of words) {
    const cue = cues.at(-1);
    if (cue && fits([...cue, word], opts)) cue.push(word);
    else cues.push([word]);
  }
  return cues;
}

/** The same number of cues as `packCues`, but with similar lengths so no cue is left with a lone word. */
function evenCues(words: string[], opts: CueLayout): string[][] {
  const greedy = packCues(words, opts);
  const target = words.join(' ').length / greedy.length;
  const cues: string[][] = [[]];
  for (const word of words) {
    const cue = cues[cues.length - 1];
    const length = cue.join(' ').length;
    const grown = length + (cue.length > 0 ? 1 : 0) + word.length;
    if (cue.length > 0 && cues.length < greedy.length && Math.abs(grown - target) > Math.abs(length - target)) cues.push([word]);
    else cue.push(word);
  }
  return cues.length === greedy.length && cues.every((c) => fits(c, opts)) ? cues : greedy;
}

/**
 * Splits narration into short caption texts: sentences of at least half a line start a new cue, and
 * each stretch of text is shared evenly between as few cues as fit the layout.
 */
export function splitCaptionText(text: string, opts: CueLayout): string[] {
  const runs: string[][] = [[]];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const run = runs[runs.length - 1];
    run.push(word);
    if (SENTENCE_END.test(word) && run.join(' ').length >= opts.maxCharsPerLine / 2) runs.push([]);
  }
  return runs
    .filter((run) => run.length > 0)
    .flatMap((run) => evenCues(run, opts))
    .map((words) => layout(words, opts));
}

/** Shares a window's time between its cues in proportion to their length, back to back. */
function timeCues(window: CaptionWindow, texts: string[]): TimedCue[] {
  const weights = texts.map((t) => t.length);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = window.endMs - window.startMs;
  let done = 0;
  const cues = texts.map((text, i) => {
    const startMs = window.startMs + Math.round((span * done) / total);
    done += weights[i];
    return { startMs, endMs: window.startMs + Math.round((span * done) / total), text };
  });
  // Too little time to show each cue for at least a millisecond: show the whole window as one caption.
  if (cues.some((c) => c.endMs <= c.startMs)) return [{ ...window, text: texts.join('\n') }];
  return cues;
}

/** Caption cues for timed narration, in order. Windows without text or time are skipped. */
export function buildCues(windows: CaptionWindow[], opts: CueLayout): TimedCue[] {
  return windows
    .filter((w) => w.text.trim() && w.endMs > w.startMs)
    .flatMap((w) => timeCues(w, splitCaptionText(w.text, opts)));
}

/** A stretch of the script's clock that plays at `atMs` in the edited video. */
interface Span {
  fromMs: number;
  toMs: number;
  atMs: number;
}

/**
 * Where the script's clock plays in the edit: through the voiceover clips when the timeline has any
 * (captions follow the narration), otherwise through the scenes cut from the script's source video.
 * Null when the timeline uses neither.
 */
function timelineSpans(doc: TimelineDoc, sourceMediaId: string | null): Span[] | null {
  const voiceover = doc.tracks.flatMap((t) => (t.kind === 'audio' ? t.clips.filter((c) => c.source.type === 'voiceover') : []));
  if (voiceover.length > 0) return voiceover.map((c) => ({ fromMs: c.inMs, toMs: c.outMs, atMs: c.startMs }));

  const spans: Span[] = [];
  let endMs = 0;
  doc.scenes.forEach((scene, index) => {
    const startMs = endMs - (index > 0 ? (scene.transition?.durationMs ?? 0) : 0);
    endMs = startMs + scene.outMs - scene.inMs;
    if (scene.mediaId === sourceMediaId) spans.push({ fromMs: scene.inMs, toMs: scene.outMs, atMs: startMs });
  });
  return spans.length > 0 ? spans : null;
}

/** Cues moved onto the edited video's clock; parts of cues that were cut away are dropped. */
export function cuesOnTimeline<T extends TimedCue>(cues: T[], doc: TimelineDoc, sourceMediaId: string | null): T[] | null {
  const spans = timelineSpans(doc, sourceMediaId);
  if (!spans) return null;
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

function timestamp(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(total % 1000, 3)}`;
}

export function toSrt(cues: TimedCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${timestamp(c.startMs, ',')} --> ${timestamp(c.endMs, ',')}\n${c.text}\n`)
    .join('\n');
}

const VTT_LINE: Record<CaptionStyle['position'], string> = { top: ' line:8%', middle: ' line:50%', bottom: '' };

export function toVtt(cues: TimedCue[], position: CaptionStyle['position'] = 'bottom'): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = cues
    .map((c) => `${timestamp(c.startMs, '.')} --> ${timestamp(c.endMs, '.')}${VTT_LINE[position]}\n${escape(c.text)}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}
