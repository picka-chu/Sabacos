import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight, MapPin, User } from "lucide-react";
import { formatETB, t } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { api } from "../api.js";
import { PageTitle } from "../components/PageTitle.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";
import { isTelegramSession, haptic, payInvoice, requestLocation, requestPhoneNumber } from "../telegram.js";

type Phase = "form" | "pending" | "success" | "failed";

export function CheckoutPage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const cart = useShopStore((s) => s.cart);
  const profile = useShopStore((s) => s.profile);
  const checkout = useShopStore((s) => s.checkout);
  const clearCart = useShopStore((s) => s.clearCart);

  const [form, setForm] = useState({
    customerName: profile?.firstName ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
    note: "",
  });
  const [phase, setPhase] = useState<Phase>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totals = cart.totals;

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
    setErrorMsg(null);
    try {
      const { order, invoiceUrl } = await checkout({
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        note: form.note.trim() || null,
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
    }
  };

  const handleSharePhone = async () => {
    haptic();
    const number = await requestPhoneNumber();
    if (number) setForm((f) => ({ ...f, phone: number }));
    else toast(t("featureUnavailable"));
  };

  const handleShareLocation = async () => {
    haptic();
    const loc = await requestLocation();
    if (loc) {
      const gpsTag = `[GPS: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}]`;
      setForm((f) => ({
        ...f,
        address: f.address.includes("[GPS:") ? f.address.replace(/\[GPS:[^\]]+\]/, gpsTag) : `${gpsTag} ${f.address}`.trim(),
      }));
    } else {
      toast(t("featureUnavailable"));
    }
  };

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
                <span style={{ fontSize: 14, fontWeight: 600 }}>{formatETB(item.product.priceHalala * item.qty)}</span>
              </div>
            ))}
            <hr className="divider" />
            <div className="row" style={{ justifyContent: "space-between", marginTop: 4 }}>
              <span className="muted">{t("subtotal")}</span>
              <span>{formatETB(totals.subtotalHalala)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="muted">{t("deliveryFee")}</span>
              <span>{totals.deliveryFeeHalala === 0 ? t("free") : formatETB(totals.deliveryFeeHalala)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <strong>{t("total")}</strong>
              <strong style={{ fontSize: 18 }}>{formatETB(totals.totalHalala)}</strong>
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
              {isTelegramSession() && (
                <button type="button" className="btn btn-secondary btn-block" style={{ marginTop: 8 }} onClick={handleShareLocation}>
                  <MapPin size={16} /> {t("shareLocation")}
                </button>
              )}
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

          {errorMsg && (
            <div className="card" style={{ padding: 14, marginBottom: 14, background: "var(--accent-soft)", color: "var(--accent-strong)", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertCircle size={18} style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 14 }}>{errorMsg}</span>
            </div>
          )}

          <div className="sticky-summary">
            <div className="flex" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("total")}</span>
              <span className="price" style={{ fontSize: 20 }}>{formatETB(totals.totalHalala)}</span>
            </div>
            <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={handleSubmit}>
              {t("payWithTelegram")} · {formatETB(totals.totalHalala)}
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