import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';

/** Throw from services/controllers for expected failures; mapped to a JSON response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' });
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'File is too large' : err.message });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid input',
      issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};
