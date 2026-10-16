import type { OverlayClip, OverlayTrack } from './overlays';
import { fitTransitions, type Transition, type TransitionType } from './transitions';

/** Mirrors server/src/modules/timelines/timelines.schema.ts. */
export interface Scene {
  id: string;
  name: string;
  mediaId: string;
  inMs: number;
  outMs: number;
  /** Silences the video's own sound. */
  muted: boolean;
  /** Transition from the previous scene into this one; absent or null is a hard cut. */
  transition?: Transition | null;
}

export type AudioSource = { type: 'voiceover' } | { type: 'media'; mediaId: string };

export interface AudioClip {
  id: string;
  source: AudioSource;
  /** Where the clip starts on the timeline. */
  startMs: number;
  inMs: number;
  outMs: number;
}

export interface AudioTrack {
  id: string;
  kind: 'audio';
  name: string;
  muted: boolean;
  clips: AudioClip[];
}

export type Track = AudioTrack | OverlayTrack;

export interface TimelineDoc {
  version: 1;
  scenes: Scene[];
  /** Audio and overlay tracks; later overlay tracks are drawn on top. */
  tracks: Track[];
}

/** A scene with its position on the timeline. */
export interface PlacedScene {
  scene: Scene;
  index: number;
  startMs: number;
  endMs: number;
}

/** Two scenes overlapping while one takes over from the other. */
export interface ActiveTransition {
  type: TransitionType;
  from: PlacedScene & { sourceMs: number };
  to: PlacedScene & { sourceMs: number };
  /** 0 at the start of the overlap, approaching 1 at its end. */
  progress: number;
}

export const MIN_CLIP_MS = 100;

export const clipLength = (clip: { inMs: number; outMs: number }) => clip.outMs - clip.inMs;

const defaultId = () => crypto.randomUUID();

/**
 * The edit of a video: scenes (cuts of source videos) that play back to back, plus audio and overlay
 * tracks laid over them. Immutable: every edit returns a new Timeline, which keeps undo/redo and React state simple.
 */
export class Timeline {
  constructor(
    readonly doc: TimelineDoc,
    private readonly createId: () => string = defaultId,
  ) {}

  get scenes(): Scene[] {
    return this.doc.scenes;
  }

  get tracks(): Track[] {
    return this.doc.tracks;
  }

  get audioTracks(): AudioTrack[] {
    return this.doc.tracks.filter((t): t is AudioTrack => t.kind === 'audio');
  }

  get overlayTracks(): OverlayTrack[] {
    return this.doc.tracks.filter((t): t is OverlayTrack => t.kind === 'overlay');
  }

  /** Length of the scenes played back to back (transitions overlap neighbours, so they shorten it). */
  get videoDurationMs(): number {
    return this.placements().at(-1)?.endMs ?? 0;
  }

  /** The whole edit, including audio or overlays that run past the last scene. */
  get durationMs(): number {
    const audioEnd = Math.max(0, ...this.audioTracks.flatMap((t) => t.clips.map((c) => c.startMs + clipLength(c))));
    const overlayEnd = Math.max(0, ...this.overlayTracks.flatMap((t) => t.clips.map((c) => c.startMs + c.durationMs)));
    return Math.max(this.videoDurationMs, audioEnd, overlayEnd);
  }

  /** Where each scene plays; a scene with a transition starts that much before the previous one ends. */
  placements(): PlacedScene[] {
    let endMs = 0;
    return this.doc.scenes.map((scene, index) => {
      const startMs = endMs - (index > 0 ? (scene.transition?.durationMs ?? 0) : 0);
      endMs = startMs + clipLength(scene);
      return { scene, index, startMs, endMs };
    });
  }

  scene(id: string): Scene | undefined {
    return this.doc.scenes.find((s) => s.id === id);
  }

  placement(id: string): PlacedScene | undefined {
    return this.placements().find((p) => p.scene.id === id);
  }

  /**
   * The scene playing at `timeMs` and the matching time in its source video; null after the last scene.
   * During a transition this is the incoming scene.
   */
  sceneAt(timeMs: number): (PlacedScene & { sourceMs: number }) | null {
    const placed = [...this.placements()].reverse().find((p) => timeMs >= p.startMs && timeMs < p.endMs);
    return placed ? withSource(placed, timeMs) : null;
  }

  /** The transition in progress at `timeMs`, if any. */
  transitionAt(timeMs: number): ActiveTransition | null {
    const to = this.sceneAt(timeMs);
    const transition = to?.scene.transition;
    if (!to || !transition || to.index === 0) return null;
    const from = this.placements()[to.index - 1];
    if (timeMs >= from.endMs) return null;
    return { type: transition.type, from: withSource(from, timeMs), to, progress: (timeMs - to.startMs) / transition.durationMs };
  }

  /** Sets (or with null removes) the transition into a scene, fitted to the scenes it joins. */
  setTransition(sceneId: string, transition: Transition | null): Timeline {
    return this.updateScene(sceneId, (scene) => ({ ...scene, transition }));
  }

  /** Puts the same transition on every cut between scenes. */
  setAllTransitions(transition: Transition | null): Timeline {
    return this.with({ scenes: this.doc.scenes.map((scene, i) => (i === 0 ? scene : { ...scene, transition })) });
  }

  /** True when `timeMs` falls inside a scene with room for a minimum-length scene on both sides. */
  canSplitAt(timeMs: number): boolean {
    const hit = this.sceneAt(timeMs);
    return Boolean(hit && timeMs - hit.startMs >= MIN_CLIP_MS && hit.endMs - timeMs >= MIN_CLIP_MS);
  }

  /** Cuts the scene under `timeMs` in two; the second half gets a new id. */
  splitAt(timeMs: number): Timeline {
    const hit = this.sceneAt(timeMs);
    if (!hit || !this.canSplitAt(timeMs)) return this;
    const { scene, sourceMs } = hit;
    const first = { ...scene, outMs: sourceMs };
    const second = { ...scene, id: this.createId(), name: nextName(scene.name), inMs: sourceMs, transition: null };
    const scenes = [...this.doc.scenes];
    scenes.splice(hit.index, 1, first, second);
    return this.with({ scenes });
  }

  /** Moves the scene's in/out points, clamped to the source (0..maxOutMs) and the minimum length. */
  trimScene(id: string, points: { inMs?: number; outMs?: number }, maxOutMs = Infinity): Timeline {
    return this.updateScene(id, (scene) => {
      const outMs = points.outMs === undefined ? scene.outMs : clamp(points.outMs, scene.inMs + MIN_CLIP_MS, maxOutMs);
      const inMs = points.inMs === undefined ? scene.inMs : clamp(points.inMs, 0, outMs - MIN_CLIP_MS);
      return { ...scene, inMs, outMs };
    });
  }

  renameScene(id: string, name: string): Timeline {
    return this.updateScene(id, (scene) => ({ ...scene, name: name.slice(0, 80) }));
  }

  setSceneMuted(id: string, muted: boolean): Timeline {
    return this.updateScene(id, (scene) => ({ ...scene, muted }));
  }

  /** Moves a scene to position `toIndex` (clamped), shifting the others. */
  moveScene(id: string, toIndex: number): Timeline {
    const from = this.doc.scenes.findIndex((s) => s.id === id);
    if (from === -1) return this;
    const to = Math.max(0, Math.min(this.doc.scenes.length - 1, toIndex));
    if (to === from) return this;
    const scenes = [...this.doc.scenes];
    const [scene] = scenes.splice(from, 1);
    scenes.splice(to, 0, scene);
    return this.with({ scenes });
  }

  removeScene(id: string): Timeline {
    return this.with({ scenes: this.doc.scenes.filter((s) => s.id !== id) });
  }

  /** Appends a scene showing the whole of a source video. */
  addScene(mediaId: string, durationMs: number): Timeline {
    const scene: Scene = {
      id: this.createId(),
      name: `Scene ${this.doc.scenes.length + 1}`,
      mediaId,
      inMs: 0,
      outMs: Math.max(MIN_CLIP_MS, Math.round(durationMs)),
      muted: false,
    };
    return this.with({ scenes: [...this.doc.scenes, scene] });
  }

  /** Slides an audio or overlay clip along the timeline (never before 0). */
  moveClip(trackId: string, clipId: string, startMs: number): Timeline {
    const start = Math.max(0, Math.round(startMs));
    return this.updateTrack(trackId, (track) =>
      track.kind === 'audio'
        ? { ...track, clips: track.clips.map((c) => (c.id === clipId ? { ...c, startMs: start } : c)) }
        : { ...track, clips: track.clips.map((c) => (c.id === clipId ? { ...c, startMs: start } : c)) },
    );
  }

  /** Removes a clip; an overlay track left empty goes with it. */
  removeClip(trackId: string, clipId: string): Timeline {
    const track = this.doc.tracks.find((t) => t.id === trackId);
    if (track?.kind === 'overlay' && track.clips.every((c) => c.id === clipId)) {
      return this.with({ tracks: this.doc.tracks.filter((t) => t.id !== trackId) });
    }
    return this.updateTrack(trackId, (t) =>
      t.kind === 'audio' ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : { ...t, clips: t.clips.filter((c) => c.id !== clipId) },
    );
  }

  setTrackMuted(trackId: string, muted: boolean): Timeline {
    return this.updateTrack(trackId, (track) => (track.kind === 'audio' ? { ...track, muted } : track));
  }

  setTrackHidden(trackId: string, hidden: boolean): Timeline {
    return this.updateTrack(trackId, (track) => (track.kind === 'overlay' ? { ...track, hidden } : track));
  }

  overlay(clipId: string): { track: OverlayTrack; clip: OverlayClip } | undefined {
    for (const track of this.overlayTracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return undefined;
  }

  /** Overlays showing at `timeMs`, bottom first, with their time since they started. */
  overlaysAt(timeMs: number): { track: OverlayTrack; clip: OverlayClip; localMs: number }[] {
    return this.overlayTracks.flatMap((track) =>
      track.clips.filter((c) => timeMs >= c.startMs && timeMs < c.startMs + c.durationMs).map((clip) => ({ track, clip, localMs: timeMs - clip.startMs })),
    );
  }

  /** Adds an overlay on the top-most overlay track with room for it, or on a new track on top. */
  addOverlay(clip: OverlayClip): Timeline {
    const end = clip.startMs + clip.durationMs;
    const free = [...this.overlayTracks]
      .reverse()
      .find((t) => t.clips.every((c) => c.startMs >= end || c.startMs + c.durationMs <= clip.startMs));
    if (free) return this.updateTrack(free.id, (t) => (t.kind === 'overlay' ? { ...t, clips: [...t.clips, clip] } : t));
    const track: OverlayTrack = { id: this.createId(), kind: 'overlay', name: `Overlay ${this.overlayTracks.length + 1}`, hidden: false, clips: [clip] };
    return this.with({ tracks: [...this.doc.tracks, track] });
  }

  updateOverlay(clipId: string, update: (clip: OverlayClip) => OverlayClip): Timeline {
    const found = this.overlay(clipId);
    if (!found) return this;
    return this.updateTrack(found.track.id, (t) => (t.kind === 'overlay' ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? update(c) : c)) } : t));
  }

  toJSON(): TimelineDoc {
    return this.doc;
  }

  /** Every scene edit goes through here, so transitions are refitted whenever scene lengths or order change. */
  private with(changes: Partial<TimelineDoc>): Timeline {
    const scenes = changes.scenes ? fitTransitions(changes.scenes) : this.doc.scenes;
    return new Timeline({ ...this.doc, ...changes, scenes }, this.createId);
  }

  private updateScene(id: string, update: (scene: Scene) => Scene): Timeline {
    if (!this.scene(id)) return this;
    return this.with({ scenes: this.doc.scenes.map((s) => (s.id === id ? update(s) : s)) });
  }

  private updateTrack(id: string, update: (track: Track) => Track): Timeline {
    if (!this.doc.tracks.some((t) => t.id === id)) return this;
    return this.with({ tracks: this.doc.tracks.map((t) => (t.id === id ? update(t) : t)) });
  }
}

function withSource(placed: PlacedScene, timeMs: number): PlacedScene & { sourceMs: number } {
  return { ...placed, sourceMs: placed.scene.inMs + (timeMs - placed.startMs) };
}

/** Rounds to whole ms and clamps; the lower bound wins if the range is empty. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** "Intro" -> "Intro (2)", "Intro (2)" -> "Intro (3)". */
function nextName(name: string): string {
  const match = /^(.*) \((\d+)\)$/.exec(name);
  return match ? `${match[1]} (${Number(match[2]) + 1})` : `${name || 'Scene'} (2)`;
}
