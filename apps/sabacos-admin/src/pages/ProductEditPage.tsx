import { useEffect, useState, type FormEvent } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, Save, Trash2, Upload } from "lucide-react";
import type { Category, Product } from "@sabacos/core";
import { api, uploadAiImage } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { AiStatusIndicator, type AiFileStatus } from "../components/AiStatusIndicator.js";
import { Skeleton } from "../components/ui.js";

const etbToHalala = (etb: string) => Math.round((Number(etb) || 0) * 100);

export function ProductEditPage() {
  const params = useParams<{ id?: string }>();
  const isNew = params.id === undefined || params.id === "new";
  const id = isNew ? undefined : params.id;
  const token = useAuth((s) => s.token);
  const [, navigate] = useLocation();
  const toast = useToast((s) => s.add);

  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({
    categoryId: "",
    sku: "",
    nameEn: "",
    nameAm: "",
    descriptionEn: "",
    descriptionAm: "",
    price: "",
    cost: "",
    compareAt: "",
    stock: "0",
    isActive: true,
    isFeatured: false,
    isFragile: false,
  });
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!token) return;
    api
      .get<{ categories: Category[] }>("/admin/categories", token)
      .then((res) => setCategories(res.categories))
      .catch(() => {});
    if (!isNew) {
      api
        .get<{ product: Product }>(`/admin/products/${id}`, token)
        .then((res) => {
          const p = res.product;
          setForm({
            categoryId: p.categoryId ?? "",
            sku: p.sku,
            nameEn: p.nameEn,
            nameAm: p.nameAm,
            descriptionEn: p.descriptionEn,
            descriptionAm: p.descriptionAm,
            price: (p.priceHalala / 100).toString(),
            cost: p.costHalala != null ? (p.costHalala / 100).toString() : "",
            compareAt: p.compareAtHalala != null ? (p.compareAtHalala / 100).toString() : "",
            stock: p.stock.toString(),
            isActive: p.isActive,
            isFeatured: p.isFeatured,
            isFragile: p.isFragile,
          });
          setImages(p.imageUrls);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load product"))
        .finally(() => setLoading(false));
    }
  }, [id, isNew, token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    const body = {
      categoryId: form.categoryId ? form.categoryId : null,
      sku: form.sku.trim(),
      nameEn: form.nameEn.trim(),
      nameAm: form.nameAm.trim(),
      descriptionEn: form.descriptionEn.trim(),
      descriptionAm: form.descriptionAm.trim(),
      priceHalala: etbToHalala(form.price),
      costHalala: form.cost.trim() ? etbToHalala(form.cost) : 0,
      compareAtHalala: form.compareAt.trim() ? etbToHalala(form.compareAt) : null,
      stock: Number(form.stock) || 0,
      imageUrls: images,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      isFragile: form.isFragile,
    };
    try {
      if (isNew) {
        const res = await api.post<{ product: Product }>("/admin/products", body, token);
        toast("success", "Product created successfully");
        navigate(`/products/${res.product.id}`);
      } else {
        await api.patch<{ product: Product }>(`/admin/products/${id}`, body, token);
        toast("success", "Product saved");
        navigate("/products");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
      setBusy(false);
    }
  };

  const removeImage = (url: string) => setImages((imgs) => imgs.filter((u) => u !== url));

  const [aiFiles, setAiFiles] = useState<AiFileStatus[]>([]);

  const onFiles = async (files: FileList | null) => {
    if (!files || !token || files.length === 0) return;
    setBusy(true);
    setError(null);

    const fileList = Array.from(files);

    setAiFiles(fileList.map((f) => ({ fileName: f.name, step: "uploading" as const })));

    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;

        setAiFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, step: "uploading" as const } : f)),
        );

        setAiFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, step: "analyzing" as const } : f)),
        );

        try {
          const res = await uploadAiImage(file, token);

          setImages((imgs) => (imgs.includes(res.url) ? imgs : [...imgs, res.url]));

          if (res.draft) {
            setForm((f) => ({
              ...f,
              nameEn: f.nameEn.trim() || res.draft!.nameEn,
              nameAm: f.nameAm.trim() || res.draft!.nameAm,
              descriptionEn: f.descriptionEn.trim() || res.draft!.descriptionEn,
              descriptionAm: f.descriptionAm.trim() || res.draft!.descriptionAm,
            }));
            setAiFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, step: "complete" as const, draftName: res.draft!.nameEn } : f,
              ),
            );
          } else {
            setAiFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, step: "error" as const, error: "AI could not identify the product" } : f,
              ),
            );
          }
        } catch (err) {
          setAiFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, step: "error" as const, error: err instanceof Error ? err.message : "Upload failed" } : f,
            ),
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!token || !id) return;
    if (!window.confirm("Delete this product permanently?")) return;
    try {
      await api.del(`/admin/products/${id}`, token);
      toast("success", "Product deleted");
      navigate("/products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      toast("error", "Delete failed");
    }
  };

  if (loading) {
    return (
      <>
        <div className="page-head">
          <button className="btn btn-outline btn-sm" onClick={() => navigate("/products")}>
            <ArrowLeft size={15} /> Back
          </button>
          <h1 className="page-title" style={{ flex: 1 }}>Loading…</h1>
        </div>
        <div className="card" style={{ marginBottom: 14 }}>
          <Skeleton className="skeleton-title" style={{ width: "120px" }} />
          <div className="input-row" style={{ marginTop: 14 }}>
            <div><Skeleton className="skeleton-text" /><Skeleton className="skeleton-value" style={{ height: 40 }} /></div>
            <div><Skeleton className="skeleton-text" /><Skeleton className="skeleton-value" style={{ height: 40 }} /></div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <button className="btn btn-outline btn-sm" onClick={() => navigate("/products")}>
          <ArrowLeft size={15} />
          Back
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>
          {isNew ? "New product" : "Edit product"}
        </h1>
        {!isNew && (
          <button className="btn btn-danger btn-sm" onClick={del}>
            <Trash2 size={15} />
            Delete
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="input-row">
            <div className="field">
              <label>SKU</label>
              <input className="input" value={form.sku} onChange={(e) => set("sku", e.target.value)} required placeholder="SB-001" />
            </div>
            <div className="field">
              <label>Category</label>
              <select className="select" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.nameEn}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Name (English)</label>
              <input className="input" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} required />
            </div>
            <div className="field">
              <label>Name (አማርኛ)</label>
              <input className="input" value={form.nameAm} onChange={(e) => set("nameAm", e.target.value)} required />
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Description (English)</label>
              <textarea className="textarea" value={form.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} />
            </div>
            <div className="field">
              <label>Description (አማርኛ)</label>
              <textarea className="textarea" value={form.descriptionAm} onChange={(e) => set("descriptionAm", e.target.value)} />
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Price (ETB)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} required />
            </div>
            <div className="field">
              <label>Cost (ETB, optional)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set("cost", e.target.value)} placeholder="0.00" />
            </div>
            <div className="field">
              <label>Compare-at price (ETB, optional)</label>
              <input className="input" type="number" min="0" step="0.01" value={form.compareAt} onChange={(e) => set("compareAt", e.target.value)} />
            </div>
          </div>

          <div className="input-row">
            <div className="field">
              <label>Stock</label>
              <input className="input" type="number" min="0" step="1" value={form.stock} onChange={(e) => set("stock", e.target.value)} />
            </div>
            <div className="field">
              <label style={{ visibility: "hidden" }}>Flags</label>
              <div className="row" style={{ paddingTop: 6 }}>
                <label className="row" style={{ gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive", e.target.checked)} />
                  Active
                </label>
                <label className="row" style={{ gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} />
                  Featured
                </label>
                <label className="row" style={{ gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.isFragile} onChange={(e) => set("isFragile", e.target.checked)} />
                  Fragile
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Images</h3>
          <p className="muted" style={{ margin: "0 0 14px", fontSize: 12.5 }}>
            Upload a photo — the AI drafts the name and description for you.
          </p>
          <label className="btn btn-outline btn-sm" style={{ display: "inline-flex", marginBottom: 14 }}>
            <Upload size={15} />
            Upload images
            <input type="file" multiple accept="image/*" hidden onChange={(e) => onFiles(e.target.files)} />
          </label>
          <div className="thumb-grid">
            {images.map((url) => (
              <div key={url} style={{ position: "relative" }}>
                <img src={url} alt="" />
                <button
                  type="button"
                  onClick={() => removeImage(url)}
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontSize: 12,
                    lineHeight: "20px",
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <AiStatusIndicator files={aiFiles} />
        </div>

        <button className="btn btn-primary" disabled={busy}>
          {busy && <span className="spinner" />}
          <Save size={16} />
          {busy ? "Saving…" : "Save product"}
        </button>
      </form>
    </>
  );
}
