import { Check, Loader2, Upload, X, Sparkles } from "lucide-react";

export type AiStep = "uploading" | "analyzing" | "complete" | "error";

export interface AiFileStatus {
  fileName: string;
  step: AiStep;
  error?: string;
  draftName?: string;
}

const STEP_META: Record<AiStep, { label: string; icon: typeof Upload; color: string }> = {
  uploading: { label: "Uploading", icon: Upload, color: "var(--info)" },
  analyzing: { label: "AI analyzing", icon: Sparkles, color: "var(--accent-dark)" },
  complete: { label: "Draft ready", icon: Check, color: "var(--success)" },
  error: { label: "Failed", icon: X, color: "var(--danger)" },
};

function StepDot({ step, isLast }: { step: AiStep; isLast: boolean }) {
  const meta = STEP_META[step];
  const Icon = meta.icon;
  const isActive = step === "uploading" || step === "analyzing";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flex: isLast ? undefined : 1 }}>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: isActive ? meta.color : step === "complete" ? meta.color : "var(--danger)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {isActive ? (
          <Icon size={14} style={{ animation: "spin 1.2s linear infinite" }} />
        ) : (
          <Icon size={14} />
        )}
        {isActive && (
          <div
            style={{
              position: "absolute",
              inset: -3,
              borderRadius: "50%",
              border: `2px solid ${meta.color}`,
              opacity: 0.3,
              animation: "aiPulse 1.5s ease-in-out infinite",
            }}
          />
        )}
      </div>
      {!isLast && (
        <div
          style={{
            flex: 1,
            height: 2,
            background: step === "complete" || step === "error" ? meta.color : "var(--border)",
            borderRadius: 1,
          }}
        />
      )}
    </div>
  );
}

export function AiStatusIndicator({ files }: { files: AiFileStatus[] }) {
  if (files.length === 0) return null;

  return (
    <div
      className="ai-status-panel"
      style={{
        marginTop: 14,
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        background: "var(--surface)",
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes aiPulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.6; }
        }
        @keyframes aiShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}
      >
        <Sparkles size={14} style={{ color: "var(--accent-dark)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.03, textTransform: "uppercase" as const, color: "var(--muted)" }}>
          AI Product Identification
        </span>
      </div>

      <div style={{ padding: 12 }}>
        {files.map((f, i) => {
          const isActive = f.step === "uploading" || f.step === "analyzing";
          return (
            <div
              key={`${f.fileName}-${i}`}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                marginBottom: i < files.length - 1 ? 8 : 0,
                background: isActive ? "var(--surface-2)" : "transparent",
                transition: "background 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    overflow: "hidden",
                  }}
                >
                  {isActive ? (
                    <Loader2
                      size={16}
                      style={{ color: "var(--accent-dark)", animation: "spin 1.2s linear infinite" }}
                    />
                  ) : f.step === "complete" ? (
                    <Check size={16} style={{ color: "var(--success)" }} />
                  ) : (
                    <X size={16} style={{ color: "var(--danger)" }} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.fileName}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: STEP_META[f.step].color,
                      fontWeight: 500,
                      marginTop: 1,
                    }}
                  >
                    {f.step === "error" ? f.error : STEP_META[f.step].label}
                    {f.step === "complete" && f.draftName && (
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}> — "{f.draftName}"</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Step progress bar */}
              <div style={{ display: "flex", alignItems: "center", paddingLeft: 2 }}>
                {(["uploading", "analyzing", "complete"] as AiStep[]).map((s, si) => {
                  const stepOrder: AiStep[] = ["uploading", "analyzing", "complete"];
                  const currentIdx = stepOrder.indexOf(f.step === "error" ? "analyzing" : f.step);
                  const isDone = si < currentIdx || f.step === "complete";
                  const isCurrent = si === currentIdx && f.step !== "complete" && f.step !== "error";
                  const isError = f.step === "error" && si === currentIdx;

                  return (
                    <div
                      key={s}
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 2,
                        marginRight: si < 2 ? 4 : 0,
                        background: isDone
                          ? "var(--success)"
                          : isError
                            ? "var(--danger)"
                            : isCurrent
                              ? `linear-gradient(90deg, var(--accent-dark), var(--accent))`
                              : "var(--border)",
                        transition: "background 0.4s ease",
                        ...(isCurrent
                          ? {
                              backgroundSize: "200% 100%",
                              backgroundImage: "linear-gradient(90deg, var(--accent-dark) 0%, var(--accent) 50%, var(--accent-dark) 100%)",
                              animation: "aiShimmer 1.5s ease-in-out infinite",
                            }
                          : {}),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
