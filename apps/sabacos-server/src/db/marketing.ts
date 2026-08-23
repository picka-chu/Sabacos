import type { Db } from "./client.js";

export interface TopCategory {
  categoryId: string;
  views: number;
}

export async function logProductView(
  db: Db,
  profileId: string,
  productId: string,
  categoryId: string | null,
): Promise<void> {
  const { error } = await db.from("product_views").insert({
    profile_id: profileId,
    product_id: productId,
    category_id: categoryId,
  });
  if (error) throw new Error(`logProductView: ${error.message}`);
}

export async function topCategories(db: Db, profileId: string, days = 14, limit = 3): Promise<TopCategory[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("product_views")
    .select("category_id")
    .eq("profile_id", profileId)
    .gte("created_at", since)
    .not("category_id", "is", null);
  if (error) throw new Error(`topCategories: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (row.category_id == null) continue;
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([categoryId, views]) => ({ categoryId, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export interface DiscountCandidate {
  id: string;
  nameEn: string;
  nameAm: string;
  priceHalala: number;
  compareAtHalala: number | null;
  imageUrl: string | null;
  categoryId: string | null;
  updatedAt: string;
}

function mapCandidate(row: Record<string, unknown>): DiscountCandidate {
  const images = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : [];
  return {
    id: row.id as string,
    nameEn: row.name_en as string,
    nameAm: (row.name_am as string) ?? "",
    priceHalala: row.price_halala as number,
    compareAtHalala: (row.compare_at_halala as number | null) ?? null,
    imageUrl: images[0] ?? null,
    categoryId: (row.category_id as string | null) ?? null,
    updatedAt: row.updated_at as string,
  };
}

const CANDIDATE_COLUMNS =
  "id, name_en, name_am, price_halala, compare_at_halala, image_urls, category_id, updated_at";

export async function discountedProducts(
  db: Db,
  opts: { since?: string | null; categoryIds?: string[]; limit?: number } = {},
): Promise<DiscountCandidate[]> {
  let query = db
    .from("products")
    .select(CANDIDATE_COLUMNS)
    .eq("is_active", true)
    .not("compare_at_halala", "is", null)
    .gt("compare_at_halala", 0)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.since) query = query.gte("updated_at", opts.since);
  if (opts.categoryIds && opts.categoryIds.length > 0) {
    query = query.in("category_id", opts.categoryIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(`discountedProducts: ${error.message}`);
  return (data ?? [])
    .map(mapCandidate)
    .filter((p) => p.compareAtHalala != null && p.compareAtHalala > p.priceHalala);
}

export async function anyPromotableProducts(db: Db, limit = 20): Promise<DiscountCandidate[]> {
  const { data, error } = await db
    .from("products")
    .select(CANDIDATE_COLUMNS)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`anyPromotableProducts: ${error.message}`);
  return (data ?? []).map(mapCandidate);
}

export interface NotifyTarget {
  profileId: string;
  telegramId: string;
}

export async function notifyTargetsForCategories(
  db: Db,
  categoryIds: string[],
  excludeProfileIds: string[],
  limit = 200,
): Promise<NotifyTarget[]> {
  const { data: viewerRows, error } = await db
    .from("product_views")
    .select("profile_id")
    .in("category_id", categoryIds.length > 0 ? categoryIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw new Error(`notifyTargetsForCategories(viewers): ${error.message}`);
  const ids = [...new Set((viewerRows ?? []).map((r) => r.profile_id))].filter(
    (id) => !excludeProfileIds.includes(id),
  );
  if (ids.length === 0) return [];
  const capped = ids.slice(0, limit);
  const { data, error: profileErr } = await db
    .from("profiles")
    .select("id, telegram_id")
    .in("id", capped)
    .not("telegram_id", "is", null);
  if (profileErr) throw new Error(`notifyTargetsForCategories(profiles): ${profileErr.message}`);
  return (data ?? []).map((row) => ({ profileId: row.id as string, telegramId: row.telegram_id as string }));
}

export async function notifyTargetsForProfileIds(
  db: Db,
  profileIds: string[],
  excludeProfileIds: string[],
): Promise<NotifyTarget[]> {
  const ids = profileIds.filter((id) => !excludeProfileIds.includes(id));
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("profiles")
    .select("id, telegram_id")
    .in("id", ids)
    .not("telegram_id", "is", null);
  if (error) throw new Error(`notifyTargetsForProfileIds: ${error.message}`);
  return (data ?? []).map((row) => ({ profileId: row.id as string, telegramId: row.telegram_id as string }));
}

export async function recentlyNotifiedProfileIds(db: Db, productId: string, days = 30): Promise<string[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("notify_log")
    .select("profile_id")
    .eq("product_id", productId)
    .gte("sent_at", since);
  if (error) throw new Error(`recentlyNotifiedProfileIds: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.profile_id))];
}

export async function logNotification(
  db: Db,
  profileId: string,
  productId: string,
  kind = "discount",
): Promise<void> {
  const { error } = await db.from("notify_log").upsert(
    { profile_id: profileId, product_id: productId, kind },
    { onConflict: "profile_id,product_id,kind" },
  );
  if (error) throw new Error(`logNotification: ${error.message}`);
}

export async function getJobState<T>(db: Db, key: string): Promise<T | null> {
  const { data, error } = await db.from("job_state").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`getJobState: ${error.message}`);
  return (data?.value as T | undefined) ?? null;
}

export async function setJobState(db: Db, key: string, value: unknown): Promise<void> {
  const { error } = await db
    .from("job_state")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`setJobState: ${error.message}`);
}
