import type { Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { HttpError } from './error';

export const SESSION_COOKIE = 'openclue_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

interface SessionPayload {
  sub: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function setSessionCookie(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId } satisfies SessionPayload, env.JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function readUserId(req: Request): string | undefined {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string') return undefined;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/** Rejects the request with 401 unless it carries a valid session cookie. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const userId = readUserId(req);
  if (!userId) throw new HttpError(401, 'Not signed in');
  req.userId = userId;
  next();
};

/** Returns the authenticated user id; only valid after `requireAuth`. */
export function currentUserId(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Not signed in');
  return req.userId;
}
