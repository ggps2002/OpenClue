import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { MediaAsset } from '../media/media.api';
import type { ProjectDetail } from '../projects/projects.api';
import type { Script } from './script.api';

const now = new Date().toISOString();
const clip: MediaAsset = {
  id: 'm1',
  kind: 'video',
  name: 'take-1.webm',
  mimeType: 'video/webm',
  sizeBytes: 2048,
  projectId: 'p1',
  workspaceId: 'w1',
  url: '/api/media/m1/file',
  createdAt: now,
  recording: { durationMs: 10000, clickCount: 0 },
};
const project: ProjectDetail = {
  id: 'p1',
  name: 'Onboarding tour',
  workspaceId: 'w1',
  mediaCount: 1,
  createdAt: now,
  updatedAt: now,
  role: 'owner',
  media: [clip],
};
const script: Script = {
  id: 's1',
  projectId: 'p1',
  language: 'en',
  source: 'claude',
  sourceMediaId: 'm1',
  segments: [
    { id: 'a', startMs: 0, endMs: 4000, text: 'Welcome to the tour.' },
    { id: 'b', startMs: 4000, endMs: 10000, text: 'Open the settings page.' },
  ],
  createdAt: now,
  updatedAt: now,
};

/** The script editor also loads the voiceover; these tests start without one. */
const noVoiceover = {
  'GET /voices': () => respond(200, { voices: [{ id: 'coral', label: 'Coral', description: 'Warm' }], defaultVoice: 'coral', mode: 'offline' }),
  'GET /projects/p1/voiceover': () => respond(200, { voiceover: null }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ScriptPage', () => {
  it('writes a script from a project recording', async () => {
    const fetchMock = mockApi({
      ...noVoiceover,
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/script': () => respond(200, { script: null }),
      'POST /projects/p1/script': () => respond(200, { script: { ...script, source: 'offline' } }),
    });
    renderAt('/app/projects/p1/script');

    expect(await screen.findByRole('heading', { name: 'Write the script' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recording to script')).toHaveValue('m1');
    await userEvent.click(screen.getByRole('button', { name: 'Write script' }));

    expect(await screen.findByDisplayValue('Welcome to the tour.')).toBeInTheDocument();
    expect(screen.getByText(/written in offline mode/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ mediaId: 'm1', retranscribe: false });
  });

  it('asks for a recording when the project has none', async () => {
    mockApi({
      ...noVoiceover,
      'GET /projects/p1': () => respond(200, { project: { ...project, media: [], mediaCount: 0 } }),
      'GET /projects/p1/script': () => respond(200, { script: null }),
    });
    renderAt('/app/projects/p1/script');
    expect(await screen.findByText('Add a recording first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Record screen' })).toHaveAttribute('href', '/app/record?projectId=p1');
  });

  it('edits, splits and saves segments', async () => {
    const fetchMock = mockApi({
      ...noVoiceover,
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/script': () => respond(200, { script }),
      'PUT /projects/p1/script': (init) => {
        const body = JSON.parse(String(init?.body)) as { segments: Script['segments'] };
        return respond(200, { script: { ...script, segments: body.segments, updatedAt: new Date().toISOString() } });
      },
    });
    renderAt('/app/projects/p1/script');

    const first = await screen.findByRole('listitem', { name: 'Segment 1' });
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();

    const text = within(first).getByLabelText('Segment 1 text');
    await userEvent.clear(text);
    await userEvent.type(text, 'Hi there and welcome.  ');
    await userEvent.click(screen.getByRole('button', { name: 'Split segment 2' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();

    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    const saved = (JSON.parse(String(put?.[1]?.body)) as { segments: Script['segments'] }).segments;
    expect(saved.map((s) => [s.startMs, s.endMs, s.text])).toEqual([
      [0, 4000, 'Hi there and welcome.'],
      [4000, 7000, 'Open the'],
      [7000, 10000, 'settings page.'],
    ]);
  });

  it('blocks saving overlapping segments', async () => {
    mockApi({
      ...noVoiceover,
      'GET /projects/p1': () => respond(200, { project }),
      'GET /projects/p1/script': () => respond(200, { script }),
    });
    renderAt('/app/projects/p1/script');

    const second = await screen.findByRole('listitem', { name: 'Segment 2' });
    const start = within(second).getByLabelText('Start');
    await userEvent.clear(start);
    await userEvent.type(start, '3');
    await userEvent.tab();

    expect(within(second).getByRole('alert')).toHaveTextContent('Starts before the previous segment ends');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('is read-only for viewers', async () => {
    mockApi({
      ...noVoiceover,
      'GET /projects/p1': () => respond(200, { project: { ...project, role: 'viewer' } }),
      'GET /projects/p1/script': () => respond(200, { script }),
    });
    renderAt('/app/projects/p1/script');

    const first = await screen.findByRole('listitem', { name: 'Segment 1' });
    expect(within(first).getByText('Welcome to the tour.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
  });
});
