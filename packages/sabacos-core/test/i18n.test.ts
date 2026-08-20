import { describe, expect, it } from "vitest";
import {
  t,
  translateStatus,
  translatePaymentStatus,
  normalizeLanguage,
  getDictionary,
  type I18nKey,
} from "../src/index.js";

describe("i18n", () => {
  it("has identical key sets for en and am", () => {
    const en = getDictionary("en");
    const am = getDictionary("am");
    expect(Object.keys(en).sort()).toEqual(Object.keys(am).sort());
  });

  it("every key resolves to non-empty text in both languages", () => {
    for (const key of Object.keys(getDictionary("en")) as I18nKey[]) {
      expect(t("en", key).length).toBeGreaterThan(0);
      expect(t("am", key).length).toBeGreaterThan(0);
    }
  });

  it("interpolates parameters", () => {
    expect(t("en", "addedToCartHint", { count: 3 })).toBe("3 item(s) added");
    expect(t("en", "inStockCount", { count: 7 })).toBe("7 in stock");
    expect(t("am", "freeDeliveryHint", { amount: "1,500.00" })).toContain("ነጻ መላኪያ");
  });

  it("falls back to english for unknown language", () => {
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage("am")).toBe("am");
    expect(normalizeLanguage("am-ET")).toBe("am");
    expect(normalizeLanguage(null)).toBe("en");
  });

  it("translates statuses", () => {
    expect(translateStatus("en", "processing")).toBe("Processing");
    expect(translateStatus("am", "delivered")).toBe("ተደርሷል");
    expect(translatePaymentStatus("en", "success")).toBe("Paid");
    expect(translatePaymentStatus("en", "unknown_thing")).toBe("unknown_thing");
  });
});