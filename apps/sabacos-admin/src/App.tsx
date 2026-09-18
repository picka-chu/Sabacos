import { useEffect, useMemo } from "react";
import { Route, Switch, useLocation } from "wouter";
import { useAuth } from "./auth.js";
import { getTelegramInitData } from "./lib/api.js";
import type { ProfileRole } from "@sabacos/core";
import { canAccessPage, usePermissions } from "./lib/permissions.js";
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
import { SpinnerPrizesPage } from "./pages/SpinnerPrizesPage.js";
import { BanksPage } from "./pages/BanksPage.js";

function RoleGate({ children, path }: { children: React.ReactNode; path: string }) {
  const role = useAuth((s) => s.profile?.role) as ProfileRole | undefined;
  const perms = usePermissions((s) => s.perms);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (role && !canAccessPage(role, path, perms)) {
      navigate("/", { replace: true });
    }
  }, [role, path, perms, navigate]);

  if (role && !canAccessPage(role, path, perms)) {
    return null;
  }

  return <>{children}</>;
}

function NotFoundPage() {
  const [, navigate] = useLocation();
  return (
    <div className="p-8 text-center">
      <h1 className="text-lg font-semibold mb-2">Page not found</h1>
      <p className="text-sm text-gray-500 mb-4">The page you're looking for doesn't exist.</p>
      <button onClick={() => navigate("/")} className="px-4 py-2 rounded-lg bg-black text-white text-sm">
        Go to dashboard
      </button>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const profile = useAuth((s) => s.profile);
  const ready = useAuth((s) => s.ready);
  const restore = useAuth((s) => s.restore);
  const restoreFromTelegram = useAuth((s) => s.restoreFromTelegram);
  const finishAuth = useAuth((s) => s.finishAuth);
  const loadPerms = usePermissions((s) => s.load);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await restore();
      if (!useAuth.getState().token) {
        await restoreFromTelegram();
      }
      await loadPerms(useAuth.getState().token ?? undefined);
      if (!cancelled) finishAuth();
    })();
    return () => {
      cancelled = true;
    };
  }, [restore, restoreFromTelegram, finishAuth, loadPerms]);

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
          <Gate><RoleGate path="/"><DashboardPage /></RoleGate></Gate>
        </Route>
        <Route path="/products">
          <Gate><RoleGate path="/products"><ProductsPage /></RoleGate></Gate>
        </Route>
        <Route path="/products/new">
          <Gate><RoleGate path="/products/new"><ProductEditPage /></RoleGate></Gate>
        </Route>
        <Route path="/products/:id">
          <Gate><RoleGate path="/products/:id"><ProductEditPage /></RoleGate></Gate>
        </Route>
        <Route path="/categories">
          <Gate><RoleGate path="/categories"><CategoriesPage /></RoleGate></Gate>
        </Route>
        <Route path="/orders">
          <Gate><RoleGate path="/orders"><OrdersPage /></RoleGate></Gate>
        </Route>
        <Route path="/orders/:id">
          <Gate><RoleGate path="/orders/:id"><OrderDetailPage /></RoleGate></Gate>
        </Route>
        <Route path="/analytics">
          <Gate><RoleGate path="/analytics"><AnalyticsPage /></RoleGate></Gate>
        </Route>
        <Route path="/waitlist">
          <Gate><RoleGate path="/waitlist"><WaitlistPage /></RoleGate></Gate>
        </Route>
        <Route path="/discounts">
          <Gate><RoleGate path="/discounts"><DiscountsPage /></RoleGate></Gate>
        </Route>
        <Route path="/broadcast">
          <Gate><RoleGate path="/broadcast"><BroadcastPage /></RoleGate></Gate>
        </Route>
        <Route path="/settings">
          <Gate><RoleGate path="/settings"><SettingsPage /></RoleGate></Gate>
        </Route>
        <Route path="/users">
          <Gate><RoleGate path="/users"><UsersPage /></RoleGate></Gate>
        </Route>
        <Route path="/referrals">
          <Gate><RoleGate path="/referrals"><ReferralsPage /></RoleGate></Gate>
        </Route>
        <Route path="/spinner-prizes">
          <Gate><RoleGate path="/spinner-prizes"><SpinnerPrizesPage /></RoleGate></Gate>
        </Route>
        <Route path="/banks">
          <Gate><RoleGate path="/banks"><BanksPage /></RoleGate></Gate>
        </Route>
        <Route>
          <Gate><NotFoundPage /></Gate>
        </Route>
      </Switch>
      <ToastContainer />
    </>
  );
}
