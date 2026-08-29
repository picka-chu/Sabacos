import { useEffect, useState } from "react";
import { ChevronRight, Search, SlidersHorizontal, Sparkles, Wallet } from "lucide-react";
import { useLocation } from "wouter";
import { formatETB } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { ProductCard } from "../components/ProductCard.js";
import { BannerCarousel, type AdBanner } from "../components/BannerCarousel.js";
import { ProductGridSkeleton } from "../components/Skeletons.js";
import { iconForCategory } from "../categoryIcons.js";
import { useCategories, useProducts } from "../hooks.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { api } from "../api.js";
import { toast } from "../components/Toast.js";

export function HomePage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const { categories } = useCategories();
  const featured = useProducts({ featured: true, pageSize: 8 });
  const latest = useProducts({ pageSize: 8, sort: "newest" });
  const addToCart = useShopStore((s) => s.addToCart);

  const featuredItems = featured.result?.items ?? [];
  const latestItems = latest.result?.items ?? [];

  const [ad, setAd] = useState<AdBanner | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [availableSpins, setAvailableSpins] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ banner: AdBanner | null }>(`/ads/banner?lang=${lang}`)
      .then((res) => {
        if (!cancelled) setAd(res.banner);
      })
      .catch(() => {});
    api
      .get<{ walletBalance: number; availableSpins: number }>("/referral")
      .then((res) => {
        if (!cancelled) {
          setWalletBalance(res.walletBalance);
          setAvailableSpins(res.availableSpins);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bannerPool = [...featuredItems, ...latestItems];
  const banners = bannerPool
    .filter(
      (p, i, arr) =>
        arr.findIndex((x) => x.id === p.id) === i &&
        (p.imageUrls.length > 0 || p.isFeatured) &&
        (p.compareAtHalala != null || p.isFeatured),
    )
    .slice(0, 5);

  const bestSellers = featuredItems.length > 0 ? featuredItems : latestItems.slice(0, 4);
  const newArrivals = latestItems.filter((p) => !bestSellers.some((b) => b.id === p.id));

  const loading = featured.loading || latest.loading;

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
      <div style={{ paddingBottom: 4 }}>
        <div className="flex" style={{ gap: 8, alignItems: "center" }}>
          {walletBalance !== null && walletBalance > 0 && (
            <button
              className="chip"
              onClick={() => navigate("/referral")}
              style={{ height: 36, padding: "0 12px", gap: 6, flexShrink: 0, background: "var(--accent-bg, #e8f5e9)", color: "var(--accent)" }}
            >
              <Wallet size={15} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{formatETB(walletBalance)}</span>
            </button>
          )}
          {availableSpins > 0 && (
            <button
              className="chip"
              onClick={() => navigate("/spinner")}
              style={{ height: 36, padding: "0 12px", gap: 6, flexShrink: 0, background: "var(--warning-bg, #fff3e0)", color: "var(--warning, #f57c00)" }}
            >
              <Sparkles size={15} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{availableSpins}</span>
            </button>
          )}
          <button
            className="chip"
            style={{ height: 42, padding: "0 14px", flexShrink: 0, marginLeft: "auto" }}
            aria-label={t("filters")}
            onClick={() => navigate("/shop?filters=1")}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
        <div style={{ position: "relative", marginTop: 10 }}>
          <Search size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input
            placeholder={t("searchPlaceholder")}
            style={{ paddingLeft: 40, height: 44 }}
            onFocus={() => navigate("/shop")}
            readOnly
          />
        </div>
      </div>

      <BannerCarousel
        products={banners.filter((p) => p.id !== ad?.productId)}
        ad={ad}
        onOpen={(id) => navigate(`/product/${id}`)}
      />

      <div className="chip-scroll" style={{ marginTop: 10 }}>
        <button className="chip active" onClick={() => navigate("/shop")}>
          🛍 {t("allCategories")}
        </button>
        {categories.map((c) => (
          <button key={c.id} className="chip" onClick={() => navigate(`/category/${c.slug}`)}>
            <span>{iconForCategory(c)}</span> {lang === "am" ? c.nameAm : c.nameEn}
          </button>
        ))}
      </div>

      <div className="section-title">
        <span>{t("bestSellers")}</span>
      </div>
      <div className="product-grid">
        {loading ? (
          <ProductGridSkeleton count={4} />
        ) : bestSellers.length > 0 ? (
          bestSellers.map((p) => <ProductCard key={p.id} product={p} lang={lang} onAdd={handleAdd} />)
        ) : (
          <p className="muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "24px 0", fontSize: 14 }}>
            {t("emptyCatalog")}
          </p>
        )}
      </div>

      {newArrivals.length > 0 && (
        <>
          <div className="section-title">
            <span>{t("newArrivals")}</span>
            <button
              onClick={() => navigate("/shop")}
              className="flex"
              style={{ gap: 2, color: "var(--accent)", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}
            >
              {t("viewAll")} <ChevronRight size={14} />
            </button>
          </div>
          <div className="product-grid">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={p} lang={lang} onAdd={handleAdd} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
