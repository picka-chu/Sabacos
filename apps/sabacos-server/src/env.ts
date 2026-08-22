import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8788),
  BOT_TOKEN: z.string().trim().min(1, "BOT_TOKEN is required"),
  CHAPA_PROVIDER_TOKEN: z.string().trim().min(1, "CHAPA_PROVIDER_TOKEN is required (from BotFather)"),
  CHAPA_SECRET_KEY: z.string().trim().optional(),
  CHAPA_BASE_URL: z.string().trim().url().optional(),
  SUPABASE_URL: z.string().trim().url("SUPABASE_URL is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  WEBAPP_URL: z.string().trim().url("WEBAPP_URL is required (the Telegram Mini App URL)"),
  ADMIN_DASHBOARD_URL: z.string().trim().url("ADMIN_DASHBOARD_URL is required"),
  WEBHOOK_URL: z.string().trim().url().optional(),
  WEBHOOK_SECRET: z.string().trim().optional(),
  ADMIN_CHANNEL_ID: z.string().trim().optional(),
});

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