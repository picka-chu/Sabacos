import { useEffect, useState } from "react";
import { formatETB } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { SkeletonCard, SkeletonTable, EmptyState } from "../components/ui.js";

interface AnalyticsData {
  range: string; generatedAt: string;
  users: { total: number; newThisWeek: number; newThisMonth: number; byDay: { date: string; count: number }[] };
  orders: { total: number; byDay: { date: string; count: number }[] };
  revenue: { total: number; averageOrderValue: number; byDay: { date: string; revenue: number }[] };
  products: {
    topByOrders: { productId: string; nameEn: string; nameAm: string; qty: number; revenue: number }[];
    topByViews: { productId: string; nameEn: string; nameAm: string; views: number }[];
  };
  categories: {
    topByViews: { categoryId: string; nameEn: string; nameAm: string; views: number }[];
    topByRevenue: { categoryId: string; nameEn: string; nameAm: string; revenue: number }[];
  };
  customers: { top: { profileId: string; name: string; totalSpent: number; orderCount: number }[] };
  engagement: { totalViews: number; uniqueViewers: number };
}

function BarChart({ data, maxVal, label }: { data: { label: string; value: number }[]; maxVal: number; label: string }) {
  if (data.length === 0) return <div className="empty" style={{ padding: "20px 0" }}>No data</div>;
  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-label">{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: maxVal > 0 ? `${(d.value / maxVal) * 100}%` : "0%" }} />
          </div>
          <span className="bar-value">{label === "revenue" ? formatETB(d.value) : d.value}</span>
        </div>
      ))}
    </div>
  );
}

function SparkBars({ data }: { data: { date: string; value: number }[] }) {
  if (data.length === 0) return <div className="empty" style={{ padding: "20px 0" }}>No data</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="spark-bars">
      {data.map((d, i) => (
        <div key={i} className="spark-col" title={`${d.date}: ${d.value}`}>
          <div className="spark-fill" style={{ height: `${(d.value / max) * 100}%` }} />
          <span className="spark-date">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsPage() {
  const token = useAuth((s) => s.token);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("30d");

  useEffect(() => {
    if (!token) return;
    setData(null); setError(null);
    api
      .get<{ analytics: AnalyticsData }>(`/admin/analytics?range=${range}`, token)
      .then((res) => setData(res.analytics))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"));
  }, [token, range]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Analytics</h1>
        <div className="row" style={{ gap: 4 }}>
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button key={r} className={`btn btn-sm ${range === r ? "btn-primary" : "btn-outline"}`} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="stagger">
          <div className="grid grid-stats" style={{ marginBottom: 16 }}>
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonTable rows={3} cols={3} />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-stats stagger" style={{ marginBottom: 16 }}>
            <div className="card stat-card">
              <div className="stat-label">Total Users</div>
              <div className="stat-value">{data.users.total}</div>
              <div className="stat-sub">{data.users.newThisWeek} new this week</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Total Orders</div>
              <div className="stat-value">{data.orders.total}</div>
              <div className="stat-sub">{data.users.newThisMonth} new users/month</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Revenue</div>
              <div className="stat-value">{formatETB(data.revenue.total)}</div>
              <div className="stat-sub">Avg {formatETB(data.revenue.averageOrderValue)}</div>
            </div>
            <div className="card stat-card">
              <div className="stat-label">Product Views</div>
              <div className="stat-value">{data.engagement.totalViews}</div>
              <div className="stat-sub">{data.engagement.uniqueViewers} unique viewers</div>
            </div>
          </div>

          <div className="grid grid-2col" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Revenue trend</h3>
              <SparkBars data={data.revenue.byDay.map((d) => ({ date: d.date, value: d.revenue }))} />
            </div>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Orders trend</h3>
              <SparkBars data={data.orders.byDay.map((d) => ({ date: d.date, value: d.count }))} />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>New users trend</h3>
            <SparkBars data={data.users.byDay.map((d) => ({ date: d.date, value: d.count }))} />
          </div>

          <div className="grid grid-2col" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Top products by orders</h3>
              {data.products.topByOrders.length === 0 ? (
                <div className="empty" style={{ padding: "20px 0" }}>No orders yet</div>
              ) : (
                <BarChart data={data.products.topByOrders.map((p) => ({ label: p.nameEn || p.nameAm, value: p.qty }))} maxVal={data.products.topByOrders[0]?.qty ?? 1} label="qty" />
              )}
            </div>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Top products by views</h3>
              {data.products.topByViews.length === 0 ? (
                <div className="empty" style={{ padding: "20px 0" }}>No views yet</div>
              ) : (
                <BarChart data={data.products.topByViews.map((p) => ({ label: p.nameEn || p.nameAm, value: p.views }))} maxVal={data.products.topByViews[0]?.views ?? 1} label="views" />
              )}
            </div>
          </div>

          <div className="grid grid-2col" style={{ marginBottom: 16 }}>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Categories by views</h3>
              {data.categories.topByViews.length === 0 ? (
                <div className="empty" style={{ padding: "20px 0" }}>No data</div>
              ) : (
                <BarChart data={data.categories.topByViews.map((c) => ({ label: c.nameEn || c.nameAm, value: c.views }))} maxVal={data.categories.topByViews[0]?.views ?? 1} label="views" />
              )}
            </div>
            <div className="card">
              <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Categories by revenue</h3>
              {data.categories.topByRevenue.length === 0 ? (
                <div className="empty" style={{ padding: "20px 0" }}>No data</div>
              ) : (
                <BarChart data={data.categories.topByRevenue.map((c) => ({ label: c.nameEn || c.nameAm, value: c.revenue }))} maxVal={data.categories.topByRevenue[0]?.revenue ?? 1} label="revenue" />
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Top customers</h3>
            {data.customers.top.length === 0 ? (
              <EmptyState title="No customers yet" />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr><th>Customer</th><th>Orders</th><th>Total spent</th></tr>
                  </thead>
                  <tbody>
                    {data.customers.top.map((c) => (
                      <tr key={c.profileId}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td>{c.orderCount}</td>
                        <td style={{ fontWeight: 600 }}>{formatETB(c.totalSpent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
            Generated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </>
      )}
    </>
  );
}
