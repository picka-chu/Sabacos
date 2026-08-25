import { useEffect, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { Info } from "lucide-react";
import { api } from "./api.js";
import { I18nProvider, useI18n } from "./i18n.js";
import { applyTelegramTheme, getTelegramWebApp, haptic, isTelegramSession } from "./telegram.js";
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
import { AboutPage } from "./pages/AboutPage.js";
import { FaqPage } from "./pages/FaqPage.js";
import { WaitlistPage } from "./pages/WaitlistPage.js";

function Shell() {
  const setProfile = useShopStore((s) => s.setProfile);
  const setProfileStatus = useShopStore((s) => s.setProfileStatus);
  const refreshCart = useShopStore((s) => s.refreshCart);
  const [location] = useLocation();
  const { t } = useI18n();
  const inTelegram = isTelegramSession();

  // Waitlist phase state
  const [waitlistActive, setWaitlistActive] = useState<boolean | null>(null);
  const [waitlistJoined, setWaitlistJoined] = useState(false);

  useEffect(() => {
    applyTelegramTheme();
    const webApp = getTelegramWebApp();
    webApp?.onEvent("themeChanged", applyTelegramTheme);

    api
      .post<{ profile: import("@sabacos/core").Profile }>("/auth/telegram", {})
      .then((res) => setProfile(res.profile))
      .catch(() => setProfileStatus("error"));
    refreshCart().catch(() => {});

    // Check if waitlist phase is active
    api
      .get<{ active: boolean }>("/shop/status")
      .then((res) => {
        setWaitlistActive(res.active);
      })
      .catch(() => {
        setWaitlistActive(false);
      });
  }, [setProfile, setProfileStatus, refreshCart]);

  // If waitlist is active, check if the user has already joined
  useEffect(() => {
    if (!waitlistActive) return;
    api
      .get<{ joined: boolean }>("/waitlist/status")
      .then((res) => setWaitlistJoined(res.joined))
      .catch(() => {});
  }, [waitlistActive]);

  useEffect(() => {
    const bb = getTelegramWebApp()?.BackButton;
    if (!bb) return;
    const onClick = () => {
      haptic("light");
      window.history.back();
    };
    bb.onClick(onClick);
    return () => bb.offClick(onClick);
  }, []);

  useEffect(() => {
    const bb = getTelegramWebApp()?.BackButton;
    if (!bb) return;
    if (location !== "/") bb.show();
    else bb.hide();
  }, [location]);

  // Waitlist loading skeleton
  if (waitlistActive === null) {
    return (
      <div className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div className="skeleton" style={{ width: 48, height: 48, borderRadius: "50%" }} />
      </div>
    );
  }

  // Waitlist active: show waitlist page (position card if joined, join form if not)
  if (waitlistActive) {
    return (
      <>
        <WaitlistPage />
        <ToastHost />
      </>
    );
  }

  // Normal mode (shop open)
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
        <Route path="/about" component={AboutPage} />
        <Route path="/faq" component={FaqPage} />
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