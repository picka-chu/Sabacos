import { Hono } from "hono";
import { z } from "zod";
import { getAppEnv, type AppEnv } from "../env.js";
import type { AdminContext } from "../auth/admin.js";
import { getDb } from "../db/client.js";
import { badRequest, safeParse } from "../errors.js";
import {
  agentEnabled,
  agentModel,
  describeWriteAction,
  executeWriteAction,
  runAgentTurn,
  writeArgSchemas,
  type WriteActionKind,
} from "../services/ai-agent.js";
import { notifyAdminChannel } from "../bot/bot.js";

export const aiAgentRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(4000) }))
    .max(20)
    .optional(),
  confirm: z
    .object({ kind: z.string(), params: z.record(z.string(), z.unknown()) })
    .optional(),
});

aiAgentRoutes.get("/status", async (c) => {
  const env = getAppEnv();
  return c.json({ enabled: agentEnabled(env), model: agentModel(env) });
});

aiAgentRoutes.post("/", async (c) => {
  // Admin-only feature: the agent can change catalog, promos and broadcasts.
  const caller = c.get("profile");
  if (caller.role !== "admin") {
    return c.json({ error: { code: "forbidden", message: "Only admins can use the AI assistant" } }, 403);
  }
  const env = getAppEnv();
  if (!agentEnabled(env)) {
    return c.json(
      { error: { code: "ai_disabled", message: "AI assistant is not configured — set GEMINI_API_KEY on the server" } },
      503,
    );
  }
  const db = getDb(env);
  const body = safeParse(chatSchema, await c.req.json().catch(() => null));

  // Approve path: execute a previously proposed write action. Params are
  // re-validated strictly, so a tampered client payload cannot smuggle
  // anything past the schemas.
  if (body.confirm) {
    const kind = body.confirm.kind as WriteActionKind;
    const schema = (writeArgSchemas as Record<string, z.ZodTypeAny>)[kind];
    if (!schema) throw badRequest("Unknown action");
    const parsed = schema.safeParse(body.confirm.params);
    if (!parsed.success) throw badRequest("Invalid action details");
    try {
      const done = await executeWriteAction(db, env, kind, parsed.data as Record<string, unknown>);
      const summary = describeWriteAction(kind, parsed.data as Record<string, unknown>);
      await notifyAdminChannel(env, `🤖 AI assistant executed: ${summary}`).catch(() => undefined);
      return c.json({ reply: `Done — ${done}`, executed: { kind, summary } });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (!body.message) throw badRequest("message required");
  const history = (body.messages ?? []).map((m) => ({ role: m.role as "user" | "model", text: m.text }));
  try {
    const result = await runAgentTurn(db, env, history, body.message);
    return c.json(result);
  } catch (err) {
    console.error("[ai-agent] turn failed:", err);
    return c.json(
      { error: { code: "ai_failed", message: "The assistant failed — please try again" } },
      502,
    );
  }
});
