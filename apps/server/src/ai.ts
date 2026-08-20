import { z } from "zod";
import type { Project } from "@motion/core";
import { executeOperations, OpExecutionError, opTools, type Operation } from "./op-executor";
import type { Reference, Store } from "./store";
import type { EventHub } from "./ws-hub";

export const INSPECT_TOOL = "inspect";
export const INSPECT_REFERENCES_TOOL = "inspectReferences";
export const GET_REFERENCE_TOOL = "getReference";

export type ToolCall = { name: string; args?: Record<string, unknown>; id?: string };
export type ModelPart = {
  text?: string;
  functionCall?: ToolCall;
  /** Gemini 3 requires echoing thought signatures back on functionCall parts. */
  thoughtSignature?: string;
};
export type ToolResult = { output?: unknown; error?: string };

/** The minimal model interface the controller needs (mockable in tests). */
export interface AiBackend {
  generateContent(params: {
    model: string;
    contents: unknown[];
    config?: unknown;
  }): Promise<{ text?: string; parts?: ModelPart[] }>;
}

export class AiSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSessionError";
  }
}

export const SYSTEM_PROMPT = `You are the creative director of a motion-design tool (like Adobe After Effects). \
The user gives you natural-language requests; you turn them into precise edits of a project document by calling tools.
 
Rules:
- Before editing anything, call "inspect" to learn the composition and layer ids. Never invent ids.
- Make all edits in small validated steps. One logical change per tool call.
- Layer kinds: text, shape, image, video, audio. Shape types: rect, ellipse, triangle, line.
- position and scale are {x, y} in composition pixels; scale 1 = 100%. rotation is degrees. opacity is 0..1.
- All times are in seconds from the composition start.
- Text layers need a "text" value; shape layers need a "shape", "width" and "height".
- If you will need to reference a layer you are about to create, give it an explicit, memorable id (letters/digits only), e.g. "title", "bg".
- Transform properties (prop) are one of: position, scale, rotation, opacity. Use setTransformStatic for fixed values and setTransformKeyframe to animate.
- Add and keyframe effects (blur, colorAdjust, chromaKey, invert, sepia, noise) with addEffect/updateEffect.
- For style work use the dedicated tools: applyCameraMove (pan/tilt/zoom/parallax/shake), applyColorGrade (cinematic/warm/cool/tealOrange/vintage/mono/bleach presets), setLayerTransition (crossfade/fade/wipe/slide/dissolve in/out transitions).
- If the user asks to imitate or match an imported reference/inspiration video, call "inspectReferences" to list them, then "getReference" with its id to study its style card (pacing, color palette, motion, shot length) and transcript, then replicate those qualities with the tools above.
- If a tool reports an error, fix your arguments and retry rather than guessing.
- When your edits are complete, reply to the user in their language with a short summary of what you did and note that it is previewing in a draft (they can approve or discard it).`;

export function buildFunctionDeclarations(store?: Store): Record<string, unknown>[] {
  const tools = opTools().map((op) => ({
    name: op.name,
    description: op.doc,
    parametersJsonSchema: stripSchemaRef(z.toJSONSchema(op.schema)),
  }));
  tools.push({
    name: INSPECT_TOOL,
    description: "Return a compact summary of the current project document (composition and layer ids, kinds, names, media). Call this before editing and whenever you need current ids.",
    parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  });
  if (store) {
    tools.push({
      name: INSPECT_REFERENCES_TOOL,
      description: "List imported reference/inspiration videos for this project with their style summaries (pacing, color palette, motion, shot length). Call this when the user wants to imitate a reference video.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    });
    tools.push({
      name: GET_REFERENCE_TOOL,
      description: "Return the full style card and transcript for an imported reference video by id (from inspectReferences).",
      parametersJsonSchema: {
        type: "object",
        properties: { id: { type: "string", description: "Reference id from inspectReferences" } },
        required: ["id"],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

function stripSchemaRef(schema: Record<string, unknown>): unknown {
  const { $schema, ...rest } = schema;
  return rest;
}

/** A compact, model-friendly view of a project. */
export function inspectProjectSummary(project: Project): Record<string, unknown> {
  return {
    name: project.name,
    version: project.version,
    media: project.media.map((m) => ({ id: m.id, kind: m.kind, name: m.name })),
    compositions: project.compositions.map((comp) => ({
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      fps: comp.fps,
      duration: comp.duration,
      backgroundColor: comp.backgroundColor,
      layers: comp.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        kind: layer.kind,
        visible: layer.visible,
        locked: layer.locked,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        transform: layer.transform,
      })),
    })),
  };
}

export function inspectReferencesSummary(store: Store, project: Project): Record<string, unknown> {
  const references = store
    .listReferences(project.id)
    .map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      sourcePlatform: r.sourcePlatform,
      duration: r.duration,
      fps: r.fps,
      width: r.width,
      height: r.height,
      style: r.style
        ? {
            cuts: r.style.cuts,
            avgShotLength: r.style.avgShotLength,
            pace: r.style.pace,
            palette: r.style.palette,
            avgLuminance: r.style.avgLuminance,
            motion: r.style.motion,
          }
        : null,
      transcriptWordCount: r.transcript
        ? r.transcript.segments.reduce((n, s) => n + s.text.trim().split(/\s+/).filter(Boolean).length, 0)
        : 0,
    }));
  return { references };
}

export function referenceDetail(reference: Reference): Record<string, unknown> {
  return {
    id: reference.id,
    title: reference.title,
    status: reference.status,
    sourcePlatform: reference.sourcePlatform,
    sourceUrl: reference.sourceUrl ?? null,
    fileUrl: reference.fileUrl ?? null,
    posterUrl: reference.posterUrl ?? null,
    duration: reference.duration,
    fps: reference.fps,
    width: reference.width,
    height: reference.height,
    style: reference.style ?? null,
    transcript: reference.transcript ?? null,
  };
}

export type AiControllerOptions = {
  store: Store;
  hub: EventHub;
  backend: AiBackend;
  model?: string;
  maxSteps?: number;
};

export type ChatResult = {
  reply: string;
  sessionId: string;
  calls: { name: string; status: "ok" | "error" }[];
  /** Resulting draft; only included when running with dryRun. */
  draft?: Project;
};

/**
 * Drives an edit session with an LLM: the model inspects the project and calls
 * editor operations one at a time; every successful operation is persisted as a
 * session step (broadcast over WS) and the conversation continues until the
 * model produces a final text reply.
 */
export class AiController {
  private readonly store: Store;
  private readonly hub: EventHub;
  private readonly backend: AiBackend;
  private readonly model: string;
  private readonly maxSteps: number;

  constructor(options: AiControllerOptions) {
    this.store = options.store;
    this.hub = options.hub;
    this.backend = options.backend;
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
    this.maxSteps = options.maxSteps ?? 15;
  }

  async runChat(sessionId: string, prompt: string, opts?: { dryRun?: boolean }): Promise<ChatResult> {
    const dryRun = opts?.dryRun ?? false;
    const session = this.store.getSession(sessionId);
    if (!session) throw new AiSessionError("Session not found");
    if (session.status !== "open") throw new AiSessionError(`Session is ${session.status}`);

    const tools = buildFunctionDeclarations(this.store);
    const contents: unknown[] = [{ role: "user", parts: [{ text: prompt }] }];
    const callsLog: ChatResult["calls"] = [];
    let draft = session.draft;
    let reply = "";

    for (let step = 0; step < this.maxSteps; step++) {
      const response = await this.backend.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: tools }],
        },
      });

      const parts = response.parts ?? [];
      const calls = parts.filter((p): p is ModelPart & { functionCall: ToolCall } => !!p.functionCall);
      if (calls.length === 0) {
        reply = response.text ?? "";
        break;
      }

      // Echo the model's functionCall parts verbatim (incl. thought signatures)
      // so Gemini 3 can match tool results to its reasoning state.
      contents.push({ role: "model", parts: parts as never[] });

      const succeededOps: Operation[] = [];
      const resultParts: unknown[] = [];
      for (const call of calls) {
        const fn = call.functionCall;
        let result: ToolResult;
        if (fn.name === INSPECT_TOOL) {
          result = { output: inspectProjectSummary(draft) };
          callsLog.push({ name: INSPECT_TOOL, status: "ok" });
        } else if (fn.name === INSPECT_REFERENCES_TOOL) {
          result = { output: inspectReferencesSummary(this.store, draft) };
          callsLog.push({ name: INSPECT_REFERENCES_TOOL, status: "ok" });
        } else if (fn.name === GET_REFERENCE_TOOL) {
          const id = String(fn.args?.id ?? "");
          const ref = this.store.getReference(id);
          if (!ref) {
            result = { output: { ok: false }, error: `Reference "${id}" not found` };
            callsLog.push({ name: GET_REFERENCE_TOOL, status: "error" });
          } else {
            result = { output: referenceDetail(ref) };
            callsLog.push({ name: GET_REFERENCE_TOOL, status: "ok" });
          }
        } else if (fn.name === "setProjectName" || opTools().some((t) => t.name === fn.name)) {
          try {
            const applied = executeOperations(draft, [{ op: fn.name, args: fn.args ?? {} }]);
            draft = applied.project;
            succeededOps.push({ op: fn.name, args: fn.args ?? {} });
            result = { output: { ok: true, refs: applied.refs } };
            callsLog.push({ name: fn.name, status: "ok" });
          } catch (error) {
            const message = error instanceof OpExecutionError ? error.message : String(error);
            result = { output: { ok: false }, error: message };
            callsLog.push({ name: fn.name, status: "error" });
          }
        } else {
          result = { output: { ok: false }, error: `Unknown operation "${fn.name}"` };
          callsLog.push({ name: fn.name, status: "error" });
        }
        resultParts.push({
          functionResponse: { id: fn.id, name: fn.name, response: result as Record<string, unknown> },
        });
      }

      contents.push({ role: "user", parts: resultParts });

      if (succeededOps.length > 0 && !dryRun) {
        const updated = this.store.addSessionStep(sessionId, succeededOps, draft);
        if (!updated) throw new AiSessionError(`Session is no longer open`);
        draft = updated.draft;
        this.hub.broadcast(session.projectId, { type: "session:update", session: updated });
      }
    }

    return dryRun ? { reply, sessionId, calls: callsLog, draft } : { reply, sessionId, calls: callsLog };
  }
}

export const aiSessionIdSchema = z.string().min(1);
