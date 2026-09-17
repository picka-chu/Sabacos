import { useEffect, useState } from "react";
import { Users, Search, Plus, Trash2, ChevronLeft, ChevronRight, Shield, Save, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "../auth.js";
import { api, apiErrorMessage } from "../lib/api.js";
import { useToast } from "../components/toast.js";
import type { Profile, ProfileRole, Settings } from "@sabacos/core";
import { SkeletonTable, EmptyState } from "../components/ui.js";
import { ALL_PAGE_PATHS, usePermissions } from "../lib/permissions.js";

const ROLES: ProfileRole[] = ["admin", "staff", "delivery", "customer"];
const ADMIN_ROLES: ProfileRole[] = ["admin", "staff", "delivery"];
const ROLE_LABELS: Record<ProfileRole, string> = { admin: "Admin", staff: "Staff", delivery: "Delivery", customer: "Customer" };
const ROLE_BADGE_CLASS: Record<ProfileRole, string> = { admin: "badge-danger", staff: "badge-info", delivery: "badge-success", customer: "" };

const PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/products": "Products",
  "/categories": "Categories",
  "/discounts": "Discounts",
  "/orders": "Orders",
  "/analytics": "Analytics",
  "/broadcast": "Broadcast",
  "/users": "Users",
  "/waitlist": "Waitlist",
  "/referrals": "Referrals",
  "/spinner-prizes": "Spinner Prizes",
  "/settings": "Settings",
  "/permissions": "Permissions",
};

const DEFAULTS: Record<string, string[]> = {
  admin: [...ALL_PAGE_PATHS],
  staff: ["/", "/products", "/categories", "/discounts", "/orders", "/analytics", "/broadcast"],
  delivery: ["/", "/orders"],
};

export function UsersPage() {
  const token = useAuth((s) => s.token);
  const [users, setUsers] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [roleFilter, setRoleFilter] = useState<ProfileRole | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteTelegramId, setInviteTelegramId] = useState("");
  const [inviteRole, setInviteRole] = useState<ProfileRole>("staff");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const toast = useToast((s) => s.add);

  // --- Role permissions state ---
  const [perms, setPerms] = useState<Record<string, string[]>>({});
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [permsSaving, setPermsSaving] = useState(false);
  const [permsSaved, setPermsSaved] = useState(false);

  async function fetchUsers() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (roleFilter) params.set("role", roleFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const res = await api.get<{ items: Profile[]; total: number }>(`/admin/users?${params.toString()}`, token ?? undefined);
      setUsers(res.items);
      setTotal(res.total);
    } catch (err) {
      console.error("Failed to load users:", err);
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchUsers(); }, [page, roleFilter]);

  useEffect(() => {
    api
      .get<{ settings: Settings }>("/admin/settings", token ?? undefined)
      .then((res) => {
        const stored = res.settings.permissions;
        setPerms(stored ? { ...DEFAULTS, ...stored } : { ...DEFAULTS });
      })
      .catch(() => setPerms({ ...DEFAULTS }));
  }, [token]);

  async function handleInvite() {
    if (!inviteTelegramId.trim()) return;
    setInviteLoading(true); setInviteError("");
    try {
      await api.post("/admin/users/invite", { telegramId: Number(inviteTelegramId), role: inviteRole }, token ?? undefined);
      setShowInvite(false); setInviteTelegramId(""); setInviteRole("staff");
      toast("success", "User invited");
      fetchUsers();
    } catch (err) { setInviteError(apiErrorMessage(err)); } finally { setInviteLoading(false); }
  }

  async function handleRoleChange(userId: string, newRole: ProfileRole) {
    try {
      await api.patch(`/admin/users/${userId}/role`, { role: newRole }, token ?? undefined);
      toast("success", `Role changed to ${ROLE_LABELS[newRole]}`);
      setEditingId(null); fetchUsers();
    } catch (err) { console.error("Failed to update role:", err); }
  }

  async function handleDelete(userId: string) {
    if (!confirm("Remove this user?")) return;
    try {
      await api.del(`/admin/users/${userId}`, token ?? undefined);
      toast("success", "User removed");
      fetchUsers();
    } catch (err) { console.error("Failed to delete user:", err); }
  }

  function togglePerm(role: string, path: string) {
    setPerms((prev) => {
      const current = prev[role] ?? [];
      const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
      return { ...prev, [role]: next };
    });
    setPermsSaved(false);
  }

  async function savePerms() {
    setPermsSaving(true); setPermsSaved(false);
    try {
      await api.put("/admin/settings", { permissions: perms }, token ?? undefined);
      setPermsSaved(true);
      toast("success", "Role permissions saved");
      // Refresh the live enforcement store so the change takes effect immediately.
      await usePermissions.getState().load(token ?? undefined);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Save failed");
    } finally { setPermsSaving(false); }
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Users</h1>
        <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
          <Plus size={16} /> Invite User
        </button>
      </div>

      {/* ── Role Permissions ──────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
            <Shield size={16} /> Role Permissions
          </h3>
          <button className="btn btn-primary btn-sm" onClick={savePerms} disabled={permsSaving}>
            {permsSaving && <span className="spinner" />}
            <Save size={13} /> {permsSaving ? "Saving…" : "Save"}
          </button>
        </div>
        {permsSaved && (
          <div style={{ padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--success-soft)", color: "var(--success)", fontSize: 13, marginBottom: 10 }}>
            Permissions saved.
          </div>
        )}
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
          Toggle which pages each role can access. Admin always has full access.
        </div>

        {ADMIN_ROLES.map((role) => {
          const expanded = expandedRole === role;
          const allowed = perms[role] ?? DEFAULTS[role] ?? [];
          return (
            <div key={role} style={{ borderBottom: "1px solid var(--border-light)" }}>
              <button
                onClick={() => setExpandedRole(expanded ? null : role)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", padding: "10px 0", background: "none", border: "none",
                  cursor: "pointer", fontSize: 14, fontWeight: 600, textTransform: "capitalize",
                  color: "var(--ink)",
                }}
              >
                <span>{ROLE_LABELS[role]} — {allowed.length} page{allowed.length !== 1 ? "s" : ""}</span>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
              {expanded && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "6px 12px", paddingBottom: 14 }}>
                  {ALL_PAGE_PATHS.map((path) => (
                    <label
                      key={path}
                      style={{
                        display: "flex", alignItems: "center", gap: 6, fontSize: 13,
                        cursor: role === "admin" ? "default" : "pointer",
                        opacity: role === "admin" ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allowed.includes(path)}
                        disabled={role === "admin"}
                        onChange={() => togglePerm(role, path)}
                        style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                      />
                      {PAGE_LABELS[path] ?? path}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Search / filter ───────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="input-row" style={{ gridTemplateColumns: "1fr 200px" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <div style={{ position: "relative" }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
              <input
                className="input"
                placeholder="Search by name, username, or phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchUsers()}
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <select className="select" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as ProfileRole | ""); setPage(1); }}>
              <option value="">All Roles</option>
              {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABELS[r]}</option>))}
            </select>
          </div>
        </div>
      </div>

      {/* ── User table ────────────────────────────────────── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <SkeletonTable rows={6} cols={4} />
        ) : users.length === 0 ? (
          <EmptyState icon={<Users size={40} strokeWidth={1.25} />} title="No users found">
            <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Invite users by their Telegram ID to get started.</p>
          </EmptyState>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="table responsive-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Telegram ID</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th style={{ width: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td data-label="User">
                        <div>
                          <strong>{[u.firstName, u.lastName].filter(Boolean).join(" ") || "—"}</strong>
                          {u.username && <div className="muted" style={{ fontSize: 12 }}>@{u.username}</div>}
                        </div>
                      </td>
                      <td data-label="Telegram ID"><span className="muted">{u.telegramId ?? "—"}</span></td>
                      <td data-label="Role">
                        {editingId === u.id ? (
                          <select className="select" value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value as ProfileRole)}
                            onBlur={() => setEditingId(null)} autoFocus
                            style={{ width: "auto", padding: "4px 8px", fontSize: 13 }}>
                            {ROLES.map((r) => (<option key={r} value={r}>{ROLE_LABELS[r]}</option>))}
                          </select>
                        ) : (
                          <span className={`badge ${ROLE_BADGE_CLASS[u.role]}`} style={{ cursor: "pointer" }}
                            onClick={() => setEditingId(u.id)} title="Click to change role">
                            {ROLE_LABELS[u.role]}
                          </span>
                        )}
                      </td>
                      <td data-label="Joined">
                        <span className="muted" style={{ fontSize: 13 }}>
                          {new Date(u.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => handleDelete(u.id)} title="Remove user"
                          style={{ color: "var(--danger)", borderColor: "var(--danger)" }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="spread" style={{ padding: "14px 20px", borderTop: "1px solid var(--border-light)" }}>
                <span className="muted" style={{ fontSize: 13 }}>{total} user(s) · Page {page} of {totalPages}</span>
                <div className="row">
                  <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={14} />
                  </button>
                  <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Invite modal ──────────────────────────────────── */}
      {showInvite && (
        <div className="modal-backdrop" onClick={() => setShowInvite(false)}>
          <div className="card modal-card" onClick={(e) => e.stopPropagation()} style={{ position: "relative" }}>
            <h2 className="page-title" style={{ fontSize: 18, marginBottom: 16 }}>Invite User</h2>
            <div className="field">
              <label>Telegram User ID</label>
              <input className="input" type="number" placeholder="e.g. 123456789"
                value={inviteTelegramId} onChange={(e) => setInviteTelegramId(e.target.value)} />
              <span className="muted" style={{ fontSize: 12 }}>Ask the user to send /start to the bot, then check their Telegram ID.</span>
            </div>
            <div className="field">
              <label>Role</label>
              <select className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as ProfileRole)}>
                {ROLES.filter((r) => r !== "customer").map((r) => (<option key={r} value={r}>{ROLE_LABELS[r]}</option>))}
              </select>
            </div>
            {inviteError && (
              <div style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
                {inviteError}
              </div>
            )}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setShowInvite(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleInvite} disabled={inviteLoading || !inviteTelegramId.trim()}>
                {inviteLoading && <span className="spinner" />}
                {inviteLoading ? "Inviting..." : "Invite"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
