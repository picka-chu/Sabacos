import { validateInitData, type Profile } from "@sabacos/core";
import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { upsertTelegramProfile } from "../db/profiles.js";
import { unauthorized } from "../errors.js";

export type UserContext = {
  Variables: {
    profile: Profile;
  };
};

function readInitData(c: Context<{ Bindings: AppEnv }>): string {
  const header = c.req.header("x-telegram-init-data");
  if (header) return header;
  const body = c.req.query("initData");
  if (typeof body === "string" && body) return body;
  return "";
}

export const requireUser: MiddlewareHandler<{ Bindings: AppEnv } & UserContext> = async (
  c,
  next,
) => {
  const env = c.env;
  const initData = readInitData(c as Context);
  const result = await validateInitData(initData, env.BOT_TOKEN);
  if (!result.valid || !result.payload) {
    throw unauthorized("Invalid Telegram session");
  }

  const db = getDb(env);
  const profile = await upsertTelegramProfile(db, {
    telegramId: result.payload.userId,
    firstName: result.payload.firstName,
    lastName: result.payload.lastName,
    username: result.payload.username,
  });

  c.set("profile", profile);
  await next();
};