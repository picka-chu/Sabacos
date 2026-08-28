import type { Profile, ProfileRole } from "@sabacos/core";
import { validateInitData } from "@sabacos/core";
import type { Context, MiddlewareHandler } from "hono";
import { getAppEnv, type AppEnv } from "../env.js";
import { getDb, getAuthDb } from "../db/client.js";
import { getProfileByAuthId, getProfileByTelegramId } from "../db/profiles.js";
import { forbidden, unauthorized } from "../errors.js";

export type AdminContext = {
  Variables: {
    profile: Profile;
  };
};

function readBearer(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

function readInitData(c: Context): string {
  return c.req.header("x-telegram-init-data") ?? "";
}

/** Roles that can access admin dashboard. */
const ADMIN_ACCESS_ROLES: readonly ProfileRole[] = ["admin", "staff", "delivery"];

export const requireAdmin: MiddlewareHandler<{ Bindings: AppEnv } & AdminContext> = async (
  c,
  next,
) => {
  const env = getAppEnv();

  // --- Method 1: Telegram initData (mini app from bot) ---
  const initData = readInitData(c as Context);
  if (initData) {
    const result = await validateInitData(initData, env.BOT_TOKEN);
    if (result.valid && result.payload) {
      const db = getDb(env);
      const profile = await getProfileByTelegramId(db, result.payload.userId);
      if (profile && (ADMIN_ACCESS_ROLES as readonly string[]).includes(profile.role)) {
        c.set("profile", profile);
        return next();
      }
    }
    // initData present but invalid or not admin — fall through to Bearer check
  }

  // --- Method 2: Supabase Bearer token (browser login) ---
  const token = readBearer(c as Context);
  if (!token) throw unauthorized("Missing authentication credentials");

  // Use the anon-key client for auth validation — the service-role key is
  // rejected by the Supabase auth server for user token validation.
  const authDb = getAuthDb(env);
  const { data, error } = await authDb.auth.getUser(token);
  if (error || !data.user) throw unauthorized("Invalid token");

  const db = getDb(env);
  const profile = await getProfileByAuthId(db, data.user.id);
  if (!profile) throw unauthorized("No profile for this user");
  if (!(ADMIN_ACCESS_ROLES as readonly string[]).includes(profile.role)) {
    throw forbidden("Admin access required");
  }

  c.set("profile", profile);
  await next();
};

/**
 * Lightweight endpoint to verify Telegram auth and return the admin profile.
 * Used by the admin dashboard when opened as a Telegram mini app.
 */
export const adminMeHandler: MiddlewareHandler<{ Bindings: AppEnv } & AdminContext> = async (c) => {
  const env = getAppEnv();
  const initData = readInitData(c as Context);
  if (!initData) {
    return c.json({ error: { code: "unauthorized", message: "Missing Telegram init data" } }, 401);
  }

  const result = await validateInitData(initData, env.BOT_TOKEN);
  if (!result.valid || !result.payload) {
    return c.json({ error: { code: "unauthorized", message: "Invalid Telegram session" } }, 401);
  }

  const db = getDb(env);
  const profile = await getProfileByTelegramId(db, result.payload.userId);
  if (!profile) {
    return c.json({ error: { code: "unauthorized", message: "No profile found" } }, 401);
  }
  if (!(ADMIN_ACCESS_ROLES as readonly string[]).includes(profile.role)) {
    return c.json({ error: { code: "forbidden", message: "Admin access required" } }, 403);
  }

  return c.json({
    profile: {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      username: profile.username,
      role: profile.role,
    },
  });
};
