import { Check, Package, Truck, X } from "lucide-react";
import type { OrderStatus } from "@sabacos/core";

const COLORS: Record<string, string> = {
  pending_payment: "var(--gold)",
  paid: "var(--success)",
  processing: "var(--accent-strong)",
  shipped: "#4a90d9",
  delivered: "var(--success)",
  cancelled: "var(--danger)",
};

export function StatusIcon({ status, size = 15 }: { status: OrderStatus; size?: number }) {
  const color = COLORS[status] ?? "var(--muted)";
  const inner = Math.max(9, Math.round(size * 0.62));

  let glyph = <Package size={inner} strokeWidth={3} />;
  if (status === "pending_payment" || status === "cancelled") {
    glyph = <X size={inner} strokeWidth={3.5} />;
  } else if (status === "paid" || status === "delivered") {
    glyph = <Check size={inner} strokeWidth={3.5} />;
  } else if (status === "processing") {
    glyph = <Package size={inner} strokeWidth={3} />;
  } else if (status === "shipped") {
    glyph = <Truck size={inner - 1} strokeWidth={2.75} />;
  }

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--surface)",
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}
