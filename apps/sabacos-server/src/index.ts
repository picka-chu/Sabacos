import { serve } from "@hono/node-server";
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
import { requireUser } from "./auth/telegram.js";
import { requireAdmin } from "./auth/admin.js";
import { sendError, notFound } from "./errors.js";
import { startMarketingSweeper } from "./services/notifier.js";

const env = loadEnv();
const db = getDb(env);
const bot = createBot(env);

const app = new Hono<{ Bindings: typeof env }>();

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Telegram-Init-Data"],
  }),
);

app.onError((err, c) => sendError(c, err));

app.notFound((c) => sendError(c, notFound()));

app.get("/health", async (c) => {
  const { data, error } = await db.from("settings").select("key").limit(1);
  return c.json({
    ok: true,
    db: !error,
    time: new Date().toISOString(),
  });
});

app.post("/webhook", async (c) => {
  const secret = c.req.header("x-telegram-bot-api-secret-token");
  if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
    return c.json({ error: { code: "unauthorized", message: "Bad webhook secret" } }, 401);
  }
  const update = await c.req.json();
  await bot.handleUpdate(update);
  return c.json({ ok: true });
});

app.route("/api/v1/catalog", catalogRoutes);

// Public: clients need the zone table + thresholds to preview delivery cost.
app.get("/api/v1/delivery/config", async (c) => {
  const { getSettings } = await import("./db/settings.js");
  const { DEFAULT_DELIVERY_CONFIG } = await import("@sabacos/core");
  const settings = await getSettings(db).catch(() => null);
  return c.json({ config: settings?.deliveryConfig ?? DEFAULT_DELIVERY_CONFIG });
});

app.use("/api/v1/cart/*", requireUser);
app.use("/api/v1/checkout", requireUser);
app.use("/api/v1/orders", requireUser);
app.use("/api/v1/profile", requireUser);
app.use("/api/v1/profile/*", requireUser);
app.use("/api/v1/auth/telegram", requireUser);
app.use("/api/v1/track/*", requireUser);
app.use("/api/v1/ads/*", requireUser);
app.route("/api/v1", adRoutes);
app.route("/api/v1/cart", cartRoutes);
app.route("/api/v1", orderRoutes);

app.use("/api/v1/admin/*", requireAdmin);
app.route("/api/v1/admin", adminRoutes);

async function start(): Promise<void> {
  await bot.init();
  console.log(`Bot initialized as @${bot.botInfo.username}`);

  if (env.WEBHOOK_URL) {
    const url = `${env.WEBHOOK_URL.replace(/\/$/, "")}/webhook`;
    await bot.api.setWebhook(url, env.WEBHOOK_SECRET ? { secret_token: env.WEBHOOK_SECRET } : {});
    console.log(`Webhook set to ${url}`);
  } else {
    console.log("WEBHOOK_URL not set; skipping webhook registration. Set it in production.");
  }

  await registerBotDefaults(bot, env);
  console.log("Bot commands and menu button registered");

  startMarketingSweeper(bot, env);
  console.log(`Marketing sweeper ${env.MARKETING_SWEEP === "off" ? "disabled" : "running (hourly)"}`);

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Sabacos server listening on http://localhost:${info.port}`);
    console.log(`Mini app URL: ${env.WEBAPP_URL}`);
    console.log(`Admin dashboard URL: ${env.ADMIN_DASHBOARD_URL}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});