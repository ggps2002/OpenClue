import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './ApiClient';

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe('ApiClient', () => {
  it('sends JSON with credentials and parses the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new ApiClient('/api', fetchFn);

    await expect(client.post('/things', { a: 1 })).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledWith('/api/things', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('uploads FormData without forcing a content type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'm1' }));
    const client = new ApiClient('/api', fetchFn);
    const form = new FormData();
    form.append('file', new Blob(['x']), 'a.png');

    await expect(client.upload('/media', form)).resolves.toEqual({ id: 'm1' });
    expect(fetchFn).toHaveBeenCalledWith('/api/media', {
      method: 'POST',
      credentials: 'include',
      headers: undefined,
      body: form,
    });
  });

  it('handles empty responses', async () => {
    const client = new ApiClient('/api', vi.fn().mockResolvedValue(jsonResponse(204)));
    await expect(client.delete('/things/1')).resolves.toBeUndefined();
  });

  it('throws ApiError with status, message and field issues', async () => {
    const body = { error: 'Invalid input', issues: [{ path: 'email', message: 'Enter a valid email' }] };
    const client = new ApiClient('/api', vi.fn().mockResolvedValue(jsonResponse(400, body)));

    const err = await client.get('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, message: 'Invalid input', issues: body.issues });
  });
});
