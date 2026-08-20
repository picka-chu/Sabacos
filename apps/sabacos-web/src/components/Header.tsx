import { ChevronLeft } from "lucide-react";
import { useI18n } from "../i18n.js";
import { haptic } from "../telegram.js";

export function Header({ title, showBack = false }: { title?: string; showBack?: boolean }) {
  const { t } = useI18n();
  return (
    <header className="topbar">
      <div className="flex" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
        {showBack && (
          <button
            onClick={() => {
              haptic("light");
              window.history.back();
            }}
            aria-label={t("back")}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 12, background: "var(--surface)" }}
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {title ? (
          <h1 className="serif" style={{ fontSize: 20, margin: 0, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </h1>
        ) : (
          <span className="brand-mark">
            <em>S</em>abacos
          </span>
        )}
      </div>
      <div className="flex" style={{ gap: 8 }}>
        <span className="badge badge-gold serif" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          ETB
        </span>
      </div>
    </header>
  );
}