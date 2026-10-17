import { z } from 'zod';
import { DEFAULT_VOICE, VOICE_IDS } from '../../lib/speech';

export const generateVoiceoverSchema = z.object({
  voice: z.enum(VOICE_IDS).default(DEFAULT_VOICE),
  /** "changed" only voices segments without an up-to-date clip; "all" re-voices every segment. */
  scope: z.enum(['all', 'changed']).default('changed'),
});

export const regenerateSegmentSchema = z.object({ voice: z.enum(VOICE_IDS).optional() });

export type GenerateVoiceoverInput = z.infer<typeof generateVoiceoverSchema>;
