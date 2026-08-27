import { Trash2, ShoppingBag } from "lucide-react";
import { useLocation } from "wouter";
import { formatETB, t } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { QuantityStepper } from "../components/QuantityStepper.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";

export function CartPage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const cart = useShopStore((s) => s.cart);
  const cartLoading = useShopStore((s) => s.cartLoading);
  const refreshCart = useShopStore((s) => s.refreshCart);
  const updateQty = useShopStore((s) => s.updateQty);
  const removeItem = useShopStore((s) => s.removeItem);

  const { items, itemCount, totals } = cart;

  const freeThreshold = cart.freeDeliveryThresholdHalala || 150000;
  const progress = Math.min(100, Math.round((totals.subtotalHalala / freeThreshold) * 100));

  const handleQty = async (id: string, qty: number) => {
    try {
      const updated = await updateQty(id, qty);
      if (updated.items.length === 0) toast(t("outOfStockInCart"));
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeItem(id);
      toast(t("remove"));
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  return (
    <div className="screen">
      <PageTitle title={t("nav_cart")} />

      {cartLoading && items.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>{t("loading")}</div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <ShoppingBag size={44} strokeWidth={1.25} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <h3>{t("emptyCart")}</h3>
          <p>{t("emptyCartHint")}</p>
          <button className="btn btn-primary" onClick={() => navigate("/shop")}>
            {t("startShopping")}
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: "6px 0" }}>
            {items.map((item, i) => (
              <div key={item.id}>
                {i > 0 && <hr className="divider" style={{ margin: "0 16px" }} />}
                <div className="cart-item">
                  <img src={item.product.imageUrls[0] ?? ""} alt={lang === "am" ? item.product.nameAm : item.product.nameEn} />
                  <div className="info">
                    <div className="name">{lang === "am" ? item.product.nameAm : item.product.nameEn}</div>
                    <div className="price" style={{ fontSize: 14, marginTop: 4 }}>
                      {formatETB(item.product.promo?.salePriceHalala ?? item.product.priceHalala)}
                      {item.product.promo != null && (
                        <span className="price-strike" style={{ fontSize: 12, marginLeft: 6 }}>
                          {formatETB(item.product.priceHalala)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex" style={{ flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                    <button
                      onClick={() => handleRemove(item.id)}
                      aria-label={t("remove")}
                      style={{ color: "var(--danger)" }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <QuantityStepper
                      value={item.qty}
                      max={Math.min(99, item.product.stock)}
                      onChange={(q) => handleQty(item.id, q)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 16, marginTop: 14 }}>
            {totals.subtotalHalala < freeThreshold && (
              <div style={{ marginBottom: 14 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                  {t("freeDeliveryHint", { amount: formatETB(freeThreshold) })}
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${progress}%`,
                      borderRadius: 999,
                      background: "linear-gradient(90deg, var(--gold), var(--accent))",
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("subtotal")}</span>
              <span className="price">{formatETB(totals.subtotalHalala)}</span>
            </div>
            {cart.discountHalala != null && cart.discountHalala > 0 && (
              <div className="row" style={{ justifyContent: "space-between", marginTop: 8, color: "var(--success)" }}>
                <span style={{ fontSize: 14 }}>{cart.discountLabel || "Promo"}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>-{formatETB(cart.discountHalala)}</span>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <span className="muted">{t("deliveryFee")}</span>
              <span className={totals.deliveryFeeHalala === 0 ? "badge badge-success" : "muted"}>
                {totals.deliveryFeeHalala === 0 ? t("free") : formatETB(totals.deliveryFeeHalala)}
              </span>
            </div>
            <hr className="divider" />
            <div className="row" style={{ justifyContent: "space-between", fontSize: 18 }}>
              <span style={{ fontWeight: 600 }}>{t("total")}</span>
              <span className="price" style={{ fontSize: 20 }}>{formatETB(totals.totalHalala)}</span>
            </div>
          </div>

          <div className="checkout-btn">
            <button className="btn btn-primary btn-block" style={{ fontSize: 16 }} onClick={() => navigate("/checkout")}>
              {t("checkout")} · {formatETB(totals.totalHalala)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}