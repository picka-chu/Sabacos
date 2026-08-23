import { Info } from "lucide-react";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";

export function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <PageTitle title={t("about")} />
      <div className="card" style={{ padding: 20 }}>
        <div className="flex" style={{ gap: 10, alignItems: "center", marginBottom: 12 }}>
          <img src="/logo.jpg" alt="" style={{ width: 44, height: 44, borderRadius: 14, objectFit: "cover" }} />
          <strong style={{ fontSize: 18 }}>Sabacos</strong>
        </div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65 }}>{t("aboutBody")}</p>
        <div className="divider" />
        <div className="flex" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 13 }}>{t("appVersion")}</span>
          <strong style={{ fontSize: 13 }}>1.0.0</strong>
        </div>
      </div>
      <div className="card" style={{ marginTop: 12, padding: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <Info size={18} className="muted" style={{ flexShrink: 0 }} />
        <span className="muted" style={{ fontSize: 13 }}>{t("tagline")}</span>
      </div>
    </div>
  );
}
