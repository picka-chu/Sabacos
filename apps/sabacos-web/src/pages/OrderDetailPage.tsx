import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  formatETB,
  translateStatus,
  translatePaymentStatus,
  type OrderWithItems,
  type OrderStatus,
} from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { Header } from "../components/Header.js";
import { api } from "../api.js";
import { apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";

const TIMELINE: OrderStatus[] = ["pending_payment", "paid", "processing", "shipped", "delivered"];

function stepIndex(status: OrderStatus): number {
  if (status === "cancelled") return -1;
  const idx = TIMELINE.indexOf(status);
  return idx === -1 ? -1 : idx;
}

export function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { t, lang } = useI18n();
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ order: OrderWithItems }>(`/orders/${params.id}`)
      .then((res) => setOrder(res.order))
      .catch((err) => {
        toast(apiErrorMessage(err));
        navigate("/orders");
      })
      .finally(() => setLoading(false));
  }, [params.id, navigate]);

  if (loading) {
    return (
      <div className="screen">
        <Header showBack />
        <div className="skeleton" style={{ height: 160, borderRadius: 22 }} />
        <div className="skeleton" style={{ height: 60, borderRadius: 16, marginTop: 14 }} />
      </div>
    );
  }

  if (!order) return null;

  const current = stepIndex(order.status);

  return (
    <div className="screen">
      <Header title={order.orderNo} showBack />

      <div className="card" style={{ padding: 18 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{order.orderNo}</strong>
          <span className="badge">
            <span className={`status-dot status-${order.status}`} />
            {translateStatus(lang, order.status)}
          </span>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
          {t("orderPlacedAt")} ·{" "}
          {new Date(order.createdAt).toLocaleString(lang === "am" ? "am-ET" : "en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {current >= 0 && (
        <div className="card" style={{ padding: 18, marginTop: 14 }}>
          <div className="timeline">
            {TIMELINE.map((s, i) => (
              <div key={s} className={`timeline-item ${i === current ? "active" : ""} ${i < current ? "done" : ""}`}>
                {translateStatus(lang, s)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{t("orderSummary")}</h3>
        {order.items.map((item) => (
          <div key={item.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ fontSize: 14 }}>
              {lang === "am" ? item.nameAm : item.nameEn}{" "}
              <span className="muted" style={{ fontSize: 12 }}>× {item.qty}</span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{formatETB(item.subtotalHalala)}</span>
          </div>
        ))}
        <hr className="divider" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">{t("subtotal")}</span>
          <span>{formatETB(order.subtotalHalala)}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <span className="muted">{t("deliveryFee")}</span>
          <span>{order.deliveryFeeHalala === 0 ? t("free") : formatETB(order.deliveryFeeHalala)}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
          <strong>{t("total")}</strong>
          <strong style={{ fontSize: 18 }}>{formatETB(order.totalHalala)}</strong>
        </div>
      </div>

      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{t("deliveryAddressLabel")}</h3>
        <p style={{ margin: 0, fontSize: 14 }}>{order.address}</p>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          {order.customerName} · {order.phone}
        </p>
        {order.note && (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            📝 {order.note}
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">{t("paymentMethod")}</span>
          <span style={{ fontSize: 14 }}>{t("telegramInvoice")}</span>
        </div>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <span className="muted">{t("payment_success")}</span>
          <span className={`badge ${order.paymentStatus === "success" ? "badge-success" : "badge-gold"}`}>
            {translatePaymentStatus(lang, order.paymentStatus)}
          </span>
        </div>
      </div>
    </div>
  );
}