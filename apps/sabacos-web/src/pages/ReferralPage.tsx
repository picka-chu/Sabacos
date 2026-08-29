import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Copy, Gift, Share2, Sparkles, Trophy, Wallet, ChevronRight, Clock, CheckCircle2, Hourglass, Ticket } from "lucide-react";
import { useLocation } from "wouter";
import { formatETB } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { api } from "../api.js";
import { useShopStore } from "../store.js";
import { toast } from "../components/Toast.js";
import { haptic } from "../telegram.js";

interface ReferralInfo {
  code: string | null;
  deepLink: string | null;
  qualifiedCount: number;
  availableSpins: number;
  referralProgress: string | null;
  walletBalance: number;
  validCoupons: number;
  settings: {
    firstPurchasePercent: number;
    referralsPerSpin: number;
    monthlyCapHalala: number;
  } | null;
}

interface ReferralHistoryItem {
  id: string;
  referredId: string;
  referralCode: string;
  status: string;
  qualifiedAt: string | null;
  createdAt: string;
  referred?: { firstName?: string; username?: string } | null;
}

interface WalletTransaction {
  id: string;
  amountHalala: number;
  type: string;
  description: string;
  createdAt: string;
}

interface Coupon {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  expiresAt: string;
}

export function ReferralPage() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const profile = useShopStore((s) => s.profile);

  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [history, setHistory] = useState<ReferralHistoryItem[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "wallet" | "history">("overview");

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const [infoRes, historyRes, walletRes, couponsRes] = await Promise.all([
        api.get<ReferralInfo>("/referral"),
        api.get<{ referrals: ReferralHistoryItem[] }>("/referral/history"),
        api.get<{ transactions: WalletTransaction[] }>("/referral/wallet"),
        api.get<{ coupons: Coupon[] }>("/referral/spinner/coupons"),
      ]);
      setInfo(infoRes);
      setHistory(historyRes.referrals);
      setTransactions(walletRes.transactions);
      setCoupons(couponsRes.coupons);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { load(); }, [load]);

  const copyCode = () => {
    if (!info?.code) return;
    navigator.clipboard.writeText(info.code).then(() => {
      haptic("light");
      toast(t("copied"));
    }).catch(() => {});
  };

  const copyLink = () => {
    if (!info?.deepLink) return;
    navigator.clipboard.writeText(info.deepLink).then(() => {
      haptic("light");
      toast(t("copied"));
    }).catch(() => {});
  };

  const shareLink = () => {
    if (!info?.deepLink) return;
    haptic("light");
    const text = encodeURIComponent(`${t("inviteFriendsHint")} ${info.deepLink}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(info.deepLink)}&text=${text}`, "_blank");
  };

  if (!profile) {
    return (
      <div className="screen" style={{ padding: 40, textAlign: "center" }}>
        <p className="muted">{t("loading")}</p>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageTitle title={t("referralTitle")} />

      {/* Tabs */}
      <div className="chip-scroll" style={{ marginTop: 8, marginBottom: 12 }}>
        {(["overview", "wallet", "history"] as const).map((key) => (
          <button
            key={key}
            className={`chip ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {key === "overview" ? t("referralTitle") : key === "wallet" ? t("walletBalance") : t("referralHistory")}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: "40px 0", textAlign: "center" }}>
          <div className="skeleton" style={{ width: 200, height: 20, margin: "0 auto 12px" }} />
          <div className="skeleton" style={{ width: 150, height: 16, margin: "0 auto" }} />
        </div>
      ) : tab === "overview" ? (
        <OverviewTab info={info} copyCode={copyCode} copyLink={copyLink} shareLink={shareLink} navigate={navigate} onWalletTap={() => setTab("wallet")} />
      ) : tab === "wallet" ? (
        <WalletTab balance={info?.walletBalance ?? 0} transactions={transactions} />
      ) : (
        <HistoryTab history={history} />
      )}

      {/* Active Coupons */}
      {tab === "overview" && coupons.length > 0 && (
        <>
          <div className="section-title">
            <span>{t("validCoupons")} ({coupons.length})</span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {coupons.map((c, i) => (
              <div
                key={c.id}
                style={{
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Ticket size={18} className="muted" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 14 }}>{c.code}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    {c.discountType === "percent" ? `${c.discountValue}% off` : formatETB(c.discountValue)}
                    {" · "}{t("couponExpires", { date: new Date(c.expiresAt).toLocaleDateString() })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* How It Works */}
      {tab === "overview" && (
        <>
          <div className="section-title">
            <span>{t("howItWorks")}</span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {[
              t("howItWorksStep1"),
              t("howItWorksStep2"),
              t("howItWorksStep3"),
              t("howItWorksStep4", { n: info?.settings?.referralsPerSpin?.toString() ?? "3" }),
            ].map((step, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <span style={{ fontSize: 14, lineHeight: 1.5 }}>{step}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OverviewTab({ info, copyCode, copyLink, shareLink, navigate, onWalletTap }: {
  info: ReferralInfo | null;
  copyCode: () => void;
  copyLink: () => void;
  shareLink: () => void;
  navigate: (path: string) => void;
  onWalletTap: () => void;
}) {
  const { t } = useI18n();
  if (!info) return null;

  const progressPct = info.settings
    ? Math.min(100, ((info.qualifiedCount % info.settings.referralsPerSpin) / info.settings.referralsPerSpin) * 100)
    : 0;

  return (
    <>
      {/* Referral Code Card */}
      <div className="card" style={{ padding: 20, textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🎁</div>
        <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>{t("yourReferralCode")}</h3>
        {info.code ? (
          <div
            style={{
              padding: "10px 20px",
              background: "var(--bg-secondary, #f5f5f5)",
              borderRadius: 10,
              fontFamily: "monospace",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 3,
              marginBottom: 12,
            }}
          >
            {info.code}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 14, marginBottom: 12 }}>—</div>
        )}
        {info.deepLink && (
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t("yourReferralLink")}</div>
            <div className="flex" style={{ gap: 6, alignItems: "center", justifyContent: "center" }}>
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  fontFamily: "monospace",
                  color: "var(--muted)",
                  wordBreak: "break-all",
                  textAlign: "left",
                }}
              >
                {info.deepLink}
              </span>
              <button className="btn btn-ghost" onClick={copyLink} style={{ padding: 6, flexShrink: 0 }} aria-label={t("copy")}>
                <Copy size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn btn-outline" onClick={copyCode} style={{ flex: 1 }}>
            <Copy size={15} /> {t("copy")}
          </button>
          <button className="btn btn-primary" onClick={shareLink} style={{ flex: 1 }}>
            <Share2 size={15} /> {t("shareReferralLink")}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="card" style={{ display: "flex", marginTop: 12 }}>
        <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{info.qualifiedCount}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("referredUsers")}</div>
        </div>
        <div style={{ width: 1, background: "var(--line)" }} />
        <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatETB(info.walletBalance)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("walletBalance")}</div>
        </div>
        <div style={{ width: 1, background: "var(--line)" }} />
        <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{info.availableSpins}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("spinsAvailable")}</div>
        </div>
      </div>

      {/* Spin Progress */}
      {info.settings && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div className="flex" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
            <Sparkles size={18} style={{ color: "var(--gold, #f59e0b)" }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t("spinWheel")}</span>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
              {info.referralProgress}
            </div>
            <div style={{ height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: "linear-gradient(90deg, var(--accent), var(--gold, #f59e0b))",
                  borderRadius: 4,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </div>
          {info.availableSpins > 0 && (
            <button
              className="btn btn-primary"
              onClick={() => navigate("/spinner")}
              style={{ width: "100%", marginTop: 4 }}
            >
              <Sparkles size={15} /> {t("spinWheel")} ({info.availableSpins})
            </button>
          )}
        </div>
      )}

      {/* Quick Wallet */}
      <button
        className="card profile-menu-row"
        style={{ width: "100%", textAlign: "left", marginTop: 12, display: "flex", alignItems: "center" }}
        onClick={onWalletTap}
      >
        <Wallet size={20} strokeWidth={1.75} />
        <span style={{ fontWeight: 600, flex: 1 }}>{t("walletBalance")}</span>
        <span style={{ fontWeight: 700, color: "var(--accent)" }}>{formatETB(info.walletBalance)}</span>
        <ChevronRight size={18} className="muted" />
      </button>
    </>
  );
}

function WalletTab({ balance, transactions }: {
  balance: number;
  transactions: WalletTransaction[];
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="card" style={{ padding: 20, textAlign: "center" }}>
        <Wallet size={28} className="muted" style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 28, fontWeight: 800 }}>{formatETB(balance)}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t("walletBalance")}</div>
      </div>

      <div className="section-title">
        <span>{t("walletTransactions")}</span>
      </div>
      {transactions.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("noTransactions")}</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {transactions.map((tx, i) => (
            <div
              key={tx.id}
              style={{
                padding: "12px 16px",
                borderTop: i === 0 ? "none" : "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {tx.type === "commission" ? (
                <Trophy size={16} style={{ color: "var(--accent)" }} />
              ) : tx.type === "commission_reversal" ? (
                <ArrowLeft size={16} style={{ color: "var(--danger, #ef4444)" }} />
              ) : (
                <Gift size={16} className="muted" />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>{tx.description}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {new Date(tx.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14,
                  color: tx.amountHalala >= 0 ? "var(--accent)" : "var(--danger, #ef4444)",
                }}
              >
                {tx.amountHalala >= 0 ? "+" : ""}{formatETB(tx.amountHalala)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function HistoryTab({ history }: {
  history: ReferralHistoryItem[];
}) {
  const { t } = useI18n();
  if (history.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: "center" }}>
        <Gift size={32} className="muted" style={{ marginBottom: 12 }} />
        <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{t("noReferralsYet")}</p>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("noReferralsHint")}</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {history.map((r, i) => (
        <div
          key={r.id}
          style={{
            padding: "12px 16px",
            borderTop: i === 0 ? "none" : "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {r.status === "qualified" ? (
            <CheckCircle2 size={18} style={{ color: "var(--accent)" }} />
          ) : (
            <Hourglass size={18} className="muted" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {r.referred?.firstName || r.referred?.username || r.referralCode}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {new Date(r.createdAt).toLocaleDateString()}
            </div>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: r.status === "qualified" ? "var(--accent-bg, #e8f5e9)" : "var(--warning-bg, #fff3e0)",
              color: r.status === "qualified" ? "var(--accent)" : "var(--warning, #f57c00)",
            }}
          >
            {r.status === "qualified" ? t("qualified") : t("pending")}
          </span>
        </div>
      ))}
    </div>
  );
}
