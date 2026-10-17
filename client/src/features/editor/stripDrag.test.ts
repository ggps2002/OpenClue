import { describe, expect, it } from 'vitest';
import { createOverlay } from './overlays';
import { applyStripDrag, draggedEdges, snapDelta, snapPoints, tickStep } from './stripDrag';
import { Timeline } from './Timeline';

const zoom = (id: string, startMs: number, durationMs: number) => ({ id, startMs, durationMs, x: 0.5, y: 0.5, scale: 2, spotlight: false });

function make() {
  return new Timeline({
    version: 1,
    scenes: [
      { id: 'a', name: 'Intro', mediaId: 'm1', inMs: 1000, outMs: 5000, muted: false, zooms: [zoom('z1', 1500, 1000), zoom('z2', 3000, 1000)] },
      { id: 'b', name: 'Demo', mediaId: 'm2', inMs: 0, outMs: 3000, muted: false },
    ],
    tracks: [
      { id: 't1', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 500, inMs: 0, outMs: 2000 }] },
      { id: 'o1', kind: 'overlay', name: 'Overlay 1', hidden: false, clips: [createOverlay('ov', 'text', 1000)] },
    ],
  });
}
const lengths = new Map([
  ['m1', 6000],
  ['m2', 3000],
]);
const sourceMs = (id: string) => lengths.get(id);

describe('applyStripDrag', () => {
  it('trims scene edges within the source and the minimum length', () => {
    const t = make();
    expect(applyStripDrag(t, { kind: 'scene-in', sceneId: 'a' }, -400, sourceMs).scene('a')).toMatchObject({ inMs: 600, outMs: 5000 });
    expect(applyStripDrag(t, { kind: 'scene-in', sceneId: 'a' }, -5000, sourceMs).scene('a')?.inMs).toBe(0);
    expect(applyStripDrag(t, { kind: 'scene-out', sceneId: 'a' }, 4000, sourceMs).scene('a')?.outMs).toBe(6000);
    expect(applyStripDrag(t, { kind: 'scene-out', sceneId: 'a' }, -9000, sourceMs).scene('a')?.outMs).toBe(1100);
  });

  it('moves audio and overlay clips, never before the start', () => {
    const t = make();
    expect(applyStripDrag(t, { kind: 'clip', trackId: 't1', clipId: 'c1' }, 1234.4, sourceMs).audioTracks[0].clips[0].startMs).toBe(1734);
    expect(applyStripDrag(t, { kind: 'clip', trackId: 't1', clipId: 'c1' }, -2000, sourceMs).audioTracks[0].clips[0].startMs).toBe(0);
    expect(applyStripDrag(t, { kind: 'clip', trackId: 'o1', clipId: 'ov' }, 500, sourceMs).overlay('ov')?.clip.startMs).toBe(1500);
  });

  it('resizes overlays', () => {
    const t = make();
    expect(applyStripDrag(t, { kind: 'overlay-end', clipId: 'ov' }, 1000, sourceMs).overlay('ov')?.clip.durationMs).toBe(4000);
    expect(applyStripDrag(t, { kind: 'overlay-end', clipId: 'ov' }, -9000, sourceMs).overlay('ov')?.clip.durationMs).toBe(100);
  });

  it('moves zooms between their neighbours without shrinking them, and resizes them', () => {
    const t = make();
    const moved = (delta: number, id = 'z1') => applyStripDrag(t, { kind: 'zoom', zoomId: id }, delta, sourceMs).zoom(id)?.zoom;
    expect(moved(200)).toMatchObject({ startMs: 1700, durationMs: 1000 });
    expect(moved(5000)).toMatchObject({ startMs: 2000, durationMs: 1000 });
    expect(moved(-5000)).toMatchObject({ startMs: 0, durationMs: 1000 });
    expect(moved(5000, 'z2')).toMatchObject({ startMs: 5000, durationMs: 1000 });
    const resized = applyStripDrag(t, { kind: 'zoom-end', zoomId: 'z1' }, 2000, sourceMs).zoom('z1')?.zoom;
    expect(resized?.durationMs).toBe(1500);
  });

  it('ignores targets that no longer exist', () => {
    const t = make();
    expect(applyStripDrag(t, { kind: 'scene-in', sceneId: 'gone' }, 100, sourceMs)).toBe(t);
    expect(applyStripDrag(t, { kind: 'zoom', zoomId: 'gone' }, 100, sourceMs)).toBe(t);
  });
});

describe('snapping', () => {
  it('reports the edges a drag moves, in timeline time', () => {
    const t = make();
    expect(draggedEdges(t, { kind: 'scene-in', sceneId: 'a' })).toEqual([]);
    expect(draggedEdges(t, { kind: 'scene-out', sceneId: 'a' })).toEqual([4000]);
    expect(draggedEdges(t, { kind: 'clip', trackId: 't1', clipId: 'c1' })).toEqual([500, 2500]);
    expect(draggedEdges(t, { kind: 'clip', trackId: 'o1', clipId: 'ov' })).toEqual([1000, 4000]);
    expect(draggedEdges(t, { kind: 'zoom', zoomId: 'z1' })).toEqual([500, 1500]);
    expect(draggedEdges(t, { kind: 'zoom-end', zoomId: 'z1' })).toEqual([1500]);
    expect(snapPoints(t, 2222)).toEqual([0, 2222, 0, 4000, 4000, 7000]);
  });

  it('lands the closest edge on a nearby point', () => {
    expect(snapDelta(940, [500, 2500], [0, 4000, 3500], 80)).toBe(1000);
    expect(snapDelta(-460, [500, 2500], [0, 4000], 80)).toBe(-500);
    expect(snapDelta(300, [500, 2500], [0, 4000], 80)).toBe(300);
    expect(snapDelta(300, [], [0], 1000)).toBe(300);
  });

  it('picks ruler steps for the visible span', () => {
    expect(tickStep(2000)).toBe(500);
    expect(tickStep(60_000)).toBe(10_000);
    expect(tickStep(10_000_000)).toBe(1_200_000);
  });
});
