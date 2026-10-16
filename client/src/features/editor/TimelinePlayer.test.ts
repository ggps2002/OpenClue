import { describe, expect, it } from 'vitest';
import { Timeline } from './Timeline';
import { TimelinePlayer, type PlayerClock, type PlayerMedia } from './TimelinePlayer';

class FakeMedia implements PlayerMedia {
  src = '';
  currentTime = 0;
  muted = false;
  paused = true;
  play = () => {
    this.paused = false;
    return Promise.resolve();
  };
  pause = () => {
    this.paused = true;
  };
}

class FakeClock implements PlayerClock {
  time = 0;
  private callbacks = new Map<number, () => void>();
  private nextId = 1;
  now = () => this.time;
  requestFrame = (callback: () => void) => {
    this.callbacks.set(this.nextId, callback);
    return this.nextId++;
  };
  cancelFrame = (id: number) => {
    this.callbacks.delete(id);
  };
  /** Moves time forward and runs the pending frame. */
  advance(ms: number) {
    this.time += ms;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    pending.forEach((callback) => callback());
  }
}

const timeline = new Timeline({
  version: 1,
  scenes: [
    { id: 'a', name: 'Intro', mediaId: 'm1', inMs: 1000, outMs: 3000, muted: true },
    { id: 'b', name: 'Demo', mediaId: 'm2', inMs: 0, outMs: 2000, muted: false },
  ],
  tracks: [
    { id: 't1', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 1000, inMs: 500, outMs: 4500 }] },
  ],
});

function setup() {
  const video = new FakeMedia();
  const clock = new FakeClock();
  const audios: FakeMedia[] = [];
  const player = new TimelinePlayer(video, {
    clock,
    resolveUrl: (source) => (source.type === 'voiceover' ? '/vo.mp3' : `/media/${source.mediaId}`),
    createAudio: () => {
      const audio = new FakeMedia();
      audios.push(audio);
      return audio;
    },
  });
  player.setTimeline(timeline);
  return { player, video, clock, audios };
}

describe('TimelinePlayer', () => {
  it('shows the first scene at its in point when loaded', () => {
    const { player, video, audios } = setup();
    expect(player.state).toEqual({ timeMs: 0, playing: false, sceneId: 'a' });
    expect(video).toMatchObject({ src: '/media/m1', currentTime: 1, muted: true, paused: true });
    expect(audios[0]).toMatchObject({ src: '/vo.mp3', paused: true });
  });

  it('plays through scenes, switching the video source and starting audio clips on time', () => {
    const { player, video, clock, audios } = setup();
    const states: string[] = [];
    player.subscribe((s) => states.push(`${s.timeMs}:${s.sceneId}`));
    player.play();
    expect(video.paused).toBe(false);
    expect(audios[0].paused).toBe(true);

    video.currentTime = 2.5;
    clock.advance(1500);
    expect(audios[0]).toMatchObject({ paused: false, currentTime: 1 });

    clock.advance(1000);
    expect(player.state.sceneId).toBe('b');
    expect(video).toMatchObject({ src: '/media/m2', currentTime: 0.5, muted: false, paused: false });

    clock.advance(2000);
    expect(player.state).toEqual({ timeMs: 4500, playing: true, sceneId: null });
    expect(video.paused).toBe(true);
    expect(audios[0].paused).toBe(false);

    clock.advance(1000);
    expect(player.state.playing).toBe(false);
    expect(audios[0].paused).toBe(true);
    expect(states).toContain('2500:b');
  });

  it('seeks and pauses every element', () => {
    const { player, video, audios } = setup();
    player.seek(3200);
    expect(video).toMatchObject({ src: '/media/m2', currentTime: 1.2 });
    expect(audios[0].currentTime).toBeCloseTo(2.7);
    player.play();
    player.pause();
    expect(video.paused).toBe(true);
    expect(audios[0].paused).toBe(true);
    player.seek(99999);
    expect(player.state.timeMs).toBe(5000);
    player.play();
    expect(player.state.timeMs).toBe(0);
  });

  it('keeps muted tracks silent and drops audio for removed clips', () => {
    const { player, clock, audios } = setup();
    player.setTimeline(timeline.setTrackMuted('t1', true));
    player.seek(1500);
    player.play();
    clock.advance(100);
    expect(audios[0].paused).toBe(true);

    player.setTimeline(timeline.removeClip('t1', 'c1'));
    player.setTimeline(timeline);
    expect(audios).toHaveLength(2);
    player.destroy();
    expect(audios[1].paused).toBe(true);
  });
});
