import { Hono } from "hono";
import { z } from "zod";
import { badRequest, safeParse } from "../errors.js";
import { getAppEnv, type AppEnv } from "../env.js";
import type { AdminContext } from "../auth/admin.js";
import { getDb } from "../db/client.js";
import {
  getWaitlistConfig,
  updateWaitlistConfig,
  listWaitlistEntries,
  getWaitlistStats,
  setWaitlistDiscountGracePeriod,
} from "../db/waitlist.js";

export const waitlistAdminRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

// ---- config

waitlistAdminRoutes.get("/config", async (c) => {
  const db = getDb(getAppEnv());
  const config = await getWaitlistConfig(db);
  return c.json({ config });
});

const updateConfigSchema = z.object({
  isActive: z.boolean().optional(),
  discountPercent: z.number().int().min(1).max(100).optional(),
  earlyBirdLimit: z.number().int().min(1).max(100000).optional(),
  deadline: z.string().nullable().optional(),
  referralBonusPercent: z.number().int().min(0).max(50).optional(),
  maxReferralDiscount: z.number().int().min(0).max(100).optional(),
  discountGracePeriodDays: z.number().int().min(0).max(365).optional(),
});

waitlistAdminRoutes.put("/config", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateConfigSchema, body);

  const previous = await getWaitlistConfig(db);

  const config = await updateWaitlistConfig(db, {
    isActive: input.isActive ?? undefined,
    discountPercent: input.discountPercent ?? undefined,
    earlyBirdLimit: input.earlyBirdLimit ?? undefined,
    deadline: input.deadline !== undefined ? input.deadline : undefined,
    referralBonusPercent: input.referralBonusPercent ?? undefined,
    maxReferralDiscount: input.maxReferralDiscount ?? undefined,
    discountGracePeriodDays: input.discountGracePeriodDays ?? undefined,
  });

  // Shop launch: waitlist turned off. Give members a grace period after the
  // launch date to use their discounts before they expire.
  if (previous.isActive && !config.isActive) {
    await setWaitlistDiscountGracePeriod(db, config.discountGracePeriodDays);
  }

  return c.json({ config });
});

// ---- entries

waitlistAdminRoutes.get("/entries", async (c) => {
  const db = getDb(getAppEnv());
  const { page, pageSize, search } = c.req.query();
  const result = await listWaitlistEntries(db, {
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    search: search ?? undefined,
  });
  return c.json(result);
});

// ---- stats

waitlistAdminRoutes.get("/stats", async (c) => {
  const db = getDb(getAppEnv());
  const [stats, config] = await Promise.all([
    getWaitlistStats(db),
    getWaitlistConfig(db),
  ]);
  return c.json({ stats, config });
});
