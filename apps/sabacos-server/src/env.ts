import { z } from "zod";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8788),
  BOT_TOKEN: z.string().trim().min(1, "BOT_TOKEN is required"),
  CHAPA_PROVIDER_TOKEN: z.string().trim().min(1, "CHAPA_PROVIDER_TOKEN is required (from BotFather)"),
  SUPABASE_URL: z.string().trim().url("SUPABASE_URL is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_ANON_KEY: z.string().trim().min(1, "SUPABASE_ANON_KEY is required (for admin auth validation)"),
  WEBAPP_URL: z.string().trim().url("WEBAPP_URL is required (the Telegram Mini App URL)"),
  ADMIN_DASHBOARD_URL: z.string().trim().url("ADMIN_DASHBOARD_URL is required"),
  WEBHOOK_URL: z.string().trim().url().optional(),
  WEBHOOK_SECRET: z.string().trim().optional(),
  ADMIN_CHANNEL_ID: z.string().trim().optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().trim().optional(),
  CLOUDFLARE_API_TOKEN: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().optional(),
  R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
  R2_BUCKET: z.string().trim().optional(),
  R2_PUBLIC_BASE: z.string().trim().url().optional(),
  MARKETING_SWEEP: z.enum(["on", "off"]).default("on"),
});

// In production, WEBHOOK_SECRET is required to prevent forged updates.
const envSchema = baseSchema.refine(
  (v) => v.NODE_ENV !== "production" || v.WEBHOOK_SECRET,
  { message: "WEBHOOK_SECRET is required in production", path: ["WEBHOOK_SECRET"] },
);

export type AppEnv = z.infer<typeof envSchema>;

let loadedEnv: AppEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  loadedEnv = envSchema.parse(source);
  return loadedEnv;
}

export function getAppEnv(): AppEnv {
  if (!loadedEnv) {
    throw new Error("Env not initialized: call loadEnv() at startup before handling requests");
  }
  return loadedEnv;
}

export function envToPublic(env: AppEnv): Pick<AppEnv, "WEBAPP_URL" | "ADMIN_DASHBOARD_URL"> {
  return { WEBAPP_URL: env.WEBAPP_URL, ADMIN_DASHBOARD_URL: env.ADMIN_DASHBOARD_URL };
}