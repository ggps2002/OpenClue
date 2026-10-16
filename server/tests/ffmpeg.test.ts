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

describe('FfmpegService voiceover audio', () => {
  it('makes silence of an exact length', async () => {
    const out = path.join(dir, 'silence.mp3');
    await ffmpeg.silence(1500, out);
    expect(await ffmpeg.hasAudio(out)).toBe(true);
    expect(Math.abs((await ffmpeg.probeDurationMs(out))! - 1500)).toBeLessThan(80);
  });

  it('speeds audio up without changing its content length beyond the tempo', async () => {
    const tone = path.join(dir, 'tone.mp3');
    await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', 'sine=duration=2', tone]);
    const fast = path.join(dir, 'fast.mp3');
    await ffmpeg.changeTempo(tone, fast, 1.25);
    expect(Math.abs((await ffmpeg.probeDurationMs(fast))! - 1600)).toBeLessThan(100);
  });

  it('mixes clips at offsets onto a track of the requested length', async () => {
    const a = path.join(dir, 'a.mp3');
    await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', a]);
    const track = path.join(dir, 'track.mp3');
    await ffmpeg.mixAtOffsets([{ path: a, startMs: 0 }, { path: a, startMs: 2000 }], 3000, track);
    expect(Math.abs((await ffmpeg.probeDurationMs(track))! - 3000)).toBeLessThan(100);

    const empty = path.join(dir, 'empty.mp3');
    await ffmpeg.mixAtOffsets([], 1000, empty);
    expect(Math.abs((await ffmpeg.probeDurationMs(empty))! - 1000)).toBeLessThan(80);
  });
});
