import { User, Package, Languages } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { useShopStore } from "../store.js";
import { haptic } from "../telegram.js";

export function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const [, navigate] = useLocation();
  const profile = useShopStore((s) => s.profile);

  const initial = (profile?.firstName ?? profile?.username ?? "S").charAt(0).toUpperCase();

  return (
    <div className="screen">
      <Header title={t("nav_profile")} showBack />

      <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent), var(--gold))",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            fontWeight: 700,
          }}
        >
          {initial}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>
            {profile?.firstName ?? profile?.username ?? "Sabacos"}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            {profile?.username ? `@${profile.username}` : t("telegramUser")}
          </div>
        </div>
      </div>

      <div className="section-title">
        <span>{t("language")}</span>
      </div>
      <div className="card" style={{ padding: 8, display: "flex", gap: 8 }}>
        {(["en", "am"] as const).map((code) => (
          <button
            key={code}
            className={`chip ${lang === code ? "active" : ""}`}
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => {
              haptic("light");
              setLang(code);
            }}
          >
            <Languages size={16} />
            {code === "en" ? t("languageEnglish") : t("languageAmharic")}
          </button>
        ))}
      </div>

      {profile?.address && (
        <>
          <div className="section-title">
            <span>{t("savedAddress")}</span>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <p style={{ margin: 0, fontSize: 14 }}>{profile.address}</p>
            {profile.phone && (
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>{profile.phone}</p>
            )}
          </div>
        </>
      )}

      <div className="section-title">
        <span>{t("nav_orders")}</span>
      </div>
      <button
        className="card"
        style={{ padding: 18, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left" }}
        onClick={() => navigate("/orders")}
      >
        <Package size={20} strokeWidth={1.75} />
        <span style={{ fontWeight: 600, flex: 1 }}>{t("myOrders")}</span>
        <span className="muted">→</span>
      </button>

      <div className="card" style={{ padding: 18, marginTop: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <User size={18} strokeWidth={1.5} className="muted" style={{ marginTop: 2 }} />
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Sabacos · {t("tagline")} · ETB
        </p>
      </div>
    </div>
  );
}