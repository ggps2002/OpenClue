import { describe, expect, it } from 'vitest';
import { addKeyframe, createOverlay, fadeInOut, removeKeyframe, setDuration, setValuesAt, updateKeyframe, valuesAt, type OverlayClip } from './overlays';

const k = (t: number, x: number, opacity = 1) => ({ t, x, y: 0.5, scale: 1, opacity, easing: 'linear' as const });

function animated(): OverlayClip {
  return { ...createOverlay('o1', 'shape', 0), durationMs: 2000, keyframes: [k(0, 0), k(1000, 1), k(2000, 1, 0)] };
}

describe('overlay keyframes', () => {
  it('interpolates between keyframes and holds outside them', () => {
    const clip = animated();
    expect(valuesAt(clip, -100).x).toBe(0);
    expect(valuesAt(clip, 250).x).toBeCloseTo(0.25);
    expect(valuesAt(clip, 1500)).toMatchObject({ x: 1, opacity: 0.5 });
    expect(valuesAt(clip, 5000)).toEqual({ x: 1, y: 0.5, scale: 1, opacity: 0 });

    const smooth = updateKeyframe(clip, 0, { easing: 'easeInOut' });
    expect(valuesAt(smooth, 250).x).toBeCloseTo(0.15625);
    expect(valuesAt(smooth, 500).x).toBeCloseTo(0.5);
  });

  it('edits the only keyframe of a static overlay, otherwise the one under the playhead or a new one', () => {
    const still = createOverlay('o1', 'text', 0);
    const moved = setValuesAt(still, 1500, { x: 0.2, y: 3 });
    expect(moved.keyframes).toEqual([{ ...still.keyframes[0], x: 0.2, y: 2 }]);

    const clip = animated();
    expect(setValuesAt(clip, 1030, { scale: 2 }).keyframes.map((f) => [f.t, f.scale])).toEqual([
      [0, 1],
      [1000, 2],
      [2000, 1],
    ]);
    const added = setValuesAt(clip, 500, { y: 0.9 });
    expect(added.keyframes.map((f) => f.t)).toEqual([0, 500, 1000, 2000]);
    expect(added.keyframes[1]).toMatchObject({ x: 0.5, y: 0.9, opacity: 1 });
  });

  it('adds and removes keyframes but always keeps one', () => {
    const clip = addKeyframe(createOverlay('o1', 'text', 0), 1200.4);
    expect(clip.keyframes.map((f) => f.t)).toEqual([0, 1200]);
    expect(addKeyframe(clip, 1200)).toBe(clip);
    expect(addKeyframe(clip, 99_999).keyframes.at(-1)?.t).toBe(clip.durationMs);
    const one = removeKeyframe(clip, 0);
    expect(one.keyframes.map((f) => f.t)).toEqual([1200]);
    expect(removeKeyframe(one, 1200)).toBe(one);
  });

  it('drops keyframes past a shortened end and builds a fade', () => {
    const short = setDuration(animated(), 1500);
    expect(short.durationMs).toBe(1500);
    expect(short.keyframes.map((f) => f.t)).toEqual([0, 1000]);
    expect(setDuration({ ...animated(), keyframes: [k(800, 0)] }, 500).keyframes.map((f) => f.t)).toEqual([500]);

    const fade = fadeInOut(animated());
    expect(fade.keyframes.map((f) => [f.t, f.opacity, f.x])).toEqual([
      [0, 0, 0],
      [300, 1, 0],
      [1700, 1, 0],
      [2000, 0, 0],
    ]);
  });
});
