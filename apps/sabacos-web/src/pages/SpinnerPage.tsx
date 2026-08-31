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

const SLICES = 8;
const SEG = 360 / SLICES;

const SEGMENT_COLORS = [
  "#f9c9ed", "#f6eaf8", "#d9a8e8", "#f6eaf8",
  "#f3c3d8", "#f6eaf8", "#bcdce8", "#f6eaf8",
];

export function SpinnerPage() {
  const profile = useShopStore((s) => s.profile);
  const { t } = useI18n();
  const [availableSpins, setAvailableSpins] = useState(0);
  const [referralsPerSpin, setReferralsPerSpin] = useState(3);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{
    emoji: string;
    kicker: string;
    prizeLabel: string;
    code: string | null;
    expiry: string | null;
    spinAgain: boolean;
  } | null>(null);
  const [claimCopied, setClaimCopied] = useState(false);
  const wheelOuterRef = useRef<HTMLDivElement>(null);
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

  const prizeValue = (prize: Prize) => {
    if (prize.type === "spin_again") return t("spinnerSpinAgain");
    if (prize.type === "coupon_percent") return t("couponPercentOff", { value: prize.value });
    if (prize.type === "coupon_fixed") return t("couponFixedOff", { value: formatETB(prize.value) });
    return prize.name;
  };

  const openModal = (res: SpinResult) => {
    const isAgain = !!res.spinAgain;
    setModalData({
      emoji: isAgain ? "🔄" : res.coupon ? "🎉" : "🏆",
      kicker: isAgain ? t("spinnerRewardKickerLucky") : t("spinnerRewardKicker"),
      prizeLabel: prizeValue(res.prize),
      code: res.coupon?.code ?? null,
      expiry: res.coupon?.expiresAt ?? null,
      spinAgain: isAgain,
    });
    setClaimCopied(false);
    setModalOpen(true);
  };

  const claimReward = async () => {
    if (!modalData?.code) {
      if (modalData?.spinAgain) {
        setModalOpen(false);
        loadSpins();
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(modalData.code);
      setClaimCopied(true);
    } catch {
      /* manual fallback: text is already user-select:all in code box */
    }
    setTimeout(() => {
      setModalOpen(false);
      setClaimCopied(false);
    }, 900);
  };

  const spin = async () => {
    if (spinning || availableSpins <= 0) return;

    setSpinning(true);
    setModalOpen(false);
    setError(null);

    try {
      const spinsRes = await api.get<{ spins: Spin[] }>("/referral/spinner");
      if (!spinsRes.spins.length) {
        setError(t("spinnerNoAvailableSpins"));
        setSpinning(false);
        return;
      }
      const spinId = spinsRes.spins[0]!.id;

      const wheel = wheelOuterRef.current;
      if (wheel) {
        const targetRotation = rotationRef.current + 360 * 5 + Math.random() * 360;
        wheel.style.transition = "transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)";
        wheel.style.transform = `rotate(${targetRotation}deg)`;
        rotationRef.current = targetRotation;
      }

      await new Promise((resolve) => setTimeout(resolve, 4000));

      const res = await api.post<SpinResult>("/referral/spinner/spin", { spinId });
      setAvailableSpins((prev) => prev - 1);
      openModal(res);
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
      /* ignore */
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

      {/* ── Casino-style wheel ─────────────────────────────── */}
      <div style={{ position: "relative", width: 320, height: 320, margin: "34px auto 28px" }}>
        {/* Outer glow halo */}
        <div style={{
          position: "absolute", inset: -14, borderRadius: "50%",
          border: "2px solid rgba(196,75,197,0.3)",
          boxShadow: "0 0 60px 8px rgba(196,75,197,0.3)",
          pointerEvents: "none",
        }} />

        {/* Pointer (SVG needle) */}
        <div style={{
          position: "absolute", top: -38, left: "50%", transform: "translateX(-50%)",
          width: 52, height: 68, zIndex: 10,
        }}>
          <svg viewBox="0 0 52 68" width="100%" height="100%">
            <path d="M26 4 C12 4 4 16 4 30 C4 43 14 48 26 66 C38 48 48 43 48 30 C48 16 40 4 26 4 Z"
              fill="var(--on-accent, #2a000c)" stroke="var(--accent-strong, #c44bc5)" strokeWidth="3" />
            <circle cx="26" cy="28" r="9" fill="#6b1d5e" stroke="var(--accent, #f88df7)" strokeWidth="2" />
          </svg>
        </div>

        {/* Crusted rim */}
        <div
          ref={wheelOuterRef}
          style={{
            width: 320, height: 320, borderRadius: "50%",
            background: "linear-gradient(135deg, #ffd1f6, #f3a9e8, var(--accent, #f88df7), #e47fe0)",
            boxShadow: "0 0 70px 16px rgba(196,75,197,0.3), 0 12px 34px rgba(42,0,12,0.15), inset 0 0 0 2px rgba(255,255,255,0.45)",
            padding: 12,
          }}
        >
          {/* Wheel face */}
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%",
            border: "3px solid #d065c9", overflow: "hidden",
            position: "relative",
          }}>
            {/* Conic-gradient slices */}
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: `conic-gradient(from -22.5deg, ${
                SEGMENT_COLORS.map((c, i) =>
                  `${c} ${(i * SEG + 0.5)}deg, ${c} ${((i + 1) * SEG - 0.5)}deg`
                ).join(", ")
              })`,
            }} />

            {/* Radial labels */}
            {Array.from({ length: SLICES }).map((_, i) => {
              const a = i * SEG;
              const rad = (a * Math.PI) / 180;
              const R = 78;
              const cx = 148;
              const cy = 148;
              const theta = a - 90;
              const rotate = (theta > 90 || theta < -90) ? theta - 180 : theta;
              const isETB = i === 1 || i === 3;

              const labels = ["10%", "50 ETB", "5%", "100 ETB", "20%", "15%", "SPIN\nAGAIN", "25%"];
              const text = labels[i] ?? "";
              const isBr = text.includes("\n");

              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: cx + R * Math.sin(rad),
                    top: cy - R * Math.cos(rad),
                    transform: `translate(-50%,-50%) rotate(${rotate}deg)`,
                    fontWeight: 800,
                    textAlign: "center",
                    lineHeight: 1.05,
                    color: "#6b1d5e",
                    whiteSpace: "nowrap",
                    zIndex: 4,
                    textShadow: "0 1px 0 rgba(255,255,255,0.6)",
                    fontSize: isBr ? 11 : isETB ? 13 : 16,
                  }}
                >
                  {isBr ? text.split("\n").map((ln, li) => <div key={li}>{ln}</div>) : text}
                </div>
              );
            })}

            {/* Center SPIN hub */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              width: 84, height: 84, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #fff, #f6ecf3 75%)",
              border: "4px solid #e47fe0",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column",
              color: "var(--accent-strong, #c44bc5)",
              fontWeight: 800, zIndex: 6,
              boxShadow: "0 3px 12px rgba(42,0,12,0.18), inset 0 0 0 2px #fff",
              textAlign: "center", lineHeight: 1,
              pointerEvents: "none",
            }}>
              <span style={{ fontSize: 15, letterSpacing: "0.08em" }}>SPIN</span>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "var(--muted, #9e6379)", marginTop: 3 }}>SABACOS</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Spin button ────────────────────────────────────── */}
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

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div style={{ color: "var(--danger)", marginBottom: 16, fontSize: 14, display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
          <span>{error}</span>
        </div>
      )}

      {/* ── Claim modal (glow dialog) ──────────────────────── */}
      {modalOpen && modalData && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setModalOpen(false); } }}
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(42,0,12,0.45)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
            animation: "modalFade 0.2s ease both",
          }}
        >
          <style>{`
            @keyframes modalFade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes modalPop { from { transform: scale(0.7) translateY(20px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
            @keyframes modalBounce { 0% { transform: scale(0.5); opacity: 0; } 60% { transform: scale(1.15); } 100% { transform: scale(1); opacity: 1; } }
          `}</style>
          <div style={{
            width: "100%", maxWidth: 340, borderRadius: 24, padding: "26px 22px",
            textAlign: "center", position: "relative", overflow: "hidden",
            background: "radial-gradient(120% 120% at 50% 0%, #fff, #fdebf7 60%, #f9d2ef 100%)",
            border: "2px solid rgba(196,75,197,0.4)",
            boxShadow: "0 0 60px 10px rgba(196,75,197,0.45), 0 18px 40px rgba(42,0,12,0.25)",
            animation: "modalPop 0.4s cubic-bezier(0.2,1.4,0.4,1) both",
          }}>
            {/* Halo glow */}
            <div style={{
              position: "absolute", inset: -30,
              background: "radial-gradient(circle at 50% 0%, rgba(248,141,247,0.4), transparent 60%)",
              pointerEvents: "none",
            }} />

            {/* Emoji */}
            <div style={{
              fontSize: 46, margin: "6px 0 10px", position: "relative",
              animation: "modalBounce 0.6s 0.2s both", display: "inline-block",
            }}>
              {modalData.emoji}
            </div>

            {/* Kicker */}
            <div style={{
              fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase" as const,
              color: "var(--accent-strong, #c44bc5)", fontWeight: 700, position: "relative",
            }}>
              {modalData.kicker}
            </div>

            {/* Prize label */}
            <div style={{
              fontSize: 22, fontWeight: 800, color: "var(--ink, #2a000c)", margin: "6px 0 4px",
              position: "relative",
            }}>
              {modalData.prizeLabel}
            </div>

            {modalData.spinAgain ? (
              <>
                {/* Spin-again note */}
                <div style={{
                  fontSize: 15, fontWeight: 600, color: "var(--accent-strong, #c44bc5)",
                  margin: "12px 0 16px", position: "relative",
                }}>
                  {t("spinnerClaimAgain")}
                </div>
                <button
                  onClick={claimReward}
                  style={{
                    width: "100%", padding: 14, border: "none", borderRadius: 999,
                    fontSize: 16, fontWeight: 800, cursor: "pointer", position: "relative",
                    background: "linear-gradient(135deg, var(--accent, #f88df7), var(--accent-strong, #c44bc5))",
                    color: "var(--on-accent, #2a000c)",
                    boxShadow: "0 8px 22px var(--accent-glow, rgba(196,75,197,0.35)), 0 0 30px rgba(248,141,247,0.5)",
                  }}
                >
                  {t("spinnerSpinNow")}
                </button>
              </>
            ) : (
              <>
                {/* Sub text */}
                <div style={{ fontSize: 13, color: "var(--muted, #9e6379)", marginBottom: 16, position: "relative" }}>
                  {modalData.expiry
                    ? t("spinnerUseAtCheckout", { date: new Date(modalData.expiry).toLocaleDateString() })
                    : t("spinnerCongratulations")}
                </div>

                {/* Coupon code box */}
                {modalData.code && (
                  <div style={{
                    margin: "0 0 18px", padding: 14,
                    background: "#fff", borderRadius: 14,
                    border: "2px dashed var(--accent-strong, #c44bc5)",
                    boxShadow: "0 0 24px rgba(196,75,197,0.3), inset 0 0 12px rgba(196,75,197,0.12)",
                    position: "relative",
                  }}>
                    <div style={{ fontSize: 11, color: "var(--muted, #9e6379)", marginBottom: 6 }}>{t("spinnerYourCode")}</div>
                    <div style={{
                      fontFamily: "monospace", fontSize: 22, fontWeight: 800, letterSpacing: 3,
                      color: "var(--accent-strong, #c44bc5)", userSelect: "all",
                    }}>
                      {modalData.code}
                    </div>
                  </div>
                )}

                {/* Claim button */}
                <button
                  onClick={claimReward}
                  style={{
                    width: "100%", padding: 14, border: "none", borderRadius: 999,
                    fontSize: 16, fontWeight: 800, cursor: "pointer", position: "relative",
                    background: claimCopied
                      ? "var(--success, #5d8c5a)"
                      : "linear-gradient(135deg, var(--accent, #f88df7), var(--accent-strong, #c44bc5))",
                    color: "#fff",
                    boxShadow: claimCopied
                      ? "none"
                      : "0 8px 22px var(--accent-glow, rgba(196,75,197,0.35)), 0 0 30px rgba(248,141,247,0.5)",
                    transition: "background 0.2s, box-shadow 0.2s",
                  }}
                >
                  {claimCopied ? t("spinnerClaimCopied") : t("spinnerClaim")}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Referral CTA ───────────────────────────────────── */}
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
