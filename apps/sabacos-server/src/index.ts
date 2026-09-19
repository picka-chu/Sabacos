import { getRequestListener, type HttpBindings, type ServerType } from "@hono/node-server";
import { createServer } from "node:http";
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
import { userManagementRoutes } from "./routes/user-management.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { referralRoutes } from "./routes/referrals.js";
import { adminReferralRoutes } from "./routes/admin-referrals.js";
import { shareRoutes } from "./routes/share.js";
import { requireUser } from "./auth/telegram.js";
import { requireAdmin, requireFullAdmin, adminMeHandler } from "./auth/admin.js";
import { sendError, notFound } from "./errors.js";
import { log } from "./log.js";
import { rateLimit } from "./rate-limit.js";
import { startMarketingSweeper, stopMarketingSweeper } from "./services/notifier.js";
import { startAdaptiveCron, stopAdaptiveCron } from "./cron/adaptive.js";

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

const allowedOriginValues = new Set([...allowedOrigins].map((value) => new URL(value).origin));

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients
  try {
    return allowedOriginValues.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

const trustedProxyIps = new Set(
  (env.TRUSTED_PROXY_IPS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
);

function ipKey(c: { env: HttpBindings; req: { header: (name: string) => string | undefined } }): string {
  const peer = c.env.incoming.socket.remoteAddress ?? "unknown";
  // Forwarded headers are user-controlled unless the TCP peer is an explicitly
  // configured reverse proxy. A trusted proxy appends the client at the left.
  if (trustedProxyIps.has(peer)) {
    const xff = c.req.header("x-forwarded-for");
    const client = xff?.split(",").map((value) => value.trim()).find(Boolean);
    if (client) return client;
  }
  return peer;
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

const app = new Hono<{ Bindings: typeof env & HttpBindings }>();

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

// Global rate limit: 240 req/min per IP
app.use("*", rateLimit(db, { windowMs: 60_000, limit: 240, keyGenerator: ipKey }));

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

// Public waitlist check — no auth required.  The mini app Shell uses this to
// decide whether to show the waitlist page before user auth completes.
app.get("/api/v1/waitlist/public-status", async (c) => {
  const { getWaitlistConfig } = await import("./db/waitlist.js");
  const config = await getWaitlistConfig(db).catch(() => null);
  return c.json({ isActive: config?.isActive === true });
});

app.get("/api/v1/delivery/config", async (c) => {
  const { getSettings } = await import("./db/settings.js");
  const { DEFAULT_DELIVERY_CONFIG } = await import("@sabacos/core");
  const settings = await getSettings(db).catch(() => null);
  return c.json({ config: settings?.deliveryConfig ?? DEFAULT_DELIVERY_CONFIG });
});

// Public bank accounts — active accounts only, no auth required
app.get("/api/v1/bank-accounts", async (c) => {
  const { listBankAccounts } = await import("./db/bank-accounts.js");
  const accounts = await listBankAccounts(db);
  return c.json({ accounts });
});

// ---------------------------------------------------------------------------
// Admin auth + routes — registered BEFORE the user routers below, otherwise
// their global requireUser middleware (mounted loosely at /api/v1) shadows
// /api/v1/admin/* and rejects browser bearer logins with the shop's
// "Open Sabacos from inside Telegram" message. Admin accepts either a
// Telegram initData session or a Supabase bearer token.
// ---------------------------------------------------------------------------
app.get("/api/v1/admin/me", adminMeHandler);

app.use("/api/v1/admin/*", rateLimit(db, { windowMs: 60_000, limit: 60, keyGenerator: ipKey }), requireAdmin);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/admin/waitlist", waitlistAdminRoutes);
app.route("/api/v1/admin/discounts", discountAdminRoutes);
app.use("/api/v1/admin/users/*", requireFullAdmin);
app.route("/api/v1/admin/users", userManagementRoutes);
app.route("/api/v1/admin/referrals", adminReferralRoutes);

// ---------------------------------------------------------------------------
// Authenticated user routes — generous limit for normal app usage
// ---------------------------------------------------------------------------
app.use("/api/v1/checkout", rateLimit(db, { windowMs: 60_000, limit: 20, keyGenerator: ipKey }), requireUser);
app.route("/api/v1", adRoutes);
app.route("/api/v1/cart", cartRoutes);
app.route("/api/v1", orderRoutes);
app.route("/api/v1/waitlist", waitlistRoutes);
app.route("/api/v1/referral", referralRoutes);
app.route("/api/v1/share", shareRoutes);

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

  startAdaptiveCron(env);
  log.info("Adaptive referral cron scheduler started");
  const listener = getRequestListener(app.fetch);
  server = createServer((incoming, outgoing) => {
    const contentLength = Number(incoming.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      outgoing.writeHead(413, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: { code: "payload_too_large", message: "Request too large (max 10 MB)" } }));
      incoming.destroy();
      return;
    }
    void listener(incoming, outgoing);
  }).listen(env.PORT, () => {
    const address = server?.address();
    const port = typeof address === "object" && address ? address.port : env.PORT;
    log.info(`Sabacos server listening on http://localhost:${port}`);
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
  stopAdaptiveCron();
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
