import { describe, expect, it } from "vitest";
import { isQuietHours, jobDue } from "../src/services/marketing-agent.js";

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
