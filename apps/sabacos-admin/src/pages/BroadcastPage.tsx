import { useEffect, useState } from "react";
import { Send, Users } from "lucide-react";
import { api, uploadAiImage } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";

export function BroadcastPage() {
  const token = useAuth((s) => s.token);
  const [audience, setAudience] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast((s) => s.add);

  useEffect(() => {
    if (!token) return;
    api.get<{ count: number }>("/admin/broadcast/audience", token)
      .then((res) => setAudience(res.count))
      .catch(() => setAudience(null));
  }, [token]);

  const onImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !token) return;
    setUploading(true); setError(null);
    try {
      const res = await uploadAiImage(file, token);
      setImageUrl(res.url);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); }
  };

  const send = async () => {
    if (!token || !text.trim()) return;
    if (buttonUrl.trim() && !buttonText.trim()) { setError("Button label is required with a button URL."); return; }
    if (!window.confirm(`Send this message to ${audience ?? "all"} users?`)) return;
    setSending(true); setError(null); setResult(null);
    try {
      const res = await api.post<{ sent: number; failed: number }>("/admin/broadcast", {
        text: text.trim(),
        ...(imageUrl ? { imageUrl } : {}),
        ...(buttonUrl.trim() ? { buttonUrl: buttonUrl.trim(), buttonText: buttonText.trim() } : {}),
      }, token);
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

        <div className="input-row">
          <div className="field">
            <label>Button label (optional)</label>
            <input className="input" value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Shop now" />
          </div>
          <div className="field">
            <label>Button URL (optional)</label>
            <input className="input" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://sabacos-web.onrender.com/product/…" />
          </div>
        </div>

        <button className="btn btn-primary" disabled={sending || !text.trim()} onClick={send}>
          {sending && <span className="spinner" />}
          <Send size={16} />
          {sending ? "Sending…" : "Send broadcast"}
        </button>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
          Delivery takes about 1 second per 20 users. Image messages show the photo with your message as caption; buttons open any link.
        </p>
      </div>
    </>
  );
}
