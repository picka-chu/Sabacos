import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { EventHub } from "../ws-hub";
import { createApp } from "../app";
import { AiController, type AiBackend, type ModelPart } from "../ai";

class ScriptedBackend implements AiBackend {
  private next = 0;
  constructor(private responses: { text?: string; parts?: ModelPart[] }[]) {}
  async generateContent(): Promise<{ text?: string; parts?: ModelPart[] }> {
    return this.responses[this.next++] ?? { text: "(done)" };
  }
}

function makeApp() {
  const store = new Store(":memory:");
  const hub = new EventHub();
  return { app: createApp({ store, hub }), store, hub };
}

function makeAiApp() {
  const store = new Store(":memory:");
  const hub = new EventHub();
  const project = store.createProject("Film");
  const compId = project.compositions[0]!.id;
  const backend = new ScriptedBackend([
    {
      parts: [
        { functionCall: { name: "addLayer", id: "t1", args: { compId, layer: { id: "box", kind: "shape", name: "Box", shape: "rect", width: 10, height: 10 } } } },
      ],
    },
    { text: "I added a box." },
  ]);
  const ai = new AiController({ store, hub, backend, model: "test-model" });
  const session = store.createSession(project.id, "chat")!;
  return { app: createApp({ store, hub, ai }), store, project, session, backend };
}

function makeAiApps() {
  const store = new Store(":memory:");
  const hub = new EventHub();
  const project = store.createProject("Film");
  const compId = project.compositions[0]!.id;
  const backendA = new ScriptedBackend([
    {
      parts: [
        { functionCall: { name: "addLayer", id: "t1", args: { compId, layer: { id: "box", kind: "shape", name: "Box", shape: "rect", width: 10, height: 10 } } } },
      ],
    },
    { text: "Gemini did it." },
  ]);
  const backendB = new ScriptedBackend([{ text: "Ollama did it." }]);
  const ai = {
    gemini: new AiController({ store, hub, backend: backendA, model: "gemini-test" }),
    ollama: new AiController({ store, hub, backend: backendB, model: "qwen-test" }),
  };
  const session = store.createSession(project.id, "chat")!;
  return { app: createApp({ store, hub, ai, defaultProvider: "gemini" }), store, project, session };
}

function json(res: Response): Promise<any> {
  return res.json();
}

async function post(app: any, url: string, body: unknown) {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("routes", () => {
  it("health check", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ status: "ok" });
  });

  it("creates and lists projects", async () => {
    const { app } = makeApp();
    const created = await post(app, "/api/projects", { name: "My Film" });
    expect(created.status).toBe(201);
    const body = await json(created);
    expect(body.project.name).toBe("My Film");
    expect(body.project.compositions).toHaveLength(1);

    const list = await app.request("/api/projects");
    expect(await json(list)).toMatchObject({ projects: [{ name: "My Film" }] });
  });

  it("returns 404 for an unknown project", async () => {
    const { app } = makeApp();
    expect((await app.request("/api/projects/nope")).status).toBe(404);
  });

  it("runs a full edit session over REST and approves it", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const compId = created.project.compositions[0]!.id as string;

    const session = await json(await post(app, `/api/projects/${pid}/sessions`, { description: "add title" }));
    const sid = session.session.id as string;
    expect(session.session.status).toBe("open");

    const batch = await json(
      await post(app, `/api/sessions/${sid}/operations`, {
        operations: [
          { op: "addLayer", args: { compId, layer: { id: "l1", kind: "text", name: "Title", text: "Hello", fontSize: 72 } } },
          { op: "setTransformKeyframe", args: { compId, layerId: "l1", prop: "position", time: 0, value: { x: 0, y: 0 } } },
          { op: "setTransformKeyframe", args: { compId, layerId: "l1", prop: "position", time: 2, value: { x: 100, y: 0 }, easing: "easeInOut" } },
        ],
      }),
    );
    expect(batch.session.draft.compositions[0]!.layers).toHaveLength(1);
    expect(batch.session.steps).toHaveLength(1);

    // live project still unchanged
    const before = await json(await app.request(`/api/projects/${pid}`));
    expect(before.project.compositions[0]!.layers).toHaveLength(0);

    const approved = await json(await post(app, `/api/sessions/${sid}/approve`, {}));
    expect(approved.session.status).toBe("approved");
    expect(approved.project.compositions[0]!.layers).toHaveLength(1);

    const after = await json(await app.request(`/api/projects/${pid}`));
    expect(after.project.compositions[0]!.layers[0]).toMatchObject({ id: "l1", name: "Title", text: "Hello" });
  });

  it("rejects malformed operations with a 400", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const session = await json(await post(app, `/api/projects/${pid}/sessions`, {}));
    const sid = session.session.id as string;

    const bad = await post(app, `/api/sessions/${sid}/operations`, {
      operations: [{ op: "setProjectName", args: { name: 42 } }],
    });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/name/);

    const unknown = await post(app, `/api/sessions/${sid}/operations`, { operations: [{ op: "warp", args: {} }] });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error).toMatch(/Unknown operation/);
  });

  it("rejects operations on an approved session with a 409", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const compId = created.project.compositions[0]!.id as string;
    const session = await json(await post(app, `/api/projects/${pid}/sessions`, {}));
    const sid = session.session.id as string;

    await post(app, `/api/sessions/${sid}/approve`, {});
    const res = await post(app, `/api/sessions/${sid}/operations`, {
      operations: [{ op: "setProjectName", args: { name: "x" } }],
    });
    expect(res.status).toBe(409);
  });

  it("discards a session", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const session = await json(await post(app, `/api/projects/${pid}/sessions`, {}));
    const sid = session.session.id as string;

    const res = await post(app, `/api/sessions/${sid}/discard`, {});
    expect(res.status).toBe(200);
    expect((await json(res)).session.status).toBe("discarded");
    expect((await post(app, `/api/sessions/${sid}/discard`, {})).status).toBe(409);
  });

  it("returns 400 when PUTing an invalid project", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const res = await app.request(`/api/projects/${pid}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: { name: 42 } }),
    });
    expect(res.status).toBe(400);
  });

  it("routes AI chat and persists the model's edits", async () => {
    const { app, session } = makeAiApp();
    const res = await post(app, `/api/sessions/${session.id}/chat`, { prompt: "add a title" });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.reply).toBe("I added a box.");
    expect(body.calls[0]).toMatchObject({ name: "addLayer", status: "ok" });

    const after = await json(await app.request(`/api/sessions/${session.id}`));
    expect(after.session.draft.compositions[0]!.layers).toHaveLength(1);
    expect(after.session.draft.compositions[0]!.layers[0]!.name).toBe("Box");
  });

  it("rejects chat on a closed session and on missing sessions", async () => {
    const { app, session } = makeAiApp();
    expect((await post(app, `/api/sessions/nope/chat`, { prompt: "hi" })).status).toBe(404);
    await post(app, `/api/sessions/${session.id}/approve`, {});
    expect((await post(app, `/api/sessions/${session.id}/chat`, { prompt: "hi" })).status).toBe(409);
  });

  it("returns 400 for an empty chat prompt", async () => {
    const { app, session } = makeAiApp();
    expect((await post(app, `/api/sessions/${session.id}/chat`, { prompt: "  " })).status).toBe(400);
  });

  it("routes chat to a specific provider", async () => {
    const { app, session } = makeAiApps();
    const res = await post(app, `/api/sessions/${session.id}/chat`, { prompt: "hi", provider: "ollama" });
    expect(res.status).toBe(200);
    expect((await json(res)).reply).toBe("Ollama did it.");
  });

  it("returns 400 for an unknown provider", async () => {
    const { app, session } = makeAiApps();
    const res = await post(app, `/api/sessions/${session.id}/chat`, { prompt: "hi", provider: "nope" });
    expect(res.status).toBe(400);
  });

  it("compares providers with dryRun (nothing persisted)", async () => {
    const { app, session } = makeAiApps();
    const res = await post(app, `/api/sessions/${session.id}/chat`, { prompt: "hi", compare: true });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.compare).toBe(true);
    expect(body.results.map((r: { provider: string }) => r.provider)).toEqual(["gemini", "ollama"]);
    expect(body.results.map((r: { reply: string }) => r.reply)).toEqual(["Gemini did it.", "Ollama did it."]);

    const after = await json(await app.request(`/api/sessions/${session.id}`));
    expect(after.session.steps).toHaveLength(0);
    expect(after.session.draft.compositions[0]!.layers).toHaveLength(0);
  });

  it("returns 503 when AI is not configured", async () => {
    const { app } = makeApp();
    const created = await json(await post(app, "/api/projects", { name: "Film" }));
    const pid = created.project.id as string;
    const session = await json(await post(app, `/api/projects/${pid}/sessions`, {}));
    const sid = session.session.id as string;
    expect((await post(app, `/api/sessions/${sid}/chat`, { prompt: "hi" })).status).toBe(503);
  });
});

describe("reference routes", () => {
  it("imports a URL reference, lists it and serves 503 when refs are disabled", async () => {
    const store = new Store(":memory:");
    const hub = new EventHub();
    const project = store.createProject("Refs");
    const app = createApp({ store, hub });

    const importRes = await post(app, `/api/projects/${project.id}/references/import`, {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(importRes.status).toBe(503);
  });

  it("lists and deletes references via the store-backed routes", async () => {
    const store = new Store(":memory:");
    const hub = new EventHub();
    const project = store.createProject("Refs");
    const app = createApp({ store, hub });

    const ref = store.createReference(project.id, { title: "Clip", sourceUrl: "https://x", sourcePlatform: "youtube" });

    const list = await json(await app.request(`/api/projects/${project.id}/references`));
    expect(list.references.map((r: { id: string }) => r.id)).toEqual([ref.id]);

    const detail = await json(await app.request(`/api/references/${ref.id}`));
    expect(detail.reference.title).toBe("Clip");

    const del = await app.request(`/api/references/${ref.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(store.getReference(ref.id)).toBeNull();
    expect((await app.request(`/api/references/${ref.id}`)).status).toBe(404);
  });
});
