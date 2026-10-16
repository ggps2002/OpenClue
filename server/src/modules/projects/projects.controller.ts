import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { projectNameSchema } from './projects.schema';
import type { ProjectService } from './projects.service';

export class ProjectController {
  readonly router = Router();

  constructor(private readonly projects: ProjectService) {
    this.router.get('/workspaces/:workspaceId/projects', requireAuth, this.list);
    this.router.post('/workspaces/:workspaceId/projects', requireAuth, this.create);
    this.router.get('/projects/:projectId', requireAuth, this.get);
    this.router.patch('/projects/:projectId', requireAuth, this.rename);
    this.router.delete('/projects/:projectId', requireAuth, this.remove);
  }

  private list = async (req: Request, res: Response) => {
    res.json({ projects: await this.projects.list(currentUserId(req), String(req.params.workspaceId)) });
  };

  private create = async (req: Request, res: Response) => {
    const { name } = projectNameSchema.parse(req.body);
    const project = await this.projects.create(currentUserId(req), String(req.params.workspaceId), name);
    res.status(201).json({ project });
  };

  private get = async (req: Request, res: Response) => {
    res.json({ project: await this.projects.get(currentUserId(req), String(req.params.projectId)) });
  };

  private rename = async (req: Request, res: Response) => {
    const { name } = projectNameSchema.parse(req.body);
    res.json({ project: await this.projects.rename(currentUserId(req), String(req.params.projectId), name) });
  };

  private remove = async (req: Request, res: Response) => {
    await this.projects.delete(currentUserId(req), String(req.params.projectId));
    res.status(204).end();
  };
}
