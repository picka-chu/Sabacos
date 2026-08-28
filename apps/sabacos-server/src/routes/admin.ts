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
import { notifyAdminChannel, createBot, postProductToChannel, testAdminChannel } from "../bot/bot.js";
import { aiEnabled, llamaVisionProduct } from "../services/ai.js";
import { r2Config, r2Put, r2Delete } from "../services/r2.js";

const ALLOWED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

// ------------------------------------------------------------- analytics

adminRoutes.get("/analytics", async (c) => {
  const db = getDb(getAppEnv());
  const { range } = c.req.query();
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    totalUsers,
    newUsersWeek,
    newUsersMonth,
    usersByDay,
    totalOrdersAll,
    recentOrders,
    paidOrdersInRange,
    topProductsByViews,
    topCategoriesByViews,
    topCustomers,
    totalViews,
    uniqueViewers,
  ] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", monthAgo),
    db.from("profiles").select("created_at").gte("created_at", since).order("created_at", { ascending: true }),
    db.from("orders").select("id", { count: "exact", head: true }),
    db.from("orders").select("id, created_at, total_halala, status, payment_status").gte("created_at", since).order("created_at", { ascending: true }),
    db.from("orders").select("id, profile_id, total_halala, customer_name").eq("payment_status", "success").gte("created_at", since),
    db.from("product_views").select("product_id").gte("created_at", since),
    db.from("product_views").select("category_id").gte("created_at", since).not("category_id", "is", null),
    db.from("orders").select("profile_id, total_halala, customer_name").eq("payment_status", "success").gte("created_at", since),
    db.from("product_views").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("product_views").select("profile_id").gte("created_at", since),
  ]);

  // Get order items for recent orders
  const recentOrderIds = (recentOrders.data ?? []).map((r) => r.id as string);
  let orderItemsData: Array<Record<string, unknown>> = [];
  if (recentOrderIds.length > 0) {
    // Supabase has a limit on `in` clauses, batch in chunks of 100
    for (let i = 0; i < recentOrderIds.length; i += 100) {
      const chunk = recentOrderIds.slice(i, i + 100);
      const { data } = await db
        .from("order_items")
        .select("order_id, product_id, name_en, name_am, qty, subtotal_halala")
        .in("order_id", chunk);
      if (data) orderItemsData.push(...data);
    }
  }

  // --- user metrics ---
  const totalUserCount = totalUsers.count ?? 0;
  const newUsersWeekCount = newUsersWeek.count ?? 0;
  const newUsersMonthCount = newUsersMonth.count ?? 0;

  const userDayMap = new Map<string, number>();
  for (const row of usersByDay.data ?? []) {
    const day = (row.created_at as string).slice(0, 10);
    userDayMap.set(day, (userDayMap.get(day) ?? 0) + 1);
  }
  const usersByDayArr = [...userDayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- order metrics ---
  const totalOrderCount = totalOrdersAll.count ?? 0;

  const orderDayMap = new Map<string, number>();
  for (const row of recentOrders.data ?? []) {
    const day = (row.created_at as string).slice(0, 10);
    orderDayMap.set(day, (orderDayMap.get(day) ?? 0) + 1);
  }
  const ordersByDayArr = [...orderDayMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- revenue metrics ---
  const totalRevenue = (paidOrdersInRange.data ?? []).reduce(
    (sum, row) => sum + (row.total_halala as number), 0,
  );
  const paidCount = (paidOrdersInRange.data ?? []).length;
  const avgOrderVal = paidCount > 0 ? Math.round(totalRevenue / paidCount) : 0;

  // Derive revenue by day from recentOrders that are paid
  const revenueDayMap = new Map<string, number>();
  const paidOrderIds = new Set((paidOrdersInRange.data ?? []).map((r) => r.id as string));
  for (const row of recentOrders.data ?? []) {
    if (!paidOrderIds.has(row.id as string)) continue;
    const day = (row.created_at as string).slice(0, 10);
    revenueDayMap.set(day, (revenueDayMap.get(day) ?? 0) + (row.total_halala as number));
  }
  const revenueByDayArr = [...revenueDayMap.entries()]
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- product metrics (from order_items) ---
  const productOrderMap = new Map<string, { nameEn: string; nameAm: string; qty: number; revenue: number }>();
  for (const row of orderItemsData) {
    const pid = row.product_id as string;
    if (!pid) continue;
    const existing = productOrderMap.get(pid);
    if (existing) {
      existing.qty += row.qty as number;
      existing.revenue += row.subtotal_halala as number;
    } else {
      productOrderMap.set(pid, {
        nameEn: row.name_en as string,
        nameAm: row.name_am as string,
        qty: row.qty as number,
        revenue: row.subtotal_halala as number,
      });
    }
  }
  const topProductsByOrderArr = [...productOrderMap.entries()]
    .map(([productId, data]) => ({ productId, ...data }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // Top products by views
  const productViewMap = new Map<string, number>();
  for (const row of topProductsByViews.data ?? []) {
    const pid = row.product_id as string;
    productViewMap.set(pid, (productViewMap.get(pid) ?? 0) + 1);
  }
  const topProductsByViewArr = [...productViewMap.entries()]
    .map(([productId, views]) => ({ productId, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const topViewedIds = topProductsByViewArr.map((p) => p.productId);
  let productNames = new Map<string, { nameEn: string; nameAm: string }>();
  if (topViewedIds.length > 0) {
    const { data: nameRows } = await db
      .from("products")
      .select("id, name_en, name_am")
      .in("id", topViewedIds);
    for (const row of nameRows ?? []) {
      productNames.set(row.id as string, {
        nameEn: row.name_en as string,
        nameAm: row.name_am as string,
      });
    }
  }
  const topProductsByViewNamed = topProductsByViewArr.map((p) => ({
    ...p,
    nameEn: productNames.get(p.productId)?.nameEn ?? "",
    nameAm: productNames.get(p.productId)?.nameAm ?? "",
  }));

  // --- category metrics ---
  const categoryViewMap = new Map<string, number>();
  for (const row of topCategoriesByViews.data ?? []) {
    const cid = row.category_id as string;
    categoryViewMap.set(cid, (categoryViewMap.get(cid) ?? 0) + 1);
  }
  const topCatViewArr = [...categoryViewMap.entries()]
    .map(([categoryId, views]) => ({ categoryId, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const topCatIds = topCatViewArr.map((c) => c.categoryId);
  let categoryNames = new Map<string, { nameEn: string; nameAm: string }>();
  if (topCatIds.length > 0) {
    const { data: catRows } = await db
      .from("categories")
      .select("id, name_en, name_am")
      .in("id", topCatIds);
    for (const row of catRows ?? []) {
      categoryNames.set(row.id as string, {
        nameEn: row.name_en as string,
        nameAm: row.name_am as string,
      });
    }
  }
  const topCategoriesByViewNamed = topCatViewArr.map((c) => ({
    ...c,
    nameEn: categoryNames.get(c.categoryId)?.nameEn ?? "",
    nameAm: categoryNames.get(c.categoryId)?.nameAm ?? "",
  }));

  // Category revenue from order_items
  const orderItemProductIds = [...new Set(orderItemsData.map((r) => r.product_id as string).filter(Boolean))];
  let prodToCat = new Map<string, string>();
  if (orderItemProductIds.length > 0) {
    const { data: prodRows } = await db
      .from("products")
      .select("id, category_id")
      .in("id", orderItemProductIds);
    for (const row of prodRows ?? []) {
      if (row.category_id) prodToCat.set(row.id as string, row.category_id as string);
    }
  }
  const catRevenueMap = new Map<string, number>();
  for (const row of orderItemsData) {
    const catId = prodToCat.get(row.product_id as string);
    if (!catId) continue;
    catRevenueMap.set(catId, (catRevenueMap.get(catId) ?? 0) + (row.subtotal_halala as number));
  }
  const topCatRevenueArr = [...catRevenueMap.entries()]
    .map(([categoryId, revenue]) => ({ categoryId, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const topCatRevenueIds = topCatRevenueArr.map((c) => c.categoryId);
  let catRevNames = new Map<string, { nameEn: string; nameAm: string }>();
  if (topCatRevenueIds.length > 0) {
    const { data: catRevRows } = await db
      .from("categories")
      .select("id, name_en, name_am")
      .in("id", topCatRevenueIds);
    for (const row of catRevRows ?? []) {
      catRevNames.set(row.id as string, {
        nameEn: row.name_en as string,
        nameAm: row.name_am as string,
      });
    }
  }
  const topCategoriesByRevenueNamed = topCatRevenueArr.map((c) => ({
    ...c,
    nameEn: catRevNames.get(c.categoryId)?.nameEn ?? "",
    nameAm: catRevNames.get(c.categoryId)?.nameAm ?? "",
  }));

  // --- customer metrics ---
  const customerMap = new Map<string, { name: string; totalSpent: number; orderCount: number }>();
  for (const row of topCustomers.data ?? []) {
    const pid = row.profile_id as string;
    const existing = customerMap.get(pid);
    if (existing) {
      existing.totalSpent += row.total_halala as number;
      existing.orderCount += 1;
    } else {
      customerMap.set(pid, {
        name: row.customer_name as string,
        totalSpent: row.total_halala as number,
        orderCount: 1,
      });
    }
  }
  const topCustomersArr = [...customerMap.entries()]
    .map(([profileId, data]) => ({ profileId, ...data }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  // --- engagement ---
  const totalViewCount = totalViews.count ?? 0;
  const uniqueViewerSet = new Set((uniqueViewers.data ?? []).map((r) => r.profile_id as string));
  const uniqueViewerCount = uniqueViewerSet.size;

  return c.json({
    analytics: {
      range: `${days}d`,
      generatedAt: new Date().toISOString(),
      users: {
        total: totalUserCount,
        newThisWeek: newUsersWeekCount,
        newThisMonth: newUsersMonthCount,
        byDay: usersByDayArr,
      },
      orders: {
        total: totalOrderCount,
        byDay: ordersByDayArr,
      },
      revenue: {
        total: totalRevenue,
        averageOrderValue: avgOrderVal,
        byDay: revenueByDayArr,
      },
      products: {
        topByOrders: topProductsByOrderArr,
        topByViews: topProductsByViewNamed,
      },
      categories: {
        topByViews: topCategoriesByViewNamed,
        topByRevenue: topCategoriesByRevenueNamed,
      },
      customers: {
        top: topCustomersArr,
      },
      engagement: {
        totalViews: totalViewCount,
        uniqueViewers: uniqueViewerCount,
      },
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
    if (file.size > MAX_IMAGE_BYTES) throw badRequest("Image too large (max 10MB)");
    if (file.type && !ALLOWED_IMAGE_MIMES.has(file.type)) {
      throw badRequest(`Unsupported image type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF`);
    }
    const clean = String(file.name ?? "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "image";
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
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) throw badRequest("Invalid order ID");
  const order = await getOrderWithItems(db, id);
  if (!order) throw notFound();
  return c.json({ order });
});

adminRoutes.patch("/orders/:id/status", async (c) => {
  const db = getDb(getAppEnv());
  const id = c.req.param("id");
  if (!z.string().uuid().safeParse(id).success) throw badRequest("Invalid order ID");
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
    `Order ${updated.orderNo} → <b>${updated.status.toUpperCase()}</b>`,
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

// Verify the configured channel before trusting product posts.
adminRoutes.post("/settings/test-channel", async (c) => {
  const env = getAppEnv();
  try {
    const result = await testAdminChannel(env);
    return c.json({ ok: true, channelId: result.channelId });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "Channel test failed");
  }
});

// --------------------------------------------------------------- broadcast

const broadcastSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    imageUrl: z.string().trim().url().optional(),
    buttonText: z.string().trim().min(1).max(64).optional(),
    buttonUrl: z.string().trim().url().optional(),
    dryRun: z.boolean().optional(),
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

  // Count audience first for dry-run.
  const { count: audienceSize } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("telegram_id", "is", null);

  if (input.dryRun) {
    return c.json({
      dryRun: true,
      audienceSize: audienceSize ?? 0,
      text: input.text,
      imageUrl: input.imageUrl ?? null,
    });
  }

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
  return c.json({ sent, failed, audienceSize: audienceSize ?? 0 });
});

// --------------------------------------------------------------- ai product draft

adminRoutes.post("/ai/product-image", async (c) => {
  const env = getAppEnv();
  const db = getDb(env);
  const form = await c.req.parseBody();
  const file = form["image"];
  if (!(file instanceof File)) throw badRequest("image file required");
  if (file.size > MAX_IMAGE_BYTES) throw badRequest("Image too large (max 10MB)");
  if (file.type && !ALLOWED_IMAGE_MIMES.has(file.type)) {
    throw badRequest(`Unsupported image type: ${file.type}. Allowed: JPEG, PNG, WebP, GIF`);
  }

  console.log(`[ai/product-image] Received: ${file.name} (${file.size} bytes, ${file.type})`);

  // Read bytes once — File stream is consumed after first read
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "photo.jpg";
  const path = `ai/${Date.now()}-${safeName}`;

  // Store using the bytes (not the File object) so the stream isn't double-consumed
  const url = await storeImage(env, db, path, new File([bytes], safeName, { type: mime }));

  let draft = null;
  if (aiEnabled(env) || env.GEMINI_API_KEY) {
    try {
      const imageDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
      console.log(`[ai/product-image] Calling vision AI — base64 ~${Math.round(imageDataUrl.length / 1024)}KB`);
      draft = await llamaVisionProduct(env, imageDataUrl);
      if (draft) {
        console.log(`[ai/product-image] Draft OK: "${draft.nameEn}" / "${draft.nameAm}"`);
      } else {
        console.warn("[ai/product-image] Draft returned null — all AI providers failed");
      }
    } catch (err) {
      console.error("[ai/product-image] Unexpected error:", err);
    }
  } else {
    console.log("[ai/product-image] No AI providers configured (CLOUDFLARE or GEMINI_API_KEY)");
  }
  return c.json({ url, draft });
});