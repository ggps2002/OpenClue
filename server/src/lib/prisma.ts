import { PrismaClient } from '@prisma/client';

/** The single shared Prisma client. Services import this directly. */
export const prisma = new PrismaClient();
