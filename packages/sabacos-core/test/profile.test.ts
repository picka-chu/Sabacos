import { describe, expect, it } from "vitest";
import { profileRowSchema } from "../src/index.js";

const baseRow = {
  id: "11111111-1111-4111-8111-111111111111",
  telegram_id: 8260464827,
  username: "testuser",
  first_name: "Test",
  last_name: "User",
  phone: null,
  address: null,
  photo_url: null,
  language: "en",
  terms_accepted_at: null,
  terms_version: null,
  role: "customer",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("profileRowSchema suspension fields", () => {
  it("defaults to not suspended for rows without the new columns", () => {
    const result = profileRowSchema.safeParse(baseRow);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isSuspended).toBe(false);
    expect(result.data.suspendedReason).toBeNull();
    expect(result.data.suspendedAt).toBeNull();
  });

  it("parses a suspended profile with reason", () => {
    const result = profileRowSchema.safeParse({
      ...baseRow,
      is_suspended: true,
      suspended_reason: "spam",
      suspended_at: "2026-02-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isSuspended).toBe(true);
    expect(result.data.suspendedReason).toBe("spam");
  });
});
