import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAt, respond } from '../../test-utils';
import { FakeMediaRecorder, fakeEnvironment } from './test-fakes';

const now = new Date().toISOString();
const projectSummary = { id: 'p1', name: 'Launch', workspaceId: 'w1', mediaCount: 0, createdAt: now, updatedAt: now };

function installBrowserMedia(options: { micDenied?: boolean } = {}) {
  const fake = fakeEnvironment(options);
  Object.defineProperty(navigator, 'mediaDevices', { value: fake.env.mediaDevices, configurable: true });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
  return fake;
}

beforeEach(() => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordPage', () => {
  it('explains when the browser cannot record', async () => {
    mockApi({ 'GET /workspaces/w1/projects': () => respond(200, { projects: [] }) });
    renderAt('/app/record');
    expect(await screen.findByRole('alert')).toHaveTextContent('can’t record the screen');
  });

  it('records, reviews and saves into the chosen project', async () => {
    installBrowserMedia();
    const fetchMock = mockApi({
      'GET /workspaces/w1/projects': () => respond(200, { projects: [projectSummary] }),
      'POST /workspaces/w1/recordings': () => respond(201, { media: { id: 'm1' } }),
      'GET /projects/p1': () => respond(200, { project: { ...projectSummary, role: 'owner', media: [] } }),
    });
    renderAt('/app/record?projectId=p1');

    const select = await screen.findByLabelText('Save to project');
    await screen.findByRole('option', { name: 'Launch' });
    expect(select).toHaveValue('p1');

    await userEvent.click(screen.getByRole('button', { name: 'Start recording' }));
    expect(await screen.findByText(/Recording · 0 clicks captured/)).toBeInTheDocument();

    vi.mocked(performance.now).mockReturnValue(4200);
    await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

    expect(await screen.findByLabelText('Recording preview')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByText(/0:04 · 1920×1080/)).toBeInTheDocument();
    const nameField = screen.getByLabelText('Recording name');
    await userEvent.clear(nameField);
    await userEvent.type(nameField, 'Checkout flow');
    await userEvent.click(screen.getByRole('button', { name: 'Save recording' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Launch' })).toBeInTheDocument();
    const upload = fetchMock.mock.calls.find(([url]) => url === '/api/workspaces/w1/recordings');
    const form = upload?.[1]?.body as FormData;
    expect(form.get('projectId')).toBe('p1');
    expect(JSON.parse(String(form.get('metadata')))).toMatchObject({ durationMs: 4200, width: 1920, surface: 'browser', hasAudio: true });
    expect((form.get('file') as File).name).toBe('Checkout flow.webm');
  });

  it('shows a helpful message when permission is denied', async () => {
    installBrowserMedia({ micDenied: true });
    mockApi({ 'GET /workspaces/w1/projects': () => respond(200, { projects: [] }) });
    renderAt('/app/record');
    await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cancelled or blocked'));
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
  });
});
