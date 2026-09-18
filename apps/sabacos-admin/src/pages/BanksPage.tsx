import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Building2, Check, X } from "lucide-react";
import { BANK_NAMES, BANK_LABELS, type BankName, type BankAccount } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useToast } from "../components/toast.js";

const BANK_LOGOS: Record<BankName, string> = {
  cbe: "🏦",
  birr: "🏛️",
  telebirr: "📱",
  awash: "🏢",
  abyssinia: "🏛️",
};

export function BanksPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ bankName: "cbe" as BankName, accountName: "", accountNumber: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ accounts: BankAccount[] }>("/admin/bank-accounts");
      setAccounts(res.accounts);
    } catch (err) {
      console.error("Failed to load bank accounts", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async () => {
    if (!form.accountName.trim() || !form.accountNumber.trim()) {
      toast.add("error", "Account name and number are required");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.patch(`/admin/bank-accounts/${editingId}`, form);
        toast.add("success", "Bank account updated");
      } else {
        await api.post("/admin/bank-accounts", form);
        toast.add("success", "Bank account created");
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ bankName: "cbe", accountName: "", accountNumber: "" });
      await load();
    } catch (err) {
      toast.add("error", String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (account: BankAccount) => {
    setForm({ bankName: account.bankName, accountName: account.accountName, accountNumber: account.accountNumber });
    setEditingId(account.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this bank account?")) return;
    try {
      await api.del(`/admin/bank-accounts/${id}`);
      toast.add("success", "Bank account deleted");
      await load();
    } catch (err) {
      toast.add("error", String(err));
    }
  };

  const handleToggleActive = async (account: BankAccount) => {
    try {
      await api.patch(`/admin/bank-accounts/${account.id}`, { isActive: !account.isActive });
      toast.add("success", account.isActive ? "Bank account deactivated" : "Bank account activated");
      await load();
    } catch (err) {
      toast.add("error", String(err));
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Bank Accounts</h2>
        <button
          className="btn btn-primary"
          onClick={() => { setShowForm(true); setEditingId(null); setForm({ bankName: "cbe", accountName: "", accountNumber: "" }); }}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={16} /> Add Account
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
            {editingId ? "Edit Bank Account" : "Add Bank Account"}
          </h3>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Bank</label>
              <select
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value as BankName })}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 14 }}
              >
                {BANK_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {BANK_LOGOS[name]} {BANK_LABELS[name].en}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Account Holder Name</label>
              <input
                type="text"
                value={form.accountName}
                onChange={(e) => setForm({ ...form, accountName: e.target.value })}
                placeholder="e.g. John Doe"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Account Number</label>
              <input
                type="text"
                value={form.accountNumber}
                onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
                placeholder="e.g. 1234567890"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", fontSize: 14 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowForm(false); setEditingId(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="muted" style={{ textAlign: "center", padding: 40 }}>Loading...</p>
      ) : accounts.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <Building2 size={40} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <p className="muted">No bank accounts configured yet.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {accounts.map((account) => (
            <div key={account.id} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 32 }}>{BANK_LOGOS[account.bankName]}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{BANK_LABELS[account.bankName].en}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {account.accountName} · {account.accountNumber}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-sm"
                  onClick={() => handleToggleActive(account)}
                  title={account.isActive ? "Deactivate" : "Activate"}
                >
                  {account.isActive ? <Check size={14} color="green" /> : <X size={14} color="red" />}
                </button>
                <button className="btn btn-sm" onClick={() => handleEdit(account)} title="Edit">
                  <Pencil size={14} />
                </button>
                <button className="btn btn-sm" onClick={() => handleDelete(account.id)} title="Delete" style={{ color: "var(--danger)" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
