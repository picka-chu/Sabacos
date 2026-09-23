import { getDb } from "../db/client.js";
import type { AppEnv } from "../env.js";
import { log } from "../log.js";

let nightlyTimer: ReturnType<typeof setInterval> | null = null;
let weeklyTimer: ReturnType<typeof setInterval> | null = null;
let payoutDailyTimer: ReturnType<typeof setInterval> | null = null;
let payoutDailyTimeout: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileTimeout: ReturnType<typeof setTimeout> | null = null;

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

  // Weekly referral payouts: once daily (each referrer is paid on the weekday
  // their account was created, so one daily pass covers whoever is due).
  // 09:00 UTC = 12:00 EAT, inside Chapa's Mon–Sat transfer hours; a Sunday
  // pass will fail at Chapa and surface via the failed-payout admin flow.
  const next9AM = new Date(now);
  next9AM.setUTCHours(9, 0, 0, 0);
  if (next9AM <= now) next9AM.setTime(next9AM.getTime() + MS_DAY);
  const msUntilPayout = next9AM.getTime() - now.getTime();
  log.info(`Payout cron: daily payout pass in ${(msUntilPayout / MS_HOUR).toFixed(1)}h`);
  payoutDailyTimeout = setTimeout(() => {
    void runPayoutJob(env);
    payoutDailyTimer = setInterval(() => void runPayoutJob(env), MS_DAY);
  }, msUntilPayout);

  // Payout reconcile: hourly verify of 'processing' payouts.
  let reconcileRunning = false;
  const reconcileTick = async () => {
    if (reconcileRunning) return;
    reconcileRunning = true;
    try {
      const db = getDb(env);
      const { reconcileProcessingPayouts } = await import("../db/referral-rewards.js");
      const out = await reconcileProcessingPayouts(db, env);
      if (out.checked > 0) log.info(`Payout reconcile: ${JSON.stringify(out)}`);
    } catch (err) {
      log.error(`Payout reconcile failed: ${err}`);
    } finally {
      reconcileRunning = false;
    }
  };
  reconcileTimeout = setTimeout(() => {
    void reconcileTick();
    reconcileTimer = setInterval(() => void reconcileTick(), MS_HOUR);
  }, 5 * 60 * 1000);
}

export function stopAdaptiveCron(): void {
  if (nightlyTimer) clearInterval(nightlyTimer);
  if (weeklyTimer) clearInterval(weeklyTimer);
  if (payoutDailyTimer) clearInterval(payoutDailyTimer);
  if (payoutDailyTimeout) clearTimeout(payoutDailyTimeout);
  if (reconcileTimer) clearInterval(reconcileTimer);
  if (reconcileTimeout) clearTimeout(reconcileTimeout);
  nightlyTimer = null;
  weeklyTimer = null;
  payoutDailyTimer = null;
  payoutDailyTimeout = null;
  reconcileTimer = null;
  reconcileTimeout = null;
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

/** Daily referral payout pass (also triggerable from the admin API). */
let payoutRunning = false;
async function runPayoutJob(env: AppEnv): Promise<void> {
  // Overlap guard: two concurrent passes could both clear the weekly
  // no-duplicate check and pay the same referrer twice.
  if (payoutRunning) {
    log.info("Payout pass already running — skipping overlapping tick");
    return;
  }
  payoutRunning = true;
  try {
    const db = getDb(env);
    const { runWeeklyPayouts } = await import("../db/referral-rewards.js");
    const result = await runWeeklyPayouts(db, env);
    log.info(`Weekly payouts: ${JSON.stringify(result)}`);
  } catch (err) {
    log.error(`Weekly payouts failed: ${err}`);
  } finally {
    payoutRunning = false;
  }
}

/** Manually trigger the payout pass (for admin endpoint). */
export async function triggerPayouts(env: AppEnv): Promise<Record<string, unknown>> {
  const db = getDb(env);
  const { runWeeklyPayouts } = await import("../db/referral-rewards.js");
  return (await runWeeklyPayouts(db, env)) as unknown as Record<string, unknown>;
}

/** Manually trigger weekly adjustment (for admin endpoint). */
export async function triggerWeekly(env: AppEnv): Promise<Record<string, unknown>> {
  const db = getDb(env);
  const { runWeeklyAdjustment } = await import("../db/adaptive.js");
  return await runWeeklyAdjustment(db);
}
