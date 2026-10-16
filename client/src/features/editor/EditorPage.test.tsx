import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { ProjectDetail } from '../projects/projects.api';
import type { TimelineDoc } from './Timeline';
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
    { id: 'm0', name: 'old-take.webm', kind: 'video', url: '/api/media/m0/file', durationMs: 4000 },
    { id: 'm1', name: 'take-1.webm', kind: 'video', url: '/api/media/m1/file', durationMs: 10000 },
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
    const names = () => within(strip).getAllByRole('button', { pressed: undefined }).map((b) => b.getAttribute('aria-label')?.split(',')[0]);
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
