import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { MediaAsset } from '../media/media.api';
import type { ProjectDetail } from '../projects/projects.api';
import type { Script } from '../script/script.api';
import type { Voiceover, VoiceList } from './voiceover.api';

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
const voices: VoiceList = {
  voices: [
    { id: 'coral', label: 'Coral', description: 'Warm and friendly' },
    { id: 'onyx', label: 'Onyx', description: 'Deep and steady' },
  ],
  defaultVoice: 'coral',
  mode: 'online',
};
const ready = (segmentId: string, extra: Partial<Voiceover['segments'][number]> = {}) => ({
  segmentId,
  status: 'ready' as const,
  audioUrl: `/api/projects/p1/voiceover/segments/${segmentId}/audio?v=1`,
  durationMs: 3000,
  tempo: 1,
  overflowMs: 0,
  source: 'openai' as const,
  ...extra,
});
const voiced: Voiceover = {
  projectId: 'p1',
  scriptId: 's1',
  voice: 'coral',
  trackUrl: '/api/projects/p1/voiceover/track?v=1',
  trackDurationMs: 10000,
  offline: false,
  segments: [ready('a'), ready('b', { tempo: 1.25, overflowMs: 1200 })],
  updatedAt: now,
};

function routes(voiceover: Voiceover | null, extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    'GET /projects/p1': () => respond(200, { project }),
    'GET /projects/p1/script': () => respond(200, { script }),
    'GET /voices': () => respond(200, voices),
    'GET /projects/p1/voiceover': () => respond(200, { voiceover }),
    ...extra,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voiceover on the script page', () => {
  it('generates a voiceover with the picked voice', async () => {
    const fetchMock = routes(null, { 'POST /projects/p1/voiceover': () => respond(200, { voiceover: { ...voiced, voice: 'onyx' } }) });
    renderAt('/app/projects/p1/script');

    const voice = await screen.findByLabelText('Voice');
    expect(voice).toHaveValue('coral');
    await userEvent.selectOptions(voice, 'onyx');
    await userEvent.click(screen.getByRole('button', { name: 'Generate voiceover' }));

    expect(await screen.findByText('Every segment is voiced and up to date.')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([url, init]) => init?.method === 'POST' && url.endsWith('/voiceover'));
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ voice: 'onyx', scope: 'changed' });

    const second = screen.getByRole('listitem', { name: 'Segment 2' });
    expect(within(second).getByText('sped up 1.25×')).toBeInTheDocument();
    expect(within(second).getByText(/runs 1.2 s past its slot/)).toBeInTheDocument();
    expect(screen.getByLabelText('Hear the voiceover with the video')).not.toBeChecked();
  });

  it('offers to update changed segments and regenerates one segment', async () => {
    const stale = { ...voiced, segments: [ready('a'), { ...ready('b'), status: 'stale' as const }] };
    const fetchMock = routes(stale, { 'POST /projects/p1/voiceover/segments/b': () => respond(200, { voiceover: voiced }) });
    renderAt('/app/projects/p1/script');

    expect(await screen.findByRole('button', { name: 'Update 1 changed' })).toBeEnabled();
    const second = screen.getByRole('listitem', { name: 'Segment 2' });
    expect(within(second).getByText('Voice out of date')).toBeInTheDocument();

    await userEvent.click(within(second).getByRole('button', { name: 'Regenerate voice for segment 2' }));
    expect(await within(second).findByText('Voiced')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'POST' && url.endsWith('/segments/b'))).toBe(true);
    expect(screen.queryByRole('button', { name: /changed/ })).not.toBeInTheDocument();
  });

  it('waits for unsaved script edits before voicing', async () => {
    routes(voiced);
    renderAt('/app/projects/p1/script');

    const first = await screen.findByRole('listitem', { name: 'Segment 1' });
    await userEvent.type(within(first).getByLabelText('Segment 1 text'), ' Extra.');
    expect(screen.getByText('Save your script edits to update the voiceover.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-voice all' })).toBeDisabled();
    expect(within(first).getByRole('button', { name: 'Regenerate voice for segment 1' })).toBeDisabled();
  });

  it('shows errors from a failed generation', async () => {
    routes(null, { 'POST /projects/p1/voiceover': () => respond(502, { error: 'The voiceover could not be made for 1 of 2 segments.' }) });
    renderAt('/app/projects/p1/script');
    await userEvent.click(await screen.findByRole('button', { name: 'Generate voiceover' }));
    expect(await screen.findByText(/could not be made for 1 of 2/)).toBeInTheDocument();
  });

  it('lets viewers listen but not generate', async () => {
    mockApi({
      'GET /projects/p1': () => respond(200, { project: { ...project, role: 'viewer' } }),
      'GET /projects/p1/script': () => respond(200, { script }),
      'GET /voices': () => respond(200, voices),
      'GET /projects/p1/voiceover': () => respond(200, { voiceover: voiced }),
    });
    renderAt('/app/projects/p1/script');
    expect(await screen.findByRole('button', { name: 'Play voice for segment 1' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Voice')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Regenerate voice/ })).not.toBeInTheDocument();
  });
});
