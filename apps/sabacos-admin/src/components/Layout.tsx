import { LayoutDashboard, Package, Tags, ClipboardList, Settings, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "../auth.js";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/products", label: "Products", icon: Package },
  { path: "/categories", label: "Categories", icon: Tags },
  { path: "/orders", label: "Orders", icon: ClipboardList },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const email = useAuth((s) => s.email);
  const signOut = useAuth((s) => s.signOut);

  return (
    <div className="app-shell">
      <aside className="sidebar">
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
          <span className="sidebar-email">{email}</span>
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