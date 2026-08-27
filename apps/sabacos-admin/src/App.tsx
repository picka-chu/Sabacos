import { useEffect } from "react";
import { Route, Switch } from "wouter";
import { useAuth } from "./auth.js";
import { Layout } from "./components/Layout.js";
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

function Gate({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  const ready = useAuth((s) => s.ready);
  const restore = useAuth((s) => s.restore);

  useEffect(() => {
    restore();
  }, [restore]);

  if (!ready) {
    return <div className="auth-screen"><div className="card muted">Loading…</div></div>;
  }

  if (!token) {
    return <LoginPage />;
  }

  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
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
    </Switch>
  );
}