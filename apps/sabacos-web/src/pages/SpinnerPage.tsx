import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api.js";
import { useShopStore } from "../store.js";

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

export function SpinnerPage() {
  const profile = useShopStore((s) => s.profile);
  const [availableSpins, setAvailableSpins] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const rotationRef = useRef(0);

  const loadSpins = useCallback(() => {
    api
      .get<{ availableSpins: number; spins: Spin[] }>("/referral/spinner")
      .then((res) => setAvailableSpins(res.availableSpins))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load spins"));
  }, []);

  useEffect(loadSpins, [loadSpins]);

  const spin = async () => {
    if (spinning || availableSpins <= 0) return;

    setSpinning(true);
    setResult(null);
    setError(null);

    try {
      const spinsRes = await api.get<{ spins: Spin[] }>("/referral/spinner");
      if (spinsRes.spins.length === 0) {
        setError("No available spins");
        setSpinning(false);
        return;
      }

      const firstSpin = spinsRes.spins[0];
      if (!firstSpin) {
        setError("No available spins");
        setSpinning(false);
        return;
      }
      const spinId = firstSpin.id;

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Spin failed");
    } finally {
      setSpinning(false);
    }
  };

  const shareReferral = async () => {
    try {
      const res = await api.get<{ deepLink: string }>("/referral");
      const text = encodeURIComponent(`Join Sabacos cosmetics using my link: ${res.deepLink}`);
      window.open(`https://t.me/share/url?url=${text}`, "_blank");
    } catch {
      // Ignore
    }
  };

  if (!profile) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p className="muted">Please log in to use the spinner</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 16px", maxWidth: 400, margin: "0 auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Spin the Wheel</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        {availableSpins > 0
          ? `You have ${availableSpins} free spin${availableSpins > 1 ? "s" : ""}!`
          : "Refer friends to earn spins"}
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
            borderTop: "20px solid #333",
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
            border: "4px solid #333",
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
          }}
        >
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                width: "50%",
                height: "50%",
                background: PRIZE_COLORS[i % PRIZE_COLORS.length],
                transformOrigin: "100% 100%",
                transform: `rotate(${i * 45}deg) skewY(-45deg)`,
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
              border: "3px solid #333",
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
        style={{
          width: "100%",
          padding: "14px 24px",
          fontSize: 18,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        {spinning ? "Spinning..." : availableSpins > 0 ? "Spin Now!" : "No Spins Available"}
      </button>

      {/* Error */}
      {error && (
        <div style={{ color: "var(--danger)", marginBottom: 16, fontSize: 14 }}>{error}</div>
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
              <div style={{ fontWeight: 700, fontSize: 18 }}>Spin Again!</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>You won a free spin!</div>
            </>
          ) : result.coupon ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{result.prize.name}</div>
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 16px",
                  background: "#fff",
                  borderRadius: 8,
                  border: "2px dashed var(--primary, #e91e63)",
                  fontFamily: "monospace",
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: 2,
                }}
              >
                {result.coupon.code}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Use at checkout - Expires {new Date(result.coupon.expiresAt).toLocaleDateString()}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏆</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{result.prize.name}</div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>Congratulations!</div>
            </>
          )}
        </div>
      )}

      {/* Referral CTA */}
      <div className="card" style={{ textAlign: "left" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Earn More Spins</h3>
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 14 }}>
          Every 3 friends who make a purchase = 1 free spin!
        </p>
        <button className="btn btn-outline" onClick={shareReferral} style={{ width: "100%" }}>
          Share Referral Link
        </button>
      </div>
    </div>
  );
}
