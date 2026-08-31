import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  formatETB,
  nextOrderStatuses,
  translateStatus,
  type OrderStatus,
  type OrderWithItems,
} from "@sabacos/core";
import { api } from "../lib/api.js";
import { useAuth } from "../auth.js";
import { useToast } from "../components/toast.js";
import { Skeleton } from "../components/ui.js";

const badgeClass = (status: OrderStatus) => {
  switch (status) {
    case "delivered": return "badge-success";
    case "paid":
    case "processing": return "badge-info";
    case "shipped": return "badge-warn";
    case "cancelled": return "badge-danger";
    default: return "";
  }
};

export function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const token = useAuth((s) => s.token);
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast((s) => s.add);

  const load = () => {
    if (!token) return;
    api
      .get<{ order: OrderWithItems }>(`/admin/orders/${params.id}`, token)
      .then((res) => setOrder(res.order))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load order"));
  };

  useEffect(load, [params.id, token]);

  const transition = async (to: OrderStatus) => {
    if (!token || !order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.patch<{ order: OrderWithItems }>(
        `/admin/orders/${order.id}/status`,
        { status: to },
        token,
      );
      setOrder(res.order);
      toast("success", `Order moved to ${translateStatus("en", to)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      toast("error", err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  if (!order && !error) {
    return (
      <>
        <div className="page-head">
          <button className="btn btn-outline btn-sm" onClick={() => navigate("/orders")}>
            <ArrowLeft size={15} /> Back
          </button>
          <h1 className="page-title">Order</h1>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
          <div className="card">
            <Skeleton className="skeleton-title" style={{ width: "100px" }} />
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-row">
                <Skeleton style={{ height: 14, flex: 1 }} />
                <Skeleton style={{ height: 14, width: 80 }} />
              </div>
            ))}
          </div>
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <Skeleton className="skeleton-title" />
              <Skeleton className="skeleton-text" />
              <Skeleton className="skeleton-text" style={{ width: "70%" }} />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!order) return null;

  const next = nextOrderStatuses(order.status);

  return (
    <>
      <div className="page-head">
        <button className="btn btn-outline btn-sm" onClick={() => navigate("/orders")}>
          <ArrowLeft size={15} />
          Back
        </button>
        <h1 className="page-title" style={{ flex: 1 }}>{order.orderNo}</h1>
        <span className={`badge ${badgeClass(order.status)}`}>{order.status.replace("_", " ")}</span>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="grid grid-detail" style={{ alignItems: "start" }}>
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Items</h3>
            {order.items.map((item) => (
              <div key={item.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0" }}>
                <span style={{ fontSize: 13.5 }}>
                  {item.nameEn} <span className="muted">× {item.qty}</span>
                </span>
                <strong style={{ fontSize: 13.5 }}>{formatETB(item.subtotalHalala)}</strong>
              </div>
            ))}
            <hr className="divider" />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Subtotal</span>
              <span>{formatETB(order.subtotalHalala)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
              <span className="muted">Delivery</span>
              <span>{order.deliveryFeeHalala === 0 ? "Free" : formatETB(order.deliveryFeeHalala)}</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 8, fontSize: 17 }}>
              <strong>Total</strong>
              <strong>{formatETB(order.totalHalala)}</strong>
            </div>
          </div>

          <div className="card">
            <h3 style={{ margin: "0 0 14px", fontSize: 15 }}>Timeline</h3>
            <div className="timeline">
              {(["pending_payment", "paid", "processing", "shipped", "delivered"] as OrderStatus[]).map((s, i) => {
                const current = order.status === s;
                const idx = ["pending_payment", "paid", "processing", "shipped", "delivered"].indexOf(order.status);
                const done = order.status !== "cancelled" && i < idx;
                return (
                  <span key={s} className={`badge ${current ? "active" : ""} ${done ? "done" : ""}`}>
                    {translateStatus("en", s)}
                  </span>
                );
              })}
            </div>
            {next.length > 0 && (
              <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 13 }}>Set status:</span>
                {next.map((s) => (
                  <button key={s} className="btn btn-primary btn-sm" onClick={() => transition(s)} disabled={busy}>
                    {busy ? <span className="spinner" /> : null}
                    {translateStatus("en", s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Customer</h3>
            <p style={{ margin: 0, fontWeight: 600 }}>{order.customerName}</p>
            <p className="muted" style={{ margin: "4px 0" }}>{order.phone}</p>
            <p style={{ margin: "4px 0 0", lineHeight: 1.5, fontSize: 13.5 }}>{order.address}</p>
            {order.note && (
              <p style={{ margin: "10px 0 0", fontStyle: "italic", fontSize: 13, color: "var(--muted)" }}>
                "{order.note}"
              </p>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Payment</h3>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">Status</span>
              <span className={`badge ${order.paymentStatus === "success" ? "badge-success" : order.paymentStatus === "failed" ? "badge-danger" : ""}`}>
                {order.paymentStatus.replace("_", " ")}
              </span>
            </div>
            {order.paymentStatus === "success" && order.providerPaymentChargeId && (
              <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
                <span className="muted">Provider ID</span>
                <code style={{ fontSize: 12 }}>{order.providerPaymentChargeId.slice(0, 16)}…</code>
              </div>
            )}
            {order.paymentStatus === "success" && (
              <button
                className="btn btn-outline btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => window.open(`https://t.me/c/0/${order.telegramPaymentChargeId}`, "_blank")}
              >
                <ExternalLink size={14} />
                Telegram receipt
              </button>
            )}
          </div>

          <div className="card">
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Meta</h3>
            <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>
              Created: {new Date(order.createdAt).toLocaleString()}
              <br />
              Updated: {new Date(order.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
