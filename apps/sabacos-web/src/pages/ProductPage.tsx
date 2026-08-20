import { useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { formatETB, t } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { QuantityStepper } from "../components/QuantityStepper.js";
import { useProduct } from "../hooks.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";

export function ProductPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { t, lang } = useI18n();
  const { product, loading } = useProduct(params.id);
  const addToCart = useShopStore((s) => s.addToCart);
  const [qty, setQty] = useState(1);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  const [activeImg, setActiveImg] = useState(0);

  if (loading) {
    return (
      <div className="screen">
        <Header showBack />
        <div className="skeleton" style={{ width: "100%", aspectRatio: "1", borderRadius: 22 }} />
        <div className="skeleton" style={{ height: 20, width: "70%", marginTop: 20 }} />
        <div className="skeleton" style={{ height: 14, width: "40%", marginTop: 12 }} />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="screen">
        <Header showBack />
        <div className="empty-state">
          <h3>{t("error")}</h3>
          <p>{t("orderNotFoundHint")}</p>
          <button className="btn btn-secondary" onClick={() => navigate("/")}>
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  const name = lang === "am" ? product.nameAm : product.nameEn;
  const desc = lang === "am" ? product.descriptionAm : product.descriptionEn;
  const out = product.stock <= 0;
  const low = !out && product.stock <= 5;

  const handleAdd = async () => {
    try {
      const cart = await addToCart(product, qty);
      toast(`${t("addedToCart")} · ${cart.itemCount} ${t("items")}`);
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  const handleBuyNow = async () => {
    try {
      await addToCart(product, qty);
      navigate("/checkout");
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  return (
    <div className="screen">
      <Header showBack />
      <div
        className="gallery"
        ref={galleryRef}
        onScroll={() => {
          const el = galleryRef.current;
          if (!el) return;
          const step = el.clientWidth * 0.84 + 12;
          setActiveImg(step > 0 ? Math.round(el.scrollLeft / step) : 0);
        }}
      >
        {product.imageUrls.length > 0 ? (
          product.imageUrls.map((url) => <img key={url} src={url} alt={name} />)
        ) : (
          <div className="gallery-placeholder" />
        )}
      </div>

      {product.imageUrls.length > 1 && (
        <div className="gallery-dots">
          {product.imageUrls.map((_, i) => (
            <span key={i} className={`dot ${i === activeImg ? "active" : ""}`} />
          ))}
        </div>
      )}

      <div className="flex" style={{ gap: 8, marginTop: 8 }}>
        {out ? (
          <span className="badge badge-danger stock-pill">
            <span className="stock-dot out" /> {t("outOfStock")}
          </span>
        ) : (
          <span className={`badge ${low ? "badge-gold" : "badge-success"} stock-pill`}>
            <span className={`stock-dot ${low ? "low" : ""}`} />
            {low ? t("lowStock") : t("inStock")}
          </span>
        )}
        {product.isFeatured && <span className="badge badge-accent">✦ {t("featuredLabel")}</span>}
      </div>

      <h1 className="serif" style={{ fontSize: 26, margin: "14px 0 4px", lineHeight: 1.15 }}>
        {name}
      </h1>

      <div className="flex" style={{ gap: 10, alignItems: "baseline" }}>
        <span className="price" style={{ fontSize: 22 }}>{formatETB(product.priceHalala)}</span>
        {product.compareAtHalala != null && product.compareAtHalala > product.priceHalala && (
          <span className="price-strike" style={{ fontSize: 15 }}>{formatETB(product.compareAtHalala)}</span>
        )}
      </div>

      <p className="muted" style={{ marginTop: 12, fontSize: 14, whiteSpace: "pre-wrap" }}>
        {desc || t("description")}
      </p>

      {!out && (
        <div className="flex" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 20 }}>
          <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>{t("quantity")}</span>
          <QuantityStepper value={qty} max={Math.min(99, product.stock)} onChange={setQty} />
        </div>
      )}

      <div className="sticky-summary" style={{ marginTop: 20 }}>
        <button
          className="btn btn-primary btn-block"
          disabled={out}
          onClick={handleAdd}
        >
          {out ? t("outOfStock") : t("addToCart")} · {formatETB(product.priceHalala * qty)}
        </button>
        <button
          className="btn btn-secondary btn-block"
          disabled={out}
          onClick={handleBuyNow}
        >
          {t("checkout")}
        </button>
      </div>
    </div>
  );
}