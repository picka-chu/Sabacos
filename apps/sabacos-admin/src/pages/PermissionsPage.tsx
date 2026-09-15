import { useEffect, useState } from "react";
import { Shield, Save, RotateCcw } from "lucide-react";
import type { Settings } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { Skeleton } from "../components/ui.js";

export const ALL_PAGES = [
  { path: "/", label: "Dashboard" },
  { path: "/products", label: "Products" },
  { path: "/categories", label: "Categories" },
  { path: "/discounts", label: "Discounts" },
  { path: "/orders", label: "Orders" },
  { path: "/analytics", label: "Analytics" },
  { path: "/broadcast", label: "Broadcast" },
  { path: "/users", label: "Users" },
  { path: "/waitlist", label: "Waitlist" },
  { path: "/referrals", label: "Referrals" },
  { path: "/spinner-prizes", label: "Spinner Prizes" },
  { path: "/settings", label: "Settings" },
] as const;

const ROLES = ["admin", "staff", "delivery"] as const;

/** Defaults when no permissions are saved yet. */
const DEFAULTS: Record<string, string[]> = {
  admin: ALL_PAGES.map((p) => p.path),
  staff: ["/", "/products", "/categories", "/discounts", "/orders", "/analytics", "/broadcast"],
  delivery: ["/", "/orders"],
};

export function PermissionsPage() {
  const token = useAuth((s) => s.token);
  const [perms, setPerms] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast((s) => s.add);

  useEffect(() => {
    api
      .get<{ settings: Settings }>("/admin/settings", token ?? undefined)
      .then((res) => {
        const stored = res.settings.permissions;
        setPerms(
          stored
            ? { ...DEFAULTS, ...stored }
            : { ...DEFAULTS },
        );
      })
      .catch(() => setPerms({ ...DEFAULTS }))
      .finally(() => setLoading(false));
  }, [token]);

  const toggle = (role: string, path: string) => {
    setPerms((prev) => {
      const current = prev[role] ?? [];
      const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      return { ...prev, [role]: next };
    });
    setSaved(false);
  };

  const resetDefaults = () => {
    setPerms({ ...DEFAULTS });
    setSaved(false);
  };

  const save = async () => {
    setBusy(true); setSaved(false); setError(null);
    try {
      await api.put(
        "/admin/settings",
        { permissions: perms },
        token ?? undefined,
      );
      setSaved(true);
      toast("success", "Permissions saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">Permissions</h1></div>
        <div className="card" style={{ maxWidth: 800 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <Skeleton className="skeleton-text" style={{ width: "30%", marginBottom: 6 }} />
              <Skeleton className="skeleton-value" style={{ height: 40 }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          <Shield size={22} style={{ marginRight: 8, verticalAlign: "middle" }} />
          Permissions
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={resetDefaults} disabled={busy}>
            <RotateCcw size={14} /> Reset defaults
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner" />}
            <Save size={14} /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)", fontSize: 13, marginBottom: 14 }}>
          Permissions saved.
        </div>
      )}

      <div className="card" style={{ maxWidth: 900, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "10px 12px", color: "var(--muted)", fontWeight: 500 }}>Page</th>
              {ROLES.map((role) => (
                <th key={role} style={{ textAlign: "center", padding: "10px 12px", color: "var(--muted)", fontWeight: 500, textTransform: "capitalize" }}>
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_PAGES.map((page) => (
              <tr key={page.path} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px", fontWeight: 500 }}>{page.label}</td>
                {ROLES.map((role) => {
                  const checked = (perms[role] ?? []).includes(page.path);
                  return (
                    <td key={role} style={{ textAlign: "center", padding: "10px 12px" }}>
                      <label style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(role, page.path)}
                          style={{ width: 18, height: 18, cursor: "pointer", accentColor: "var(--accent)" }}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted)" }}>
          Toggle pages for each role. Changes take effect after saving. Users must reload the dashboard to see updated navigation.
        </div>
      </div>
    </>
  );
}
