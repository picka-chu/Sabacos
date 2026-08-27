import type { Product, ProductPromo } from "@sabacos/core";
import type { Db } from "./client.js";

export type DiscountScope = "all" | "category" | "products";
export type DiscountType = "percent" | "fixed";

export interface Discount {
  id: string;
  name: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  scope: DiscountScope;
  categoryId: string | null;
  productIds: string[];
  minSubtotalHalala: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapDiscountRow(row: Record<string, unknown>): Discount {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    discountType: row.discount_type as DiscountType,
    discountValue: Number(row.discount_value),
    scope: row.scope as DiscountScope,
    categoryId: (row.category_id as string) ?? null,
    productIds: (row.product_ids as string[]) ?? [],
    minSubtotalHalala: (row.min_subtotal_halala as number) ?? null,
    startsAt: (row.starts_at as string) ?? null,
    endsAt: (row.ends_at as string) ?? null,
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toRow(d: Partial<Discount>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (d.name !== undefined) row.name = d.name;
  if (d.description !== undefined) row.description = d.description;
  if (d.discountType !== undefined) row.discount_type = d.discountType;
  if (d.discountValue !== undefined) row.discount_value = d.discountValue;
  if (d.scope !== undefined) row.scope = d.scope;
  if (d.categoryId !== undefined) row.category_id = d.categoryId;
  if (d.productIds !== undefined) row.product_ids = d.productIds;
  if (d.minSubtotalHalala !== undefined) row.min_subtotal_halala = d.minSubtotalHalala;
  if (d.startsAt !== undefined) row.starts_at = d.startsAt;
  if (d.endsAt !== undefined) row.ends_at = d.endsAt;
  if (d.isActive !== undefined) row.is_active = d.isActive;
  return row;
}

// ---------------------------------------------------------------- queries

export async function listDiscounts(db: Db): Promise<Discount[]> {
  const { data, error } = await db
    .from("discounts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listDiscounts: ${error.message}`);
  return (data ?? []).map((row) => mapDiscountRow(row as Record<string, unknown>));
}

export async function getDiscountById(db: Db, id: string): Promise<Discount | null> {
  const { data, error } = await db.from("discounts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getDiscountById: ${error.message}`);
  return data ? mapDiscountRow(data as Record<string, unknown>) : null;
}

/** Discounts that are enabled and currently inside their date window. */
export async function getActiveDiscounts(db: Db): Promise<Discount[]> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("discounts")
    .select("*")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getActiveDiscounts: ${error.message}`);
  return (data ?? []).map((row) => mapDiscountRow(row as Record<string, unknown>));
}

export async function createDiscount(db: Db, d: Partial<Discount>): Promise<Discount> {
  const { data, error } = await db
    .from("discounts")
    .insert(toRow(d))
    .select("*")
    .single();
  if (error) throw new Error(`createDiscount: ${error.message}`);
  return mapDiscountRow(data as Record<string, unknown>);
}

export async function updateDiscount(db: Db, id: string, patch: Partial<Discount>): Promise<Discount> {
  const { data, error } = await db
    .from("discounts")
    .update(toRow(patch))
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateDiscount: ${error.message}`);
  return mapDiscountRow(data as Record<string, unknown>);
}

export async function deleteDiscount(db: Db, id: string): Promise<void> {
  const { error } = await db.from("discounts").delete().eq("id", id);
  if (error) throw new Error(`deleteDiscount: ${error.message}`);
}

// ------------------------------------------------------------- computation

function effectivePrice(priceHalala: number, d: Discount): number {
  if (d.discountType === "percent") {
    return Math.round((priceHalala * (100 - d.discountValue)) / 100);
  }
  return Math.max(0, priceHalala - Math.round(d.discountValue * 100));
}

function isEligible(d: Discount, product: Product, orderSubtotalHalala: number | null): boolean {
  if (d.minSubtotalHalala != null && orderSubtotalHalala != null) {
    if (orderSubtotalHalala < d.minSubtotalHalala) return false;
  }
  if (d.scope === "category") {
    return product.categoryId != null && product.categoryId === d.categoryId;
  }
  if (d.scope === "products") {
    return d.productIds.includes(product.id);
  }
  return true;
}

/**
 * Best promotion for a single product for display purposes. The order-level
 * minimum-subtotal constraint is not applied here (we use a huge stand-in) so
 * badges show whenever the discount exists; checkout applies the real check.
 */
export function promoForProduct(product: Product, discounts: Discount[]): ProductPromo | null {
  let best: { saveHalala: number; saleHalala: number; endsAt: string | null } | null = null;
  for (const d of discounts) {
    if (!isEligible(d, product, Number.MAX_SAFE_INTEGER)) continue;
    const sale = effectivePrice(product.priceHalala, d);
    const save = product.priceHalala - sale;
    if (save <= 0) continue;
    if (!best || save > best.saveHalala) {
      best = { saveHalala: save, saleHalala: sale, endsAt: d.endsAt };
    }
  }
  if (!best) return null;
  const percent = product.priceHalala > 0 ? Math.round((best.saveHalala / product.priceHalala) * 100) : 0;
  return { percent: Math.max(1, percent), salePriceHalala: best.saleHalala, endsAt: best.endsAt };
}

export interface PromotionLine {
  label: string;
  discountHalala: number;
}

export interface PromotionOrderDiscount {
  totalDiscountHalala: number;
  effectiveSubtotalHalala: number;
  /** Effective combined % off the original subtotal, for the invoice line label. */
  percent: number;
  lines: PromotionLine[];
}

/**
 * Compute the promotion discount for an order. Each item receives at most the
 * best single applicable discount; promotion discounts never stack with each
 * other (the waitlist discount stacks separately in checkout).
 */
export function computePromotionOrderDiscount(
  items: { product: Product; qty: number }[],
  discounts: Discount[],
  orderSubtotalHalala: number,
): PromotionOrderDiscount {
  if (discounts.length === 0 || items.length === 0) {
    return { totalDiscountHalala: 0, effectiveSubtotalHalala: orderSubtotalHalala, percent: 0, lines: [] };
  }

  const perDiscount: Map<string, PromotionLine> = new Map();
  let total = 0;

  for (const item of items) {
    const { product, qty } = item;
    let best: { d: Discount; save: number } | null = null;
    for (const d of discounts) {
      if (!isEligible(d, product, orderSubtotalHalala)) continue;
      const sale = effectivePrice(product.priceHalala, d);
      const save = (product.priceHalala - sale) * qty;
      if (save <= 0) continue;
      if (!best || save > best.save) best = { d, save };
    }
    if (best) {
      total += best.save;
      const existing = perDiscount.get(best.d.id);
      const amount = (existing?.discountHalala ?? 0) + best.save;
      const label = percentLabel(best.d, best.d.discountType === "percent" ? best.d.discountValue : effectivePercent(product.priceHalala, best.d));
      perDiscount.set(best.d.id, { label, discountHalala: amount });
    }
  }

  const lines = [...perDiscount.values()];
  const percent = orderSubtotalHalala > 0 ? Math.round((total / orderSubtotalHalala) * 100) : 0;
  return {
    totalDiscountHalala: total,
    effectiveSubtotalHalala: orderSubtotalHalala - total,
    percent,
    lines,
  };
}

function effectivePercent(priceHalala: number, d: Discount): number {
  if (priceHalala <= 0) return 0;
  const sale = effectivePrice(priceHalala, d);
  return Math.round(((priceHalala - sale) / priceHalala) * 100);
}

function percentLabel(d: Discount, percent: number): string {
  if (d.discountType === "percent") {
    return `${d.name} (-${percent}%)`;
  }
  return `${d.name} (${d.discountValue} ETB off)`;
}

/** Attach promo info to an array of products (display enrichment). */
export function attachPromos(products: Product[], discounts: Discount[]): Product[] {
  if (discounts.length === 0) return products;
  return products.map((p) => ({ ...p, promo: promoForProduct(p, discounts) }));
}