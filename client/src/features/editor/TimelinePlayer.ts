import { clipLength, type AudioSource, type Timeline } from './Timeline';

/** The parts of a media element the player drives; real <video>/<audio> elements satisfy it. */
export type PlayerMedia = Pick<HTMLMediaElement, 'src' | 'currentTime' | 'muted' | 'paused' | 'play' | 'pause'>;

export interface PlayerClock {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export interface PlayerState {
  timeMs: number;
  playing: boolean;
  /** The scene on screen, or null after the last scene (audio may still be playing). */
  sceneId: string | null;
}

export interface PlayerOptions {
  /** URL of a source video or audio file; null when it can't be played (e.g. removed from the project). */
  resolveUrl(source: AudioSource): string | null;
  createAudio?: () => PlayerMedia;
  clock?: PlayerClock;
}

/** How far (seconds) a playing element may drift from the timeline clock before it is re-seeked. */
const PLAYING_DRIFT_S = 0.3;
const PAUSED_DRIFT_S = 0.02;

const browserClock: PlayerClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
};

/**
 * Plays a Timeline in the browser: one <video> element shows whichever scene is under the playhead
 * (switching source and seeking as scenes change), and one audio element per audio clip follows along.
 * A wall clock drives the playhead; media elements are corrected when they drift.
 */
export class TimelinePlayer {
  private timeline: Timeline | null = null;
  private timeMs = 0;
  private playing = false;
  private sceneId: string | null = null;
  private startedAt = 0;
  private startedFrom = 0;
  private frame: number | null = null;
  private videoUrl: string | null = null;
  private readonly audio = new Map<string, { element: PlayerMedia; url: string | null }>();
  private readonly listeners = new Set<(state: PlayerState) => void>();
  private readonly clock: PlayerClock;
  private readonly createAudio: () => PlayerMedia;

  constructor(
    private readonly video: PlayerMedia,
    private readonly options: PlayerOptions,
  ) {
    this.clock = options.clock ?? browserClock;
    this.createAudio = options.createAudio ?? (() => new Audio());
  }

  get state(): PlayerState {
    return { timeMs: this.timeMs, playing: this.playing, sceneId: this.sceneId };
  }

  /** Swaps in an edited timeline, keeping the playhead (clamped to the new length). */
  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    for (const [id, entry] of this.audio) {
      if (!timeline.tracks.some((t) => t.clips.some((c) => c.id === id))) {
        entry.element.pause();
        this.audio.delete(id);
      }
    }
    this.seek(Math.min(this.currentTime(), timeline.durationMs));
  }

  play(): void {
    if (this.playing || !this.timeline) return;
    if (this.timeMs >= this.timeline.durationMs) this.timeMs = 0;
    this.playing = true;
    this.startedAt = this.clock.now();
    this.startedFrom = this.timeMs;
    this.render(true);
    this.schedule();
  }

  pause(): void {
    if (!this.playing) return;
    this.timeMs = this.currentTime();
    this.playing = false;
    this.cancel();
    this.render(true);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(timeMs: number): void {
    const duration = this.timeline?.durationMs ?? 0;
    this.timeMs = Math.max(0, Math.min(duration, timeMs));
    this.startedAt = this.clock.now();
    this.startedFrom = this.timeMs;
    this.render(true);
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.cancel();
    this.playing = false;
    this.video.pause();
    this.audio.forEach(({ element }) => element.pause());
    this.audio.clear();
    this.listeners.clear();
  }

  private currentTime(): number {
    return this.playing ? this.startedFrom + (this.clock.now() - this.startedAt) : this.timeMs;
  }

  private schedule(): void {
    this.frame = this.clock.requestFrame(() => this.tick());
  }

  private cancel(): void {
    if (this.frame !== null) this.clock.cancelFrame(this.frame);
    this.frame = null;
  }

  private tick(): void {
    this.frame = null;
    if (!this.playing || !this.timeline) return;
    this.timeMs = Math.min(this.currentTime(), this.timeline.durationMs);
    if (this.timeMs >= this.timeline.durationMs) {
      this.playing = false;
      this.render(true);
      return;
    }
    this.render(false);
    this.schedule();
  }

  /** Points every media element at the current time. `exact` uses the tight drift tolerance (seeks, pauses). */
  private render(exact: boolean): void {
    const tolerance = exact || !this.playing ? PAUSED_DRIFT_S : PLAYING_DRIFT_S;
    const timeline = this.timeline;
    const hit = timeline?.sceneAt(this.timeMs) ?? null;
    this.sceneId = hit?.scene.id ?? null;

    const url = hit ? this.options.resolveUrl({ type: 'media', mediaId: hit.scene.mediaId }) : null;
    if (hit && url) {
      if (url !== this.videoUrl) {
        this.video.src = url;
        this.videoUrl = url;
      }
      this.video.muted = hit.scene.muted;
      follow(this.video, hit.sourceMs / 1000, this.playing, tolerance);
    } else if (!this.video.paused) {
      this.video.pause();
    }

    for (const track of timeline?.tracks ?? []) {
      for (const clip of track.clips) {
        const entry = this.audioFor(clip.id, clip.source);
        const offset = this.timeMs - clip.startMs;
        const active = !track.muted && entry.url !== null && offset >= 0 && offset < clipLength(clip);
        if (active) follow(entry.element, (clip.inMs + offset) / 1000, this.playing, tolerance);
        else if (!entry.element.paused) entry.element.pause();
      }
    }
    const state = this.state;
    this.listeners.forEach((listener) => listener(state));
  }

  private audioFor(clipId: string, source: AudioSource) {
    let entry = this.audio.get(clipId);
    const url = this.options.resolveUrl(source);
    if (!entry) {
      entry = { element: this.createAudio(), url: null };
      this.audio.set(clipId, entry);
    }
    if (entry.url !== url) {
      if (url) entry.element.src = url;
      entry.url = url;
    }
    return entry;
  }
}

/** Seeks `media` to `seconds` if it drifted and matches the play state. */
function follow(media: PlayerMedia, seconds: number, playing: boolean, tolerance: number): void {
  if (Math.abs(media.currentTime - seconds) > tolerance) media.currentTime = seconds;
  if (playing && media.paused) void media.play()?.catch(() => undefined);
  if (!playing && !media.paused) media.pause();
}
