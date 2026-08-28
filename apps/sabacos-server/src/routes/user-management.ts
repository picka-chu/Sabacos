import { Hono } from "hono";
import { z } from "zod";
import { PROFILE_ROLES, type ProfileRole } from "@sabacos/core";
import { badRequest, safeParse } from "../errors.js";
import { getAppEnv, type AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import type { AdminContext } from "../auth/admin.js";
import {
  listUsers,
  updateUserRole,
  inviteUserByTelegramId,
  deleteUser,
  getProfileById,
} from "../db/profiles.js";

export const userManagementRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

const inviteSchema = z.object({
  telegramId: z.number().int().positive(),
  role: z.enum(PROFILE_ROLES as unknown as [string, ...string[]]),
});

const updateRoleSchema = z.object({
  role: z.enum(PROFILE_ROLES as unknown as [string, ...string[]]),
});

// List users with optional role filter, search, and pagination
userManagementRoutes.get("/users", async (c) => {
  const db = getDb(getAppEnv());
  const role = c.req.query("role") as ProfileRole | undefined;
  const search = c.req.query("search") ?? undefined;
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");

  const validRoles = PROFILE_ROLES as readonly string[];
  if (role && !validRoles.includes(role)) {
    throw badRequest(`Invalid role: ${role}`);
  }

  const result = await listUsers(db, {
    role: (role as ProfileRole) ?? null,
    search: search ?? null,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 20,
  });

  return c.json(result);
});

// Get single user
userManagementRoutes.get("/users/:id", async (c) => {
  const db = getDb(getAppEnv());
  const profile = await getProfileById(db, c.req.param("id"));
  if (!profile) {
    return c.json({ error: { code: "not_found", message: "User not found" } }, 404);
  }
  return c.json({ profile });
});

// Invite user by Telegram ID
userManagementRoutes.post("/users/invite", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(inviteSchema, body);

  const profile = await inviteUserByTelegramId(db, input.telegramId, input.role as ProfileRole);

  // Try to notify the user via Telegram
  try {
    const { createBot } = await import("../bot/bot.js");
    const env = getAppEnv();
    const bot = createBot(env);
    const roleLabel = input.role.charAt(0).toUpperCase() + input.role.slice(1);
    await bot.api.sendMessage(
      input.telegramId,
      `🎉 You've been added as a <b>${roleLabel}</b> on Sabacos!\n\nOpen the bot and tap /start to access your dashboard.`,
      { parse_mode: "HTML" },
    );
  } catch {
    // User may not have started the bot yet — that's fine
  }

  return c.json({ profile }, 201);
});

// Update user role
userManagementRoutes.patch("/users/:id/role", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateRoleSchema, body);

  const profile = await updateUserRole(db, c.req.param("id"), input.role as ProfileRole);
  return c.json({ profile });
});

// Delete user
userManagementRoutes.delete("/users/:id", async (c) => {
  const db = getDb(getAppEnv());
  const profile = await getProfileById(db, c.req.param("id"));
  if (!profile) {
    return c.json({ error: { code: "not_found", message: "User not found" } }, 404);
  }

  // Don't allow deleting yourself
  const caller = c.get("profile");
  if (caller.id === profile.id) {
    return c.json({ error: { code: "bad_request", message: "Cannot delete yourself" } }, 400);
  }

  await deleteUser(db, profile.id);
  return c.json({ ok: true });
});
