import { useEffect, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import type { Settings } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";

const etbToHalala = (etb: string) => Math.round((Number(etb) || 0) * 100);

export function SettingsPage() {
  const token = useAuth((s) => s.token);
  const [form, setForm] = useState({
    deliveryFee: "",
    freeDeliveryThreshold: "",
    shopNameEn: "",
    shopNameAm: "",
    shopPhone: "",
    adminChannelId: "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<{ settings: Settings }>("/admin/settings", token)
      .then((res) => {
        const s = res.settings;
        setForm({
          deliveryFee: (s.deliveryFeeHalala / 100).toString(),
          freeDeliveryThreshold: (s.freeDeliveryThresholdHalala / 100).toString(),
          shopNameEn: s.shopNameEn,
          shopNameAm: s.shopNameAm,
          shopPhone: s.shopPhone,
          adminChannelId: s.adminChannelId ?? "",
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.put(
        "/admin/settings",
        {
          delivery_fee_halala: etbToHalala(form.deliveryFee),
          free_delivery_threshold_halala: etbToHalala(form.freeDeliveryThreshold),
          shop_name_en: form.shopNameEn.trim(),
          shop_name_am: form.shopNameAm.trim(),
          shop_phone: form.shopPhone.trim(),
          admin_channel_id: form.adminChannelId.trim() || null,
        },
        token,
      );
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)", marginBottom: 14 }}>{error}</div>}
      {saved && <div className="card" style={{ color: "var(--success)", marginBottom: 14 }}>Settings saved.</div>}

      <form onSubmit={submit} className="card" style={{ maxWidth: 640 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Shipping</h3>
        <div className="input-row">
          <div className="field">
            <label>Delivery fee (ETB)</label>
            <input className="input" type="number" min="0" step="0.01" value={form.deliveryFee} onChange={(e) => set("deliveryFee", e.target.value)} required />
          </div>
          <div className="field">
            <label>Free delivery over (ETB)</label>
            <input className="input" type="number" min="0" step="0.01" value={form.freeDeliveryThreshold} onChange={(e) => set("freeDeliveryThreshold", e.target.value)} required />
          </div>
        </div>

        <h3 style={{ margin: "20px 0 12px", fontSize: 15 }}>Shop</h3>
        <div className="input-row">
          <div className="field">
            <label>Shop name (English)</label>
            <input className="input" value={form.shopNameEn} onChange={(e) => set("shopNameEn", e.target.value)} required />
          </div>
          <div className="field">
            <label>Shop name (አማርኛ)</label>
            <input className="input" value={form.shopNameAm} onChange={(e) => set("shopNameAm", e.target.value)} required />
          </div>
        </div>
        <div className="input-row">
          <div className="field">
            <label>Shop phone</label>
            <input className="input" value={form.shopPhone} onChange={(e) => set("shopPhone", e.target.value)} placeholder="+251 9xx xxx xxx" />
          </div>
          <div className="field">
            <label>Admin channel ID</label>
            <input className="input" value={form.adminChannelId} onChange={(e) => set("adminChannelId", e.target.value)} placeholder="Leave blank to disable" />
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy}>
          <Save size={16} />
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
    </>
  );
}