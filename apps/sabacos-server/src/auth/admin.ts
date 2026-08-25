import type { Profile } from "@sabacos/core";
import type { Context, MiddlewareHandler } from "hono";
import { getAppEnv, type AppEnv } from "../env.js";
import { getDb, getAuthDb } from "../db/client.js";
import { getProfileByAuthId } from "../db/profiles.js";
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

export const requireAdmin: MiddlewareHandler<{ Bindings: AppEnv } & AdminContext> = async (
  c,
  next,
) => {
  const env = getAppEnv();
  const token = readBearer(c as Context);
  if (!token) throw unauthorized("Missing bearer token");

  // Use the anon-key client for auth validation — the service-role key is
  // rejected by the Supabase auth server for user token validation.
  const authDb = getAuthDb(env);
  const { data, error } = await authDb.auth.getUser(token);
  if (error || !data.user) throw unauthorized("Invalid token");

  const db = getDb(env);
  const profile = await getProfileByAuthId(db, data.user.id);
  if (!profile) throw unauthorized("No profile for this user");
  if (profile.role !== "admin") throw forbidden("Admin access required");

  c.set("profile", profile);
  await next();
};