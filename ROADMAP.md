# OpenClue roadmap

Each scheduled run takes the first unchecked milestone, builds a working slice, and records progress here.

## Milestones

- [x] 1. **Foundation.** Workspaces, client and server skeletons, `server.ts`, Prisma + SQLite, all root scripts working, README. Email/password auth (bcrypt, JWT in an httpOnly cookie) with sign-up, sign-in and sign-out. A public landing page with original copy describing the product. A signed-in app shell with sidebar navigation and an empty dashboard.
- [x] 2. **Projects and media.** Create, rename and delete projects. Upload video, images, PDF and slide files (multer → StorageService). A per-workspace media library. A project detail page.
- [x] 3. **Browser screen recording.** Record screen + mic with getDisplayMedia + MediaRecorder from inside the app (a `ScreenRecorder` class), capture click positions and timestamps during recording (for auto-zoom later), and upload the result into a project.
- [x] 4. **Transcription and AI script.** Transcribe a recording's audio. Claude rewrites the rough narration into a clean script split into timed segments, which the user can edit.
- [ ] 5. **AI voiceover.** Generate TTS audio per script segment, with a voice picker, synced to segment timing, and the option to regenerate one segment.
- [ ] 6. **Video editor.** A timeline with scenes, tracks and clips (a `Timeline` model class): trim, split, reorder; text, shape and image overlays with keyframed position, scale and opacity; transitions between scenes; automatic zoom/spotlight effects from recorded click data, which the user can edit; a live preview player.
- [ ] 7. **Captions.** Auto-generate captions from the script/voiceover, with brand-styleable caption presets. Export SRT and VTT.
- [ ] 8. **Export and rendering.** A server-side render of the timeline to MP4 with ffmpeg through an in-process job queue class with progress polling, plus GIF export. Track export minutes per user each month.
- [ ] 9. **Documentation from video.** Turn a video into a step-by-step guide: extract key frames as screenshots (ffmpeg) and have Claude write the steps. An editable article view, with export to Markdown, HTML and PDF.
- [ ] 10. **Translation.** Translate the script, captions and on-screen text into many languages with Claude, re-voice with TTS, and keep a language switcher per project.
- [ ] 11. **Slides/PDF/doc to video.** Turn an uploaded deck or document into scenes with narration.
- [ ] 12. **Prompt to video.** The user writes a prompt and can attach reference files. The app asks clarifying questions (audience, goal, style), then generates a draft video (scenes, on-screen text, simple motion, voiceover) that opens in the editor.
- [ ] 13. **Brand kit and style templates.** A brand kit (logo, colors, fonts) applied to captions and overlays. Save a video's structure, style, pacing and audio as a reusable style template and apply it to new videos.
- [ ] 14. **Collaboration.** Workspaces with members and roles (owner/editor/viewer), invites, comments pinned to timeline timestamps, review/approval status, and view-only share links.
- [ ] 15. **Plans and usage.** A pricing page (Free with 10 export minutes a month, Solo, Business, Enterprise) and plan limits enforced on export. Keep billing as a stub module behind an env flag (Stripe only if `STRIPE_SECRET_KEY` is set).
- [ ] 16. **Polish.** Responsive layouts, accessibility pass, empty and error states, an end-to-end test of the core flow (record/upload → script → voiceover → export → docs).

Stretch (only after 1–16): AI presenter avatars, an MCP server exposing projects to AI clients, a Chrome extension recorder, SSO.

## Decisions

- **2026-10-15 — Schema changes via `prisma db push`, not migrations.** Keeps SQLite zero-setup and the schema provider-agnostic (migration SQL is provider-specific). Revisit when moving to Postgres in production.
- **2026-10-15 — Test DB reset by deleting the file.** Prisma's CLI blocks `db push --force-reset` when run by an AI agent, so `server/tests/global-setup.ts` deletes `prisma/test.db` and runs a plain `db push`. Do not try to bypass Prisma's consent check.
- **2026-10-15 — Express 5.** Native async error propagation, so controllers need no async wrapper.
- **2026-10-15 — Tailwind v4 via `@tailwindcss/vite`.** No `tailwind.config.js`/`postcss.config.js`; theme tokens live in `client/src/index.css`. Vitest config lives inside `client/vite.config.ts` (one config per package).
- **2026-10-15 — `bcryptjs`** (pure-JS bcrypt) instead of native `bcrypt` to avoid native builds.
- **2026-10-15 — Personal workspace on sign-up.** Every user gets a `Workspace` + `Membership(role="owner")` at sign-up so media/projects can be workspace-scoped from milestone 2; roles are strings (`owner|editor|viewer`) for Postgres/SQLite portability.
- **2026-10-15 — Server is CommonJS** (`tsc` → `server/dist/src/server.js`); `server/tsconfig.json` also includes `tests/` so typecheck covers them. The root ESLint flat config is `eslint.config.mjs`.
- **2026-10-15 — Server tests in `server/tests/`, client tests colocated.** Server tests share one SQLite DB and run without file parallelism.

- **2026-10-15 — Access checks via `requireWorkspaceRole()`** in `server/src/lib/access.ts`, called by services (not middleware) because the workspace is often derived from a loaded record. Roles rank viewer < editor < owner.
- **2026-10-15 — Module routers mount at `/api`** and declare full paths (`/workspaces/:id/projects`, `/projects/:id`); `requireAuth` is applied per route so unknown `/api` paths still 404.
- **2026-10-15 — Recording metadata lives in its own `Recording` table**, keyed by `mediaAssetId`, with clicks as Prisma `Json` (supported on both SQLite and Postgres). Media DTOs include only the small summary (`durationMs`, `clickCount`) via `mediaInclude`; full clicks come from `GET /api/media/:id/recording`.
- **2026-10-15 — Clicks are stored normalised** (`x`, `y` in 0..1 of the page viewport, `t` in ms of recorded time excluding pauses) together with the shared surface (`browser`/`window`/`monitor`), so the editor can decide how reliable the mapping to the video frame is.
- **2026-10-15 — `ScreenRecorder` takes a `RecorderEnvironment`** (mediaDevices, MediaRecorder, click target, clock) defaulting to browser globals, so tests run with fakes (`features/recorder/test-fakes.ts`) without a DI layer.
- **2026-10-15 — Media files are served through the API** (`/api/media/:id/file`, cookie auth), never as static files, so access checks always apply.

- **2026-10-16 — AI clients live in `server/src/lib/`** as concrete classes (`ClaudeClient`, `SpeechClient`) with an `isOnline` flag; services decide their own offline placeholder. Tests swap behaviour by subclassing (`FakeClaude extends ClaudeClient`) or injecting `fetch`, not via interfaces.
- **2026-10-16 — Claude JSON via structured outputs** (`output_config.format` json_schema), not forced tool use (forced `tool_choice` is rejected by current models). Responses are re-validated with zod.
- **2026-10-16 — Scripts are stored as one JSON array of `{ id, startMs, endMs, text }` per project/language** and saved wholesale on edit. Voiceover (milestone 5) keys audio by segment id.
- **2026-10-16 — Speech-to-text goes over plain `fetch` + `FormData`** to the OpenAI REST API (no extra SDK dependency); model from `STT_MODEL`.

## Progress log

### 2026-10-16 — Milestone 4 (Transcription and AI script) done
- Prisma: `Transcript` (one per media asset, cascades) and `Script` (per project + language, `sourceMediaId` set null when the media is deleted); both store timed segments as JSON.
- Server libs: `FfmpegService` (`lib/ffmpeg.ts`, the only ffmpeg spawner: run/exec, duration probe that decodes header-less WebM, audio-stream check, mono 16 kHz MP3 extraction, copy-remux), `SpeechClient` (`lib/speech.ts`, OpenAI `/v1/audio/transcriptions` with `verbose_json` segments; deterministic placeholder transcript offline), `ClaudeClient` (`lib/claude.ts`, `@anthropic-ai/sdk` structured outputs via `output_config.format` + zod validation; callers fall back offline).
- Recordings are now remuxed (`-c copy`) after upload so MediaRecorder WebM files get a duration/seek index (best effort; original kept on failure). Fixes the known issue from milestone 3.
- Modules: `transcripts` (`GET/POST /api/media/:id/transcript`), `scripts` (`GET/POST/PUT /api/projects/:id/script`; POST `{ mediaId, retranscribe? }` transcribes if needed and writes a draft; PUT saves edited segments, validated: ordered, non-overlapping, unique ids). Claude output is normalised (sorted, clamped to the video length, overlaps trimmed); offline drafts use `cleanNarration`/`draftOffline` (filler/stutter removal, merging short lines). AI failures map to 502 and keep the previous script.
- Client: Script page (`/app/projects/:id/script`, "Script" button on project pages): source picker + generate, segment editor (text, start/end, split, merge, add, delete, words-vs-slot pace hint, validation that blocks saving), synced player (play a segment, live highlight), "New draft" with optional re-transcription, original transcript panel, offline-mode notice, read-only for viewers. `ApiClient.put`.
- Tests: 63 server (FfmpegService with real lavfi media, SpeechClient with mocked fetch, narration helpers, ScriptService online/offline via a fake Claude subclass, routes + access), 37 client (segment helpers, Script page flows). typecheck/lint/test/build green; production build smoke-tested (sign-up → real WebM recording → remux → offline script).
- Next: Milestone 5 — AI voiceover. Add TTS to `SpeechClient` (OpenAI `/v1/audio/speech`, voice list), offline silent audio of the segment length via `FfmpegService`, per-segment audio stored via `StorageService` keyed by script segment id, voice picker and per-segment regenerate on the Script page.
- Known issues: transcription and script writing run inside the request (fine for short recordings; long files should move onto the job queue planned in milestone 8). OpenAI's transcription upload limit is 25 MB (~100 min of the 32 kbps MP3 we send); longer audio would need chunking. Segment ids are client-generated UUIDs for new segments; voiceover must handle edits that change timing.

### 2026-10-15 — Milestone 3 (Browser screen recording) done
- Prisma: `Recording` (one-to-one with `MediaAsset`, cascades on delete): duration, size, shared surface, audio flag, `clickCount` and `clicks` JSON (`{ t, x, y }`).
- Server: `recordings` module — `POST /api/workspaces/:id/recordings` (multipart `file` + `metadata` JSON string + optional `projectId`; video only, zod-validated, temp file removed on any failure) and `GET /api/media/:id/recording`. Every media DTO now carries `recording: { durationMs, clickCount } | null`. `MediaService.load` is public for access checks from other modules.
- Client: `ScreenRecorder` class (getDisplayMedia + optional mic, mixes mic and shared audio with Web Audio, pause/resume with paused time excluded, stops when the browser's "Stop sharing" is used, codec selection, click capture normalised to the viewport), `useScreenRecorder` hook, Record page (project picker, audio options, live timer and click count, preview/rename/save or discard), "Record" in the sidebar, dashboard and project page, recording badge on media cards.
- Tests: 32 server, 25 client. typecheck/lint/test/build green; production build smoke-tested (sign-up → recording upload → metadata read back).
- Next: Milestone 4 — Transcription and AI script. Add `FfmpegService` (ffmpeg-static) to extract audio; also use it to remux browser WebM uploads (`-c copy`) so they get a seekable duration (see known issues).
- Known issues: MediaRecorder WebM files have no duration header, so players can't seek until remuxed (planned with `FfmpegService` in milestone 4). Click capture only sees clicks inside the OpenClue tab (browser security); other clicks will be added by hand in the editor or via the stretch Chrome extension.

### 2026-10-15 — Milestone 2 (Projects and media) done
- Prisma: `Project` and `MediaAsset` (workspace-scoped; `projectId` is `SetNull` on project delete so files stay in the library).
- Server: `StorageService` (`lib/storage.ts`, key-based, path-traversal guarded), `singleFileUpload` multer middleware (temp dir inside storage, `MAX_UPLOAD_MB` limit, 413/415 errors), `requireWorkspaceRole` (`lib/access.ts`, 404 for non-members, 403 for low roles).
- Projects module: list/create per workspace, get (with media)/rename/delete by id.
- Media module: upload (video/image/audio/PDF/slides detection by MIME + extension), list with `kind`/`projectId` filters, rename / move between projects, delete, and `GET /api/media/:id/file` streaming with Range support and a sandbox CSP.
- Client: Projects page (create form, grid), project detail page (inline rename, upload, add from library, remove from project, delete), media library (type filters, move to project, delete), dashboard with recent projects. New UI primitives `EmptyState`, `PageHeader`; `ApiClient.upload`, `useAsync`, `format` helpers, shared `test-utils.tsx`.
- Tests: 25 server (StorageService, ProjectService, MediaService, routes), 16 client. typecheck/lint/test/build green; production build smoke-tested (sign-up → project → upload).
- Next: Milestone 3 — Browser screen recording (`ScreenRecorder` class, click capture, upload into a project; uploads go through the existing media endpoint, click data needs a new model/field).
- Known issues: no upload progress bar (fetch has no upload progress; switch `ApiClient.upload` to XHR if needed); the UI always uses the first workspace until milestone 14 adds a switcher.

### 2026-10-15 — Milestone 1 (Foundation) done
- npm workspaces (`server`, `client`) with root `dev`, `build`, `start`, `typecheck`, `lint`, `test`.
- Server: `Server` class in `server/src/server.ts` (JSON, cookies, `/api/health`, module routers, 404/error handling, serves `client/dist` in production), typed env (`config/env.ts`, offline AI mode forced in tests), shared Prisma client, `HttpError` + error middleware, JWT-cookie auth middleware.
- Auth module: sign-up (creates a personal workspace), sign-in, sign-out, `/me`; zod validation with per-field issues.
- Prisma schema: `User`, `Workspace`, `Membership`.
- Client: `ApiClient`, `AuthProvider`/`useAuth`, `RequireAuth`, landing page with original copy, sign-in/sign-up pages with field errors, app shell with sidebar (future sections marked "Soon") and empty dashboard. Own UI primitives (Button, TextField, Alert, Logo, Spinner).
- Tests: 8 server (AuthService + Supertest routes), 7 client (ApiClient, routing/auth flows). typecheck/lint/test/build all green; production build smoke-tested.
- Next: Milestone 2 — Projects and media (`StorageService`, upload middleware with multer, project CRUD, media library, project detail page; enable the Projects/Media sidebar entries).
- Known issues: `npm audit` reports advisories in dev dependencies (not addressed yet).
