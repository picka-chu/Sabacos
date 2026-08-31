import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonCard, SkeletonTable, EmptyState } from "../components/ui.js";

interface WaitlistConfig {
  id: string; isActive: boolean; discountPercent: number; earlyBirdLimit: number;
  deadline: string | null; referralBonusPercent: number; maxReferralDiscount: number;
  discountGracePeriodDays: number; createdAt: string; updatedAt: string;
}
interface WaitlistEntry {
  id: string; profileId: string; referralCode: string; referredBy: string | null;
  position: number; isEarlyBird: boolean; status: string; createdAt: string;
  firstName: string | null; lastName: string | null; username: string | null;
}
interface WaitlistStats {
  totalJoined: number; earlyBirdCount: number; totalReferrals: number; totalDiscounts: number;
}

export function WaitlistPage() {
  const token = useAuth((s) => s.token);
  const [config, setConfig] = useState<WaitlistConfig | null>(null);
  const [stats, setStats] = useState<WaitlistStats | null>(null);
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast((s) => s.add);

  const [formActive, setFormActive] = useState(false);
  const [formDiscount, setFormDiscount] = useState(20);
  const [formLimit, setFormLimit] = useState(200);
  const [formDeadline, setFormDeadline] = useState("");
  const [formReferralBonus, setFormReferralBonus] = useState(5);
  const [formMaxReferral, setFormMaxReferral] = useState(30);
  const [formGraceDays, setFormGraceDays] = useState(30);

  const loadAll = () => {
    if (!token) return;
    Promise.all([
      api.get<{ config: WaitlistConfig }>("/admin/waitlist/config", token),
      api.get<{ stats: WaitlistStats; config: WaitlistConfig }>("/admin/waitlist/stats", token),
      api.get<{ items: WaitlistEntry[]; total: number }>(`/admin/waitlist/entries?page=${page}&pageSize=15`, token),
    ])
      .then(([configRes, statsRes, entriesRes]) => {
        setConfig(configRes.config); setStats(statsRes.stats);
        setEntries(entriesRes.items); setTotalEntries(entriesRes.total);
        setFormActive(configRes.config.isActive); setFormDiscount(configRes.config.discountPercent);
        setFormLimit(configRes.config.earlyBirdLimit);
        setFormDeadline(configRes.config.deadline ? configRes.config.deadline.slice(0, 16) : "");
        setFormReferralBonus(configRes.config.referralBonusPercent);
        setFormMaxReferral(configRes.config.maxReferralDiscount);
        setFormGraceDays(configRes.config.discountGracePeriodDays);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, [token, page]);

  const saveConfig = async () => {
    if (!token) return;
    setSaving(true); setError(null);
    try {
      const res = await api.put<{ config: WaitlistConfig }>("/admin/waitlist/config", {
        isActive: formActive, discountPercent: formDiscount, earlyBirdLimit: formLimit,
        deadline: formDeadline ? new Date(formDeadline).toISOString() : null,
        referralBonusPercent: formReferralBonus, maxReferralDiscount: formMaxReferral,
        discountGracePeriodDays: formGraceDays,
      }, token);
      setConfig(res.config); toast("success", "Configuration saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  };

  const totalPages = Math.max(1, Math.ceil(totalEntries / 15));

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Waitlist</h1>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="stagger">
          <div className="grid grid-stats" style={{ marginBottom: 16 }}>
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
        </div>
      ) : stats && (
        <div className="grid grid-stats stagger" style={{ marginBottom: 16 }}>
          <div className="card stat-card">
            <div className="stat-label">Total joined</div>
            <div className="stat-value">{stats.totalJoined}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Early bird</div>
            <div className="stat-value">{stats.earlyBirdCount}</div>
            <div className="stat-sub">of {config?.earlyBirdLimit ?? "..."} limit</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Referrals</div>
            <div className="stat-value">{stats.totalReferrals}</div>
          </div>
          <div className="card stat-card">
            <div className="stat-label">Active discounts</div>
            <div className="stat-value">{stats.totalDiscounts}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>Configuration</h3>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>Waitlist active (users can join; member discounts activate when you turn it off)</span>
          </label>
        </div>

        <div className="input-row">
          <div className="field">
            <label>Early-bird discount %</label>
            <input className="input" type="number" min={1} max={100} value={formDiscount}
              onChange={(e) => setFormDiscount(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Early-bird limit (first N users)</label>
            <input className="input" type="number" min={1} max={100000} value={formLimit}
              onChange={(e) => setFormLimit(Number(e.target.value))} />
          </div>
        </div>

        <div className="field">
          <label>Join deadline (optional)</label>
          <input className="input" type="datetime-local" value={formDeadline}
            onChange={(e) => setFormDeadline(e.target.value)} />
        </div>

        <div className="field">
          <label>Discount validity after launch (days, 0 = never expire)</label>
          <input className="input" type="number" min={0} max={365} value={formGraceDays}
            onChange={(e) => setFormGraceDays(Number(e.target.value))} />
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            When you turn the waitlist off, all waitlist discounts apply from that moment for this many days, then expire automatically.
          </p>
        </div>

        <hr className="divider" />
        <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Referral program</h4>

        <div className="input-row">
          <div className="field">
            <label>Referral bonus % (per successful referral)</label>
            <input className="input" type="number" min={0} max={50} value={formReferralBonus}
              onChange={(e) => setFormReferralBonus(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Max referral discount % (cap)</label>
            <input className="input" type="number" min={0} max={100} value={formMaxReferral}
              onChange={(e) => setFormMaxReferral(Number(e.target.value))} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
            {saving && <span className="spinner" />}
            {saving ? "Saving..." : "Save configuration"}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            Entries <span className="muted" style={{ fontWeight: 400 }}>({totalEntries})</span>
          </h3>
        </div>

        {entries.length === 0 ? (
          <EmptyState title="No entries yet" />
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Referral code</th>
                    <th>Early bird</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const name = [e.firstName, e.lastName].filter(Boolean).join(" ") || "—";
                    return (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 600 }}>{e.position}</td>
                        <td>{name}</td>
                        <td className="muted">{e.username ? `@${e.username}` : "—"}</td>
                        <td><code style={{ fontSize: 12 }}>{e.referralCode}</code></td>
                        <td>
                          {e.isEarlyBird ? <span className="badge badge-success">Early bird</span> : <span className="badge">Regular</span>}
                        </td>
                        <td>
                          <span className={`badge ${e.status === "active" ? "badge-info" : "badge-warn"}`}>{e.status}</span>
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{new Date(e.createdAt).toLocaleDateString()}</td>
                        <td>
                          <button className="btn btn-outline btn-sm" onClick={() => copyCode(e.referralCode)} title="Copy referral code">
                            {copiedCode === e.referralCode ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "12px 20px", borderTop: "1px solid var(--border-light)" }}>
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                <span className="muted" style={{ lineHeight: "32px" }}>Page {page} of {totalPages}</span>
                <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
