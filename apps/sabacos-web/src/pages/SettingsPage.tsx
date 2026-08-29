import { Languages, Info } from "lucide-react";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { haptic } from "../telegram.js";
import { api } from "../api.js";

export function SettingsPage() {
  const { t, lang, setLang } = useI18n();

  const changeLang = (code: "en" | "am") => {
    haptic("light");
    setLang(code);
    // Persist on the server so the bot uses the same language on /start.
    api.patch("/profile", { language: code }).catch(() => {});
  };

  return (
    <div className="screen">
      <PageTitle title={t("settingsTitle")} />

      <div className="section-title" style={{ marginTop: 16 }}>
        <span>{t("language")}</span>
      </div>
      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        {(["en", "am"] as const).map((code) => (
          <button
            key={code}
            className={`chip ${lang === code ? "active" : ""}`}
            style={{ flex: 1, justifyContent: "center", padding: "11px 12px" }}
            onClick={() => changeLang(code)}
          >
            <Languages size={16} />
            {code === "en" ? t("languageEnglish") : t("languageAmharic")}
          </button>
        ))}
      </div>

      <div className="section-title">
        <span>{t("about")}</span>
      </div>
      <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="flex" style={{ gap: 10, alignItems: "center" }}>
          <Info size={18} className="muted" />
          <span style={{ fontSize: 14 }}>{t("tagline")}</span>
        </div>
        <div className="divider" style={{ margin: 0 }} />
        <div className="flex" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 13 }}>{t("appVersion")}</span>
          <strong style={{ fontSize: 13 }}>1.0.0</strong>
        </div>
        <div className="flex" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 13 }}>Currency</span>
          <strong style={{ fontSize: 13 }}>ETB</strong>
        </div>
      </div>

      <p className="muted text-center" style={{ marginTop: 28, fontSize: 12 }}>
        Sabacos
      </p>
    </div>
  );
}
