import { describe, expect, it } from "vitest";
import { Store } from "../store";
import { EventHub } from "../ws-hub";
import {
  AiController,
  AiSessionError,
  buildFunctionDeclarations,
  inspectProjectSummary,
  INSPECT_TOOL,
  type AiBackend,
  type ModelPart,
} from "../ai";

/** Backend that returns scripted responses in order. */
class ScriptedBackend implements AiBackend {
  private next = 0;
  constructor(private responses: { text?: string; parts?: ModelPart[] }[]) {}

  async generateContent(): Promise<{ text?: string; parts?: ModelPart[] }> {
    const res = this.responses[this.next] ?? { text: "(no more responses)" };
    this.next++;
    return res;
  }

  get calls() {
    return this.next;
  }
}

function fc(name: string, args: Record<string, unknown>, id: string): ModelPart {
  return { functionCall: { name, args, id } };
}

function makeApp() {
  const store = new Store(":memory:");
  const project = store.createProject("Intro");
  const session = store.createSession(project.id, "ai test")!;
  return { store, hub: new EventHub(), project, session };
}

describe("buildFunctionDeclarations", () => {
  it("exposes every registered operation plus inspect", () => {
    const tools = buildFunctionDeclarations();
    const names = tools.map((t) => t.name as string);
    expect(names).toContain(INSPECT_TOOL);
    expect(names).toContain("addLayer");
    expect(names).toContain("setTransformKeyframe");
    expect(names).toContain("addComposition");
    expect(names.length).toBeGreaterThan(10);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parametersJsonSchema).toBeTruthy();
    }
  });

  it("produces OpenAPI-style parameter schemas without $schema", () => {
    const addLayer = buildFunctionDeclarations().find((t) => t.name === "addLayer")!;
    const schema = addLayer.parametersJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect("$schema" in schema).toBe(false);
    expect((schema.properties as Record<string, unknown>).compId).toBeTruthy();
  });
});

describe("inspectProjectSummary", () => {
  it("returns composition and layer ids", () => {
    const { project } = makeApp();
    const summary = inspectProjectSummary(project);
    const comps = summary.compositions as { id: string; name: string; layers: unknown[] }[];
    expect(comps[0]!.id).toBe(project.compositions[0]!.id);
    expect(comps[0]!.name).toBe("Main");
  });
});

describe("AiController.runChat", () => {
  it("runs an inspect -> edit loop and persists steps", async () => {
    const { store, hub, project, session } = makeApp();
    const compId = project.compositions[0]!.id;

    const backend = new ScriptedBackend([
      { parts: [fc(INSPECT_TOOL, {}, "t1")] },
      {
        parts: [
          fc("addLayer", {
            compId,
            layer: { id: "title", kind: "text", name: "Title", text: "Hello", fontSize: 80 },
          }, "t2"),
        ],
      },
      {
        parts: [
          fc("setTransformKeyframe", { compId, layerId: "title", prop: "position", time: 0, value: { x: 0, y: 0 } }, "t3"),
        ],
      },
      { text: "Done! Added a title that starts centered." },
    ]);

    const controller = new AiController({ store, hub, backend, model: "test-model" });
    const result = await controller.runChat(session.id, "add a title");

    expect(result.reply).toBe("Done! Added a title that starts centered.");
    expect(result.calls.map((c) => c.status)).toEqual(["ok", "ok", "ok"]);

    const updated = store.getSession(session.id)!;
    expect(updated.status).toBe("open");
    expect(updated.steps).toHaveLength(2);
    const layer = updated.draft.compositions[0]!.layers.find((l) => l.id === "title")!;
    expect(layer.kind).toBe("text");
    if (layer.transform.position.type === "animated") {
      expect(layer.transform.position.keyframes[0]!.time).toBe(0);
    } else {
      expect.unreachable("position should be animated");
    }
    // live project untouched
    expect(store.getProject(project.id)!.compositions[0]!.layers).toHaveLength(0);
  });

  it("records an error for a failing op and lets the model continue", async () => {
    const { store, hub, project, session } = makeApp();
    const compId = project.compositions[0]!.id;

    const backend = new ScriptedBackend([
      {
        parts: [fc("addLayer", { compId, layer: { kind: "shape", name: "Box", shape: "rect", width: 10, height: 10 } }, "t1")],
      },
      {
        parts: [
          fc("setTextContent", { compId, layerId: "does-not-exist", text: "x" }, "t2"),
          fc("setProjectName", { name: "Renamed" }, "t3"),
        ],
      },
      { text: "Fixed it." },
    ]);

    const controller = new AiController({ store, hub, backend, model: "test-model" });
    const result = await controller.runChat(session.id, "go");

    expect(result.calls).toEqual([
      { name: "addLayer", status: "ok" },
      { name: "setTextContent", status: "error" },
      { name: "setProjectName", status: "ok" },
    ]);
    const updated = store.getSession(session.id)!;
    expect(updated.status).toBe("open");
    expect(updated.draft.name).toBe("Renamed");
    // failed op must not create a step
    expect(updated.steps.flatMap((s) => s.operations.map((o) => o.op))).not.toContain("setTextContent");
  });

  it("broadcasts session updates over the hub", async () => {
    const { store, hub, project, session } = makeApp();
    const compId = project.compositions[0]!.id;
    const received: unknown[] = [];
    const fakeSocket = {
      OPEN: 1,
      readyState: 1,
      send(message: string) {
        received.push(JSON.parse(message));
      },
    } as never;
    hub.subscribe(project.id, fakeSocket);

    const backend = new ScriptedBackend([
      { parts: [fc("addLayer", { compId, layer: { id: "a", kind: "shape", name: "A", shape: "rect", width: 1, height: 1 } }, "t1")] },
      { text: "ok" },
    ]);
    await new AiController({ store, hub, backend, model: "test-model" }).runChat(session.id, "go");
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "session:update" });
  });

  it("rejects a missing or non-open session", async () => {
    const { store, hub, session } = makeApp();
    const backend = new ScriptedBackend([{ text: "hi" }]);
    const controller = new AiController({ store, hub, backend, model: "test-model" });

    await expect(controller.runChat("missing", "go")).rejects.toThrow(AiSessionError);

    store.approveSession(session.id);
    await expect(controller.runChat(session.id, "go")).rejects.toThrow(/approved/);
  });
});