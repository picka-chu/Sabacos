import { useEffect, useMemo, useState } from "react";
import { Send, Users } from "lucide-react";
import { api, uploadAiImage } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";

interface ProductLite {
  id: string;
  nameEn: string;
  nameAm: string;
}

/** Fixed in-app routes available as broadcast button destinations. */
const APP_DESTINATIONS: Array<{ value: string; label: string }> = [
  { value: "/", label: "Home" },
  { value: "/shop", label: "Shop" },
  { value: "/cart", label: "Cart" },
  { value: "/checkout", label: "Checkout" },
  { value: "/orders", label: "My orders" },
  { value: "/profile", label: "Profile" },
  { value: "/referral", label: "Referral" },
  { value: "/spinner", label: "Spinner" },
  { value: "/settings", label: "Settings" },
  { value: "/about", label: "About" },
  { value: "/faq", label: "FAQ" },
  { value: "/terms", label: "Terms" },
  { value: "__product", label: "Product…" },
  { value: "__custom", label: "Custom path…" },
];

function resolveInlineTarget(
  dest: string,
  productId: string,
  customPath: string,
): string {
  if (dest === "__product") {
    return productId ? `/product/${productId}` : "";
  }
  if (dest === "__custom") {
    const p = customPath.trim();
    if (!p) return "";
    return p.startsWith("/") ? p : `/${p}`;
  }
  return dest;
}

export function BroadcastPage() {
  const token = useAuth((s) => s.token);
  const [audience, setAudience] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [buttonInline, setButtonInline] = useState(false);
  const [dest, setDest] = useState("/");
  const [productId, setProductId] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast((s) => s.add);

  const buttonTarget = useMemo(
    () => (buttonInline ? resolveInlineTarget(dest, productId, customPath) : ""),
    [buttonInline, dest, productId, customPath],
  );

  useEffect(() => {
    api.get<{ count: number }>("/admin/broadcast/audience", token ?? undefined)
      .then((res) => setAudience(res.count))
      .catch(() => setAudience(null));
  }, [token]);

  useEffect(() => {
    if (!buttonInline) return;
    api.get<{ items: ProductLite[] }>("/admin/products?pageSize=500", token ?? undefined)
      .then((res) => setProducts(res.items))
      .catch(() => setProducts([]));
  }, [buttonInline, token]);

  const onImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const res = await uploadAiImage(file, token ?? undefined);
      setImageUrl(res.url);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const send = async () => {
    if (!text.trim()) return;
    if (buttonText.trim() && !buttonInline && !buttonUrl.trim()) {
      setError("Add a button URL, or tick “Open in app” to pick a destination.");
      return;
    }
    if (buttonUrl.trim() && !buttonText.trim()) {
      setError("Button label is required with a button URL.");
      return;
    }
    if (buttonInline) {
      if (!buttonText.trim()) {
        setError("Button label is required for an inline button.");
        return;
      }
      if (!buttonTarget) {
        setError(
          dest === "__product"
            ? "Pick a product for the button destination."
            : "Enter an in-app path for the button destination.",
        );
        return;
      }
    }
    if (!window.confirm(`Send this message to ${audience ?? "all"} users?`)) return;
    setSending(true); setError(null); setResult(null);
    try {
      const res = await api.post<{ sent: number; failed: number }>("/admin/broadcast", {
        text: text.trim(),
        ...(imageUrl ? { imageUrl } : {}),
        ...(buttonInline
          ? {
              buttonText: buttonText.trim(),
              buttonInline: true,
              buttonTarget,
            }
          : buttonUrl.trim()
            ? { buttonUrl: buttonUrl.trim(), buttonText: buttonText.trim() }
            : {}),
      }, token ?? undefined);
      setResult(res);
      toast("success", `Broadcast sent to ${res.sent} users`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Broadcast failed");
      toast("error", err instanceof Error ? err.message : "Broadcast failed");
    } finally { setSending(false); }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Broadcast</h1>
        <span className="muted row" style={{ gap: 6, fontSize: 13 }}>
          <Users size={15} />
          {audience ?? "…"} users
        </span>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)", fontSize: 13, marginBottom: 16 }}>
          Sent to <strong>{result.sent}</strong> users{result.failed > 0 ? `, ${result.failed} failed` : ""}.
        </div>
      )}

      <div className="card">
        <div className="field">
          <label>Message</label>
          <textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="New arrivals just dropped!" required />
        </div>

        <div className="field">
          <label>Image (optional)</label>
          {imageUrl && (
            <div style={{ marginBottom: 8 }}>
              <img src={imageUrl} alt="" style={{ maxWidth: 180, borderRadius: "var(--radius)" }} />
            </div>
          )}
          <label className="btn btn-outline btn-sm" style={{ display: "inline-flex" }}>
            {imageUrl ? "Replace image" : "Upload image"}
            <input type="file" accept="image/*" hidden onChange={(e) => onImage(e.target.files)} />
          </label>
          {uploading && <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>Uploading…</span>}
        </div>

        <div className="field">
          <label>Button label (optional)</label>
          <input className="input" value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Shop now" />
        </div>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={buttonInline}
              onChange={(e) => {
                setButtonInline(e.target.checked);
                setError(null);
                if (!e.target.checked) setButtonUrl("");
              }}
              style={{ width: 18, height: 18 }}
            />
            <span>Inline button — open inside the Sabacos app</span>
          </label>
        </div>

        {buttonInline ? (
          <>
            <div className="field">
              <label>Open in</label>
              <select className="input" value={dest} onChange={(e) => { setDest(e.target.value); setError(null); }}>
                {APP_DESTINATIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {dest === "__product" && (
              <div className="field">
                <label>Product</label>
                <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Select a product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.nameEn}</option>
                  ))}
                </select>
              </div>
            )}

            {dest === "__custom" && (
              <div className="field">
                <label>App path</label>
                <input
                  className="input"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="/product/uuid-or /category/skincare"
                />
              </div>
            )}

            {buttonTarget && (
              <p className="muted" style={{ margin: "0 0 14px", fontSize: 12 }}>
                Opens in app → <code>{buttonTarget}</code>
              </p>
            )}
          </>
        ) : (
          <div className="field">
            <label>Button URL (optional)</label>
            <input
              className="input"
              value={buttonUrl}
              onChange={(e) => setButtonUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
        )}

        <button className="btn btn-primary" disabled={sending || !text.trim()} onClick={send}>
          {sending && <span className="spinner" />}
          <Send size={16} />
          {sending ? "Sending…" : "Send broadcast"}
        </button>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
          Delivery takes about 1 second per 20 users. Image messages show the photo with your message as caption.
          {buttonInline
            ? " Inline buttons open the Sabacos mini app at the chosen screen."
            : " External buttons open the URL outside the mini app."}
        </p>
      </div>
    </>
  );
}
