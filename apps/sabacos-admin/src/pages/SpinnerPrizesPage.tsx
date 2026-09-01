import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Power, Trophy, RotateCcw, Tag, Gift } from "lucide-react";
import { formatETB } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonTable, EmptyState } from "../components/ui.js";

type PrizeType = "coupon_percent" | "coupon_fixed" | "free_product" | "spin_again";

interface Prize {
  id: string;
  name: string;
  prizeType: PrizeType;
  value: number;
  productId: string | null;
  weight: number;
  maxPool: number | null;
  currentPool: number;
  isActive: boolean;
  winCount: number;
  createdAt: string;
  updatedAt: string;
}

interface FormState {
  name: string;
  prizeType: PrizeType;
  value: number;
  weight: number;
  maxPool: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  prizeType: "coupon_percent",
  value: 10,
  weight: 10,
  maxPool: "",
  isActive: true,
};

const PRIZE_TYPE_OPTIONS: { value: PrizeType; label: string; icon: typeof Trophy }[] = [
  { value: "coupon_percent", label: "Percent coupon", icon: Tag },
  { value: "coupon_fixed", label: "Fixed coupon (ETB)", icon: Tag },
  { value: "spin_again", label: "Spin again", icon: RotateCcw },
  { value: "free_product", label: "Free product", icon: Gift },
];

function prizeTypeLabel(t: PrizeType): string {
  return PRIZE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function prizeTypeBadgeCls(t: PrizeType): string {
  if (t === "coupon_percent" || t === "coupon_fixed") return "badge-success";
  if (t === "spin_again") return "badge-info";
  return "badge-warn";
}

export function SpinnerPrizesPage() {
  const token = useAuth((s) => s.token);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Prize | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const toast = useToast((s) => s.add);

  const load = useCallback(() => {
    if (!token) return;
    api
      .get<{ prizes: Prize[] }>("/admin/referrals/prizes", token)
      .then((res) => setPrizes(res.prizes))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load prizes"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  };

  const startEdit = (p: Prize) => {
    setEditing(p);
    setForm({
      name: p.name,
      prizeType: p.prizeType,
      value: p.value,
      weight: p.weight,
      maxPool: p.maxPool != null ? String(p.maxPool) : "",
      isActive: p.isActive,
    });
    setShowForm(true);
    setError(null);
  };

  const saveForm = async () => {
    if (!token) return;
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (form.prizeType !== "spin_again" && form.prizeType !== "free_product" && form.value <= 0) {
      setError("Value must be greater than 0"); return;
    }
    if (form.weight <= 0) { setError("Weight must be greater than 0"); return; }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      prizeType: form.prizeType,
      value: form.prizeType === "spin_again" ? 0 : Number(form.value),
      weight: Number(form.weight),
      maxPool: form.maxPool ? Number(form.maxPool) : null,
      isActive: form.isActive,
    };

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.patch<{ prize: Prize }>(`/admin/referrals/prizes/${editing.id}`, payload, token);
        toast("success", "Prize updated");
      } else {
        await api.post<{ prize: Prize }>("/admin/referrals/prizes", payload, token);
        toast("success", "Prize created");
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  const toggleActive = async (p: Prize) => {
    if (!token) return;
    try {
      await api.patch<{ prize: Prize }>(`/admin/referrals/prizes/${p.id}`, { isActive: !p.isActive }, token);
      toast("success", p.isActive ? "Prize deactivated" : "Prize activated");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update"); }
  };

  const remove = async (p: Prize) => {
    if (!token) return;
    if (!confirm(`Delete prize "${p.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/admin/referrals/prizes/${p.id}`, token);
      toast("success", "Prize deleted");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete"); }
  };

  const totalWeight = prizes.filter((p) => p.isActive).reduce((sum, p) => sum + p.weight, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Spinner Prizes</h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Manage the prize wheel. Higher weight = higher chance of winning.
          </p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>
          <Plus size={16} /> New prize
        </button>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>
            {editing ? `Edit prize · ${editing.name}` : "New prize"}
          </h3>

          <div className="input-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Name *</label>
              <input className="input" value={form.name} placeholder="e.g. 10% off, Spin Again"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Type</label>
              <select className="input" value={form.prizeType}
                onChange={(e) => setForm({ ...form, prizeType: e.target.value as PrizeType, value: e.target.value === "spin_again" ? 0 : form.value })}>
                {PRIZE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="input-row">
            {form.prizeType !== "spin_again" && (
              <div className="field">
                <label>{form.prizeType === "coupon_percent" ? "Discount %" : form.prizeType === "coupon_fixed" ? "Amount (ETB)" : "Product value note"}</label>
                {form.prizeType === "coupon_percent" ? (
                  <input className="input" type="number" min={1} max={100} step={1} value={form.value}
                    onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
                ) : form.prizeType === "coupon_fixed" ? (
                  <input className="input" type="number" min={1} step={1} value={form.value}
                    onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
                ) : (
                  <input className="input" disabled value="100% discount coupon" />
                )}
              </div>
            )}
            <div className="field">
              <label>Weight (probability)</label>
              <input className="input" type="number" min={0.1} step={0.5} value={form.weight}
                onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
              <span className="muted" style={{ fontSize: 11 }}>
                {totalWeight > 0 && form.weight > 0
                  ? `${((form.weight / (totalWeight + (editing?.isActive && !form.isActive ? 0 : form.weight))) * 100).toFixed(1)}% chance`
                  : "Relative probability"}
              </span>
            </div>
            <div className="field">
              <label>Max pool (blank = unlimited)</label>
              <input className="input" type="number" min={0} step={1} value={form.maxPool}
                placeholder="Unlimited"
                onChange={(e) => setForm({ ...form, maxPool: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                style={{ width: 16, height: 16 }} />
              <span>Active</span>
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveForm} disabled={saving}>
              {saving && <span className="spinner" />}
              {saving ? "Saving..." : editing ? "Save changes" : "Create prize"}
            </button>
          </div>
        </div>
      )}

      {/* Summary bar */}
      {!loading && prizes.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: "12px 20px", display: "flex", gap: 24, fontSize: 13 }}>
          <div>
            <span className="muted">Total prizes: </span>
            <strong>{prizes.length}</strong>
          </div>
          <div>
            <span className="muted">Active: </span>
            <strong>{prizes.filter((p) => p.isActive).length}</strong>
          </div>
          <div>
            <span className="muted">Total weight: </span>
            <strong>{totalWeight.toFixed(1)}</strong>
          </div>
          <div>
            <span className="muted">Total wins: </span>
            <strong>{prizes.reduce((sum, p) => sum + p.winCount, 0)}</strong>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            Prizes <span className="muted" style={{ fontWeight: 400 }}>({prizes.length})</span>
          </h3>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={7} />
        ) : prizes.length === 0 ? (
          <EmptyState icon={<Trophy size={40} strokeWidth={1.25} />} title="No prizes yet">
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Create prizes for the reward spinner wheel.</p>
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Weight</th>
                  <th>Pool</th>
                  <th>Wins</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {prizes.map((p) => {
                  const poolPct = p.maxPool != null && p.maxPool > 0
                    ? Math.round((p.currentPool / p.maxPool) * 100)
                    : null;
                  const poolWarn = poolPct !== null && poolPct >= 80;

                  return (
                    <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.55 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                      </td>
                      <td>
                        <span className={`badge ${prizeTypeBadgeCls(p.prizeType)}`}>
                          {prizeTypeLabel(p.prizeType)}
                        </span>
                      </td>
                      <td>
                        {p.prizeType === "coupon_percent" && <strong>{p.value}%</strong>}
                        {p.prizeType === "coupon_fixed" && <strong>{formatETB(Math.round(p.value * 100))}</strong>}
                        {p.prizeType === "spin_again" && <span className="muted">—</span>}
                        {p.prizeType === "free_product" && <span className="muted">Free item</span>}
                      </td>
                      <td>
                        <strong>{p.weight}</strong>
                        {totalWeight > 0 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {((p.weight / totalWeight) * 100).toFixed(1)}%
                          </div>
                        )}
                      </td>
                      <td>
                        {p.maxPool != null ? (
                          <span style={{ color: poolWarn ? "var(--danger)" : undefined }}>
                            {p.currentPool}/{p.maxPool}
                            {poolPct !== null && (
                              <div className="muted" style={{ fontSize: 11 }}>{poolPct}% used</div>
                            )}
                          </span>
                        ) : (
                          <span className="muted">∞</span>
                        )}
                      </td>
                      <td>
                        <strong>{p.winCount}</strong>
                      </td>
                      <td>
                        <span className={`badge ${p.isActive ? "badge-success" : "badge"}`}>
                          {p.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="btn btn-outline btn-sm" title={p.isActive ? "Deactivate" : "Activate"} onClick={() => toggleActive(p)}>
                            <Power size={14} />
                          </button>
                          <button className="btn btn-outline btn-sm" title="Edit" onClick={() => startEdit(p)}>
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-outline btn-sm" title="Delete" onClick={() => remove(p)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
