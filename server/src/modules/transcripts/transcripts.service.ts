import { z } from 'zod';
import type { FfmpegService } from '../../lib/ffmpeg';
import { prisma } from '../../lib/prisma';
import type { SpeechClient, TimedText } from '../../lib/speech';
import type { StorageService } from '../../lib/storage';
import { HttpError } from '../../middleware/error';
import type { MediaService } from '../media/media.service';

export interface TranscriptDto {
  mediaId: string;
  language: string;
  source: 'openai' | 'offline';
  segments: TimedText[];
  text: string;
  createdAt: string;
}

const timedTextSchema = z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() }));

/** Used when neither the recording metadata nor ffmpeg can tell how long a file is. */
const FALLBACK_DURATION_MS = 30_000;

/** Transcribes the audio of video/audio assets and stores one transcript per asset. */
export class TranscriptService {
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly speech: SpeechClient,
  ) {}

  async get(userId: string, mediaId: string): Promise<TranscriptDto> {
    await this.media.load(userId, mediaId, 'viewer');
    const transcript = await prisma.transcript.findUnique({ where: { mediaAssetId: mediaId } });
    if (!transcript) throw new HttpError(404, 'This file has not been transcribed yet');
    return toDto(transcript);
  }

  /** Returns the stored transcript, transcribing the file first if there is none. */
  async ensure(userId: string, mediaId: string): Promise<TranscriptDto> {
    await this.media.load(userId, mediaId, 'editor');
    const existing = await prisma.transcript.findUnique({ where: { mediaAssetId: mediaId } });
    return existing ? toDto(existing) : this.transcribe(userId, mediaId);
  }

  /** (Re)transcribes the asset's audio and replaces any stored transcript. */
  async transcribe(userId: string, mediaId: string): Promise<TranscriptDto> {
    const asset = await this.media.load(userId, mediaId, 'editor');
    if (asset.kind !== 'video' && asset.kind !== 'audio') {
      throw new HttpError(400, 'Only video and audio files can be transcribed');
    }
    const filePath = this.storage.resolve(asset.storageKey);
    const recording = await prisma.recording.findUnique({ where: { mediaAssetId: mediaId } });
    const durationMs = recording?.durationMs ?? (await this.ffmpeg.probeDurationMs(filePath)) ?? FALLBACK_DURATION_MS;

    const result = this.speech.isOnline
      ? await this.transcribeOnline(filePath, durationMs)
      : await this.speech.transcribe(filePath, durationMs);

    const data = { language: result.language, source: result.source, segments: result.segments };
    const saved = await prisma.transcript.upsert({
      where: { mediaAssetId: mediaId },
      create: { mediaAssetId: mediaId, ...data },
      update: data,
    });
    return toDto(saved);
  }

  private async transcribeOnline(filePath: string, durationMs: number) {
    if (!(await this.ffmpeg.hasAudio(filePath))) {
      throw new HttpError(422, 'This file has no audio track to transcribe');
    }
    const audioKey = this.storage.createKey('tmp', 'speech.mp3');
    const audioPath = this.storage.resolve(audioKey);
    try {
      await this.ffmpeg.extractAudio(filePath, audioPath);
      return await this.speech.transcribe(audioPath, durationMs);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error('[transcripts] transcription failed', err);
      throw new HttpError(502, 'Transcription failed. Please try again.');
    } finally {
      await this.storage.remove(audioKey);
    }
  }
}

function toDto(transcript: {
  mediaAssetId: string;
  language: string;
  source: string;
  segments: unknown;
  createdAt: Date;
}): TranscriptDto {
  const segments = timedTextSchema.parse(transcript.segments);
  return {
    mediaId: transcript.mediaAssetId,
    language: transcript.language,
    source: transcript.source === 'openai' ? 'openai' : 'offline',
    segments,
    text: segments.map((s) => s.text).join(' '),
    createdAt: transcript.createdAt.toISOString(),
  };
}
