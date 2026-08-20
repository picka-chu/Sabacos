import { Home, ShoppingBag, ShoppingCart, Package, User } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "../i18n.js";
import { useShopStore } from "../store.js";

const items = [
  { path: "/", key: "nav_home" as const, icon: Home },
  { path: "/shop", key: "nav_shop" as const, icon: ShoppingBag },
  { path: "/cart", key: "nav_cart" as const, icon: ShoppingCart },
  { path: "/orders", key: "nav_orders" as const, icon: Package },
  { path: "/profile", key: "nav_profile" as const, icon: User },
];

export function BottomNav() {
  const [location] = useLocation();
  const { t } = useI18n();
  const itemCount = useShopStore((s) => s.cart.itemCount);

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        {items.map((item) => {
          const Icon = item.icon;
          const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          return (
            <a key={item.path} href={item.path} className={`nav-item ${active ? "active" : ""}`}>
              <Icon size={20} strokeWidth={1.75} />
              <span>{t(item.key)}</span>
              {item.path === "/cart" && itemCount > 0 && (
                <span className="nav-badge">{itemCount > 99 ? "99+" : itemCount}</span>
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}