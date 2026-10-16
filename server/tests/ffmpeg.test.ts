import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FfmpegError, FfmpegService, parseDurationMs, parseLastTimeMs } from '../src/lib/ffmpeg';

const ffmpeg = new FfmpegService();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-ffmpeg-'));
const withAudio = path.join(dir, 'with-audio.webm');
// `-live 1` writes WebM without a duration header, like the browser's MediaRecorder does.
const liveWebm = path.join(dir, 'live.webm');

beforeAll(async () => {
  const video = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10'];
  await ffmpeg.exec(['-y', ...video, '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libvpx', '-c:a', 'libopus', '-shortest', withAudio]);
  await ffmpeg.exec(['-y', ...video, '-c:v', 'libvpx', '-live', '1', liveWebm]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('ffmpeg output parsing', () => {
  it('reads the container duration', () => {
    expect(parseDurationMs('  Duration: 00:01:02.50, start: 0.000000')).toBe(62500);
    expect(parseDurationMs('  Duration: N/A, start: 0.000000')).toBeNull();
  });

  it('reads the last progress time', () => {
    expect(parseLastTimeMs('frame=1 time=00:00:01.00 bitrate\nframe=2 time=00:00:04.20 bitrate')).toBe(4200);
    expect(parseLastTimeMs('nothing here')).toBeNull();
  });
});

describe('FfmpegService', () => {
  it('probes duration and audio streams', async () => {
    expect(await ffmpeg.probeDurationMs(withAudio)).toBeGreaterThanOrEqual(1900);
    expect(await ffmpeg.hasAudio(withAudio)).toBe(true);
    expect(await ffmpeg.hasAudio(liveWebm)).toBe(false);
  });

  it('decodes files without a duration header to find their length', async () => {
    const ms = await ffmpeg.probeDurationMs(liveWebm);
    expect(ms).toBeGreaterThanOrEqual(1800);
    expect(ms).toBeLessThanOrEqual(2200);
  });

  it('returns null for files that are not media', async () => {
    const junk = path.join(dir, 'junk.webm');
    fs.writeFileSync(junk, 'not a video');
    expect(await ffmpeg.probeDurationMs(junk)).toBeNull();
    await expect(ffmpeg.remux(junk, path.join(dir, 'out.webm'))).rejects.toBeInstanceOf(FfmpegError);
  });

  it('extracts speech audio as mp3', async () => {
    const out = path.join(dir, 'nested', 'speech.mp3');
    await ffmpeg.extractAudio(withAudio, out);
    expect(fs.statSync(out).size).toBeGreaterThan(0);
    expect(await ffmpeg.hasAudio(out)).toBe(true);
  });

  it('remuxes a live WebM so it gets a duration header', async () => {
    const out = path.join(dir, 'seekable.webm');
    await ffmpeg.remux(liveWebm, out);
    const { stderr } = await ffmpeg.run(['-i', out]);
    expect(parseDurationMs(stderr)).toBeGreaterThanOrEqual(1800);
  });
});
