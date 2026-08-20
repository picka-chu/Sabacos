import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "../env.js";

export type Db = SupabaseClient;

let client: Db | null = null;

export function getDb(env?: AppEnv): Db {
  if (client) return client;
  if (!env) throw new Error("getDb called without env before initialization");
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export function resetDb(): void {
  client = null;
}

export function adminClientForToken(env: AppEnv, token: string): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}