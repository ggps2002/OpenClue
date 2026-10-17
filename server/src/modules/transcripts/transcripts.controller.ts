import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import type { TranscriptService } from './transcripts.service';

export class TranscriptController {
  readonly router = Router();

  constructor(private readonly transcripts: TranscriptService) {
    this.router.get('/media/:mediaId/transcript', requireAuth, this.get);
    this.router.post('/media/:mediaId/transcript', requireAuth, this.transcribe);
  }

  private get = async (req: Request, res: Response) => {
    res.json({ transcript: await this.transcripts.get(currentUserId(req), String(req.params.mediaId)) });
  };

  private transcribe = async (req: Request, res: Response) => {
    res.json({ transcript: await this.transcripts.transcribe(currentUserId(req), String(req.params.mediaId)) });
  };
}
