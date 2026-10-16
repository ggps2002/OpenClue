import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, routerFuture } from './app/App';
import { AuthProvider } from './app/AuthProvider';

export const testUser = {
  id: 'u1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  workspaces: [{ id: 'w1', name: "Ada's workspace", role: 'owner' }],
};

export function respond(status: number, body?: unknown) {
  return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

type Handler = (init: RequestInit | undefined, url: string) => Promise<Response>;

/**
 * Stubs global fetch with handlers keyed by "METHOD /path" (path without the /api prefix or query string).
 * `GET /auth/me` defaults to the signed-in test user; anything unmatched returns 404.
 */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '').split('?')[0];
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key] ?? (key === 'GET /auth/me' ? () => respond(200, { user: testUser }) : undefined);
    return handler ? handler(init, url) : respond(404, { error: `No mock for ${key}` });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={routerFuture}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}
