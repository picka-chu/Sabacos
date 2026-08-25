import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "../env.js";

export type Db = SupabaseClient;

let client: Db | null = null;
let authClient: Db | null = null;

export function getDb(env?: AppEnv): Db {
  if (client) return client;
  if (!env) throw new Error("getDb called without env before initialization");
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * Supabase client initialized with the anon key, used exclusively for
 * auth operations (getUser, signIn, etc.).  The service-role key bypasses
 * RLS but the auth server rejects it for user token validation.
 */
export function getAuthDb(env?: AppEnv): Db {
  if (authClient) return authClient;
  if (!env) throw new Error("getAuthDb called without env before initialization");
  authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return authClient;
}

export function resetDb(): void {
  client = null;
  authClient = null;
}

export function adminClientForToken(env: AppEnv, token: string): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}