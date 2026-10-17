import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { MediaAsset } from '../media/media.api';
import type { ProjectDetail } from '../projects/projects.api';
import type { Script } from '../script/script.api';
import type { CaptionPreset, Captions, CaptionStyle } from './captions.api';

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
  recording: null,
};
const project: ProjectDetail = { id: 'p1', name: 'Onboarding tour', workspaceId: 'w1', mediaCount: 1, createdAt: now, updatedAt: now, role: 'owner', media: [clip] };
const script: Script = {
  id: 's1',
  projectId: 'p1',
  language: 'en',
  source: 'claude',
  sourceMediaId: 'm1',
  segments: [{ id: 'a', startMs: 0, endMs: 4000, text: 'Welcome to the tour. Open the settings page.' }],
  createdAt: now,
  updatedAt: now,
};
const clean: CaptionStyle = {
  preset: 'clean', fontFamily: 'sans', fontSize: 0.05, bold: false, uppercase: false, textColor: '#ffffff',
  outline: false, backgroundColor: '#000000', backgroundOpacity: 0.7, position: 'bottom',
};
const presets: CaptionPreset[] = [
  { id: 'clean', label: 'Clean', description: 'Dark box', style: clean },
  { id: 'bold', label: 'Bold', description: 'Big words', style: { ...clean, preset: 'bold', bold: true, uppercase: true, textColor: '#ffd60a', backgroundOpacity: 0 } },
];
const captions: Captions = {
  id: 'c1',
  projectId: 'p1',
  language: 'en',
  sourceMediaId: 'm1',
  cues: [
    { id: 'q1', startMs: 0, endMs: 1800, text: 'Welcome to the tour.' },
    { id: 'q2', startMs: 1800, endMs: 4000, text: 'Open the settings page.' },
  ],
  style: clean,
  maxCharsPerLine: 42,
  maxLines: 2,
  timing: 'script',
  stale: false,
  generatedAt: now,
  updatedAt: now,
};

function routes(overrides: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return mockApi({
    'GET /projects/p1': () => respond(200, { project }),
    'GET /projects/p1/script': () => respond(200, { script }),
    'GET /projects/p1/voiceover': () => respond(200, { voiceover: null }),
    'GET /projects/p1/captions': () => respond(200, { role: 'owner', captions }),
    'GET /caption-presets': () => respond(200, { presets, defaultPreset: 'clean' }),
    ...overrides,
  });
}

const sentBody = (fetchMock: ReturnType<typeof mockApi>, method: string) =>
  JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === method)?.[1]?.body)) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CaptionsPage', () => {
  it('makes captions from the script with a chosen layout and preset', async () => {
    const fetchMock = routes({
      'GET /projects/p1/captions': () => respond(200, { role: 'owner', captions: null }),
      'POST /projects/p1/captions': () => respond(200, { captions: { ...captions, style: presets[1].style } }),
    });
    renderAt('/app/projects/p1/captions');

    expect(await screen.findByRole('heading', { name: 'Make captions from the script' })).toBeInTheDocument();
    expect(screen.getByText(/no voiceover yet/)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Characters per line'));
    await userEvent.type(screen.getByLabelText('Characters per line'), '32');
    await userEvent.selectOptions(screen.getByLabelText('Lines per caption'), '1');
    await userEvent.click(screen.getByRole('button', { name: /Bold/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Make captions' }));

    expect(await screen.findByRole('listitem', { name: 'Caption 1' })).toBeInTheDocument();
    expect(sentBody(fetchMock, 'POST')).toEqual({ maxCharsPerLine: 32, maxLines: 1, preset: 'bold' });
    // The first caption shows over the preview at 0:00, in the preset's colour.
    const caption = within(screen.getByTestId('caption-layer')).getByText('Welcome to the tour.');
    expect(caption).toHaveStyle({ color: '#ffd60a', textTransform: 'uppercase' });
  });

  it('edits cues and style, saves them, and offers subtitle downloads', async () => {
    const fetchMock = routes({
      'PUT /projects/p1/captions': (init) => respond(200, { captions: { ...captions, ...(JSON.parse(String(init?.body)) as object), updatedAt: new Date(Date.now() + 1000).toISOString() } }),
    });
    renderAt('/app/projects/p1/captions');

    const first = await screen.findByRole('listitem', { name: 'Caption 1' });
    expect(screen.getByRole('link', { name: 'Download SRT' })).toHaveAttribute('href', '/api/projects/p1/captions/export?format=srt&timing=auto');
    await userEvent.clear(within(first).getByLabelText('Caption 1 text'));
    expect(within(first).getByRole('alert')).toHaveTextContent(/Write some text/);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await userEvent.type(within(first).getByLabelText('Caption 1 text'), 'Hello there');

    await userEvent.selectOptions(screen.getByLabelText('Position'), 'top');
    await userEvent.click(screen.getByLabelText('Uppercase'));
    // Unsaved changes are not exported.
    expect(screen.getByRole('button', { name: 'Download VTT' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeDisabled();
    const body = sentBody(fetchMock, 'PUT') as { cues: { text: string }[]; style: CaptionStyle };
    expect(body.cues.map((c) => c.text)).toEqual(['Hello there', 'Open the settings page.']);
    expect(body.style).toMatchObject({ position: 'top', uppercase: true, preset: 'clean' });
    await userEvent.selectOptions(screen.getByLabelText('Timing'), 'script');
    expect(screen.getByRole('link', { name: 'Download VTT' })).toHaveAttribute('href', '/api/projects/p1/captions/export?format=vtt&timing=script');
  });

  it('warns about stale captions and rebuilds them keeping the style', async () => {
    const fetchMock = routes({
      'GET /projects/p1/captions': () => respond(200, { role: 'owner', captions: { ...captions, stale: true } }),
      'POST /projects/p1/captions': () => respond(200, { captions: { ...captions, id: 'c2' } }),
    });
    renderAt('/app/projects/p1/captions');

    expect(await screen.findByText(/changed after these captions were made/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }));
    expect(screen.getByRole('button', { name: /Keep current/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Rebuild captions' }));
    expect(await screen.findByRole('listitem', { name: 'Caption 2' })).toBeInTheDocument();
    expect(sentBody(fetchMock, 'POST')).toEqual({ maxCharsPerLine: 42, maxLines: 2 });
  });

  it('is read-only for viewers and asks for a script first', async () => {
    routes({ 'GET /projects/p1': () => respond(200, { project: { ...project, role: 'viewer' } }) });
    const { unmount } = renderAt('/app/projects/p1/captions');
    expect(await screen.findByText('Welcome to the tour.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rebuild' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Position')).toBeDisabled();
    unmount();

    routes({ 'GET /projects/p1/script': () => respond(200, { script: null }), 'GET /projects/p1/captions': () => respond(200, { role: 'owner', captions: null }) });
    renderAt('/app/projects/p1/captions');
    expect(await screen.findByRole('link', { name: 'Go to the script' })).toHaveAttribute('href', '/app/projects/p1/script');
  });
});
