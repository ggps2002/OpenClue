import { z } from 'zod';

export const MAX_SEGMENTS = 500;
export const MAX_SEGMENT_CHARS = 2000;

export const scriptSegmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    text: z.string().trim().max(MAX_SEGMENT_CHARS),
  })
  .refine((s) => s.endMs > s.startMs, { message: 'A segment must end after it starts', path: ['endMs'] });

export const scriptSegmentsSchema = z
  .array(scriptSegmentSchema)
  .max(MAX_SEGMENTS)
  .superRefine((segments, ctx) => {
    const ids = new Set<string>();
    segments.forEach((segment, i) => {
      if (ids.has(segment.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Segment ids must be unique', path: [i, 'id'] });
      }
      ids.add(segment.id);
      const previous = segments[i - 1];
      if (previous && segment.startMs < previous.endMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Segments must be in order and must not overlap',
          path: [i, 'startMs'],
        });
      }
    });
  });

export const updateScriptSchema = z.object({ segments: scriptSegmentsSchema });

export const generateScriptSchema = z.object({
  mediaId: z.string().min(1),
  /** Transcribe the audio again instead of reusing a stored transcript. */
  retranscribe: z.boolean().default(false),
});

export type ScriptSegment = z.infer<typeof scriptSegmentSchema>;
export type GenerateScriptInput = z.infer<typeof generateScriptSchema>;
