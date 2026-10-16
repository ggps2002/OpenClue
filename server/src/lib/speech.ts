import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env';

// A type alias (not an interface) so it is assignable to Prisma's Json input type.
export type TimedText = {
  startMs: number;
  endMs: number;
  text: string;
};

export interface TranscriptionResult {
  language: string;
  segments: TimedText[];
  /** "openai" for a real transcription, "offline" for placeholder output. */
  source: 'openai' | 'offline';
}

const verboseJsonSchema = z.object({
  language: z.string().optional(),
  segments: z
    .array(z.object({ start: z.number(), end: z.number(), text: z.string() }))
    .default([]),
  text: z.string().default(''),
});

/** Rough narration lines used when no OpenAI key is configured; fillers let the script cleanup show its work. */
const OFFLINE_LINES = [
  'So, um, in this video I am going to show you how this works.',
  'First we, uh, open the main screen and look at the overview.',
  'Then you click on the button here, like, at the top.',
  'And, you know, the details panel opens on the right side.',
  'Here you can change the settings that you need.',
  'Um, once that is done we save the changes.',
  'And that is basically it, the update is live right away.',
];

/** OpenAI text-to-speech voices, with our own short descriptions for the voice picker. */
export const VOICES = [
  { id: 'alloy', label: 'Alloy', description: 'Balanced and neutral' },
  { id: 'ash', label: 'Ash', description: 'Clear and direct' },
  { id: 'ballad', label: 'Ballad', description: 'Soft and melodic' },
  { id: 'coral', label: 'Coral', description: 'Warm and friendly' },
  { id: 'echo', label: 'Echo', description: 'Calm and even' },
  { id: 'fable', label: 'Fable', description: 'Expressive storyteller' },
  { id: 'nova', label: 'Nova', description: 'Bright and upbeat' },
  { id: 'onyx', label: 'Onyx', description: 'Deep and steady' },
  { id: 'sage', label: 'Sage', description: 'Thoughtful and measured' },
  { id: 'shimmer', label: 'Shimmer', description: 'Light and lively' },
] as const;

export type VoiceId = (typeof VOICES)[number]['id'];
export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];
export const DEFAULT_VOICE: VoiceId = 'coral';

const OFFLINE_SEGMENT_MS = 5000;
const MAX_OFFLINE_SEGMENTS = 60;

/**
 * Speech-to-text and text-to-speech through the OpenAI audio API. Without a key, `transcribe` returns a
 * deterministic placeholder; `synthesize` needs a key, so callers check `isOnline` and make silence instead.
 */
export class SpeechClient {
  constructor(
    private readonly apiKey: string | undefined = env.openaiApiKey,
    private readonly model: string = env.STT_MODEL,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly ttsModel: string = env.TTS_MODEL,
  ) {}

  get isOnline(): boolean {
    return Boolean(this.apiKey);
  }

  /** Transcribes an audio file. `durationMs` sizes the placeholder transcript in offline mode. */
  async transcribe(audioPath: string, durationMs: number): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      console.log('[speech] offline mode: returning a placeholder transcript');
      return offlineTranscript(durationMs);
    }
    const form = new FormData();
    form.append('file', await fs.openAsBlob(audioPath), path.basename(audioPath));
    form.append('model', this.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const res = await this.fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`OpenAI transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = verboseJsonSchema.parse(await res.json());
    const segments = data.segments
      .map((s) => ({ startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), text: s.text.trim() }))
      .filter((s) => s.text.length > 0);
    // Models without segment timestamps return only text; spread it over the whole clip.
    if (segments.length === 0 && data.text.trim()) {
      segments.push({ startMs: 0, endMs: durationMs, text: data.text.trim() });
    }
    return { language: data.language ?? 'en', segments, source: 'openai' };
  }

  /** Speaks `text` with `voice` and writes the MP3 to `outputPath`. */
  async synthesize(text: string, voice: VoiceId, outputPath: string): Promise<void> {
    if (!this.apiKey) throw new Error('Text-to-speech needs OPENAI_API_KEY');
    const res = await this.fetchFn('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.ttsModel, voice, input: text, response_format: 'mp3' }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI speech failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.promises.writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
  }
}

/** Placeholder transcript: one rough line per ~5 s slot, cycling through OFFLINE_LINES. */
export function offlineTranscript(durationMs: number): TranscriptionResult {
  const total = Math.max(1000, Math.round(durationMs));
  const slot = Math.max(OFFLINE_SEGMENT_MS, Math.ceil(total / MAX_OFFLINE_SEGMENTS));
  const segments: TimedText[] = [];
  for (let start = 0, i = 0; start < total; start += slot, i += 1) {
    segments.push({ startMs: start, endMs: Math.min(total, start + slot), text: OFFLINE_LINES[i % OFFLINE_LINES.length] });
  }
  return { language: 'en', segments, source: 'offline' };
}
