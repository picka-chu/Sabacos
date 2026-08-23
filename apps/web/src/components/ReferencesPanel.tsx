import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProject,
  deleteReference,
  importReference,
  listProjects,
  listReferences,
  uploadReference,
  type ProjectSummary,
  type Reference,
} from "../lib/api";
import { useEditorStore } from "../store/useEditorStore";

const STATUS_LABEL: Record<Reference["status"], string> = {
  importing: "Importing\u2026",
  downloading: "Downloading\u2026",
  analyzing: "Analyzing\u2026",
  transcribing: "Transcribing\u2026 (can take a few minutes)",
  ready: "Ready",
  failed: "Failed",
};

type ReferenceEvent = Omit<Reference, "status"> & { status: Reference["status"] | "deleted" };

function useReferenceUpdates(projectId: string | null, onUpdate: (r: ReferenceEvent) => void): void {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;
  useEffect(() => {
    if (!projectId) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws?projectId=${projectId}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; reference?: ReferenceEvent };
        if (msg.type === "reference:update" && msg.reference) callbackRef.current(msg.reference);
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => ws.close();
  }, [projectId]);
}

export function ReferencesPanel() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const projectId = useEditorStore((s) => s.projectId);
  const setProjectId = useEditorStore((s) => s.setProjectId);
  const [references, setReferences] = useState<Reference[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedId = projectId ?? "";

  const refreshProjects = useCallback(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        const current = useEditorStore.getState().projectId;
        if (!current && ps[0]) setProjectId(ps[0].id);
      })
      .catch((e: Error) => setNotice(`Could not reach the server: ${e.message}`));
  }, [setProjectId]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const refreshReferences = useCallback(() => {
    if (!selectedId) {
      setReferences([]);
      return;
    }
    listReferences(selectedId)
      .then(setReferences)
      .catch((e: Error) => setNotice(`Could not load references: ${e.message}`));
  }, [selectedId]);

  useEffect(() => {
    refreshReferences();
  }, [refreshReferences]);

  // Fallback for when the WebSocket is unavailable: poll while anything is in flight.
  const hasPending = references.some((r) => r.status !== "ready" && r.status !== "failed");
  useEffect(() => {
    if (!hasPending || !projectId) return;
    const timer = window.setInterval(refreshReferences, 4000);
    return () => window.clearInterval(timer);
  }, [hasPending, projectId, refreshReferences]);

    useReferenceUpdates(selectedId || null, (updated) => {
    setReferences((prev) => {
      const rest = prev.filter((r) => r.id !== updated.id);
      if (updated.status === "deleted") return rest;
      return [updated, ...rest] as Reference[];
    });
  });

  const run = async (action: () => Promise<unknown>, label: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleNewProject = async () => {
    const name = window.prompt("New project name", `Project ${projects.length + 1}`);
    if (!name) return;
    await run(async () => {
      const created = await createProject(name.trim());
      await refreshProjects();
      setProjectId(created.id);
    }, "Create project");
  };

  const handleImportUrl = () => {
    const trimmed = url.trim();
    if (!trimmed || !selectedId) return;
    run(async () => {
      const ref = await importReference(selectedId, trimmed);
      setUrl("");
      setReferences((prev) => [ref, ...prev.filter((r) => r.id !== ref.id)]);
    }, "Import");
  };

  const handleUpload = (file: File | undefined) => {
    if (!file || !selectedId) return;
    run(async () => {
      const ref = await uploadReference(selectedId, file);
      setReferences((prev) => [ref, ...prev.filter((r) => r.id !== ref.id)]);
    }, "Upload");
  };

  const handleDelete = (ref: Reference) => {
    run(async () => {
      await deleteReference(ref.id);
      setReferences((prev) => prev.filter((r) => r.id !== ref.id));
    }, "Delete");
  };

  return (
    <aside className="side-panel refs-panel">
      <h2 className="panel-title">References</h2>

      <div className="field-row">
        <label className="field-label">Project</label>
        <div className="refs-project-row">
          <select
            className="comp-select refs-project-select"
            value={selectedId}
            onChange={(e) => setProjectId(e.target.value || null)}
            title="Server project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="toolbar-btn" onClick={handleNewProject} title="New project">
            +
          </button>
        </div>
      </div>

      <div className="field-row">
        <input
          className="text-input"
          type="url"
          placeholder="YouTube / TikTok / Instagram URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleImportUrl();
          }}
        />
        <button className="toolbar-btn" disabled={busy || !url.trim() || !projectId} onClick={handleImportUrl}>
          Import
        </button>
      </div>

      <div className="field-row">
        <button className="toolbar-btn" disabled={busy || !projectId} onClick={() => fileInput.current?.click()}>
          Upload video\u2026
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => handleUpload(e.target.files?.[0])}
        />
      </div>

      {notice && <div className="refs-notice">{notice}</div>}

      <div className="refs-list">
        {references.length === 0 && <div className="refs-empty">No references yet.</div>}
        {references.map((ref) => (
          <div key={ref.id} className={`ref-card is-${ref.status}`}>
            <div className="ref-card-head">
              {ref.posterUrl ? (
                <img className="ref-thumb" src={ref.posterUrl} alt="" />
              ) : (
                <div className="ref-thumb ref-thumb-placeholder">{ref.status === "failed" ? "\u26A0" : "\u25A9"}</div>
              )}
              <div className="ref-card-meta">
                <span className="ref-title" title={ref.title}>
                  {ref.title}
                </span>
                <span className="ref-subtitle">
                  {ref.sourcePlatform ?? "local"} &middot; {STATUS_LABEL[ref.status]}
                </span>
                {ref.error && <span className="ref-error">{ref.error}</span>}
              </div>
              <button
                className="mini-btn mini-danger"
                title="Delete reference"
                disabled={busy}
                onClick={() => handleDelete(ref)}
              >
                &times;
              </button>
            </div>

            {ref.style && (
              <div className="ref-card-body">
                <div className="ref-chips">
                  <span className="ref-chip">{ref.style.pace} pace</span>
                  <span className="ref-chip">
                    {ref.style.cuts} cuts / {ref.style.avgShotLength}s
                  </span>
                  <span className="ref-chip">motion {Math.round(ref.style.motion * 100)}%</span>
                </div>
                <div className="ref-palette" title="Dominant palette">
                  {ref.style.palette.map((c) => (
                    <span
                      key={c.hex}
                      className="ref-swatch"
                      style={{ background: `#${c.hex}`, flexGrow: Math.max(1, Math.round(c.weight * 100)) }}
                    />
                  ))}
                </div>
              </div>
            )}

            {ref.transcript && ref.transcript.segments.length > 0 && (
              <details className="ref-transcript">
                <summary>Transcript ({ref.transcript.language})</summary>
                <ol className="ref-segments">
                  {ref.transcript.segments.map((seg, i) => (
                    <li key={i}>
                      <span className="ref-seg-time">
                        {seg.start.toFixed(1)}s&ndash;{seg.end.toFixed(1)}s
                      </span>{" "}
                      {seg.text}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}