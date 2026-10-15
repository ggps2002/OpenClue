# OpenClue — guidance for Claude

OpenClue is an original, open-source web app that turns rough screen recordings, slides,
documents or a text prompt into polished product videos and step-by-step documentation.
It has its own identity: never reference other products by name, never copy their copy,
logos or trademarked feature names (templates are called "Style templates").

Work is driven by `ROADMAP.md` (milestones, decisions, progress log). Read it first.

## Stack (fixed)

- Client: React 18 + TypeScript, Vite, React Router, Tailwind CSS (v4 via `@tailwindcss/vite`). Own small UI components, no UI kit.
- Server: Node.js 20+, TypeScript, Express 5.
- Database: Prisma + SQLite (`server/prisma/dev.db`); schema must stay Postgres-compatible (no SQLite-only features, no Prisma enums — use strings).
- Media: `ffmpeg-static` spawned from a single `FfmpegService`; local disk storage under `server/storage/` behind a single `StorageService`.
- AI: Claude via `@anthropic-ai/sdk` (model from `AI_MODEL`, default `claude-sonnet-5-5`); OpenAI for STT/TTS (`OPENAI_API_KEY`).
- Without API keys everything still works: AI services return deterministic placeholder output and log that they are in offline mode. Tests always run offline.
- Tests: Vitest on client and server, Supertest for API routes.
- npm workspaces `client/` and `server/`. Root scripts: `dev`, `build`, `typecheck`, `lint`, `test`.

## Architecture rules

Clean OOP and a folder structure that scales, **without unnecessary abstraction**.

- **One server file.** `server/src/server.ts` is the only server entry point. It defines a `Server` class that sets up middleware, mounts every module's router, handles errors, serves the built client in production, and listens. Don't split this into app.ts / index.ts / bootstrap.ts or similar.
- **One build config per package.** The client builds with `client/vite.config.ts` only. The server builds with `tsc` from `server/tsconfig.json` only. No extra webpack/rollup/esbuild scripts.
- **Feature modules on the server:** `server/src/modules/<feature>/` holds `<feature>.controller.ts` (a class that owns its Express `router` and handles HTTP) and `<feature>.service.ts` (a class with the business logic). Add a `<feature>.schema.ts` (zod validation) only when the module needs input validation.
- **What to avoid:** no repository layer over Prisma (services use one shared Prisma client), no interfaces with a single implementation, no DI container, no factories, no abstract base classes unless three or more real subclasses share the code, no wrappers that only forward calls.
- **Server layout:** `server/src/config/env.ts` (typed env loading), `server/src/lib/` (Prisma client, FfmpegService, StorageService, AI client classes), `server/src/middleware/` (auth, error, upload).
- **Client layout:** `client/src/app/` (router, layout, providers), `client/src/features/<feature>/` (that feature's components, hooks and API calls), `client/src/components/ui/` (shared UI primitives), `client/src/lib/` (one `ApiClient` class, utilities). Components are function components with hooks. OOP on the client lives in the non-UI classes (ApiClient, the timeline model, the recorder).
- Strict TypeScript everywhere, no `any`. Keep files focused (split anything over ~300 lines). Comment only what isn't obvious.
- Never commit secrets or `.env`. Keep `.env.example` up to date.

## Conventions

- Services are wired by hand in the `Server` constructor (`new XService(...)`, `new XController(service)`).
- Express 5 is used, so async route handlers can throw; errors flow to the error middleware. Throw `HttpError` for expected failures.
- Server tests live in `server/tests/` and run against `server/prisma/test.db` (reset by the Vitest global setup). Client tests are colocated as `*.test.ts(x)`.
- Database schema changes are applied with `prisma db push` (see Decisions in ROADMAP.md).
- Before pushing: `npm install && npm run typecheck && npm run lint && npm test && npm run build` from the repo root must all pass.
