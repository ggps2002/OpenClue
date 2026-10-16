/** Mirrors server/src/modules/timelines/timelines.schema.ts. */
export interface Scene {
  id: string;
  name: string;
  mediaId: string;
  inMs: number;
  outMs: number;
  /** Silences the video's own sound. */
  muted: boolean;
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

export interface TimelineDoc {
  version: 1;
  scenes: Scene[];
  tracks: AudioTrack[];
}

/** A scene with its position on the timeline. */
export interface PlacedScene {
  scene: Scene;
  index: number;
  startMs: number;
  endMs: number;
}

export const MIN_CLIP_MS = 100;

export const clipLength = (clip: { inMs: number; outMs: number }) => clip.outMs - clip.inMs;

const defaultId = () => crypto.randomUUID();

/**
 * The edit of a video: scenes (cuts of source videos) that play back to back, plus audio tracks laid
 * over them. Immutable: every edit returns a new Timeline, which keeps undo/redo and React state simple.
 */
export class Timeline {
  constructor(
    readonly doc: TimelineDoc,
    private readonly createId: () => string = defaultId,
  ) {}

  get scenes(): Scene[] {
    return this.doc.scenes;
  }

  get tracks(): AudioTrack[] {
    return this.doc.tracks;
  }

  /** Length of the scenes played back to back. */
  get videoDurationMs(): number {
    return this.doc.scenes.reduce((sum, s) => sum + clipLength(s), 0);
  }

  /** The whole edit, including audio that runs past the last scene. */
  get durationMs(): number {
    const audioEnd = Math.max(0, ...this.doc.tracks.flatMap((t) => t.clips.map((c) => c.startMs + clipLength(c))));
    return Math.max(this.videoDurationMs, audioEnd);
  }

  placements(): PlacedScene[] {
    let startMs = 0;
    return this.doc.scenes.map((scene, index) => {
      const placed = { scene, index, startMs, endMs: startMs + clipLength(scene) };
      startMs = placed.endMs;
      return placed;
    });
  }

  scene(id: string): Scene | undefined {
    return this.doc.scenes.find((s) => s.id === id);
  }

  placement(id: string): PlacedScene | undefined {
    return this.placements().find((p) => p.scene.id === id);
  }

  /** The scene playing at `timeMs` and the matching time in its source video; null after the last scene. */
  sceneAt(timeMs: number): (PlacedScene & { sourceMs: number }) | null {
    const placed = this.placements().find((p) => timeMs >= p.startMs && timeMs < p.endMs);
    return placed ? { ...placed, sourceMs: placed.scene.inMs + (timeMs - placed.startMs) } : null;
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
    const second = { ...scene, id: this.createId(), name: nextName(scene.name), inMs: sourceMs };
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

  /** Slides an audio clip along the timeline (never before 0). */
  moveClip(trackId: string, clipId: string, startMs: number): Timeline {
    return this.updateTrack(trackId, (track) => ({
      ...track,
      clips: track.clips.map((c) => (c.id === clipId ? { ...c, startMs: Math.max(0, Math.round(startMs)) } : c)),
    }));
  }

  removeClip(trackId: string, clipId: string): Timeline {
    return this.updateTrack(trackId, (track) => ({ ...track, clips: track.clips.filter((c) => c.id !== clipId) }));
  }

  setTrackMuted(trackId: string, muted: boolean): Timeline {
    return this.updateTrack(trackId, (track) => ({ ...track, muted }));
  }

  toJSON(): TimelineDoc {
    return this.doc;
  }

  private with(changes: Partial<TimelineDoc>): Timeline {
    return new Timeline({ ...this.doc, ...changes }, this.createId);
  }

  private updateScene(id: string, update: (scene: Scene) => Scene): Timeline {
    if (!this.scene(id)) return this;
    return this.with({ scenes: this.doc.scenes.map((s) => (s.id === id ? update(s) : s)) });
  }

  private updateTrack(id: string, update: (track: AudioTrack) => AudioTrack): Timeline {
    if (!this.doc.tracks.some((t) => t.id === id)) return this;
    return this.with({ tracks: this.doc.tracks.map((t) => (t.id === id ? update(t) : t)) });
  }
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
