import { getDb } from "../db/client.js";
import type { AppEnv } from "../env.js";
import { log } from "../log.js";

let nightlyTimer: ReturnType<typeof setInterval> | null = null;
let weeklyTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the adaptive reward engine cron jobs.
 * - Nightly aggregation: runs every 24h at 02:00 UTC
 * - Weekly adjustment: runs every Monday at 00:00 UTC
 * - Data retention cleanup: runs weekly on Sunday
 */
export function startAdaptiveCron(env: AppEnv): void {
  const MS_HOUR = 60 * 60 * 1000;
  const MS_DAY = 24 * MS_HOUR;

  // Calculate ms until next 02:00 UTC for nightly aggregation
  const now = new Date();
  const next2AM = new Date(now);
  next2AM.setUTCHours(2, 0, 0, 0);
  if (next2AM <= now) next2AM.setTime(next2AM.getTime() + MS_DAY);
  const msUntilNightly = next2AM.getTime() - now.getTime();

  // Calculate ms until next Monday 00:00 UTC for weekly adjustment
  const nextMonday = new Date(now);
  const dayOfWeek = nextMonday.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7 || 7;
  nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(0, 0, 0, 0);
  if (nextMonday <= now) nextMonday.setTime(nextMonday.getTime() + 7 * MS_DAY);
  const msUntilWeekly = nextMonday.getTime() - now.getTime();

  log.info(`Adaptive cron: nightly aggregation in ${(msUntilNightly / MS_HOUR).toFixed(1)}h, weekly adjustment in ${(msUntilWeekly / MS_DAY).toFixed(1)}d`);

  // Nightly aggregation
  setTimeout(() => {
    runNightlyJob(env);
    nightlyTimer = setInterval(() => runNightlyJob(env), MS_DAY);
  }, msUntilNightly);

  // Weekly adjustment
  setTimeout(() => {
    runWeeklyJob(env);
    weeklyTimer = setInterval(() => runWeeklyJob(env), 7 * MS_DAY);
  }, msUntilWeekly);
}

export function stopAdaptiveCron(): void {
  if (nightlyTimer) clearInterval(nightlyTimer);
  if (weeklyTimer) clearInterval(weeklyTimer);
  nightlyTimer = null;
  weeklyTimer = null;
}

async function runNightlyJob(env: AppEnv): Promise<void> {
  try {
    const db = getDb(env);
    const { runNightlyAggregation } = await import("../db/adaptive.js");
    const result = await runNightlyAggregation(db);
    log.info(`Nightly aggregation: ${JSON.stringify(result)}`);

    // Also run data retention cleanup once a week (on Sundays)
    if (new Date().getUTCDay() === 0) {
      const { data: cleanupResult } = await db.rpc("cleanup_old_metrics");
      log.info(`Data retention cleanup: ${JSON.stringify(cleanupResult)}`);
    }
  } catch (err) {
    log.error(`Nightly aggregation failed: ${err}`);
  }
}

async function runWeeklyJob(env: AppEnv): Promise<void> {
  try {
    const db = getDb(env);
    const { runWeeklyAdjustment } = await import("../db/adaptive.js");
    const result = await runWeeklyAdjustment(db);
    log.info(`Weekly adjustment: ${JSON.stringify(result)}`);

    // Notify admin channel if flagged
    if (result.flagged) {
      const { notifyAdminChannel } = await import("../bot/bot.js");
      await notifyAdminChannel(
        env,
        `⚠️ <b>Adaptive Engine Alert</b>\n\n${result.reason}\n\nSpend ratio: ${(result.spend_ratio as number * 100).toFixed(1)}%\nCommission: ${result.old_commission}% → ${result.new_commission}%\nSpin cap: ${result.old_spin_cap} → ${result.new_spin_cap}`,
      );
    }
  } catch (err) {
    log.error(`Weekly adjustment failed: ${err}`);
  }
}

/** Manually trigger nightly aggregation (for admin endpoint). */
export async function triggerNightly(env: AppEnv): Promise<Record<string, unknown>> {
  const db = getDb(env);
  const { runNightlyAggregation } = await import("../db/adaptive.js");
  return await runNightlyAggregation(db);
}

/** Manually trigger weekly adjustment (for admin endpoint). */
export async function triggerWeekly(env: AppEnv): Promise<Record<string, unknown>> {
  const db = getDb(env);
  const { runWeeklyAdjustment } = await import("../db/adaptive.js");
  return await runWeeklyAdjustment(db);
}
