import { useEffect, useState } from "react";
import { Check, Copy, Gift, Loader2, Share2, Users, Sparkles } from "lucide-react";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { api } from "../api.js";
import { haptic, tg, openExternalLink } from "../telegram.js";

interface WaitlistStatus {
  joined: boolean;
  entry?: {
    position: number;
    isEarlyBird: boolean;
    referralCode: string;
    referralCount: number;
    joinedAt: string;
  };
}

export function WaitlistPage() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<WaitlistStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralInput, setReferralInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<WaitlistStatus>("/waitlist/status")
      .then((res) => {
        setStatus(res);
        setLoading(false);
      })
      .catch(() => {
        setStatus({ joined: false });
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (tg?.initDataUnsafe?.user) {
      setFirstName(tg.initDataUnsafe.user.first_name ?? "");
      setLastName(tg.initDataUnsafe.user.last_name ?? "");
    }
  }, []);

  const handleJoin = async () => {
    if (!firstName.trim()) {
      setError(lang === "am" ? "ስም ያስፈልጋል" : "First name is required");
      return;
    }
    setJoining(true);
    setError(null);
    haptic("medium");
    try {
      const res = await api.post<{ entry: { position: number; referralCode: string } }>("/waitlist/join", {
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phone: phone.trim() || undefined,
        referralCode: referralInput.trim().toUpperCase() || undefined,
      });
      setStatus({
        joined: true,
        entry: {
          position: res.entry.position,
          isEarlyBird: true,
          referralCode: res.entry.referralCode,
          referralCount: 0,
          joinedAt: new Date().toISOString(),
        },
      });
      haptic("heavy");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to join waitlist";
      setError(msg);
    } finally {
      setJoining(false);
    }
  };

  const handleCopyCode = () => {
    if (!status?.entry?.referralCode) return;
    navigator.clipboard.writeText(status.entry.referralCode).catch(() => {});
    setCopied(true);
    haptic("light");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    if (!status?.entry?.referralCode) return;
    haptic("medium");
    const shareUrl = `https://t.me/share/url?url=https://t.me/${tg?.initDataUnsafe?.user ? "sabacos" : "sabacos"}&text=${encodeURIComponent(
      `🌸 Join the Sabacos waitlist! Use my code for early-bird perks: ${status.entry.referralCode}`
    )}`;
    openExternalLink(shareUrl);
  };

  if (loading) {
    return (
      <div className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <Loader2 size={32} style={{ animation: "spin 1.2s linear infinite", color: "var(--accent)" }} />
      </div>
    );
  }

  if (status?.joined && status.entry) {
    return (
      <div className="screen" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 16, paddingBottom: "calc(var(--nav-height) + 32px)" }}>
        <PageTitle title={lang === "am" ? "የቅድመ ምዝገባ" : "Waitlist"} />

        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "linear-gradient(135deg, var(--accent), var(--gold))",
              color: "var(--on-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              boxShadow: "0 8px 24px var(--accent-glow)",
            }}
          >
            <Sparkles size={36} />
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>
            {lang === "am" ? "በቅድመ ምዝገባ ውስጥ ነዎት!" : "You're on the list!"}
          </h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" }}>
            {lang === "am"
              ? "ወደ ፊት ቆየት ይሹኑ — በመጀመሪያ እጩዎች ብልጭታ ያላቸው ቅናሽ ያገኛሉ!"
              : "Stay tuned — early-bird members get exclusive discounts when we launch!"}
          </p>
        </div>

        <div className="card" style={{ display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, textAlign: "center", padding: "18px 8px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--accent)" }}>#{status.entry.position}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {lang === "am" ? "የምዝገባ ተbara" : "Your position"}
            </div>
          </div>
          <div style={{ width: 1, background: "var(--line)" }} />
          <div style={{ flex: 1, textAlign: "center", padding: "18px 8px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--success)" }}>
              {status.entry.referralCount}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {lang === "am" ? "ግብረ ሥርዓት" : "Referrals"}
            </div>
          </div>
          {status.entry.isEarlyBird && (
            <>
              <div style={{ width: 1, background: "var(--line)" }} />
              <div style={{ flex: 1, textAlign: "center", padding: "18px 8px" }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>✨</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {lang === "am" ? "ብልጭታ" : "Early Bird"}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12, fontWeight: 600 }}>
            {lang === "am" ? "የእርስዎ ግብረ ሥርዓት ኮድ" : "Your referral code"}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                padding: "12px 14px",
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
                fontFamily: "monospace",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: 2,
                color: "var(--accent-strong)",
                textAlign: "center",
              }}
            >
              {status.entry.referralCode}
            </div>
            <button className="btn btn-secondary" onClick={handleCopyCode} style={{ padding: "12px 14px" }}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button className="btn btn-secondary" onClick={handleShare} style={{ padding: "12px 14px" }}>
              <Share2 size={18} />
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
            {lang === "am"
              ? "ጓደያንን ያጋሩ — ለእያንዳንዱ ግብረ ሥርዓት ተጨማሪ ቅናሽ ያግኛሉ!"
              : "Share with friends — you both get extra perks for each referral!"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 16, paddingBottom: "calc(var(--nav-height) + 32px)" }}>
      <PageTitle title={lang === "am" ? "የቅድመ ምዝገባ" : "Join the Waitlist"} />

      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent), var(--gold))",
            color: "var(--on-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
            boxShadow: "0 8px 24px var(--accent-glow)",
          }}
        >
          <Users size={36} />
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>
          {lang === "am" ? "በጊዜው ውስጥ ይצטרף!" : "Get in Early!"}
        </h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          {lang === "am"
            ? "ፕሬሚየም ቆስметিকስ እየመጡ ነው — በመጀመሪያ እጩዎች ብልጭታ ያላቸው ቅናሽ ያግኙ!"
            : "Premium cosmetics are coming — join the waitlist for exclusive early-bird discounts!"}
        </p>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label>{lang === "am" ? "ስም" : "First Name"} *</label>
            <input
              value={firstName}
              placeholder={lang === "am" ? "ስም" : "First name"}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{lang === "am" ? "የአባት ስም" : "Last Name"}</label>
            <input
              value={lastName}
              placeholder={lang === "am" ? "የአባት ስም" : "Last name (optional)"}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{lang === "am" ? "ስልክ" : "Phone"}</label>
            <input
              value={phone}
              inputMode="tel"
              placeholder={lang === "am" ? "ስልክ ቁጥር" : "Phone (optional)"}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{lang === "am" ? "የግብረ ሥርዓት ኮድ" : "Referral Code"}</label>
            <input
              value={referralInput}
              placeholder={lang === "am" ? "ግብረ ሥርዓት ኮድ (በከፍተኛ)" : "Referral code (optional)"}
              onChange={(e) => setReferralInput(e.target.value.toUpperCase())}
              style={{ fontFamily: "monospace", letterSpacing: 1 }}
            />
          </div>
        </div>

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "var(--danger)" }}>{error}</p>
        )}

        <button
          className="btn btn-primary"
          style={{ width: "100%", marginTop: 16, height: 48 }}
          disabled={joining}
          onClick={handleJoin}
        >
          {joining ? (
            <Loader2 size={18} style={{ animation: "spin 1.2s linear infinite" }} />
          ) : (
            <>
              <Gift size={18} />
              {lang === "am" ? "ወደ ቅድመ ምዝገባ ተመዝግብ" : "Join the Waitlist"}
            </>
          )}
        </button>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { icon: "✨", text: lang === "am" ? "በመጀመሪያ የሚመጡት ሰዎች ውስጥ ይضاፉ" : "Be among the first to shop" },
            { icon: "💰", text: lang === "am" ? "ብልጭታ ቅናሽ ያግኙ" : "Get exclusive early-bird discount" },
            { icon: "🎁", text: lang === "am" ? "ጓደያንን አጋሩ ተጨማሪ ሽልማት ያግኙ" : "Refer friends for bonus perks" },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5 }}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
