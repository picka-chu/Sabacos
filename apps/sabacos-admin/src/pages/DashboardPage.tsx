import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatETB, translateStatus, type Order } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";

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
        <span className="muted">{stats ? new Date(stats.generatedAt).toLocaleString() : ""}</span>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)" }}>{error}</div>}

      {!stats && !error && <div className="card muted">Loading…</div>}

      {stats && (
        <>
          <div className="grid grid-stats">
            <div className="card stat-card">
              <div className="stat-label">Total revenue</div>
              <div className="stat-value">{formatETB(stats.totalRevenue)}</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Today</div>
              <div className="stat-value">{formatETB(stats.todayRevenue)}</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Orders</div>
              <div className="stat-value">{stats.totalOrders}</div>
              <div className="stat-sub">{stats.todayOrders} today</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Low stock</div>
              <div className="stat-value" style={{ color: stats.lowStock.length ? "var(--danger)" : undefined }}>
                {stats.lowStock.length}
              </div>
              <div className="stat-sub">items ≤ 5 units</div>
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
            <div className="card">
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Orders by status</h3>
              {Object.entries(stats.orderCounts).length === 0 ? (
                <div className="empty">No orders yet</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(stats.orderCounts).map(([status, count]) => (
                    <div className="row" key={status}>
                      <span className="badge">{status.replace("_", " ")}</span>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Low stock alerts</h3>
              {stats.lowStock.length === 0 ? (
                <div className="empty">All good</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stats.lowStock.map((p) => (
                    <div className="row" key={p.id}>
                      <span style={{ flex: 1 }}>{p.name}</span>
                      <span className="badge badge-danger">{p.stock} left</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Recent orders</h3>
            {stats.recentOrders.length === 0 ? (
              <div className="empty">No orders yet</div>
            ) : (
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
                    <tr key={order.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${order.id}`)}>
                      <td style={{ fontWeight: 600 }}>{order.orderNo}</td>
                      <td>
                        <span className="badge">{order.status.replace("_", " ")}</span>
                      </td>
                      <td>{formatETB(order.totalHalala)}</td>
                      <td className="muted">
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
            )}
          </div>
        </>
      )}
    </>
  );
}