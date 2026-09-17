import type { MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";
import type { Db } from "./db/client.js";

export interface RateLimitOpts {
  windowMs: number;
  limit: number;
  keyGenerator?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

/**
 * Shared fixed-window rate limiter backed by Supabase/Postgres.
 * Returns 429 with Retry-After header when the limit is exceeded.
 */
export function rateLimit(db: Db, opts: RateLimitOpts): MiddlewareHandler {
  const { windowMs, limit, keyGenerator } = opts;

  return async (c, next) => {
    const rawKey = keyGenerator ? keyGenerator(c) : "global";
    // Store only a SHA-256 digest: the shared limiter must not retain IP
    // addresses or Telegram identifiers as application data.
    const key = createHash("sha256").update(rawKey).digest("hex");
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_key: key,
      p_window_seconds: Math.ceil(windowMs / 1000),
      p_limit: limit,
    }).single();
    if (error || !data) {
      // Fail closed. Rate limiting protects expensive auth and checkout paths;
      // allowing traffic when its shared backing store is unavailable would
      // reintroduce an easy abuse path.
      throw new Error(`Shared rate limit unavailable: ${error?.message ?? "empty response"}`);
    }

    const result = data as { allowed: boolean; remaining: number; reset_at: string };
    const resetAt = new Date(result.reset_at).getTime();
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      c.header("X-RateLimit-Limit", String(limit));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
      return c.json(
        { error: { code: "rate_limited", message: `Too many requests. Retry after ${retryAfter}s` } },
        429,
      );
    }
    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    await next();
  };
}
