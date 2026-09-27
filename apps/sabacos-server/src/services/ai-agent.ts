/**
 * Sabacos admin AI agent (Gemini function-calling, REST — no SDK).
 *
 * The admin chats; the model reads live business data through READ tools and
 * proposes WRITE actions. Writes NEVER execute on first request — the server
 * returns them as pendingAction summaries and only executes after the admin
 * taps Approve (confirm flow in routes/ai-agent.ts). Money-moving surfaces
 * (payouts, wallet, refunds, roles, settings) are not tools at all.
 */
import { z } from "zod";
import type { AppEnv } from "../env.js";
import type { Db } from "../db/client.js";
import { getSettings } from "../db/settings.js";
import { formatETB } from "@sabacos/core";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_TURNS = 4;
const CALL_TIMEOUT_MS = 60_000;

function agentEnv(env: AppEnv): { key: string; model: string } | null {
  if (!env.GEMINI_API_KEY) return null;
  return { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.6-flash" };
}

export function agentEnabled(env: AppEnv): boolean {
  return agentEnv(env) !== null;
}

export function agentModel(env: AppEnv): string {
  return agentEnv(env)?.model ?? "gemini-3.6-flash";
}

// ──────────────────────────────────────────────────────────────────────
// Tool declarations (JSON Schema for Gemini functionDeclarations)
// ──────────────────────────────────────────────────────────────────────

interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const READ_TOOLS: ToolDef[] = [
  {
    name: "get_products",
    description: "List shop products. Returns id, name, price in ETB, stock, active flag.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filter by name or SKU" },
        limit: { type: "integer", description: "Max items, 1-20, default 10" },
      },
    },
  },
  {
    name: "get_product",
    description: "Full details of one product by id.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Product UUID" } },
      required: ["id"],
    },
  },
  {
    name: "get_sales_summary",
    description: "Revenue and order counts over recent days (excludes cancelled orders).",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window, 1-90, default 7" },
      },
    },
  },
  {
    name: "get_customers_summary",
    description: "Total customers and how many joined in the last 7 days.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_referral_stats",
    description: "Referral program state: active flag, commission and discount percents, pending and qualified referral counts.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_low_stock",
    description: "Active products at or below a stock threshold.",
    parameters: {
      type: "object",
      properties: {
        threshold: { type: "integer", description: "Stock cutoff, default 5" },
      },
    },
  },
];

const WRITE_TOOLS: ToolDef[] = [
  {
    name: "create_discount",
    description: "PROPOSAL ONLY — creates a promotion after admin approval. Money in ETB.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Promo name, e.g. Payday 15%" },
        discountType: { type: "string", enum: ["percent", "fixed"] },
        discountValue: { type: "number", description: "Percent 1-100, or fixed ETB amount" },
        scope: { type: "string", enum: ["all", "category", "products"] },
        categoryId: { type: "string", description: "Required when scope is category" },
        productIds: { type: "array", items: { type: "string" }, description: "Required when scope is products" },
        minSubtotalEtb: { type: "number", description: "Minimum order ETB, default 0" },
        durationDays: { type: "integer", description: "How long it runs, default 7" },
      },
      required: ["name", "discountType", "discountValue", "scope"],
    },
  },
  {
    name: "create_spinner_prize",
    description: "PROPOSAL ONLY — adds a prize-wheel prize after admin approval.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        prizeType: { type: "string", enum: ["coupon_percent", "coupon_fixed"] },
        value: { type: "number", description: "Percent 1-100, or fixed ETB amount" },
        weight: { type: "number", description: "Relative probability, default 10" },
        maxPool: { type: "integer", description: "Max winners, blank for unlimited" },
      },
      required: ["name", "prizeType", "value"],
    },
  },
  {
    name: "post_to_channel",
    description: "PROPOSAL ONLY — posts a product card to the marketing channel after admin approval.",
    parameters: {
      type: "object",
      properties: { productId: { type: "string", description: "Product UUID" } },
      required: ["productId"],
    },
  },
  {
    name: "send_broadcast",
    description: "PROPOSAL ONLY — sends a Telegram broadcast to ALL users after admin approval. Use sparingly and say so.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message, max 4000 chars" },
        buttonText: { type: "string", description: "Button label, optional" },
        buttonUrl: { type: "string", description: "External URL (needs buttonText)" },
        buttonInline: { type: "boolean", description: "Open inside the mini app instead" },
        buttonTarget: { type: "string", description: "In-app path like /shop (needs buttonInline)" },
      },
      required: ["text"],
    },
  },
  {
    name: "update_product",
    description: "PROPOSAL ONLY — changes a product's price, stock or visibility after admin approval.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Product UUID" },
        priceEtb: { type: "number", description: "New price in ETB" },
        stock: { type: "integer", description: "New stock count" },
        isActive: { type: "boolean", description: "Visible in shop or hidden" },
      },
      required: ["id"],
    },
  },
];

const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];
const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

// Strict server-side validation for write args (re-validated on confirm,
// so a tampered client payload cannot smuggle anything past this).
export const writeArgSchemas = {
  create_discount: z.strictObject({
    name: z.string().trim().min(1).max(80),
    discountType: z.enum(["percent", "fixed"]),
    discountValue: z.number().positive(),
    scope: z.enum(["all", "category", "products"]),
    categoryId: z.string().optional(),
    productIds: z.array(z.string()).optional(),
    minSubtotalEtb: z.number().min(0).optional(),
    durationDays: z.number().int().min(1).max(90).optional(),
  }),
  create_spinner_prize: z.strictObject({
    name: z.string().trim().min(1).max(80),
    prizeType: z.enum(["coupon_percent", "coupon_fixed"]),
    value: z.number().positive(),
    weight: z.number().positive().optional(),
    maxPool: z.number().int().positive().nullable().optional(),
  }),
  post_to_channel: z.strictObject({ productId: z.string().min(1) }),
  send_broadcast: z
    .strictObject({
      text: z.string().trim().min(1).max(4000),
      buttonText: z.string().trim().min(1).max(64).optional(),
      buttonUrl: z.string().trim().url().optional(),
      buttonInline: z.boolean().optional(),
      buttonTarget: z.string().trim().min(1).max(512).optional(),
    })
    .refine(
      (v) => {
        if (v.buttonInline) return Boolean(v.buttonText && v.buttonTarget);
        if (v.buttonTarget) return false;
        return v.buttonUrl === undefined || v.buttonText !== undefined;
      },
      { message: "Bad button combination" },
    ),
  update_product: z
    .strictObject({
      id: z.string().min(1),
      priceEtb: z.number().positive().optional(),
      stock: z.number().int().min(0).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((v) => v.priceEtb !== undefined || v.stock !== undefined || v.isActive !== undefined, {
      message: "Nothing to update",
    }),
} as const;

export type WriteActionKind = keyof typeof writeArgSchemas;

export interface PendingAction {
  kind: WriteActionKind;
  summary: string;
  params: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────────
// Business snapshot (what the agent "knows")
// ──────────────────────────────────────────────────────────────────────

async function buildSnapshot(db: Db): Promise<string> {
  const parts: string[] = [];
  try {
    const settings = await getSettings(db).catch(() => null);
    parts.push(
      `Shop: ${settings?.shopNameEn ?? "Sabacos"}. Delivery fee ${formatETB(settings?.deliveryFeeHalala ?? 0)}, free over ${formatETB(settings?.freeDeliveryThresholdHalala ?? 0)}.`,
    );
  } catch { /* snapshot is best-effort */ }

  try {
    const { listProducts } = await import("../db/catalog.js");
    const page = await listProducts(db, { page: 1, pageSize: 12, includeInactive: false });
    const lines = page.items.map(
      (p) => `- ${p.nameEn} | id ${p.id} | ${formatETB(p.priceHalala)} | stock ${p.stock}`,
    );
    parts.push(`Products (showing ${page.items.length} of ${page.total}):\n${lines.join("\n") || "(none)"}`);
  } catch { /* noop */ }

  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: orders } = await db
      .from("orders")
      .select("total_halala, status, created_at")
      .gte("created_at", since)
      .neq("status", "cancelled")
      .limit(500);
    const rows = ((orders ?? []) as Array<{ total_halala: number }>);
    const revenue = rows.reduce((s, o) => s + (o.total_halala ?? 0), 0);
    parts.push(`Last 7 days: ${rows.length} orders, ${formatETB(revenue)} revenue (excl. cancelled).`);
  } catch { /* noop */ }

  try {
    const { count: customers } = await db.from("profiles").select("id", { count: "exact", head: true });
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { count: fresh } = await db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo);
    parts.push(`Customers: ${customers ?? "?"} total, ${fresh ?? "?"} joined in the last 7 days.`);
  } catch { /* noop */ }

  try {
    const { getReferralSettings } = await import("../db/referrals.js");
    const s = await getReferralSettings(db).catch(() => null);
    const { count: pend } = await db
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    const { count: qual } = await db
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("status", "qualified");
    parts.push(
      `Referrals: program ${s?.isActive ? "ACTIVE" : "PAUSED"}, friend discount ${s?.referredDiscountPercent ?? "?"}%, commission ${s?.firstPurchasePercent ?? "?"}%, ${pend ?? 0} pending, ${qual ?? 0} qualified.`,
    );
  } catch { /* noop */ }

  try {
    const { data: low } = await db
      .from("products")
      .select("name_en, price_halala, stock")
      .eq("is_active", true)
      .lte("stock", 5)
      .order("stock", { ascending: true })
      .limit(8);
    const rows = ((low ?? []) as Array<{ name_en: string; price_halala: number; stock: number }>);
    if (rows.length > 0) {
      parts.push(`Low stock: ${rows.map((r) => `${r.name_en} (${r.stock} left)`).join("; ")}.`);
    }
  } catch { /* noop */ }

  try {
    const { getActiveDiscounts } = await import("../db/discounts.js");
    const discounts = await getActiveDiscounts(db).catch(() => []);
    parts.push(
      discounts.length > 0
        ? `Active promos: ${discounts.map((d) => `${d.name} (${d.discountType} ${d.discountValue})`).join("; ")}.`
        : "No active promos right now.",
    );
  } catch { /* noop */ }

  return parts.join("\n");
}

// ──────────────────────────────────────────────────────────────────────
// Read tools
// ──────────────────────────────────────────────────────────────────────

async function executeReadTool(
  db: Db,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case "get_products": {
      const { listProducts } = await import("../db/catalog.js");
      const q = typeof args.search === "string" ? args.search : undefined;
      const limit = Math.min(20, Math.max(1, typeof args.limit === "number" ? Math.floor(args.limit) : 10));
      const page = await listProducts(db, { page: 1, pageSize: limit, search: q });
      return {
        total: page.total,
        items: page.items.map((p) => ({
          id: p.id,
          name: p.nameEn,
          priceEtb: p.priceHalala / 100,
          stock: p.stock,
          active: p.isActive,
        })),
      };
    }
    case "get_product": {
      const { getProductById } = await import("../db/catalog.js");
      const p = await getProductById(db, String(args.id ?? ""), true).catch(() => null);
      if (!p) return { found: false };
      return {
        found: true,
        id: p.id,
        nameEn: p.nameEn,
        nameAm: p.nameAm,
        priceEtb: p.priceHalala / 100,
        stock: p.stock,
        active: p.isActive,
        descriptionEn: (p.descriptionEn || "").slice(0, 300),
      };
    }
    case "get_sales_summary": {
      const days = Math.min(90, Math.max(1, typeof args.days === "number" ? Math.floor(args.days) : 7));
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data } = await db
        .from("orders")
        .select("total_halala, status")
        .gte("created_at", since)
        .neq("status", "cancelled")
        .limit(1000);
      const rows = ((data ?? []) as Array<{ total_halala: number }>);
      const revenue = rows.reduce((s, o) => s + (o.total_halala ?? 0), 0);
      return { days, orders: rows.length, revenueEtb: revenue / 100 };
    }
    case "get_customers_summary": {
      const { count: total } = await db.from("profiles").select("id", { count: "exact", head: true });
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { count: fresh } = await db
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo);
      return { totalCustomers: total ?? 0, joinedLast7Days: fresh ?? 0 };
    }
    case "get_referral_stats": {
      const { getReferralSettings } = await import("../db/referrals.js");
      const s = await getReferralSettings(db).catch(() => null);
      const { count: pending } = await db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      const { count: qualified } = await db
        .from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("status", "qualified");
      return {
        active: s?.isActive ?? false,
        friendDiscountPercent: s?.referredDiscountPercent ?? null,
        commissionPercent: s?.firstPurchasePercent ?? null,
        pendingCount: pending ?? 0,
        qualifiedCount: qualified ?? 0,
      };
    }
    case "get_low_stock": {
      const threshold =
        typeof args.threshold === "number" ? Math.max(0, Math.floor(args.threshold)) : 5;
      const { data } = await db
        .from("products")
        .select("id, name_en, price_halala, stock")
        .eq("is_active", true)
        .lte("stock", threshold)
        .order("stock", { ascending: true })
        .limit(15);
      return {
        items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          name: r.name_en,
          priceEtb: Number(r.price_halala ?? 0) / 100,
          stock: r.stock,
        })),
      };
    }
    default:
      return { error: `Unknown read tool: ${name}` };
  }
}

// ──────────────────────────────────────────────────────────────────────
// Write actions: describe (for approval UI) + execute (after approval)
// ──────────────────────────────────────────────────────────────────────

export function describeWriteAction(kind: WriteActionKind, params: Record<string, unknown>): string {
  switch (kind) {
    case "create_discount": {
      const p = params as { name?: string; discountType?: string; discountValue?: number; scope?: string; durationDays?: number };
      return `Create ${p.discountType === "percent" ? `${p.discountValue}%` : `${p.discountValue} ETB`} discount "${p.name}" (${p.scope} scope, ~${p.durationDays ?? 7} days)`;
    }
    case "create_spinner_prize": {
      const p = params as { name?: string; prizeType?: string; value?: number };
      return `Add prize-wheel prize "${p.name}" (${p.prizeType} ${p.value})`;
    }
    case "post_to_channel": {
      return `Post product ${(params as { productId?: string }).productId} to the marketing channel`;
    }
    case "send_broadcast": {
      const p = params as { text?: string; buttonText?: string };
      const preview = (p.text ?? "").slice(0, 120);
      return `Broadcast to ALL users: "${preview}${(p.text ?? "").length > 120 ? "…" : ""}"${p.buttonText ? ` + button "${p.buttonText}"` : ""}`;
    }
    case "update_product": {
      const p = params as { id?: string; priceEtb?: number; stock?: number; isActive?: boolean };
      const bits: string[] = [];
      if (p.priceEtb !== undefined) bits.push(`price → ${p.priceEtb} ETB`);
      if (p.stock !== undefined) bits.push(`stock → ${p.stock}`);
      if (p.isActive !== undefined) bits.push(p.isActive ? "visible" : "hidden");
      return `Update product ${p.id}: ${bits.join(", ") || "nothing"}`;
    }
  }
}

export async function executeWriteAction(
  db: Db,
  env: AppEnv,
  kind: WriteActionKind,
  params: Record<string, unknown>,
): Promise<string> {
  switch (kind) {
    case "create_discount": {
      const p = writeArgSchemas.create_discount.parse(params);
      if (p.discountType === "percent" && p.discountValue > 100) {
        throw new Error("Percentage discount cannot exceed 100%");
      }
      if (p.scope === "category" && !p.categoryId) throw new Error("Category scope needs categoryId");
      if (p.scope === "products" && (!p.productIds || p.productIds.length === 0)) {
        throw new Error("Products scope needs productIds");
      }
      const now = Date.now();
      const durationMs = (p.durationDays ?? 7) * 86_400_000;
      const { createDiscount } = await import("../db/discounts.js");
      const d = await createDiscount(db, {
        name: p.name,
        description: "Created by the AI assistant",
        discountType: p.discountType,
        discountValue: p.discountValue,
        scope: p.scope,
        categoryId: p.scope === "category" ? p.categoryId ?? null : null,
        productIds: p.scope === "products" ? p.productIds ?? [] : [],
        minSubtotalHalala: p.minSubtotalEtb != null ? Math.round(p.minSubtotalEtb * 100) : null,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + durationMs).toISOString(),
        isActive: true,
      });
      return `Discount "${d.name}" is live (${d.discountType} ${d.discountValue}).`;
    }
    case "create_spinner_prize": {
      const p = writeArgSchemas.create_spinner_prize.parse(params);
      const { createSpinnerPrize } = await import("../db/spinner.js");
      const prize = await createSpinnerPrize(db, {
        name: p.name,
        prizeType: p.prizeType,
        value: p.prizeType === "coupon_fixed" ? Math.round(p.value * 100) : p.value,
        productId: null,
        weight: p.weight ?? 10,
        maxPool: p.maxPool ?? null,
        currentPool: 0,
        isActive: true,
      });
      return `Prize "${prize.name}" added to the wheel.`;
    }
    case "post_to_channel": {
      const p = writeArgSchemas.post_to_channel.parse(params);
      const { getProductById } = await import("../db/catalog.js");
      const { postProductToChannel } = await import("../bot/bot.js");
      const product = await getProductById(db, p.productId, true).catch(() => null);
      if (!product) throw new Error("Product not found");
      await postProductToChannel(env, product, null, null);
      return `Posted "${product.nameEn}" to the channel.`;
    }
    case "send_broadcast": {
      const p = writeArgSchemas.send_broadcast.parse(params);
      const { executeBroadcast } = await import("./broadcast.js");
      const res = await executeBroadcast(db, env, {
        text: p.text,
        imageUrl: undefined,
        buttonText: p.buttonText,
        buttonUrl: p.buttonUrl,
        buttonInline: p.buttonInline,
        buttonTarget: p.buttonTarget,
      });
      return `Broadcast sent to ${res.sent} users${res.failed > 0 ? ` (${res.failed} failed)` : ""}.`;
    }
    case "update_product": {
      const p = writeArgSchemas.update_product.parse(params);
      const patch: Record<string, unknown> = {};
      if (p.priceEtb !== undefined) patch.price_halala = Math.round(p.priceEtb * 100);
      if (p.stock !== undefined) patch.stock = p.stock;
      if (p.isActive !== undefined) patch.is_active = p.isActive;
      const { data, error } = await db
        .from("products")
        .update(patch)
        .eq("id", p.id)
        .select("id, name_en, price_halala, stock, is_active")
        .single();
      if (error || !data) throw new Error("Product not found or update failed");
      const row = data as Record<string, unknown>;
      return `Updated "${row.name_en}": ${formatETB(Number(row.price_halala ?? 0))}, stock ${row.stock}, ${row.is_active ? "visible" : "hidden"}.`;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Gemini function-calling loop
// ──────────────────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

export interface AgentTurnResult {
  reply: string;
  activity: string[];
  pendingAction: PendingAction | null;
}

const SYSTEM_PROMPT = `You are the Sabacos shop assistant for the store admin. Sabacos sells 100% original cosmetics in Addis Ababa through a Telegram mini app. Prices in chat are always ETB (birr). Amounts inside tool arguments marked ETB are birr; anything marked halala is cents (100 halala = 1 ETB).

Rules:
- NEVER invent numbers: product prices, stock, sales, customer counts — always call a tool first. If a tool fails, say so plainly.
- You can plan marketing, ad strategy and campaigns, and you may PROPOSE promos, prizes, channel posts, broadcasts and product updates via tools. Every proposal needs the admin's tap on Approve — until then nothing happens. Say that when proposing.
- Broadcasts reach EVERY user: mention that explicitly and use them sparingly.
- You CANNOT touch payouts, wallets, refunds, user roles, or settings — say so if asked.
- Keep replies short, plain text, no markdown tables. English unless the admin writes Amharic.`;

async function geminiContents(
  key: string,
  model: string,
  system: string,
  contents: GeminiContent[],
): Promise<{ text: string; calls: Array<{ name: string; args: Record<string, unknown> }> } | null> {
  const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${key}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: ALL_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("[ai-agent] fetch threw:", err instanceof Error ? err.message : err);
    return null;
  }
  if (!res.ok) {
    console.error(`[ai-agent] HTTP ${res.status}:`, (await res.text().catch(() => "")).slice(0, 500));
    return null;
  }
  const json = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
    error?: { message?: string };
  } | null;
  if (!json || json.error) {
    console.error("[ai-agent] API error:", json?.error?.message ?? "empty response");
    return null;
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  const calls = parts
    .filter((p) => p.functionCall?.name)
    .map((p) => ({ name: p.functionCall!.name!, args: (p.functionCall!.args ?? {}) as Record<string, unknown> }));
  return { text, calls };
}

export async function runAgentTurn(
  db: Db,
  env: AppEnv,
  history: Array<{ role: "user" | "model"; text: string }>,
  userText: string,
): Promise<AgentTurnResult> {
  const creds = agentEnv(env);
  if (!creds) throw new Error("AI assistant is not configured (GEMINI_API_KEY missing)");
  const snapshot = await buildSnapshot(db);
  const system = `${SYSTEM_PROMPT}\n\nLive shop snapshot:\n${snapshot}`;

  const contents: GeminiContent[] = [
    ...history.slice(-10).map((m) => ({
      role: m.role,
      parts: [{ text: m.text.slice(0, 2000) }] as GeminiPart[],
    })),
    { role: "user", parts: [{ text: userText.slice(0, 2000) }] },
  ];

  const activity: string[] = [];
  let lastText = "";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const out = await geminiContents(creds.key, creds.model, system, contents);
    if (!out) {
      return {
        reply: lastText || "The AI service didn't respond — please try again in a bit.",
        activity,
        pendingAction: null,
      };
    }
    if (out.text) lastText = out.text;

    if (out.calls.length === 0) {
      return { reply: lastText || "…", activity, pendingAction: null };
    }

    // Execute read tools immediately; the first write tool becomes a
    // proposal and stops the loop (admin must approve before anything runs).
    const followups: GeminiPart[] = [];
    for (const call of out.calls) {
      if (WRITE_TOOL_NAMES.has(call.name)) {
        const kind = call.name as WriteActionKind;
        const schema = writeArgSchemas[kind];
        const parsed = schema.safeParse(call.args);
        if (!parsed.success) {
          return {
            reply: `${lastText}\n\nI couldn't prepare that action (invalid details: ${parsed.error.issues[0]?.message ?? "check the values"}).`.trim(),
            activity,
            pendingAction: null,
          };
        }
        return {
          reply: lastText,
          activity,
          pendingAction: {
            kind,
            summary: describeWriteAction(kind, parsed.data as Record<string, unknown>),
            params: parsed.data as Record<string, unknown>,
          },
        };
      }
      try {
        const result = await executeReadTool(db, call.name, call.args);
        activity.push(call.name);
        followups.push({
          functionResponse: { name: call.name, response: { result: JSON.parse(JSON.stringify(result)) } },
        });
      } catch (err) {
        followups.push({
          functionResponse: {
            name: call.name,
            response: { error: err instanceof Error ? err.message : "tool failed" },
          },
        });
      }
    }
    contents.push({ role: "model", parts: [{ text: lastText }] });
    contents.push({ role: "user", parts: followups });
  }

  return {
    reply: lastText || "I looked that up but ran out of steps — try a narrower question.",
    activity,
    pendingAction: null,
  };
}
