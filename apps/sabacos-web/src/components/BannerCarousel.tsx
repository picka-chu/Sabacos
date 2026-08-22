import { useEffect, useRef, useState } from "react";
import type { Product } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { haptic } from "../telegram.js";

interface Props {
  products: Product[];
  onOpen: (product: Product) => void;
}

export function BannerCarousel({ products, onOpen }: Props) {
  const { t, lang } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    if (products.length < 2) return;
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      setActive((prev) => (prev + 1) % products.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [products.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || products.length < 2) return;
    el.scrollTo({ left: active * el.clientWidth, behavior: "smooth" });
  }, [active, products.length]);

  if (products.length === 0) return null;

  return (
    <div
      style={{ margin: "14px -16px 4px" }}
      onTouchStart={() => (pausedRef.current = true)}
      onTouchEnd={() => setTimeout(() => (pausedRef.current = false), 3000)}
      onMouseEnter={() => (pausedRef.current = true)}
      onMouseLeave={() => (pausedRef.current = false)}
    >
      <div
        ref={scrollRef}
        className="banner-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (idx !== active && idx >= 0 && idx < products.length) setActive(idx);
        }}
      >
        {products.map((p) => {
          const discount =
            p.compareAtHalala != null && p.compareAtHalala > p.priceHalala
              ? Math.round(((p.compareAtHalala - p.priceHalala) / p.compareAtHalala) * 100)
              : null;
          const img = p.imageUrls[0];
          return (
            <button
              key={p.id}
              className="banner-card"
              onClick={() => {
                haptic("light");
                onOpen(p);
              }}
            >
              <div className="banner-art" style={img ? { backgroundImage: `url(${img})` } : undefined}>
                {!img && "✨"}
              </div>
              <div className="banner-overlay" />
              <div className="banner-copy">
                {discount != null ? (
                  <span className="banner-tag">{t("onSale")} · −{discount}%</span>
                ) : (
                  <span className="banner-tag">{p.isFeatured ? t("featured") : t("newArrivals")}</span>
                )}
                <strong>{lang === "am" ? p.nameAm : p.nameEn}</strong>
              </div>
            </button>
          );
        })}
      </div>
      {products.length > 1 && (
        <div className="banner-dots">
          {products.map((p, i) => (
            <span key={p.id} className={`banner-dot ${i === active ? "active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}
