import { describe, expect, it } from 'vitest';
import { Timeline } from '../editor/Timeline';
import type { TimelineDoc } from '../editor/timelineDoc';
import { captionTextStyle } from './captionStyle';
import { findCueIssues, cuesOnTimeline } from './cues';

const cues = [
  { id: '1', startMs: 0, endMs: 1000, text: 'One' },
  { id: '2', startMs: 1000, endMs: 3000, text: 'Two' },
  { id: '3', startMs: 4000, endMs: 5000, text: 'Three' },
];
const scene = (id: string, mediaId: string, inMs: number, outMs: number) => ({ id, name: id, mediaId, inMs, outMs, muted: false });

describe('findCueIssues', () => {
  it('flags overlaps, empty and overlong captions', () => {
    const issues = findCueIssues([
      { id: 'a', startMs: 0, endMs: 1000, text: 'Fine' },
      { id: 'b', startMs: 500, endMs: 2000, text: 'Overlaps' },
      { id: 'c', startMs: 2000, endMs: 3000, text: '  ' },
      { id: 'd', startMs: 3000, endMs: 4000, text: 'x'.repeat(301) },
    ]);
    expect([...issues.keys()]).toEqual(['b', 'c', 'd']);
    expect(issues.get('c')).toMatch(/Write some text/);
  });
});

describe('cuesOnTimeline', () => {
  it('follows the voiceover clips when the edit has any', () => {
    const doc: TimelineDoc = {
      version: 1,
      scenes: [scene('s1', 'm1', 0, 6000)],
      tracks: [{ id: 't', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c', source: { type: 'voiceover' }, startMs: 2000, inMs: 500, outMs: 4500 }] }],
    };
    expect(cuesOnTimeline(cues, new Timeline(doc), 'm1')).toEqual([
      { id: '1', startMs: 2000, endMs: 2500, text: 'One' },
      { id: '2', startMs: 2500, endMs: 4500, text: 'Two' },
      { id: '3', startMs: 5500, endMs: 6000, text: 'Three' },
    ]);
  });

  it('otherwise follows the scenes cut from the script video', () => {
    const doc: TimelineDoc = {
      version: 1,
      scenes: [scene('s1', 'm1', 4000, 6000), scene('s2', 'other', 0, 2000), { ...scene('s3', 'm1', 0, 2000), transition: { type: 'fade', durationMs: 500 } }],
      tracks: [],
    };
    expect(cuesOnTimeline(cues, new Timeline(doc), 'm1')?.map((c) => [c.id, c.startMs, c.endMs])).toEqual([
      ['3', 0, 1000],
      ['1', 3500, 4500],
      ['2', 4500, 5500],
    ]);
    expect(cuesOnTimeline(cues, new Timeline(doc), 'missing')).toBeNull();
  });
});

describe('captionTextStyle', () => {
  it('turns a caption style into CSS', () => {
    const style = {
      preset: 'x', fontFamily: 'mono', fontSize: 0.05, bold: true, uppercase: true, textColor: '#ffd60a',
      outline: true, backgroundColor: '#336699', backgroundOpacity: 0.5, position: 'top',
    } as const;
    const css = captionTextStyle(style);
    expect(css).toMatchObject({ fontSize: '5cqh', fontWeight: 700, textTransform: 'uppercase', color: '#ffd60a', backgroundColor: 'rgba(51, 102, 153, 0.5)' });
    expect(css.textShadow).toBeTruthy();
    expect(captionTextStyle({ ...style, backgroundOpacity: 0 }).backgroundColor).toBeUndefined();
  });
});
