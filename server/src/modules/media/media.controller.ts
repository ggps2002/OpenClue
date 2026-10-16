import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import type { StorageService } from '../../lib/storage';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { singleFileUpload } from '../../middleware/upload';
import { listMediaQuerySchema, updateMediaSchema, uploadMediaBodySchema } from './media.schema';
import { detectMediaKind, type MediaService } from './media.service';

export class MediaController {
  readonly router = Router();

  constructor(
    private readonly media: MediaService,
    storage: StorageService,
  ) {
    const upload = singleFileUpload(storage, {
      field: 'file',
      accept: (file) => detectMediaKind(file.mimetype, file.originalname) !== null,
      rejectMessage: 'Unsupported file type. Upload a video, image, audio, PDF or slide deck.',
    });
    this.router.get('/workspaces/:workspaceId/media', requireAuth, this.list);
    this.router.post('/workspaces/:workspaceId/media', requireAuth, upload, this.upload);
    this.router.get('/media/:mediaId/file', requireAuth, this.file);
    this.router.patch('/media/:mediaId', requireAuth, this.update);
    this.router.delete('/media/:mediaId', requireAuth, this.remove);
  }

  private list = async (req: Request, res: Response) => {
    const query = listMediaQuerySchema.parse(req.query);
    res.json({ media: await this.media.list(currentUserId(req), String(req.params.workspaceId), query) });
  };

  private upload = async (req: Request, res: Response) => {
    if (!req.file) throw new HttpError(400, 'Attach a file in the "file" field');
    const { projectId } = uploadMediaBodySchema.parse(req.body ?? {});
    const asset = await this.media.upload(currentUserId(req), String(req.params.workspaceId), req.file, projectId);
    res.status(201).json({ media: asset });
  };

  private file = async (req: Request, res: Response) => {
    const { asset, filePath } = await this.media.getFile(currentUserId(req), String(req.params.mediaId));
    if (!(await exists(filePath))) throw new HttpError(404, 'File is missing from storage');
    // sendFile handles Range requests, which video seeking relies on.
    res.sendFile(filePath, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
        'X-Content-Type-Options': 'nosniff',
        // Uploaded SVG/HTML-ish content must never run script when opened directly.
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      },
    });
  };

  private update = async (req: Request, res: Response) => {
    const input = updateMediaSchema.parse(req.body);
    res.json({ media: await this.media.update(currentUserId(req), String(req.params.mediaId), input) });
  };

  private remove = async (req: Request, res: Response) => {
    await this.media.delete(currentUserId(req), String(req.params.mediaId));
    res.status(204).end();
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}
