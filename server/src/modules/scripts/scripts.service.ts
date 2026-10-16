import { randomUUID } from 'node:crypto';
import type { Script } from '@prisma/client';
import { z } from 'zod';
import type { Role } from '../../lib/access';
import { AiError, type ClaudeClient } from '../../lib/claude';
import { prisma } from '../../lib/prisma';
import type { TimedText } from '../../lib/speech';
import { HttpError } from '../../middleware/error';
import type { MediaService } from '../media/media.service';
import type { ProjectService } from '../projects/projects.service';
import type { TranscriptService } from '../transcripts/transcripts.service';
import { draftOffline, normalizeTimedText, WORDS_PER_SECOND } from './narration';
import { scriptSegmentSchema, type GenerateScriptInput, type ScriptSegment } from './scripts.schema';

export interface ScriptDto {
  id: string;
  projectId: string;
  language: string;
  /** How the first draft was written: by Claude, or by the offline cleanup. */
  source: 'claude' | 'offline';
  sourceMediaId: string | null;
  segments: ScriptSegment[];
  createdAt: string;
  updatedAt: string;
}

const SYSTEM_PROMPT = `You are a scriptwriter for short product walkthrough videos.
You receive the rough, timestamped narration a person spoke while recording their screen.
Rewrite it into a clean voiceover script:
- Keep the speaker's meaning and the order of what happens on screen. Never invent features, names or numbers.
- Remove filler words, false starts, repetition and small talk. Use clear, friendly, active sentences.
- Split the script into segments that follow the timeline. You may merge neighbouring lines, but every segment must stay within the original time range and keep its place in time so it lines up with the video.
- Segments must be in order and must not overlap. Times are integers in milliseconds.
- Each segment must be speakable in its slot at about ${WORDS_PER_SECOND} words per second; shorten rather than overflow.
- Write in the same language as the narration.`;

const claudeOutputSchema = z.object({
  segments: z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() })),
});

const claudeJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['segments'],
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['startMs', 'endMs', 'text'],
        properties: {
          startMs: { type: 'integer' },
          endMs: { type: 'integer' },
          text: { type: 'string' },
        },
      },
    },
  },
};

/** Turns a recording's transcript into an editable, timed narration script (one per project). */
export class ScriptService {
  constructor(
    private readonly projects: ProjectService,
    private readonly media: MediaService,
    private readonly transcripts: TranscriptService,
    private readonly claude: ClaudeClient,
  ) {}

  async get(userId: string, projectId: string): Promise<ScriptDto | null> {
    await this.projects.load(userId, projectId, 'viewer');
    const script = await this.findPrimary(projectId);
    return script ? toDto(script) : null;
  }

  /** The project's script for a user with at least `minRole`; 404 when there is none yet. */
  async load(userId: string, projectId: string, minRole: Role): Promise<ScriptDto> {
    await this.projects.load(userId, projectId, minRole);
    const script = await this.findPrimary(projectId);
    if (!script) throw new HttpError(404, 'This project has no script yet');
    return toDto(script);
  }

  /** Transcribes the chosen project video (if needed) and replaces the script with a fresh draft. */
  async generate(userId: string, projectId: string, input: GenerateScriptInput): Promise<ScriptDto> {
    await this.projects.load(userId, projectId, 'editor');
    const asset = await this.media.load(userId, input.mediaId, 'editor');
    if (asset.projectId !== projectId) throw new HttpError(400, 'Pick a video or audio file from this project');

    const transcript = input.retranscribe
      ? await this.transcripts.transcribe(userId, asset.id)
      : await this.transcripts.ensure(userId, asset.id);
    if (transcript.segments.length === 0) throw new HttpError(422, 'No speech was found in this recording');

    const { segments, source } = await this.write(transcript.segments);
    const data = {
      language: transcript.language,
      source,
      sourceMediaId: asset.id,
      segments: segments.map((s) => ({ id: randomUUID(), ...s })),
    };
    const existing = await this.findPrimary(projectId);
    const script = existing
      ? await prisma.script.update({ where: { id: existing.id }, data })
      : await prisma.script.create({ data: { projectId, ...data } });
    return toDto(script);
  }

  /** Saves the user's edited segments (already validated by the schema). */
  async update(userId: string, projectId: string, segments: ScriptSegment[]): Promise<ScriptDto> {
    await this.projects.load(userId, projectId, 'editor');
    const existing = await this.findPrimary(projectId);
    if (!existing) throw new HttpError(404, 'This project has no script yet');
    return toDto(await prisma.script.update({ where: { id: existing.id }, data: { segments } }));
  }

  /** Claude rewrites the narration when configured; otherwise a deterministic cleanup is used. */
  private async write(transcript: TimedText[]): Promise<{ segments: TimedText[]; source: ScriptDto['source'] }> {
    if (!this.claude.isOnline) {
      console.log('[scripts] offline mode: drafting the script with the built-in cleanup');
      return { segments: draftOffline(transcript), source: 'offline' };
    }
    const endMs = Math.max(...transcript.map((s) => s.endMs));
    try {
      const output = await this.claude.generateJson({
        system: SYSTEM_PROMPT,
        prompt: `Rough narration (times in ms, the video ends at ${endMs}):\n${JSON.stringify(transcript)}`,
        jsonSchema: claudeJsonSchema,
        schema: claudeOutputSchema,
      });
      const segments = normalizeTimedText(
        output.segments.map((s) => ({ ...s, endMs: Math.min(s.endMs, endMs) })),
      );
      if (segments.length === 0) throw new AiError('Claude returned an empty script');
      return { segments, source: 'claude' };
    } catch (err) {
      console.error('[scripts] Claude rewrite failed', err);
      throw new HttpError(502, 'The AI could not write a script right now. Please try again.');
    }
  }

  /** The project's main script. Later milestones add one script per translated language. */
  private findPrimary(projectId: string): Promise<Script | null> {
    return prisma.script.findFirst({ where: { projectId }, orderBy: { createdAt: 'asc' } });
  }
}

function toDto(script: Script): ScriptDto {
  return {
    id: script.id,
    projectId: script.projectId,
    language: script.language,
    source: script.source === 'claude' ? 'claude' : 'offline',
    sourceMediaId: script.sourceMediaId,
    segments: scriptSegmentSchema.array().parse(script.segments),
    createdAt: script.createdAt.toISOString(),
    updatedAt: script.updatedAt.toISOString(),
  };
}
