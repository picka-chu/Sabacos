import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight, MapPin, User, X, Zap, Truck } from "lucide-react";
import { DEFAULT_DELIVERY_CONFIG, formatETB, quoteDelivery, t } from "@sabacos/core";
import type { DeliveryConfig } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { api } from "../api.js";
import { PageTitle } from "../components/PageTitle.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";
import { isTelegramSession, haptic, payInvoice, closeToChat } from "../telegram.js";

type Phase = "form" | "pending" | "success" | "failed";

const ZONES = [
  { value: 1, labelKey: "zone1" },
  { value: 2, labelKey: "zone2" },
  { value: 3, labelKey: "zone3" },
] as const;

export function CheckoutPage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const cart = useShopStore((s) => s.cart);
  const profile = useShopStore((s) => s.profile);
  const checkout = useShopStore((s) => s.checkout);
  const clearCart = useShopStore((s) => s.clearCart);
  const refreshProfile = useShopStore((s) => s.refreshProfile);

  const [form, setForm] = useState({
    customerName: profile?.firstName ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
    note: "",
  });
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [manualZone, setManualZone] = useState<number | null>(null);
  const [deliveryType, setDeliveryType] = useState<"standard" | "express">("standard");
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig>(DEFAULT_DELIVERY_CONFIG);
  const [phase, setPhase] = useState<Phase>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  const totals = cart.totals;
  const fragile = cart.items.some((i) => i.product.isFragile);

  // Live delivery estimate mirrors the server exactly (same core engine).
  const estimate = useMemo(
    () =>
      quoteDelivery(deliveryConfig, {
        subtotalHalala: totals.subtotalHalala,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        zone: coords ? null : manualZone,
        express: deliveryType === "express",
        fragile,
      }),
    [deliveryConfig, totals.subtotalHalala, coords, manualZone, deliveryType, fragile],
  );

  useEffect(() => {
    api.get<{ config: DeliveryConfig }>("/delivery/config")
      .then((res) => res.config && setDeliveryConfig(res.config))
      .catch(() => undefined);
  }, []);

  const grandTotal = totals.subtotalHalala + estimate.totalDeliveryFeeHalala;

  const priceFor = (express: boolean) =>
    quoteDelivery(deliveryConfig, {
      subtotalHalala: totals.subtotalHalala,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      zone: coords ? null : manualZone,
      express,
      fragile,
    }).totalDeliveryFeeHalala;

  const freeGap =
    deliveryConfig.freeThresholdHalala - totals.subtotalHalala;
  const showFreeNudge =
    freeGap > 0 && freeGap <= 20000 && !estimate.freeDeliveryApplied && deliveryType === "standard";

  const canSubmit = useMemo(
    () =>
      form.customerName.trim().length >= 2 &&
      form.phone.trim().length >= 7 &&
      form.address.trim().length >= 5,
    [form],
  );

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const startPolling = (id: string) => {
    setPhase("pending");
    pollRef.current = setInterval(async () => {
      try {
        const order = await getOrderStatus(id);
        if (order.status === "paid" || order.status === "processing" || order.status === "shipped" || order.status === "delivered") {
          if (pollRef.current) clearInterval(pollRef.current);
          setOrderNo(order.orderNo);
          setOrderTotal(order.totalHalala);
          setPhase("success");
          await clearCart();
        } else if (order.status === "cancelled" || order.paymentStatus === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setErrorMsg(order.status === "cancelled" ? t("orderPendingHint") : t("error"));
          setPhase("failed");
        }
      } catch {
        // keep polling; transient network errors are expected
      }
    }, 2500);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMsg(null);
    try {
      const { order, invoiceUrl } = await checkout({
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        note: form.note.trim() || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        zone: coords ? null : manualZone,
        deliveryType,
      });
      setOrderId(order.id);
      setOrderNo(order.orderNo);
      startPolling(order.id);
      const status = await payInvoice(invoiceUrl);
      if (status === "paid") {
        // Telegram confirmed the charge — show the success page immediately.
        if (pollRef.current) clearInterval(pollRef.current);
        setOrderTotal(order.totalHalala);
        haptic("heavy");
        await clearCart();
        setPhase("success");
      } else if (status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setErrorMsg(t("paymentFailed"));
        setPhase("failed");
      }
      // cancelled / pending / unknown: polling decides the outcome
    } catch (err) {
      setErrorMsg(apiErrorMessage(err));
      setPhase("failed");
    } finally {
      submittingRef.current = false;
    }
  };

  const handleSharePhone = async () => {
    haptic();
    try {
      await api.post("/profile/request-phone", {});
      // Hand the user to the bot chat: the request keyboard is waiting there.
      toast(t("checkTelegramChat"));
      setTimeout(closeToChat, 900);
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  const handleShareLocation = async () => {
    haptic();
    try {
      await api.post("/profile/request-location", {});
      toast(t("checkTelegramChat"));
      setTimeout(closeToChat, 900);
    } catch (err) {
      toast(apiErrorMessage(err));
    }
  };

  // Returning from the bot chat (via the bot's "Back to the shop" button):
  // pick up whatever was shared while the app was closed.
  useEffect(() => {
    refreshProfile()
      .then((p) => {
        if (p.lastLatitude != null && p.lastLongitude != null) {
          setCoords((c) => c ?? { lat: p.lastLatitude as number, lng: p.lastLongitude as number });
        }
      })
      .catch(() => undefined);
  }, []);

  if (phase === "success" && orderNo) {
    return (
      <div className="screen" style={{ paddingTop: "calc(var(--safe-top) + 24px)" }}>
        <div className="text-center" style={{ paddingTop: 40 }}>
          <CheckCircle2 size={72} strokeWidth={1.25} color="var(--success)" />
          <h1 className="serif" style={{ fontSize: 28, margin: "18px 0 6px" }}>{t("orderConfirmed")}</h1>
          <p className="muted">{t("orderConfirmedHint")}</p>
          <div className="card" style={{ padding: 18, marginTop: 24, textAlign: "left" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("orderNumber")}</span>
              <strong>{orderNo}</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
              <span className="muted">{t("orderTotal")}</span>
              <strong>{formatETB(orderTotal)}</strong>
            </div>
          </div>
          <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} onClick={() => navigate("/orders")}>
            {t("viewOrder")} <ArrowRight size={16} />
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 4 }} onClick={() => navigate("/")}>
            {t("startShopping")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "pending" && orderId) {
    return (
      <div className="screen" style={{ paddingTop: "calc(var(--safe-top) + 24px)" }}>
        <div className="text-center" style={{ paddingTop: 40 }}>
          <Loader2 size={52} strokeWidth={1.25} className="spin" color="var(--accent)" style={{ animation: "spin 1.2s linear infinite" }} />
          <h1 className="serif" style={{ fontSize: 24, margin: "18px 0 6px" }}>{t("paymentSent")}</h1>
          <p className="muted" style={{ maxWidth: 320, margin: "0 auto" }}>{t("paymentPendingHint")}</p>
          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Order: {orderNo ?? "…"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageTitle title={t("checkout")} />

      {cart.items.length === 0 && phase === "form" ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <h3>{t("emptyCart")}</h3>
          <button className="btn btn-primary" onClick={() => navigate("/shop")}>
            {t("startShopping")}
          </button>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            {cart.items.map((item) => (
              <div key={item.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
                <span style={{ fontSize: 14 }}>
                  {lang === "am" ? item.product.nameAm : item.product.nameEn} × {item.qty}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {formatETB((item.product.promo?.salePriceHalala ?? item.product.priceHalala) * item.qty)}
                </span>
              </div>
            ))}
            <hr className="divider" />
            <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
              <span className="muted">{t("subtotal")}</span>
              <span>{formatETB(totals.subtotalHalala)}</span>
            </div>
            {cart.discountHalala != null && cart.discountHalala > 0 && (
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6, color: "var(--success)" }}>
                <span style={{ fontSize: 13 }}>{cart.discountLabel || "Promo"}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>-{formatETB(cart.discountHalala)}</span>
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="muted">{t("deliveryFee")}</span>
              <span>{estimate.totalDeliveryFeeHalala === 0 ? t("free") : formatETB(estimate.totalDeliveryFeeHalala)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <strong>{t("total")}</strong>
              <strong style={{ fontSize: 18 }}>{formatETB(grandTotal)}</strong>
            </div>
          </div>

          <div className="card form-card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>{t("contactDetails")}</h2>
            <div className="field">
              <label>{t("fullName")}</label>
              <input
                value={form.customerName}
                placeholder={t("fullName")}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{t("phone")}</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={form.phone}
                  inputMode="tel"
                  placeholder="+251 91 234 5678"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
                {isTelegramSession() && (
                  <button type="button" className="btn btn-secondary" style={{ flexShrink: 0, padding: "0 12px" }} onClick={handleSharePhone} title={t("sharePhone")}>
                    <User size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="field">
              <label>{t("deliveryAddress")}</label>
              <textarea
                value={form.address}
                placeholder={t("deliveryAddress")}
                rows={3}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>{t("note")}</label>
              <input
                value={form.note}
                placeholder={t("note")}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 18 }}>
            <h2 style={{ fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>{t("deliveryOptions")}</h2>

            {coords ? (
              <div className="row" style={{ gap: 8 }}>
                <div className="zone-option active btn-block" style={{ cursor: "default" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={15} /> {t("locationSaved")}
                  </span>
                </div>
                <button type="button" className="btn btn-secondary" style={{ flexShrink: 0, padding: "0 12px" }} onClick={() => setCoords(null)}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                {isTelegramSession() && (
                  <button type="button" className="btn btn-secondary btn-block" onClick={handleShareLocation}>
                    <MapPin size={16} /> {t("shareLocation")}
                  </button>
                )}
                <p className="muted" style={{ fontSize: 12.5, margin: "10px 2px 8px" }}>{t("chooseZone")}</p>
                <div style={{ display: "grid", gap: 6 }}>
                  {ZONES.map((z) => (
                    <button
                      key={z.value}
                      type="button"
                      className={`zone-option${manualZone === z.value ? " active" : ""}`}
                      onClick={() => {
                        haptic();
                        setManualZone(z.value);
                      }}
                    >
                      <span>{t(z.labelKey)}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        +{formatETB(deliveryConfig.zones[z.value - 1]?.surchargeHalala ?? 0)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className={`zone-option zone-speed${deliveryType === "standard" ? " active" : ""}`}
                onClick={() => {
                  haptic();
                  setDeliveryType("standard");
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <Truck size={15} /> {t("standardDelivery")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {priceFor(false) === 0 ? t("free") : formatETB(priceFor(false))}
                </span>
              </button>
              <button
                type="button"
                className={`zone-option zone-speed${deliveryType === "express" ? " active" : ""}`}
                onClick={() => {
                  haptic();
                  setDeliveryType("express");
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <Zap size={15} /> {t("expressDelivery")}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {priceFor(true) === 0 ? t("free") : formatETB(priceFor(true))}
                </span>
              </button>
            </div>
            {deliveryType === "express" && (
              <p className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>
                <Zap size={12} style={{ verticalAlign: -2 }} /> {t("expressHint")}
              </p>
            )}

            {fragile && estimate.fragileFeeHalala > 0 && (
              <div className="row muted" style={{ justifyContent: "space-between", marginTop: 10, fontSize: 13 }}>
                <span>{t("fragileHandling")}</span>
                <span>+{formatETB(estimate.fragileFeeHalala)}</span>
              </div>
            )}
            {showFreeNudge && (
              <p style={{ fontSize: 12.5, margin: "10px 2px 0", color: "var(--accent-strong)", fontWeight: 600 }}>
                🚚 {t("freeDeliveryHint", { amount: formatETB(freeGap) })}
              </p>
            )}
          </div>

          {errorMsg && (
            <div className="card" style={{ padding: 14, marginBottom: 14, background: "var(--accent-soft)", color: "var(--accent-strong)", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertCircle size={18} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 14 }}>{errorMsg}</span>
            </div>
          )}

          <div className="sticky-summary">
            <div className="flex" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("total")}</span>
              <span className="price" style={{ fontSize: 20 }}>{formatETB(grandTotal)}</span>
            </div>
            <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={handleSubmit}>
              {t("payWithTelegram")} · {formatETB(grandTotal)}
            </button>
            <p className="muted text-center" style={{ margin: 0, fontSize: 12, fontWeight: 500 }}>
              {t("payWithTelegramHint")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

async function getOrderStatus(id: string) {
  const res = await api.get<{
    order: { status: string; orderNo: string; paymentStatus: string; totalHalala: number };
  }>(`/orders/${id}`);
  return res.order;
}
