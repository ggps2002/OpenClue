import type { Voiceover, VoiceoverClip } from '@prisma/client';
import type { Role } from '../../lib/access';
import { mapLimit } from '../../lib/concurrency';
import type { FfmpegService } from '../../lib/ffmpeg';
import { prisma } from '../../lib/prisma';
import { DEFAULT_VOICE, VOICE_IDS, VOICES, type SpeechClient, type VoiceId } from '../../lib/speech';
import type { StorageService } from '../../lib/storage';
import { HttpError } from '../../middleware/error';
import { projectFilesPrefix } from '../projects/projects.service';
import type { ScriptSegment } from '../scripts/scripts.schema';
import type { ScriptDto, ScriptService } from '../scripts/scripts.service';
import type { GenerateVoiceoverInput } from './voiceovers.schema';

/** Speech longer than its slot is sped up by at most this much; anything beyond is reported as overflow. */
export const MAX_TEMPO = 1.25;
/** Up to 2 % over the slot is not worth re-encoding for. */
const FIT_TOLERANCE = 1.02;
const SYNTH_CONCURRENCY = 4;

/**
 * - ready: the clip matches the segment's current text, timing and the voiceover's voice
 * - stale: there is a clip, but the segment or voice changed since it was made
 * - missing: no clip yet
 * - empty: the segment has no text, so there is nothing to say
 */
export type ClipStatus = 'ready' | 'stale' | 'missing' | 'empty';

export interface VoiceoverSegmentDto {
  segmentId: string;
  status: ClipStatus;
  audioUrl: string | null;
  durationMs: number | null;
  tempo: number | null;
  /** How far the spoken clip runs past the end of its segment, even after speeding it up. */
  overflowMs: number;
  source: 'openai' | 'offline' | null;
}

export interface VoiceoverDto {
  projectId: string;
  scriptId: string;
  voice: VoiceId;
  trackUrl: string | null;
  trackDurationMs: number;
  /** True when any clip is offline placeholder silence. */
  offline: boolean;
  segments: VoiceoverSegmentDto[];
  updatedAt: string;
}

type ClipAudio = Pick<VoiceoverClip, 'storageKey' | 'durationMs' | 'tempo' | 'source'>;

/** Turns a project's script into per-segment TTS clips and one mixed voiceover track. */
export class VoiceoverService {
  constructor(
    private readonly scripts: ScriptService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly speech: SpeechClient,
  ) {}

  voices() {
    return { voices: VOICES, defaultVoice: DEFAULT_VOICE, mode: this.speech.isOnline ? 'online' : 'offline' } as const;
  }

  async get(userId: string, projectId: string): Promise<VoiceoverDto | null> {
    const script = await this.scripts.get(userId, projectId);
    if (!script) return null;
    const voiceover = await this.find(script.id);
    return voiceover ? toDto(script, voiceover) : null;
  }

  /** Voices the script's segments (all, or only those without an up-to-date clip) and rebuilds the track. */
  async generate(userId: string, projectId: string, input: GenerateVoiceoverInput): Promise<VoiceoverDto> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    const voiceover = await prisma.voiceover.upsert({
      where: { scriptId: script.id },
      create: { scriptId: script.id, voice: input.voice },
      update: { voice: input.voice },
      include: { clips: true },
    });
    const clips = new Map(voiceover.clips.map((c) => [c.segmentId, c]));
    const targets = script.segments.filter((segment) => {
      const status = clipStatus(segment, clips.get(segment.id), input.voice);
      return status === 'missing' || status === 'stale' || (status === 'ready' && input.scope === 'all');
    });

    let failed = 0;
    await mapLimit(targets, SYNTH_CONCURRENCY, async (segment) => {
      try {
        await this.voiceSegment(projectId, voiceover.id, segment, input.voice, clips.get(segment.id));
      } catch (err) {
        console.error(`[voiceovers] could not voice segment ${segment.id}`, err);
        failed += 1;
      }
    });
    await this.prune(voiceover.id, script.segments);
    const result = await this.rebuildTrack(projectId, script, voiceover.id);
    if (failed > 0) {
      throw new HttpError(502, `The voiceover could not be made for ${failed} of ${targets.length} segments. Please try again.`);
    }
    return result;
  }

  /** Re-voices one segment with the voiceover's current voice (or `voice`, which then becomes the current one). */
  async regenerateSegment(userId: string, projectId: string, segmentId: string, voice?: VoiceId): Promise<VoiceoverDto> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    const segment = script.segments.find((s) => s.id === segmentId);
    if (!segment) throw new HttpError(404, 'This segment is not in the saved script');
    if (!segment.text.trim()) throw new HttpError(400, 'This segment has no text to speak');

    const existing = await this.find(script.id);
    const chosen = voice ?? toVoice(existing?.voice);
    const voiceover = await prisma.voiceover.upsert({
      where: { scriptId: script.id },
      create: { scriptId: script.id, voice: chosen },
      update: { voice: chosen },
    });
    const clip = existing?.clips.find((c) => c.segmentId === segmentId);
    try {
      await this.voiceSegment(projectId, voiceover.id, segment, chosen, clip, true);
    } catch (err) {
      console.error(`[voiceovers] could not voice segment ${segmentId}`, err);
      throw new HttpError(502, 'The voiceover for this segment could not be made. Please try again.');
    }
    return this.rebuildTrack(projectId, script, voiceover.id);
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    const voiceover = await this.find(script.id);
    if (!voiceover) return;
    await prisma.voiceover.delete({ where: { id: voiceover.id } });
    await Promise.all([voiceover.trackKey, ...voiceover.clips.map((c) => c.storageKey)].map((key) => key && this.storage.remove(key)));
  }

  /** Absolute path of the mixed track, for streaming. */
  async trackFile(userId: string, projectId: string): Promise<string> {
    const voiceover = await this.loadVoiceover(userId, projectId, 'viewer');
    if (!voiceover.trackKey) throw new HttpError(404, 'This voiceover has no audio yet');
    return this.storage.resolve(voiceover.trackKey);
  }

  /** Absolute path of one segment's clip, for streaming. */
  async clipFile(userId: string, projectId: string, segmentId: string): Promise<string> {
    const voiceover = await this.loadVoiceover(userId, projectId, 'viewer');
    const clip = voiceover.clips.find((c) => c.segmentId === segmentId);
    if (!clip) throw new HttpError(404, 'This segment has no voiceover yet');
    return this.storage.resolve(clip.storageKey);
  }

  private async loadVoiceover(userId: string, projectId: string, minRole: Role) {
    const script = await this.scripts.load(userId, projectId, minRole);
    const voiceover = await this.find(script.id);
    if (!voiceover) throw new HttpError(404, 'This project has no voiceover yet');
    return voiceover;
  }

  private find(scriptId: string) {
    return prisma.voiceover.findUnique({ where: { scriptId }, include: { clips: true } });
  }

  /** Makes (or, for a pure timing change, just moves) the clip for one segment and stores it. */
  private async voiceSegment(
    projectId: string,
    voiceoverId: string,
    segment: ScriptSegment,
    voice: VoiceId,
    previous: VoiceoverClip | undefined,
    force = false,
  ): Promise<void> {
    const text = segment.text.trim();
    const timing = { startMs: segment.startMs, endMs: segment.endMs };
    if (!force && previous && canRetime(previous, segment, voice)) {
      await prisma.voiceoverClip.update({ where: { id: previous.id }, data: timing });
      return;
    }
    const audio = await this.synthesizeClip(projectId, text, voice, segment.endMs - segment.startMs);
    const data = { text, voice, ...timing, ...audio };
    await prisma.voiceoverClip.upsert({
      where: { voiceoverId_segmentId: { voiceoverId, segmentId: segment.id } },
      create: { voiceoverId, segmentId: segment.id, ...data },
      update: data,
    });
    if (previous) await this.storage.remove(previous.storageKey);
  }

  /** TTS audio fitted to `slotMs`, or silence of exactly that length in offline mode. */
  private async synthesizeClip(projectId: string, text: string, voice: VoiceId, slotMs: number): Promise<ClipAudio> {
    const key = this.storage.createKey(`${projectFilesPrefix(projectId)}/voiceover`, 'clip.mp3');
    const output = this.storage.resolve(key);
    if (!this.speech.isOnline) {
      await this.ffmpeg.silence(slotMs, output);
      return { storageKey: key, durationMs: slotMs, tempo: 1, source: 'offline' };
    }
    const rawKey = this.storage.createKey('tmp', 'speech.mp3');
    const raw = this.storage.resolve(rawKey);
    try {
      await this.speech.synthesize(text, voice, raw);
      const spokenMs = (await this.ffmpeg.probeDurationMs(raw)) ?? slotMs;
      if (spokenMs <= slotMs * FIT_TOLERANCE) {
        await this.storage.adopt(raw, key);
        return { storageKey: key, durationMs: spokenMs, tempo: 1, source: 'openai' };
      }
      const tempo = Math.min(spokenMs / slotMs, MAX_TEMPO);
      await this.ffmpeg.changeTempo(raw, output, tempo);
      return { storageKey: key, durationMs: Math.round(spokenMs / tempo), tempo, source: 'openai' };
    } finally {
      await this.storage.remove(rawKey);
    }
  }

  /** Drops clips whose segment was deleted or emptied. */
  private async prune(voiceoverId: string, segments: ScriptSegment[]): Promise<void> {
    const keep = new Set(segments.filter((s) => s.text.trim()).map((s) => s.id));
    const orphans = await prisma.voiceoverClip.findMany({ where: { voiceoverId, segmentId: { notIn: [...keep] } } });
    if (orphans.length === 0) return;
    await prisma.voiceoverClip.deleteMany({ where: { id: { in: orphans.map((c) => c.id) } } });
    await Promise.all(orphans.map((c) => this.storage.remove(c.storageKey)));
  }

  /** Mixes every clip of the current script at its segment start into one track that covers the whole script. */
  private async rebuildTrack(projectId: string, script: ScriptDto, voiceoverId: string): Promise<VoiceoverDto> {
    const voiceover = await prisma.voiceover.findUniqueOrThrow({ where: { id: voiceoverId }, include: { clips: true } });
    const segmentIds = new Set(script.segments.map((s) => s.id));
    const clips = voiceover.clips.filter((c) => segmentIds.has(c.segmentId));
    let trackKey: string | null = null;
    let trackDurationMs = 0;
    if (clips.length > 0) {
      trackDurationMs = Math.max(...script.segments.map((s) => s.endMs), ...clips.map((c) => c.startMs + c.durationMs));
      trackKey = this.storage.createKey(`${projectFilesPrefix(projectId)}/voiceover`, 'track.mp3');
      await this.ffmpeg.mixAtOffsets(
        clips.map((c) => ({ path: this.storage.resolve(c.storageKey), startMs: c.startMs })),
        trackDurationMs,
        this.storage.resolve(trackKey),
      );
    }
    const updated = await prisma.voiceover.update({
      where: { id: voiceoverId },
      data: { trackKey, trackDurationMs },
      include: { clips: true },
    });
    if (voiceover.trackKey) await this.storage.remove(voiceover.trackKey);
    return toDto(script, updated);
  }
}

export function clipStatus(segment: ScriptSegment, clip: VoiceoverClip | undefined, voice: string): ClipStatus {
  const text = segment.text.trim();
  if (!text) return 'empty';
  if (!clip) return 'missing';
  const same = clip.text === text && clip.voice === voice && clip.startMs === segment.startMs && clip.endMs === segment.endMs;
  return same ? 'ready' : 'stale';
}

/** A real (not placeholder) clip with unchanged words and voice that still fits its moved slot only needs new times. */
function canRetime(clip: VoiceoverClip, segment: ScriptSegment, voice: string): boolean {
  return (
    clip.source === 'openai' &&
    clip.text === segment.text.trim() &&
    clip.voice === voice &&
    clip.tempo === 1 &&
    clip.durationMs <= (segment.endMs - segment.startMs) * FIT_TOLERANCE
  );
}

function toVoice(value: string | undefined): VoiceId {
  return VOICE_IDS.find((v) => v === value) ?? DEFAULT_VOICE;
}

function toDto(script: ScriptDto, voiceover: Voiceover & { clips: VoiceoverClip[] }): VoiceoverDto {
  const base = `/api/projects/${script.projectId}/voiceover`;
  const clips = new Map(voiceover.clips.map((c) => [c.segmentId, c]));
  const segments = script.segments.map((segment): VoiceoverSegmentDto => {
    const clip = clips.get(segment.id);
    const status = clipStatus(segment, clip, voiceover.voice);
    if (!clip || status === 'empty') {
      return { segmentId: segment.id, status, audioUrl: null, durationMs: null, tempo: null, overflowMs: 0, source: null };
    }
    return {
      segmentId: segment.id,
      status,
      audioUrl: `${base}/segments/${encodeURIComponent(segment.id)}/audio?v=${clip.updatedAt.getTime()}`,
      durationMs: clip.durationMs,
      tempo: clip.tempo,
      overflowMs: Math.max(0, clip.durationMs - (clip.endMs - clip.startMs)),
      source: clip.source === 'openai' ? 'openai' : 'offline',
    };
  });
  return {
    projectId: script.projectId,
    scriptId: script.id,
    voice: toVoice(voiceover.voice),
    trackUrl: voiceover.trackKey ? `${base}/track?v=${voiceover.updatedAt.getTime()}` : null,
    trackDurationMs: voiceover.trackDurationMs,
    offline: segments.some((s) => s.source === 'offline'),
    segments,
    updatedAt: voiceover.updatedAt.toISOString(),
  };
}
