import { productRowSchema, type CartItem, type CartSummary, type Product } from "@sabacos/core";
import { computeTotals } from "@sabacos/core";
import type { Db } from "./client.js";
import { getSettings } from "./settings.js";
import { attachPromos, computePromotionOrderDiscount, getActiveDiscounts } from "./discounts.js";

interface CartRow {
  id: string;
  profile_id: string;
  product_id: string;
  qty: number;
  created_at: string;
  updated_at: string;
  product: Record<string, unknown> | null;
}

export async function getCart(db: Db, profileId: string): Promise<CartItem[]> {
  const { data, error } = await db
    .from("cart_items")
    .select("id, profile_id, product_id, qty, created_at, updated_at, product:products(*)")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getCart: ${error.message}`);

  const items: CartItem[] = [];
  for (const row of (data ?? []) as unknown as CartRow[]) {
    if (!row.product) continue;
    const product = productRowSchema.parse(row.product);
    items.push({
      id: row.id,
      productId: product.id,
      qty: row.qty,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      product,
    });
  }
  return items;
}

export async function addToCart(db: Db, profileId: string, productId: string, qty: number): Promise<void> {
  const { error } = await db
    .from("cart_items")
    .upsert(
      { profile_id: profileId, product_id: productId, qty },
      { onConflict: "profile_id,product_id" },
    );
  if (error) throw new Error(`addToCart: ${error.message}`);
}

export async function patchCartItem(db: Db, profileId: string, itemId: string, qty: number): Promise<void> {
  const { error } = await db
    .from("cart_items")
    .update({ qty })
    .eq("id", itemId)
    .eq("profile_id", profileId);
  if (error) throw new Error(`patchCartItem: ${error.message}`);
}

export async function removeCartItem(db: Db, profileId: string, itemId: string): Promise<void> {
  const { error } = await db
    .from("cart_items")
    .delete()
    .eq("id", itemId)
    .eq("profile_id", profileId);
  if (error) throw new Error(`removeCartItem: ${error.message}`);
}

export async function clearCart(db: Db, profileId: string): Promise<void> {
  const { error } = await db.from("cart_items").delete().eq("profile_id", profileId);
  if (error) throw new Error(`clearCart: ${error.message}`);
}

export async function getCartSummary(db: Db, profileId: string): Promise<CartSummary> {
  const items = await getCart(db, profileId);
  const settings = await getSettings(db);
  const discounts = await getActiveDiscounts(db);

  // Enrich items with the best active promotion and compute discounted totals
  // so the cart matches what checkout will charge.
  const promoById = new Map<string, Product["promo"]>();
  if (discounts.length > 0) {
    for (const p of attachPromos(items.map((i) => i.product), discounts)) {
      promoById.set(p.id, p.promo ?? null);
    }
  }
  const enriched: CartItem[] = items.map((i) => ({
    ...i,
    product: { ...i.product, promo: promoById.get(i.product.id) ?? null },
  }));

  const originalSubtotal = enriched.reduce(
    (s, i) => s + i.product.priceHalala * i.qty,
    0,
  );
  const promo = computePromotionOrderDiscount(enriched, discounts, originalSubtotal);

  const totals = computeTotals(
    enriched.map((i) => ({
      priceHalala: i.product.promo?.salePriceHalala ?? i.product.priceHalala,
      qty: i.qty,
    })),
    settings.deliveryFeeHalala,
    settings.freeDeliveryThresholdHalala,
  );

  return {
    items: enriched,
    itemCount: enriched.reduce((n, i) => n + i.qty, 0),
    totals,
    deliveryFeeHalala: settings.deliveryFeeHalala,
    freeDeliveryThresholdHalala: settings.freeDeliveryThresholdHalala,
    discountHalala: promo.totalDiscountHalala,
    discountLabel: promo.totalDiscountHalala > 0
      ? promo.lines.length === 1 ? promo.lines[0]?.label ?? "Promo"
        : promo.lines.length > 1 ? `${promo.lines.length} promotions`
        : `Promo (-${promo.percent}%)`
      : null,
  };
}

export function reconcileCartQuantities(items: CartItem[]): {
  items: CartItem[];
  products: Product[];
} {
  const available = new Map<string, Product>();
  const cleaned: CartItem[] = [];
  for (const item of items) {
    const product = item.product;
    if (!product.isActive) continue;
    available.set(product.id, product);
    const qty = Math.min(item.qty, Math.max(0, product.stock));
    if (qty > 0) cleaned.push({ ...item, qty });
  }
  return { items: cleaned, products: [...available.values()] };
}