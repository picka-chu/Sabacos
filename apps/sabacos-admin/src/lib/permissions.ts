import type { ProfileRole } from "@sabacos/core";

/** Pages that each role can access. */
const ROLE_PAGES: Record<ProfileRole, readonly string[]> = {
  admin: [
    "/",
    "/products",
    "/products/new",
    "/products/:id",
    "/categories",
    "/orders",
    "/orders/:id",
    "/analytics",
    "/users",
    "/waitlist",
    "/broadcast",
    "/referrals",
    "/spinner-prizes",
    "/discounts",
    "/settings",
  ],
  staff: [
    "/",
    "/products",
    "/products/new",
    "/products/:id",
    "/categories",
    "/orders",
    "/orders/:id",
    "/analytics",
    "/broadcast",
    "/discounts",
  ],
  delivery: [
    "/",
    "/orders",
    "/orders/:id",
  ],
  customer: [],
};

/** Check whether a role can access a given path. */
export function canAccessPage(role: ProfileRole, path: string): boolean {
  const allowed = ROLE_PAGES[role] ?? [];
  return allowed.some((pattern) => {
    if (pattern === path) return true;
    if (pattern.includes(":id")) {
      const prefix = pattern.replace("/:id", "").replace(/\/:[\w]+/, "");
      return path.startsWith(prefix) && /^\/[\w-]+$/.test(path.slice(prefix.length));
    }
    return false;
  });
}

/** Pages visible in the sidebar for each role. */
const ROLE_SIDEBAR: Record<ProfileRole, readonly string[]> = {
  admin: [
    "/",
    "/products",
    "/categories",
    "/discounts",
    "/orders",
    "/analytics",
    "/users",
    "/waitlist",
    "/broadcast",
    "/referrals",
    "/spinner-prizes",
    "/settings",
  ],
  staff: [
    "/",
    "/products",
    "/categories",
    "/discounts",
    "/orders",
    "/analytics",
    "/broadcast",
  ],
  delivery: [
    "/",
    "/orders",
  ],
  customer: [],
};

export function canShowInSidebar(role: ProfileRole, path: string): boolean {
  return (ROLE_SIDEBAR[role] ?? []).includes(path);
}
