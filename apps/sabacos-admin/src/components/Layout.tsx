import { useState, useEffect } from "react";
import { LayoutDashboard, Package, Tags, ClipboardList, BarChart3, ListOrdered, Megaphone, Settings, LogOut, Percent, Users, Menu, X, Gift } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "../auth.js";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/products", label: "Products", icon: Package },
  { path: "/categories", label: "Categories", icon: Tags },
  { path: "/discounts", label: "Discounts", icon: Percent },
  { path: "/orders", label: "Orders", icon: ClipboardList },
  { path: "/analytics", label: "Analytics", icon: BarChart3 },
  { path: "/waitlist", label: "Waitlist", icon: ListOrdered },
  { path: "/users", label: "Users", icon: Users },
  { path: "/referrals", label: "Referrals", icon: Gift },
  { path: "/broadcast", label: "Broadcast", icon: Megaphone },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const email = useAuth((s) => s.email);
  const profile = useAuth((s) => s.profile);
  const signOut = useAuth((s) => s.signOut);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Close sidebar on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  const displayName = profile?.firstName ?? email ?? "Admin";

  return (
    <div className="app-shell">
      {/* Mobile header */}
      <header className="mobile-header">
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
        <div className="mobile-brand">
          <em>S</em>abacos <span className="muted" style={{ fontSize: 13 }}>Admin</span>
        </div>
      </header>

      {/* Sidebar overlay for mobile */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <em>S</em>abacos <span style={{ fontSize: 13, opacity: 0.6 }}>Admin</span>
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          return (
            <a
              key={item.path}
              className={`nav-link ${active ? "active" : ""}`}
              href={item.path}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon size={18} />
              {item.label}
            </a>
          );
        })}
        <div className="sidebar-footer">
          <span className="sidebar-email">{displayName}</span>
          <button className="btn btn-outline btn-sm" onClick={() => signOut()} style={{ color: "#f0e9e1", borderColor: "rgba(255,255,255,0.2)" }}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
