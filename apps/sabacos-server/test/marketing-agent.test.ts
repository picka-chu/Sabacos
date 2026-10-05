import { describe, expect, it } from "vitest";
import { cleanCopy, isQuietHours, jobDue } from "../src/services/marketing-agent.js";

describe("isQuietHours (Africa/Addis_Ababa, 21:00-08:00)", () => {
  it("is quiet late at night Addis time", () => {
    // 19:00 UTC = 22:00 Addis
    expect(isQuietHours(new Date("2026-06-01T19:00:00Z"))).toBe(true);
  });

  it("is quiet before 08:00 Addis time", () => {
    // 04:30 UTC = 07:30 Addis
    expect(isQuietHours(new Date("2026-06-01T04:30:00Z"))).toBe(true);
  });

  it("sends during the day", () => {
    // 10:00 UTC = 13:00 Addis
    expect(isQuietHours(new Date("2026-06-01T10:00:00Z"))).toBe(false);
  });

  it("releases exactly at 08:00", () => {
    // 05:00 UTC = 08:00 Addis
    expect(isQuietHours(new Date("2026-06-01T05:00:00Z"))).toBe(false);
  });
});

describe("cleanCopy", () => {
  it("passes good copy through untouched", () => {
    const text = "Back in stock: Glow Serum for 1500 ETB. Grab yours before it sells out again.";
    expect(cleanCopy(text)).toBe(text);
  });

  it("repairs mid-sentence truncation to the last full sentence", () => {
    expect(cleanCopy("New arrival today. This amazing serum will transform your")).toBe(
      "New arrival today.",
    );
  });

  it("rejects fragments with no finished sentence", () => {
    expect(cleanCopy("brand new amazing glow serum deal")).toBeNull();
    expect(cleanCopy("hi")).toBeNull();
    expect(cleanCopy("")).toBeNull();
    expect(cleanCopy(null)).toBeNull();
  });

  it("strips markdown dressing and wrapping quotes", () => {
    expect(cleanCopy('"**Glow Serum** is back in stock today."')).toBe(
      "Glow Serum is back in stock today.",
    );
    expect(cleanCopy("# Sale\n50% off serums this week only.")).toBe(
      "Sale\n50% off serums this week only.",
    );
  });

  it("rejects option dumps, subjects, links and placeholders", () => {
    expect(cleanCopy("Option 1: Buy the serum today for glowing skin.")).toBeNull();
    expect(cleanCopy("Subject: weekend sale now live at our shop.")).toBeNull();
    expect(cleanCopy("Shop now at https://example.com for great deals.")).toBeNull();
    expect(cleanCopy("Hi [name], your serum is waiting for you today.")).toBeNull();
  });

  it("accepts a complete thought closed with emoji", () => {
    expect(cleanCopy("Your cart is waiting for you 🛒")).toBe("Your cart is waiting for you 🛒");
  });

  it("caps long text at a word boundary", () => {
    const long = `${"Great serum for daily glow. ".repeat(20)}tail`;
    const out = cleanCopy(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(300);
    expect(out).toMatch(/[.!?…]$/);
  });
});

describe("jobDue", () => {
  const HOUR = 3_600_000;
  const now = Date.parse("2026-06-01T12:00:00Z");

  it("runs when never run before", () => {
    expect(jobDue(null, 24 * HOUR, now)).toBe(true);
  });

  it("waits for the interval", () => {
    expect(jobDue(new Date(now - 23 * HOUR).toISOString(), 24 * HOUR, now)).toBe(false);
  });

  it("runs once the interval elapsed", () => {
    expect(jobDue(new Date(now - 25 * HOUR).toISOString(), 24 * HOUR, now)).toBe(true);
  });

  it("treats a corrupt cursor as due", () => {
    expect(jobDue("not-a-date", 24 * HOUR, now)).toBe(true);
  });
});
