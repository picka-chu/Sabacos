import { Hono, type Context } from "hono";
import { z } from "zod";
import { tryParseProject } from "@motion/core";
import type { Store } from "./store";
import { executeOperations, OpExecutionError, type Operation } from "./op-executor";
import type { EventHub } from "./ws-hub";
import { AiController, AiSessionError, type ChatResult } from "./ai";
import type { RefImportService } from "./ref-import";

export type AppDeps = {
  store: Store;
  hub: EventHub;
  ai?: AiController | Record<string, AiController>;
  /** Provider name to use when the request does not specify one. */
  defaultProvider?: string;
  refs?: RefImportService;
};

export type AiMap = Record<string, AiController>;

function normalizeAi(ai?: AiController | Record<string, AiController>): { controllers: AiMap; defaultName?: string } {
  if (!ai) return { controllers: {} };
  if (ai instanceof AiController) return { controllers: { default: ai }, defaultName: "default" };
  const controllers = ai as AiMap;
  const names = Object.keys(controllers);
  return { controllers, defaultName: names.length > 0 ? names[0] : undefined };
}

const operationSchema = z.object({ op: z.string().min(1), args: z.record(z.string(), z.unknown()) });
const operationBatchSchema = z.object({ operations: z.array(operationSchema) });

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

async function readJson(c: Context): Promise<unknown> {
  const raw = await c.req.text().catch(() => "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function createApp({ store, hub, ai, defaultProvider, refs }: AppDeps): Hono {
  const app = new Hono();
  const { controllers, defaultName } = normalizeAi(ai);

  app.onError((err, c) => {
    if (err instanceof OpExecutionError) {
      return c.json({ error: err.message }, 400);
    }
    console.error("[motion-server] unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ status: "ok", service: "motion-server" }));

  // ----- Projects -----

  app.post("/api/projects", async (c) => {
    const body = await readJson(c);
    const parsed = z.object({ name: z.string().min(1).optional() }).safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const project = store.createProject(parsed.data.name);
    return c.json({ project }, 201);
  });

  app.get("/api/projects", (c) => c.json({ projects: store.listProjects() }));

  app.get("/api/projects/:id", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    return c.json({ project });
  });

  app.put("/api/projects/:id", async (c) => {
    const id = c.req.param("id");
    const body = await readJson(c);
    const parsed = z.object({ project: z.unknown() }).safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const project = tryParseProject(parsed.data.project);
    if (!project.success) return c.json({ error: project.error.message }, 400);
    const normalized = { ...project.data, id };
    store.saveProject(normalized);
    hub.broadcast(id, { type: "project:update", project: normalized });
    return c.json({ project: normalized });
  });

  app.delete("/api/projects/:id", (c) => {
    store.deleteProject(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ----- Edit sessions -----

  app.post("/api/projects/:id/sessions", async (c) => {
    const projectId = c.req.param("id");
    if (!store.getProject(projectId)) return c.json({ error: "Project not found" }, 404);
    const body = await readJson(c);
    const parsed = z.object({ description: z.string().default("") }).safeParse(body ?? {});
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const session = store.createSession(projectId, parsed.data.description);
    if (!session) return c.json({ error: "Project not found" }, 404);
    hub.broadcast(projectId, { type: "session:update", session });
    return c.json({ session }, 201);
  });

  app.get("/api/projects/:id/sessions", (c) => {
    const projectId = c.req.param("id");
    if (!store.getProject(projectId)) return c.json({ error: "Project not found" }, 404);
    return c.json({ sessions: store.listSessions(projectId) });
  });

  app.get("/api/sessions/:id", (c) => {
    const session = store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ session });
  });

  app.post("/api/sessions/:id/operations", async (c) => {
    const sessionId = c.req.param("id");
    const session = store.getSession(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);
    if (session.status !== "open") return c.json({ error: `Session is ${session.status}`, session }, 409);

    const body = await readJson(c);
    const parsed = operationBatchSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const operations: Operation[] = parsed.data.operations;

    let project;
    let refs;
    try {
      ({ project, refs } = executeOperations(session.draft, operations));
    } catch (error) {
      if (error instanceof OpExecutionError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const updated = store.addSessionStep(sessionId, operations, project);
    if (!updated) return c.json({ error: "Session is not open" }, 409);

    hub.broadcast(session.projectId, { type: "session:update", session: updated });
    return c.json({ session: updated, refs });
  });

  app.post("/api/sessions/:id/approve", (c) => {
    const sessionId = c.req.param("id");
    const result = store.approveSession(sessionId);
    if (!result) {
      const existing = store.getSession(sessionId);
      if (!existing) return c.json({ error: "Session not found" }, 404);
      return c.json({ error: `Session is ${existing.status}` }, 409);
    }
    hub.broadcast(result.project.id, { type: "project:update", project: result.project });
    hub.broadcast(result.project.id, { type: "session:update", session: result.session });
    return c.json(result);
  });

  app.post("/api/sessions/:id/discard", (c) => {
    const sessionId = c.req.param("id");
    const session = store.discardSession(sessionId);
    if (!session) {
      const existing = store.getSession(sessionId);
      if (!existing) return c.json({ error: "Session not found" }, 404);
      return c.json({ error: `Session is ${existing.status}` }, 409);
    }
    hub.broadcast(session.projectId, { type: "session:update", session });
    return c.json({ session });
  });

  // ----- References -----

  app.post("/api/projects/:id/references/import", async (c) => {
    if (!refs) return c.json({ error: "Reference import is not configured" }, 503);
    const projectId = c.req.param("id");
    if (!store.getProject(projectId)) return c.json({ error: "Project not found" }, 404);
    const body = await readJson(c);
    const parsed = z.object({ url: z.string().url(), title: z.string().min(1).optional() }).safeParse(body);
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const reference = refs.importFromUrl(projectId, parsed.data.url, parsed.data.title);
    hub.broadcast(projectId, { type: "reference:update", reference });
    return c.json({ reference }, 202);
  });

  app.post("/api/projects/:id/references/upload", async (c) => {
    if (!refs) return c.json({ error: "Reference import is not configured" }, 503);
    const projectId = c.req.param("id");
    if (!store.getProject(projectId)) return c.json({ error: "Project not found" }, 404);
    const filename = c.req.query("filename") ?? "reference.mp4";
    const title = c.req.query("title") ?? undefined;
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: "Empty file body" }, 400);
    const reference = refs.importUpload(projectId, filename, bytes, title ? { title } : undefined);
    hub.broadcast(projectId, { type: "reference:update", reference });
    return c.json({ reference }, 202);
  });

  app.get("/api/projects/:id/references", (c) => {
    const projectId = c.req.param("id");
    if (!store.getProject(projectId)) return c.json({ error: "Project not found" }, 404);
    return c.json({ references: store.listReferences(projectId) });
  });

  app.get("/api/references/:id", (c) => {
    const reference = store.getReference(c.req.param("id"));
    if (!reference) return c.json({ error: "Reference not found" }, 404);
    return c.json({ reference });
  });

  app.delete("/api/references/:id", async (c) => {
    const reference = store.deleteReference(c.req.param("id"));
    if (!reference) return c.json({ error: "Reference not found" }, 404);
    void refs?.removeFiles(reference.id);
    hub.broadcast(reference.projectId, { type: "reference:update", reference: { ...reference, status: "deleted" } });
    return c.json({ ok: true });
  });

  app.get("/media/references/:file", async (c) => {
    if (!refs) return c.json({ error: "Reference import is not configured" }, 503);
    const name = c.req.param("file");
    const path = await refs.resolveFile(name);
    if (!path) return c.json({ error: "File not found" }, 404);
    const ext = name.split(".").pop()?.toLowerCase() ?? "bin";
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
          ? "image/png"
          : ext === "webm"
            ? "video/webm"
            : ext === "mov"
              ? "video/quicktime"
              : ext === "mkv"
                ? "video/x-matroska"
                : "video/mp4";
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(path);
    return new Response(data, { headers: { "content-type": mime } });
  });

  app.post("/api/sessions/:id/chat", async (c) => {
    if (Object.keys(controllers).length === 0) {
      return c.json({ error: "AI is not configured (set GEMINI_API_KEY or install Ollama)" }, 503);
    }
    const sessionId = c.req.param("id");
    const body = await readJson(c);
    const parsed = z
      .object({
        prompt: z.string().trim().min(1),
        provider: z.string().optional(),
        compare: z.boolean().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: zodMessage(parsed.error) }, 400);
    const { prompt, provider, compare } = parsed.data;

    const run = async (name: string): Promise<{ name: string; result: ChatResult }> => {
      const controller = controllers[name];
      if (!controller) throw new AiRouteError(`Provider "${name}" is not configured`, 400);
      const result = await controller.runChat(sessionId, prompt, { dryRun: compare });
      return { name, result };
    };

    try {
      if (compare) {
        const names = provider ? [provider] : Object.keys(controllers);
        if (names.length < 1) return c.json({ error: "No AI providers configured" }, 503);
        const results = await Promise.all(names.map(run));
        const replies = results.map((r) => ({ provider: r.name, ...r.result }));
        return c.json({ compare: true, results: replies });
      }
      const name = provider ?? defaultProvider ?? defaultName ?? Object.keys(controllers)[0]!;
      const { result } = await run(name);
      return c.json(result);
    } catch (error) {
      if (error instanceof AiSessionError) {
        const status = error.message === "Session not found" ? 404 : 409;
        return c.json({ error: error.message }, status);
      }
      if (error instanceof AiRouteError) return c.json({ error: error.message }, error.status as never);
      throw error;
    }
  });

  return app;
}

class AiRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AiRouteError";
  }
}
