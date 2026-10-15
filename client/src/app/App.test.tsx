import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAt, respond, testUser } from '../test-utils';

const user = testUser;

afterEach(() => vi.unstubAllGlobals());

describe('App routes', () => {
  it('shows the landing page to visitors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond(401, { error: 'Not signed in' })));
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/polished product video/i);
    expect(screen.getByRole('link', { name: /get started free/i })).toHaveAttribute('href', '/signup');
  });

  it('redirects signed-out users from the app to sign in, then into the dashboard', async () => {
    const fetchMock = vi.fn((url: string) =>
      url.endsWith('/auth/signin')
        ? respond(200, { user })
        : url.endsWith('/projects')
          ? respond(200, { projects: [] })
          : respond(401, { error: 'Not signed in' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/app');

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Ada' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('shows server validation errors next to fields on sign-up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/auth/signup')
          ? respond(400, { error: 'Invalid input', issues: [{ path: 'password', message: 'Password must be at least 8 characters' }] })
          : respond(401, { error: 'Not signed in' }),
      ),
    );
    renderAt('/signup');
    await userEvent.type(await screen.findByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('signs out from the app shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/auth/signout')
          ? respond(204)
          : url.endsWith('/projects')
            ? respond(200, { projects: [] })
            : respond(200, { user }),
      ),
    );
    renderAt('/app');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(await screen.findByRole('link', { name: /get started free/i })).toBeInTheDocument();
  });
});
