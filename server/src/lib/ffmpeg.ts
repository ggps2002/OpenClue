import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

interface RunResult {
  code: number;
  stderr: string;
}

export interface RunOptions {
  /** Called with the output time ffmpeg has reached (from its `time=` status lines). */
  onProgress?: (timeMs: number) => void;
  /** Aborting kills ffmpeg; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
}

/** Keeps only the tail of stderr so long encodes don't buffer megabytes of progress lines. */
const STDERR_LIMIT = 64 * 1024;

/** The only place that spawns ffmpeg. All media processing goes through this class. */
export class FfmpegService {
  constructor(private readonly binary: string = ffmpegPath ?? 'ffmpeg') {}

  /** Runs ffmpeg with `args` and resolves with its exit code and (tail of) stderr; never throws on exit code. */
  run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    const { onProgress, signal } = options;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const child = spawn(this.binary, ['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
      const abort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', abort, { once: true });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_LIMIT);
        if (!onProgress) return;
        const timeMs = parseLastTimeMs(chunk);
        if (timeMs !== null) onProgress(timeMs);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(signal.reason);
        else resolve({ code: code ?? -1, stderr });
      });
    });
  }

  /** Like `run`, but rejects with an FfmpegError when ffmpeg exits non-zero. */
  async exec(args: string[], options: RunOptions = {}): Promise<void> {
    const { code, stderr } = await this.run(args, options);
    if (code !== 0) {
      const lastLine = stderr.trim().split('\n').pop() ?? '';
      throw new FfmpegError(`ffmpeg exited with code ${code}: ${lastLine}`, stderr);
    }
  }

  /**
   * Media duration in ms, or null if the file can't be read. Browser WebM recordings have no duration
   * header, so when the container doesn't say, the file is decoded to find the last timestamp.
   */
  async probeDurationMs(input: string): Promise<number | null> {
    const header = await this.run(['-i', input]);
    const fromHeader = parseDurationMs(header.stderr);
    if (fromHeader !== null) return fromHeader;
    if (!/Stream #/.test(header.stderr)) return null;
    const decoded = await this.run(['-i', input, '-f', 'null', '-']);
    return parseLastTimeMs(decoded.stderr);
  }

  /** True if the file contains at least one audio stream. */
  async hasAudio(input: string): Promise<boolean> {
    const { stderr } = await this.run(['-i', input]);
    return /Stream #\S+.*Audio:/.test(stderr);
  }

  /** Extracts a compact mono 16 kHz MP3, the format speech-to-text works best with. */
  async extractAudio(input: string, output: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await this.exec(['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', '-f', 'mp3', output]);
  }

  /** Rewrites the container without re-encoding, which adds the duration/seek index MediaRecorder leaves out. */
  async remux(input: string, output: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await this.exec(['-y', '-i', input, '-map', '0', '-c', 'copy', output]);
  }

  /** Writes a silent speech MP3 of exactly `durationMs` (the offline stand-in for a voiceover clip). */
  async silence(durationMs: number, output: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await this.exec(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', seconds(durationMs), ...SPEECH_MP3, output]);
  }

  /** Re-encodes audio played `tempo` times faster without changing pitch (atempo accepts 0.5–100). */
  async changeTempo(input: string, output: string, tempo: number): Promise<void> {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    await this.exec(['-y', '-i', input, '-filter:a', `atempo=${tempo.toFixed(4)}`, ...SPEECH_MP3, output]);
  }

  /** Mixes clips onto one silent track of `durationMs`, each starting at its `startMs`. */
  async mixAtOffsets(clips: { path: string; startMs: number }[], durationMs: number, output: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(output), { recursive: true });
    const inputs = ['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', ...clips.flatMap((c) => ['-i', c.path])];
    const delayed = clips.map((c, i) => `[${i + 1}:a]aresample=24000,adelay=${Math.max(0, Math.round(c.startMs))}:all=1[d${i}]`);
    const labels = ['[0:a]', ...clips.map((_, i) => `[d${i}]`)].join('');
    // The silent source keeps the track running through gaps; normalize=0 stops amix lowering each clip's volume.
    const filter = [...delayed, `${labels}amix=inputs=${clips.length + 1}:duration=first:normalize=0[out]`].join(';');
    await this.exec(['-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-t', seconds(durationMs), ...SPEECH_MP3, output]);
  }
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3);
}

/** Voiceover audio format: speech-friendly mono MP3 at the sample rate OpenAI TTS returns. */
const SPEECH_MP3 = ['-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3'];

/** Parses `Duration: 00:01:02.50` from ffmpeg's input summary; null for `N/A` or missing. */
export function parseDurationMs(stderr: string): number | null {
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  return match ? toMs(match[1], match[2], match[3]) : null;
}

/** Parses the last `time=00:00:04.20` progress value ffmpeg printed. */
export function parseLastTimeMs(stderr: string): number | null {
  const matches = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  return last ? toMs(last[1], last[2], last[3]) : null;
}

function toMs(h: string, m: string, s: string): number {
  return Math.round((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000);
}
