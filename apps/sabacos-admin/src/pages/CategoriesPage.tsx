import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2, Tags } from "lucide-react";
import type { Category } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { SkeletonTable, EmptyState } from "../components/ui.js";

export function CategoriesPage() {
  const token = useAuth((s) => s.token);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ slug: "", nameEn: "", nameAm: "", sortOrder: "0" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast((s) => s.add);

  const load = () => {
    api
      .get<{ categories: Category[] }>("/admin/categories", token ?? undefined)
      .then((res) => setCategories(res.categories))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load categories"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token]);

  const startEdit = (c: Category) => {
    setEditingId(c.id);
    setForm({ slug: c.slug, nameEn: c.nameEn, nameAm: c.nameAm, sortOrder: c.sortOrder.toString() });
  };

  const reset = () => {
    setEditingId(null);
    setForm({ slug: "", nameEn: "", nameAm: "", sortOrder: "0" });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      slug: form.slug.trim(),
      nameEn: form.nameEn.trim(),
      nameAm: form.nameAm.trim(),
      sortOrder: Number(form.sortOrder) || 0,
    };
    try {
      if (editingId) {
        await api.patch(`/admin/categories/${editingId}`, body, token ?? undefined);
        toast("success", "Category updated");
      } else {
        await api.post("/admin/categories", body, token ?? undefined);
        toast("success", "Category created");
      }
      reset();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const del = async (c: Category) => {
    if (!window.confirm(`Delete category "${c.nameEn}"?`)) return;
    try {
      await api.del(`/admin/categories/${c.id}`, token ?? undefined);
      toast("success", "Category deleted");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      toast("error", "Delete failed");
    }
  };

  const toggle = async (c: Category) => {
    try {
      await api.patch(`/admin/categories/${c.id}`, { isActive: !c.isActive }, token ?? undefined);
      toast("success", c.isActive ? "Category hidden" : "Category activated");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Categories</h1>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div className="grid grid-form" style={{ alignItems: "start" }}>
        <form onSubmit={submit} className="card">
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>
            {editingId ? "Edit category" : "New category"}
          </h3>
          <div className="field">
            <label>Slug</label>
            <input className="input" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} required pattern="[a-z0-9-]+" placeholder="skincare" />
          </div>
          <div className="field">
            <label>Name (English)</label>
            <input className="input" value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Name (አማርኛ)</label>
            <input className="input" value={form.nameAm} onChange={(e) => setForm((f) => ({ ...f, nameAm: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Sort order</label>
            <input className="input" type="number" min="0" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={busy}>
              {busy && <span className="spinner" />}
              <Plus size={15} />
              {editingId ? "Save" : "Add"}
            </button>
            {editingId && (
              <button type="button" className="btn btn-outline" onClick={reset}>Cancel</button>
            )}
          </div>
        </form>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {loading ? (
            <SkeletonTable rows={4} cols={4} />
          ) : categories.length === 0 ? (
            <EmptyState icon={<Tags size={40} strokeWidth={1.25} />} title="No categories yet">
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Create your first category to organize products.</p>
            </EmptyState>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table responsive-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Sort</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Name">
                        <div style={{ fontWeight: 600 }}>{c.nameEn}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{c.nameAm}</div>
                      </td>
                      <td data-label="Slug"><code>{c.slug}</code></td>
                      <td data-label="Sort">{c.sortOrder}</td>
                      <td data-label="Status">
                        <button className={`badge ${c.isActive ? "badge-success" : "badge-warn"}`} onClick={() => toggle(c)}>
                          {c.isActive ? "Active" : "Hidden"}
                        </button>
                      </td>
                      <td data-label="Actions">
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          <button className="btn btn-outline btn-sm" onClick={() => startEdit(c)}>
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-outline btn-sm" style={{ color: "var(--danger)" }} onClick={() => del(c)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
