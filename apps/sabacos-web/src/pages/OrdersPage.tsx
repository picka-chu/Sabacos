import { useEffect, useState } from "react";
import { Package, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";
import { formatETB, translateStatus, type Order } from "@sabacos/core";
import { useI18n } from "../i18n.js";
import { PageTitle } from "../components/PageTitle.js";
import { api } from "../api.js";
import { apiErrorMessage } from "../store.js";
import { toast } from "../components/Toast.js";

export function OrdersPage() {
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    api
      .get<{ orders: Order[] }>("/orders")
      .then((res) => setOrders(res.orders))
      .catch((err) => {
        setOrders([]);
        toast(apiErrorMessage(err));
      });
  }, []);

  return (
    <div className="screen">
      <PageTitle title={t("myOrders")} />
      {orders === null ? (
        <div className="card" style={{ padding: 24 }}>{t("loading")}</div>
      ) : orders.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <Package size={44} strokeWidth={1.25} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <h3>{t("noOrders")}</h3>
          <p>{t("noOrdersHint")}</p>
          <button className="btn btn-primary" onClick={() => navigate("/shop")}>
            {t("startShopping")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {orders.map((order) => (
            <button
              key={order.id}
              className="card order-card"
              onClick={() => navigate(`/orders/${order.id}`)}
              style={{ textAlign: "left" }}
            >
              <div className="order-row">
                <strong>{order.orderNo}</strong>
                <span className="badge">
                  <span className={`status-dot status-${order.status}`} />
                  {translateStatus(lang, order.status)}
                </span>
              </div>
              <div className="order-row" style={{ marginTop: 4 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  {new Date(order.createdAt).toLocaleDateString(lang === "am" ? "am-ET" : "en-US", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <span className="flex" style={{ gap: 6 }}>
                  <strong>{formatETB(order.totalHalala)}</strong>
                  <ChevronRight size={16} className="muted" />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}