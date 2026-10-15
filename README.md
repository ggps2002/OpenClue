# OpenClue

OpenClue is an open-source studio that turns rough screen recordings, slide decks, documents or a plain
text prompt into polished product videos and step-by-step documentation.

> Status: early development. See [ROADMAP.md](ROADMAP.md) for what is built and what is next.

## Requirements

- Node.js 20 or newer (`.nvmrc` pins 20)
- npm 10+

No database server or API keys are needed: the app uses SQLite and runs AI features in offline mode
(deterministic placeholder output) when keys are missing.

## Getting started

```bash
npm install      # installs both workspaces, creates server/.env from .env.example, generates the Prisma client
npm run dev      # API on http://localhost:4000, web app on http://localhost:5173
```

Open http://localhost:5173, create an account, and you land in the dashboard. Create a project, then upload
videos, images, audio, PDFs or slide decks into it or into the workspace media library.
`npm run dev` creates/updates the SQLite database at `server/prisma/dev.db` automatically.

## Scripts (run from the repo root)

| Script              | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `npm run dev`       | Runs the API (tsx watch) and the Vite dev server together         |
| `npm run build`     | Compiles the server with `tsc` and the client with Vite           |
| `npm start`         | Runs the compiled server, which also serves the built client      |
| `npm run typecheck` | Strict TypeScript checks for both packages                        |
| `npm run lint`      | ESLint across the repo                                            |
| `npm test`          | Vitest for server (Supertest, SQLite test DB) and client (jsdom)  |

Server-only helpers: `npm run db:push -w server`, `npm run db:studio -w server`.

## Environment variables

Set in `server/.env` (copied from `server/.env.example` on install). Never commit `.env`.

| Variable            | Default              | Purpose                                                       |
| ------------------- | -------------------- | ------------------------------------------------------------- |
| `NODE_ENV`          | `development`        | `production` serves the built client and requires `JWT_SECRET` |
| `PORT`              | `4000`               | API port                                                      |
| `DATABASE_URL`      | `file:./dev.db`      | Prisma connection string (SQLite path is relative to `server/prisma/`) |
| `JWT_SECRET`        | dev-only fallback    | Signs session cookies; must be set in production              |
| `STORAGE_DIR`       | `storage`            | Where uploaded and rendered media is stored                   |
| `MAX_UPLOAD_MB`     | `500`                | Largest accepted upload, in megabytes                         |
| `ANTHROPIC_API_KEY` | _(empty)_            | Enables Claude for scripts, docs, translation and planning    |
| `AI_MODEL`          | `claude-sonnet-5-5`  | Claude model id                                               |
| `OPENAI_API_KEY`    | _(empty)_            | Enables speech-to-text and text-to-speech                     |

## Project layout

```
client/              React 18 + Vite + Tailwind web app
  src/app/           router, layout, providers
  src/features/      one folder per feature (components, hooks, API calls)
  src/components/ui/ shared UI primitives
  src/lib/           ApiClient and utilities
server/              Express 5 API
  src/server.ts      the single entry point (Server class)
  src/config/        typed env loading
  src/lib/           Prisma client and shared service classes
  src/middleware/    auth, errors, uploads
  src/modules/       one folder per feature: controller + service (+ zod schema)
  prisma/            schema.prisma and the SQLite database
```

See [CLAUDE.md](CLAUDE.md) for the architecture rules.

## Switching to Postgres

Change `provider = "sqlite"` to `provider = "postgresql"` in `server/prisma/schema.prisma` and set
`DATABASE_URL` to a Postgres connection string. The schema avoids SQLite-only features.

## License

MIT
