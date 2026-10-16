import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { createTimelineSchema, saveTimelineSchema } from './timelines.schema';
import type { TimelineService } from './timelines.service';

export class TimelineController {
  readonly router = Router();

  constructor(private readonly timelines: TimelineService) {
    this.router.get('/projects/:projectId/timeline', requireAuth, this.get);
    this.router.post('/projects/:projectId/timeline', requireAuth, this.create);
    this.router.put('/projects/:projectId/timeline', requireAuth, this.save);
  }

  private get = async (req: Request, res: Response) => {
    res.json(await this.timelines.get(currentUserId(req), String(req.params.projectId)));
  };

  private create = async (req: Request, res: Response) => {
    const { mediaId } = createTimelineSchema.parse(req.body ?? {});
    res.json(await this.timelines.create(currentUserId(req), String(req.params.projectId), mediaId));
  };

  private save = async (req: Request, res: Response) => {
    const { timeline } = saveTimelineSchema.parse(req.body ?? {});
    res.json(await this.timelines.save(currentUserId(req), String(req.params.projectId), timeline));
  };
}
