import { ChevronDown } from "lucide-react";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";

const ITEMS = [
  ["faqDeliveryQ", "faqDeliveryA"],
  ["faqPaymentQ", "faqPaymentA"],
  ["faqReturnQ", "faqReturnA"],
] as const;

export function FaqPage() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <PageTitle title={t("faq")} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ITEMS.map(([q, a]) => (
          <details key={q} className="card" style={{ padding: "14px 18px" }}>
            <summary
              className="flex"
              style={{ justifyContent: "space-between", alignItems: "center", fontWeight: 600, fontSize: 15, cursor: "pointer", listStyle: "none" }}
            >
              {t(q)}
              <ChevronDown size={18} className="muted" />
            </summary>
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6 }}>
              {t(a)}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
