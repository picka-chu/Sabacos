import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadEnv } from "./env.js";
import { getDb } from "./db/client.js";
import { createBot, registerBotDefaults } from "./bot/bot.js";
import { catalogRoutes } from "./routes/catalog.js";
import { cartRoutes } from "./routes/cart.js";
import { orderRoutes } from "./routes/orders.js";
import { adminRoutes } from "./routes/admin.js";
import { adRoutes } from "./routes/ads.js";
import { waitlistAdminRoutes } from "./routes/waitlist-admin.js";
import { discountAdminRoutes } from "./routes/discount-admin.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { requireUser } from "./auth/telegram.js";
import { requireAdmin } from "./auth/admin.js";
import { sendError, notFound } from "./errors.js";
import { log } from "./log.js";
import { rateLimit } from "./rate-limit.js";
import { startMarketingSweeper, stopMarketingSweeper } from "./services/notifier.js";

const env = loadEnv();
const db = getDb(env);
const bot = createBot(env);

// ---------------------------------------------------------------------------
// Allowed CORS origins
// ---------------------------------------------------------------------------
const allowedOrigins = new Set<string>([env.WEBAPP_URL, env.ADMIN_DASHBOARD_URL]);
if (env.NODE_ENV !== "production") {
  allowedOrigins.add("http://localhost:5174");
  allowedOrigins.add("http://localhost:5175");
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients
  try {
    const host = new URL(origin).host;
    for (const allowed of allowedOrigins) {
      if (new URL(allowed).host === host) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function ipKey(c: { req: { header: (name: string) => string | undefined } }): string {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || c.req.header("x-real-ip") || "unknown";
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const app = new Hono<{ Bindings: typeof env }>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// CORS — whitelist origins
app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : undefined),
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Telegram-Init-Data"],
    maxAge: 86400,
  }),
);

// ---------------------------------------------------------------------------
// Body-size guard: reject requests > 10 MB before body parsing
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return c.json({ error: { code: "bad_request", message: "Invalid Content-Length header" } }, 400);
    }
    if (parsed > MAX_BODY_BYTES) {
      return c.json({ error: { code: "payload_too_large", message: "Request too large (max 10 MB)" } }, 413);
    }
  }
  await next();
});

// Security response headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
});

// Global rate limit: 120 req/min per IP
app.use("*", rateLimit({ windowMs: 60_000, limit: 120, keyGenerator: ipKey }));

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.onError((err, c) => sendError(c, err));
app.notFound((c) => sendError(c, notFound()));

// ---------------------------------------------------------------------------
// Health / uptime monitors
// ---------------------------------------------------------------------------
app.get("/", (c) => c.json({ ok: true, service: "sabacos-server", time: new Date().toISOString() }));
app.on("HEAD", "/", (c) => c.body(null, 200));

app.get("/health", async (c) => {
  const { error } = await db.from("settings").select("key").limit(1);
  return c.json({ ok: true, db: !error, time: new Date().toISOString() });
});
app.on("HEAD", "/health", (c) => c.body(null, 200));

// ---------------------------------------------------------------------------
// Telegram webhook — timing-safe secret comparison
// ---------------------------------------------------------------------------
app.post("/webhook", async (c) => {
  const provided = c.req.header("x-telegram-bot-api-secret-token") ?? "";
  if (env.WEBHOOK_SECRET) {
    const a = new TextEncoder().encode(provided);
    const b = new TextEncoder().encode(env.WEBHOOK_SECRET);
    if (a.length !== b.length) {
      return c.json({ error: { code: "unauthorized", message: "Bad webhook secret" } }, 401);
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    if (diff !== 0) {
      return c.json({ error: { code: "unauthorized", message: "Bad webhook secret" } }, 401);
    }
  }
  const update = await c.req.json();
  await bot.handleUpdate(update);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Public routes (no auth)
// ---------------------------------------------------------------------------
app.route("/api/v1/catalog", catalogRoutes);

app.get("/api/v1/delivery/config", async (c) => {
  const { getSettings } = await import("./db/settings.js");
  const { DEFAULT_DELIVERY_CONFIG } = await import("@sabacos/core");
  const settings = await getSettings(db).catch(() => null);
  return c.json({ config: settings?.deliveryConfig ?? DEFAULT_DELIVERY_CONFIG });
});

// ---------------------------------------------------------------------------
// Authenticated user routes — tighter rate limit: 30 req/min
// ---------------------------------------------------------------------------
app.use("/api/v1/cart/*", rateLimit({ windowMs: 60_000, limit: 30, keyGenerator: ipKey }), requireUser);
app.use("/api/v1/checkout", rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: ipKey }), requireUser);
app.use("/api/v1/orders", requireUser);
app.use("/api/v1/profile", requireUser);
app.use("/api/v1/profile/*", requireUser);
app.use("/api/v1/auth/telegram", requireUser);
app.use("/api/v1/track/*", requireUser);
app.use("/api/v1/ads/*", requireUser);
app.use("/api/v1/waitlist", requireUser);
app.use("/api/v1/waitlist/*", requireUser);
app.route("/api/v1", adRoutes);
app.route("/api/v1/cart", cartRoutes);
app.route("/api/v1", orderRoutes);
app.route("/api/v1/waitlist", waitlistRoutes);

// ---------------------------------------------------------------------------
// Admin routes — 20 req/min, requires admin bearer
// ---------------------------------------------------------------------------
app.use("/api/v1/admin/*", rateLimit({ windowMs: 60_000, limit: 20, keyGenerator: ipKey }), requireAdmin);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/admin/waitlist", waitlistAdminRoutes);
app.route("/api/v1/admin/discounts", discountAdminRoutes);

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
let server: ServerType | undefined;

async function start(): Promise<void> {
  await bot.init();
  log.info(`Bot initialized as @${bot.botInfo.username}`);

  if (env.WEBHOOK_URL) {
    const url = `${env.WEBHOOK_URL.replace(/\/$/, "")}/webhook`;
    await bot.api.setWebhook(url, env.WEBHOOK_SECRET ? { secret_token: env.WEBHOOK_SECRET } : {});
    log.info(`Webhook set to ${url}`);
  } else {
    log.warn("WEBHOOK_URL not set; skipping webhook registration.");
  }

  await registerBotDefaults(bot, env);
  log.info("Bot commands and menu button registered");

  startMarketingSweeper(bot, env);
  log.info(`Marketing sweeper ${env.MARKETING_SWEEP === "off" ? "disabled" : "running (hourly)"}`);

  server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    log.info(`Sabacos server listening on http://localhost:${info.port}`);
    log.info(`Mini app URL: ${env.WEBAPP_URL}`);
    log.info(`Admin dashboard URL: ${env.ADMIN_DASHBOARD_URL}`);
  });
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal: string): void {
  log.info(`${signal} received — shutting down`);
  stopMarketingSweeper();
  server?.close(() => {
    log.info("HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => {
    log.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch((err) => {
  log.error("Failed to start server:", err);
  process.exit(1);
});
