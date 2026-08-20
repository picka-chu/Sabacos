import { useCallback, useEffect, useState } from "react";
import type { CartSummary, Category, Product } from "@sabacos/core";
import { api } from "./api.js";
import { useShopStore as useCartState } from "./store.js";

export interface ProductPageResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
}

export function useCategories(): {
  categories: Category[];
  loading: boolean;
  reload: () => void;
} {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<{ categories: Category[] }>("/catalog/categories")
      .then((res) => setCategories(res.categories))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  return { categories, loading, reload };
}

export function useProducts(params: {
  categoryId?: string | null;
  categorySlug?: string | null;
  featured?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}): {
  result: ProductPageResult | null;
  loading: boolean;
  reload: () => void;
} {
  const [result, setResult] = useState<ProductPageResult | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (params.categoryId) qs.set("category", params.categoryId);
    if (params.categorySlug) qs.set("category", params.categorySlug);
    if (params.featured) qs.set("featured", "true");
    if (params.search) qs.set("q", params.search);
    if (params.page) qs.set("page", String(params.page));
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    api
      .get<ProductPageResult>(`/catalog/products?${qs.toString()}`)
      .then(setResult)
      .finally(() => setLoading(false));
  }, [params.categoryId, params.categorySlug, params.featured, params.search, params.page, params.pageSize]);

  useEffect(reload, [reload]);

  return { result, loading, reload };
}

export function useProduct(id: string): { product: Product | null; loading: boolean; reload: () => void } {
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .get<{ product: Product }>(`/catalog/products/${id}`)
      .then((res) => setProduct(res.product))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(reload, [reload]);

  return { product, loading, reload };
}

export function useCart(): CartSummary | null {
  return useCartState((s) => s.cart);
}