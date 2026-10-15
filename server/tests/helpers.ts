import request from 'supertest';
import { SESSION_COOKIE } from '../src/middleware/auth';
import { prisma } from '../src/lib/prisma';
import { Server } from '../src/server';

export function createApp() {
  return new Server().app;
}

export async function resetDatabase(): Promise<void> {
  await prisma.recording.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.project.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
}

export function sessionCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('No session cookie set');
  return cookie.split(';')[0];
}

export interface TestUser {
  id: string;
  cookie: string;
  workspaceId: string;
}

/** Signs up through the API and returns the session cookie and personal workspace id. */
export async function signUpUser(app: ReturnType<typeof createApp>, email: string): Promise<TestUser> {
  const res = await request(app)
    .post('/api/auth/signup')
    .send({ name: email.split('@')[0], email, password: 'password123' })
    .expect(201);
  const user = res.body.user as { id: string; workspaces: { id: string }[] };
  return { id: user.id, cookie: sessionCookie(res), workspaceId: user.workspaces[0].id };
}
