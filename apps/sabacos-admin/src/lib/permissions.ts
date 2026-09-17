import { create } from "zustand";
import type { ProfileRole } from "@sabacos/core";
import { api } from "./api.js";

/** All page paths in the admin dashboard. */
export const ALL_PAGE_PATHS = [
  "/",
  "/products",
  "/categories",
  "/discounts",
  "/orders",
  "/analytics",
  "/broadcast",
  "/users",
  "/waitlist",
  "/referrals",
  "/spinner-prizes",
  "/settings",
] as const;

/** Sidebar-only paths (excludes detail/edit routes). */
const SIDEBAR_PATHS = ALL_PAGE_PATHS;

/** Hardcoded defaults — used when no settings are saved yet. */
const DEFAULTS: Record<string, string[]> = {
  admin: [...ALL_PAGE_PATHS],
  staff: ["/", "/products", "/categories", "/discounts", "/orders", "/analytics", "/broadcast"],
  delivery: ["/", "/orders"],
};

/** Detail/edit routes that inherit access from their parent. */
const CHILD_ROUTES: Record<string, string> = {
  "/products/new": "/products",
  "/products/:id": "/products",
  "/orders/:id": "/orders",
};

interface PermissionsState {
  /** null = not loaded yet, {} or populated = loaded */
  perms: Record<string, string[]> | null;
  loaded: boolean;
  load: (token?: string) => Promise<void>;
}

export const usePermissions = create<PermissionsState>((set) => ({
  perms: null,
  loaded: false,
  load: async (token?: string) => {
    try {
      const res = await api.get<{ settings: { permissions?: Record<string, string[]> | null } }>(
        "/admin/settings",
        token,
      );
      set({ perms: res.settings.permissions ?? {}, loaded: true });
    } catch {
      set({ perms: {}, loaded: true });
    }
  },
}));

/** Get the effective permissions for a role. */
function getRolePages(role: ProfileRole, perms: Record<string, string[]> | null): string[] {
  if (perms && perms[role]) return perms[role];
  return DEFAULTS[role] ?? [];
}

/** Check whether a role can access a given path. */
export function canAccessPage(role: ProfileRole, path: string, perms: Record<string, string[]> | null): boolean {
  const allowed = getRolePages(role, perms);

  if (allowed.includes(path)) return true;

  const parent = CHILD_ROUTES[path];
  if (parent && allowed.includes(parent)) return true;

  for (const p of allowed) {
    if (p.includes(":id")) {
      const prefix = p.replace("/:id", "");
      if (path.startsWith(prefix + "/")) return true;
    }
  }

  return false;
}

/** Check whether a role should see a path in the sidebar. */
export function canShowInSidebar(role: ProfileRole, path: string, perms: Record<string, string[]> | null): boolean {
  return SIDEBAR_PATHS.includes(path as typeof SIDEBAR_PATHS[number]) && canAccessPage(role, path, perms);
}
