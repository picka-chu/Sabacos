import { describe, expect, it } from "vitest";
import {
  appRouteUrl,
  buildBroadcastKeyboard,
  normalizeAppPath,
} from "../src/services/broadcast.js";

const WEBAPP = "https://sabacos-web.onrender.com";

describe("normalizeAppPath", () => {
  it("adds a leading slash", () => {
    expect(normalizeAppPath("shop")).toBe("/shop");
    expect(normalizeAppPath("/shop")).toBe("/shop");
    expect(normalizeAppPath("  /cart ")).toBe("/cart");
    expect(normalizeAppPath("")).toBe("");
  });
});

describe("appRouteUrl", () => {
  it("joins base + path without double slashes", () => {
    expect(appRouteUrl(WEBAPP, "/shop")).toBe(`${WEBAPP}/shop`);
    expect(appRouteUrl(`${WEBAPP}/`, "product/abc")).toBe(`${WEBAPP}/product/abc`);
  });
});

describe("buildBroadcastKeyboard", () => {
  it("builds an external url button when not inline", () => {
    const kb = buildBroadcastKeyboard(WEBAPP, {
      buttonText: "Shop now",
      buttonUrl: "https://example.com/sale",
    });
    expect(kb?.inline_keyboard).toEqual([
      [{ text: "Shop now", url: "https://example.com/sale" }],
    ]);
  });

  it("builds a web_app button for an inline in-app target", () => {
    const kb = buildBroadcastKeyboard(WEBAPP, {
      buttonText: "Open shop",
      buttonInline: true,
      buttonTarget: "/shop",
    });
    expect(kb?.inline_keyboard).toEqual([
      [{ text: "Open shop", web_app: { url: `${WEBAPP}/shop` } }],
    ]);
  });

  it("ignores external URL when inline target wins", () => {
    const kb = buildBroadcastKeyboard(WEBAPP, {
      buttonText: "Open shop",
      buttonInline: true,
      buttonTarget: "shop",
      buttonUrl: "https://example.com",
    });
    const button = kb?.inline_keyboard[0]?.[0] as
      | { url?: string; web_app?: { url: string } }
      | undefined;
    expect(button?.web_app?.url).toBe(`${WEBAPP}/shop`);
    expect(button?.url).toBeUndefined();
  });

  it("returns undefined when label missing or inline without target", () => {
    expect(buildBroadcastKeyboard(WEBAPP, { buttonUrl: "https://x.com" })).toBeUndefined();
    expect(
      buildBroadcastKeyboard(WEBAPP, { buttonText: "Go", buttonInline: true, buttonTarget: "" }),
    ).toBeUndefined();
    expect(
      buildBroadcastKeyboard(WEBAPP, { buttonText: "Go", buttonInline: true }),
    ).toBeUndefined();
  });

  it("returns undefined for non-inline without URL", () => {
    expect(buildBroadcastKeyboard(WEBAPP, { buttonText: "Go" })).toBeUndefined();
  });
});
