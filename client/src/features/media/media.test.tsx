import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { MediaAsset } from './media.api';

const now = new Date().toISOString();
const asset = (id: string, kind: MediaAsset['kind'], name: string): MediaAsset => ({
  id,
  kind,
  name,
  mimeType: kind === 'image' ? 'image/png' : 'application/pdf',
  sizeBytes: 1000,
  projectId: null,
  workspaceId: 'w1',
  url: `/api/media/${id}/file`,
  createdAt: now,
  recording: null,
});
const shot = asset('m1', 'image', 'shot.png');
const guide = asset('m2', 'pdf', 'guide.pdf');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MediaLibraryPage', () => {
  it('filters by type, moves files into projects and deletes them', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = mockApi({
      'GET /workspaces/w1/media': (_init, url) =>
        respond(200, { media: url.includes('kind=pdf') ? [guide] : [shot, guide] }),
      'GET /workspaces/w1/projects': () =>
        respond(200, { projects: [{ id: 'p1', name: 'Launch', workspaceId: 'w1', mediaCount: 0, createdAt: now, updatedAt: now }] }),
      'PATCH /media/m2': () => respond(200, { media: { ...guide, projectId: 'p1' } }),
      'DELETE /media/m2': () => respond(204),
    });
    renderAt('/app/media');

    expect(await screen.findByText('shot.png')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PDFs' }));
    expect(await screen.findByRole('button', { name: 'PDFs', pressed: true })).toBeInTheDocument();
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();

    const select = await screen.findByLabelText('Project for guide.pdf');
    await within(select).findByRole('option', { name: 'Launch' });
    await userEvent.selectOptions(select, 'p1');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH' && init.body === '{"projectId":"p1"}')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No pdfs yet')).toBeInTheDocument();
  });

  it('shows upload errors from the server', async () => {
    mockApi({
      'GET /workspaces/w1/media': () => respond(200, { media: [] }),
      'GET /workspaces/w1/projects': () => respond(200, { projects: [] }),
      'POST /workspaces/w1/media': () => respond(415, { error: 'Unsupported file type' }),
    });
    renderAt('/app/media');
    expect(await screen.findByText('Your library is empty')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Upload files'), new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('clip.mp4: Unsupported file type');
  });
});
