import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Loader2, AlertCircle, ArrowRight, MapPin, User, X, Zap, Truck, Tag, Wallet, Building2, Upload, Check } from "lucide-react";
import { DEFAULT_DELIVERY_CONFIG, formatETB, quoteDelivery, computeDeliveryFee, t, BANK_LABELS, type BankName, type BankAccount } from "@sabacos/core";
import type { DeliveryConfig } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { api } from "../api.js";
import { PageTitle } from "../components/PageTitle.js";
import { FormField } from "../components/FormField.js";
import { useShopStore, apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";
import { isTelegramSession, haptic, payInvoice, closeToChat } from "../telegram.js";

type Phase = "form" | "pending" | "success" | "failed" | "bank_select" | "receipt_upload";

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
  const refreshCart = useShopStore((s) => s.refreshCart);
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
  const [orderPaymentMethod, setOrderPaymentMethod] = useState<"telegram" | "wallet" | "bank_split">("telegram");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"telegram" | "wallet" | "bank_split">("bank_split");
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Bank split payment state
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef = useRef(false);

  const totals = cart.totals;
  const fragile = cart.items.some((i) => i.product.isFragile);

  // When no zone is selected (no GPS, no manual pick), use the flat delivery
  // fee from admin settings so the checkout matches the cart page.  Once a zone
  // is resolved we switch to the zone-based engine.
  const hasZone = coords != null || manualZone != null;
  const flatFee = cart.deliveryFeeHalala ?? 0;
  const flatThreshold = cart.freeDeliveryThresholdHalala ?? 0;

  // Live delivery estimate mirrors the server exactly (same core engine).
  const estimate = useMemo(() => {
    if (!hasZone) {
      // No zone yet — use the simple flat-fee logic (matches cart page).
      const fee = computeDeliveryFee(totals.subtotalHalala, flatFee, flatThreshold);
      return {
        zone: null,
        baseFeeHalala: fee,
        zoneSurchargeHalala: 0,
        expressSurchargeHalala: 0,
        fragileFeeHalala: 0,
        totalDeliveryFeeHalala: deliveryType === "express" ? fee + Math.round(fee * 0.5) : fee,
        freeDeliveryApplied: fee === 0,
        express: deliveryType === "express",
      };
    }
    return quoteDelivery(deliveryConfig, {
      subtotalHalala: totals.subtotalHalala,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      zone: coords ? null : manualZone,
      express: deliveryType === "express",
      fragile,
    });
  }, [hasZone, deliveryConfig, totals.subtotalHalala, coords, manualZone, deliveryType, fragile, flatFee, flatThreshold]);

  useEffect(() => {
    api.get<{ config: DeliveryConfig }>("/delivery/config")
      .then((res) => res.config && setDeliveryConfig(res.config))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api.get<{ walletBalance: number }>("/referral")
      .then((res) => setWalletBalance(res.walletBalance ?? 0))
      .catch(() => undefined)
      .finally(() => setWalletLoading(false));
  }, []);

  useEffect(() => {
    api.get<{ accounts: BankAccount[] }>("/bank-accounts")
      .then((res) => {
        setBankAccounts(res.accounts);
        if (res.accounts[0]) setSelectedBankId(res.accounts[0].id);
      })
      .catch(() => undefined);
  }, []);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    haptic();
    setCouponCode(code);
    try {
      const cartSummary = await refreshCart(code);
      const err = cartSummary.couponError;
      if (err === "not_owned") setErrorMsg(t("couponNotOwned"));
      else if (err === "used") setErrorMsg(t("couponAlreadyUsed"));
      else if (err === "expired" || err === "invalid") setErrorMsg(t("invalidCoupon"));
      else if (err === "min_order") setErrorMsg(t("couponMinOrder"));
      else if (!err) setErrorMsg(null);
    } catch (err) {
      setErrorMsg(apiErrorMessage(err));
    }
  };

  const handleRemoveCoupon = async () => {
    haptic();
    setCouponCode(null);
    setCouponInput("");
    setErrorMsg(null);
    try {
      await refreshCart("");
    } catch {
      // ignore — cart will refresh on next render
    }
  };

  const grandTotal = totals.subtotalHalala + estimate.totalDeliveryFeeHalala;

  const priceFor = (express: boolean) => {
    if (!hasZone) {
      const fee = computeDeliveryFee(totals.subtotalHalala, flatFee, flatThreshold);
      if (express) return fee + Math.round(fee * 0.5);
      return fee;
    }
    return quoteDelivery(deliveryConfig, {
      subtotalHalala: totals.subtotalHalala,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      zone: coords ? null : manualZone,
      express,
      fragile,
    }).totalDeliveryFeeHalala;
  };

  const freeGap =
    (hasZone ? deliveryConfig.freeThresholdHalala : flatThreshold) - totals.subtotalHalala;
  const showFreeNudge =
    freeGap > 0 && freeGap <= 20000 && !estimate.freeDeliveryApplied && deliveryType === "standard";

  const canSubmit = useMemo(
    () =>
      form.customerName.trim().length >= 2 &&
      form.phone.trim().length >= 7 &&
      form.address.trim().length >= 5,
    [form],
  );

  const fieldErrors = useMemo(() => {
    const e: Record<string, string | null> = {};
    const name = form.customerName.trim();
    const phone = form.phone.trim();
    const addr = form.address.trim();
    if (touched.customerName) {
      e.customerName = name.length < 2 ? t("nameTooShort") : name.length > 120 ? t("fieldTooLong") : null;
    }
    if (touched.phone) {
      e.phone = phone.length < 7 ? t("invalidPhone") : phone.length > 30 ? t("fieldTooLong") : null;
    }
    if (touched.address) {
      e.address = addr.length < 5 ? t("invalidAddress") : addr.length > 500 ? t("fieldTooLong") : null;
    }
    if (touched.note && form.note.length > 500) {
      e.note = t("fieldTooLong");
    }
    return e;
  }, [form, touched]);

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
    setTouched({ customerName: true, phone: true, address: true, note: true });
    if (!canSubmit) return;
    submittingRef.current = true;
    setErrorMsg(null);
    try {
      // For bank_split, go to bank selection phase first
      if (paymentMethod === "bank_split") {
        setPhase("bank_select");
        submittingRef.current = false;
        return;
      }

      const { order, invoiceUrl } = await checkout({
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
        note: form.note.trim() || null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        zone: coords ? null : manualZone,
        deliveryType,
        couponCode: couponCode ?? undefined,
        paymentMethod,
      });
      setOrderId(order.id);
      setOrderNo(order.orderNo);
      setOrderPaymentMethod(paymentMethod);

      // Wallet and bank_split payments are finalized server-side — no invoice to open.
      if (!invoiceUrl) {
        await clearCart();
        setOrderTotal(order.totalHalala);
        haptic("heavy");
        setPhase("success");
        return;
      }

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

  const handleBankConfirm = async () => {
    if (!selectedBankId) {
      toast("Please select a bank");
      return;
    }
    haptic();
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
        couponCode: couponCode ?? undefined,
        paymentMethod: "bank_split",
        bankAccountId: selectedBankId,
      });
      setOrderId(order.id);
      setOrderNo(order.orderNo);
      setOrderPaymentMethod("bank_split");
      setOrderTotal(order.totalHalala);
      await clearCart();
      setPhase("receipt_upload");
    } catch (err) {
      setErrorMsg(apiErrorMessage(err));
      setPhase("failed");
    } finally {
      submittingRef.current = false;
    }
  };

  const handleReceiptUpload = async () => {
    if (!orderId || !receiptFile) return;
    haptic();
    setUploadingProof(true);
    try {
      const formData = new FormData();
      formData.append("receipt", receiptFile);
      await api.post(`/orders/${orderId}/payment-proof`, formData);
      haptic("heavy");
      setPhase("success");
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setUploadingProof(false);
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

  if (phase === "bank_select") {
    const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
    const deposit = Math.round(grandTotal / 2);
    return (
      <div className="screen" style={{ paddingTop: "calc(var(--safe-top) + 24px)" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>
          <h1 className="serif" style={{ fontSize: 24, margin: "0 0 8px" }}>{t("selectBank")}</h1>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            {lang === "am"
              ? `${formatETB(deposit)} ግማሽ አሁን ይ躍ልጉ፣ ቀሪው ${formatETB(grandTotal - deposit)} ሲደርስ ይከፈላል`
              : `Pay ${formatETB(deposit)} deposit now, ${formatETB(grandTotal - deposit)} on delivery`}
          </p>

          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {bankAccounts.map((bank) => (
              <button
                key={bank.id}
                type="button"
                className={`zone-option${selectedBankId === bank.id ? " active" : ""}`}
                onClick={() => { haptic(); setSelectedBankId(bank.id); }}
                style={{ textAlign: "left" }}
              >
                <span style={{ fontWeight: 600 }}>
                  <Building2 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
                  {BANK_LABELS[bank.bankName as BankName]?.[lang as "en" | "am"] ?? BANK_LABELS[bank.bankName as BankName]?.en ?? bank.bankName}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {bank.accountName} · {bank.accountNumber}
                </span>
              </button>
            ))}
          </div>

          {selectedBank && (
            <div className="card" style={{ padding: 18, marginBottom: 16, background: "var(--accent-soft)" }}>
              <h3 style={{ fontSize: 15, margin: "0 0 10px", fontWeight: 700 }}>{t("bankAccountDetails")}</h3>
              <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t("accountHolder")}</span>
                  <strong>{selectedBank.accountName}</strong>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t("accountNumber")}</span>
                  <strong style={{ fontFamily: "monospace", letterSpacing: 1 }}>{selectedBank.accountNumber}</strong>
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="muted">{t("depositAmount")}</span>
                  <strong style={{ color: "var(--success)" }}>{formatETB(deposit)}</strong>
                </div>
              </div>
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            onClick={handleBankConfirm}
            disabled={!selectedBankId}
          >
            {t("continueBtn")} <ArrowRight size={16} />
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 4 }} onClick={() => setPhase("form")}>
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "receipt_upload" && orderId) {
    return (
      <div className="screen" style={{ paddingTop: "calc(var(--safe-top) + 24px)" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>
          <h1 className="serif" style={{ fontSize: 24, margin: "0 0 8px" }}>{t("uploadReceipt")}</h1>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{t("uploadReceiptHint")}</p>

          <div className="card" style={{ padding: 18, marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <span className="muted">{t("orderNumber")}</span>
              <strong>{orderNo}</strong>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("depositAmount")}</span>
              <strong style={{ color: "var(--success)" }}>{formatETB(Math.round(orderTotal / 2))}</strong>
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: 24,
              marginBottom: 16,
              textAlign: "center",
              border: receiptFile ? "2px solid var(--success)" : "2px dashed var(--border)",
              cursor: "pointer",
              background: receiptFile ? "var(--success-soft, #e8f5e9)" : "transparent",
            }}
            onClick={() => document.getElementById("receipt-input")?.click()}
          >
            <input
              id="receipt-input"
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setReceiptFile(file);
                  setReceiptPreview(URL.createObjectURL(file));
                }
              }}
            />
            {receiptFile ? (
              <>
                <Check size={32} color="var(--success)" style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{receiptFile.name}</p>
                <p className="muted" style={{ fontSize: 12 }}>{(receiptFile.size / 1024 / 1024).toFixed(1)} MB</p>
                {receiptPreview && (
                  <img src={receiptPreview} alt="Receipt" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 8, marginTop: 12 }} />
                )}
              </>
            ) : (
              <>
                <Upload size={32} style={{ marginBottom: 8, color: "var(--muted)" }} />
                <p style={{ fontSize: 14, fontWeight: 600 }}>{t("uploadReceipt")}</p>
                <p className="muted" style={{ fontSize: 12 }}>JPEG, PNG, WebP</p>
              </>
            )}
          </div>

          <button
            className="btn btn-primary btn-block"
            onClick={handleReceiptUpload}
            disabled={!receiptFile || uploadingProof}
          >
            {uploadingProof ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
            {" "}{t("verifyPayment")}
          </button>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 4 }} onClick={() => setPhase("bank_select")}>
            {t("back")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "success" && orderNo) {
    return (
      <div className="screen" style={{ paddingTop: "calc(var(--safe-top) + 24px)" }}>
        <div className="text-center" style={{ paddingTop: 40 }}>
          <CheckCircle2 size={72} strokeWidth={1.25} color="var(--success)" />
          <h1 className="serif" style={{ fontSize: 28, margin: "18px 0 6px" }}>{t("orderConfirmed")}</h1>
          <p className="muted">
            {orderPaymentMethod === "bank_split"
              ? t("paymentPendingVerificationHint")
              : t("orderConfirmedHint")}
          </p>
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
            {cart.couponDiscountHalala != null && cart.couponDiscountHalala > 0 && (
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6, color: "var(--success)" }}>
                <span style={{ fontSize: 13 }}>{cart.couponDiscountLabel ?? "Coupon"}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>-{formatETB(cart.couponDiscountHalala)}</span>
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
            <FormField
              label={t("fullName")}
              value={form.customerName}
              onChange={(v) => setForm({ ...form, customerName: v })}
              onBlur={() => setTouched((p) => ({ ...p, customerName: true }))}
              placeholder={t("fullName")}
              error={fieldErrors.customerName}
              minLength={2}
              maxLength={120}
              required
            />
            <FormField
              label={t("phone")}
              value={form.phone}
              onChange={(v) => setForm({ ...form, phone: v })}
              onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
              placeholder="+251 91 234 5678"
              error={fieldErrors.phone}
              inputMode="tel"
              minLength={7}
              maxLength={30}
              required
              suffix={isTelegramSession() ? (
                <button type="button" className="btn btn-secondary" style={{ flexShrink: 0, padding: "0 12px" }} onClick={handleSharePhone} title={t("sharePhone")}>
                  <User size={16} />
                </button>
              ) : undefined}
            />
            <FormField
              label={t("deliveryAddress")}
              value={form.address}
              onChange={(v) => setForm({ ...form, address: v })}
              onBlur={() => setTouched((p) => ({ ...p, address: true }))}
              placeholder={t("addressPlaceholder")}
              error={fieldErrors.address}
              rows={3}
              maxLength={500}
              required
            />
            <div style={{ marginBottom: 0 }}>
              <FormField
                label={t("note")}
                value={form.note}
                onChange={(v) => setForm({ ...form, note: v })}
                onBlur={() => setTouched((p) => ({ ...p, note: true }))}
                placeholder={t("note")}
                error={fieldErrors.note}
                maxLength={500}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 18 }}>
            <h2 style={{ fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>{t("couponCode")}</h2>
            {couponCode ? (
              <div className="row" style={{ gap: 8 }}>
                <div className="zone-option active btn-block" style={{ cursor: "default", textTransform: "uppercase" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Tag size={15} /> {couponCode}
                  </span>
                </div>
                <button type="button" className="btn btn-secondary" style={{ flexShrink: 0, padding: "0 12px" }} onClick={handleRemoveCoupon}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="row" style={{ gap: 8 }}>
                <input
                  value={couponInput}
                  placeholder={t("couponPlaceholder")}
                  style={{ flex: 1, textTransform: "uppercase" }}
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleApplyCoupon();
                    }
                  }}
                />
                <button type="button" className="btn btn-secondary" style={{ flexShrink: 0, padding: "0 14px" }} onClick={handleApplyCoupon} disabled={!couponInput.trim()}>
                  {t("apply")}
                </button>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>
              💎 {lang === "am" ? "ከሽልማት ማሽከርከር የወጡ ኩፖኖችን እዚህ ይጠቀሙ" : "Win coupons from the reward spinner and use them here"}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 14, padding: 18 }}>
            <h2 style={{ fontSize: 17, margin: "0 0 12px", fontWeight: 700 }}>{t("paymentMethod")}</h2>
            <div style={{ display: "grid", gap: 6 }}>
              <button
                type="button"
                className="zone-option"
                disabled
                style={{ opacity: 0.5, cursor: "not-allowed" }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <Zap size={15} /> {t("payWithTelegram")}
                  <span style={{ fontSize: 10, background: "var(--accent-soft)", color: "var(--accent-strong)", padding: "2px 6px", borderRadius: 6, fontWeight: 700 }}>
                    {t("comingSoon")}
                  </span>
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{t("payWithTelegramHint")}</span>
              </button>
              <button
                type="button"
                className={`zone-option${paymentMethod === "bank_split" ? " active" : ""}`}
                onClick={() => {
                  haptic();
                  setPaymentMethod("bank_split");
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                  <Building2 size={15} /> {t("payWithBankHalf")}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>{t("payWithBankHalfHint")}</span>
              </button>
              {bankAccounts.length > 0 && (
                <button
                  type="button"
                  className={`zone-option${paymentMethod === "wallet" ? " active" : ""}`}
                  onClick={() => {
                    haptic();
                    setPaymentMethod("wallet");
                  }}
                  disabled={walletLoading}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                    <Wallet size={15} /> {t("payWithWallet")}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {walletLoading ? "…" : t("walletPayLabel") + ": " + formatETB(walletBalance)}
                  </span>
                </button>
              )}
            </div>
            {paymentMethod === "wallet" && walletBalance < grandTotal && (
              <p style={{ fontSize: 12.5, margin: "8px 2px 0", color: "var(--danger, #d32f2f)", fontWeight: 600 }}>
                {t("walletInsufficient")}
              </p>
            )}
            {paymentMethod === "wallet" && walletBalance >= grandTotal && (
              <p className="muted" style={{ fontSize: 12.5, margin: "8px 2px 0" }}>
                {t("payWithWalletHint")}
              </p>
            )}
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
            <button
              className="btn btn-primary btn-block"
              disabled={!canSubmit || (paymentMethod === "wallet" && walletBalance < grandTotal)}
              onClick={handleSubmit}
            >
              {paymentMethod === "wallet"
                ? `${t("payWithWallet")} · ${formatETB(grandTotal)}`
                : paymentMethod === "bank_split"
                  ? `${t("payWithBankHalf")} · ${formatETB(grandTotal)}`
                  : `${t("payWithTelegram")} · ${formatETB(grandTotal)}`}
            </button>
            <p className="muted text-center" style={{ margin: 0, fontSize: 12, fontWeight: 500 }}>
              {paymentMethod === "wallet" ? t("payWithWalletHint") : paymentMethod === "bank_split" ? t("payWithBankHalfHint") : t("payWithTelegramHint")}
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
