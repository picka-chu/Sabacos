import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Power, Percent } from "lucide-react";
import { formatETB } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonTable, EmptyState } from "../components/ui.js";

type DiscountType = "percent" | "fixed";
type DiscountScope = "all" | "category" | "products";

interface Discount {
  id: string;
  name: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  scope: DiscountScope;
  categoryId: string | null;
  productIds: string[];
  minSubtotalHalala: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Category { id: string; nameEn: string; nameAm: string; }
interface ProductLite { id: string; nameEn: string; nameAm: string; }

interface FormState {
  name: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  scope: DiscountScope;
  categoryId: string | null;
  productIds: string[];
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

const EMPTY_FORM: FormState = {
  name: "", description: "", discountType: "percent", discountValue: 10,
  scope: "all", categoryId: null, productIds: [], minSubtotal: "",
  startsAt: "", endsAt: "", isActive: true,
};

function scopeLabel(scope: DiscountScope): string {
  if (scope === "category") return "Category";
  if (scope === "products") return "Products";
  return "All products";
}

function statusOf(d: Discount, now: number): { label: string; cls: string } {
  if (!d.isActive) return { label: "Paused", cls: "badge" };
  if (d.startsAt && new Date(d.startsAt).getTime() > now) return { label: "Scheduled", cls: "badge-info" };
  if (d.endsAt && new Date(d.endsAt).getTime() < now) return { label: "Expired", cls: "badge-warn" };
  return { label: "Active", cls: "badge-success" };
}

export function DiscountsPage() {
  const token = useAuth((s) => s.token);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const now = Date.now();
  const toast = useToast((s) => s.add);

  const load = useCallback(() => {
    if (!token) return;
    api
      .get<{ discounts: Discount[] }>("/admin/discounts", token)
      .then((res) => setDiscounts(res.discounts))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load discounts"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!token) return;
    api.get<{ categories: Category[] }>("/admin/categories", token).then((res) => setCategories(res.categories)).catch(() => undefined);
    api.get<{ items: ProductLite[] }>("/admin/products?pageSize=500", token).then((res) => setProducts(res.items)).catch(() => undefined);
  }, [token]);

  const startCreate = () => { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); setError(null); };
  const startEdit = (d: Discount) => {
    setEditing(d);
    setForm({
      name: d.name, description: d.description ?? "", discountType: d.discountType,
      discountValue: d.discountValue, scope: d.scope, categoryId: d.categoryId ?? "",
      productIds: d.productIds, minSubtotal: d.minSubtotalHalala != null ? (d.minSubtotalHalala / 100).toString() : "",
      startsAt: d.startsAt ? d.startsAt.slice(0, 16) : "", endsAt: d.endsAt ? d.endsAt.slice(0, 16) : "",
      isActive: d.isActive,
    });
    setShowForm(true); setError(null);
  };

  const saveForm = async () => {
    if (!token) return;
    if (!form.name.trim()) { setError("Name is required"); return; }
    if (form.discountType === "percent" && (form.discountValue <= 0 || form.discountValue > 100)) { setError("Percentage must be between 1 and 100"); return; }
    if (form.discountType === "fixed" && form.discountValue <= 0) { setError("Discount amount must be greater than 0"); return; }
    if (form.scope === "category" && !form.categoryId) { setError("Pick a category"); return; }
    if (form.scope === "products" && form.productIds.length === 0) { setError("Pick at least one product"); return; }
    if (form.startsAt && form.endsAt && new Date(form.startsAt) > new Date(form.endsAt)) { setError("Start date must be before the end date"); return; }

    const payload = {
      name: form.name.trim(), description: form.description.trim(),
      discountType: form.discountType, discountValue: Number(form.discountValue),
      scope: form.scope, categoryId: form.scope === "category" ? form.categoryId : null,
      productIds: form.scope === "products" ? form.productIds : [],
      minSubtotalHalala: form.minSubtotal ? Math.round(Number(form.minSubtotal) * 100) : null,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      isActive: form.isActive,
    };

    setSaving(true); setError(null);
    try {
      if (editing) {
        await api.patch<{ discount: Discount }>(`/admin/discounts/${editing.id}`, payload, token);
        toast("success", "Discount updated");
      } else {
        await api.post<{ discount: Discount }>("/admin/discounts", payload, token);
        toast("success", "Discount created");
      }
      setShowForm(false); load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      toast("error", err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  };

  const toggleActive = async (d: Discount) => {
    if (!token) return;
    try {
      await api.patch<{ discount: Discount }>(`/admin/discounts/${d.id}`, { isActive: !d.isActive }, token);
      toast("success", d.isActive ? "Discount paused" : "Discount activated");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to update"); }
  };

  const remove = async (d: Discount) => {
    if (!token) return;
    if (!confirm(`Delete discount "${d.name}"?`)) return;
    try {
      await api.del(`/admin/discounts/${d.id}`, token);
      toast("success", "Discount deleted");
      load();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete"); }
  };

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.nameEn ?? "—";

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Discounts</h1>
        <button className="btn btn-primary" onClick={startCreate}>
          <Plus size={16} /> New discount
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
            {editing ? `Edit discount · ${editing.name}` : "New discount"}
          </h3>

          <div className="input-row">
            <div className="field">
              <label>Name *</label>
              <input className="input" value={form.name} placeholder="e.g. New Year Sale"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Description</label>
              <input className="input" value={form.description} placeholder="Optional short note"
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Type</label>
              <select className="input" value={form.discountType}
                onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}>
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed amount (ETB, per item)</option>
              </select>
            </div>
            <div className="field">
              <label>{form.discountType === "percent" ? "Discount % (1-100)" : "Off per item (ETB)"}</label>
              <input className="input" type="number" min={0} step="0.01" value={form.discountValue}
                onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })} />
            </div>
          </div>

          <div className="field">
            <label>Applies to</label>
            <select className="input" value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as DiscountScope })}>
              <option value="all">All products</option>
              <option value="category">One category</option>
              <option value="products">Specific products</option>
            </select>
          </div>

          {form.scope === "category" && (
            <div className="field">
              <label>Category</label>
              <select className="input" value={form.categoryId ?? ""}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value || null })}>
                <option value="">Select a category</option>
                {categories.map((c) => (<option key={c.id} value={c.id}>{c.nameEn}</option>))}
              </select>
            </div>
          )}

          {form.scope === "products" && (
            <div className="field">
              <label>Products ({form.productIds.length} selected)</label>
              <div className="form-list">
                {products.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No products found</p>}
                {products.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.productIds.includes(p.id)}
                      onChange={(e) => setForm({
                        ...form,
                        productIds: e.target.checked
                          ? [...form.productIds, p.id]
                          : form.productIds.filter((id) => id !== p.id),
                      })}
                    />
                    <span>{p.nameEn}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="input-row">
            <div className="field">
              <label>Minimum order (ETB, optional)</label>
              <input className="input" type="number" min={0} value={form.minSubtotal}
                onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} />
            </div>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  style={{ width: 16, height: 16 }} />
                <span>Active</span>
              </label>
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Starts (optional)</label>
              <input className="input" type="datetime-local" value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </div>
            <div className="field">
              <label>Ends (optional)</label>
              <input className="input" type="datetime-local" value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveForm} disabled={saving}>
              {saving && <span className="spinner" />}
              {saving ? "Saving..." : editing ? "Save changes" : "Create discount"}
            </button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-light)" }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            Active discounts <span className="muted" style={{ fontWeight: 400 }}>({discounts.length})</span>
          </h3>
        </div>

        {loading ? (
          <SkeletonTable rows={4} cols={6} />
        ) : discounts.length === 0 ? (
          <EmptyState icon={<Percent size={40} strokeWidth={1.25} />} title="No discounts yet">
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Create one to start running promos.</p>
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Scope</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => {
                  const st = statusOf(d, now);
                  return (
                    <tr key={d.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                        {d.description && <div className="muted" style={{ fontSize: 12 }}>{d.description}</div>}
                      </td>
                      <td className="muted">{d.discountType === "percent" ? "Percent" : "Fixed"}</td>
                      <td>
                        <strong>
                          {d.discountType === "percent" ? `${d.discountValue}%` : formatETB(Math.round(d.discountValue * 100))}
                        </strong>
                      </td>
                      <td className="muted">
                        {scopeLabel(d.scope)}
                        {d.scope === "category" && <div style={{ fontSize: 12 }}>{categoryName(d.categoryId)}</div>}
                        {d.scope === "products" && <div style={{ fontSize: 12 }}>{d.productIds.length} product(s)</div>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {d.startsAt ? new Date(d.startsAt).toLocaleDateString() : "—"}
                        {d.startsAt || d.endsAt ? " → " : ""}
                        {d.endsAt ? new Date(d.endsAt).toLocaleDateString() : ""}
                        {d.minSubtotalHalala != null && <div>Min: {formatETB(d.minSubtotalHalala)}</div>}
                      </td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="btn btn-outline btn-sm" title={d.isActive ? "Pause" : "Activate"} onClick={() => toggleActive(d)}>
                            <Power size={14} />
                          </button>
                          <button className="btn btn-outline btn-sm" title="Edit" onClick={() => startEdit(d)}>
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-outline btn-sm" title="Delete" onClick={() => remove(d)}>
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
