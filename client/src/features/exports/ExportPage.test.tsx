import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { TimelineData } from '../editor/timeline.api';
import type { TimelineDoc } from '../editor/timelineDoc';
import type { ProjectDetail } from '../projects/projects.api';
import type { ExportItem, Usage } from './exports.api';

const now = new Date().toISOString();
const project: ProjectDetail = { id: 'p1', name: 'Onboarding tour', workspaceId: 'w1', mediaCount: 1, createdAt: now, updatedAt: now, role: 'owner', media: [] };
const doc = (outMs: number): TimelineDoc => ({ version: 1, scenes: [{ id: 's1', name: 'Scene 1', mediaId: 'm1', inMs: 0, outMs, muted: false }], tracks: [] });
const timeline = (d: TimelineDoc | null): TimelineData => ({ projectId: 'p1', role: 'owner', timeline: d, sources: [], voiceover: null, updatedAt: now });
const usage: Usage = { month: '2026-10', exportMs: 90_000, exportMinutes: 1.5 };
const item = (overrides: Partial<ExportItem> = {}): ExportItem => ({
  id: 'e1', projectId: 'p1', format: 'mp4', quality: '1080p', width: 1920, height: 1080, status: 'queued', progress: 0, queuePosition: 1,
  durationMs: 12_000, sizeBytes: null, error: null, fileUrl: null, downloadUrl: null, createdAt: now, finishedAt: null, ...overrides,
});

function routes(overrides: Record<string, Parameters<typeof mockApi>[0][string]> = {}) {
  return mockApi({
    'GET /projects/p1': () => respond(200, { project }),
    'GET /projects/p1/timeline': () => respond(200, timeline(doc(12_000))),
    'GET /projects/p1/exports': () => respond(200, { role: 'owner', exports: [], usage }),
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ExportPage', () => {
  it('starts an export, follows its progress and offers the file when it is ready', async () => {
    const done = item({ status: 'done', progress: 1, queuePosition: null, sizeBytes: 3_500_000, fileUrl: '/api/exports/e1/file', downloadUrl: '/api/exports/e1/file?download=1' });
    let polls = 0;
    let listed: ExportItem[] = [];
    const fetchMock = routes({
      'GET /projects/p1/exports': () => respond(200, { role: 'owner', exports: listed, usage: listed.length ? { ...usage, exportMinutes: 1.7 } : usage }),
      'POST /projects/p1/exports': () => respond(201, { export: item() }),
      'GET /exports/e1': () => {
        polls += 1;
        if (polls === 1) return respond(200, { export: item({ status: 'rendering', progress: 0.4, queuePosition: null }) });
        listed = [done];
        return respond(200, { export: done });
      },
    });
    renderAt('/app/projects/p1/export');

    expect(await screen.findByText('1.5 min')).toBeInTheDocument();
    expect(screen.getByText(/Renders the last saved edit \(0:12\)/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Size'), '720p');
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body)) as object;
    expect(body).toEqual({ format: 'mp4', quality: '720p' });

    expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
    const bar = await screen.findByRole('progressbar', {}, { timeout: 3000 });
    await vi.waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '40'), { timeout: 3000 });

    const download = await screen.findByRole('link', { name: 'Download' }, { timeout: 3000 });
    expect(download).toHaveAttribute('href', '/api/exports/e1/file?download=1');
    expect(screen.getByText(/Ready · 3.3 MB/)).toBeInTheDocument();
    expect(screen.getByText('1.7 min')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByLabelText('MP4 · Full HD 1080p preview')).toHaveAttribute('src', '/api/exports/e1/file');
  });

  it('switches sizes with the format and blocks GIFs that are too long', async () => {
    routes({ 'GET /projects/p1/timeline': () => respond(200, timeline(doc(75_000))) });
    renderAt('/app/projects/p1/export');
    await userEvent.click(await screen.findByLabelText(/Animated GIF/));
    const size = screen.getByLabelText('Size');
    expect(within(size).getAllByRole('option').map((o) => o.textContent)).toEqual(['Medium (640 px wide)', 'Small (480 px wide)']);
    expect(screen.getByRole('alert')).toHaveTextContent(/at most 60 seconds/);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/Video \(MP4\)/));
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it('cancels a running export and shows failures', async () => {
    const fetchMock = routes({
      'GET /projects/p1/exports': () =>
        respond(200, {
          role: 'owner',
          exports: [item({ status: 'rendering', progress: 0.1, queuePosition: null }), item({ id: 'e2', status: 'failed', error: 'Rendering failed. Try again.' })],
          usage,
        }),
      'GET /exports/e1': () => respond(200, { export: item({ status: 'rendering', progress: 0.2, queuePosition: null }) }),
      'DELETE /exports/e1': () => respond(204),
    });
    renderAt('/app/projects/p1/export');
    expect(await screen.findByText('Rendering failed. Try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await vi.waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/exports/e1' && init?.method === 'DELETE')).toBe(true);
  });

  it('asks for an edit first and is read-only for viewers', async () => {
    routes({ 'GET /projects/p1/timeline': () => respond(200, timeline(null)) });
    const { unmount } = renderAt('/app/projects/p1/export');
    expect(await screen.findByRole('link', { name: 'Open the editor' })).toHaveAttribute('href', '/app/projects/p1/editor');
    unmount();

    const done = item({ status: 'done', progress: 1, queuePosition: null, fileUrl: '/f', downloadUrl: '/f?download=1' });
    routes({
      'GET /projects/p1': () => respond(200, { project: { ...project, role: 'viewer' } }),
      'GET /projects/p1/exports': () => respond(200, { role: 'viewer', exports: [done], usage }),
    });
    renderAt('/app/projects/p1/export');
    expect(await screen.findByRole('link', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
