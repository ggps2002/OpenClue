import { describe, expect, it } from 'vitest';
import { frameToVideo, spotlightBackground, splitZooms, updateZoom, videoToFrame, zoomAt, zoomsFromClicks, zoomSlotAt, zoomStyles, zoomWindow, type Zoom } from './zooms';

const zoom = (id: string, startMs: number, durationMs = 2000, overrides: Partial<Zoom> = {}): Zoom => ({
  id,
  startMs,
  durationMs,
  x: 0.25,
  y: 0.25,
  scale: 2,
  spotlight: true,
  ...overrides,
});

const ids = () => {
  let n = 0;
  return () => `z${++n}`;
};

describe('zoom maths', () => {
  it('eases in, holds and eases out', () => {
    const zooms = [zoom('a', 1000)];
    expect(zoomAt(zooms, 999)).toBeNull();
    expect(zoomAt(zooms, 1000)).toMatchObject({ zoomId: 'a', scale: 1, spotlight: 0 });
    expect(zoomAt(zooms, 1300)?.scale).toBeCloseTo(1.5);
    expect(zoomAt(zooms, 2000)).toMatchObject({ scale: 2, spotlight: 1 });
    expect(zoomAt(zooms, 2700)?.scale).toBeCloseTo(1.5);
    expect(zoomAt(zooms, 3000)).toBeNull();
    expect(zoomAt([zoom('b', 0, 2000, { spotlight: false })], 1000)?.spotlight).toBe(0);
  });

  it('maps the source picture into the letterboxed 16:9 frame and back', () => {
    expect(videoToFrame({ x: 0.5, y: 0.5 }, 4 / 3)).toEqual({ x: 0.5, y: 0.5 });
    // A 4:3 video is pillarboxed: it is 75% of the frame width.
    expect(videoToFrame({ x: 0, y: 1 }, 4 / 3)).toEqual({ x: 0.125, y: 1 });
    expect(frameToVideo({ x: 0.125, y: 1 }, 4 / 3)).toEqual({ x: 0, y: 1 });
    expect(frameToVideo({ x: 0, y: 0.5 }, 4 / 3)).toEqual({ x: 0, y: 0.5 });
    expect(videoToFrame({ x: 1, y: 0 }, 16 / 9)).toEqual({ x: 1, y: 0 });
  });

  it('keeps the zoomed view inside the frame', () => {
    expect(zoomWindow({ x: 0.1, y: 0.9 }, 2)).toEqual({ x: 0.25, y: 0.75, size: 0.5 });
    expect(zoomWindow({ x: 0.1, y: 0.9 }, 1)).toEqual({ x: 0.5, y: 0.5, size: 1 });
    const styles = zoomStyles({ zoomId: 'a', x: 0.5, y: 0.5, scale: 2, spotlight: 1 }, 16 / 9);
    expect(styles.transform).toBe('translate(-50.000%, -50.000%) scale(2.0000)');
    expect(styles.spotlight).toMatchObject({ x: 0.5, y: 0.5, radius: 0.2 });
    // Near a corner the view stops at the edge, so the focus point is off centre on screen.
    expect(zoomStyles({ zoomId: 'a', x: 0, y: 0, scale: 2, spotlight: 1 }, 16 / 9).spotlight).toMatchObject({ x: 0, y: 0 });
    expect(spotlightBackground(styles.spotlight)).toContain('at 50.00% 50.00%');
  });

  it('groups nearby clicks into zooms and keeps them apart', () => {
    const clicks = [
      { t: 1000, x: 0.2, y: 0.2 },
      { t: 1800, x: 0.25, y: 0.22 },
      // Far away, so a new zoom that has to meet the first one halfway.
      { t: 3000, x: 0.8, y: 0.8 },
      // Outside the scene.
      { t: 9500, x: 0.5, y: 0.5 },
    ];
    const zooms = zoomsFromClicks(clicks, { inMs: 0, outMs: 9000 }, ids());
    expect(zooms).toEqual([
      { id: 'z1', startMs: 300, durationMs: 2500, x: 0.225, y: 0.21, scale: 1.8, spotlight: false },
      { id: 'z2', startMs: 2800, durationMs: 1700, x: 0.8, y: 0.8, scale: 1.8, spotlight: false },
    ]);
    // Clicks at the very end of the scene leave no room for a zoom.
    expect(zoomsFromClicks([{ t: 8900, x: 0.5, y: 0.5 }], { inMs: 0, outMs: 9000 }, ids())).toEqual([
      expect.objectContaining({ startMs: 8200, durationMs: 800 }),
    ]);
    expect(zoomsFromClicks([{ t: 100, x: 0.5, y: 0.5 }], { inMs: 0, outMs: 300 }, ids())).toEqual([]);
  });

  it('finds room for a new zoom and keeps edits between neighbours', () => {
    const zooms = [zoom('a', 1000), zoom('b', 5000)];
    expect(zoomSlotAt(zooms, 1500, { inMs: 0, outMs: 9000 })).toBeNull();
    expect(zoomSlotAt(zooms, 3200, { inMs: 0, outMs: 9000 })).toEqual({ startMs: 3200, durationMs: 1800 });
    expect(zoomSlotAt(zooms, 4700, { inMs: 0, outMs: 9000 })).toBeNull();
    expect(zoomSlotAt(zooms, 8000, { inMs: 0, outMs: 9000 })).toEqual({ startMs: 8000, durationMs: 1000 });

    expect(updateZoom(zooms, 'a', { durationMs: 9000 })[0].durationMs).toBe(4000);
    expect(updateZoom(zooms, 'b', { startMs: 0 })[1].startMs).toBe(3000);
    expect(updateZoom(zooms, 'b', { scale: 9, x: -1 }, 6000)[1]).toMatchObject({ scale: 4, x: 0, durationMs: 1000 });
  });

  it('splits zooms at a cut, copying the one spanning it', () => {
    const [first, second] = splitZooms([zoom('a', 0), zoom('b', 3000), zoom('c', 6000)], 4000, ids());
    expect(first?.map((z) => z.id)).toEqual(['a', 'b']);
    expect(second?.map((z) => z.id)).toEqual(['z1', 'c']);
    expect(splitZooms(undefined, 4000, ids())).toEqual([undefined, undefined]);
  });
});
