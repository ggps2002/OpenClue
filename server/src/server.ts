import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';

/** The OpenClue HTTP server: middleware, module routers, errors, static client, listen. */
export class Server {
  readonly app: Express = express();

  constructor() {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(cookieParser());

    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', aiMode: env.anthropicApiKey ? 'online' : 'offline' });
    });
    this.mountModules();
    this.app.use('/api', notFoundHandler);

    if (env.NODE_ENV === 'production') this.serveClient();
    this.app.use(errorHandler);
  }

  private mountModules(): void {
    this.app.use('/api/auth', new AuthController(new AuthService()).router);
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
      if (!env.anthropicApiKey) console.log('[server] ANTHROPIC_API_KEY not set: AI features run in offline mode');
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
