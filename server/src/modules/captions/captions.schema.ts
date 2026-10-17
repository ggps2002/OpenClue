import { z } from 'zod';

export const MAX_CUES = 5000;
export const MAX_CUE_CHARS = 300;
export const DEFAULT_MAX_CHARS_PER_LINE = 42;
export const DEFAULT_MAX_LINES = 2;

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Colors are #rrggbb');

/** Times are on the script's clock (the source video). Text may hold line breaks. */
export const captionCueSchema = z
  .object({
    id: z.string().min(1).max(64),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(1),
    text: z.string().trim().min(1, 'A caption needs some text').max(MAX_CUE_CHARS),
  })
  .refine((c) => c.endMs > c.startMs, { message: 'A caption must end after it starts', path: ['endMs'] });

export const captionCuesSchema = z
  .array(captionCueSchema)
  .max(MAX_CUES)
  .superRefine((cues, ctx) => {
    const ids = new Set<string>();
    cues.forEach((cue, i) => {
      if (ids.has(cue.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Caption ids must be unique', path: [i, 'id'] });
      ids.add(cue.id);
      const previous = cues[i - 1];
      if (previous && cue.startMs < previous.endMs) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Captions must be in order and must not overlap', path: [i, 'startMs'] });
      }
    });
  });

/** How captions look over the video. Font size is a fraction of the frame height, like overlay text. */
export const captionStyleSchema = z.object({
  preset: z.string().min(1).max(40),
  fontFamily: z.enum(['sans', 'serif', 'mono']),
  fontSize: z.number().min(0.03).max(0.12),
  bold: z.boolean(),
  uppercase: z.boolean(),
  textColor: color,
  /** A dark edge around the letters, for captions without a background. */
  outline: z.boolean(),
  backgroundColor: color,
  /** 0 hides the background box. */
  backgroundOpacity: z.number().min(0).max(1),
  position: z.enum(['bottom', 'middle', 'top']),
});

export type CaptionCue = z.infer<typeof captionCueSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;

export interface CaptionPreset {
  id: string;
  label: string;
  description: string;
  style: CaptionStyle;
}

const preset = (id: string, label: string, description: string, style: Omit<CaptionStyle, 'preset'>): CaptionPreset => ({
  id,
  label,
  description,
  style: { preset: id, ...style },
});

/** Starting points for the caption look; every value can be changed afterwards (and the brand kit will recolour them). */
export const CAPTION_PRESETS: CaptionPreset[] = [
  preset('clean', 'Clean', 'White text on a soft dark box. Readable on any footage.', {
    fontFamily: 'sans', fontSize: 0.05, bold: false, uppercase: false, textColor: '#ffffff',
    outline: false, backgroundColor: '#000000', backgroundOpacity: 0.7, position: 'bottom',
  }),
  preset('bold', 'Bold', 'Large uppercase words with an outline, for social clips.', {
    fontFamily: 'sans', fontSize: 0.07, bold: true, uppercase: true, textColor: '#ffd60a',
    outline: true, backgroundColor: '#000000', backgroundOpacity: 0, position: 'middle',
  }),
  preset('subtle', 'Subtle', 'Small outlined text that stays out of the way of the UI.', {
    fontFamily: 'sans', fontSize: 0.04, bold: false, uppercase: false, textColor: '#ffffff',
    outline: true, backgroundColor: '#000000', backgroundOpacity: 0, position: 'bottom',
  }),
  preset('banner', 'Banner', 'Dark text on a light band at the top of the frame.', {
    fontFamily: 'sans', fontSize: 0.045, bold: true, uppercase: false, textColor: '#0f172a',
    outline: false, backgroundColor: '#ffffff', backgroundOpacity: 0.9, position: 'top',
  }),
  preset('typewriter', 'Typewriter', 'Monospaced text on an accent box, for developer tools.', {
    fontFamily: 'mono', fontSize: 0.045, bold: false, uppercase: false, textColor: '#ffffff',
    outline: false, backgroundColor: '#4f46e5', backgroundOpacity: 0.85, position: 'bottom',
  }),
];

export const DEFAULT_PRESET = CAPTION_PRESETS[0];

export const generateCaptionsSchema = z.object({
  maxCharsPerLine: z.number().int().min(16).max(80).optional(),
  maxLines: z.union([z.literal(1), z.literal(2)]).optional(),
  /** Preset for captions made for the first time; regenerating keeps the current style unless this is set. */
  preset: z.string().refine((id) => CAPTION_PRESETS.some((p) => p.id === id), 'Unknown caption preset').optional(),
});

export const updateCaptionsSchema = z.object({
  cues: captionCuesSchema.optional(),
  style: captionStyleSchema.optional(),
});

export const exportCaptionsSchema = z.object({
  format: z.enum(['srt', 'vtt']),
  /** script: times of the source video; timeline: times of the edited video; auto: timeline when there is one. */
  timing: z.enum(['auto', 'script', 'timeline']).default('auto'),
});

export type GenerateCaptionsInput = z.infer<typeof generateCaptionsSchema>;
export type UpdateCaptionsInput = z.infer<typeof updateCaptionsSchema>;
export type ExportCaptionsInput = z.infer<typeof exportCaptionsSchema>;
