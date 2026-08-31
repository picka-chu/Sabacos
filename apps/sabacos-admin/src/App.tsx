import { useEffect, useMemo } from "react";
import { Route, Switch } from "wouter";
import { useAuth } from "./auth.js";
import { getTelegramInitData } from "./lib/api.js";
import { Layout } from "./components/Layout.js";
import { ToastContainer } from "./components/toast.js";
import { LoginPage } from "./pages/LoginPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ProductsPage } from "./pages/ProductsPage.js";
import { ProductEditPage } from "./pages/ProductEditPage.js";
import { CategoriesPage } from "./pages/CategoriesPage.js";
import { OrdersPage } from "./pages/OrdersPage.js";
import { OrderDetailPage } from "./pages/OrderDetailPage.js";
import { BroadcastPage } from "./pages/BroadcastPage.js";
import { AnalyticsPage } from "./pages/AnalyticsPage.js";
import { WaitlistPage } from "./pages/WaitlistPage.js";
import { DiscountsPage } from "./pages/DiscountsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { UsersPage } from "./pages/UsersPage.js";
import { ReferralsPage } from "./pages/ReferralsPage.js";

function Gate({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const profile = useAuth((s) => s.profile);
  const ready = useAuth((s) => s.ready);
  const restore = useAuth((s) => s.restore);
  const restoreFromTelegram = useAuth((s) => s.restoreFromTelegram);
  const finishAuth = useAuth((s) => s.finishAuth);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await restore();
      if (!useAuth.getState().token) {
        await restoreFromTelegram();
      }
      if (!cancelled) finishAuth();
    })();
    return () => {
      cancelled = true;
    };
  }, [restore, restoreFromTelegram, finishAuth]);

  const inTelegram = useMemo(() => Boolean(getTelegramInitData()), []);

  if (!ready) {
    return (
      <div className="auth-screen">
        <div style={{ textAlign: "center" }}>
          <div className="login-brand" style={{ marginBottom: 16 }}>
            <em>S</em>abacos
          </div>
          <div className="skeleton" style={{ width: 120, height: 6, margin: "0 auto", borderRadius: 3 }} />
        </div>
      </div>
    );
  }

  if (!token && !profile) {
    if (inTelegram) {
      return (
        <div className="auth-screen">
          <div className="card auth-card" style={{ textAlign: "center" }}>
            <div className="login-brand"><em>S</em>abacos</div>
            <div style={{ margin: "12px 0 4px", fontSize: 13, color: "var(--muted)" }}>Admin Dashboard</div>
            <div className="error-text" style={{ marginTop: 20 }}>
              This Telegram account isn't authorized to open the admin dashboard.
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Open it from the bot's Admin Dashboard button, or sign in from a browser with an admin account.
            </div>
          </div>
        </div>
      );
    }
    return <LoginPage />;
  }

  return (
    <>
      <Layout>{children}</Layout>
      <ToastContainer />
    </>
  );
}

export default function App() {
  return (
    <>
      <Switch>
        <Route path="/login">
          <Gate><LoginPage /></Gate>
        </Route>
        <Route path="/">
          <Gate><DashboardPage /></Gate>
        </Route>
        <Route path="/products">
          <Gate><ProductsPage /></Gate>
        </Route>
        <Route path="/products/new">
          <Gate><ProductEditPage /></Gate>
        </Route>
        <Route path="/products/:id">
          <Gate><ProductEditPage /></Gate>
        </Route>
        <Route path="/categories">
          <Gate><CategoriesPage /></Gate>
        </Route>
        <Route path="/orders">
          <Gate><OrdersPage /></Gate>
        </Route>
        <Route path="/orders/:id">
          <Gate><OrderDetailPage /></Gate>
        </Route>
        <Route path="/analytics">
          <Gate><AnalyticsPage /></Gate>
        </Route>
        <Route path="/waitlist">
          <Gate><WaitlistPage /></Gate>
        </Route>
        <Route path="/discounts">
          <Gate><DiscountsPage /></Gate>
        </Route>
        <Route path="/broadcast">
          <Gate><BroadcastPage /></Gate>
        </Route>
        <Route path="/settings">
          <Gate><SettingsPage /></Gate>
        </Route>
        <Route path="/users">
          <Gate><UsersPage /></Gate>
        </Route>
        <Route path="/referrals">
          <Gate><ReferralsPage /></Gate>
        </Route>
      </Switch>
      <ToastContainer />
    </>
  );
}
