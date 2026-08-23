import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@motion/core";
import {
  approveSession,
  createSession,
  discardSession,
  getSession,
  listProjects,
  sendChat,
  type EditSession,
  type ToolCallLog,
} from "../lib/api";
import { useEditorStore } from "../store/useEditorStore";

type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCallLog[] };

const PROVIDERS = [
  { id: "", label: "Auto" },
  { id: "gemini", label: "Gemini" },
  { id: "ollama", label: "Ollama" },
];

export function ChatPanel() {
  const projectId = useEditorStore((s) => s.projectId);
  const loadServerProject = useEditorStore((s) => s.loadServerProject);

  const [session, setSession] = useState<EditSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // A new server project selection invalidates the current chat session.
  useEffect(() => {
    setSession(null);
    setMessages([]);
    setNotice(null);
  }, [projectId]);

  // Make sure a server project is selected even if the References panel was never opened.
  useEffect(() => {
    if (projectId) return;
    listProjects()
      .then((ps) => {
        if (ps[0] && !useEditorStore.getState().projectId) useEditorStore.getState().setProjectId(ps[0].id);
      })
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  /** Pull the session and mirror its draft onto the canvas. */
  const syncSession = useCallback(
    async (sessionId: string, applyToCanvas: boolean) => {
      const s = await getSession(sessionId);
      setSession(s);
      if (applyToCanvas && s.status === "open" && s.steps.length > 0) {
        loadServerProject(s.draft as Project);
      }
      return s;
    },
    [loadServerProject],
  );

  const ensureSession = useCallback(async (): Promise<EditSession> => {
    if (session && session.status === "open") return session;
    if (!projectId) throw new Error("Select a project first");
    const created = await createSession(projectId);
    setMessages([]);
    setSession(created);
    return created;
  }, [session, projectId]);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setNotice(null);
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setInput("");
    try {
      const s = await ensureSession();
      // Show the AI's edits live while it works.
      void syncSession(s.id, true).catch(() => undefined);
      const res = await sendChat(s.id, prompt, provider || undefined);
      setMessages((m) => [...m, { role: "assistant", text: res.reply || "(no reply)", calls: res.calls }]);
      await syncSession(res.sessionId, true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [input, busy, provider, session, projectId, ensureSession, syncSession]);

  const review = async (kind: "approve" | "discard") => {
    if (!session) return;
    setBusy(true);
    setNotice(null);
    try {
      if (kind === "approve") await approveSession(session.id);
      else await discardSession(session.id);
      const s = await getSession(session.id);
      setSession(s);
      loadServerProject(kind === "approve" ? (s.draft as Project) : (s.baseProject as Project));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hasPendingEdits = session?.status === "open" && session.steps.length > 0;

  return (
    <aside className="side-panel ai-panel">
      <div className="ai-panel-head">
        <h2 className="panel-title ai-panel-title">AI Editor</h2>
        <select
          className="comp-select ai-provider-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          title="AI provider"
          data-testid="ai-provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ai-log" ref={logRef}>
        {messages.length === 0 && !busy && (
          <div className="ai-empty">
            {projectId
              ? "Describe what to build or change — e.g. \u201Cadd a bold title that scales in\u201D. Edits preview on the canvas; approve to keep them."
              : "Pick a project in the References panel first, then describe your edit here."}
          </div>
        )}
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="ai-msg ai-msg-user">
              {msg.text}
            </div>
          ) : (
            <div key={i} className="ai-msg ai-msg-assistant">
              {msg.text}
              {msg.calls.length > 0 && (
                <div className="ai-calls">
                  {msg.calls.map((call, j) => (
                    <span key={j} className={`ai-call is-${call.status}`} title={call.name}>
                      {call.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && <div className="ai-typing">Working&#8230;</div>}
      </div>

      {notice && <div className="refs-notice">{notice}</div>}

      {hasPendingEdits && (
        <div className="ai-review">
          <button className="toolbar-btn ai-approve" disabled={busy} onClick={() => review("approve")} data-testid="ai-approve">
            Approve
          </button>
          <button className="toolbar-btn ai-discard" disabled={busy} onClick={() => review("discard")} data-testid="ai-discard">
            Discard
          </button>
        </div>
      )}

      <div className="ai-input-row">
        <input
          className="text-input"
          placeholder={busy ? "Working\u2026" : "Describe an edit"}
          value={input}
          disabled={busy || !projectId}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          data-testid="ai-input"
        />
        <button
          className="toolbar-btn toolbar-btn-primary"
          disabled={busy || !input.trim() || !projectId}
          onClick={send}
          data-testid="ai-send"
        >
          Send
        </button>
      </div>
    </aside>
  );
}