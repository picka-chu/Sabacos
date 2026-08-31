import { useEffect, useState } from "react";
import { Users, Search, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "../auth.js";
import { api, apiErrorMessage } from "../lib/api.js";
import { useToast } from "../components/toast.js";
import type { Profile, ProfileRole } from "@sabacos/core";
import { SkeletonTable, EmptyState } from "../components/ui.js";

const ROLES: ProfileRole[] = ["admin", "staff", "delivery", "customer"];
const ROLE_LABELS: Record<ProfileRole, string> = { admin: "Admin", staff: "Staff", delivery: "Delivery", customer: "Customer" };
const ROLE_BADGE_CLASS: Record<ProfileRole, string> = { admin: "badge-danger", staff: "badge-info", delivery: "badge-success", customer: "" };

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

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Users</h1>
        <button className="btn btn-primary" onClick={() => setShowInvite(true)}>
          <Plus size={16} /> Invite User
        </button>
      </div>

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
