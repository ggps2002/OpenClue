import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { exportCaptionsSchema, generateCaptionsSchema, updateCaptionsSchema } from './captions.schema';
import type { CaptionService } from './captions.service';

export class CaptionController {
  readonly router = Router();

  constructor(private readonly captions: CaptionService) {
    this.router.get('/caption-presets', requireAuth, this.presets);
    this.router.get('/projects/:projectId/captions', requireAuth, this.get);
    this.router.post('/projects/:projectId/captions', requireAuth, this.generate);
    this.router.put('/projects/:projectId/captions', requireAuth, this.update);
    this.router.delete('/projects/:projectId/captions', requireAuth, this.remove);
    this.router.get('/projects/:projectId/captions/export', requireAuth, this.export);
  }

  private presets = (_req: Request, res: Response) => {
    res.json(this.captions.presets());
  };

  private get = async (req: Request, res: Response) => {
    res.json(await this.captions.get(currentUserId(req), String(req.params.projectId)));
  };

  private generate = async (req: Request, res: Response) => {
    const input = generateCaptionsSchema.parse(req.body ?? {});
    res.json({ captions: await this.captions.generate(currentUserId(req), String(req.params.projectId), input) });
  };

  private update = async (req: Request, res: Response) => {
    const input = updateCaptionsSchema.parse(req.body ?? {});
    res.json({ captions: await this.captions.update(currentUserId(req), String(req.params.projectId), input) });
  };

  private remove = async (req: Request, res: Response) => {
    await this.captions.remove(currentUserId(req), String(req.params.projectId));
    res.status(204).end();
  };

  private export = async (req: Request, res: Response) => {
    const input = exportCaptionsSchema.parse(req.query);
    const file = await this.captions.export(currentUserId(req), String(req.params.projectId), input);
    res
      .type(file.contentType)
      .attachment(file.filename)
      .set('X-Content-Type-Options', 'nosniff')
      .send(file.body);
  };
}
