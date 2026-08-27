import { Plus, ImageOff } from "lucide-react";
import type { Product } from "@sabacos/core";
import { formatETB, t } from "@sabacos/core";
import { useLocation } from "wouter";
import { haptic } from "../telegram.js";

interface Props {
  product: Product;
  lang: "en" | "am";
  onAdd: (product: Product) => void;
}

export function ProductCard({ product, lang, onAdd }: Props) {
  const [, navigate] = useLocation();
  const name = lang === "am" ? product.nameAm : product.nameEn;
  const out = product.stock <= 0;
  const image = product.imageUrls[0];

  const promo = product.promo;
  const sale = promo ? promo.salePriceHalala : product.priceHalala;
  const strike =
    promo != null
      ? product.priceHalala
      : product.compareAtHalala != null && product.compareAtHalala > product.priceHalala
        ? product.compareAtHalala
        : null;
  const badgePct =
    promo != null
      ? promo.percent
      : product.compareAtHalala != null && product.compareAtHalala > product.priceHalala
        ? Math.round((1 - product.priceHalala / product.compareAtHalala) * 100)
        : null;

  return (
    <div
      className="product-card"
      onClick={() => {
        haptic("light");
        navigate(`/product/${product.id}`);
      }}
    >
      <div className="thumb">
        {image ? (
          <img src={image} alt={name} loading="lazy" />
        ) : (
          <div className="flex" style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center" }}>
            <ImageOff size={28} color="var(--muted)" />
          </div>
        )}
        {out && (
          <span className="badge badge-danger" style={{ position: "absolute", top: 10, left: 10 }}>
            {t(lang, "outOfStock")}
          </span>
        )}
        {badgePct != null && !out && (
          <span className="badge badge-gold" style={{ position: "absolute", top: 10, right: 10 }}>
            -{badgePct}%
          </span>
        )}
        {!out && (
          <button
            className="add-btn"
            aria-label="Add to cart"
            onClick={(e) => {
              e.stopPropagation();
              haptic("medium");
              onAdd(product);
            }}
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <div className="card-body">
        <span className="name">{name}</span>
        <div className="price-row">
          <span className="price">{formatETB(sale)}</span>
          {strike != null && strike > sale && (
            <span className="price-strike">{formatETB(strike)}</span>
          )}
        </div>
      </div>
    </div>
  );
}