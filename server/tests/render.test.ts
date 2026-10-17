import { describe, expect, it } from 'vitest';
import { buildRenderPlan, placeScenes, sceneAudioFades, timelineDurationMs } from '../src/modules/exports/render';
import type { Scene, TimelineDoc } from '../src/modules/timelines/timelines.schema';

const scene = (id: string, inMs: number, outMs: number, extra: Partial<Scene> = {}): Scene => ({ id, name: id, mediaId: 'v', inMs, outMs, muted: false, ...extra });

const doc: TimelineDoc = {
  version: 1,
  scenes: [
    scene('a', 0, 2000),
    scene('b', 500, 3000, { transition: { type: 'slideleft', durationMs: 600 } }),
    scene('c', 0, 1000, { muted: true }),
  ],
  tracks: [
    { id: 't', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'vo', source: { type: 'voiceover' }, startMs: 1000, inMs: 0, outMs: 4000 }] },
    { id: 'm', kind: 'audio', name: 'Muted', muted: true, clips: [{ id: 'x', source: { type: 'media', mediaId: 'v' }, startMs: 0, inMs: 0, outMs: 9000 }] },
  ],
};
const sources = { media: new Map([['v', { path: '/v.mp4', hasAudio: true }]]), voiceoverPath: '/vo.mp3' };
const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1];

describe('render planning', () => {
  it('places scenes with transitions overlapping, like the editor', () => {
    expect(placeScenes(doc.scenes).map((p) => [p.startMs, p.lengthMs])).toEqual([
      [0, 2000],
      [1400, 2500],
      [3900, 1000],
    ]);
    // The voiceover (1000 + 4000) outlasts the scenes (4900); muted tracks still count, as in the editor.
    expect(timelineDurationMs(doc)).toBe(9000);
  });

  it('builds an MP4 command: trimmed inputs, xfade and concat, mixed audio, exact length', () => {
    const { args, durationMs } = buildRenderPlan(doc, sources, { format: 'mp4', width: 1280, height: 720, fps: 30 }, '/out.mp4');
    expect(durationMs).toBe(9000);
    const filter = filterOf(args);
    expect(args.join(' ')).toContain('-ss 0.500 -t 2.500 -i /v.mp4');
    expect(args.join(' ')).toContain('-ss 0.000 -t 4.000 -i /vo.mp3');
    expect(args.join(' ')).not.toContain('-t 9.000 -i /v.mp4');
    expect(filter).toContain('xfade=transition=slideleft:duration=0.600:offset=1.400');
    expect(filter).toContain('concat=n=2:v=1:a=0');
    expect(filter).toContain('scale=1280:720:force_original_aspect_ratio=decrease');
    // Scenes a and b have sound (c is muted) plus the voiceover clip, on top of the silent bed.
    expect(filter).toContain('amix=inputs=4:duration=first:normalize=0[aout]');
    expect(filter).toContain('adelay=1400:all=1');
    expect(filter).toContain('tpad=stop_mode=add:stop_duration=4.100:color=black');
    expect(args.slice(-3)).toEqual(['-t', '9.000', '/out.mp4']);
    expect(args).toContain('libx264');
  });

  it('builds a silent GIF with its own palette', () => {
    const { args } = buildRenderPlan(doc, sources, { format: 'gif', width: 480, height: 270, fps: 10 }, '/out.gif');
    const filter = filterOf(args);
    expect(filter).toContain('palettegen');
    expect(filter).not.toContain('amix');
    expect(args).not.toContain('anullsrc=r=48000:cl=stereo');
    expect(args).toContain('gif');
  });

  it('skips sound from files without an audio stream', () => {
    const silent = { media: new Map([['v', { path: '/v.mp4', hasAudio: false }]]), voiceoverPath: null };
    const plain: TimelineDoc = { version: 1, scenes: [scene('a', 0, 1000)], tracks: [] };
    expect(filterOf(buildRenderPlan(plain, silent, { format: 'mp4', width: 640, height: 360, fps: 30 }, '/o.mp4').args)).toContain('amix=inputs=1');
    expect(() => buildRenderPlan({ ...plain, scenes: [] }, silent, { format: 'mp4', width: 640, height: 360, fps: 30 }, '/o.mp4')).toThrow();
  });

  it('fades scene sound over transitions, dipping to silence for fade to black', () => {
    const next = scene('n', 0, 1000, { transition: { type: 'fade', durationMs: 400 } });
    expect(sceneAudioFades(scene('a', 0, 2000), next, 2000)).toEqual(['afade=t=out:st=1.600:d=0.400']);
    expect(sceneAudioFades(next, undefined, 1000)).toEqual(['afade=t=in:st=0.000:d=0.400']);
    const black = scene('b', 0, 1000, { transition: { type: 'fadeblack', durationMs: 400 } });
    expect(sceneAudioFades(black, undefined, 1000)).toEqual(['afade=t=in:st=0.200:d=0.200']);
    expect(sceneAudioFades(scene('a', 0, 2000), black, 2000)).toEqual(['afade=t=out:st=1.600:d=0.200']);
  });
});
