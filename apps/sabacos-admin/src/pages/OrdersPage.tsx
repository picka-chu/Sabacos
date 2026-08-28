import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { formatETB, type Order, type OrderStatus } from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";

interface OrderPageData {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUSES: Array<{ value: OrderStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "pending_payment", label: "Pending payment" },
  { value: "paid", label: "Paid" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const badgeClass = (status: OrderStatus) => {
  switch (status) {
    case "delivered":
      return "badge-success";
    case "paid":
    case "processing":
      return "badge-info";
    case "shipped":
      return "badge-warn";
    case "cancelled":
      return "badge-danger";
    default:
      return "";
  }
};

export function OrdersPage() {
  const token = useAuth((s) => s.token);
  const [, navigate] = useLocation();
  const [data, setData] = useState<OrderPageData | null>(null);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    api
      .get<OrderPageData>(`/admin/orders?${params.toString()}`, token ?? undefined)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load orders"));
  };

  useEffect(load, [token, status]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Orders</h1>
        <select className="select" style={{ width: 200 }} value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")}>
          {STATUSES.map((s) => (
            <option key={s.value || "all"} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="card" style={{ color: "var(--danger)", marginBottom: 14 }}>{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        {!data ? (
          <div className="empty">Loading…</div>
        ) : data.items.length === 0 ? (
          <div className="empty">No orders found</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table responsive-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => (
                  <tr key={order.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/orders/${order.id}`)}>
                    <td data-label="Order" style={{ fontWeight: 600 }}>{order.orderNo}</td>
                    <td data-label="Customer">
                      <div>{order.customerName}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{order.phone}</div>
                    </td>
                    <td data-label="Status">
                      <span className={`badge ${badgeClass(order.status)}`}>{order.status.replace("_", " ")}</span>
                    </td>
                    <td data-label="Payment">
                      <span className={`badge ${order.paymentStatus === "success" ? "badge-success" : order.paymentStatus === "failed" ? "badge-danger" : ""}`}>
                        {order.paymentStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td data-label="Total" style={{ fontWeight: 600 }}>{formatETB(order.totalHalala)}</td>
                    <td data-label="Date" className="muted">
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
  );
}
