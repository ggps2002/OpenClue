import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeMediaRecorder, fakeEnvironment } from './test-fakes';
import { ScreenRecorder } from './ScreenRecorder';

afterEach(() => vi.unstubAllGlobals());

function click(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }));
}

describe('ScreenRecorder', () => {
  it('picks the first supported MIME type', () => {
    expect(ScreenRecorder.pickMimeType((t) => t === 'video/webm' || t === 'video/mp4')).toBe('video/webm');
    expect(ScreenRecorder.pickMimeType(() => false)).toBe('');
  });

  it('records screen and mic, tracks paused time and captures clicks', async () => {
    const { env, clock, videoTrack, micTrack } = fakeEnvironment();
    const recorder = new ScreenRecorder(env);
    const states: string[] = [];
    recorder.subscribe((s) => states.push(s));

    await recorder.start({ microphone: true, systemAudio: false });
    expect(FakeMediaRecorder.last?.mimeType).toBe('video/webm');

    clock.now = 1000;
    click(window.innerWidth / 2, window.innerHeight / 4);
    clock.now = 2000;
    recorder.pause();
    clock.now = 5000;
    click(10, 10); // ignored while paused
    recorder.resume();
    clock.now = 6500;
    expect(recorder.elapsedMs()).toBe(3500);

    const result = await recorder.stop();
    expect(states).toEqual(['requesting', 'recording', 'paused', 'recording', 'stopped']);
    expect(result).toMatchObject({
      mimeType: 'video/webm',
      durationMs: 3500,
      width: 1920,
      height: 1080,
      surface: 'browser',
      hasAudio: true,
      clicks: [{ t: 1000, x: 0.5, y: 0.25 }],
    });
    expect(result.blob.size).toBeGreaterThan(0);
    expect(videoTrack.stopped && micTrack.stopped).toBe(true);

    // Listeners are removed once stopped.
    click(1, 1);
    expect(recorder.clickCount).toBe(1);
  });

  it('stops when the user ends sharing from the browser UI', async () => {
    const { env, clock, videoTrack } = fakeEnvironment({ surface: 'monitor' });
    const recorder = new ScreenRecorder(env);
    await recorder.start({ microphone: false, systemAudio: true });
    clock.now = 2000;
    videoTrack.dispatchEvent(new Event('ended'));
    expect(recorder.state).toBe('stopped');
    const result = await recorder.stop();
    expect(result).toMatchObject({ durationMs: 2000, surface: 'monitor', hasAudio: false });
  });

  it('returns to idle and releases the screen when the mic is denied', async () => {
    const { env, videoTrack } = fakeEnvironment({ micDenied: true });
    const recorder = new ScreenRecorder(env);
    await expect(recorder.start({ microphone: true, systemAudio: false })).rejects.toThrow('Permission denied');
    expect(recorder.state).toBe('idle');
    expect(videoTrack.stopped).toBe(true);
    await expect(recorder.stop()).rejects.toThrow('Nothing is being recorded');
  });

  it('cancel discards the recording', async () => {
    const { env } = fakeEnvironment();
    const recorder = new ScreenRecorder(env);
    await recorder.start({ microphone: false, systemAudio: false });
    recorder.cancel();
    expect(recorder.state).toBe('idle');
    await expect(recorder.stop()).rejects.toThrow();
  });
});
