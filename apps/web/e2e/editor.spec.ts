import { test, expect, type Page } from "@playwright/test";

function collectConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      const text = msg.text();
      if (/favicon\.ico/i.test(text)) return;
      if (/^Failed to load resource:/i.test(text)) return;
      // GPU driver noise from headless Chromium's software rasterizer, not app errors.
      if (/WebGL-.*GL Driver Message/i.test(text)) return;
      messages.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on("pageerror", (err) => messages.push(`[pageerror] ${err.message}`));
  return messages;
}

async function openEditor(page: Page) {
  await page.goto("/");
  const canvas = page.locator(".viewport-wrap canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("play-toggle")).toBeVisible();
  await page.waitForTimeout(1200);
  return canvas;
}

/** Screenshots the canvas region via the compositor (element screenshots of WebGL buffers can be stale). */
async function viewportShot(page: Page): Promise<Buffer> {
  const box = await page.locator(".viewport-wrap").boundingBox();
  if (!box) throw new Error("viewport not found");
  return page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
}

test("editor boots without console or page errors", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);
  expect(await viewportShot(page)).toBeTruthy();
  expect(errors, "no console errors during boot").toEqual([]);
});

test("playback advances the composition", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);
  const before = await viewportShot(page);
  await page.getByTestId("play-toggle").click();
  await page.waitForTimeout(1800);
  const after = await viewportShot(page);
  expect(after.equals(before), "frames should differ while playing").toBe(false);
  expect(errors).toEqual([]);
});

const titleRow = (page: Page) =>
  page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: /^Title$/ }) });

test("selecting a layer shows it in the inspector", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);
  await titleRow(page).click();
  await expect(page.getByTestId("inspector-name")).toHaveValue("Title");
  expect(errors).toEqual([]);
});

test("renaming a layer updates the layer list", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);
  await titleRow(page).click();
  const name = page.getByTestId("inspector-name");
  await expect(name).toHaveValue("Title");
  await name.fill("My Intro");
  await name.press("Enter");
  await expect(
    page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: /^My Intro$/ }) }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("scrubbing the timeline moves the playhead and timecode", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);
  const timecode = page.getByTestId("timecode");
  await expect(timecode).toHaveValue(/^00:00:00$/);
  const timeline = page.locator(".timeline-content");
  const box = await timeline.boundingBox();
  expect(box).not.toBeNull();
  await timeline.click({ position: { x: box!.width * 0.5, y: 12 } });
  await expect(timecode).not.toHaveValue(/^00:00:00$/);
  expect(errors).toEqual([]);
});

test("adding elements creates and selects layers", async ({ page }) => {
  const errors = collectConsole(page);
  await openEditor(page);

  for (const kind of ["text", "rect", "ellipse", "triangle", "line"]) {
    await page.getByTestId(`add-${kind}`).click();
    const name = kind.charAt(0).toUpperCase() + kind.slice(1);
    await expect(
      page.locator(".layer-row").filter({ has: page.locator(".layer-name", { hasText: new RegExp(`^${name}$`) }) }),
    ).toBeVisible();
  }

  // The last added element (line) is selected in the inspector.
  await expect(page.getByTestId("inspector-name")).toHaveValue("Line");
  expect(errors).toEqual([]);
});
