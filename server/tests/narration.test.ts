import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiError, ClaudeClient } from '../src/lib/claude';
import { offlineTranscript, SpeechClient } from '../src/lib/speech';
import { cleanNarration, draftOffline, normalizeTimedText, wordBudget } from '../src/modules/scripts/narration';

describe('cleanNarration', () => {
  it.each([
    ['So, um, in this video I am going to show you how this works.', 'In this video I am going to show you how this works.'],
    ['Then you click on the button here, like, at the top.', 'Then you click on the button here, at the top.'],
    ['And, you know, the details panel opens on the right side.', 'The details panel opens on the right side.'],
    ['uh the the settings page', 'The settings page.'],
    ['okay so we save it,', 'We save it.'],
    ['Um, uh.', ''],
  ])('%s', (input, expected) => {
    expect(cleanNarration(input)).toBe(expected);
  });
});

describe('normalizeTimedText', () => {
  it('sorts, trims overlaps and drops empty or collapsed segments', () => {
    expect(
      normalizeTimedText([
        { startMs: 3000, endMs: 5000, text: 'b' },
        { startMs: -50, endMs: 3500.4, text: ' a ' },
        { startMs: 3200, endMs: 3400, text: 'swallowed' },
        { startMs: 6000, endMs: 7000, text: '   ' },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 3500, text: 'a' },
      { startMs: 3500, endMs: 5000, text: 'b' },
    ]);
  });
});

describe('draftOffline', () => {
  it('cleans lines and merges short neighbours', () => {
    const draft = draftOffline([
      { startMs: 0, endMs: 2000, text: 'Um, hello.' },
      { startMs: 2000, endMs: 4000, text: 'So this is the, uh, dashboard.' },
      { startMs: 9000, endMs: 12000, text: 'Uh.' },
      { startMs: 12000, endMs: 15000, text: 'Later we open the settings page and change the workspace name there.' },
    ]);
    expect(draft).toEqual([
      { startMs: 0, endMs: 4000, text: 'Hello. This is the dashboard.' },
      { startMs: 12000, endMs: 15000, text: 'Later we open the settings page and change the workspace name there.' },
    ]);
  });

  it('turns the offline transcript into fewer, cleaner segments', () => {
    const transcript = offlineTranscript(35_000).segments;
    const draft = draftOffline(transcript);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft.length).toBeLessThanOrEqual(transcript.length);
    expect(draft.map((s) => s.text).join(' ')).not.toMatch(/\b(um|uh)\b/i);
    expect(draft.at(-1)?.endMs).toBe(35_000);
  });

  it('computes a word budget per slot', () => {
    expect(wordBudget(0, 4000)).toBe(10);
  });
});

describe('SpeechClient', () => {
  it('produces a deterministic placeholder transcript offline', async () => {
    const client = new SpeechClient(undefined);
    expect(client.isOnline).toBe(false);
    const result = await client.transcribe('/does/not/matter.mp3', 12_000);
    expect(result.source).toBe('offline');
    expect(result.segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 5000],
      [5000, 10000],
      [10000, 12000],
    ]);
    expect(await client.transcribe('/x.mp3', 12_000)).toEqual(result);
  });

  it('caps long placeholder transcripts', () => {
    expect(offlineTranscript(60 * 60 * 1000).segments).toHaveLength(60);
  });

  it('calls the OpenAI transcription API and maps segments', async () => {
    const audio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-stt-')), 'speech.mp3');
    fs.writeFileSync(audio, 'mp3');
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        language: 'english',
        text: 'Hello there. Next step.',
        segments: [
          { start: 0, end: 1.5, text: ' Hello there. ' },
          { start: 1.5, end: 2.25, text: ' ' },
          { start: 2.25, end: 4, text: 'Next step.' },
        ],
      }),
    );
    const client = new SpeechClient('sk-test', 'whisper-1', fetchFn as unknown as typeof fetch);
    const result = await client.transcribe(audio, 4000);

    expect(result).toEqual({
      language: 'english',
      source: 'openai',
      segments: [
        { startMs: 0, endMs: 1500, text: 'Hello there.' },
        { startMs: 2250, endMs: 4000, text: 'Next step.' },
      ],
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect((init?.body as FormData).get('response_format')).toBe('verbose_json');
  });

  it('reports API failures', async () => {
    const audio = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-stt-')), 'speech.mp3');
    fs.writeFileSync(audio, 'mp3');
    const fetchFn = async () => new Response('quota exceeded', { status: 429 });
    const client = new SpeechClient('sk-test', 'whisper-1', fetchFn);
    await expect(client.transcribe(audio, 1000)).rejects.toThrow(/429/);
  });
});

describe('ClaudeClient', () => {
  it('is offline without an API key and refuses to generate', async () => {
    const client = new ClaudeClient(undefined);
    expect(client.isOnline).toBe(false);
    await expect(client.generateJson({ system: 's', prompt: 'p', jsonSchema: {}, schema: z.object({}) })).rejects.toBeInstanceOf(
      AiError,
    );
  });
});
