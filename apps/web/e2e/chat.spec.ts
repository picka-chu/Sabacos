import { test, expect, type Page } from "@playwright/test";

const SESSION_OPEN = {
  id: "sess_1",
  projectId: "proj_1",
  description: "",
  status: "open",
  steps: [],
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
}

test("chat panel sends prompt and shows reply with tool calls and review actions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  await mockBackend(page);

  let createdSession = false;
  await page.route("**/api/projects/proj_1/sessions", (route) => {
    createdSession = true;
    return route.fulfill({ json: { session: { ...SESSION_OPEN, id: "sess_new" } } });
  });
  await page.route("**/api/sessions/sess_new/chat", (route) =>
    route.fulfill({
      json: {
        reply: "Added a title layer with a scale-in animation.",
        sessionId: "sess_new",
        calls: [{ name: "addLayer", status: "ok" }, { name: "setLayerTransform", status: "ok" }],
      },
    }),
  );
  await page.route("**/api/sessions/sess_new", (route) =>
    route.fulfill({
      json: {
        session: {
          ...SESSION_OPEN,
          id: "sess_new",
          draft: { id: "proj_1", name: "Smoke test project", fps: 30, width: 1920, height: 1080, compositions: [] },
          baseProject: { id: "proj_1", name: "Smoke test project", fps: 30, width: 1920, height: 1080, compositions: [] },
          steps: [{ at: "2026-01-01T00:00:01.000Z", operations: [{ op: "addLayer", args: {} }] }],
        },
      },
    }),
  );

  await page.goto("/");
  await page.getByTestId("toggle-ai").click();
  const panel = page.locator(".ai-panel");
  await expect(panel).toBeVisible();

  const input = page.getByTestId("ai-input");
  await expect(input).toBeEnabled();
  await input.fill("add a title");
  await page.getByTestId("ai-send").click();

  await expect(createdSession).toBe(true);
  const userMsg = panel.locator(".ai-msg-user");
  await expect(userMsg).toHaveText("add a title");
  const assistantMsg = panel.locator(".ai-msg-assistant");
  await expect(assistantMsg).toContainText("Added a title layer with a scale-in animation.");
  await expect(assistantMsg.locator(".ai-call.is-ok")).toHaveCount(2);

  // Draft applied -> approve/discard appear
  await expect(page.getByTestId("ai-approve")).toBeVisible();
  expect(errors).toEqual([]);
});

test("provider selector offers gemini and ollama", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  await mockBackend(page);

  await page.goto("/");
  await page.getByTestId("toggle-ai").click();
  const select = page.getByTestId("ai-provider");
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(3);
  expect(errors).toEqual([]);
});
