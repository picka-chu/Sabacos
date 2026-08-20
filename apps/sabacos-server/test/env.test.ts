import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.js";

const base = {
  BOT_TOKEN: "123:abc",
  CHAPA_PROVIDER_TOKEN: "provider:token",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  WEBAPP_URL: "https://shop.sabacos.et",
  ADMIN_DASHBOARD_URL: "https://admin.sabacos.et",
};

describe("loadEnv", () => {
  it("loads a complete environment", () => {
    const env = loadEnv({ ...base, PORT: "9000" });
    expect(env.PORT).toBe(9000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.WEBAPP_URL).toBe(base.WEBAPP_URL);
  });

  it("throws when required vars are missing", () => {
    expect(() => loadEnv({})).toThrow();
    expect(() => loadEnv({ ...base, BOT_TOKEN: "" })).toThrow();
    expect(() => loadEnv({ ...base, SUPABASE_URL: "not-a-url" })).toThrow();
  });
});