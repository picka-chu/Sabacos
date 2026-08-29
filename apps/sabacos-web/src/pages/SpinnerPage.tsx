import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, Share2 } from "lucide-react";
import { formatETB } from "@sabacos/core";
import { api } from "../api.js";
import { useShopStore } from "../store.js";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";

interface Spin {
  id: string;
  status: string;
  expiresAt: string | null;
}

interface Prize {
  name: string;
  type: string;
  value: number;
}

interface SpinResult {
  prize: Prize;
  coupon?: { code: string; discountType: string; discountValue: number; expiresAt: string };
  spinAgain?: boolean;
}

const PRIZE_COLORS = [
  "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
  "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
];

const SEGMENTS = 8;

export function SpinnerPage() {
  const profile = useShopStore((s) => s.profile);
  const { t } = useI18n();
  const [availableSpins, setAvailableSpins] = useState(0);
  const [referralsPerSpin, setReferralsPerSpin] = useState(3);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);

  const loadSpins = useCallback(() => {
    api
      .get<{ availableSpins: number; spins: Spin[]; referralsPerSpin?: number }>("/referral/spinner")
      .then((res) => {
        setAvailableSpins(res.availableSpins);
        if (res.referralsPerSpin) setReferralsPerSpin(res.referralsPerSpin);
      })
      .catch(() => setError(t("spinnerLoadFailed")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(loadSpins, [loadSpins]);

  const spin = async () => {
    if (spinning || availableSpins <= 0) return;

    setSpinning(true);
    setResult(null);
    setError(null);

    try {
      const spinsRes = await api.get<{ spins: Spin[] }>("/referral/spinner");
      if (!spinsRes.spins.length) {
        setError(t("spinnerNoAvailableSpins"));
        setSpinning(false);
        return;
      }
      const spinId = spinsRes.spins[0]!.id;

      // Animate wheel
      const wheel = wheelRef.current;
      if (wheel) {
        const targetRotation = rotationRef.current + 360 * 5 + Math.random() * 360;
        wheel.style.transition = "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)";
        wheel.style.transform = `rotate(${targetRotation}deg)`;
        rotationRef.current = targetRotation;
      }

      // Wait for animation then call API
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const res = await api.post<SpinResult>("/referral/spinner/spin", { spinId });
      setResult(res);
      setAvailableSpins((prev) => prev - 1);

      if (res.spinAgain) {
        setTimeout(() => {
          loadSpins();
          setResult(null);
        }, 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("spinnerSpinFailed"));
    } finally {
      setSpinning(false);
    }
  };

  const shareReferral = async () => {
    try {
      const res = await api.get<{ deepLink: string }>("/referral");
      const url = encodeURIComponent(res.deepLink);
      const text = encodeURIComponent(t("inviteFriendsHint"));
      window.open(`https://t.me/share/url?url=${url}&text=${text}`, "_blank");
    } catch {
      // Ignore
    }
  };

  if (!profile) {
    return (
      <div className="screen">
        <PageTitle title={t("spinnerTitle")} />
        <div style={{ padding: 40, textAlign: "center" }}>
          <p className="muted">{t("spinnerLoginRequired")}</p>
        </div>
      </div>
    );
  }

  const prizeValue = (prize: SpinResult["prize"]) => {
    if (prize.type === "spin_again") return t("spinnerSpinAgain");
    if (prize.type === "coupon_percent") return t("couponPercentOff", { value: prize.value });
    if (prize.type === "coupon_fixed") return t("couponFixedOff", { value: formatETB(prize.value) });
    return prize.name;
  };

  return (
    <div className="screen">
      <PageTitle title={t("spinnerTitle")} />

      <p className="muted" style={{ textAlign: "center", marginBottom: 20 }}>
        {availableSpins > 0
          ? availableSpins === 1
            ? t("spinnerSpinsAvailable")
            : t("spinnerSpinsAvailablePlural", { count: availableSpins })
          : t("spinnerNoSpinsHint")}
      </p>

      {/* Wheel */}
      <div style={{ position: "relative", width: 280, height: 280, margin: "0 auto 24px" }}>
        {/* Pointer */}
        <div
          style={{
            position: "absolute",
            top: -10,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "12px solid transparent",
            borderRight: "12px solid transparent",
            borderTop: "20px solid var(--accent, #333)",
            zIndex: 10,
          }}
        />
        {/* Wheel segments */}
        <div
          ref={wheelRef}
          style={{
            width: 280,
            height: 280,
            borderRadius: "50%",
            border: "4px solid var(--accent, #333)",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          }}
        >
          {[...Array(SEGMENTS)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: "50%",
                height: "50%",
                background: PRIZE_COLORS[i % PRIZE_COLORS.length],
                transformOrigin: "100% 100%",
                transform: `rotate(${i * (360 / SEGMENTS)}deg) skewY(-${90 - 360 / SEGMENTS}deg)`,
                left: 0,
                top: 0,
              }}
            />
          ))}
          {/* Center circle */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "#fff",
              border: "3px solid var(--accent, #333)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              zIndex: 5,
            }}
          >
            🎁
          </div>
        </div>
      </div>

      {/* Spin button */}
      <button
        className="btn btn-primary"
        onClick={spin}
        disabled={spinning || availableSpins <= 0}
        style={{ width: "100%", padding: "14px 24px", fontSize: 18, fontWeight: 700, marginBottom: 16 }}
      >
        {spinning ? (
          <>
            <Loader2 size={20} className="spin" style={{ animation: "spin 1.2s linear infinite", verticalAlign: -3, marginRight: 8 }} />
            {t("spinnerSpinning")}
          </>
        ) : availableSpins > 0 ? (
          t("spinnerSpinNow")
        ) : (
          t("spinnerNoSpins")
        )}
      </button>

      {/* Error */}
      {error && (
        <div style={{ color: "var(--danger)", marginBottom: 16, fontSize: 14, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: result.prize.type === "spin_again" ? "#e3f2fd" : "#e8f5e9",
          }}
        >
          {result.spinAgain ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{t("spinnerSpinAgain")}</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{t("spinnerSpinAgainWon")}</div>
            </>
          ) : result.coupon ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{prizeValue(result.prize)}</div>
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 16px",
                  background: "#fff",
                  borderRadius: 8,
                  border: "2px dashed var(--accent, #e91e63)",
                  fontFamily: "monospace",
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: 2,
                  userSelect: "all",
                }}
              >
                {result.coupon.code}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {t("spinnerUseAtCheckout", { date: new Date(result.coupon.expiresAt).toLocaleDateString() })}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{prizeValue(result.prize)}</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{t("spinnerCongratulations")}</div>
            </>
          )}
        </div>
      )}

      {/* Referral CTA */}
      <div className="card" style={{ textAlign: "left" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{t("spinnerEarnMoreSpins")}</h3>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {t("spinnerEarnHint", { n: referralsPerSpin })}
        </p>
        <button className="btn btn-outline" onClick={shareReferral} style={{ width: "100%" }}>
          <Share2 size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
          {t("shareReferralLink")}
        </button>
      </div>
    </div>
  );
}