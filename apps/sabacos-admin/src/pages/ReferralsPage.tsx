import { useEffect, useState } from "react";
import { Users, Gift, Wallet, TrendingUp, Settings, Save } from "lucide-react";
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
}

export function ReferralsPage() {
  const token = useAuth((s) => s.token);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<ReferralStats>("/admin/referrals/stats", token)
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"));
    api
      .get<{ settings: ReferralSettings }>("/admin/referrals/settings", token)
      .then((res) => setSettings(res.settings))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"));
  }, [token]);

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

  const formatETB = (halala: number) => `${(halala / 100).toFixed(2)} ETB`;

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Referral & Rewards</h1>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)", marginBottom: 14 }}>{error}</div>}

      {/* Stats Overview */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 24 }}>
        <div className="card">
          <div className="row" style={{ alignItems: "center", gap: 10 }}>
            <Users size={20} className="muted" />
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Total Referrals</div>
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

      {/* Monthly Commission */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Monthly Commission</h3>
        <div style={{ fontSize: 24, fontWeight: 700 }}>
          {formatETB(stats?.monthlyCommissionHalala ?? 0)}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {stats?.totalCoupons ?? 0} coupons issued
        </div>
      </div>

      {/* Settings */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            <Settings size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Program Settings
          </h3>
          {!editing ? (
            <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={saving}>
              <Save size={14} />
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>

        {settings && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
            <div className="field">
              <label>Program Active</label>
              <select
                className="input"
                value={settings.isActive ? "true" : "false"}
                onChange={(e) => setSettings({ ...settings, isActive: e.target.value === "true" })}
                disabled={!editing}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label>First Purchase Commission %</label>
              <input
                className="input"
                type="number"
                min="1"
                max="50"
                value={settings.firstPurchasePercent}
                onChange={(e) => setSettings({ ...settings, firstPurchasePercent: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Monthly Cap (ETB)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={settings.monthlyCapHalala / 100}
                onChange={(e) => setSettings({ ...settings, monthlyCapHalala: Number(e.target.value) * 100 })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Referrals per Spin</label>
              <input
                className="input"
                type="number"
                min="1"
                max="10"
                value={settings.referralsPerSpin}
                onChange={(e) => setSettings({ ...settings, referralsPerSpin: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Max Spins per Week</label>
              <input
                className="input"
                type="number"
                min="1"
                max="20"
                value={settings.maxSpinsPerWeek}
                onChange={(e) => setSettings({ ...settings, maxSpinsPerWeek: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Spin Expiry (days)</label>
              <input
                className="input"
                type="number"
                min="1"
                max="90"
                value={settings.spinExpiryDays}
                onChange={(e) => setSettings({ ...settings, spinExpiryDays: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Coupon Expiry (days)</label>
              <input
                className="input"
                type="number"
                min="1"
                max="90"
                value={settings.couponExpiryDays}
                onChange={(e) => setSettings({ ...settings, couponExpiryDays: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Min Order Value (ETB)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={settings.minOrderValueHalala / 100}
                onChange={(e) => setSettings({ ...settings, minOrderValueHalala: Number(e.target.value) * 100 })}
                disabled={!editing}
              />
            </div>
            <div className="field">
              <label>Min Account Age (days)</label>
              <input
                className="input"
                type="number"
                min="0"
                max="90"
                value={settings.minAccountAgeDays}
                onChange={(e) => setSettings({ ...settings, minAccountAgeDays: Number(e.target.value) })}
                disabled={!editing}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
