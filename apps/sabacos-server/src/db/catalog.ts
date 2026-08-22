import { categoryRowSchema, productRowSchema, type Category, type Product } from "@sabacos/core";
import type { Db } from "./client.js";

export async function listActiveCategories(db: Db): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`listActiveCategories: ${error.message}`);
  return (data ?? []).map((row) => categoryRowSchema.parse(row));
}

export type ProductSort = "newest" | "price_asc" | "price_desc";

export interface ProductQuery {
  categoryId?: string | null;
  featured?: boolean;
  search?: string | null;
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
  categorySlug?: string | null;
  sort?: ProductSort | null;
  minPriceHalala?: number | null;
  maxPriceHalala?: number | null;
}

export interface ProductPage {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listProducts(db: Db, q: ProductQuery = {}): Promise<ProductPage> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 24));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db
    .from("products")
    .select("*", { count: "exact" });

  if (!q.includeInactive) query = query.eq("is_active", true);
  if (q.categoryId) query = query.eq("category_id", q.categoryId);
  if (q.categorySlug) {
    const { data: cat } = await db
      .from("categories")
      .select("id")
      .eq("slug", q.categorySlug)
      .maybeSingle();
    if (!cat) return { items: [], total: 0, page, pageSize };
    query = query.eq("category_id", cat.id);
  }
  if (q.featured) query = query.eq("is_featured", true);
  if (q.search?.trim()) {
    const term = `%${q.search.trim()}%`;
    query = query.or(`name_en.ilike.${term},name_am.ilike.${term}`);
  }
  if (q.minPriceHalala != null) query = query.gte("price_halala", q.minPriceHalala);
  if (q.maxPriceHalala != null) query = query.lte("price_halala", q.maxPriceHalala);

  if (q.sort === "price_asc") {
    query = query.order("price_halala", { ascending: true });
  } else if (q.sort === "price_desc") {
    query = query.order("price_halala", { ascending: false });
  } else {
    query = query
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: false });
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw new Error(`listProducts: ${error.message}`);
  return {
    items: (data ?? []).map((row) => productRowSchema.parse(row)),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function getProductById(db: Db, id: string, includeInactive = false): Promise<Product | null> {
  let query = db.from("products").select("*").eq("id", id);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`getProductById: ${error.message}`);
  return data ? productRowSchema.parse(data) : null;
}

export async function getProductsByIds(db: Db, ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("products").select("*").in("id", ids);
  if (error) throw new Error(`getProductsByIds: ${error.message}`);
  return (data ?? []).map((row) => productRowSchema.parse(row));
}