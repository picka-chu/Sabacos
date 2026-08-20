import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { WebSocketServer, type WebSocket } from "ws";
import { Store } from "./store";
import { EventHub } from "./ws-hub";
import { createApp, type AiMap } from "./app";
import { AiController } from "./ai";
import { createGeminiBackend } from "./gemini";
import { createOllamaBackend } from "./ollama";
import { RefImportService } from "./ref-import";

// Resolve the repo-root data dir regardless of the server's cwd (npm workspaces
// run scripts from apps/server). Default: <repoRoot>/data.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dbPath = process.env.DB_PATH ?? resolve(repoRoot, "data", "motion.db");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const dataDir = process.env.DATA_DIR ?? resolve(repoRoot, "data");
const store = new Store(dbPath);
const hub = new EventHub();
const refs = new RefImportService({
  store,
  dataDir,
  notify: (reference) => hub.broadcast(reference.projectId, { type: "reference:update", reference }),
});
console.log(`[motion-server] reference import enabled (yt-dlp + ffmpeg + faster-whisper)`);

const ai: AiMap = {};
let defaultProvider: string | undefined;

if (process.env.GEMINI_API_KEY) {
  ai.gemini = new AiController({
    store,
    hub,
    backend: createGeminiBackend(),
    model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  });
  console.log("[motion-server] AI provider enabled: gemini");
}

try {
  const ollama = await createOllamaBackend();
  ai.ollama = new AiController({ store, hub, backend: ollama, model: ollama.model });
  console.log(`[motion-server] AI provider enabled: ollama (${ollama.model})`);
} catch (error) {
  console.log(`[motion-server] Ollama unavailable (${error instanceof Error ? error.message : String(error)})`);
}

if (process.env.AI_PROVIDER && ai[process.env.AI_PROVIDER]) {
  defaultProvider = process.env.AI_PROVIDER;
} else if (ai.gemini) {
  defaultProvider = "gemini";
} else if (ai.ollama) {
  defaultProvider = "ollama";
}

if (Object.keys(ai).length === 0) {
  console.log("[motion-server] AI controller disabled (set GEMINI_API_KEY or run Ollama)");
}

const app = createApp({ store, hub, ai, defaultProvider, refs });

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, (info) => {
  console.log(`[motion-server] listening on http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      ws.close(1008, "missing projectId");
      return;
    }
    const socket = ws as WebSocket;
    hub.subscribe(projectId, socket);
    socket.on("close", () => hub.unsubscribe(projectId, socket));
    socket.send(JSON.stringify({ type: "hello", projectId }));
  });
});