import fs from 'node:fs';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { env } from '../config/env';
import type { StorageService } from '../lib/storage';
import { HttpError } from './error';

interface UploadOptions {
  field: string;
  /** Return false to reject a file by its reported name and MIME type. */
  accept(file: { originalname: string; mimetype: string }): boolean;
  rejectMessage: string;
}

/** Accepts one multipart file into the storage temp dir; the service then moves it into place. */
export function singleFileUpload(storage: StorageService, options: UploadOptions): RequestHandler {
  fs.mkdirSync(storage.tmpDir, { recursive: true });
  return multer({
    dest: storage.tmpDir,
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (options.accept(file)) cb(null, true);
      else cb(new HttpError(415, options.rejectMessage));
    },
  }).single(options.field);
}
