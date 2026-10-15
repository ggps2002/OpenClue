import { prisma } from '../src/lib/prisma';
import { Server } from '../src/server';

export function createApp() {
  return new Server().app;
}

export async function resetDatabase(): Promise<void> {
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
}
