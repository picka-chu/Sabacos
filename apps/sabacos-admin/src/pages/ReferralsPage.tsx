import { useCallback, useEffect, useState } from "react";
import { Users, Gift, Wallet, TrendingUp, Settings, Save, Activity, AlertTriangle, Play, Pause } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api.js";
import { etbToHalala, formatHalala } from "../lib/money.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonCard } from "../components/ui.js";

interface ReferralStats {
  totalReferrals: number; qualifiedReferrals: number; pendingReferrals: number;
  monthlyCommissionHalala: number; totalSpinsUsed: number; totalCoupons: number; totalWalletBalance: number;
}
interface ReferralSettings {
  isActive: boolean; firstPurchasePercent: number; repeatPurchasePercent: number;
  referredDiscountPercent: number; affiliatePercent: number;
  monthlyCapHalala: number; referralsPerSpin: number; maxSpinsPerWeek: number;
  spinExpiryDays: number; couponExpiryDays: number; maxCouponsPerOrder: number;
  minAccountAgeDays: number; minOrderValueHalala: number; rewardBudgetPct: number;
  topPrizeCostHalala: number; adaptiveEnabled: boolean; lastAdjustmentDate: string | null;
  dailySpendCapHalala: number; dailySpendCapEnabled: boolean;
  guardrailCommissionMin: number; guardrailCommissionMax: number;
  guardrailSpinCapMin: number; guardrailSpinCapMax: number;
  guardrailPrizeCostMin: number; guardrailPrizeCostMax: number; guardrailMaxBudgetPct: number;
}
interface CommissionRow {
  id: string; referralId: string | null; referrerId: string | null;
  amountHalala: number | null; status: "confirmed" | "pending_review";
  availableAt: string | null; agedAt: string | null;
  withdrawal: "eligible" | "aging" | "review" | "paid" | "reversed";
  flags: string | null; orderId: string | null; createdAt: string;
  referrer: { telegramId: number | null; name: string | null } | null;
}
interface PayoutRow {
  id: string; referrerId: string; amountHalala: number;
  status: "pending" | "processing" | "sent" | "failed";
  chapaReference: string; chapaTransferId: string | null;
  reviewFlag: boolean; reviewNote: string | null;
  createdAt: string; sentAt: string | null; failedReason: string | null;
  referrer: { telegramId: number | null; name: string | null } | null;
  account: { accountName: string; accountNumber: string; bankName: string } | null;
}
interface PayoutEligibilityRow {
  referrerId: string; name: string | null; telegramId: number | null;
  totalWalletHalala: number; eligibleHalala: number; payoutWeekday: string;
  hasAccount: boolean; accountVerified: boolean; sharedAccount: boolean;
}
interface RollingAverages {
  rollingRevenue7d: number; rollingCogs7d: number; rollingRefunds7d: number;
  rollingGrossProfit7d: number; rollingRewardSpend7d: number; targetRewardSpend7d: number;
  dailyPool: number; spendRatio: number;
}
interface AdjustmentLogEntry {
  id: string; date: string; triggerType: string; spendRatio: number | null;
  oldCommissionPct: number | null; newCommissionPct: number | null;
  oldWeeklySpinCap: number | null; newWeeklySpinCap: number | null;
  reason: string | null; flaggedForReview: boolean; createdAt: string;
}

export function ReferralsPage() {
  const token = useAuth((s) => s.token);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [rolling, setRolling] = useState<RollingAverages | null>(null);
  const [adjustLog, setAdjustLog] = useState<AdjustmentLogEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aggregating, setAggregating] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [walletProfileId, setWalletProfileId] = useState("");
  const [walletAmount, setWalletAmount] = useState(0);
  const [walletNote, setWalletNote] = useState("");
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<CommissionRow[]>([]);
  const [commissionFilter, setCommissionFilter] = useState<"pending_review" | "confirmed" | "">("pending_review");
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [payoutFilter, setPayoutFilter] = useState<"pending" | "processing" | "sent" | "failed" | "">("");
  const [eligibility, setEligibility] = useState<PayoutEligibilityRow[]>([]);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const toast = useToast((s) => s.add);

  const loadCommissions = useCallback((status: "" | "pending_review" | "confirmed") => {
    const qs = status ? `?status=${status}&limit=50` : "?limit=50";
    api.get<{ commissions: CommissionRow[] }>(`/admin/referrals/commissions${qs}`, token ?? undefined)
      .then((res) => setCommissions(res.commissions))
      .catch(() => {});
  }, [token]);

  const loadPayouts = useCallback((status: "" | "pending" | "processing" | "sent" | "failed") => {
    const qs = status ? `?status=${status}&limit=50` : "?limit=50";
    api.get<{ payouts: PayoutRow[] }>(`/admin/referrals/payouts${qs}`, token ?? undefined)
      .then((res) => setPayouts(res.payouts))
      .catch(() => {});
    api.get<{ referrers: PayoutEligibilityRow[] }>("/admin/referrals/payout-eligibility", token ?? undefined)
      .then((res) => setEligibility(res.referrers))
      .catch(() => {});
  }, [token]);

  const load = useCallback(() => {
    api.get<ReferralStats>("/admin/referrals/stats", token ?? undefined).then(setStats).catch(() => {});
    api.get<{ settings: ReferralSettings | null }>("/admin/referrals/settings", token ?? undefined).then((res) => {
      if (!res.settings) {
        setSettingsError("The server returned no program settings. The referral_settings row may be missing — make sure migration 0011 was applied in Supabase.");
      } else {
        setSettings(res.settings);
        setSettingsError(null);
      }
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : "request failed";
      setSettingsError(
        `Could not load program settings (${msg}). ` +
        "If the detail names a column, re-run the referral migrations in Supabase SQL Editor " +
        "(0011, 0012, 0013, 0022, 0024, 0025, 0027) in order, then redeploy the server.",
      );
    });
    api.get<{ rolling: RollingAverages }>("/admin/referrals/metrics/latest", token ?? undefined).then((res) => setRolling(res.rolling)).catch(() => {});
    api.get<{ log: AdjustmentLogEntry[] }>("/admin/referrals/adjust/log?limit=10", token ?? undefined).then((res) => setAdjustLog(res.log)).catch(() => {})
      .finally(() => setLoading(false));
    loadCommissions(commissionFilter);
    loadPayouts(payoutFilter);
  }, [token, loadCommissions, loadPayouts, commissionFilter, payoutFilter]);

  useEffect(load, [load]);

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true); setError(null);
    try {
      await api.patch("/admin/referrals/settings", settings, token ?? undefined);
      setEditing(false); toast("success", "Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const runAggregation = async () => {
    setAggregating(true);
    try { await api.post("/admin/referrals/metrics/aggregate", {}, token ?? undefined); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Aggregation failed"); }
    finally { setAggregating(false); }
  };

  const runAdjustment = async () => {
    setAdjusting(true);
    try { await api.post("/admin/referrals/adjust", {}, token ?? undefined); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Adjustment failed"); }
    finally { setAdjusting(false); }
  };

  const toggleAdaptive = async () => {
    if (!settings) return;
    try {
      await api.patch("/admin/referrals/adaptive", { enabled: !settings.adaptiveEnabled }, token ?? undefined);
      setSettings({ ...settings, adaptiveEnabled: !settings.adaptiveEnabled });
    } catch (err) { setError(apiErrorMessage(err)); }
  };

  const [walletBusy, setWalletBusy] = useState(false);
  const walletAdjust = async (action: "credit" | "debit") => {
    if (!walletProfileId.trim() || walletBusy) return;
    const amountHalala = etbToHalala(walletAmount);
    if (amountHalala === null || amountHalala <= 0) {
      setWalletMsg("Enter a valid amount greater than 0");
      return;
    }
    const amountLabel = formatHalala(amountHalala);
    if (
      !window.confirm(
        `${action === "credit" ? "Credit" : "Debit"} ${amountLabel} ${action === "credit" ? "to" : "from"} this wallet? This moves real balance.`,
      )
    ) {
      return;
    }
    setWalletMsg(null);
    setWalletBusy(true);
    try {
      await api.post(`/admin/referrals/wallet/${action}`, {
        profileId: walletProfileId.trim(), amountHalala,
        description: walletNote.trim() || `Admin ${action}`,
      }, token ?? undefined);
      const msg = `${action === "credit" ? "Credited" : "Debited"} ${amountLabel}`;
      setWalletMsg(msg); toast("success", msg);
      setWalletAmount(0); setWalletNote(""); load();
    } catch (err) { setWalletMsg(apiErrorMessage(err)); }
    finally { setWalletBusy(false); }
  };

  const formatETB = (halala: number) => `${(halala / 100).toFixed(2)} ETB`;
  const withdrawalLabel = (row: CommissionRow) => {
    switch (row.withdrawal) {
      case "eligible": return "Eligible";
      case "aging": {
        if (!row.agedAt) return "Aging";
        const at = new Date(row.agedAt).getTime();
        if (Number.isNaN(at)) return "Aging";
        const days = Math.max(0, Math.ceil((at - Date.now()) / (24 * 60 * 60 * 1000)));
        return days <= 0 ? "Eligible" : `Ages in ${days}d`;
      }
      case "review": return "Under review";
      case "paid": return "Paid out";
      case "reversed": return "Reversed";
    }
  };
  const retryPayout = async (id: string) => {
    setPayoutBusy(true);
    try {
      await api.post(`/admin/referrals/payouts/${id}/retry`, {}, token ?? undefined);
      toast("success", "Payout retried");
      loadPayouts(payoutFilter);
    } catch (err) { setError(apiErrorMessage(err)); }
    finally { setPayoutBusy(false); }
  };
  const runPayoutsNow = async () => {
    if (payoutBusy) return;
    if (!window.confirm("Run the payout pass now? This sends REAL money via Chapa to all eligible referrers.")) {
      return;
    }
    setPayoutBusy(true);
    try {
      const res = await api.post<{ paid: number; paidHalala: number; failed: number }>("/admin/referrals/payouts/run", {}, token ?? undefined);
      toast("success", `Payout pass done: ${res.paid} paid (${formatETB(res.paidHalala)}), ${res.failed} failed`);
      loadPayouts(payoutFilter);
    } catch (err) { setError(apiErrorMessage(err)); }
    finally { setPayoutBusy(false); }
  };
  const spendRatioColor = (ratio: number) => {
    if (ratio > 1.5) return "var(--danger)";
    if (ratio > 1.1) return "var(--warning)";
    if (ratio < 0.5) return "var(--info)";
    return "var(--success)";
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Referral & Rewards</h1>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="stagger">
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 24 }}>
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      ) : (
        <div className="grid stagger" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 24 }}>
          {[
            { icon: Users, label: "Referrals", value: stats?.totalReferrals ?? 0 },
            { icon: TrendingUp, label: "Qualified", value: stats?.qualifiedReferrals ?? 0 },
            { icon: Gift, label: "Spins Used", value: stats?.totalSpinsUsed ?? 0 },
            { icon: Wallet, label: "Wallet Balance", value: formatETB(stats?.totalWalletBalance ?? 0) },
          ].map((s, i) => (
            <div key={i} className="card stat-card">
              <div className="row" style={{ alignItems: "center", gap: 10 }}>
                <s.icon size={20} className="muted" />
                <div>
                  <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{s.value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Wallet Adjustment */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>
          <Wallet size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
          Wallet Adjustment
        </h3>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div className="field">
            <label>Profile ID</label>
            <input className="input" type="text" placeholder="User profile UUID" value={walletProfileId}
              onChange={(e) => setWalletProfileId(e.target.value)} />
          </div>
          <div className="field">
            <label>Amount (ETB)</label>
            <input className="input" type="number" min="0" step="0.01" value={walletAmount || ""}
              onChange={(e) => setWalletAmount(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Note</label>
            <input className="input" type="text" placeholder="Reason" value={walletNote}
              onChange={(e) => setWalletNote(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn btn-outline btn-sm" onClick={() => walletAdjust("credit")}
            disabled={!walletProfileId.trim() || walletAmount <= 0}>Credit</button>
          <button className="btn btn-outline btn-sm" onClick={() => walletAdjust("debit")}
            disabled={!walletProfileId.trim() || walletAmount <= 0}>Debit</button>
          {walletMsg && <span style={{ fontSize: 13, color: "var(--muted)" }}>{walletMsg}</span>}
        </div>
      </div>

      {/* Adaptive Engine */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            <Activity size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Adaptive Engine
          </h3>
          <div className="row" style={{ gap: 8 }}>
            <button className={`btn btn-sm ${settings?.adaptiveEnabled ? "btn-primary" : "btn-outline"}`} onClick={toggleAdaptive}>
              {settings?.adaptiveEnabled ? <><Pause size={14} /> Enabled</> : <><Play size={14} /> Disabled</>}
            </button>
            <button className="btn btn-outline btn-sm" onClick={runAggregation} disabled={aggregating}>
              {aggregating ? "Running..." : "Aggregate Now"}
            </button>
            <button className="btn btn-outline btn-sm" onClick={runAdjustment} disabled={adjusting}>
              {adjusting ? "Adjusting..." : "Run Adjustment"}
            </button>
          </div>
        </div>

        {rolling && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "7d Revenue", value: formatETB(rolling.rollingRevenue7d) },
              { label: "7d Gross Profit", value: formatETB(rolling.rollingGrossProfit7d) },
              { label: "7d Reward Spend", value: formatETB(rolling.rollingRewardSpend7d) },
              { label: "Target Spend", value: formatETB(rolling.targetRewardSpend7d) },
              { label: "Daily Pool", value: formatETB(rolling.dailyPool) },
            ].map((m, i) => (
              <div key={i} style={{ padding: 12, background: "var(--surface-2)", borderRadius: "var(--radius-sm)" }}>
                <div className="muted" style={{ fontSize: 11 }}>{m.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{m.value}</div>
              </div>
            ))}
            <div style={{ padding: 12, background: "var(--surface-2)", borderRadius: "var(--radius-sm)", borderLeft: `4px solid ${spendRatioColor(rolling.spendRatio)}` }}>
              <div className="muted" style={{ fontSize: 11 }}>Spend Ratio</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: spendRatioColor(rolling.spendRatio) }}>
                {(rolling.spendRatio * 100).toFixed(1)}%
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                {rolling.spendRatio > 1.5 ? "DANGER" : rolling.spendRatio > 1.1 ? "Overspending" : rolling.spendRatio < 0.5 ? "Underspending" : "On Target"}
              </div>
            </div>
          </div>
        )}

        {settings && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>Guardrails & Configuration</summary>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
              {[
                { label: "Reward Budget %", key: "rewardBudgetPct" as const, min: 1, max: 50 },
                { label: "Commission Min %", key: "guardrailCommissionMin" as const, min: 1, max: 20 },
                { label: "Commission Max %", key: "guardrailCommissionMax" as const, min: 1, max: 20 },
                { label: "Spin Cap Min", key: "guardrailSpinCapMin" as const, min: 1, max: 10 },
                { label: "Spin Cap Max", key: "guardrailSpinCapMax" as const, min: 1, max: 20 },
                { label: "Max Budget %", key: "guardrailMaxBudgetPct" as const, min: 1, max: 50 },
              ].map((f) => (
                <div key={f.key} className="field">
                  <label>{f.label}</label>
                  <input className="input" type="number" min={f.min} max={f.max}
                    value={settings[f.key] ?? 0}
                    onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
                    disabled={!editing} />
                </div>
              ))}
              {[
                { label: "Prize Cost Min (ETB)", key: "guardrailPrizeCostMin" as const, div: 100 },
                { label: "Prize Cost Max (ETB)", key: "guardrailPrizeCostMax" as const, div: 100 },
              ].map((f) => (
                <div key={f.key} className="field">
                  <label>{f.label}</label>
                  <input className="input" type="number" min="0"
                    value={(settings[f.key] ?? 0) / f.div}
                    onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) * f.div })}
                    disabled={!editing} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Adjustment Log */}
      {adjustLog.length > 0 && (
        <div className="card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              <AlertTriangle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Recent Adjustments
            </h3>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="table responsive-table" style={{ fontSize: 13 }}>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Spend Ratio</th><th>Commission</th><th>Spin Cap</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {adjustLog.map((entry) => (
                  <tr key={entry.id} style={entry.flaggedForReview ? { background: "var(--danger-soft)" } : {}}>
                    <td data-label="Date">{entry.date}</td>
                    <td data-label="Type">
                      <span className={`badge ${entry.triggerType === "manual" ? "badge-info" : entry.flaggedForReview ? "badge-danger" : "badge-success"}`}>
                        {entry.triggerType}
                      </span>
                    </td>
                    <td data-label="Spend Ratio">{entry.spendRatio != null ? `${(entry.spendRatio * 100).toFixed(1)}%` : "—"}</td>
                    <td data-label="Commission">
                      {entry.oldCommissionPct}%
                      {entry.newCommissionPct != null && entry.newCommissionPct !== entry.oldCommissionPct && <> → {entry.newCommissionPct}%</>}
                    </td>
                    <td data-label="Spin Cap">
                      {entry.oldWeeklySpinCap}
                      {entry.newWeeklySpinCap != null && entry.newWeeklySpinCap !== entry.oldWeeklySpinCap && <> → {entry.newWeeklySpinCap}</>}
                    </td>
                    <td data-label="Reason" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Commission review — per-referrer cap flags */}
      <div className="card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              <AlertTriangle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Commissions
              {commissions.some((r) => r.status === "pending_review") && (
                <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                  {commissions.filter((r) => r.status === "pending_review").length} flagged
                </span>
              )}
            </h3>
            <div className="row" style={{ gap: 8 }}>
              {(["pending_review", "confirmed", ""] as const).map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${commissionFilter === f ? "btn-primary" : "btn-outline"}`}
                  onClick={() => { setCommissionFilter(f); loadCommissions(f); }}
                >
                  {f === "" ? "All" : f === "pending_review" ? "Pending review" : "Confirmed"}
                </button>
              ))}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Review checklist: shared device/IP, same payment info, clustered order timing. Pending-review
            rows never count toward cash withdrawal — resolve them (flip to confirmed via SQL) before payout day.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table responsive-table" style={{ fontSize: 13 }}>
            <thead>
              <tr><th>Referrer</th><th>Amount</th><th>Status</th><th>Cash-out</th><th>Date</th></tr>
            </thead>
            <tbody>
              {commissions.length === 0 && (
                <tr><td colSpan={5} className="muted">No commissions in this view.</td></tr>
              )}
              {commissions.map((row) => (
                <tr key={row.id} style={row.status === "pending_review" ? { background: "var(--danger-soft)" } : {}}>
                  <td data-label="Referrer">
                    {row.referrer?.name ?? "—"}
                    {row.referrer?.telegramId != null && (
                      <span className="muted"> ({row.referrer.telegramId})</span>
                    )}
                  </td>
                  <td data-label="Amount">{formatETB(row.amountHalala ?? 0)}</td>
                  <td data-label="Status">
                    <span className={`badge ${row.status === "pending_review" ? "badge-danger" : "badge-success"}`}>
                      {row.status === "pending_review" ? "pending review" : "confirmed"}
                    </span>
                    {!row.referralId && (
                      <span className="badge badge-info" style={{ marginLeft: 6 }} title="Repeat-order affiliate commission (no referral row)">affiliate</span>
                    )}
                    {row.flags && (
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{row.flags}</div>
                    )}
                  </td>
                  <td data-label="Cash-out">{withdrawalLabel(row)}</td>
                  <td data-label="Date">{new Date(row.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payouts — weekly Chapa cash withdrawals */}
      <div className="card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              <Wallet size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Payouts
              {payouts.some((p) => p.reviewFlag) && (
                <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                  {payouts.filter((p) => p.reviewFlag).length} need review
                </span>
              )}
            </h3>
            <div className="row" style={{ gap: 8 }}>
              {(["", "pending", "processing", "sent", "failed"] as const).map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${payoutFilter === f ? "btn-primary" : "btn-outline"}`}
                  onClick={() => { setPayoutFilter(f); loadPayouts(f); }}
                >
                  {f === "" ? "All" : f}
                </button>
              ))}
              <button className="btn btn-outline btn-sm" onClick={runPayoutsNow} disabled={payoutBusy}>
                {payoutBusy ? "Running..." : "Run payouts now"}
              </button>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Paid weekly on each referrer's account-creation weekday (min 500 ETB eligible). Failed rows can be retried.
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table responsive-table" style={{ fontSize: 13 }}>
            <thead>
              <tr><th>Referrer</th><th>Amount</th><th>Status</th><th>Account</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {payouts.length === 0 && (
                <tr><td colSpan={6} className="muted">No payouts in this view.</td></tr>
              )}
              {payouts.map((p) => (
                <tr key={p.id} style={p.reviewFlag ? { background: "var(--danger-soft)" } : {}}>
                  <td data-label="Referrer">
                    {p.referrer?.name ?? "—"}
                    {p.referrer?.telegramId != null && (
                      <span className="muted"> ({p.referrer.telegramId})</span>
                    )}
                    {p.reviewFlag && (
                      <div style={{ fontSize: 11, color: "var(--danger)" }} title={p.reviewNote ?? ""}>
                        Reversed after payout — review
                      </div>
                    )}
                  </td>
                  <td data-label="Amount">{formatETB(p.amountHalala)}</td>
                  <td data-label="Status">
                    <span className={`badge ${p.status === "sent" ? "badge-success" : p.status === "failed" ? "badge-danger" : "badge-info"}`}>
                      {p.status}
                    </span>
                    {p.failedReason && (
                      <div className="muted" style={{ fontSize: 11, maxWidth: 220 }}>{p.failedReason}</div>
                    )}
                  </td>
                  <td data-label="Account">
                    {p.account ? `${p.account.bankName} · ${p.account.accountNumber}` : "—"}
                  </td>
                  <td data-label="Date">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td>
                    {p.status === "failed" && (
                      <button className="btn btn-outline btn-sm" onClick={() => retryPayout(p.id)} disabled={payoutBusy}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {eligibility.length > 0 && (
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border-light)" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 13 }}>Eligibility overview</h4>
            <div style={{ overflowX: "auto" }}>
              <table className="table responsive-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr><th>Referrer</th><th>Wallet</th><th>Eligible</th><th>Payout day</th><th>Account</th></tr>
                </thead>
                <tbody>
                  {eligibility.map((e) => (
                    <tr key={e.referrerId}>
                      <td data-label="Referrer">
                        {e.name ?? "—"}
                        {e.telegramId != null && <span className="muted"> ({e.telegramId})</span>}
                        {e.sharedAccount && (
                          <span className="badge badge-danger" style={{ marginLeft: 6 }}>shared account</span>
                        )}
                      </td>
                      <td data-label="Wallet">{formatETB(e.totalWalletHalala)}</td>
                      <td data-label="Eligible">{formatETB(e.eligibleHalala)}</td>
                      <td data-label="Payout day">{e.payoutWeekday}</td>
                      <td data-label="Account">
                        {!e.hasAccount ? (
                          <span className="muted">none</span>
                        ) : (
                          <span className={`badge ${e.accountVerified ? "badge-success" : "badge-info"}`}>
                            {e.accountVerified ? "verified" : "unverified"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Program Settings */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            <Settings size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Program Settings
          </h3>
          {!editing ? (
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Edit</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={saving}>
              {saving && <span className="spinner" />}
              <Save size={14} /> {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>

        {settingsError && !settings && (
          <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
            {settingsError}
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setSettingsError(null); load(); }}>
                Retry
              </button>
            </div>
          </div>
        )}

        {settings && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            <div className="field">
              <label>Program Active</label>
              <select className="input" value={settings.isActive ? "true" : "false"}
                onChange={(e) => setSettings({ ...settings, isActive: e.target.value === "true" })} disabled={!editing}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label>Commission % (first order)</label>
              <input className="input" type="number" min="1" max="50" value={settings.firstPurchasePercent}
                onChange={(e) => setSettings({ ...settings, firstPurchasePercent: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Affiliate % (every order)</label>
              <input className="input" type="number" min="0" max="50" value={settings.affiliatePercent ?? 10}
                onChange={(e) => setSettings({ ...settings, affiliatePercent: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Monthly Cap (ETB)</label>
              <input className="input" type="number" min="0" value={settings.monthlyCapHalala / 100}
                onChange={(e) => setSettings({ ...settings, monthlyCapHalala: Number(e.target.value) * 100 })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Referrals per Spin</label>
              <input className="input" type="number" min="1" max="10" value={settings.referralsPerSpin}
                onChange={(e) => setSettings({ ...settings, referralsPerSpin: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Max Spins per Week</label>
              <input className="input" type="number" min="1" max="20" value={settings.maxSpinsPerWeek}
                onChange={(e) => setSettings({ ...settings, maxSpinsPerWeek: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Top Prize Cost (ETB)</label>
              <input className="input" type="number" min="0" value={settings.topPrizeCostHalala / 100}
                onChange={(e) => setSettings({ ...settings, topPrizeCostHalala: Number(e.target.value) * 100 })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Repeat Purchase %</label>
              <input className="input" type="number" min="1" max="50" value={settings.repeatPurchasePercent}
                onChange={(e) => setSettings({ ...settings, repeatPurchasePercent: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Friend Discount % (first order)</label>
              <input className="input" type="number" min="0" max="50" value={settings.referredDiscountPercent ?? 5}
                onChange={(e) => setSettings({ ...settings, referredDiscountPercent: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Min Account Age (days)</label>
              <input className="input" type="number" min="0" max="365" value={settings.minAccountAgeDays}
                onChange={(e) => setSettings({ ...settings, minAccountAgeDays: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Max Coupons per Order</label>
              <input className="input" type="number" min="1" max="10" value={settings.maxCouponsPerOrder}
                onChange={(e) => setSettings({ ...settings, maxCouponsPerOrder: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Spin Expiry (days)</label>
              <input className="input" type="number" min="1" max="90" value={settings.spinExpiryDays}
                onChange={(e) => setSettings({ ...settings, spinExpiryDays: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Coupon Expiry (days)</label>
              <input className="input" type="number" min="1" max="90" value={settings.couponExpiryDays}
                onChange={(e) => setSettings({ ...settings, couponExpiryDays: Number(e.target.value) })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Min Order Value (ETB)</label>
              <input className="input" type="number" min="0" value={settings.minOrderValueHalala / 100}
                onChange={(e) => setSettings({ ...settings, minOrderValueHalala: Number(e.target.value) * 100 })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Daily Spend Cap (ETB)</label>
              <input className="input" type="number" min="0" value={settings.dailySpendCapHalala / 100}
                onChange={(e) => setSettings({ ...settings, dailySpendCapHalala: Number(e.target.value) * 100 })} disabled={!editing} />
            </div>
            <div className="field">
              <label>Daily Spend Cap Enabled</label>
              <select className="input" value={settings.dailySpendCapEnabled ? "true" : "false"}
                onChange={(e) => setSettings({ ...settings, dailySpendCapEnabled: e.target.value === "true" })} disabled={!editing}>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
