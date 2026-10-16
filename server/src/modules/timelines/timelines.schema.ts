import { z } from 'zod';

export const TIMELINE_VERSION = 1;
export const MAX_SCENES = 500;
export const MAX_TRACKS = 20;
export const MAX_CLIPS_PER_TRACK = 500;
/** Shortest scene or clip the editor allows; anything shorter can't be seen or heard. */
export const MIN_CLIP_MS = 100;

const id = z.string().min(1).max(64);
const ms = z.number().int().min(0);

/** A cut of a source video between `inMs` and `outMs`. Scenes play back to back in order. */
export const sceneSchema = z
  .object({
    id,
    name: z.string().trim().max(80),
    mediaId: id,
    inMs: ms,
    outMs: ms,
    /** Silences the video's own sound, e.g. when a voiceover replaces the narration. */
    muted: z.boolean(),
  })
  .refine((s) => s.outMs - s.inMs >= MIN_CLIP_MS, { message: `A scene must be at least ${MIN_CLIP_MS} ms long`, path: ['outMs'] });

export const audioSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('voiceover') }),
  z.object({ type: z.literal('media'), mediaId: id }),
]);

/** Plays `inMs..outMs` of its source starting at `startMs` on the timeline. */
export const audioClipSchema = z
  .object({ id, source: audioSourceSchema, startMs: ms, inMs: ms, outMs: ms })
  .refine((c) => c.outMs - c.inMs >= MIN_CLIP_MS, { message: `A clip must be at least ${MIN_CLIP_MS} ms long`, path: ['outMs'] });

export const trackSchema = z.object({
  id,
  kind: z.literal('audio'),
  name: z.string().trim().max(80),
  muted: z.boolean(),
  clips: z.array(audioClipSchema).max(MAX_CLIPS_PER_TRACK),
});

export const timelineDocSchema = z
  .object({
    version: z.literal(TIMELINE_VERSION),
    scenes: z.array(sceneSchema).max(MAX_SCENES),
    tracks: z.array(trackSchema).max(MAX_TRACKS),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    const check = (value: string, path: (string | number)[]) => {
      if (ids.has(value)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ids must be unique', path });
      ids.add(value);
    };
    doc.scenes.forEach((s, i) => check(s.id, ['scenes', i, 'id']));
    doc.tracks.forEach((t, i) => {
      check(t.id, ['tracks', i, 'id']);
      t.clips.forEach((c, j) => check(c.id, ['tracks', i, 'clips', j, 'id']));
    });
  });

export const saveTimelineSchema = z.object({ timeline: timelineDocSchema });
export const createTimelineSchema = z.object({ mediaId: id.optional() });

export type TimelineDoc = z.infer<typeof timelineDocSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type AudioTrack = z.infer<typeof trackSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
