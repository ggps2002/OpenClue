import { describe, expect, it } from 'vitest';
import { fitTransition, fitTransitions, maxTransitionMs, transitionStyles, transitionVolumes } from './transitions';

describe('transitions', () => {
  it('limits a transition to half of the shorter scene and the overall maximum', () => {
    expect(maxTransitionMs(4000, 1000)).toBe(500);
    expect(maxTransitionMs(60_000, 60_000)).toBe(5000);
    expect(fitTransition({ type: 'fade', durationMs: 900 }, 4000, 1000)).toEqual({ type: 'fade', durationMs: 500 });
    expect(fitTransition({ type: 'fade', durationMs: 20 }, 4000, 4000)).toEqual({ type: 'fade', durationMs: 100 });
    expect(fitTransition({ type: 'fade', durationMs: 300 }, 150, 4000)).toBeNull();
    const keep = { type: 'fade' as const, durationMs: 300 };
    expect(fitTransition(keep, 4000, 4000)).toBe(keep);
  });

  it('drops the first scene transition', () => {
    const scenes = [
      { inMs: 0, outMs: 1000, transition: { type: 'fade' as const, durationMs: 200 } },
      { inMs: 0, outMs: 1000, transition: { type: 'fade' as const, durationMs: 200 } },
    ];
    const fitted = fitTransitions(scenes);
    expect(fitted[0].transition).toBeNull();
    expect(fitted[1]).toBe(scenes[1]);
  });

  it('styles both layers through each transition', () => {
    expect(transitionStyles('fade', 0.25)).toEqual({ from: { opacity: 1 }, to: { opacity: 0.25 } });
    expect(transitionStyles('fadeblack', 0.25)).toEqual({ from: { opacity: 0.5 }, to: { opacity: 0 } });
    expect(transitionStyles('fadeblack', 0.75)).toEqual({ from: { opacity: 0 }, to: { opacity: 0.5 } });
    expect(transitionStyles('wipeleft', 0.25).to.clipPath).toBe('inset(0 0 0 75.00%)');
    expect(transitionStyles('wiperight', 0.25).to.clipPath).toBe('inset(0 75.00% 0 0)');
    expect(transitionStyles('slideleft', 0.5)).toEqual({
      from: { opacity: 1, transform: 'translateX(-50.00%)' },
      to: { opacity: 1, transform: 'translateX(50.00%)' },
    });
    expect(transitionStyles('slideup', 2).to.transform).toBe('translateY(0.00%)');
  });

  it('crossfades sound, or dips it for fade through black', () => {
    expect(transitionVolumes('fade', 0.25)).toEqual({ from: 0.75, to: 0.25 });
    expect(transitionVolumes('fadeblack', 0.25)).toEqual({ from: 0.5, to: 0 });
  });
});
