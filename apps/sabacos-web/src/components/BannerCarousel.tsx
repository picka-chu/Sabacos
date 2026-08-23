import { useEffect, useRef, useState } from "react";
import type { Product } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { haptic } from "../telegram.js";

export interface AdBanner {
  productId: string;
  nameEn: string;
  nameAm: string;
  imageUrl: string | null;
  priceHalala: number;
  compareAtHalala: number | null;
  headline: string;
  cta: string;
  discountPct: number | null;
}

interface Slide {
  key: string;
  img: string | null;
  tag: string;
  title: string;
  onClick: () => void;
}

interface Props {
  products: Product[];
  ad?: AdBanner | null;
  onOpen: (productId: string) => void;
}

export function BannerCarousel({ products, ad, onOpen }: Props) {
  const { t, lang } = useI18n();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);

  const slides: Slide[] = [];
  if (ad) {
    slides.push({
      key: `ad-${ad.productId}`,
      img: ad.imageUrl,
      tag: `${ad.headline}${ad.discountPct != null ? ` · −${ad.discountPct}%` : ""}`,
      title: ad.cta,
      onClick: () => onOpen(ad.productId),
    });
  }
  for (const p of products) {
    const discount =
      p.compareAtHalala != null && p.compareAtHalala > p.priceHalala
        ? Math.round(((p.compareAtHalala - p.priceHalala) / p.compareAtHalala) * 100)
        : null;
    const img = p.imageUrls[0] ?? null;
    slides.push({
      key: p.id,
      img,
      tag:
        discount != null
          ? `${t("onSale")} · −${discount}%`
          : p.isFeatured
            ? t("featured")
            : t("newArrivals"),
      title: lang === "am" ? p.nameAm : p.nameEn,
      onClick: () => onOpen(p.id),
    });
  }

  useEffect(() => {
    if (slides.length < 2) return;
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      setActive((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || slides.length < 2) return;
    el.scrollTo({ left: active * el.clientWidth, behavior: "smooth" });
  }, [active, slides.length]);

  if (slides.length === 0) return null;

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
          if (idx !== active && idx >= 0 && idx < slides.length) setActive(idx);
        }}
      >
        {slides.map((s) => (
          <button
            key={s.key}
            className="banner-card"
            onClick={() => {
              haptic("light");
              s.onClick();
            }}
          >
            <div className="banner-art" style={s.img ? { backgroundImage: `url(${s.img})` } : undefined}>
              {!s.img && "✨"}
            </div>
            <div className="banner-overlay" />
            <div className="banner-copy">
              <span className="banner-tag">{s.tag}</span>
              <strong>{s.title}</strong>
            </div>
          </button>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="banner-dots">
          {slides.map((s) => (
            <span key={s.key} className={`banner-dot ${slides[active]?.key === s.key ? "active" : ""}`} />
          ))}
        </div>
      )}
    </div>
  );
}
