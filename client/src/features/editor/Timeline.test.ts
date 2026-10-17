import { describe, expect, it } from 'vitest';
import { createOverlay } from './overlays';
import { Timeline } from './Timeline';
import type { TimelineDoc } from './timelineDoc';

function make(doc: Partial<TimelineDoc> = {}) {
  let n = 0;
  return new Timeline(
    {
      version: 1,
      scenes: [
        { id: 'a', name: 'Intro', mediaId: 'm1', inMs: 0, outMs: 4000, muted: false },
        { id: 'b', name: 'Demo', mediaId: 'm1', inMs: 6000, outMs: 9000, muted: false },
      ],
      tracks: [
        { id: 't1', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: 8000 }] },
      ],
      ...doc,
    },
    () => `new-${++n}`,
  );
}

describe('Timeline', () => {
  it('places scenes back to back and maps timeline time to source time', () => {
    const timeline = make();
    expect(timeline.videoDurationMs).toBe(7000);
    expect(timeline.durationMs).toBe(8000);
    expect(timeline.placements().map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 4000],
      [4000, 7000],
    ]);
    expect(timeline.sceneAt(5000)).toMatchObject({ scene: { id: 'b' }, sourceMs: 7000 });
    expect(timeline.sceneAt(4000)?.scene.id).toBe('b');
    expect(timeline.sceneAt(7000)).toBeNull();
  });

  it('counts audio that runs past the last scene', () => {
    const timeline = make().moveClip('t1', 'c1', 5000);
    expect(timeline.durationMs).toBe(13000);
    expect(make().moveClip('t1', 'c1', -50).tracks[0].clips[0].startMs).toBe(0);
  });

  it('splits a scene at the playhead without changing what plays', () => {
    const before = make();
    const after = before.splitAt(5500);
    expect(after.scenes.map((s) => [s.id, s.name, s.inMs, s.outMs])).toEqual([
      ['a', 'Intro', 0, 4000],
      ['b', 'Demo', 6000, 7500],
      ['new-1', 'Demo (2)', 7500, 9000],
    ]);
    expect(after.videoDurationMs).toBe(before.videoDurationMs);
    expect(after.splitAt(6000).scenes[3].name).toBe('Demo (3)');
    expect(before.scenes).toHaveLength(2);
  });

  it('refuses splits too close to a scene edge or outside the scenes', () => {
    const timeline = make();
    expect(timeline.canSplitAt(50)).toBe(false);
    expect(timeline.canSplitAt(3950)).toBe(false);
    expect(timeline.canSplitAt(7500)).toBe(false);
    expect(timeline.splitAt(50)).toBe(timeline);
  });

  it('trims within the source and keeps a minimum length', () => {
    const timeline = make();
    expect(timeline.trimScene('a', { inMs: 1000.4 }).scene('a')).toMatchObject({ inMs: 1000, outMs: 4000 });
    expect(timeline.trimScene('a', { inMs: 3990 }).scene('a')).toMatchObject({ inMs: 3900 });
    expect(timeline.trimScene('a', { inMs: -10 }).scene('a')?.inMs).toBe(0);
    expect(timeline.trimScene('b', { outMs: 20000 }, 10000).scene('b')?.outMs).toBe(10000);
    expect(timeline.trimScene('b', { outMs: 6000 }).scene('b')?.outMs).toBe(6100);
    expect(timeline.trimScene('missing', { inMs: 5 })).toBe(timeline);
  });

  it('reorders, renames, mutes, adds and removes scenes', () => {
    const timeline = make();
    expect(timeline.moveScene('b', 0).scenes.map((s) => s.id)).toEqual(['b', 'a']);
    expect(timeline.moveScene('a', 99).scenes.map((s) => s.id)).toEqual(['b', 'a']);
    expect(timeline.moveScene('a', 0)).toBe(timeline);
    expect(timeline.renameScene('a', 'Welcome').scene('a')?.name).toBe('Welcome');
    expect(timeline.setSceneMuted('a', true).scene('a')?.muted).toBe(true);
    expect(timeline.removeScene('a').scenes.map((s) => s.id)).toEqual(['b']);
    expect(timeline.addScene('m2', 2500.2).scenes[2]).toEqual({ id: 'new-1', name: 'Scene 3', mediaId: 'm2', inMs: 0, outMs: 2500, muted: false });
  });

  it('overlaps scenes joined by a transition and reports its progress', () => {
    const timeline = make().setTransition('b', { type: 'fade', durationMs: 1000 });
    expect(timeline.placements().map((p) => [p.startMs, p.endMs])).toEqual([
      [0, 4000],
      [3000, 6000],
    ]);
    expect(timeline.videoDurationMs).toBe(6000);
    expect(timeline.sceneAt(3500)).toMatchObject({ scene: { id: 'b' }, sourceMs: 6500 });
    expect(timeline.transitionAt(3500)).toMatchObject({ type: 'fade', progress: 0.5, from: { scene: { id: 'a' }, sourceMs: 3500 }, to: { scene: { id: 'b' } } });
    expect(timeline.transitionAt(2999)).toBeNull();
    expect(timeline.transitionAt(4000)).toBeNull();
    expect(timeline.setTransition('b', null).videoDurationMs).toBe(7000);
  });

  it('keeps transitions within half of each scene as scenes change', () => {
    const timeline = make().setTransition('b', { type: 'wipeleft', durationMs: 5000 });
    expect(timeline.scene('b')?.transition).toEqual({ type: 'wipeleft', durationMs: 1500 });
    expect(timeline.setTransition('a', { type: 'fade', durationMs: 500 }).scene('a')?.transition).toBeNull();
    expect(timeline.moveScene('b', 0).scene('b')?.transition).toBeNull();
    expect(timeline.trimScene('b', { outMs: 6500 }).scene('b')?.transition?.durationMs).toBe(250);
    expect(timeline.trimScene('b', { outMs: 6100 }).scene('b')?.transition).toBeNull();
    // Splitting keeps the transition on the first half; the new cut is a hard cut.
    const split = make().setTransition('b', { type: 'fade', durationMs: 800 }).splitAt(5000);
    expect(split.scenes.map((s) => [s.inMs, s.transition?.durationMs ?? null])).toEqual([
      [0, null],
      [6000, 800],
      [7800, null],
    ]);
    expect(split.setAllTransitions({ type: 'slideup', durationMs: 400 }).scenes.map((s) => s.transition?.type ?? null)).toEqual([null, 'slideup', 'slideup']);
  });

  it('edits audio tracks', () => {
    const timeline = make();
    expect(timeline.setTrackMuted('t1', true).audioTracks[0].muted).toBe(true);
    expect(timeline.removeClip('t1', 'c1').tracks[0].clips).toEqual([]);
    expect(timeline.setTrackMuted('nope', true)).toBe(timeline);
    expect(timeline.toJSON()).toBe(timeline.doc);
  });

  it('adds overlays on the top free overlay track and finds them by time', () => {
    const text = createOverlay('o1', 'text', 1000);
    const one = make().addOverlay(text);
    expect(one.overlayTracks).toEqual([{ id: 'new-1', kind: 'overlay', name: 'Overlay 1', hidden: false, clips: [text] }]);
    expect(one.tracks).toHaveLength(2);

    // Overlapping overlay goes on a new track on top; a later one fits back on the top track.
    const two = one.addOverlay(createOverlay('o2', 'shape', 2000));
    expect(two.overlayTracks.map((t) => t.clips.map((c) => c.id))).toEqual([['o1'], ['o2']]);
    const three = two.addOverlay(createOverlay('o3', 'shape', 6000));
    expect(three.overlayTracks.map((t) => t.clips.map((c) => c.id))).toEqual([['o1'], ['o2', 'o3']]);

    expect(three.overlaysAt(2500).map((o) => [o.clip.id, o.localMs])).toEqual([
      ['o1', 1500],
      ['o2', 500],
    ]);
    expect(three.overlaysAt(4000).map((o) => o.clip.id)).toEqual(['o2']);
    expect(three.overlay('o3')?.track.id).toBe('new-2');
    // Overlays running past the video extend the edit.
    expect(three.durationMs).toBe(9000);
    expect(make().addOverlay(createOverlay('o9', 'text', 9000)).durationMs).toBe(12000);
  });

  it('edits, moves, hides and removes overlays', () => {
    const timeline = make().addOverlay(createOverlay('o1', 'text', 0)).addOverlay(createOverlay('o2', 'text', 500));
    const trackId = timeline.overlayTracks[0].id;
    expect(timeline.updateOverlay('o1', (c) => ({ ...c, width: 0.9 })).overlay('o1')?.clip.width).toBe(0.9);
    expect(timeline.updateOverlay('nope', (c) => c)).toBe(timeline);
    expect(timeline.moveClip(trackId, 'o1', -50).overlay('o1')?.clip.startMs).toBe(0);
    expect(timeline.moveClip(trackId, 'o1', 1234.4).overlay('o1')?.clip.startMs).toBe(1234);
    expect(timeline.setTrackHidden(trackId, true).overlayTracks[0].hidden).toBe(true);
    // setTrackMuted / setTrackHidden only apply to their own track kind.
    expect(timeline.setTrackMuted(trackId, true).overlayTracks[0]).not.toHaveProperty('muted');
    // Removing the last overlay of a track removes the track.
    const removed = timeline.removeClip(trackId, 'o1');
    expect(removed.overlayTracks.map((t) => t.clips.map((c) => c.id))).toEqual([['o2']]);
  });

  it('keeps zooms in source time across splits and transitions', () => {
    const zoom = { id: 'z', startMs: 1000, durationMs: 2000, x: 0.3, y: 0.6, scale: 2, spotlight: false };
    let timeline = make().addZoom('a', zoom);
    expect(timeline.addZoom('a', { ...zoom, id: 'overlap', startMs: 2500 })).toBe(timeline);
    expect(timeline.zoomsAt(2000)).toEqual({ incoming: expect.objectContaining({ zoomId: 'z', scale: 2 }), outgoing: null });

    timeline = timeline.splitAt(2000);
    expect(timeline.scenes.map((s) => s.zooms?.map((z) => z.id))).toEqual([['z'], ['new-1'], undefined]);
    expect(timeline.visibleZooms(timeline.scenes[1])).toHaveLength(1);
    expect(timeline.visibleZooms(timeline.scene('b')!)).toEqual([]);

    // During a transition the outgoing scene keeps its zoom.
    timeline = timeline.setTransition(timeline.scenes[1].id, { type: 'fade', durationMs: 500 });
    expect(timeline.zoomsAt(1800).outgoing).toMatchObject({ zoomId: 'z' });

    timeline = timeline.updateZoom('z', { scale: 3, durationMs: 100 }).removeZoom('new-1');
    expect(timeline.zoom('z')?.zoom).toMatchObject({ scale: 3, durationMs: 500 });
    expect(timeline.zoom('new-1')).toBeUndefined();
    expect(timeline.setZooms('a', [{ ...zoom, id: 'late', startMs: 3000 }, zoom]).scenes[0].zooms?.map((z) => z.id)).toEqual(['z', 'late']);
  });
});
