import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import type { MediaAsset } from '../media/media.api';
import type { ProjectDetail } from './projects.api';

const now = new Date().toISOString();
const project: ProjectDetail = {
  id: 'p1',
  name: 'Onboarding tour',
  workspaceId: 'w1',
  mediaCount: 0,
  createdAt: now,
  updatedAt: now,
  role: 'owner',
  media: [],
};
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
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Projects', () => {
  it('creates a project and opens it', async () => {
    const fetchMock = mockApi({
      'GET /workspaces/w1/projects': () => respond(200, { projects: [] }),
      'POST /workspaces/w1/projects': () => respond(201, { project }),
      'GET /projects/p1': () => respond(200, { project }),
      'GET /workspaces/w1/media': () => respond(200, { media: [] }),
    });
    renderAt('/app/projects');

    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText('Give your project a name')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New project name'), 'Onboarding tour');
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Onboarding tour' })).toBeInTheDocument();
    expect(screen.getByText('No files in this project')).toBeInTheDocument();
    const create = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(create?.[1]?.body).toBe(JSON.stringify({ name: 'Onboarding tour' }));
  });

  it('renames, uploads into and deletes a project', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi({
      'GET /projects/p1': () => respond(200, { project }),
      'PATCH /projects/p1': () => respond(200, { project: { ...project, name: 'Tour v2' } }),
      'POST /workspaces/w1/media': () => respond(201, { media: clip }),
      'GET /workspaces/w1/media': () => respond(200, { media: [] }),
      'DELETE /projects/p1': () => respond(204),
      'GET /workspaces/w1/projects': () => respond(200, { projects: [] }),
    });
    renderAt('/app/projects/p1');

    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Project name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Tour v2{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Tour v2' })).toBeInTheDocument();

    const file = new File(['video'], 'take-1.webm', { type: 'video/webm' });
    await userEvent.upload(screen.getByLabelText('Upload files'), file);
    const card = await screen.findByText('take-1.webm');
    expect(within(card.closest('li') as HTMLElement).getByText('Video · 2.0 KB')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
  });

  it('explains when a project is missing', async () => {
    mockApi({ 'GET /projects/nope': () => respond(404, { error: 'Project not found' }) });
    renderAt('/app/projects/nope');
    expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  });

  it('lists recent projects on the dashboard', async () => {
    mockApi({ 'GET /workspaces/w1/projects': () => respond(200, { projects: [{ ...project, mediaCount: 3 }] }) });
    renderAt('/app');
    const link = await screen.findByRole('link', { name: /Onboarding tour/ });
    expect(link).toHaveAttribute('href', '/app/projects/p1');
    await waitFor(() => expect(link).toHaveTextContent('3 files'));
  });
});
