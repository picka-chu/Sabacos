import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8788),
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  CHAPA_PROVIDER_TOKEN: z.string().min(1, "CHAPA_PROVIDER_TOKEN is required (from BotFather)"),
  SUPABASE_URL: z.string().url("SUPABASE_URL is required"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  WEBAPP_URL: z.string().url("WEBAPP_URL is required (the Telegram Mini App URL)"),
  ADMIN_DASHBOARD_URL: z.string().url("ADMIN_DASHBOARD_URL is required"),
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  ADMIN_CHANNEL_ID: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function envToPublic(env: AppEnv): Pick<AppEnv, "WEBAPP_URL" | "ADMIN_DASHBOARD_URL"> {
  return { WEBAPP_URL: env.WEBAPP_URL, ADMIN_DASHBOARD_URL: env.ADMIN_DASHBOARD_URL };
}