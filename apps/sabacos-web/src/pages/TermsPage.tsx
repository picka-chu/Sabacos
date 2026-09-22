import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { TermsContent } from "../components/TermsContent.js";

/** Standalone Terms & Policies page (re-readable anytime from Settings). */
export function TermsPage() {
  const { t, lang } = useI18n();
  return (
    <div className="screen">
      <PageTitle title={t("termsTitle")} />
      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 4px" }}>{t("termsEffective")}</p>
      {lang === "am" && (
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>{t("termsTranslationNote")}</p>
      )}
      <div className="card" style={{ padding: 18 }}>
        <TermsContent />
      </div>
    </div>
  );
}
