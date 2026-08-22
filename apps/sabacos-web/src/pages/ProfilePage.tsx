import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, MapPin, Navigation, Package, Pencil, Phone, Settings } from "lucide-react";
import { useLocation } from "wouter";
import { formatETB, type Order } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { api } from "../api.js";
import { apiErrorMessage, useShopStore } from "../store.js";
import { toast } from "../components/Toast.js";
import { haptic, isTelegramSession, requestLocation, requestPhoneNumber } from "../telegram.js";

export function ProfilePage() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const profile = useShopStore((s) => s.profile);
  const profileStatus = useShopStore((s) => s.profileStatus);
  const updateProfile = useShopStore((s) => s.updateProfile);

  const [orders, setOrders] = useState<Order[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharingPhone, setSharingPhone] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ orders: Order[] }>("/orders")
      .then((res) => setOrders(res.orders))
      .catch(() => setOrders([]));
  }, []);

  useEffect(() => {
    setPhone(profile?.phone ?? "");
    setAddress(profile?.address ?? "");
  }, [profile?.phone, profile?.address]);

  const initial = (profile?.firstName ?? profile?.username ?? "S").charAt(0).toUpperCase();

  const stats = useMemo(() => {
    const list = orders ?? [];
    const spent = list.reduce((sum, o) => sum + o.totalHalala, 0);
    return { count: list.length, spent };
  }, [orders]);

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
      })
    : null;

  const startEdit = useCallback(() => {
    setPhone(profile?.phone ?? "");
    setAddress(profile?.address ?? "");
    setErrorMsg(null);
    setEditing(true);
  }, [profile?.phone, profile?.address]);

  async function handleSave() {
    const p = phone.trim();
    const a = address.trim();
    if (p.length < 3) {
      setErrorMsg(t("invalidPhone"));
      return;
    }
    if (a.length < 5) {
      setErrorMsg(t("invalidAddress"));
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await updateProfile({ phone: p, address: a });
      toast(t("profileUpdated"));
      setEditing(false);
    } catch (err) {
      setErrorMsg(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function errorMsgGuard(_len: number) {
    setErrorMsg(t("invalidAddress"));
  }

  async function handleSharePhone() {
    if (!isTelegramSession()) return;
    haptic("light");
    setSharingPhone(true);
    try {
      const number = await requestPhoneNumber();
      if (!number) {
        toast(t("featureUnavailable"));
        return;
      }
      await updateProfile({ phone: number });
      toast(t("profileUpdated"));
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setSharingPhone(false);
    }
  }

  async function handleShareLocation() {
    if (!isTelegramSession()) return;
    haptic("light");
    setSharingLocation(true);
    try {
      const loc = await requestLocation();
      if (!loc) {
        toast(t("featureUnavailable"));
        return;
      }
      const gpsTag = `[GPS: ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}]`;
      const base =
        profile?.address && !profile.address.includes("[GPS:")
          ? `${gpsTag} ${profile.address}`
          : profile?.address
            ? profile.address.replace(/\[GPS:[^\]]+\]/, gpsTag)
            : gpsTag;
      await updateProfile({ address: base });
      toast(t("profileUpdated"));
    } catch (err) {
      toast(apiErrorMessage(err));
    } finally {
      setSharingLocation(false);
    }
  }

  const avatar = profile?.photoUrl ? (
    <img
      src={profile.photoUrl}
      alt=""
      style={{
        width: 60,
        height: 60,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        boxShadow: "0 6px 16px var(--accent-glow)",
      }}
    />
  ) : (
    <div
      style={{
        width: 60,
        height: 60,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--accent), var(--gold))",
        color: "var(--on-accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 26,
        fontWeight: 700,
        boxShadow: "0 6px 16px var(--accent-glow)",
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );

  if (profileStatus === "loading") {
    return (
      <div className="screen">
        <PageTitle title={t("nav_profile")} />
        <div className="card profile-skel-row" style={{ padding: 20 }}>
          <div className="skeleton" style={{ width: 60, height: 60, borderRadius: "50%", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ height: 18, width: "55%" }} />
            <div className="skeleton" style={{ height: 13, width: "38%" }} />
            <div className="skeleton" style={{ height: 11, width: "28%" }} />
          </div>
        </div>
        <div className="card" style={{ display: "flex", marginTop: 12 }}>
          <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
            <div className="skeleton" style={{ height: 26, width: 64, margin: "0 auto" }} />
            <div className="skeleton" style={{ height: 11, width: 48, margin: "8px auto 0" }} />
          </div>
          <div style={{ width: 1, background: "var(--line)" }} />
          <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
            <div className="skeleton" style={{ height: 26, width: 64, margin: "0 auto" }} />
            <div className="skeleton" style={{ height: 11, width: 48, margin: "8px auto 0" }} />
          </div>
        </div>
        <div className="section-title">
          <span>{t("contactInfo")}</span>
        </div>
        <div className="card" style={{ padding: 18, display: "flex", gap: 12 }}>
          <div className="skeleton" style={{ width: 18, height: 18, borderRadius: 8, marginTop: 2 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: "82%" }} />
            <div className="skeleton" style={{ height: 14, width: "58%" }} />
            <div className="skeleton" style={{ height: 13, width: "40%" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageTitle title={t("nav_profile")} />

      <button
        className={`chip ${""}`}
        style={{ marginLeft: "auto", display: "flex", marginBottom: 10 }}
        aria-label={t("settingsTitle")}
        onClick={() => navigate("/settings")}
      >
        <Settings size={16} /> {t("settingsTitle")}
      </button>

      <div className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
        {avatar}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
            {profile?.firstName ?? profile?.username ?? "Sabacos"}
          </div>
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {profile?.username ? `@${profile.username}` : t("telegramUser")}
          </div>
          {memberSince && (
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              {t("memberSince")} {memberSince}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ display: "flex", marginTop: 12 }}>
        <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{stats.count}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {t("ordersCount", { count: stats.count })}
          </div>
        </div>
        <div style={{ width: 1, background: "var(--line)" }} />
        <div style={{ flex: 1, textAlign: "center", padding: "16px 8px" }}>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{formatETB(stats.spent)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{t("totalSpent")}</div>
        </div>
      </div>

      <div className="section-title">
        <span>{t("contactInfo")}</span>
      </div>
      <div className="card" style={{ padding: editing ? 16 : 18 }}>
        {editing ? (
          <div>
            <div className="field">
              <label>{t("phone")}</label>
              <input
                value={phone}
                inputMode="tel"
                placeholder={t("phonePlaceholder")}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t("deliveryAddress")}</label>
              <textarea
                value={address}
                placeholder={t("addressPlaceholder")}
                rows={3}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
            {errorMsg && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--accent-strong)" }}>{errorMsg}</p>
            )}
            <div className="flex" style={{ gap: 8, marginTop: 4 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={saving} onClick={handleSave}>
                {saving ? (
                  <Loader2 size={16} style={{ animation: "spin 1.2s linear infinite" }} />
                ) : (
                  <Check size={16} />
                )}
                {t("saveChanges")}
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                {t("cancel")}
              </button>
            </div>
          </div>
        ) : profile?.phone || profile?.address ? (
          <div>
            <div className="flex" style={{ gap: 12, alignItems: "flex-start" }}>
              <MapPin size={18} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                {profile.address && <div style={{ fontSize: 14, lineHeight: 1.5 }}>{profile.address}</div>}
                {profile.phone && (
                  <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{profile.phone}</div>
                )}
              </div>
            </div>
            <div className="flex" style={{ marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={startEdit}>
                <Pencil size={15} />
                {t("edit")}
              </button>
              {isTelegramSession() && !profile.phone && (
                <button className="btn btn-ghost" disabled={sharingPhone} onClick={handleSharePhone}>
                  {sharingPhone ? (
                    <Loader2 size={15} style={{ animation: "spin 1.2s linear infinite" }} />
                  ) : (
                    <Phone size={15} />
                  )}
                  {t("sharePhone")}
                </button>
              )}
              {isTelegramSession() && (
                <button className="btn btn-ghost" disabled={sharingLocation} onClick={handleShareLocation}>
                  {sharingLocation ? (
                    <Loader2 size={15} style={{ animation: "spin 1.2s linear infinite" }} />
                  ) : (
                    <Navigation size={15} />
                  )}
                  {t("shareLocation")}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "4px 0" }}>
            <MapPin size={28} className="muted" style={{ marginBottom: 8 }} />
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.5 }}>{t("addContactInfo")}</p>
            <div className="flex" style={{ justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn btn-secondary" onClick={startEdit}>
                <Pencil size={15} />
                {t("edit")}
              </button>
              {isTelegramSession() && (
                <>
                  <button className="btn btn-secondary" disabled={sharingPhone} onClick={handleSharePhone}>
                    {sharingPhone ? (
                      <Loader2 size={15} style={{ animation: "spin 1.2s linear infinite" }} />
                    ) : (
                      <Phone size={15} />
                    )}
                    {t("sharePhone")}
                  </button>
                  <button className="btn btn-secondary" disabled={sharingLocation} onClick={handleShareLocation}>
                    {sharingLocation ? (
                      <Loader2 size={15} style={{ animation: "spin 1.2s linear infinite" }} />
                    ) : (
                      <Navigation size={15} />
                    )}
                    {t("shareLocation")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

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
        {stats.count > 0 && <span className="badge badge-accent">{stats.count}</span>}
        <span className="muted">→</span>
      </button>

      <div className="card" style={{ padding: 18, marginTop: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <MapPin size={18} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          Sabacos · {t("tagline")} · ETB
        </p>
      </div>
    </div>
  );
}