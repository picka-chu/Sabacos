import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { api } from "./api.js";
import { I18nProvider } from "./i18n.js";
import { applyTelegramTheme, getTelegramWebApp } from "./telegram.js";
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

function Shell() {
  const setProfile = useShopStore((s) => s.setProfile);
  const refreshCart = useShopStore((s) => s.refreshCart);
  const [location] = useLocation();

  useEffect(() => {
    applyTelegramTheme();
    const webApp = getTelegramWebApp();
    webApp?.onEvent("themeChanged", applyTelegramTheme);

    api
      .post<{ profile: import("@sabacos/core").Profile }>("/auth/telegram", {})
      .then((res) => setProfile(res.profile))
      .catch(() => {});
    refreshCart().catch(() => {});
  }, [setProfile, refreshCart]);

  return (
    <>
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