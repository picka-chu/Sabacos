import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Info } from "lucide-react";
import { api } from "./api.js";
import { I18nProvider, useI18n } from "./i18n.js";
import { applyTelegramTheme, getTelegramWebApp, isTelegramSession } from "./telegram.js";
import { BottomNav } from "./components/BottomNav.js";
import { ToastHost } from "./components/Toast.js";
import { useShopStore } from "./store.js";
import { HomePage } from "./pages/HomePage.js";
import { ShopPage } from "./pages/ShopPage.js";
import { CategoryPage } from "./pages/CategoryPage.js";
import { ProductPage } from "./pages/ProductPage.js";
import { CartPage } from "./pages/CartPage.js";
import { CheckoutPage } from "./pages/CheckoutPage.js";
import { OrdersPage } from "./pages/OrdersPage.js";
import { OrderDetailPage } from "./pages/OrderDetailPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

function Shell() {
  const setProfile = useShopStore((s) => s.setProfile);
  const setProfileStatus = useShopStore((s) => s.setProfileStatus);
  const refreshCart = useShopStore((s) => s.refreshCart);
  const [location] = useLocation();
  const { t } = useI18n();
  const inTelegram = isTelegramSession();

  useEffect(() => {
    applyTelegramTheme();
    const webApp = getTelegramWebApp();
    webApp?.onEvent("themeChanged", applyTelegramTheme);

    api
      .post<{ profile: import("@sabacos/core").Profile }>("/auth/telegram", {})
      .then((res) => setProfile(res.profile))
      .catch(() => setProfileStatus("error"));
    refreshCart().catch(() => {});
  }, [setProfile, setProfileStatus, refreshCart]);

  return (
    <>
      {!inTelegram && (
        <div
          style={{
            margin: "0 16px",
            marginTop: "calc(var(--safe-top) + 12px)",
            padding: "10px 14px",
            borderRadius: 14,
            background: "var(--accent-soft)",
            color: "var(--accent-strong)",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <Info size={16} style={{ flexShrink: 0 }} />
          {t("previewBanner")}
        </div>
      )}
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/shop" component={ShopPage} />
        <Route path="/category/:slug" component={CategoryPage} />
        <Route path="/product/:id" component={ProductPage} />
        <Route path="/cart" component={CartPage} />
        <Route path="/checkout" component={CheckoutPage} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/orders/:id" component={OrderDetailPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route>
          <HomePage />
        </Route>
      </Switch>
      {location !== "/checkout" && <BottomNav />}
      <ToastHost />
    </>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  );
}