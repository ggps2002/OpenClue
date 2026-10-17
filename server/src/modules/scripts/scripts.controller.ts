import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { generateScriptSchema, updateScriptSchema } from './scripts.schema';
import type { ScriptService } from './scripts.service';

export class ScriptController {
  readonly router = Router();

  constructor(private readonly scripts: ScriptService) {
    this.router.get('/projects/:projectId/script', requireAuth, this.get);
    this.router.post('/projects/:projectId/script', requireAuth, this.generate);
    this.router.put('/projects/:projectId/script', requireAuth, this.update);
  }

  private get = async (req: Request, res: Response) => {
    res.json({ script: await this.scripts.get(currentUserId(req), String(req.params.projectId)) });
  };

  private generate = async (req: Request, res: Response) => {
    const input = generateScriptSchema.parse(req.body ?? {});
    res.json({ script: await this.scripts.generate(currentUserId(req), String(req.params.projectId), input) });
  };

  private update = async (req: Request, res: Response) => {
    const { segments } = updateScriptSchema.parse(req.body ?? {});
    res.json({ script: await this.scripts.update(currentUserId(req), String(req.params.projectId), segments) });
  };
}
