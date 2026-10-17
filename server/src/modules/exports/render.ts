import type { AudioClip, Scene, TimelineDoc } from '../timelines/timelines.schema';

/** A file the render reads, resolved to disk. hasAudio is false for videos without a sound stream. */
export interface RenderMedia {
  path: string;
  hasAudio: boolean;
}

export interface RenderSources {
  media: Map<string, RenderMedia>;
  /** The mixed voiceover track, when the timeline uses it. */
  voiceoverPath: string | null;
}

export interface RenderSettings {
  format: 'mp4' | 'gif';
  width: number;
  height: number;
  fps: number;
}

export interface RenderPlan {
  args: string[];
  durationMs: number;
}

const SAMPLE_RATE = 48000;
const AUDIO_FORMAT = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;

/** Where each scene sits on the output timeline; a transition starts the scene that much before the previous one ends. */
export function placeScenes(scenes: Scene[]): { scene: Scene; startMs: number; lengthMs: number }[] {
  let endMs = 0;
  return scenes.map((scene, i) => {
    const lengthMs = scene.outMs - scene.inMs;
    const startMs = endMs - (i > 0 ? (scene.transition?.durationMs ?? 0) : 0);
    endMs = startMs + lengthMs;
    return { scene, startMs, lengthMs };
  });
}

/** The edit's length, matching the editor: the end of the last scene, audio clip or overlay. */
export function timelineDurationMs(doc: TimelineDoc): number {
  const scenesEnd = placeScenes(doc.scenes).at(-1);
  const ends = doc.tracks.flatMap((t) =>
    t.kind === 'audio' ? t.clips.map((c) => c.startMs + c.outMs - c.inMs) : t.clips.map((c) => c.startMs + c.durationMs),
  );
  return Math.max(scenesEnd ? scenesEnd.startMs + scenesEnd.lengthMs : 0, ...ends);
}

/**
 * Builds the ffmpeg command that renders `doc` to `output`. Scenes are letterboxed into the output frame and
 * joined with xfade (hard cuts use concat); their sound fades across transitions the way the preview's does,
 * and audio clips are mixed on top at their timeline positions. GIFs have no sound and get their own palette.
 */
export function buildRenderPlan(doc: TimelineDoc, sources: RenderSources, settings: RenderSettings, output: string): RenderPlan {
  if (doc.scenes.length === 0) throw new Error('The timeline has no scenes');
  const durationMs = timelineDurationMs(doc);
  const inputs: string[][] = [];
  const filters: string[] = [];
  const addInput = (args: string[]) => inputs.push(args) - 1;

  const withAudio = settings.format === 'mp4';
  const silence = withAudio ? addInput(['-f', 'lavfi', '-t', sec(durationMs), '-i', `anullsrc=r=${SAMPLE_RATE}:cl=stereo`]) : -1;
  const audioLabels: string[] = [];

  const placed = placeScenes(doc.scenes);
  placed.forEach(({ scene, startMs, lengthMs }, i) => {
    const media = mediaFor(sources, scene.mediaId);
    const input = addInput(['-ss', sec(scene.inMs), '-t', sec(lengthMs), '-i', media.path]);
    filters.push(`[${input}:v]${sceneVideoFilter(settings, lengthMs)}[v${i}]`);
    if (!withAudio || scene.muted || !media.hasAudio) return;
    const fades = sceneAudioFades(scene, doc.scenes[i + 1], lengthMs);
    filters.push(`[${input}:a]${[AUDIO_FORMAT, 'apad', `atrim=duration=${sec(lengthMs)}`, 'asetpts=PTS-STARTPTS', ...fades, delay(startMs)].join(',')}[sa${i}]`);
    audioLabels.push(`[sa${i}]`);
  });

  let video = 'v0';
  let videoEndMs = placed[0].lengthMs;
  placed.slice(1).forEach(({ scene, startMs, lengthMs }, n) => {
    const i = n + 1;
    const joined = scene.transition
      ? `xfade=transition=${scene.transition.type}:duration=${sec(scene.transition.durationMs)}:offset=${sec(startMs)}`
      : // concat drops the frame rate, which a later xfade needs.
        `concat=n=2:v=1:a=0,fps=${settings.fps}`;
    filters.push(`[${video}][v${i}]${joined}[j${i}]`);
    video = `j${i}`;
    videoEndMs = startMs + lengthMs;
  });
  // Audio or overlays running past the last scene play over black, as in the preview.
  const tail = durationMs - videoEndMs;
  const finish = [tail > 0 ? `tpad=stop_mode=add:stop_duration=${sec(tail)}:color=black` : null, 'format=yuv420p'];
  if (settings.format === 'gif') {
    filters.push(`[${video}]${[...finish, 'split[g1][g2]'].filter(Boolean).join(',')}`);
    filters.push('[g1]palettegen=stats_mode=diff[pal]', '[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]');
  } else {
    filters.push(`[${video}]${finish.filter(Boolean).join(',')}[vout]`);
  }

  if (withAudio) {
    for (const track of doc.tracks) {
      if (track.kind !== 'audio' || track.muted) continue;
      for (const clip of track.clips) {
        const path = audioClipPath(sources, clip);
        if (!path) continue;
        const lengthMs = clip.outMs - clip.inMs;
        const input = addInput(['-ss', sec(clip.inMs), '-t', sec(lengthMs), '-i', path]);
        const label = `ta${audioLabels.length}`;
        filters.push(`[${input}:a]${[AUDIO_FORMAT, `atrim=duration=${sec(lengthMs)}`, 'asetpts=PTS-STARTPTS', delay(clip.startMs)].join(',')}[${label}]`);
        audioLabels.push(`[${label}]`);
      }
    }
    // The silent bed keeps the track running for the whole edit; normalize=0 keeps every source at its own level.
    filters.push(`[${silence}:a]${audioLabels.join('')}amix=inputs=${audioLabels.length + 1}:duration=first:normalize=0[aout]`);
  }

  const encode =
    settings.format === 'gif'
      ? ['-map', '[vout]', '-loop', '0', '-f', 'gif']
      : [
          ...['-map', '[vout]', '-map', '[aout]'],
          ...['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'],
          ...['-c:a', 'aac', '-b:a', '160k', '-ar', String(SAMPLE_RATE)],
          ...['-movflags', '+faststart', '-f', 'mp4'],
        ];
  const args = ['-y', '-stats_period', '0.5', ...inputs.flat(), '-filter_complex', filters.join(';'), ...encode, '-t', sec(durationMs), output];
  return { args, durationMs };
}

/** Normalises one scene's picture to the output: frame rate, letterboxed size, exact length (short sources hold their last frame). */
function sceneVideoFilter({ width, height, fps }: RenderSettings, lengthMs: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    'format=yuv420p',
    `tpad=stop_mode=clone:stop_duration=${sec(lengthMs)}`,
    `trim=duration=${sec(lengthMs)}`,
    'setpts=PTS-STARTPTS',
    // Last, so xfade sees a constant frame rate (tpad and trim leave it unset).
    `fps=${fps}`,
  ].join(',');
}

/** Fades a scene's own sound in and out over its transitions; "fade to black" dips to silence in the middle. */
export function sceneAudioFades(scene: Scene, next: Scene | undefined, lengthMs: number): string[] {
  const fades: string[] = [];
  const incoming = scene.transition;
  if (incoming) {
    const half = incoming.type === 'fadeblack';
    const d = half ? incoming.durationMs / 2 : incoming.durationMs;
    fades.push(`afade=t=in:st=${sec(half ? d : 0)}:d=${sec(d)}`);
  }
  const outgoing = next?.transition;
  if (outgoing) {
    const half = outgoing.type === 'fadeblack';
    const d = half ? outgoing.durationMs / 2 : outgoing.durationMs;
    fades.push(`afade=t=out:st=${sec(lengthMs - outgoing.durationMs)}:d=${sec(d)}`);
  }
  return fades;
}

function mediaFor(sources: RenderSources, mediaId: string): RenderMedia {
  const media = sources.media.get(mediaId);
  if (!media) throw new Error(`Media ${mediaId} is not available to the render`);
  return media;
}

function audioClipPath(sources: RenderSources, clip: AudioClip): string | null {
  if (clip.source.type === 'voiceover') return sources.voiceoverPath;
  const media = mediaFor(sources, clip.source.mediaId);
  return media.hasAudio ? media.path : null;
}

const delay = (ms: number) => `adelay=${Math.max(0, Math.round(ms))}:all=1`;

function sec(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}
