import { Hono } from "hono";
import { z } from "zod";
import { badRequest } from "../errors.js";
import { getAppEnv, type AppEnv } from "../env.js";
import { requireUser, type UserContext } from "../auth/telegram.js";
import { getDb } from "../db/client.js";
import {
  getWaitlistConfig,
  getWaitlistEntryByProfile,
  joinWaitlist,
  getTotalDiscountForProfile,
} from "../db/waitlist.js";

export const waitlistRoutes = new Hono<{ Bindings: AppEnv } & UserContext>();

waitlistRoutes.use("*", requireUser);

// Check if the current user is on the waitlist and their discount status.
waitlistRoutes.get("/status", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const config = await getWaitlistConfig(db).catch(() => null);
  if (!config) return c.json({ config: null, entry: null, discount: 0 });

  const entry = await getWaitlistEntryByProfile(db, profile.id);
  const discount = entry ? await getTotalDiscountForProfile(db, profile.id) : 0;

  return c.json({
    config: {
      isActive: config.isActive,
      discountPercent: config.discountPercent,
      earlyBirdLimit: config.earlyBirdLimit,
      deadline: config.deadline,
      referralBonusPercent: config.referralBonusPercent,
      discountGracePeriodDays: config.discountGracePeriodDays,
    },
    entry: entry
      ? {
          position: entry.position,
          isEarlyBird: entry.isEarlyBird,
          referralCode: entry.referralCode,
          status: entry.status,
          createdAt: entry.createdAt,
        }
      : null,
    discount,
  });
});

// Join the waitlist (with optional referral code).
waitlistRoutes.post("/join", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const config = await getWaitlistConfig(db);

  if (!config.isActive) throw badRequest("Waitlist is not currently accepting new members");
  if (config.deadline && new Date(config.deadline) < new Date()) {
    throw badRequest("Waitlist registration has closed");
  }

  const body = await c.req.json().catch(() => null as { referralCode?: string } | null);
  const referralCode =
    typeof body?.referralCode === "string"
      ? body.referralCode.trim().toUpperCase().slice(0, 16)
      : null;

  const entry = await joinWaitlist(db, profile.id, referralCode);
  const discount = await getTotalDiscountForProfile(db, profile.id);

  return c.json({
    entry: {
      position: entry.position,
      isEarlyBird: entry.isEarlyBird,
      referralCode: entry.referralCode,
      status: entry.status,
    },
    discount,
  }, 201);
});

// Get the user's referral code (requires already being on the waitlist).
waitlistRoutes.get("/referral", async (c) => {
  const db = getDb(getAppEnv());
  const profile = c.get("profile");
  const entry = await getWaitlistEntryByProfile(db, profile.id);
  if (!entry) throw badRequest("You are not on the waitlist");
  return c.json({
    referralCode: entry.referralCode,
    referralLink: `https://t.me/${(c.req.header("x-bot-username") ?? "sabacos_bot")}?start=ref_${entry.referralCode}`,
  });
});
