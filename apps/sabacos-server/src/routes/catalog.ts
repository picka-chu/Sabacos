import { Hono } from "hono";
import { safeParse } from "../errors.js";
import { z } from "zod";
import { getAppEnv, type AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { listActiveCategories, listProducts, getProductById } from "../db/catalog.js";
import { attachPromos, getActiveDiscounts } from "../db/discounts.js";

export const catalogRoutes = new Hono<{ Bindings: AppEnv }>();

catalogRoutes.get("/categories", async (c) => {
  const db = getDb(getAppEnv());
  const categories = await listActiveCategories(db);
  return c.json({ categories });
});

const productListQuerySchema = z.object({
  category: z.string().optional(),
  featured: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  q: z.string().optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

catalogRoutes.get("/products", async (c) => {
  const db = getDb(getAppEnv());
  const query = safeParse(productListQuerySchema, c.req.query());
  const isUuid = z.uuid().safeParse(query.category).success;
  const page = await listProducts(db, {
    categoryId: isUuid ? query.category ?? null : null,
    categorySlug: isUuid ? null : query.category ?? null,
    featured: query.featured,
    search: query.q ?? null,
    sort: query.sort ?? null,
    minPriceHalala:
      query.minPrice != null ? Math.round(query.minPrice * 100) : null,
    maxPriceHalala:
      query.maxPrice != null ? Math.round(query.maxPrice * 100) : null,
    page: query.page,
    pageSize: query.pageSize,
  });
  const discounts = await getActiveDiscounts(db);
  return c.json({ ...page, items: attachPromos(page.items, discounts) });
});

catalogRoutes.get("/products/:id", async (c) => {
  const db = getDb(getAppEnv());
  const product = await getProductById(db, c.req.param("id"));
  if (!product) return c.json({ error: { code: "not_found", message: "Product not found" } }, 404);
  const discounts = await getActiveDiscounts(db);
  return c.json({ product: attachPromos([product], discounts)[0] });
});