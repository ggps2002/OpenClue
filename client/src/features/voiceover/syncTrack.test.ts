import { describe, expect, it, vi } from 'vitest';
import { syncTrack } from './syncTrack';

function fakeMedia(paused = true) {
  const el = document.createElement('video');
  Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  el.play = play;
  el.pause = pause;
  return { el, play, pause, setPaused: (value: boolean) => (paused = value) };
}

describe('syncTrack', () => {
  it('mirrors play, pause, seek and speed, and restores muting', () => {
    const media = fakeMedia();
    const track = fakeMedia();
    media.el.muted = false;
    const stop = syncTrack(media.el, track.el);
    expect(media.el.muted).toBe(true);

    media.el.currentTime = 4;
    media.el.dispatchEvent(new Event('play'));
    expect(track.el.currentTime).toBe(4);
    expect(track.play).toHaveBeenCalledTimes(1);

    track.el.currentTime = 4.1;
    media.el.currentTime = 4.2;
    media.el.dispatchEvent(new Event('timeupdate'));
    expect(track.el.currentTime).toBe(4.1); // small drift is left alone

    media.el.currentTime = 9;
    media.el.dispatchEvent(new Event('seeked'));
    expect(track.el.currentTime).toBe(9);

    media.el.playbackRate = 1.5;
    media.el.dispatchEvent(new Event('ratechange'));
    expect(track.el.playbackRate).toBe(1.5);

    media.el.dispatchEvent(new Event('pause'));
    expect(track.pause).toHaveBeenCalledTimes(1);

    stop();
    expect(media.el.muted).toBe(false);
    media.el.dispatchEvent(new Event('play'));
    expect(track.play).toHaveBeenCalledTimes(1);
  });

  it('starts the track right away when the media is already playing', () => {
    const media = fakeMedia(false);
    const track = fakeMedia();
    syncTrack(media.el, track.el);
    expect(track.play).toHaveBeenCalledTimes(1);
  });
});
