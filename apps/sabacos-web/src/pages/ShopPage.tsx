import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useSearch, useLocation } from "wouter";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { ProductCard } from "../components/ProductCard.js";
import { ProductGridSkeleton } from "../components/Skeletons.js";
import { useCategories } from "../hooks.js";
import { api } from "../api.js";
import { toast } from "../components/Toast.js";
import { useShopStore, apiErrorMessage } from "../store.js";

interface PageResult {
  items: import("@sabacos/core").Product[];
  total: number;
  page: number;
  pageSize: number;
}

export function ShopPage() {
  const { t, lang } = useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { categories } = useCategories();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const activeCategory = params.get("category") ?? "";
  const initialQuery = params.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [items, setItems] = useState<import("@sabacos/core").Product[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const addToCart = useShopStore((s) => s.addToCart);

  const fetchPage = async (pageNum: number, replace = false) => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (activeCategory) qs.set("category", activeCategory);
    if (query.trim()) qs.set("q", query.trim());
    qs.set("page", String(pageNum));
    qs.set("pageSize", "12");
    try {
      const res = await api.get<PageResult>(`/catalog/products?${qs.toString()}`);
      setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
      setPage(res.page);
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setPage(1);
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, query]);

  const sorted = useMemo(() => {
    const arr = [...items];
    if (sort === "price_asc") arr.sort((a, b) => a.priceHalala - b.priceHalala);
    if (sort === "price_desc") arr.sort((a, b) => b.priceHalala - a.priceHalala);
    return arr;
  }, [items, sort]);

  const handleAdd = async (product: import("@sabacos/core").Product) => {
    try {
      const cart = await addToCart(product, 1);
      toast(`${t("addedToCart")} · ${cart.itemCount} ${t("items")}`);
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  return (
    <div className="screen">
      <Header title={t("nav_shop")} showBack />
      <div className="flex" style={{ gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            value={query}
            placeholder={t("searchPlaceholder")}
            style={{ paddingLeft: 42, paddingRight: 40 }}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <button
          className="chip"
          style={{ padding: "0 14px", height: 46 }}
          aria-label="Sort"
          onClick={() =>
            setSort((s) => (s === "newest" ? "price_asc" : s === "price_asc" ? "price_desc" : "newest"))
          }
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      <div className="chip-scroll" style={{ margin: "0 -16px", paddingLeft: 16 }}>
        <button
          className={`chip ${!activeCategory ? "active" : ""}`}
          onClick={() => navigate("/shop")}
        >
          {t("allCategories")}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`chip ${activeCategory === c.slug ? "active" : ""}`}
            onClick={() => navigate(`/category/${c.slug}`)}
          >
            {lang === "am" ? c.nameAm : c.nameEn}
          </button>
        ))}
      </div>

      <div className="section-title">
        <span>{t("productsCount", { count: total })}</span>
        <span className="muted" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}>
          {t(`sort_${sort}`)}
        </span>
      </div>

      {loading && items.length === 0 ? (
        <ProductGridSkeleton count={8} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h3>{t("noProducts")}</h3>
          <p>{t("noProductsHint")}</p>
          <button className="btn btn-secondary" onClick={() => navigate("/shop")}>
            {t("clear")}
          </button>
        </div>
      ) : (
        <>
          <div className="product-grid">
            {sorted.map((p) => (
              <ProductCard key={p.id} product={p} lang={lang} onAdd={handleAdd} />
            ))}
          </div>
          {items.length < total && (
            <button
              className="btn btn-secondary btn-block"
              style={{ marginTop: 16 }}
              disabled={loading}
              onClick={() => fetchPage(page + 1)}
            >
              {loading ? t("loading") : t("viewAll")}
            </button>
          )}
        </>
      )}
    </div>
  );
}