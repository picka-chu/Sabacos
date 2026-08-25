import type { MiddlewareHandler } from "hono";

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// Evict stale entries every 5 minutes to prevent memory leaks.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 300_000).unref();

export interface RateLimitOpts {
  windowMs: number;
  limit: number;
  keyGenerator?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

/**
 * Simple in-memory sliding-window rate limiter.
 * Returns 429 with Retry-After header when the limit is exceeded.
 */
export function rateLimit(opts: RateLimitOpts): MiddlewareHandler {
  const { windowMs, limit, keyGenerator } = opts;

  return async (c, next) => {
    const rawKey = keyGenerator ? keyGenerator(c) : (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "global");
    const now = Date.now();
    const resetAt = now + windowMs;
    const entry = store.get(rawKey);

    if (entry && entry.resetAt > now) {
      if (entry.count >= limit) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        c.header("X-RateLimit-Limit", String(limit));
        c.header("X-RateLimit-Remaining", "0");
        c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
        return c.json(
          { error: { code: "rate_limited", message: `Too many requests. Retry after ${retryAfter}s` } },
          429,
        );
      }
      entry.count += 1;
    } else {
      store.set(rawKey, { count: 1, resetAt });
    }

    await next();
  };
}
