import { clipLength, type AudioSource, type PlacedScene, type Timeline } from './Timeline';
import { transitionVolumes, type TransitionType } from './transitions';

/** The parts of a media element the player drives; real <video>/<audio> elements satisfy it. */
export type PlayerMedia = Pick<HTMLMediaElement, 'src' | 'currentTime' | 'muted' | 'volume' | 'paused' | 'play' | 'pause'>;

/** Index of one of the two video elements; scenes alternate between them so the next one can load ahead. */
export type VideoSlot = 0 | 1;

export interface PlayerClock {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export interface PlayerState {
  timeMs: number;
  playing: boolean;
  /** The scene on screen (the incoming one during a transition), or null after the last scene. */
  sceneId: string | null;
  /** The video element showing `sceneId`; during a transition the other one shows the outgoing scene. */
  slot: VideoSlot;
  transition: { type: TransitionType; progress: number } | null;
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

const slotOf = (index: number): VideoSlot => (index % 2 === 0 ? 0 : 1);

/**
 * Plays a Timeline in the browser. Two <video> elements take turns: even scenes play in one, odd scenes
 * in the other, so the next scene is loaded and cued while the current one plays, and both can show
 * during a transition. One audio element per audio clip follows along. A wall clock drives the
 * playhead; media elements are corrected when they drift.
 */
export class TimelinePlayer {
  private timeline: Timeline | null = null;
  private timeMs = 0;
  private playing = false;
  private sceneId: string | null = null;
  private slot: VideoSlot = 0;
  private transition: PlayerState['transition'] = null;
  private startedAt = 0;
  private startedFrom = 0;
  private frame: number | null = null;
  private readonly videoUrls: [string | null, string | null] = [null, null];
  private readonly audio = new Map<string, { element: PlayerMedia; url: string | null }>();
  private readonly listeners = new Set<(state: PlayerState) => void>();
  private readonly clock: PlayerClock;
  private readonly createAudio: () => PlayerMedia;

  constructor(
    private readonly videos: readonly [PlayerMedia, PlayerMedia],
    private readonly options: PlayerOptions,
  ) {
    this.clock = options.clock ?? browserClock;
    this.createAudio = options.createAudio ?? (() => new Audio());
  }

  get state(): PlayerState {
    return { timeMs: this.timeMs, playing: this.playing, sceneId: this.sceneId, slot: this.slot, transition: this.transition };
  }

  /** Swaps in an edited timeline, keeping the playhead (clamped to the new length). */
  setTimeline(timeline: Timeline): void {
    this.timeline = timeline;
    for (const [id, entry] of this.audio) {
      if (!timeline.audioTracks.some((t) => t.clips.some((c) => c.id === id))) {
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
    this.videos.forEach((video) => video.pause());
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
    const transition = timeline?.transitionAt(this.timeMs) ?? null;
    this.sceneId = hit?.scene.id ?? null;
    this.slot = hit ? slotOf(hit.index) : this.slot;
    this.transition = transition && { type: transition.type, progress: transition.progress };
    const volumes = transition ? transitionVolumes(transition.type, transition.progress) : { from: 1, to: 1 };

    // Each slot shows the scene on screen, the scene being transitioned away from, or cues the next one.
    const next = timeline && hit ? timeline.placements()[hit.index + 1] : undefined;
    for (const slot of [0, 1] as const) {
      if (hit && slotOf(hit.index) === slot) this.showScene(slot, hit, hit.sourceMs, volumes.to, tolerance);
      else if (transition && slotOf(transition.from.index) === slot) this.showScene(slot, transition.from, transition.from.sourceMs, volumes.from, tolerance);
      else if (next && slotOf(next.index) === slot) this.cueScene(slot, next);
      else if (!this.videos[slot].paused) this.videos[slot].pause();
    }

    for (const track of timeline?.audioTracks ?? []) {
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

  /** Plays (or holds, when paused) `placed` in `slot` at `sourceMs`. */
  private showScene(slot: VideoSlot, placed: PlacedScene, sourceMs: number, volume: number, tolerance: number): void {
    const video = this.videos[slot];
    if (!this.load(slot, placed)) {
      if (!video.paused) video.pause();
      return;
    }
    video.muted = placed.scene.muted;
    video.volume = volume;
    follow(video, sourceMs / 1000, this.playing, tolerance);
  }

  /** Loads the scene that comes next and parks it on its first frame. */
  private cueScene(slot: VideoSlot, placed: PlacedScene): void {
    if (this.load(slot, placed)) follow(this.videos[slot], placed.scene.inMs / 1000, false, PLAYING_DRIFT_S);
  }

  /** Points the slot's element at the scene's file; false when the file can't be played. */
  private load(slot: VideoSlot, placed: PlacedScene): boolean {
    const url = this.options.resolveUrl({ type: 'media', mediaId: placed.scene.mediaId });
    if (url && url !== this.videoUrls[slot]) {
      this.videos[slot].src = url;
      this.videoUrls[slot] = url;
    }
    return url !== null;
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
