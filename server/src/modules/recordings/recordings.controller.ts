import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';
import type { StorageService } from '../../lib/storage';
import { currentUserId, requireAuth } from '../../middleware/auth';
import { HttpError } from '../../middleware/error';
import { singleFileUpload } from '../../middleware/upload';
import { detectMediaKind } from '../media/media.service';
import { createRecordingBodySchema } from './recordings.schema';
import type { RecordingService } from './recordings.service';

export class RecordingController {
  readonly router = Router();

  constructor(
    private readonly recordings: RecordingService,
    storage: StorageService,
  ) {
    const upload = singleFileUpload(storage, {
      field: 'file',
      accept: (file) => detectMediaKind(file.mimetype, file.originalname) === 'video',
      rejectMessage: 'A recording must be a video file',
    });
    this.router.post('/workspaces/:workspaceId/recordings', requireAuth, upload, this.create);
    this.router.get('/media/:mediaId/recording', requireAuth, this.get);
  }

  private create = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'Attach the recording in the "file" field');
    const parsed = createRecordingBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      await fs.promises.rm(file.path, { force: true });
      throw parsed.error;
    }
    const { metadata, projectId } = parsed.data;
    const media = await this.recordings.create(currentUserId(req), String(req.params.workspaceId), file, metadata, projectId);
    res.status(201).json({ media });
  };

  private get = async (req: Request, res: Response) => {
    res.json({ recording: await this.recordings.get(currentUserId(req), String(req.params.mediaId)) });
  };
}
