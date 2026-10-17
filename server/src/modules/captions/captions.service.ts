import { randomUUID } from 'node:crypto';
import type { CaptionTrack } from '@prisma/client';
import type { Role } from '../../lib/access';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/error';
import type { ProjectService } from '../projects/projects.service';
import type { ScriptDto, ScriptService } from '../scripts/scripts.service';
import { timelineDocSchema } from '../timelines/timelines.schema';
import type { VoiceoverDto, VoiceoverService } from '../voiceovers/voiceovers.service';
import {
  CAPTION_PRESETS,
  captionCueSchema,
  captionStyleSchema,
  DEFAULT_MAX_CHARS_PER_LINE,
  DEFAULT_MAX_LINES,
  DEFAULT_PRESET,
  type CaptionCue,
  type CaptionStyle,
  type ExportCaptionsInput,
  type GenerateCaptionsInput,
  type UpdateCaptionsInput,
} from './captions.schema';
import { buildCues, cuesOnTimeline, toSrt, toVtt, type CaptionWindow } from './cues';

export interface CaptionsDto {
  id: string;
  projectId: string;
  language: string;
  /** The video the script (and so the cue times) belongs to. */
  sourceMediaId: string | null;
  cues: CaptionCue[];
  style: CaptionStyle;
  maxCharsPerLine: number;
  maxLines: 1 | 2;
  /** voiceover: cues end when each spoken clip ends; script: cues fill each segment's slot. */
  timing: 'voiceover' | 'script';
  /** True when the script or voiceover changed after the cues were built. */
  stale: boolean;
  generatedAt: string;
  updatedAt: string;
}

export interface CaptionFile {
  filename: string;
  contentType: string;
  body: string;
}

/** Builds on-screen captions from a project's script (timed to its voiceover), stores their style and exports SRT/VTT. */
export class CaptionService {
  constructor(
    private readonly projects: ProjectService,
    private readonly scripts: ScriptService,
    private readonly voiceovers: VoiceoverService,
  ) {}

  presets() {
    return { presets: CAPTION_PRESETS, defaultPreset: DEFAULT_PRESET.id };
  }

  async get(userId: string, projectId: string): Promise<{ role: Role; captions: CaptionsDto | null }> {
    const { role } = await this.projects.load(userId, projectId, 'viewer');
    const script = await this.scripts.get(userId, projectId);
    if (!script) return { role, captions: null };
    const track = await prisma.captionTrack.findUnique({ where: { scriptId: script.id } });
    return { role, captions: track ? toDto(script, track, await this.voiceovers.get(userId, projectId)) : null };
  }

  /** (Re)builds the cues from the saved script, replacing any edited cues; the style is kept unless a preset is given. */
  async generate(userId: string, projectId: string, input: GenerateCaptionsInput): Promise<CaptionsDto> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    const voiceover = await this.voiceovers.get(userId, projectId);
    const existing = await prisma.captionTrack.findUnique({ where: { scriptId: script.id } });
    const maxCharsPerLine = input.maxCharsPerLine ?? existing?.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE;
    const maxLines = input.maxLines ?? toMaxLines(existing?.maxLines ?? DEFAULT_MAX_LINES);

    const { windows, timing } = captionWindows(script, voiceover);
    const cues = buildCues(windows, { maxCharsPerLine, maxLines }).map((c) => ({ id: randomUUID(), ...c }));
    if (cues.length === 0) throw new HttpError(422, 'The script has no text to turn into captions');

    const chosen = input.preset ? CAPTION_PRESETS.find((p) => p.id === input.preset) : undefined;
    const style = chosen?.style ?? (existing ? parseStyle(existing.style) : DEFAULT_PRESET.style);
    const data = { cues, style, maxCharsPerLine, maxLines, timing, generatedAt: new Date() };
    const track = await prisma.captionTrack.upsert({
      where: { scriptId: script.id },
      create: { scriptId: script.id, ...data },
      update: data,
    });
    return toDto(script, track, voiceover);
  }

  /** Saves edited cues and/or style (already validated by the schema). */
  async update(userId: string, projectId: string, input: UpdateCaptionsInput): Promise<CaptionsDto> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    const existing = await prisma.captionTrack.findUnique({ where: { scriptId: script.id } });
    if (!existing) throw new HttpError(404, 'This project has no captions yet');
    const track = await prisma.captionTrack.update({
      where: { id: existing.id },
      data: { ...(input.cues && { cues: input.cues }), ...(input.style && { style: input.style }) },
    });
    return toDto(script, track, await this.voiceovers.get(userId, projectId));
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const script = await this.scripts.load(userId, projectId, 'editor');
    await prisma.captionTrack.deleteMany({ where: { scriptId: script.id } });
  }

  /** The captions as an SRT or WebVTT file, timed to the source video or to the edited timeline. */
  async export(userId: string, projectId: string, input: ExportCaptionsInput): Promise<CaptionFile> {
    const { project } = await this.projects.load(userId, projectId, 'viewer');
    const script = await this.scripts.load(userId, projectId, 'viewer');
    const track = await prisma.captionTrack.findUnique({ where: { scriptId: script.id } });
    if (!track) throw new HttpError(404, 'This project has no captions yet');
    const style = parseStyle(track.style);
    let cues = parseCues(track.cues);

    if (input.timing !== 'script') {
      const stored = await prisma.timeline.findUnique({ where: { projectId } });
      const doc = stored ? timelineDocSchema.safeParse(stored.data) : null;
      const mapped = doc?.success ? cuesOnTimeline(cues, doc.data, script.sourceMediaId) : null;
      if (mapped) cues = mapped;
      else if (input.timing === 'timeline') {
        throw new HttpError(422, 'The edit does not use the narration or its video yet, so captions cannot follow it');
      }
    }

    const base = `${slug(project.name)}.${script.language}`;
    return input.format === 'srt'
      ? { filename: `${base}.srt`, contentType: 'application/x-subrip; charset=utf-8', body: toSrt(cues) }
      : { filename: `${base}.vtt`, contentType: 'text/vtt; charset=utf-8', body: toVtt(cues, style.position) };
  }
}

/**
 * One window per script segment. A segment with an up-to-date voiceover clip is captioned only while
 * its speech plays (never into the next segment); otherwise the caption fills the segment's slot.
 */
export function captionWindows(script: ScriptDto, voiceover: VoiceoverDto | null): { windows: CaptionWindow[]; timing: CaptionsDto['timing'] } {
  const clips = new Map(voiceover?.segments.filter((c) => c.status === 'ready' && c.durationMs).map((c) => [c.segmentId, c.durationMs ?? 0]));
  const windows = script.segments.map((segment, i) => {
    const spokenMs = clips.get(segment.id);
    if (spokenMs === undefined) return segment;
    const nextStart = script.segments[i + 1]?.startMs ?? Infinity;
    return { ...segment, endMs: Math.min(segment.startMs + spokenMs, nextStart) };
  });
  return { windows, timing: clips.size > 0 ? 'voiceover' : 'script' };
}

function toDto(script: ScriptDto, track: CaptionTrack, voiceover: VoiceoverDto | null): CaptionsDto {
  const generated = track.generatedAt.getTime();
  const changedSince = (iso: string | undefined) => iso !== undefined && new Date(iso).getTime() > generated;
  return {
    id: track.id,
    projectId: script.projectId,
    language: script.language,
    sourceMediaId: script.sourceMediaId,
    cues: parseCues(track.cues),
    style: parseStyle(track.style),
    maxCharsPerLine: track.maxCharsPerLine,
    maxLines: toMaxLines(track.maxLines),
    timing: track.timing === 'voiceover' ? 'voiceover' : 'script',
    stale: changedSince(script.updatedAt) || changedSince(voiceover?.updatedAt),
    generatedAt: track.generatedAt.toISOString(),
    updatedAt: track.updatedAt.toISOString(),
  };
}

const parseCues = (value: unknown): CaptionCue[] => captionCueSchema.array().parse(value);

/** Styles saved by an older version fall back to the default preset's values for anything missing. */
const parseStyle = (value: unknown): CaptionStyle => {
  const stored = typeof value === 'object' && value !== null ? value : {};
  const parsed = captionStyleSchema.safeParse({ ...DEFAULT_PRESET.style, ...stored });
  return parsed.success ? parsed.data : DEFAULT_PRESET.style;
};

const toMaxLines = (n: number): 1 | 2 => (n === 1 ? 1 : 2);

const slug = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'captions';
