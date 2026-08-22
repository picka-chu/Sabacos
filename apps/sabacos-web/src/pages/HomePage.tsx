import { ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { ProductCard } from "../components/ProductCard.js";
import { ProductGridSkeleton } from "../components/Skeletons.js";
import { useCategories, useProducts } from "../hooks.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";

export function HomePage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const { categories, loading: categoriesLoading } = useCategories();
  const featured = useProducts({ featured: true, pageSize: 10 });
  const latest = useProducts({ pageSize: 8 });
  const addToCart = useShopStore((s) => s.addToCart);
  const profile = useShopStore((s) => s.profile);

  const featuredItems = featured.result?.items ?? [];
  const latestItems = latest.result?.items ?? [];
  const showFeatured = featuredItems.length > 0;
  const items = showFeatured ? featuredItems : latestItems;
  const productsLoading = showFeatured ? false : featured.loading || latest.loading;

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
      <Header />
      <section className="hero" style={{ marginTop: 12 }}>
        <div className="hero-kicker">{t("tagline")}</div>
        <h1>{t("heroTitle")}</h1>
        <p>{t("heroSubtitle")}</p>
      </section>

      <div className="section-title">
        <span>{t("categories")}</span>
        {categories.length > 0 && (
          <button
            onClick={() => navigate("/shop")}
            className="flex"
            style={{ gap: 2, color: "var(--accent)", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}
          >
            {t("viewAll")} <ChevronRight size={14} />
          </button>
        )}
      </div>
      <div className="chip-scroll">
        {categoriesLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="chip" style={{ opacity: 0.6, minWidth: 70 }} />
            ))
          : categories.map((c) => (
              <button
                key={c.id}
                className="chip"
                onClick={() => navigate(`/category/${c.slug}`)}
              >
                {lang === "am" ? c.nameAm : c.nameEn}
              </button>
            ))}
      </div>

      <div className="section-title">
        <span>{showFeatured ? t("featured") : t("newArrivals")}</span>
      </div>
      <div className="product-grid">
        {productsLoading ? (
          <ProductGridSkeleton count={4} />
        ) : items.length > 0 ? (
          items.map((p) => <ProductCard key={p.id} product={p} lang={lang} onAdd={handleAdd} />)
        ) : (
          <p className="muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "24px 0", fontSize: 14 }}>
            {t("emptyCatalog")}
          </p>
        )}
      </div>

      <button
        className="btn btn-secondary btn-block"
        style={{ marginTop: 16 }}
        onClick={() => navigate("/shop")}
      >
        {t("allProducts")}
      </button>

      {profile && (
        <p className="muted text-center" style={{ marginTop: 28, fontSize: 13 }}>
          {profile.firstName ?? profile.username ?? ""} · {profile.telegramId}
        </p>
      )}
    </div>
  );
}