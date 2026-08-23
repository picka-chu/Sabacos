import { test, expect, type Page } from "@playwright/test";

const READY_REFERENCE = {
  id: "ref_test1",
  projectId: "proj_1",
  title: "Neon intro",
  sourceUrl: "https://www.youtube.com/watch?v=x",
  sourcePlatform: "youtube",
  kind: "video",
  status: "ready",
  error: null,
  fileUrl: "/media/references/ref_test1.mp4",
  posterUrl: null,
  transcript: {
    language: "en",
    segments: [{ start: 0, end: 1.5, text: "welcome to the show" }],
  },
  style: {
    duration: 8,
    fps: 30,
    width: 1920,
    height: 1080,
    cuts: 6,
    avgShotLength: 1.3,
    pace: "fast",
    palette: [
      { hex: "35c4ff", weight: 0.5 },
      { hex: "101018", weight: 0.3 },
    ],
    avgLuminance: 0.4,
    motion: 0.6,
  },
  mediaId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function mockBackend(page: Page) {
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: { projects: [{ id: "proj_1", name: "Smoke test project", updatedAt: "2026-01-01T00:00:00.000Z" }] },
      });
    }
    return route.continue();
  });
  await page.route("**/api/projects/proj_1/references", (route) =>
    route.fulfill({ json: { references: [READY_REFERENCE] } }),
  );
}

test("references panel lists projects and imported clips with style cards", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  await mockBackend(page);

  await page.goto("/");
  await page.getByTestId("toggle-references").click();

  const panel = page.locator(".refs-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".refs-project-select")).toContainText("Smoke test project");

  const card = panel.locator(".ref-card").first();
  await expect(card).toBeVisible();
  await expect(card.locator(".ref-title")).toHaveText("Neon intro");
  await expect(card.locator(".ref-subtitle")).toContainText("Ready");
  await expect(card.locator(".ref-chip").first()).toContainText("fast pace");
  await expect(card.locator(".ref-swatch")).toHaveCount(2);
  await expect(card.locator(".ref-transcript summary")).toContainText("Transcript (en)");
  expect(errors).toEqual([]);
});

test("importing a URL adds an importing reference row", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

  let importCalled = false;
  await mockBackend(page);
  await page.route("**/api/projects/proj_1/references/import", (route) => {
    importCalled = true;
    return route.fulfill({ json: { reference: { ...READY_REFERENCE, id: "ref_new", title: "Fresh clip", status: "importing" } } });
  });

  await page.goto("/");
  await page.getByTestId("toggle-references").click();
  const panel = page.locator(".refs-panel");
  await expect(panel).toBeVisible();

  await panel.locator('input[type="url"]').fill("https://youtu.be/abc");
  await panel.getByRole("button", { name: "Import", exact: true }).click();

  await expect(importCalled).toBe(true);
  const titles = panel.locator(".ref-title");
  await expect(titles.filter({ hasText: "Fresh clip" })).toBeVisible();
  expect(errors).toEqual([]);
});
