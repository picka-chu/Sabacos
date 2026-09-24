import { describe, expect, it } from "vitest";
import { validateWebAppUrl, webAppPointsAtApi, webAppUrl } from "../src/services/miniapp.js";

describe("webAppUrl", () => {
  it("joins base and path without double slashes", () => {
    expect(webAppUrl("https://app.example.com", "/shop")).toBe("https://app.example.com/shop");
    expect(webAppUrl("https://app.example.com/", "shop")).toBe("https://app.example.com/shop");
    expect(webAppUrl("https://app.example.com/")).toBe("https://app.example.com");
    expect(webAppUrl("https://app.example.com")).toBe("https://app.example.com");
    expect(webAppUrl("https://app.example.com", "")).toBe("https://app.example.com");
  });
});

describe("validateWebAppUrl", () => {
  it("accepts a clean https url", () => {
    expect(validateWebAppUrl("WEBAPP_URL", "https://sabacos-web.onrender.com")).toEqual([]);
  });

  it("flags http and localhost", () => {
    expect(validateWebAppUrl("WEBAPP_URL", "http://example.com").length).toBeGreaterThan(0);
    expect(validateWebAppUrl("WEBAPP_URL", "http://localhost:5174").length).toBeGreaterThan(0);
  });

  it("flags empty and malformed values", () => {
    expect(validateWebAppUrl("WEBAPP_URL", "").length).toBeGreaterThan(0);
    expect(validateWebAppUrl("WEBAPP_URL", "not a url").length).toBeGreaterThan(0);
  });
});

describe("webAppPointsAtApi", () => {
  it("detects mini-app host equal to the api host", () => {
    expect(
      webAppPointsAtApi("https://sabacos-server.onrender.com", "https://sabacos-server.onrender.com"),
    ).toBe(true);
    expect(
      webAppPointsAtApi("https://sabacos-web.onrender.com/", "https://sabacos-server.onrender.com"),
    ).toBe(false);
    expect(webAppPointsAtApi("", "https://x.com")).toBe(false);
  });
});
