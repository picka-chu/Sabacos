import { useEffect, useMemo, useState } from "react";
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

type SortKey = "newest" | "price_asc" | "price_desc";

interface PageResult {
  items: import("@sabacos/core").Product[];
  total: number;
  page: number;
  pageSize: number;
}

interface Filters {
  sort: SortKey;
  minEtb: string;
  maxEtb: string;
}

const DEFAULT_FILTERS: Filters = { sort: "newest", minEtb: "", maxEtb: "" };

export function ShopPage() {
  const { t, lang } = useI18n();
  const search = useSearch();
  const [, navigate] = useLocation();
  const { categories } = useCategories();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const activeCategory = params.get("category") ?? "";
  const initialQuery = params.get("q") ?? "";
  const wantsFilters = params.get("filters") === "1";

  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(wantsFilters);
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
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
    if (filters.sort !== "newest") qs.set("sort", filters.sort);
    if (filters.minEtb.trim()) qs.set("minPrice", filters.minEtb.trim());
    if (filters.maxEtb.trim()) qs.set("maxPrice", filters.maxEtb.trim());
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
    fetchPage(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, query, filters]);

  const openSheet = () => {
    setDraft(filters);
    setSheetOpen(true);
  };

  const applySheet = () => {
    const min = parseFloat(draft.minEtb);
    const max = parseFloat(draft.maxEtb);
    if (draft.minEtb.trim() && (!Number.isFinite(min) || min < 0)) return;
    if (draft.maxEtb.trim() && (!Number.isFinite(max) || max < 0)) return;
    if (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      draft.minEtb.trim() &&
      draft.maxEtb.trim() &&
      min > max
    ) {
      setDraft({ ...draft, minEtb: draft.maxEtb, maxEtb: draft.minEtb });
      return;
    }
    setFilters({ ...draft });
    setSheetOpen(false);
  };

  const activeFilterCount =
    (filters.sort !== "newest" ? 1 : 0) +
    (filters.minEtb.trim() ? 1 : 0) +
    (filters.maxEtb.trim() ? 1 : 0);

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
          className={`chip ${activeFilterCount > 0 ? "active" : ""}`}
          style={{ padding: "0 14px", height: 46, position: "relative" }}
          aria-label={t("filters")}
          onClick={openSheet}
        >
          <SlidersHorizontal size={18} />
          {activeFilterCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -2,
                minWidth: 18,
                height: 18,
                borderRadius: 999,
                background: "var(--accent-strong)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 5px",
              }}
            >
              {activeFilterCount}
            </span>
          )}
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
          {t(`sort_${filters.sort}`)}
        </span>
      </div>

      {loading && items.length === 0 ? (
        <ProductGridSkeleton count={8} />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <h3>{t("noProducts")}</h3>
          <p>{t("noProductsHint")}</p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setQuery("");
              setFilters(DEFAULT_FILTERS);
              navigate("/shop");
            }}
          >
            {t("reset")}
          </button>
        </div>
      ) : (
        <>
          <div className="product-grid">
            {items.map((p) => (
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

      {sheetOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <h2 className="serif" style={{ fontSize: 20, margin: "0 0 16px" }}>{t("filters")}</h2>

            <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 8 }}>
              {t("sortBy")}
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {(["newest", "price_asc", "price_desc"] as SortKey[]).map((key) => (
                <button
                  key={key}
                  className={`chip ${draft.sort === key ? "active" : ""}`}
                  onClick={() => setDraft({ ...draft, sort: key })}
                >
                  {t(`sort_${key}`)}
                </button>
              ))}
            </div>

            <label style={{ fontSize: 13, fontWeight: 700, display: "block", marginBottom: 8 }}>
              {t("priceRange")}
            </label>
            <div className="flex" style={{ gap: 8 }}>
              <input
                value={draft.minEtb}
                inputMode="decimal"
                placeholder={t("priceFrom")}
                onChange={(e) => setDraft({ ...draft, minEtb: e.target.value })}
              />
              <input
                value={draft.maxEtb}
                inputMode="decimal"
                placeholder={t("priceTo")}
                onChange={(e) => setDraft({ ...draft, maxEtb: e.target.value })}
              />
            </div>

            <div className="flex" style={{ gap: 8, marginTop: 22 }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setDraft(DEFAULT_FILTERS)}
              >
                {t("reset")}
              </button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={applySheet}>
                {t("apply")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
