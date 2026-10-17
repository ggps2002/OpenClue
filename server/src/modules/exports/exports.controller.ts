import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { createExportSchema, exportFileQuerySchema } from './exports.schema';
import type { ExportService } from './exports.service';

export class ExportController {
  readonly router = Router();

  constructor(private readonly exports: ExportService) {
    this.router.get('/projects/:projectId/exports', requireAuth, this.list);
    this.router.post('/projects/:projectId/exports', requireAuth, this.create);
    this.router.get('/exports/:exportId', requireAuth, this.get);
    this.router.get('/exports/:exportId/file', requireAuth, this.file);
    this.router.delete('/exports/:exportId', requireAuth, this.remove);
    this.router.get('/usage', requireAuth, this.usage);
  }

  private list = async (req: Request, res: Response) => {
    res.json(await this.exports.list(currentUserId(req), String(req.params.projectId)));
  };

  private create = async (req: Request, res: Response) => {
    const input = createExportSchema.parse(req.body ?? {});
    res.status(201).json({ export: await this.exports.create(currentUserId(req), String(req.params.projectId), input) });
  };

  private get = async (req: Request, res: Response) => {
    res.json({ export: await this.exports.get(currentUserId(req), String(req.params.exportId)) });
  };

  private file = async (req: Request, res: Response) => {
    const { download } = exportFileQuerySchema.parse(req.query);
    const file = await this.exports.file(currentUserId(req), String(req.params.exportId));
    const disposition = download === '1' ? 'attachment' : 'inline';
    // sendFile handles Range requests, so the result can be previewed with seeking.
    res.sendFile(file.path, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  private remove = async (req: Request, res: Response) => {
    await this.exports.remove(currentUserId(req), String(req.params.exportId));
    res.status(204).end();
  };

  private usage = async (req: Request, res: Response) => {
    res.json({ usage: await this.exports.usage(currentUserId(req)) });
  };
}
