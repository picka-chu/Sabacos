import { useState, useEffect } from "react";
import {
  LayoutDashboard, Package, Tags, ClipboardList, BarChart3,
  ListOrdered, Megaphone, Settings, LogOut, Percent, Users,
  Menu, X, Gift, Trophy,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "../auth.js";

interface NavItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    label: "Catalog",
    items: [
      { path: "/products", label: "Products", icon: Package },
      { path: "/categories", label: "Categories", icon: Tags },
      { path: "/discounts", label: "Discounts", icon: Percent },
    ],
  },
  {
    label: "Commerce",
    items: [
      { path: "/orders", label: "Orders", icon: ClipboardList },
      { path: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Audience",
    items: [
      { path: "/users", label: "Users", icon: Users },
      { path: "/waitlist", label: "Waitlist", icon: ListOrdered },
      { path: "/broadcast", label: "Broadcast", icon: Megaphone },
      { path: "/referrals", label: "Referrals", icon: Gift },
      { path: "/spinner-prizes", label: "Spinner Prizes", icon: Trophy },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function isActive(location: string, path: string) {
  return location === path || (path !== "/" && location.startsWith(path));
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const email = useAuth((s) => s.email);
  const profile = useAuth((s) => s.profile);
  const signOut = useAuth((s) => s.signOut);

  useEffect(() => setSidebarOpen(false), [location]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  const displayName = profile?.firstName ?? email ?? "Admin";
  const initial = (displayName[0] ?? "A").toUpperCase();

  const currentPage = ALL_NAV_ITEMS.find((n) => isActive(location, n.path));

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
          <em>S</em>abacos <span style={{ fontSize: 13, opacity: 0.5 }}>Admin</span>
        </div>
      </header>

      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <em>S</em>abacos
          <span style={{ fontSize: 12, opacity: 0.35, marginLeft: 6, fontWeight: 400 }}>Admin</span>
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="sidebar-section">
            <div className="sidebar-section-label">{group.label}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(location, item.path);
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
                  <Icon size={17} />
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initial}</div>
            <span className="sidebar-email">{displayName}</span>
          </div>
          <button className="sidebar-signout" onClick={() => signOut()}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="content" key={location}>
        <div className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
