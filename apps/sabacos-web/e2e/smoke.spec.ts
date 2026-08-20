import { test, expect, type Page } from "@playwright/test";

const CATEGORIES = [
  { id: "00000000-0000-0000-0000-000000000001", slug: "skincare", nameEn: "Skincare", nameAm: "የቆዳ እንክብካቤ", sortOrder: 1, isActive: true },
  { id: "00000000-0000-0000-0000-000000000002", slug: "makeup", nameEn: "Makeup", nameAm: "ሜካፕ", sortOrder: 2, isActive: true },
];

const PRODUCTS = [
  {
    id: "00000000-0000-0000-0000-000000000010",
    categoryId: "00000000-0000-0000-0000-000000000001",
    sku: "TEST-001",
    nameEn: "Rose Glow Serum",
    nameAm: "ሮዝ ግሎ ሴረም",
    descriptionEn: "Hydrating facial serum",
    descriptionAm: "የፊት ሴረም",
    priceHalala: 125000,
    compareAtHalala: null,
    stock: 20,
    imageUrls: ["https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=600"],
    isActive: true,
    isFeatured: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

function mockApi(page: Page) {
  void page.route("**/api/v1/catalog/categories", (route) =>
    route.fulfill({ json: { categories: CATEGORIES } }),
  );
  void page.route("**/api/v1/catalog/products?*", (route) =>
    route.fulfill({ json: { items: PRODUCTS, total: 1, page: 1, pageSize: 24 } }),
  );
  void page.route("**/api/v1/catalog/products/*", (route) =>
    route.fulfill({ json: { product: PRODUCTS[0] } }),
  );
  void page.route("**/api/v1/auth/telegram", (route) =>
    route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "no" } } }),
  );
  void page.route("**/api/v1/cart", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          items: [],
          itemCount: 0,
          totals: { subtotalHalala: 0, deliveryFeeHalala: 10000, totalHalala: 0 },
          deliveryFeeHalala: 10000,
          freeDeliveryThresholdHalala: 150000,
        },
      });
    }
    return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "no" } } });
  });
}

test.beforeEach(async ({ page }) => {
  mockApi(page);
});

test("home page renders brand and hero", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sabacos").first()).toBeVisible();
  await expect(page.locator(".brand-mark")).toBeVisible();
  await expect(page.getByText("Beauty, simplified")).toBeVisible();
});

test("shop page lists products and opens product page", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByText("Rose Glow Serum")).toBeVisible();
  await page.getByText("Rose Glow Serum").click();
  await expect(page.getByText("Rose Glow Serum")).toBeVisible();
  await expect(page.getByText("Add to cart")).toBeVisible();
});

test("product page shows price in ETB and stock", async ({ page }) => {
  await page.goto("/product/00000000-0000-0000-0000-000000000010");
  await expect(page.getByText("1,250.00").first()).toBeVisible();
});

test("category page shows hero and products", async ({ page }) => {
  await page.goto("/category/skincare");
  await expect(page.getByText("Skincare")).toBeVisible();
  await expect(page.getByText("Rose Glow Serum")).toBeVisible();
  await page.getByText("Rose Glow Serum").click();
  await expect(page).toHaveURL(/\/product\//);
});

test("bottom nav is present and navigates", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Shop" }).click();
  await expect(page).toHaveURL(/\/shop$/);
});