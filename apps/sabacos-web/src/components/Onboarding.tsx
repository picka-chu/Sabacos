import { useRef, useState } from "react";
import { Check, ChevronRight, FileText, Languages, X } from "lucide-react";
import type { Profile } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { api } from "../api.js";
import { getTelegramWebApp, haptic } from "../telegram.js";
import { useShopStore } from "../store.js";
import { TermsContent } from "./TermsContent.js";

type Step = "language" | "terms" | "declined";

function initialStep(): Step {
  try {
    return localStorage.getItem("sabacos:lang") ? "terms" : "language";
  } catch {
    return "language";
  }
}

/**
 * First-run gate: language choice → Terms & Policies agreement.
 * Shown when the profile has no terms acceptance recorded. Acceptance is
 * stored server-side (profiles.terms_accepted_at), so it survives reinstalls.
 */
export function OnboardingGate() {
  const { t, lang, setLang } = useI18n();
  const setProfile = useShopStore((s) => s.setProfile);
  const [step, setStep] = useState<Step>(initialStep);
  const [scrolled, setScrolled] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chooseLang = async (code: "en" | "am") => {
    haptic("light");
    setLang(code);
    try {
      await api.patch("/profile", { language: code });
    } catch {
      // Language is saved locally regardless; server sync is best-effort.
    }
    setStep("terms");
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || scrolled) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) setScrolled(true);
  };

  const agree = async () => {
    if (busy || !scrolled || !checked) return;
    haptic("heavy");
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ profile: Profile }>("/profile", { acceptTerms: true });
      setProfile(res.profile);
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const closeApp = () => {
    getTelegramWebApp()?.close();
  };

  return (
    <div className="screen" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", paddingTop: "calc(var(--safe-top) + 24px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", width: "100%", padding: "0 16px 24px", display: "flex", flexDirection: "column", flex: 1 }}>
        {step === "language" && (
          <>
            <div style={{ textAlign: "center", paddingTop: 48 }}>
              <img src="/logo.jpg" alt="Sabacos" style={{ width: 72, height: 72, borderRadius: 20, objectFit: "cover" }} />
              <h1 className="serif" style={{ fontSize: 28, margin: "18px 0 6px" }}>Sabacos</h1>
              <p className="muted" style={{ margin: "0 0 28px" }}>{t("chooseLanguageSubtitle")}</p>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {(["en", "am"] as const).map((code) => (
                <button key={code} type="button" className="zone-option" onClick={() => chooseLang(code)} style={{ textAlign: "left" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16 }}>
                    <Languages size={18} />
                    {code === "en" ? "English" : "አማርኛ"}
                  </span>
                  <span style={{ marginLeft: "auto" }}>
                    <ChevronRight size={18} className="muted" />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "terms" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <FileText size={22} />
              <h1 className="serif" style={{ fontSize: 24, margin: 0 }}>{t("termsTitle")}</h1>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "0 0 6px" }}>{t("termsEffective")}</p>
            {lang === "am" && (
              <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>{t("termsTranslationNote")}</p>
            )}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="card"
              style={{ padding: 18, overflowY: "auto", maxHeight: "46dvh", marginBottom: 12 }}
            >
              <TermsContent />
            </div>
            {!scrolled && (
              <p className="muted text-center" style={{ fontSize: 12.5, margin: "0 0 8px" }}>
                {t("termsScrollHint")} ↓
              </p>
            )}
            <button
              type="button"
              className={`zone-option${checked ? " active" : ""}`}
              onClick={() => { haptic("light"); setChecked((c) => !c); }}
              style={{ textAlign: "left", marginBottom: 12 }}
            >
              <span style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, fontWeight: 600 }}>
                <span
                  style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: 7, marginTop: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: checked ? "var(--accent)" : "transparent",
                    border: "1.5px solid var(--accent)", color: "#fff",
                  }}
                >
                  {checked && <Check size={15} strokeWidth={3} />}
                </span>
                {t("termsCheckbox")}
              </span>
            </button>
            {error && (
              <p className="text-center" style={{ fontSize: 13, color: "var(--danger, #d32f2f)", margin: "0 0 8px" }}>
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-block" disabled={!scrolled || !checked || busy} onClick={agree}>
              {busy ? "…" : t("termsAgree")}
            </button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 4 }} onClick={() => setStep("declined")}>
              {t("termsDecline")}
            </button>
          </>
        )}

        {step === "declined" && (
          <div className="text-center" style={{ paddingTop: 64 }}>
            <span style={{ display: "inline-flex", padding: 18, borderRadius: "50%", background: "var(--danger-soft, #fdecea)" }}>
              <X size={36} color="var(--danger, #d32f2f)" />
            </span>
            <h1 className="serif" style={{ fontSize: 24, margin: "18px 0 8px" }}>{t("termsDeclinedTitle")}</h1>
            <p className="muted" style={{ margin: "0 0 24px" }}>{t("termsDeclinedBody")}</p>
            <button className="btn btn-primary btn-block" onClick={() => setStep("terms")}>
              {t("termsReviewAgain")}
            </button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 4 }} onClick={closeApp}>
              {t("termsClose")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
