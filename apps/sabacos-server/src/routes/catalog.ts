import { Hono } from "hono";
import { safeParse } from "../errors.js";
import { z } from "zod";
import type { AppEnv } from "../env.js";
import { getDb } from "../db/client.js";
import { listActiveCategories, listProducts, getProductById } from "../db/catalog.js";

export const catalogRoutes = new Hono<{ Bindings: AppEnv }>();

catalogRoutes.get("/categories", async (c) => {
  const db = getDb(c.env);
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
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

catalogRoutes.get("/products", async (c) => {
  const db = getDb(c.env);
  const query = safeParse(productListQuerySchema, c.req.query());
  const isUuid = z.uuid().safeParse(query.category).success;
  const page = await listProducts(db, {
    categoryId: isUuid ? query.category ?? null : null,
    categorySlug: isUuid ? null : query.category ?? null,
    featured: query.featured,
    search: query.q ?? null,
    page: query.page,
    pageSize: query.pageSize,
  });
  return c.json(page);
});

catalogRoutes.get("/products/:id", async (c) => {
  const db = getDb(c.env);
  const product = await getProductById(db, c.req.param("id"));
  if (!product) return c.json({ error: { code: "not_found", message: "Product not found" } }, 404);
  return c.json({ product });
});