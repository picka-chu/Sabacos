import { useEffect, useState, type FormEvent } from "react";
import { Save, Send } from "lucide-react";
import type { Settings } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { Skeleton } from "../components/ui.js";
import { etbToHalala } from "../lib/money.js";

export const AI_VISION_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

export function SettingsPage() {
  const token = useAuth((s) => s.token);
  const [form, setForm] = useState({
    deliveryFee: "",
    freeDeliveryThreshold: "",
    shopNameEn: "",
    shopNameAm: "",
    shopPhone: "",
    adminChannelId: "",
    postChannelId: "",
    aiVisionModel: "",
  });
  const [deliveryConfigJson, setDeliveryConfigJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast((s) => s.add);

  useEffect(() => {
    api
      .get<{ settings: Settings }>("/admin/settings", token ?? undefined)
      .then((res) => {
        const s = res.settings;
        setForm({
          deliveryFee: (s.deliveryFeeHalala / 100).toString(),
          freeDeliveryThreshold: (s.freeDeliveryThresholdHalala / 100).toString(),
          shopNameEn: s.shopNameEn,
          shopNameAm: s.shopNameAm,
          shopPhone: s.shopPhone,
          adminChannelId: s.adminChannelId ?? "",
          postChannelId: s.postChannelId ?? "",
          aiVisionModel: s.aiVisionModel ?? "",
        });
        setDeliveryConfigJson(JSON.stringify(s.deliveryConfig ?? null, null, 2));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();

    let deliveryConfig: unknown = undefined;
    if (deliveryConfigJson.trim() && deliveryConfigJson.trim() !== "null") {
      try { deliveryConfig = JSON.parse(deliveryConfigJson); }
      catch { setError("Delivery config is not valid JSON."); return; }
    }

    setBusy(true); setSaved(false); setError(null);
    const deliveryFeeHalala = etbToHalala(form.deliveryFee);
    const freeThresholdHalala = etbToHalala(form.freeDeliveryThreshold);
    if (deliveryFeeHalala === null || freeThresholdHalala === null) {
      setError("Delivery fee and free-delivery threshold must be non-negative numbers.");
      setBusy(false);
      return;
    }
    try {
      await api.put("/admin/settings", {
        delivery_fee_halala: deliveryFeeHalala,
        free_delivery_threshold_halala: freeThresholdHalala,
        shop_name_en: form.shopNameEn.trim(),
        shop_name_am: form.shopNameAm.trim(),
        shop_phone: form.shopPhone.trim(),
        admin_channel_id: form.adminChannelId.trim() || null,
        post_channel_id: form.postChannelId.trim() || null,
        ai_vision_model: form.aiVisionModel.trim() || null,
        ...(deliveryConfig !== undefined ? { delivery_config: deliveryConfig } : {}),
      }, token ?? undefined);
      setSaved(true);
      toast("success", "Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally { setBusy(false); }
  };

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  if (loading) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">Settings</h1></div>
        <div className="card" style={{ maxWidth: 640 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <Skeleton className="skeleton-text" style={{ width: "40%", marginBottom: 6 }} />
              <Skeleton className="skeleton-value" style={{ height: 40 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Settings</h1>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)", fontSize: 13, marginBottom: 14 }}>
          Settings saved.
        </div>
      )}

      <form onSubmit={submit} className="card" style={{ maxWidth: 640 }}>
        <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Shipping</h3>
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

        <h3 style={{ margin: "24px 0 14px", fontSize: 15 }}>Shop</h3>
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
        </div>

        <h3 style={{ margin: "24px 0 14px", fontSize: 15 }}>Channels</h3>
        <div className="field">
          <label>Order notifications channel</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" value={form.adminChannelId} onChange={(e) => setForm((f) => ({ ...f, adminChannelId: e.target.value }))}
              placeholder="Channel username or numeric id" />
            <button type="button" className="btn btn-secondary" disabled={busy || !form.adminChannelId.trim()}
              title="Send a test message to this channel"
              onClick={async () => {
                setBusy(true); setError(null); setSaved(false);
                try {
                  await api.post<{ ok: boolean; channelId: string }>("/admin/settings/test-channel", { type: "admin" }, token ?? undefined);
                  setSaved(true); toast("success", "Test message sent");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Channel test failed");
                  toast("error", err instanceof Error ? err.message : "Channel test failed");
                } finally { setBusy(false); }
              }}>
              <Send size={14} /> Test
            </button>
          </div>
          <small className="muted" style={{ display: "block", marginTop: 6 }}>
            Receives new order alerts with approve/reject buttons. Use @-less username (mychannel) or numeric id (-100…).
          </small>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Product posts channel</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" value={form.postChannelId} onChange={(e) => setForm((f) => ({ ...f, postChannelId: e.target.value }))}
              placeholder="Channel username or numeric id" />
            <button type="button" className="btn btn-secondary" disabled={busy || !form.postChannelId.trim()}
              title="Send a test message to this channel"
              onClick={async () => {
                setBusy(true); setError(null); setSaved(false);
                try {
                  await api.post<{ ok: boolean; channelId: string }>("/admin/settings/test-channel", { type: "post" }, token ?? undefined);
                  setSaved(true); toast("success", "Test message sent");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Channel test failed");
                  toast("error", err instanceof Error ? err.message : "Channel test failed");
                } finally { setBusy(false); }
              }}>
              <Send size={14} /> Test
            </button>
          </div>
          <small className="muted" style={{ display: "block", marginTop: 6 }}>
            Receives "Post on Channel" product posts with AI-generated copy. Use @-less username or numeric id (-100…).
          </small>
        </div>

        <h3 style={{ margin: "24px 0 14px", fontSize: 15 }}>AI</h3>
        <div className="field">
          <label>Gemini vision model (product AI analysis)</label>
          <select className="input" value={form.aiVisionModel} onChange={(e) => setForm((f) => ({ ...f, aiVisionModel: e.target.value }))}>
            <option value="">Default (env GEMINI_MODEL)</option>
            {AI_VISION_MODELS.map((m) => (<option key={m} value={m}>{m}</option>))}
          </select>
          <small className="muted" style={{ display: "block", marginTop: 6 }}>
            Used by the dashboard &amp; the /addproduct bot command. Falls back automatically on failure.
          </small>
        </div>

        <h3 style={{ margin: "24px 0 14px", fontSize: 15 }}>Zone pricing (JSON)</h3>
        <div className="field">
          <label>delivery_config — origin lat/lng, zones, baseTiers, freeThresholdHalala, expressMultiplier, fragileFeeHalala. Leave as null to use defaults.</label>
          <textarea className="input" rows={14} spellCheck={false}
            style={{ fontFamily: "monospace", fontSize: 13 }}
            value={deliveryConfigJson} onChange={(e) => setDeliveryConfigJson(e.target.value)} />
        </div>

        <button className="btn btn-primary" disabled={busy} style={{ marginTop: 8 }}>
          {busy && <span className="spinner" />}
          <Save size={16} />
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
    </>
  );
}
