import { z } from 'zod';

export const TIMELINE_VERSION = 1;
export const MAX_SCENES = 500;
export const MAX_TRACKS = 20;
export const MAX_CLIPS_PER_TRACK = 500;
/** Shortest scene or clip the editor allows; anything shorter can't be seen or heard. */
export const MIN_CLIP_MS = 100;
export const MAX_KEYFRAMES = 50;

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

export const audioTrackSchema = z.object({
  id,
  kind: z.literal('audio'),
  name: z.string().trim().max(80),
  muted: z.boolean(),
  clips: z.array(audioClipSchema).max(MAX_CLIPS_PER_TRACK),
});

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Colors are #rrggbb');

/** What an overlay draws inside its box. Sizes are fractions of the 16:9 output frame. */
export const overlayContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().max(500),
    color,
    /** Font size as a fraction of the frame height. */
    fontSize: z.number().min(0.01).max(0.5),
    bold: z.boolean(),
    align: z.enum(['left', 'center', 'right']),
    /** Box fill behind the text, or null for none. */
    background: color.nullable(),
  }),
  z.object({
    type: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse']),
    fill: color.nullable(),
    stroke: color.nullable(),
  }),
  z.object({ type: z.literal('image'), mediaId: id }),
]);

/**
 * The overlay's animated properties at `t` ms after the clip starts. x/y are the box centre in frame
 * fractions (outside 0..1 is off screen, for slide-ins). `easing` shapes the move to the next keyframe.
 */
export const keyframeSchema = z.object({
  t: ms,
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  scale: z.number().min(0).max(10),
  opacity: z.number().min(0).max(1),
  easing: z.enum(['linear', 'easeInOut']),
});

export const overlayClipSchema = z
  .object({
    id,
    startMs: ms,
    durationMs: ms.min(MIN_CLIP_MS),
    width: z.number().min(0.01).max(2),
    height: z.number().min(0.01).max(2),
    content: overlayContentSchema,
    keyframes: z.array(keyframeSchema).min(1).max(MAX_KEYFRAMES),
  })
  .superRefine((clip, ctx) => {
    clip.keyframes.forEach((k, i) => {
      if (k.t > clip.durationMs) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Keyframes must fall inside the overlay', path: ['keyframes', i, 't'] });
      if (i > 0 && k.t <= clip.keyframes[i - 1].t) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Keyframes must be in time order', path: ['keyframes', i, 't'] });
    });
  });

/** Overlays drawn over the scenes; later tracks (and later clips in a track) are drawn on top. */
export const overlayTrackSchema = z.object({
  id,
  kind: z.literal('overlay'),
  name: z.string().trim().max(80),
  hidden: z.boolean(),
  clips: z.array(overlayClipSchema).max(MAX_CLIPS_PER_TRACK),
});

export const trackSchema = z.discriminatedUnion('kind', [audioTrackSchema, overlayTrackSchema]);

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
export type Track = z.infer<typeof trackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type OverlayTrack = z.infer<typeof overlayTrackSchema>;
export type OverlayClip = z.infer<typeof overlayClipSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
