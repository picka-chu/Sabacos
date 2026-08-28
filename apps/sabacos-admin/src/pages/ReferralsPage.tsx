import { useEffect, useState } from "react";
import { Users, Gift, Wallet, TrendingUp, Settings, Save, Activity, AlertTriangle, Play, Pause } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";

interface ReferralStats {
  totalReferrals: number;
  qualifiedReferrals: number;
  pendingReferrals: number;
  monthlyCommissionHalala: number;
  totalSpinsUsed: number;
  totalCoupons: number;
  totalWalletBalance: number;
}

interface ReferralSettings {
  isActive: boolean;
  firstPurchasePercent: number;
  repeatPurchasePercent: number;
  monthlyCapHalala: number;
  referralsPerSpin: number;
  maxSpinsPerWeek: number;
  spinExpiryDays: number;
  couponExpiryDays: number;
  maxCouponsPerOrder: number;
  minAccountAgeDays: number;
  minOrderValueHalala: number;
  rewardBudgetPct: number;
  topPrizeCostHalala: number;
  adaptiveEnabled: boolean;
  lastAdjustmentDate: string | null;
  guardrailCommissionMin: number;
  guardrailCommissionMax: number;
  guardrailSpinCapMin: number;
  guardrailSpinCapMax: number;
  guardrailPrizeCostMin: number;
  guardrailPrizeCostMax: number;
  guardrailMaxBudgetPct: number;
}

interface RollingAverages {
  rollingRevenue7d: number;
  rollingCogs7d: number;
  rollingRefunds7d: number;
  rollingGrossProfit7d: number;
  rollingRewardSpend7d: number;
  targetRewardSpend7d: number;
  dailyPool: number;
  spendRatio: number;
}

interface AdjustmentLogEntry {
  id: string;
  date: string;
  triggerType: string;
  spendRatio: number | null;
  oldCommissionPct: number | null;
  newCommissionPct: number | null;
  oldWeeklySpinCap: number | null;
  newWeeklySpinCap: number | null;
  reason: string | null;
  flaggedForReview: boolean;
  createdAt: string;
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

  const load = () => {
    if (!token) return;
    api.get<ReferralStats>("/admin/referrals/stats", token).then(setStats).catch(() => {});
    api.get<{ settings: ReferralSettings }>("/admin/referrals/settings", token).then((res) => setSettings(res.settings)).catch(() => {});
    api.get<{ rolling: RollingAverages }>("/admin/referrals/metrics/latest", token).then((res) => setRolling(res.rolling)).catch(() => {});
    api.get<{ log: AdjustmentLogEntry[] }>("/admin/referrals/adjust/log?limit=10", token).then((res) => setAdjustLog(res.log)).catch(() => {});
  };

  useEffect(load, [token]);

  const saveSettings = async () => {
    if (!token || !settings) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch("/admin/referrals/settings", settings, token);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const runAggregation = async () => {
    if (!token) return;
    setAggregating(true);
    try {
      await api.post("/admin/referrals/metrics/aggregate", {}, token);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aggregation failed");
    } finally {
      setAggregating(false);
    }
  };

  const runAdjustment = async () => {
    if (!token) return;
    setAdjusting(true);
    try {
      await api.post("/admin/referrals/adjust", {}, token);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setAdjusting(false);
    }
  };

  const toggleAdaptive = async () => {
    if (!token || !settings) return;
    try {
      await api.patch("/admin/referrals/adaptive", { enabled: !settings.adaptiveEnabled }, token);
      setSettings({ ...settings, adaptiveEnabled: !settings.adaptiveEnabled });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  };

  const formatETB = (halala: number) => `${(halala / 100).toFixed(2)} ETB`;

  const spendRatioColor = (ratio: number) => {
    if (ratio > 1.5) return "var(--danger)";
    if (ratio > 1.1) return "var(--warning, #f59e0b)";
    if (ratio < 0.5) return "var(--info, #3b82f6)";
    return "var(--success)";
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Referral & Rewards</h1>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)", marginBottom: 14 }}>{error}</div>}

      {/* Stats Overview */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", marginBottom: 24 }}>
        <div className="card">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <Users size={20} className="muted" />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Referrals</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.totalReferrals ?? 0}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <TrendingUp size={20} className="muted" />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Qualified</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.qualifiedReferrals ?? 0}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <Gift size={20} className="muted" />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Spins Used</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{stats?.totalSpinsUsed ?? 0}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <Wallet size={20} className="muted" />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Wallet Balance</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{formatETB(stats?.totalWalletBalance ?? 0)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Adaptive Engine Dashboard */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            <Activity size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Adaptive Engine
          </h3>
          <div className="row" style={{ gap: 8 }}>
            <button
              className={`btn btn-sm ${settings?.adaptiveEnabled ? "btn-primary" : "btn-outline"}`}
              onClick={toggleAdaptive}
            >
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

        {/* Rolling Averages */}
        {rolling && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11 }}>7d Revenue</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatETB(rolling.rollingRevenue7d)}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11 }}>7d Gross Profit</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatETB(rolling.rollingGrossProfit7d)}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11 }}>7d Reward Spend</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatETB(rolling.rollingRewardSpend7d)}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11 }}>Target Spend</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatETB(rolling.targetRewardSpend7d)}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8 }}>
              <div className="muted" style={{ fontSize: 11 }}>Daily Pool</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{formatETB(rolling.dailyPool)}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-secondary, #f8fafc)", borderRadius: 8, borderLeft: `4px solid ${spendRatioColor(rolling.spendRatio)}` }}>
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

        {/* Guardrails */}
        {settings && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
              Guardrails & Configuration
            </summary>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Reward Budget %</label>
                <input className="input" type="number" min="1" max="50" value={settings.rewardBudgetPct}
                  onChange={(e) => setSettings({ ...settings, rewardBudgetPct: Number(e.target.value) })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Commission Min %</label>
                <input className="input" type="number" min="1" max="20" value={settings.guardrailCommissionMin}
                  onChange={(e) => setSettings({ ...settings, guardrailCommissionMin: Number(e.target.value) })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Commission Max %</label>
                <input className="input" type="number" min="1" max="20" value={settings.guardrailCommissionMax}
                  onChange={(e) => setSettings({ ...settings, guardrailCommissionMax: Number(e.target.value) })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Spin Cap Min</label>
                <input className="input" type="number" min="1" max="10" value={settings.guardrailSpinCapMin}
                  onChange={(e) => setSettings({ ...settings, guardrailSpinCapMin: Number(e.target.value) })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Spin Cap Max</label>
                <input className="input" type="number" min="1" max="20" value={settings.guardrailSpinCapMax}
                  onChange={(e) => setSettings({ ...settings, guardrailSpinCapMax: Number(e.target.value) })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Prize Cost Min (ETB)</label>
                <input className="input" type="number" min="0" value={settings.guardrailPrizeCostMin / 100}
                  onChange={(e) => setSettings({ ...settings, guardrailPrizeCostMin: Number(e.target.value) * 100 })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Prize Cost Max (ETB)</label>
                <input className="input" type="number" min="0" value={settings.guardrailPrizeCostMax / 100}
                  onChange={(e) => setSettings({ ...settings, guardrailPrizeCostMax: Number(e.target.value) * 100 })} disabled={!editing} />
              </div>
              <div className="field">
                <label>Max Budget %</label>
                <input className="input" type="number" min="1" max="50" value={settings.guardrailMaxBudgetPct}
                  onChange={(e) => setSettings({ ...settings, guardrailMaxBudgetPct: Number(e.target.value) })} disabled={!editing} />
              </div>
            </div>
          </details>
        )}
      </div>

      {/* Adjustment Log */}
      {adjustLog.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>
            <AlertTriangle size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Recent Adjustments
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table className="table responsive-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Spend Ratio</th>
                  <th>Commission</th>
                  <th>Spin Cap</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {adjustLog.map((entry) => (
                  <tr key={entry.id} style={entry.flaggedForReview ? { background: "#fef2f2" } : {}}>
                    <td data-label="Date">{entry.date}</td>
                    <td data-label="Type">
                      <span className={`badge ${entry.triggerType === "manual" ? "badge-info" : entry.flaggedForReview ? "badge-danger" : "badge-success"}`}>
                        {entry.triggerType}
                      </span>
                    </td>
                    <td data-label="Spend Ratio">
                      {entry.spendRatio != null ? `${(entry.spendRatio * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td data-label="Commission">
                      {entry.oldCommissionPct}%
                      {entry.newCommissionPct != null && entry.newCommissionPct !== entry.oldCommissionPct && (
                        <> → {entry.newCommissionPct}%</>
                      )}
                    </td>
                    <td data-label="Spin Cap">
                      {entry.oldWeeklySpinCap}
                      {entry.newWeeklySpinCap != null && entry.newWeeklySpinCap !== entry.oldWeeklySpinCap && (
                        <> → {entry.newWeeklySpinCap}</>
                      )}
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

      {/* Manual Settings */}
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
          </div>
        )}
      </div>
    </>
  );
}
