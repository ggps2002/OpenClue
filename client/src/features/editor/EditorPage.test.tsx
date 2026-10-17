import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { ProjectDetail } from '../projects/projects.api';
import type { TimelineDoc } from './timelineDoc';
import type { TimelineData } from './timeline.api';

const now = new Date().toISOString();
const project: ProjectDetail = {
  id: 'p1',
  name: 'Onboarding tour',
  workspaceId: 'w1',
  mediaCount: 1,
  createdAt: now,
  updatedAt: now,
  role: 'owner',
  media: [],
};
const doc: TimelineDoc = {
  version: 1,
  scenes: [{ id: 's1', name: 'Scene 1', mediaId: 'm1', inMs: 0, outMs: 10000, muted: true }],
  tracks: [
    { id: 't1', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: 8000 }] },
  ],
};
const empty: TimelineData = {
  projectId: 'p1',
  role: 'owner',
  timeline: null,
  sources: [
    { id: 'm0', name: 'old-take.webm', kind: 'video', url: '/api/media/m0/file', durationMs: 4000, clickCount: 0 },
    { id: 'm1', name: 'take-1.webm', kind: 'video', url: '/api/media/m1/file', durationMs: 10000, clickCount: 3 },
  ],
  voiceover: { url: '/api/projects/p1/voiceover/track', durationMs: 8000 },
  updatedAt: null,
};
const withTimeline: TimelineData = { ...empty, timeline: doc, updatedAt: now };

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  // Unmount while the media stubs are still in place (the player pauses its elements on unmount).
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sentBody = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body)) as unknown;

describe('EditorPage', () => {
  it('starts an edit from a project video', async () => {
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, empty),
      'POST /projects/p1/timeline': () => respond(200, withTimeline),
    });
    renderAt('/app/projects/p1/editor');

    expect(await screen.findByRole('heading', { name: 'Start editing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Video')).toHaveValue('m1');
    await userEvent.click(screen.getByRole('button', { name: 'Start editing' }));

    const strip = await screen.findByLabelText('Timeline');
    expect(within(strip).getByRole('button', { name: /Scene 1, 0:10.0/ })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /Voiceover clip/ })).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(sentBody(fetchMock, 'POST')).toEqual({ mediaId: 'm1' });
  });

  it('splits, trims, undoes and saves the edit', async () => {
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, withTimeline),
      'PUT /projects/p1/timeline': (init) => respond(200, { ...withTimeline, timeline: (JSON.parse(String(init?.body)) as { timeline: TimelineDoc }).timeline }),
    });
    renderAt('/app/projects/p1/editor');

    const split = await screen.findByRole('button', { name: 'Split at playhead' });
    expect(split).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Playhead'), { target: { value: '4000' } });
    expect(split).toBeEnabled();
    await userEvent.click(split);
    const strip = screen.getByLabelText('Timeline');
    expect(within(strip).getByRole('button', { name: /^Scene 1, 0:04.0/ })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /^Scene 1 \(2\), 0:06.0/ })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await userEvent.click(within(strip).getByRole('button', { name: /^Scene 1 \(2\)/ }));
    const inspector = screen.getByLabelText('Inspector');
    const end = within(inspector).getByLabelText('Ends at (s)');
    await userEvent.clear(end);
    await userEvent.type(end, '9{Enter}');
    expect(within(strip).getByRole('button', { name: /^Scene 1 \(2\), 0:05.0/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(strip).getByRole('button', { name: /^Scene 1 \(2\), 0:06.0/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));

    await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    const saved = sentBody(fetchMock, 'PUT') as { timeline: TimelineDoc };
    expect(saved.timeline.scenes.map((s) => [s.name, s.inMs, s.outMs])).toEqual([
      ['Scene 1', 0, 4000],
      ['Scene 1 (2)', 4000, 9000],
    ]);
  });

  it('adds a transition between scenes, fitted to the scenes it joins', async () => {
    const twoScenes = { ...doc, scenes: [...doc.scenes, { id: 's2', name: 'Outro', mediaId: 'm0', inMs: 0, outMs: 4000, muted: false }] };
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, { ...withTimeline, timeline: twoScenes }),
      'PUT /projects/p1/timeline': (init) => respond(200, { ...withTimeline, timeline: (JSON.parse(String(init?.body)) as { timeline: TimelineDoc }).timeline }),
    });
    renderAt('/app/projects/p1/editor');

    const strip = await screen.findByLabelText('Timeline');
    await userEvent.click(within(strip).getByRole('button', { name: /^Outro/ }));
    const inspector = screen.getByLabelText('Inspector');
    await userEvent.selectOptions(within(inspector).getByLabelText(/Transition from/), 'Crossfade');
    expect(within(strip).getByRole('img', { name: 'Crossfade into Outro' })).toBeInTheDocument();
    expect(screen.getByText('0:00.0 / 0:13.5')).toBeInTheDocument();

    const length = within(inspector).getByLabelText(/Length \(s, up to 2.0\)/);
    await userEvent.clear(length);
    await userEvent.type(length, '3{Enter}');
    expect(length).toHaveValue(2);

    await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    const saved = sentBody(fetchMock, 'PUT') as { timeline: TimelineDoc };
    expect(saved.timeline.scenes[1].transition).toEqual({ type: 'fade', durationMs: 2000 });
  });

  it('trims, moves and zooms on the timeline strip, one undo step per drag', async () => {
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, withTimeline),
      'PUT /projects/p1/timeline': (init) => respond(200, { ...withTimeline, timeline: (JSON.parse(String(init?.body)) as { timeline: TimelineDoc }).timeline }),
    });
    renderAt('/app/projects/p1/editor');

    const strip = await screen.findByLabelText('Timeline');
    within(strip).getByRole('slider', { name: 'Trim end of Scene 1' }).focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft}{/Shift}{ArrowLeft}');
    expect(within(strip).getByRole('button', { name: /^Scene 1, 0:08.9/ })).toBeInTheDocument();

    // Lanes are 1000 px wide, so with 8.9 s on the strip a 200 px drag is 1.78 s.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 36, right: 1000, bottom: 36, x: 0, y: 0, toJSON: () => ({}) });
    const clip = within(strip).getByRole('button', { name: 'Voiceover clip at 0:00.0' });
    fireEvent.pointerDown(clip, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 300, pointerId: 1 });
    expect(within(strip).getByRole('button', { name: 'Voiceover clip at 0:01.7' })).toBeInTheDocument();
    fireEvent.pointerUp(clip, { clientX: 300, pointerId: 1 });
    fireEvent.click(within(strip).getByRole('button', { name: 'Voiceover clip at 0:01.7' }), { clientX: 300 });
    expect(screen.getByText('0:00.0 / 0:09.7')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(within(strip).getByRole('button', { name: 'Voiceover clip at 0:00.0' })).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: /^Scene 1, 0:08.9/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));

    await userEvent.click(within(strip).getByRole('button', { name: 'Zoom timeline in' }));
    await userEvent.click(within(strip).getByRole('button', { name: 'Zoom timeline in' }));
    expect(within(strip).getByLabelText('Timeline zoom 400%')).toBeInTheDocument();
    expect((within(strip).getByTestId('timeline-scroller').firstElementChild as HTMLElement).style.width).toBe('400%');
    await userEvent.click(within(strip).getByRole('button', { name: 'Fit' }));
    expect(within(strip).getByLabelText('Timeline zoom 100%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    const saved = sentBody(fetchMock, 'PUT') as { timeline: TimelineDoc };
    expect(saved.timeline.scenes[0].outMs).toBe(8900);
    expect(saved.timeline.tracks[0].clips[0].startMs).toBe(1780);
  });

  it('reorders and deletes scenes from the inspector', async () => {
    const twoScenes = { ...doc, scenes: [...doc.scenes, { id: 's2', name: 'Outro', mediaId: 'm0', inMs: 0, outMs: 4000, muted: false }] };
    mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, { ...withTimeline, timeline: twoScenes }),
    });
    renderAt('/app/projects/p1/editor');

    const strip = await screen.findByLabelText('Timeline');
    await userEvent.click(within(strip).getByRole('button', { name: /^Outro/ }));
    expect(screen.getByText('From old-take.webm')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    const names = () => within(strip).getAllByRole('button', { name: /, \d/ }).map((b) => b.getAttribute('aria-label')?.split(',')[0]);
    expect(names().slice(0, 2)).toEqual(['Outro', 'Scene 1']);
    await userEvent.click(screen.getByRole('button', { name: 'Delete scene' }));
    expect(within(strip).queryByRole('button', { name: /^Outro/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your edit' })).toBeInTheDocument();
  });

  it('adds a text overlay, animates it and saves it', async () => {
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, withTimeline),
      'PUT /projects/p1/timeline': (init) => respond(200, { ...withTimeline, timeline: (JSON.parse(String(init?.body)) as { timeline: TimelineDoc }).timeline }),
    });
    renderAt('/app/projects/p1/editor');

    fireEvent.change(await screen.findByLabelText('Playhead'), { target: { value: '1000' } });
    expect(screen.getByText(/Upload an image to this project/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add text' }));

    const inspector = screen.getByLabelText('Inspector');
    expect(within(inspector).getByRole('heading', { name: 'Overlay 1' })).toBeInTheDocument();
    const text = within(inspector).getByLabelText('Text');
    await userEvent.clear(text);
    await userEvent.type(text, 'Click Save');
    fireEvent.blur(text);

    const layer = screen.getByTestId('overlay-layer');
    const box = within(layer).getByRole('button', { name: 'Overlay: Click Save' });
    expect(box).toHaveStyle({ left: '50%', top: '50%' });
    expect(within(screen.getByLabelText('Timeline')).getByRole('button', { name: /Click Save overlay at 0:01.0/ })).toBeInTheDocument();

    // Nudging a static overlay moves its only keyframe.
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(within(layer).getByRole('button', { name: 'Overlay: Click Save' })).toHaveStyle({ left: '51%' });

    await userEvent.click(within(inspector).getByRole('button', { name: 'Fade in and out' }));
    expect(within(inspector).getAllByRole('button', { name: /Delete keyframe/ })).toHaveLength(4);

    await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    const saved = sentBody(fetchMock, 'PUT') as { timeline: TimelineDoc };
    const track = saved.timeline.tracks[1];
    expect(track).toMatchObject({ kind: 'overlay', name: 'Overlay 1', hidden: false });
    expect(track.kind === 'overlay' && track.clips[0]).toMatchObject({ startMs: 1000, durationMs: 3000, content: { type: 'text', text: 'Click Save' } });
    expect(track.kind === 'overlay' && track.clips[0].keyframes.map((k) => [k.t, k.opacity, k.x])).toEqual([
      [0, 0, 0.51],
      [300, 1, 0.51],
      [2700, 1, 0.51],
      [3000, 0, 0.51],
    ]);
  });

  it('zooms in where the recording was clicked, and frames a zoom on the preview', async () => {
    const fetchMock = mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, withTimeline),
      'GET /media/m1/recording': () =>
        respond(200, { recording: { clicks: [{ t: 2000, x: 0.2, y: 0.3 }, { t: 2500, x: 0.22, y: 0.3 }, { t: 7000, x: 0.9, y: 0.9 }] } }),
      'PUT /projects/p1/timeline': (init) => respond(200, { ...withTimeline, timeline: (JSON.parse(String(init?.body)) as { timeline: TimelineDoc }).timeline }),
    });
    renderAt('/app/projects/p1/editor');

    const strip = await screen.findByLabelText('Timeline');
    await userEvent.click(within(strip).getByRole('button', { name: /^Scene 1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Auto-zoom from 3 clicks' }));
    expect(await screen.findByText('Added 2 zooms from your clicks.')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: 'Zoom at 0:01.3, 180%' })).toBeInTheDocument();

    // On the playhead the preview video is zoomed in.
    fireEvent.change(screen.getByLabelText('Playhead'), { target: { value: '2500' } });
    expect(screen.getByLabelText('Preview').style.transform).toContain('scale(1.8000)');

    await userEvent.click(screen.getByRole('button', { name: /Zoom at 0:01.3, 180%/, pressed: false }));
    const inspector = screen.getByLabelText('Inspector');
    expect(within(inspector).getByRole('heading', { name: 'Zoom' })).toBeInTheDocument();
    // While selected the zoom is shown as an outline instead.
    expect(screen.getByLabelText('Preview').style.transform).toBe('');
    const area = within(screen.getByTestId('zoom-framing')).getByRole('button', { name: /Zoom area/ });
    // The focus (x 0.21) is near the edge, so the area starts from where the view stops (x 0.278) and moves from there.
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    await userEvent.click(within(inspector).getByLabelText('Spotlight the focus point'));
    await userEvent.click(within(inspector).getByRole('button', { name: 'Back to scene' }));
    expect(screen.getByTestId('spotlight')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    const saved = sentBody(fetchMock, 'PUT') as { timeline: TimelineDoc };
    expect(saved.timeline.scenes[0].zooms).toEqual([
      { id: expect.any(String), startMs: 1300, durationMs: 2700, x: 0.288, y: 0.3, scale: 1.8, spotlight: true },
      { id: expect.any(String), startMs: 6300, durationMs: 2200, x: 0.9, y: 0.9, scale: 1.8, spotlight: false },
    ]);
  });

  it('shows the captions over the preview, following the voiceover clip', async () => {
    const style = {
      preset: 'clean', fontFamily: 'sans', fontSize: 0.05, bold: false, uppercase: false, textColor: '#ffffff',
      outline: false, backgroundColor: '#000000', backgroundOpacity: 0.7, position: 'bottom',
    };
    const cues = [
      { id: 'q1', startMs: 0, endMs: 2000, text: 'Welcome to the tour.' },
      { id: 'q2', startMs: 2000, endMs: 4000, text: 'Open the settings.' },
    ];
    const moved = { ...doc, tracks: [{ ...doc.tracks[0], clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 1000, inMs: 0, outMs: 8000 }] }] };
    mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, { ...withTimeline, timeline: moved }),
      'GET /projects/p1/captions': () => respond(200, { role: 'owner', captions: { id: 'c', projectId: 'p1', sourceMediaId: 'm1', cues, style } }),
    });
    renderAt('/app/projects/p1/editor');

    const layer = await screen.findByTestId('caption-layer');
    // The voiceover starts 1 s into the edit, so nothing is captioned yet.
    expect(layer).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText('Playhead'), { target: { value: '3500' } });
    expect(within(layer).getByText('Open the settings.')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Show captions'));
    expect(screen.queryByTestId('caption-layer')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit captions' })).toHaveAttribute('href', '/app/projects/p1/captions');
  });

  it('is read-only for viewers', async () => {
    mockApi({
      'GET /projects/p1': () => respond(200, { project: { ...project, role: 'viewer' } }),
      'GET /projects/p1/timeline': () => respond(200, { ...withTimeline, role: 'viewer' }),
    });
    renderAt('/app/projects/p1/editor');

    expect(await screen.findByText(/only editors can change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save edit' })).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByLabelText('Timeline')).getByRole('button', { name: /^Scene 1/ }));
    expect(screen.getByLabelText('Ends at (s)')).toBeDisabled();
  });

  it('asks for a video when the project has none', async () => {
    mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/timeline': () => respond(200, { ...empty, sources: [] }),
    });
    renderAt('/app/projects/p1/editor');
    expect(await screen.findByRole('heading', { name: 'Add a video first' })).toBeInTheDocument();
  });
});
