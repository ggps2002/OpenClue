import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { generateVoiceoverSchema, regenerateSegmentSchema } from './voiceovers.schema';
import type { VoiceoverService } from './voiceovers.service';

export class VoiceoverController {
  readonly router = Router();

  constructor(private readonly voiceovers: VoiceoverService) {
    this.router.get('/voices', requireAuth, this.voices);
    this.router.get('/projects/:projectId/voiceover', requireAuth, this.get);
    this.router.post('/projects/:projectId/voiceover', requireAuth, this.generate);
    this.router.delete('/projects/:projectId/voiceover', requireAuth, this.remove);
    this.router.get('/projects/:projectId/voiceover/track', requireAuth, this.track);
    this.router.post('/projects/:projectId/voiceover/segments/:segmentId', requireAuth, this.regenerateSegment);
    this.router.get('/projects/:projectId/voiceover/segments/:segmentId/audio', requireAuth, this.clip);
  }

  private voices = (_req: Request, res: Response) => {
    res.json(this.voiceovers.voices());
  };

  private get = async (req: Request, res: Response) => {
    res.json({ voiceover: await this.voiceovers.get(currentUserId(req), String(req.params.projectId)) });
  };

  private generate = async (req: Request, res: Response) => {
    const input = generateVoiceoverSchema.parse(req.body ?? {});
    res.json({ voiceover: await this.voiceovers.generate(currentUserId(req), String(req.params.projectId), input) });
  };

  private regenerateSegment = async (req: Request, res: Response) => {
    const { voice } = regenerateSegmentSchema.parse(req.body ?? {});
    const voiceover = await this.voiceovers.regenerateSegment(
      currentUserId(req),
      String(req.params.projectId),
      String(req.params.segmentId),
      voice,
    );
    res.json({ voiceover });
  };

  private remove = async (req: Request, res: Response) => {
    await this.voiceovers.remove(currentUserId(req), String(req.params.projectId));
    res.status(204).end();
  };

  private track = async (req: Request, res: Response) => {
    sendAudio(res, await this.voiceovers.trackFile(currentUserId(req), String(req.params.projectId)));
  };

  private clip = async (req: Request, res: Response) => {
    const filePath = await this.voiceovers.clipFile(currentUserId(req), String(req.params.projectId), String(req.params.segmentId));
    sendAudio(res, filePath);
  };
}

function sendAudio(res: Response, filePath: string): void {
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Audio file is missing from storage');
  res.sendFile(filePath, { headers: { 'Content-Type': 'audio/mpeg', 'X-Content-Type-Options': 'nosniff' } });
}
