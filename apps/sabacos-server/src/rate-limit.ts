import type { MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";
import type { Db } from "./db/client.js";

export interface RateLimitOpts {
  windowMs: number;
  limit: number;
  keyGenerator?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface MemoryResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function memoryBucket(
  buckets: Map<string, { resetAt: number; count: number }>,
  key: string,
  now: number,
  windowMs: number,
  limit: number,
): MemoryResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { resetAt: now + windowMs, count: 1 };
    buckets.set(key, bucket);
  } else if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  } else {
    bucket.count += 1;
  }
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

function applyResult(c: Parameters<MiddlewareHandler>[0], limit: number, result: { resetAt: number; remaining: number }, allowed: boolean) {
  if (!allowed) {
    const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    c.header("Retry-After", String(retryAfter));
    c.header("X-RateLimit-Remaining", "0");
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
    return c.json(
      { error: { code: "rate_limited", message: `Too many requests. Retry after ${retryAfter}s` } },
      429,
    );
  }
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  return undefined;
}

/**
 * Shared fixed-window rate limiter backed by Supabase/Postgres.
 * Falls back to a per-instance in-memory limiter when the shared RPC is
 * unavailable (e.g. the rate-limit SQL function has not been migrated yet).
 * Returns 429 with Retry-After header when the limit is exceeded.
 */
export function rateLimit(db: Db, opts: RateLimitOpts): MiddlewareHandler {
  const { windowMs, limit, keyGenerator } = opts;
  const memory = new Map<string, { resetAt: number; count: number }>();
  let lastWarnAt = 0;

  return async (c, next) => {
    const rawKey = keyGenerator ? keyGenerator(c) : "global";
    // Store only a SHA-256 digest: the shared limiter must not retain IP
    // addresses or Telegram identifiers as application data.
    const key = createHash("sha256").update(rawKey).digest("hex");

    const now = Date.now();
    const { data, error } = await db.rpc("consume_rate_limit", {
      p_key: key,
      p_window_seconds: Math.ceil(windowMs / 1000),
      p_limit: limit,
    }).single();
    if (error || !data) {
      const nowMs = Date.now();
      if (nowMs - lastWarnAt > 60_000) {
        lastWarnAt = nowMs;
        console.error(
          `Shared rate limit unavailable (${error?.message ?? "empty response"}) — falling back to in-process rate limiting. ` +
            "Apply supabase/migrations/0017 and 0018 to enable cross-instance limiting.",
        );
      }
      const result = memoryBucket(memory, rawKey, now, windowMs, limit);
      const blocked = applyResult(c, limit, result, result.allowed);
      if (blocked) return blocked;
      await next();
      return;
    }

    const result = data as { allowed: boolean; remaining: number; reset_at: string };
    const resetAt = new Date(result.reset_at).getTime();
    c.header("X-RateLimit-Limit", String(limit));
    const blocked = applyResult(c, limit, { resetAt, remaining: result.remaining }, result.allowed);
    if (blocked) return blocked;

    await next();
  };
}
