import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { env } from './config/env';
import { ClaudeClient } from './lib/claude';
import { FfmpegService } from './lib/ffmpeg';
import { prisma } from './lib/prisma';
import { SpeechClient } from './lib/speech';
import { StorageService } from './lib/storage';
import { errorHandler, notFoundHandler } from './middleware/error';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { MediaController } from './modules/media/media.controller';
import { MediaService } from './modules/media/media.service';
import { ProjectController } from './modules/projects/projects.controller';
import { ProjectService } from './modules/projects/projects.service';
import { RecordingController } from './modules/recordings/recordings.controller';
import { RecordingService } from './modules/recordings/recordings.service';
import { ScriptController } from './modules/scripts/scripts.controller';
import { ScriptService } from './modules/scripts/scripts.service';
import { TranscriptController } from './modules/transcripts/transcripts.controller';
import { TranscriptService } from './modules/transcripts/transcripts.service';
import { VoiceoverController } from './modules/voiceovers/voiceovers.controller';
import { VoiceoverService } from './modules/voiceovers/voiceovers.service';

/** The OpenClue HTTP server: middleware, module routers, errors, static client, listen. */
export class Server {
  readonly app: Express = express();

  constructor(
    private readonly storage = new StorageService(),
    private readonly ffmpeg = new FfmpegService(),
    private readonly claude = new ClaudeClient(),
    private readonly speech = new SpeechClient(),
  ) {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(cookieParser());

    this.app.get('/api/health', (_req, res) => {
      res.json({
        status: 'ok',
        aiMode: this.claude.isOnline ? 'online' : 'offline',
        speechMode: this.speech.isOnline ? 'online' : 'offline',
      });
    });
    this.mountModules();
    this.app.use('/api', notFoundHandler);

    if (env.NODE_ENV === 'production') this.serveClient();
    this.app.use(errorHandler);
  }

  private mountModules(): void {
    this.app.use('/api/auth', new AuthController(new AuthService()).router);
    const projects = new ProjectService(this.storage);
    this.app.use('/api', new ProjectController(projects).router);
    const media = new MediaService(this.storage);
    this.app.use('/api', new MediaController(media, this.storage).router);
    const recordings = new RecordingService(media, this.storage, this.ffmpeg);
    this.app.use('/api', new RecordingController(recordings, this.storage).router);
    const transcripts = new TranscriptService(media, this.storage, this.ffmpeg, this.speech);
    this.app.use('/api', new TranscriptController(transcripts).router);
    const scripts = new ScriptService(projects, media, transcripts, this.claude);
    this.app.use('/api', new ScriptController(scripts).router);
    const voiceovers = new VoiceoverService(scripts, this.storage, this.ffmpeg, this.speech);
    this.app.use('/api', new VoiceoverController(voiceovers).router);
  }

  private serveClient(): void {
    const indexHtml = path.join(env.clientDistDir, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      console.warn(`[server] client build not found at ${env.clientDistDir}; serving API only`);
      return;
    }
    this.app.use(express.static(env.clientDistDir));
    // SPA fallback: every non-API GET renders the client.
    this.app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(indexHtml));
  }

  listen(port: number = env.PORT): void {
    const httpServer = this.app.listen(port, () => {
      console.log(`[server] OpenClue listening on http://localhost:${port} (${env.NODE_ENV})`);
      if (!this.claude.isOnline) console.log('[server] ANTHROPIC_API_KEY not set: AI writing runs in offline mode');
      if (!this.speech.isOnline) console.log('[server] OPENAI_API_KEY not set: speech features run in offline mode');
    });
    const shutdown = () => {
      httpServer.close(() => void prisma.$disconnect().then(() => process.exit(0)));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

if (require.main === module) {
  new Server().listen();
}
