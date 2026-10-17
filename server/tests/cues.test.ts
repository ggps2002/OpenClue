import { describe, expect, it } from 'vitest';
import { buildCues, cuesOnTimeline, splitCaptionText, toSrt, toVtt } from '../src/modules/captions/cues';
import type { TimelineDoc } from '../src/modules/timelines/timelines.schema';

const layout = { maxCharsPerLine: 20, maxLines: 2 } as const;

describe('splitCaptionText', () => {
  it('keeps short text as one line', () => {
    expect(splitCaptionText('Open the settings.', layout)).toEqual(['Open the settings.']);
  });

  it('uses as few two-line cues as fit, with even lengths and balanced line breaks', () => {
    const cues = splitCaptionText('Click the blue button in the top right corner to create a brand new project', layout);
    // Greedy packing would leave "project" alone in a third cue.
    expect(cues).toEqual(['Click the\nblue button in', 'the top right\ncorner to', 'create a brand\nnew project']);
    for (const cue of cues) {
      expect(cue.split('\n').length).toBeLessThanOrEqual(2);
      for (const line of cue.split('\n')) expect(line.length).toBeLessThanOrEqual(20);
    }
  });

  it('starts a new cue after a sentence once the cue is half a line long', () => {
    expect(splitCaptionText('Welcome to the tour. Let us begin.', layout)).toEqual(['Welcome to the tour.', 'Let us begin.']);
    // "Hi." is too short to stand alone.
    expect(splitCaptionText('Hi. Let us begin now.', layout)).toEqual(['Hi. Let us\nbegin now.']);
  });

  it('uses single lines when asked and keeps overlong words whole', () => {
    expect(splitCaptionText('one two three four five six', { maxCharsPerLine: 10, maxLines: 1 })).toEqual(['one two', 'three four', 'five six']);
    expect(splitCaptionText('internationalisation rocks', { maxCharsPerLine: 10, maxLines: 1 })).toEqual(['internationalisation', 'rocks']);
  });
});

describe('buildCues', () => {
  it('shares each window between its cues by length and skips empty windows', () => {
    const cues = buildCues(
      [
        { startMs: 0, endMs: 2000, text: 'Welcome to the tour. Let us begin.' },
        { startMs: 2000, endMs: 3000, text: '  ' },
        { startMs: 3000, endMs: 4000, text: 'Done.' },
      ],
      layout,
    );
    expect(cues).toEqual([
      { startMs: 0, endMs: 1212, text: 'Welcome to the tour.' },
      { startMs: 1212, endMs: 2000, text: 'Let us begin.' },
      { startMs: 3000, endMs: 4000, text: 'Done.' },
    ]);
  });

  it('falls back to one cue when the window is too short to split', () => {
    expect(buildCues([{ startMs: 0, endMs: 1, text: 'Welcome to the tour. Let us begin.' }], layout)).toEqual([
      { startMs: 0, endMs: 1, text: 'Welcome to the tour.\nLet us begin.' },
    ]);
  });
});

describe('cuesOnTimeline', () => {
  const cues = [
    { id: '1', startMs: 0, endMs: 1000, text: 'One' },
    { id: '2', startMs: 1000, endMs: 3000, text: 'Two' },
    { id: '3', startMs: 4000, endMs: 5000, text: 'Three' },
  ];
  const scene = (id: string, mediaId: string, inMs: number, outMs: number) => ({ id, name: id, mediaId, inMs, outMs, muted: false });

  it('follows the voiceover clips when the edit has any', () => {
    const doc: TimelineDoc = {
      version: 1,
      scenes: [scene('s1', 'video', 0, 6000)],
      tracks: [
        { id: 't', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c', source: { type: 'voiceover' }, startMs: 500, inMs: 500, outMs: 4500 }] },
      ],
    };
    expect(cuesOnTimeline(cues, doc, 'video')).toEqual([
      { id: '1', startMs: 500, endMs: 1000, text: 'One' },
      { id: '2', startMs: 1000, endMs: 3000, text: 'Two' },
      { id: '3', startMs: 4000, endMs: 4500, text: 'Three' },
    ]);
  });

  it('otherwise follows scenes cut from the source video, through reorders and transitions', () => {
    const doc: TimelineDoc = {
      version: 1,
      scenes: [scene('s1', 'video', 4000, 6000), scene('s2', 'other', 0, 2000), { ...scene('s3', 'video', 0, 2000), transition: { type: 'fade', durationMs: 500 } }],
      tracks: [],
    };
    // s1 plays 0–2000 (source 4000–6000), s2 2000–4000, s3 3500–5500 (source 0–2000).
    expect(cuesOnTimeline(cues, doc, 'video')).toEqual([
      { id: '3', startMs: 0, endMs: 1000, text: 'Three' },
      { id: '1', startMs: 3500, endMs: 4500, text: 'One' },
      { id: '2', startMs: 4500, endMs: 5500, text: 'Two' },
    ]);
    expect(cuesOnTimeline(cues, { ...doc, scenes: [doc.scenes[1]] }, 'video')).toBeNull();
  });
});

describe('subtitle files', () => {
  const cues = [
    { startMs: 0, endMs: 1500, text: 'Hello <world> & you' },
    { startMs: 3_723_004, endMs: 3_724_000, text: 'Line one\nLine two' },
  ];

  it('writes SRT', () => {
    expect(toSrt(cues)).toBe('1\n00:00:00,000 --> 00:00:01,500\nHello <world> & you\n\n2\n01:02:03,004 --> 01:02:04,000\nLine one\nLine two\n');
  });

  it('writes WebVTT with escaped text and the caption position', () => {
    expect(toVtt(cues)).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello &lt;world&gt; &amp; you\n\n01:02:03.004 --> 01:02:04.000\nLine one\nLine two\n',
    );
    expect(toVtt(cues.slice(0, 1), 'top')).toContain('00:00:01.500 line:8%\n');
  });
});
