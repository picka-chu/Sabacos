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
  "/permissions",
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

/** Loaded permissions from settings (keyed by role). */
let loadedPerms: Record<string, string[]> | null = null;

/** Load permissions from server settings. Call once on app init. */
export async function loadPermissions(token?: string): Promise<void> {
  try {
    const res = await api.get<{ settings: { permissions?: Record<string, string[]> | null } }>(
      "/admin/settings",
      token,
    );
    loadedPerms = res.settings.permissions ?? null;
  } catch {
    loadedPerms = null;
  }
}

/** Get the effective permissions for a role. */
function getRolePages(role: ProfileRole): string[] {
  if (loadedPerms && loadedPerms[role]) return loadedPerms[role];
  return DEFAULTS[role] ?? DEFAULTS.customer ?? [];
}

/** Check whether a role can access a given path. */
export function canAccessPage(role: ProfileRole, path: string): boolean {
  const allowed = getRolePages(role);

  // Direct match
  if (allowed.includes(path)) return true;

  // Child route — check parent
  const parent = CHILD_ROUTES[path];
  if (parent && allowed.includes(parent)) return true;

  // Prefix match for detail pages (e.g. /orders/abc123)
  for (const p of allowed) {
    if (p.includes(":id")) {
      const prefix = p.replace("/:id", "");
      if (path.startsWith(prefix + "/")) return true;
    }
  }

  return false;
}

/** Check whether a role should see a path in the sidebar. */
export function canShowInSidebar(role: ProfileRole, path: string): boolean {
  return SIDEBAR_PATHS.includes(path as typeof SIDEBAR_PATHS[number]) && canAccessPage(role, path);
}
