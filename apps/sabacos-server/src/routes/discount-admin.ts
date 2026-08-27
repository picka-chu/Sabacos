import { Hono } from "hono";
import { z } from "zod";
import { badRequest, notFound, safeParse } from "../errors.js";
import { getAppEnv, type AppEnv } from "../env.js";
import type { AdminContext } from "../auth/admin.js";
import { getDb } from "../db/client.js";
import {
  createDiscount,
  deleteDiscount,
  getDiscountById,
  listDiscounts,
  updateDiscount,
} from "../db/discounts.js";

export const discountAdminRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

const discountSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional().default(""),
  discountType: z.enum(["percent", "fixed"]),
  discountValue: z.number().positive(),
  scope: z.enum(["all", "category", "products"]),
  categoryId: z.string().nullable().optional(),
  productIds: z.array(z.string()).optional(),
  minSubtotalHalala: z.number().int().min(0).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

function validateDiscount(input: z.infer<typeof discountSchema>) {
  if (input.discountType === "percent" && input.discountValue > 100) {
    throw badRequest("Percentage discount cannot exceed 100%");
  }
  if (input.scope === "category" && !input.categoryId) {
    throw badRequest("Pick a category for a category discount");
  }
  if (input.scope === "products" && (!input.productIds || input.productIds.length === 0)) {
    throw badRequest("Pick at least one product for a product discount");
  }
  if (input.startsAt && input.endsAt && new Date(input.startsAt) > new Date(input.endsAt)) {
    throw badRequest("Start date must be before the end date");
  }
}

discountAdminRoutes.get("/", async (c) => {
  const db = getDb(getAppEnv());
  const discounts = await listDiscounts(db);
  return c.json({ discounts });
});

discountAdminRoutes.post("/", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(discountSchema, body);
  validateDiscount(input);
  const discount = await createDiscount(db, {
    ...input,
    categoryId: input.scope === "category" ? input.categoryId ?? null : null,
    productIds: input.scope === "products" ? input.productIds ?? [] : [],
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    minSubtotalHalala: input.minSubtotalHalala ?? null,
  });
  return c.json({ discount }, 201);
});

discountAdminRoutes.patch("/:id", async (c) => {
  const db = getDb(getAppEnv());
  const existing = await getDiscountById(db, c.req.param("id"));
  if (!existing) throw notFound();
  const body = await c.req.json().catch(() => null);
  const input = safeParse(discountSchema.partial(), body);
  validateDiscount({ ...existing, ...input });
  const discount = await updateDiscount(db, existing.id, {
    ...input,
    categoryId: input.scope !== undefined
      ? input.scope === "category" ? input.categoryId ?? null : null
      : existing.scope === "category" ? existing.categoryId : null,
    productIds: input.scope !== undefined
      ? input.scope === "products" ? input.productIds ?? [] : []
      : existing.scope === "products" ? existing.productIds : [],
  });
  return c.json({ discount });
});

discountAdminRoutes.delete("/:id", async (c) => {
  const db = getDb(getAppEnv());
  const existing = await getDiscountById(db, c.req.param("id"));
  if (!existing) throw notFound();
  await deleteDiscount(db, existing.id);
  return c.json({ ok: true });
});