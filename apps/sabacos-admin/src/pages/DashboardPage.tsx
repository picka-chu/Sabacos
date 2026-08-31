import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatETB, translateStatus, type Order } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { SkeletonCard, SkeletonTable } from "../components/ui.js";

interface Stats {
  totalRevenue: number;
  todayRevenue: number;
  totalOrders: number;
  todayOrders: number;
  orderCounts: Record<string, number>;
  lowStock: { id: string; name: string; stock: number }[];
  recentOrders: Order[];
  generatedAt: string;
}

function StatCard({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={danger ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function DashboardPage() {
  const token = useAuth((s) => s.token);
  const [, navigate] = useLocation();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get<{ stats: Stats }>("/admin/stats", token)
      .then((res) => setStats(res.stats))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load stats"));
  }, [token]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Dashboard</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {stats ? `Updated ${new Date(stats.generatedAt).toLocaleTimeString()}` : ""}
        </span>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!stats && !error && (
        <div className="stagger">
          <div className="grid grid-stats" style={{ marginBottom: 16 }}>
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonTable rows={4} cols={4} />
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-stats stagger" style={{ marginBottom: 16 }}>
            <StatCard label="Total revenue" value={formatETB(stats.totalRevenue)} />
            <StatCard label="Today" value={formatETB(stats.todayRevenue)} />
            <StatCard label="Orders" value={String(stats.totalOrders)} sub={`${stats.todayOrders} today`} />
            <StatCard
              label="Low stock"
              value={String(stats.lowStock.length)}
              sub="items ≤ 5 units"
              danger={stats.lowStock.length > 0}
            />
          </div>

          <div className="grid grid-2col" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Orders by status</h3>
              {Object.entries(stats.orderCounts).length === 0 ? (
                <div className="empty" style={{ padding: "24px 0" }}>No orders yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(stats.orderCounts).map(([status, count]) => (
                    <div key={status} className="row" style={{ justifyContent: "space-between" }}>
                      <span className="badge">{status.replace("_", " ")}</span>
                      <strong style={{ fontSize: 15 }}>{count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Low stock alerts</h3>
              {stats.lowStock.length === 0 ? (
                <div className="empty" style={{ padding: "24px 0" }}>
                  <span style={{ color: "var(--success)", fontSize: 13 }}>All good — nothing is running low.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {stats.lowStock.map((p) => (
                    <div key={p.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
                      <span style={{ flex: 1, fontSize: 13.5 }}>{p.name}</span>
                      <span className="badge badge-danger">{p.stock} left</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Recent orders</h3>
            {stats.recentOrders.length === 0 ? (
              <div className="empty" style={{ padding: "24px 0" }}>No orders yet</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentOrders.map((order) => (
                      <tr
                        key={order.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        <td style={{ fontWeight: 600 }}>{order.orderNo}</td>
                        <td>
                          <span className="badge">{order.status.replace("_", " ")}</span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{formatETB(order.totalHalala)}</td>
                        <td className="muted" style={{ fontSize: 13 }}>
                          {new Date(order.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
