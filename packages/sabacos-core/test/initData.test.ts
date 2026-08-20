import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateInitData, verifyInitDataHash, parseInitData } from "../src/index.js";

const BOT_TOKEN = "123456:TESTTOKENSTRING";

function buildInitData(opts: { authDate?: number } = {}): string {
  const authDate = opts.authDate ?? Math.floor(Date.now() / 1000);
  const user = {
    id: 987654321,
    first_name: "Selam",
    last_name: "Tadesse",
    username: "selam_t",
  };

  const pairs: Record<string, string> = {
    auth_date: String(authDate),
    query_id: "AAHd3SAAAAA",
    user: JSON.stringify(user),
  };

  const dataCheckString = Object.keys(pairs)
    .sort()
    .map((k) => `${k}=${pairs[k]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return new URLSearchParams({ ...pairs, hash }).toString();
}

describe("initData validation", () => {
  it("verifies a genuine initData payload", async () => {
    const initData = buildInitData();
    expect(await verifyInitDataHash(initData, BOT_TOKEN)).toBe(true);
    const result = await validateInitData(initData, BOT_TOKEN);
    expect(result.valid).toBe(true);
    expect(result.payload?.userId).toBe(987654321);
    expect(result.payload?.username).toBe("selam_t");
  });

  it("rejects tampered payloads", async () => {
    const initData = buildInitData();
    const url = new URLSearchParams(initData);
    const tamperedUser = JSON.stringify({ id: 1, first_name: "Hacker" });
    url.set("user", tamperedUser);
    const tampered = url.toString();

    expect(await verifyInitDataHash(tampered, BOT_TOKEN)).toBe(false);
    expect((await validateInitData(tampered, BOT_TOKEN)).valid).toBe(false);
  });

  it("rejects wrong bot token", async () => {
    const initData = buildInitData();
    expect(await verifyInitDataHash(initData, "other:token")).toBe(false);
  });

  it("rejects missing hash", async () => {
    const initData = new URLSearchParams({ auth_date: "1" }).toString();
    expect(await verifyInitDataHash(initData, BOT_TOKEN)).toBe(false);
  });

  it("rejects stale payloads", async () => {
    const initData = buildInitData({ authDate: Math.floor(Date.now() / 1000) - 60 * 60 * 25 });
    expect((await validateInitData(initData, BOT_TOKEN)).valid).toBe(false);
  });

  it("rejects malformed payloads", async () => {
    expect(parseInitData("garbage")).toBeNull();
    expect((await validateInitData("garbage", BOT_TOKEN)).valid).toBe(false);
  });
});