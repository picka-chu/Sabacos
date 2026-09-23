import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Hourglass } from "lucide-react";
import { formatETB } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { api } from "../api.js";
import { toast } from "../components/Toast.js";
import { apiErrorMessage } from "../store.js";
import { haptic } from "../telegram.js";

interface PayoutAccount {
  id: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
  verified: boolean;
}

interface ChapaBank {
  code: string;
  name: string;
}

/** Weekly Chapa cash-out: bank account form + eligible balance. */
export function PayoutAccountCard() {
  const { t, lang } = useI18n();
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [eligible, setEligible] = useState(0);
  const [payoutWeekday, setPayoutWeekday] = useState<number | null>(null);
  const [banks, setBanks] = useState<ChapaBank[]>([]);
  const [banksLive, setBanksLive] = useState(true);
  const [bankCode, setBankCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<{ account: PayoutAccount | null; eligibleHalala: number; payoutWeekday: number }>("/referral/profile/payout-account").catch(() => null),
      api.get<{ banks: ChapaBank[]; live: boolean }>("/referral/banks").catch(() => null),
    ]).then(([acc, bankList]) => {
      if (acc) {
        setAccount(acc.account);
        setEligible(acc.eligibleHalala ?? 0);
        setPayoutWeekday(typeof acc.payoutWeekday === "number" ? acc.payoutWeekday : null);
        if (acc.account) {
          setBankCode(acc.account.bankCode);
          setAccountName(acc.account.accountName);
          setAccountNumber(acc.account.accountNumber);
        }
      }
      if (bankList) {
        setBanks(bankList.banks);
        // Offline list still works for saving — Chapa re-validates live at
        // payout time — but tell the user it may be slightly out of date.
        setBanksLive(bankList.live !== false);
      }
      setLoaded(true);
    });
  }, []);

  const weekdayName =
    payoutWeekday === null
      ? null
      : new Intl.DateTimeFormat(lang === "am" ? "am-ET" : "en-US", { weekday: "long" }).format(
          new Date(Date.UTC(2026, 7, 2 + payoutWeekday)),
        );

  const save = async () => {
    if (saving || !bankCode || accountName.trim().length < 2 || !/^[0-9]{6,20}$/.test(accountNumber.trim())) return;
    haptic("light");
    setSaving(true);
    try {
      const res = await api.post<{ account: PayoutAccount }>("/referral/profile/payout-account", {
        accountName: accountName.trim(),
        accountNumber: accountNumber.trim(),
        bankCode,
      });
      setAccount(res.account);
      toast(t("payoutSaved"));
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="card" style={{ padding: 16, marginTop: 12 }}>
      <div className="flex" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
        <Building2 size={18} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t("payoutTitle")}</span>
        {account && (
          <span className={`badge ${account.verified ? "badge-success" : "badge-info"}`} style={{ marginLeft: "auto" }}>
            {account.verified ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle2 size={12} />{t("payoutVerified")}</span>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Hourglass size={12} />{t("payoutPending")}</span>
            )}
          </span>
        )}
      </div>
      <div className="flex" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 13 }}>{t("payoutEligible")}</span>
        <strong style={{ fontSize: 16 }}>{formatETB(eligible)}</strong>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>{t("payoutThresholdHint")}</p>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>{t("payoutAgingHint")}</p>
      {weekdayName && (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
          {t("payoutDay")}: <strong>{weekdayName}</strong>
        </p>
      )}
      {banks.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--danger, #d32f2f)", margin: "0 0 12px" }}>
          {t("payoutBanksUnavailable")}
        </p>
      ) : !banksLive ? (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
          {t("payoutBanksOffline")}
        </p>
      ) : null}

      <div className="field" style={{ marginBottom: 10 }}>
        <label>{t("payoutBank")}</label>
        <select className="input" value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
          <option value="">{t("payoutSelectBank")}</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label>{t("payoutAccountName")}</label>
        <input
          className="input"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder="Abebe Kebede"
          maxLength={120}
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>{t("payoutAccountNumber")}</label>
        <input
          className="input"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/[^0-9]/g, "").slice(0, 20))}
          placeholder="1000123456789"
          inputMode="numeric"
        />
      </div>
      <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>
        {saving ? "…" : t("payoutSave")}
      </button>
    </div>
  );
}
