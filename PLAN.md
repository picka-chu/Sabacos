# Motion Studio — Master Plan

AI-controlled motion design & video editing platform (After Effects-style) where Gemini
drives the editor through function calling.

## Product concept

Users write prompts ("make a 10s intro with a title that scales in, add a red circle
that bounces") -> Gemini plans and executes edits by calling editor tools against a
real project document -> the document renders live in a canvas preview and exports to video.

## Architecture

```
  Web Editor (React + TS)      Canvas Preview | Timeline | Layers | Inspector | AI Chat
           |  REST + WebSocket
  Backend (Hono, Node)         Edit Sessions (propose/preview/approve) | Tool Executor
           |  Project Store (SQL) | Gemini client
  Gemini (AI controller)       plan-first JSON generation + iterative function calling
```

Core rule: **the AI never touches pixels.** Everything mutates an AE-style document model
(Project -> Compositions -> Layers -> keyframed Properties -> Effects). Editor, AI tools,
renderer and exporter all read/write the one validated JSON document.

## Document model (Step 2)

- Project { id, name, version, media[], compositions[] }
- Composition { id, name, width, height, fps, duration, backgroundColor, layers[] }
- Layer (image | video | text | shape | audio) { id, name, kind, transform, effects,
  inPoint, outPoint, visible }
- Transform { position, scale, rotation, opacity } each `Animatable` = fixed value OR
  keyframes { time, value, easing }
- Effects: blur, chromaKey, colorAdjust, noise, invert, sepia...
- All validated with zod; mutation ops (addLayer, setProperty, addKeyframe, trimClip,
  splitClip, addEffect...) as pure functions over an immutable document.

## Interaction model (Step 6)

1. Plan-first: model emits a full composition JSON (validated) -> apply for "create X".
2. Iterative tools: model calls one tool at a time with live preview for refinement.
Both run inside an **edit session** (draft document) with propose -> preview -> approve,
matching OpenChatCut's session pattern; edits key to stable layer IDs to avoid drift.

## Roadmap & status

| Step | Deliverable | Status |
|---|---|---|
| 1 | Monorepo scaffold (workspaces, TS, git, tooling) | DONE |
| 2 | Core document model + operations + zod validation (vitest) | DONE |
| 3 | PixiJS renderer (keyframes, easing, layers, effects) | DONE |
| 4 | Editor UI (viewport, timeline, layers, inspector, playback) | DONE |
| 5 | Backend (edit sessions, project store, REST+WS, approve flow) | DONE || 6 | AI controller (tool registry, Gemini function calling, chat loop) | DONE |
| 7 | Export pipeline (ffmpeg) | pending |
| 8 | Hardening (tests, errors, docs, demo seed, QA checklist) | pending |

## Step 1 notes (2026-08-15)

What's done: npm-workspaces monorepo (@motion/core, @motion/web, @motion/server),
strict TS base, vite+react web app, hono server, git init, typecheck/build/health verified.

What's left: everything else (steps 2-8).

Improvements backlog (add as discovered, clear as fixed):
- `npm approve-scripts` required for esbuild/protobufjs on this machine (documented in README).
- Add CI (GitHub Actions) in step 8: typecheck, test, build.
- Server runs via tsx; replace with compiled/bundled artifact before prod deploy.

## Step 2 notes (2026-08-15)

Done: document model types, easing (bezier solver + bounce), interpolation, immutable
mutation ops, factories, zod schema + normalization, demo project, AI-facing summary.
44/44 core tests pass; typecheck green across all workspaces.

Found & fixed: test import paths (`__tests__/../src` bug), zod v4 `.default()` typing,
RGBA 0-255 factory vs 0-1 document convention, `rgba()` normalization, keyframe arrays
now `.min(1)` in schema, demo set-keyframes-before-addLayer ordering bug (would have
rendered fully static), stack-index comment (0 = bottom).

## Step 3 notes (2026-08-15)

Done: PixiJS v8 renderer in @motion/web (`src/renderer/`) driven purely by the document:
- CompositionRenderer: comp-driven scene graph, letterbox fit, per-layer handles diffed
  on setComposition, evaluateLayerTransform per frame, blend modes, opacity*text fill alpha.
- Layers: image (cached textures), video (seekable muted loop element + VideoSource),
  text (Pixi Text, wordWrap), shape (Graphics: rect/ellipse/triangle/line, anchor offsets),
  audio (ignored visually; audio engine comes in step 4).
- Effects: blur, colorAdjust (brightness/contrast/saturation/hue via ColorMatrixFilter
  chaining), chromaKey (custom GLSL Filter + GlProgram), invert, sepia, noise.
- MediaCache: mediaId->url via project.media, crossOrigin images, per-url cache.
- App.tsx replaced with a live preview that loops the demo composition (rAF scrub).
Verification: typecheck + vite build pass; dev server boots, serves page + App module.

Backlog from this step:
- Add Playwright screenshot/E2E test for visual verification (step 8).
- Blur amount->strength mapping is 1:1 provisional; tune with reference stills.
- Video seek calls source.update() each frame change; validate frame freshness, add
  scrub-ahead preload if needed.
- Filters list rebuilt per frame; prune disabled filters for GPU savings.
- Optimize text/style rebuild via signature checks (already hashed) - measure later.

## Step 4 notes (2026-08-18)

Done: full editor UI in @motion/web, verified with a headless-browser E2E suite.
- Zustand store (`useEditorStore`): project/compId/time/playing/selectedLayerId/
  timelineZoom + `apply(fn)` running core ops; single source of truth fed to renderer.
- Components: PlaybackBar (transport, timecode mm:ss:ff, comp selector, zoom),
  Timeline (ruler with nice ticks, top-down track rows, clip bars, keyframe diamonds
  for animated props of selected layer, pointer scrub), LayerList (visibility/lock/
  duplicate/delete, bring-to-front/send-to-back), Inspector (Name/In/Out, Transform
  editor with "keyframe at playhead" P/S/R/O buttons, per-kind editors, effects add/
  toggle/edit), Viewport (renderer mount, rAF playback loop, click-to-pick select,
  dblclick play/pause, renderer recreated on media change).
- Added `setAudioStyle` (volume/playbackRate) to core operations.
- Playwright E2E (headless Chrome via BROWSER_PATH, no browser download): 5 specs -
  boot w/o console/page errors, playback changes pixels, layer select -> inspector,
  rename via inspector -> layer list, timeline scrub updates timecode. `npm run e2e`.

Bugs found & fixed during E2E:
- StrictMode double-mount created two Pixi Applications; the stale app's `destroy(true)`
  called GlobalResourceRegistry.release(), wiping the live app's batch pool mid-render
  -> intermittent "Cannot read properties of null (reading 'clear')" in Batcher.break.
  Fix: destroy with `{ removeView: false, releaseGlobalResources: false }` and removed
  dev-only StrictMode (pixi keeps module-global pools shared across Apps).
- `setTransformKeyframe` at t=0 on a static prop seeded a duplicate t=0 keyframe
  (seed + explicit) -> two children with key "0" in the timeline + a bogus 1-frame
  "animation". Fix: collapse to a single keyframe when time===0. Added regression test
  (45 core tests now). Demo's ball opacity corrected from fake 2-frame t=0 animation
  to a static 0.9.
- WebGL canvas element screenshots are stale in headless (no preserveDrawingBuffer);
  E2E compares compositor clip screenshots of the viewport instead.
- TextField committed on blur from React state (stale closure after fill()); now reads
  e.target.value on blur.

Backlog from this step:
- Timeline is read-mostly; add drag-to-move clips/keyframes and in/out handles later.
- Playwright suite covers interaction, not golden pixels; add screenshot diffing in step 8.
- Zoom/scroll UX minimal (fixed zoom range, no pan); revisit with longer timelines.

## Step 5 notes (2026-08-18)

Done: backend service in @motion/server, verified with 26 vitest tests + live boot smoke.
- SQLite persistence (Node built-in `node:sqlite` DatabaseSync): `projects` and `sessions`
  tables; `Store` seeds a project with a default 1920x1080 30fps 10s "Main" composition;
  edit sessions snapshot draft + baseProject, log op-batches as steps, and approve via a
  BEGIN/COMMIT transaction (project doc + session status written atomically).
- `op-executor`: declarative ~28-op registry (compositions, layers, transforms, keyframes,
  effects, text/shape/video/audio styles, media) driven by core's pure ops. Each batch
  runs atomically, captures newly-created ids as `refs` (for chaining in a single batch),
  and re-validates the final document with parseProject + duplicate-id check.
- Hono REST app: projects CRUD, edit-session lifecycle (create/operations/approve/discard),
  op errors -> 400, unknown/missing -> 404, non-open session -> 409, invalid project PUT -> 400.
- WebSocket (`ws`, `noServer` upgrade at `/api/ws?projectId=`) via EventHub keyed by
  projectId; broadcasts `session:update` / `project:update` on every mutation.
- Entry `src/index.ts` wires Store (DB_PATH env, default ./data/motion.db) + EventHub +
  Hono + upgrade handler; verified `/api/health` returns ok on a live boot.
- `@hono/node-ws` could NOT be installed (peer conflict wants @hono/node-server 1.x vs 2.1.1)
  -> hand-rolled WS upgrade with `ws`, which is fine and dependency-light.

Gotchas found:
- `node:sqlite` hangs inside vitest worker_threads; switched vitest to `pool: "forks"`.
- `@motion/core` resolves to raw `.ts` source; tsx/vitest cold-start transforms are slow
  (~10-30s first run), fine after warm cache.
- `args: never` in the op registry broke destructuring; registry typed as `OpDef` with
  runtime zod validation owning the real input types.
- Blur effect `amount` is `Animatable` (`{type:"static", value}`), not a bare number.

Backlog from this step:
- Gemini tool specs: derive zod schemas + docs from the op registry (step 6).
- Auth/multi-user, project locking, and WS reconnect/resync not implemented (local-first).
- No pagination on list endpoints; fine for single-user studio.
- `listSessions`/`listProjects` hydrate full drafts; could switch to summary projections.

## Step 6 notes (2026-08-18)

Done: AI controller in @motion/server, verified with 37 vitest tests + live boot.
- `ai.ts`: `AiController` drives an edit session with an LLM loop - model calls
  inspect/edit tools, every successful op is persisted as a session step and
  broadcast over WS, failed ops come back as error responses so the model can
  self-correct; loop ends when the model emits a final text reply (maxSteps guard).
- Tool specs are derived straight from the op-executor registry: `opTools()`
  exposes name/doc/schema and `buildFunctionDeclarations()` converts each zod
  schema to a Gemini FunctionDeclaration via zod v4's built-in `z.toJSONSchema()`
  (no zod-to-json-schema dep - that package hangs on import with zod 4). Plus an
  `inspect` tool returning a compact project summary (comp/layer/media ids) so the
  model never invents ids.
- `gemini.ts` isolates the real `@google/genai` client behind a narrow `AiBackend`
  interface (model/contents/config in, text + functionCalls out), so tsc and tests
  stay fast (ai.ts does not import the SDK).
- System prompt encodes the editing rules (call inspect first, explicit layer ids
  for later reference, px/degrees/0..1 opacity/seconds units, keyframes over
  statics, draft-not-applied reminder).
- REST: POST /api/sessions/:id/chat { prompt } -> { reply, sessionId, calls }.
  400 empty prompt, 404 missing session, 409 closed session, 503 when no
  GEMINI_API_KEY; `index.ts` enables AI only when the key is present.

Gotchas found:
- zod 4's `_def` is opaque (no stable typeName/shape) - use `z.toJSONSchema()`.
- `zod-to-json-schema` hangs on import against zod v4; uninstalled.
- `@google/genai` pulls a huge .d.ts; static import made `tsc -w` multi-minute and
  vitest imports slow -> moved to gemini.ts (typecheck still slower with it in the
  graph, but unit tests no longer touch the SDK).
- `z.string().min(1)` accepts whitespace prompts; use `.trim().min(1)`.

Backlog from this step:
- First live Gemini run: tune the system prompt + op docs with real function-calling
  traces (plan-first JSON path for "create X" is still TODO; loop-only for now).
- No auto-approve UI or chat panel in the web app yet (REST endpoint exists).
- `inspect` returns full transform objects; could slim to ids+names for token savings.
- Multi-turn chat memory is per-request; a chat history endpoint is next.
- Op descriptions in the registry are terse; expand doc strings for better tool choice.

## Step 6.5 notes (2026-08-20) — Ollama + reference-video import

Done: multi-provider AI + reference/inspiration video import, verified with 52 server
tests + live smoke (real ffmpeg/PyAV/whisper pipeline + Gemini imitating a reference).
- Ollama backend (`ollama.ts`): `OllamaBackend implements AiBackend` via POST /api/chat;
  converts Gemini-style contents -> Ollama messages and functionDeclarations -> OpenAI
  tools (args may be string or object). `detectOllamaModel` finds an installed tools-capable
  model. Enabled via `ai.ollama` in index.ts (auto-detected), env `AI_PROVIDER` selects
  default, `OLLAMA_MODEL`/`OLLAMA_BASE_URL` override.
- Chat route: `POST /api/sessions/:id/chat` accepts `provider` and `compare:true`
  (dryRun on every provider, returns `{compare:true, results:[{provider,reply,calls,draft}]}`).
  `AppDeps.ai` is `AiController | Record<string, AiController>` + `defaultProvider`.
- qwen2.5:1.5b is installed but too small (invents schema, loops maxSteps, empty reply).
  User chose qwen3:4b; download failed on flaky network (registry DNS + HF CDN drops) and
  was deferred — use GEMINI_API_KEY for now.
- Gemini 3 requirement (critical): the model emits `functionCall` parts carrying a
  `thoughtSignature`; you MUST echo those model parts back verbatim in the next request or
  you get 400 "missing a thought_signature". `generateContent` now returns
  `{text?, parts?: ModelPart[]}` and the loop pushes `{role:"model", parts}` verbatim.
- Reference import: `references` SQLite table + store CRUD; `RefImportService`
  (`ref-import.ts`) runs: yt-dlp download (`best[height<=1080]/best`) -> ffprobe JSON probe
  -> ffmpeg thumbnail (320px) -> `scripts/analyze.py` (PyAV style card: duration/fps/cuts/
  avgShotLength/pace/palette/avgLuminance/motion) -> `scripts/transcribe.py` (faster-whisper
  segments) -> registers the clip as project media; statuses importing/ready/failed streamed
  over WS as `reference:update`. REST: POST import (URL) + upload (binary), GET list/detail,
  DELETE, plus static `/media/references/<file>` serving. `data/` (ffmpeg/ffprobe, refs, db)
  is gitignored; DATA_DIR defaults to `<repoRoot>/data` regardless of cwd.
- AI tools: `inspectReferences` (style summaries) + `getReference` (style card + transcript)
  wired into the controller + system prompt ("make it like ref-X" flow). Style ops:
  `setLayerTransition`, `applyCameraMove`, `applyColorGrade` (transitions/directions/camera
  moves/color-grade presets added to core).
- Verified live: uploaded a generated clip -> pipeline produced style card + media asset ->
  Gemini added the clip as a layer, applied `applyColorGrade` (cinematic), and
  `applyCameraMove` (zoomIn). Free-tier Gemini quota is tight (429s after a few rounds;
  each round echoes thoughts inflating input tokens).
- Gotchas: `references` is a SQLite keyword (quote as `"references"`); ffprobe spawn needs
  the real repo data dir (npm workspaces run with cwd=apps/server); `spawn`'s overloads
  reduce to `never` with `windowsHide` unless cast; `import.meta.url` script resolution was
  `../scripts/` not `./scripts/` (src/ vs scripts/).

Backlog from this step:
- qwen3:4b pull when network recovers; re-run provider compare with a bigger model.
- Web app has NO backend integration yet — Reference/chat/approve UI all still to build.
- Free-tier Gemini rate limit: batch tool specs/summaries to cut input tokens, or add retry/
  backoff on 429.
- analyze.py palette `hex` uses 3-bit quantization; document the mapping in the web UI.

### Web ReferencesPanel (2026-08-20)

Done: first server-backed UI in @motion/web (canvas still runs the local demo project).
- `src/lib/api.ts`: typed fetch client over the vite `/api` proxy (projects list/create,
  references list/import/upload/delete; upload posts the raw File with filename/title as
  query params to match the server's arrayBuffer route).
- `ReferencesPanel.tsx`: project picker (+create), URL import, file upload, reference cards
  with poster/status/error, style chips (pace/cuts/motion), weighted palette strip,
  collapsible transcript. Live updates via a WS subscription to `/api/ws?projectId=`
  handling `reference:update` (delete events carry `status:"deleted"`). Toggled from the
  PlaybackBar "References" button (`showReferences` in useEditorStore).
- E2E: `references.spec.ts` mocks /api via Playwright route interception so the suite stays
  backend-independent (7 specs total now).
- Gotcha: TS object intersections merge property types — `Reference & {status: ...|"deleted"}`
  narrows status back to the base union; use `Omit<Reference,"status"> & {...}`.
- Dev servers now run as scheduled tasks (schtasks) after repeated job-object kills of
  Start-Process children when shell commands timed out.
