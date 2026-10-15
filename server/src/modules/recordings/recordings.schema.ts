import { z } from 'zod';

export const SURFACES = ['browser', 'window', 'monitor', 'unknown'] as const;

/** Upper bound so a runaway capture can't store an unbounded JSON blob. */
export const MAX_CLICKS = 5000;

const unit = z.number().min(0).max(1);

export const clickSchema = z.object({
  t: z.number().int().min(0),
  x: unit,
  y: unit,
});

export const recordingMetadataSchema = z.object({
  durationMs: z.number().int().positive(),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  surface: z.enum(SURFACES).default('unknown'),
  hasAudio: z.boolean(),
  clicks: z.array(clickSchema).max(MAX_CLICKS).default([]),
});

/** Multipart body: `metadata` arrives as a JSON string next to the file. */
export const createRecordingBodySchema = z.object({
  projectId: z.string().min(1).optional(),
  metadata: z.string().transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'metadata must be valid JSON' });
      return z.NEVER;
    }
  }).pipe(recordingMetadataSchema),
});

export type Click = z.infer<typeof clickSchema>;
export type RecordingMetadata = z.infer<typeof recordingMetadataSchema>;
