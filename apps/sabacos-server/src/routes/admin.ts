import { Hono } from "hono";
import { z } from "zod";
import {
  badRequest,
  forbidden,
  notFound,
  safeParse,
} from "../errors.js";
import {
  canTransitionOrder,
  createCategorySchema,
  createProductSchema,
  updateCategorySchema,
  updateOrderStatusSchema,
  updateProductSchema,
  updateSettingsSchema,
  productRowSchema,
  categoryRowSchema,
  orderRowSchema,
  type DeliveryConfig,
  type Product,
} from "@sabacos/core";
import { getAppEnv, type AppEnv } from "../env.js";
import type { AdminContext } from "../auth/admin.js";
import { getDb } from "../db/client.js";
import { listProducts, getProductById } from "../db/catalog.js";
import {
  getOrderById,
  getOrderItems,
  getOrderWithItems,
  listOrders,
  updateOrderStatus,
} from "../db/orders.js";
import { getSettings, updateSettings } from "../db/settings.js";
import { notifyAdminChannel, createBot, postProductToChannel } from "../bot/bot.js";
import { aiEnabled, llamaVisionProduct } from "../services/ai.js";
import { r2Config, r2Put, r2Delete } from "../services/r2.js";

export const adminRoutes = new Hono<{ Bindings: AppEnv } & AdminContext>();

// --------------------------------------------------------------- helpers

function toProductRow(body: z.infer<typeof createProductSchema>) {
  return {
    category_id: body.categoryId ?? null,
    sku: body.sku,
    name_en: body.nameEn,
    name_am: body.nameAm,
    description_en: body.descriptionEn ?? "",
    description_am: body.descriptionAm ?? "",
    price_halala: body.priceHalala,
    compare_at_halala: body.compareAtHalala ?? null,
    stock: body.stock ?? 0,
    image_urls: body.imageUrls ?? [],
    is_active: body.isActive ?? true,
    is_featured: body.isFeatured ?? false,
    is_fragile: body.isFragile ?? false,
  };
}

function toProductPatch(body: z.infer<typeof updateProductSchema>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (body.categoryId !== undefined) patch.category_id = body.categoryId;
  if (body.sku !== undefined) patch.sku = body.sku;
  if (body.nameEn !== undefined) patch.name_en = body.nameEn;
  if (body.nameAm !== undefined) patch.name_am = body.nameAm;
  if (body.descriptionEn !== undefined) patch.description_en = body.descriptionEn;
  if (body.descriptionAm !== undefined) patch.description_am = body.descriptionAm;
  if (body.priceHalala !== undefined) patch.price_halala = body.priceHalala;
  if (body.compareAtHalala !== undefined) patch.compare_at_halala = body.compareAtHalala;
  if (body.stock !== undefined) patch.stock = body.stock;
  if (body.imageUrls !== undefined) patch.image_urls = body.imageUrls;
  if (body.isActive !== undefined) patch.is_active = body.isActive;
  if (body.isFeatured !== undefined) patch.is_featured = body.isFeatured;
  if (body.isFragile !== undefined) patch.is_fragile = body.isFragile;
  return patch;
}

function toCategoryRow(body: z.infer<typeof createCategorySchema>) {
  return {
    slug: body.slug,
    name_en: body.nameEn,
    name_am: body.nameAm,
    sort_order: body.sortOrder ?? 0,
    is_active: body.isActive ?? true,
  };
}

function toCategoryPatch(body: z.infer<typeof updateCategorySchema>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (body.slug !== undefined) patch.slug = body.slug;
  if (body.nameEn !== undefined) patch.name_en = body.nameEn;
  if (body.nameAm !== undefined) patch.name_am = body.nameAm;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
  if (body.isActive !== undefined) patch.is_active = body.isActive;
  return patch;
}

// ----------------------------------------------------------------- stats

adminRoutes.get("/stats", async (c) => {
  const db = getDb(getAppEnv());

  const [paidOrders, allOrders, lowStock, recent] = await Promise.all([
    db.from("orders").select("total_halala, created_at").eq("payment_status", "success"),
    db.from("orders").select("status, created_at"),
    db
      .from("products")
      .select("id, name_en, stock")
      .eq("is_active", true)
      .lte("stock", 5),
    db
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  if (paidOrders.error) throw new Error(`stats paidOrders: ${paidOrders.error.message}`);
  if (allOrders.error) throw new Error(`stats allOrders: ${allOrders.error.message}`);
  if (lowStock.error) throw new Error(`stats lowStock: ${lowStock.error.message}`);
  if (recent.error) throw new Error(`stats recent: ${recent.error.message}`);

  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  const totalRevenue = (paidOrders.data ?? []).reduce(
    (sum, o) => sum + (o.total_halala as number),
    0,
  );
  const todayRevenue = (paidOrders.data ?? []).reduce(
    (sum, o) =>
      sum + (new Date(o.created_at as string).getTime() >= dayStartMs ? (o.total_halala as number) : 0),
    0,
  );

  const statusCounts = new Map<string, number>();
  for (const o of allOrders.data ?? []) {
    statusCounts.set(o.status as string, (statusCounts.get(o.status as string) ?? 0) + 1);
  }

  const totalOrders = (allOrders.data ?? []).length;
  const todayOrders = (allOrders.data ?? []).filter(
    (o) => new Date(o.created_at as string).getTime() >= dayStartMs,
  ).length;

  const recentOrders = (recent.data ?? []).map((row) => orderRowSchema.parse(row));

  return c.json({
    stats: {
      totalRevenue,
      todayRevenue,
      totalOrders,
      todayOrders,
      orderCounts: Object.fromEntries(statusCounts),
      lowStock: (lowStock.data ?? []).map((p) => ({
        id: p.id,
        name: p.name_en,
        stock: p.stock,
      })),
      recentOrders,
      generatedAt: new Date(now).toISOString(),
    },
  });
});

// -------------------------------------------------------------- products

adminRoutes.get("/products", async (c) => {
  const db = getDb(getAppEnv());
  const { q, category, page, pageSize } = c.req.query();
  const result = await listProducts(db, {
    search: q ?? null,
    categoryId: category ?? null,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    includeInactive: true,
  });
  return c.json(result);
});

adminRoutes.get("/products/:id", async (c) => {
  const db = getDb(getAppEnv());
  const product = await getProductById(db, c.req.param("id"), true);
  if (!product) throw notFound();
  return c.json({ product });
});

adminRoutes.post("/products", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const body = await c.req.json().catch(() => null);
  const input = safeParse(createProductSchema, body);

  const { data, error } = await db
    .from("products")
    .insert(toProductRow(input))
    .select("*")
    .single();
  if (error) throw new Error(`create product: ${error.message}`);

  const product = productRowSchema.parse(data);

  // Post to the channel in the background (don't block the response).
  postProductToChannel(env, {
    id: product.id,
    nameEn: product.nameEn,
    nameAm: product.nameAm,
    descriptionEn: product.descriptionEn,
    descriptionAm: product.descriptionAm,
    priceHalala: product.priceHalala,
    imageUrls: product.imageUrls,
  }).catch(() => undefined);

  return c.json({ product }, 201);
});

adminRoutes.patch("/products/:id", async (c) => {
  const db = getDb(getAppEnv());
  const id = c.req.param("id");
  const existing = await getProductById(db, id, true);
  if (!existing) throw notFound();

  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateProductSchema, body);

  const { data, error } = await db
    .from("products")
    .update(toProductPatch(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`update product: ${error.message}`);
  return c.json({ product: productRowSchema.parse(data) });
});

adminRoutes.delete("/products/:id", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const id = c.req.param("id");
  const existing = await getProductById(db, id, true);
  if (!existing) throw notFound();

  const { error } = await db.from("products").delete().eq("id", id);
  if (error) throw new Error(`delete product: ${error.message}`);

  const r2 = r2Config(env);
  for (const url of existing.imageUrls) {
    if (r2 && url.startsWith(`${r2.publicBase}/`)) {
      await r2Delete(r2, url.slice(r2.publicBase.length + 1)).catch(() => {});
      continue;
    }
    const match = url.match(/\/product-images\/(.+)$/);
    if (match?.[1]) {
      await db.storage.from("product-images").remove([match[1]]).catch(() => {});
    }
  }
  return c.json({ ok: true });
});

/** Stores an image in Cloudflare R2 when configured, else Supabase Storage. */
async function storeImage(
  env: AppEnv,
  db: ReturnType<typeof getDb>,
  key: string,
  file: File,
): Promise<string> {
  const r2 = r2Config(env);
  if (r2) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await r2Put(r2, key, bytes, file.type || "image/jpeg");
    } catch (err) {
      console.error("[r2] upload failed, falling back to Supabase:", err);
    }
  }
  const { error } = await db.storage
    .from("product-images")
    .upload(key, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw new Error(`upload image: ${error.message}`);
  const { data } = db.storage.from("product-images").getPublicUrl(key);
  return data.publicUrl;
}

adminRoutes.post("/products/:id/images", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const id = c.req.param("id");
  const product = await getProductById(db, id, true);
  if (!product) throw notFound();

  const form = await c.req.formData();
  const files = form.getAll("images") as File[];
  if (files.length === 0) throw badRequest("No images uploaded");

  const uploaded: string[] = [];
  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;
    const clean = String(file.name ?? "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
    const path = `products/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${clean}`;
    uploaded.push(await storeImage(env, db, path, file));
  }

  const urls = [...product.imageUrls, ...uploaded];
  const { data, error } = await db
    .from("products")
    .update({ image_urls: urls })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`attach image: ${error.message}`);
  return c.json({ product: productRowSchema.parse(data) });
});

// ------------------------------------------------------------- categories

adminRoutes.get("/categories", async (c) => {
  const db = getDb(getAppEnv());
  const { data, error } = await db
    .from("categories")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`list categories: ${error.message}`);
  return c.json({ categories: (data ?? []).map((row) => categoryRowSchema.parse(row)) });
});

adminRoutes.post("/categories", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(createCategorySchema, body);
  const { data, error } = await db
    .from("categories")
    .insert(toCategoryRow(input))
    .select("*")
    .single();
  if (error) throw new Error(`create category: ${error.message}`);
  return c.json({ category: categoryRowSchema.parse(data) }, 201);
});

adminRoutes.patch("/categories/:id", async (c) => {
  const db = getDb(getAppEnv());
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateCategorySchema, body);
  const { data, error } = await db
    .from("categories")
    .update(toCategoryPatch(input))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`update category: ${error.message}`);
  return c.json({ category: categoryRowSchema.parse(data) });
});

adminRoutes.delete("/categories/:id", async (c) => {
  const db = getDb(getAppEnv());
  const { error } = await db.from("categories").delete().eq("id", c.req.param("id"));
  if (error) throw new Error(`delete category: ${error.message}`);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- orders

adminRoutes.get("/orders", async (c) => {
  const db = getDb(getAppEnv());
  const { status, page, pageSize } = c.req.query();
  const result = await listOrders(db, {
    status: status as never,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  });
  return c.json(result);
});

adminRoutes.get("/orders/:id", async (c) => {
  const db = getDb(getAppEnv());
  const order = await getOrderWithItems(db, c.req.param("id"));
  if (!order) throw notFound();
  return c.json({ order });
});

adminRoutes.patch("/orders/:id/status", async (c) => {
  const db = getDb(getAppEnv());
  const id = c.req.param("id");
  const order = await getOrderById(db, id);
  if (!order) throw notFound();

  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateOrderStatusSchema, body);

  if (!canTransitionOrder(order.status, input.status)) {
    throw badRequest(`Cannot transition order from ${order.status} to ${input.status}`);
  }

  const updated = await updateOrderStatus(db, id, input.status);
  if (!updated) throw notFound();

  await notifyAdminChannel(
    getAppEnv(),
    `Order ${updated.orderNo} → *${updated.status.toUpperCase()}*`,
  );

  return c.json({ order: updated });
});

// --------------------------------------------------------------- settings

adminRoutes.get("/settings", async (c) => {
  const db = getDb(getAppEnv());
  const settings = await getSettings(db, true);
  return c.json({ settings });
});

adminRoutes.put("/settings", async (c) => {
  const db = getDb(getAppEnv());
  const body = await c.req.json().catch(() => null);
  const input = safeParse(updateSettingsSchema, body);
  const settings = await updateSettings(db, {
    deliveryFeeHalala: input.delivery_fee_halala,
    freeDeliveryThresholdHalala: input.free_delivery_threshold_halala,
    shopNameEn: input.shop_name_en,
    shopNameAm: input.shop_name_am,
    shopPhone: input.shop_phone,
    adminChannelId: input.admin_channel_id,
    deliveryConfig: (input.delivery_config as DeliveryConfig | undefined) ?? undefined,
  });
  return c.json({ settings });
});

// --------------------------------------------------------------- broadcast

const broadcastSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    imageUrl: z.string().trim().url().optional(),
    buttonText: z.string().trim().min(1).max(64).optional(),
    buttonUrl: z.string().trim().url().optional(),
  })
  .refine((v) => v.buttonUrl === undefined || v.buttonText !== undefined, {
    message: "buttonText is required when buttonUrl is set",
  });

adminRoutes.get("/broadcast/audience", async (c) => {
  const db = getDb(getAppEnv());
  const { count, error } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("telegram_id", "is", null);
  if (error) throw new Error(`broadcast audience: ${error.message}`);
  return c.json({ count: count ?? 0 });
});

adminRoutes.post("/broadcast", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const input = safeParse(broadcastSchema, await c.req.json().catch(() => null));

  const bot = createBot(env);
  const replyMarkup =
    input.buttonUrl && input.buttonText
      ? { inline_keyboard: [[{ text: input.buttonText, url: input.buttonUrl }]] }
      : undefined;

  let sent = 0;
  let failed = 0;
  const PAGE = 200;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("profiles")
      .select("telegram_id")
      .not("telegram_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`broadcast fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      try {
        if (input.imageUrl) {
          await bot.api.sendPhoto(row.telegram_id as string, input.imageUrl, {
            caption: input.text.slice(0, 1024),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        } else {
          await bot.api.sendMessage(row.telegram_id as string, input.text, {
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          });
        }
        sent += 1;
      } catch {
        failed += 1;
      }
      // Stay well under Telegram's ~30 msg/sec global limit.
      await new Promise((r) => setTimeout(r, 50));
    }
    if (data.length < PAGE) break;
  }
  return c.json({ sent, failed });
});

// --------------------------------------------------------------- ai product draft

adminRoutes.post("/ai/product-image", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const form = await c.req.parseBody();
  const file = form["image"];
  if (!(file instanceof File)) throw badRequest("image file required");
  if (file.size > 10 * 1024 * 1024) throw badRequest("Image too large (max 10MB)");

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "photo.jpg";
  const path = `ai/${Date.now()}-${safeName}`;
  const url = await storeImage(env, db, path, file);

  let draft = null;
  if (aiEnabled(env)) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const mime = file.type || "image/jpeg";
      draft = await llamaVisionProduct(env, `data:${mime};base64,${bytes.toString("base64")}`);
    } catch (err) {
      console.error("[ai] product draft failed:", err);
    }
  }
  return c.json({ url, draft });
});