import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  packSharePayload,
  parseSharePayload,
  SHARE_ATTRIBUTION_WINDOW_DAYS,
  resolveShareAttribution,
} from "../src/db/referrals.js";

const { getProfileByTelegramIdMock } = vi.hoisted(() => ({
  getProfileByTelegramIdMock: vi.fn(),
}));

vi.mock("../src/db/profiles.js", () => ({
  getProfileByTelegramId: getProfileByTelegramIdMock,
}));

const db = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("share payload packing", () => {
  it("round-trips through parse", () => {
    const productId = "22ef77c0-fdcf-44dd-b15b-2c4dbfde3a2e";
    const packed = packSharePayload(8260464827, productId);
    expect(packed.length).toBeLessThanOrEqual(64);
    expect(parseSharePayload(packed)).toEqual({
      sharerTelegramId: 8260464827,
      productId,
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseSharePayload("product_abc")).toBeNull();
    expect(parseSharePayload("s123_zzz")).toBeNull();
    expect(parseSharePayload("")).toBeNull();
    expect(parseSharePayload("s8260464827_22ef77c0fdcf44ddb15b2c4dbfde3a2eEXTRA")).toBeNull();
  });

  it("pins the attribution window", () => {
    expect(SHARE_ATTRIBUTION_WINDOW_DAYS).toBe(7);
  });
});

describe("resolveShareAttribution", () => {
  it("resolves a fresh click from another user", async () => {
    getProfileByTelegramIdMock.mockResolvedValue({ id: "sharer-id" });
    const result = await resolveShareAttribution(db, "buyer-id", {
      sharerTelegramId: 111,
      clickedAt: new Date().toISOString(),
    });
    expect(result).toBe("sharer-id");
  });

  it("rejects self-attribution", async () => {
    getProfileByTelegramIdMock.mockResolvedValue({ id: "buyer-id" });
    const result = await resolveShareAttribution(db, "buyer-id", {
      sharerTelegramId: 111,
      clickedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("rejects stale and future clicks", async () => {
    getProfileByTelegramIdMock.mockResolvedValue({ id: "sharer-id" });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(await resolveShareAttribution(db, "buyer-id", { sharerTelegramId: 111, clickedAt: old })).toBeNull();
    const future = new Date(Date.now() + 600_000).toISOString();
    expect(
      await resolveShareAttribution(db, "buyer-id", { sharerTelegramId: 111, clickedAt: future }),
    ).toBeNull();
    expect(getProfileByTelegramIdMock).not.toHaveBeenCalled();
  });

  it("returns null when the sharer profile is gone", async () => {
    getProfileByTelegramIdMock.mockResolvedValue(null);
    const result = await resolveShareAttribution(db, "buyer-id", {
      sharerTelegramId: 999,
      clickedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });
});
