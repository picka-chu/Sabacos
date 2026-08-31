import { useEffect, useState } from "react";
import { Users, Gift, Wallet, TrendingUp, Settings, Save, Activity, AlertTriangle, Play, Pause } from "lucide-react";
import { api, apiErrorMessage } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonCard } from "../components/ui.js";

interface ReferralStats {
  totalReferrals: number; qualifiedReferrals: number; pendingReferrals: number;
  monthlyCommissionHalala: number; totalSpinsUsed: number; totalCoupons: number; totalWalletBalance: number;
}
interface ReferralSettings {
  isActive: boolean; firstPurchasePercent: number; repeatPurchasePercent: number;
  monthlyCapHalala: number; referralsPerSpin: number; maxSpinsPerWeek: number;
  spinExpiryDays: number; couponExpiryDays: number; maxCouponsPerOrder: number;
  minAccountAgeDays: number; minOrderValueHalala: number; rewardBudgetPct: number;
  topPrizeCostHalala: number; adaptiveEnabled: boolean; lastAdjustmentDate: string | null;
  dailySpendCapHalala: number; dailySpendCapEnabled: boolean;
  guardrailCommissionMin: number; guardrailCommissionMax: number;
  guardrailSpinCapMin: number; guardrailSpinCapMax: number;
  guardrailPrizeCostMin: number; guardrailPrizeCostMax: number; guardrailMaxBudgetPct: number;
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
  const toast = useToast((s) => s.add);

  const load = () => {
    if (!token) return;
    api.get<ReferralStats>("/admin/referrals/stats", token).then(setStats).catch(() => {});
    api.get<{ settings: ReferralSettings }>("/admin/referrals/settings", token).then((res) => setSettings(res.settings)).catch(() => {});
    api.get<{ rolling: RollingAverages }>("/admin/referrals/metrics/latest", token).then((res) => setRolling(res.rolling)).catch(() => {});
    api.get<{ log: AdjustmentLogEntry[] }>("/admin/referrals/adjust/log?limit=10", token).then((res) => setAdjustLog(res.log)).catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const saveSettings = async () => {
    if (!token || !settings) return;
    setSaving(true); setError(null);
    try {
      await api.patch("/admin/referrals/settings", settings, token);
      setEditing(false); toast("success", "Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const runAggregation = async () => {
    if (!token) return;
    setAggregating(true);
    try { await api.post("/admin/referrals/metrics/aggregate", {}, token); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Aggregation failed"); }
    finally { setAggregating(false); }
  };

  const runAdjustment = async () => {
    if (!token) return;
    setAdjusting(true);
    try { await api.post("/admin/referrals/adjust", {}, token); load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Adjustment failed"); }
    finally { setAdjusting(false); }
  };

  const toggleAdaptive = async () => {
    if (!token || !settings) return;
    try {
      await api.patch("/admin/referrals/adaptive", { enabled: !settings.adaptiveEnabled }, token);
      setSettings({ ...settings, adaptiveEnabled: !settings.adaptiveEnabled });
    } catch (err) { setError(apiErrorMessage(err)); }
  };

  const walletAdjust = async (action: "credit" | "debit") => {
    if (!token || !walletProfileId.trim() || walletAmount <= 0) return;
    setWalletMsg(null);
    try {
      await api.post(`/admin/referrals/wallet/${action}`, {
        profileId: walletProfileId.trim(), amountHalala: Math.round(walletAmount * 100),
        description: walletNote.trim() || `Admin ${action}`,
      }, token);
      const msg = `${action === "credit" ? "Credited" : "Debited"} ${walletAmount.toFixed(2)} ETB`;
      setWalletMsg(msg); toast("success", msg);
      setWalletAmount(0); setWalletNote(""); load();
    } catch (err) { setWalletMsg(apiErrorMessage(err)); }
  };

  const formatETB = (halala: number) => `${(halala / 100).toFixed(2)} ETB`;
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
              <label>Commission %</label>
              <input className="input" type="number" min="1" max="50" value={settings.firstPurchasePercent}
                onChange={(e) => setSettings({ ...settings, firstPurchasePercent: Number(e.target.value) })} disabled={!editing} />
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
