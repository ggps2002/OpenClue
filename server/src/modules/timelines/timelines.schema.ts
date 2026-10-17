import { z } from 'zod';

export const TIMELINE_VERSION = 1;
export const MAX_SCENES = 500;
export const MAX_TRACKS = 20;
export const MAX_CLIPS_PER_TRACK = 500;
/** Shortest scene or clip the editor allows; anything shorter can't be seen or heard. */
export const MIN_CLIP_MS = 100;
export const MAX_KEYFRAMES = 50;
export const MIN_TRANSITION_MS = 100;
export const MAX_TRANSITION_MS = 5000;
/** Same names as ffmpeg's xfade transitions so the render can pass them straight through. */
export const TRANSITION_TYPES = ['fade', 'fadeblack', 'wipeleft', 'wiperight', 'slideleft', 'slideup'] as const;
export const MAX_ZOOMS_PER_SCENE = 200;
/** A zoom eases in and out, so it needs some room to be seen at full strength. */
export const MIN_ZOOM_MS = 500;
export const MAX_ZOOM_SCALE = 4;

const id = z.string().min(1).max(64);
const ms = z.number().int().min(0);

/** How a scene takes over from the one before it. The two scenes overlap by `durationMs`. */
export const transitionSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  durationMs: z.number().int().min(MIN_TRANSITION_MS).max(MAX_TRANSITION_MS),
});

/**
 * A zoom (with optional spotlight) on a point of the scene's video. Times are in the source video's
 * clock, so zooms stay on the moment they belong to when the scene is trimmed, split or moved. x/y are
 * fractions of the source video's picture (the same space as recorded clicks).
 */
export const zoomSchema = z.object({
  id,
  startMs: ms,
  durationMs: ms.min(MIN_ZOOM_MS),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(1).max(MAX_ZOOM_SCALE),
  spotlight: z.boolean(),
});

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
    /** Transition from the previous scene into this one; absent or null is a hard cut. */
    transition: transitionSchema.nullable().optional(),
    /** In source time, ordered and not overlapping; zooms outside inMs..outMs are kept but not shown. */
    zooms: z.array(zoomSchema).max(MAX_ZOOMS_PER_SCENE).optional(),
  })
  .superRefine((scene, ctx) => {
    if (scene.outMs - scene.inMs < MIN_CLIP_MS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A scene must be at least ${MIN_CLIP_MS} ms long`, path: ['outMs'] });
    }
    scene.zooms?.forEach((zoom, i) => {
      const previous = scene.zooms?.[i - 1];
      if (previous && zoom.startMs < previous.startMs + previous.durationMs) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Zooms must be in time order and not overlap', path: ['zooms', i, 'startMs'] });
      }
    });
  });

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
    doc.scenes.forEach((s, i) => {
      check(s.id, ['scenes', i, 'id']);
      s.zooms?.forEach((z, j) => check(z.id, ['scenes', i, 'zooms', j, 'id']));
    });
    checkTransitions(doc.scenes, ctx);
    doc.tracks.forEach((t, i) => {
      check(t.id, ['tracks', i, 'id']);
      t.clips.forEach((c, j) => check(c.id, ['tracks', i, 'clips', j, 'id']));
    });
  });

/**
 * A transition may use at most half of each scene it joins, so a scene never overlaps more than one
 * neighbour at a time. The first scene has nothing to transition from.
 */
function checkTransitions(scenes: z.infer<typeof sceneSchema>[], ctx: z.RefinementCtx): void {
  scenes.forEach((scene, i) => {
    if (!scene.transition) return;
    const path = ['scenes', i, 'transition', 'durationMs'];
    if (i === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The first scene cannot have a transition', path: ['scenes', i, 'transition'] });
      return;
    }
    const shortest = Math.min(scene.outMs - scene.inMs, scenes[i - 1].outMs - scenes[i - 1].inMs);
    if (scene.transition.durationMs * 2 > shortest) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A transition can last at most half of each scene it joins', path });
    }
  });
}

export const saveTimelineSchema = z.object({ timeline: timelineDocSchema });
export const createTimelineSchema = z.object({ mediaId: id.optional() });

export type TimelineDoc = z.infer<typeof timelineDocSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type Transition = z.infer<typeof transitionSchema>;
export type Track = z.infer<typeof trackSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type OverlayTrack = z.infer<typeof overlayTrackSchema>;
export type OverlayClip = z.infer<typeof overlayClipSchema>;
export type AudioClip = z.infer<typeof audioClipSchema>;
