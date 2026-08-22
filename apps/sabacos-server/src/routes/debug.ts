import { Hono } from "hono";
import { Bot } from "grammy";
import { validateInitData } from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";

export const debugRoutes = new Hono<{ Bindings: AppEnv }>();

debugRoutes.get("/bot", async (c) => {
  const env = getAppEnv();
  const token = env.BOT_TOKEN;
  try {
    const bot = new Bot(token);
    const me = await bot.api.getMe();
    return c.json({
      botUsername: me.username,
      botId: me.id,
      tokenLength: token.length,
      tokenLast4: token.slice(-4),
      webappUrl: env.WEBAPP_URL,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

debugRoutes.post("/validate", async (c) => {
  const env = getAppEnv();
  const initData = await c.req.text();
  const providedHash = new URLSearchParams(initData).get("hash") ?? "";
  const result = await validateInitData(initData, env.BOT_TOKEN);
  return c.json({
    valid: result.valid,
    error: result.error ?? null,
    userId: result.payload?.userId ?? null,
    providedHashPrefix: providedHash.slice(0, 12),
    bytes: initData.length,
  });
});
