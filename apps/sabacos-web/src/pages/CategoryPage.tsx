import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Search, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { ProductCard } from "../components/ProductCard.js";
import { ProductGridSkeleton } from "../components/Skeletons.js";
import { useCategories, useProducts } from "../hooks.js";
import { api } from "../api.js";
import { toast } from "../components/Toast.js";
import { useShopStore, apiErrorMessage } from "../store.js";

export function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const { categories } = useCategories();
  const addToCart = useShopStore((s) => s.addToCart);

  const category = useMemo(
    () => categories.find((c) => c.slug === params.slug),
    [categories, params.slug],
  );

  const pageSize = 12;
  const [items, setItems] = useState<import("@sabacos/core").Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);

  const fetchPage = async (pageNum: number, replace = false) => {
    if (replace) setLoading(true);
    else setLoadMoreLoading(true);
    const qs = new URLSearchParams();
    qs.set("category", params.slug);
    qs.set("page", String(pageNum));
    qs.set("pageSize", String(pageSize));
    try {
      const res = await api.get<{
        items: import("@sabacos/core").Product[];
        total: number;
        page: number;
        pageSize: number;
      }>(`/catalog/products?${qs.toString()}`);
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setPage(res.page);
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setLoading(false);
      setLoadMoreLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setPage(1);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.slug]);

  const handleAdd = async (product: import("@sabacos/core").Product) => {
    try {
      const cart = await addToCart(product, 1);
      toast(`${t("addedToCart")} · ${cart.itemCount} ${t("items")}`);
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  const name = category ? (lang === "am" ? category.nameAm : category.nameEn) : params.slug;

  return (
    <div className="screen">
      <Header title={t("categories")} showBack />

      <section className="hero" style={{ marginTop: 4 }}>
        <div className="hero-kicker">{t("categories")}</div>
        <h1 style={{ fontSize: 26 }}>{name}</h1>
        <p>{t("productsCount", { count: total })}</p>
      </section>

      {items.length > 0 && (
        <div className="flex" style={{ justifyContent: "flex-end", marginTop: 4 }}>
          <button
            className="link-chip"
            onClick={() => navigate("/shop")}
          >
            <Search size={14} /> {t("viewAll")} <ChevronRight size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <ProductGridSkeleton count={6} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h3>{t("noProducts")}</h3>
          <p>{t("noProductsHint")}</p>
          <button className="btn btn-secondary" onClick={() => navigate("/shop")}>
            {t("allProducts")}
          </button>
        </div>
      ) : (
        <>
          <div className="product-grid" style={{ marginTop: 12 }}>
            {items.map((p) => (
              <ProductCard key={p.id} product={p} lang={lang} onAdd={handleAdd} />
            ))}
          </div>
          {items.length < total && (
            <button
              className="btn btn-secondary btn-block"
              style={{ marginTop: 16 }}
              disabled={loadMoreLoading}
              onClick={() => fetchPage(page + 1)}
            >
              {loadMoreLoading ? t("loading") : t("viewAll")}
            </button>
          )}
        </>
      )}
    </div>
  );
}