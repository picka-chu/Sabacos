import { useEffect, useRef, useState } from "react";
import { Bot, Send, Check, X } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface PendingAction {
  kind: string;
  summary: string;
  params: Record<string, unknown>;
}

interface TurnResponse {
  reply?: string;
  activity?: string[];
  pendingAction?: PendingAction | null;
  executed?: { kind: string; summary: string };
  error?: { code?: string; message?: string };
}

const ACTIVITY_LABELS: Record<string, string> = {
  get_products: "Checked products",
  get_product: "Checked a product",
  get_sales_summary: "Checked sales",
  get_customers_summary: "Checked customers",
  get_referral_stats: "Checked referrals",
  get_low_stock: "Checked stock levels",
};

export function AiAgentPage() {
  const token = useAuth((s) => s.token);
  const [status, setStatus] = useState<{ enabled: boolean; model: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast((s) => s.add);

  useEffect(() => {
    api
      .get<{ enabled: boolean; model: string }>("/admin/ai-agent/status", token ?? undefined)
      .then(setStatus)
      .catch(() => setStatus({ enabled: false, model: "" }));
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending, busy]);

  const historyFor = (msgs: ChatMessage[]) =>
    msgs.slice(-10).map((m) => ({ role: m.role === "user" ? ("user" as const) : ("model" as const), text: m.text }));

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || pending) return;
    setBusy(true);
    const next = [...messages, { role: "user" as const, text: trimmed }];
    setMessages(next);
    setInput("");
    try {
      const res = await api.post<TurnResponse>(
        "/admin/ai-agent",
        { message: trimmed, messages: historyFor(messages) },
        token ?? undefined,
      );
      if (res.error) throw new Error(res.error.message ?? "Assistant failed");
      const assistant: ChatMessage[] = [];
      if (res.activity && res.activity.length > 0) {
        assistant.push({
          role: "assistant",
          text: res.activity.map((a) => `· ${ACTIVITY_LABELS[a] ?? a}`).join("\n"),
        });
      }
      if (res.reply) assistant.push({ role: "assistant", text: res.reply });
      if (assistant.length > 0) setMessages((m) => [...m, ...assistant]);
      if (res.pendingAction) setPending(res.pendingAction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Assistant failed";
      setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${msg}` }]);
      toast("error", msg);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (ok: boolean) => {
    if (!pending || confirmBusy) return;
    if (!ok) {
      setPending(null);
      setMessages((m) => [...m, { role: "assistant", text: "Discarded — nothing was changed." }]);
      return;
    }
    setConfirmBusy(true);
    try {
      const res = await api.post<TurnResponse>("/admin/ai-agent", { confirm: pending }, token ?? undefined);
      if (res.error) throw new Error(res.error.message ?? "Action failed");
      setMessages((m) => [...m, { role: "assistant", text: res.reply ?? "Done." }]);
      setPending(null);
      toast("success", "Action executed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setMessages((m) => [...m, { role: "assistant", text: `⚠️ ${msg}` }]);
      toast("error", msg);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">AI Assistant</h1>
        <span className="muted row" style={{ gap: 6, fontSize: 13 }}>
          <Bot size={15} />
          {status ? (status.enabled ? status.model : "not configured") : "…"}
        </span>
      </div>

      {status && !status.enabled && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          The assistant is not configured — set <code>GEMINI_API_KEY</code> on the server and redeploy.
        </div>
      )}

      <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 420 }}>
        <div style={{ flex: 1, overflowY: "auto", maxHeight: 480, padding: "4px 2px" }}>
          {messages.length === 0 && (
            <p className="muted" style={{ fontSize: 13, margin: "12px 4px" }}>
              Ask about products, sales, customers, referrals and stock — or ask for a marketing plan.
              Anything it changes (promos, prizes, posts, broadcasts, prices) needs your tap on Approve first.
              Try: “What are my worst sellers under 200 birr?” or “Plan a payday promo for students”.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                margin: "8px 0",
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: "9px 13px",
                  borderRadius: "var(--radius-sm)",
                  background: m.role === "user" ? "var(--primary)" : "var(--surface-2)",
                  color: m.role === "user" ? "#fff" : "inherit",
                  fontSize: 13.5,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
              <span className="spinner" />
              <span className="muted" style={{ fontSize: 13 }}>Thinking…</span>
            </div>
          )}

          {pending && (
            <div
              style={{
                border: "1px solid var(--warning, #f59e0b)",
                borderRadius: "var(--radius-sm)",
                padding: "12px 14px",
                margin: "8px 0",
                background: "var(--surface)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Proposed action</div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>{pending.summary}</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={confirmBusy} onClick={() => confirm(true)}>
                  {confirmBusy ? <span className="spinner" /> : <Check size={15} />}
                  Approve &amp; run
                </button>
                <button className="btn btn-outline btn-sm" disabled={confirmBusy} onClick={() => confirm(false)}>
                  <X size={15} />
                  Discard
                </button>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <input
            className="input"
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send(input);
            }}
            placeholder={status && !status.enabled ? "Assistant not configured" : "Ask anything about your shop…"}
            disabled={busy || !status?.enabled}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim() || pending !== null || !status?.enabled} onClick={() => send(input)}>
            <Send size={16} />
          </button>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          Reads live shop data. Writes always ask first. It can never touch payouts, wallets, refunds or roles.
        </p>
      </div>
    </>
  );
}
