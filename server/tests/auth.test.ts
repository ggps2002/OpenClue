import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/middleware/auth';
import { AuthService } from '../src/modules/auth/auth.service';
import { createApp, resetDatabase } from './helpers';

const app = createApp();
const credentials = { name: 'Ada Lovelace', email: 'Ada@Example.com', password: 'correct-horse' };

function sessionCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('No session cookie set');
  return cookie.split(';')[0];
}

describe('AuthService', () => {
  const service = new AuthService();
  beforeEach(resetDatabase);

  it('creates a user with a personal workspace they own', async () => {
    const user = await service.signUp({ name: 'Grace', email: 'grace@example.com', password: 'password123' });
    expect(user.email).toBe('grace@example.com');
    expect(user.workspaces).toEqual([expect.objectContaining({ name: "Grace's workspace", role: 'owner' })]);
  });

  it('rejects a duplicate email', async () => {
    await service.signUp({ name: 'Grace', email: 'grace@example.com', password: 'password123' });
    await expect(
      service.signUp({ name: 'Other', email: 'grace@example.com', password: 'password456' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('signs in with the right password only', async () => {
    await service.signUp({ name: 'Grace', email: 'grace@example.com', password: 'password123' });
    await expect(service.signIn({ email: 'grace@example.com', password: 'password123' })).resolves.toMatchObject({
      name: 'Grace',
    });
    await expect(service.signIn({ email: 'grace@example.com', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.signIn({ email: 'nobody@example.com', password: 'password123' })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('auth routes', () => {
  beforeEach(resetDatabase);

  it('signs up, sets an httpOnly session cookie and returns the user', async () => {
    const res = await request(app).post('/api/auth/signup').send(credentials).expect(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada Lovelace' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const raw = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(raw).toMatch(/HttpOnly/i);
  });

  it('validates sign-up input', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: '', email: 'not-an-email', password: 'short' })
      .expect(400);
    expect(res.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('returns the current user for a valid session and 401 otherwise', async () => {
    const signUp = await request(app).post('/api/auth/signup').send(credentials);
    const cookie = sessionCookie(signUp);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.email).toBe('ada@example.com');

    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Cookie', `${SESSION_COOKIE}=garbage`).expect(401);
  });

  it('signs in and out', async () => {
    await request(app).post('/api/auth/signup').send(credentials);
    const signIn = await request(app)
      .post('/api/auth/signin')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);
    expect(sessionCookie(signIn)).toContain(SESSION_COOKIE);

    await request(app)
      .post('/api/auth/signin')
      .send({ email: credentials.email, password: 'nope-nope' })
      .expect(401);

    const signOut = await request(app).post('/api/auth/signout').expect(204);
    expect((signOut.headers['set-cookie'] as unknown as string[])[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('reports health and 404s unknown API routes', async () => {
    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toEqual({ status: 'ok', aiMode: 'offline' });
    await request(app).get('/api/nope').expect(404);
  });
});
