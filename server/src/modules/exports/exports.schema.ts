import { z } from 'zod';

/** Output sizes per format. GIFs are kept small: every frame is a full palette image. */
export const EXPORT_QUALITIES = {
  mp4: {
    '720p': { width: 1280, height: 720, fps: 30, label: 'HD 720p' },
    '1080p': { width: 1920, height: 1080, fps: 30, label: 'Full HD 1080p' },
  },
  gif: {
    small: { width: 480, height: 270, fps: 10, label: 'Small (480 px wide)' },
    medium: { width: 640, height: 360, fps: 12, label: 'Medium (640 px wide)' },
  },
} as const;

/** Longer GIFs get too large to be useful; export an MP4 instead. */
export const MAX_GIF_MS = 60_000;

export const createExportSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('mp4'), quality: z.enum(['720p', '1080p']).default('1080p') }),
  z.object({ format: z.literal('gif'), quality: z.enum(['small', 'medium']).default('medium') }),
]);

export const exportFileQuerySchema = z.object({ download: z.enum(['0', '1']).optional() });

export type CreateExportInput = z.infer<typeof createExportSchema>;
export type ExportFormat = CreateExportInput['format'];
