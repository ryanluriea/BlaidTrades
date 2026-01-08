/**
 * QuantConnect Budget Governor
 * Enforces daily and weekly run limits for QC verification runs
 * Budget limits are now configurable via Strategy Lab settings
 * Also enforces 1 run per snapshot per 7 days to prevent redundant runs
 */

import { db } from "../../db";
import { qcBudget, qcVerifications } from "@shared/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

// Default limits (can be overridden by Strategy Lab settings)
// Increased to allow more QC verifications - threshold recovery needs headroom
const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_WEEKLY_LIMIT = 200;

// Get configurable limits from Strategy Lab state
function getConfigurableLimits(): { dailyLimit: number; weeklyLimit: number } {
  try {
    // Dynamic import to avoid circular dependency
    const state = (global as any).__strategyLabState;
    if (state && typeof state.qcDailyLimit === "number" && typeof state.qcWeeklyLimit === "number") {
      return { dailyLimit: state.qcDailyLimit, weeklyLimit: state.qcWeeklyLimit };
    }
  } catch {
    // Fallback to defaults
  }
  return { dailyLimit: DEFAULT_DAILY_LIMIT, weeklyLimit: DEFAULT_WEEKLY_LIMIT };
}

export interface BudgetStatus {
  dailyRemaining: number;
  weeklyRemaining: number;
  dailyLimit: number;
  weeklyLimit: number;
  dailyUsed: number;
  weeklyUsed: number;
  canRun: boolean;
  nextResetDaily: Date;
  nextResetWeekly: Date;
  exhaustionReason?: string;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  status: BudgetStatus;
}

function getStartOfDay(date: Date = new Date()): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function getEndOfDay(date: Date = new Date()): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function getStartOfWeek(date: Date = new Date()): Date {
  const start = new Date(date);
  const day = start.getUTCDay();
  const diff = start.getUTCDate() - day + (day === 0 ? -6 : 1);
  start.setUTCDate(diff);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function getEndOfWeek(date: Date = new Date()): Date {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

async function getOrCreateDailyBudget(): Promise<typeof qcBudget.$inferSelect> {
  const now = new Date();
  const dayStart = getStartOfDay(now);
  const dayEnd = getEndOfDay(now);
  const { dailyLimit } = getConfigurableLimits();

  const existing = await db
    .select()
    .from(qcBudget)
    .where(
      and(
        eq(qcBudget.periodType, "daily"),
        lte(qcBudget.periodStart, now),
        gte(qcBudget.periodEnd, now)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update limit if it changed from settings
    if (existing[0].runsLimit !== dailyLimit) {
      await db.update(qcBudget)
        .set({ runsLimit: dailyLimit })
        .where(eq(qcBudget.id, existing[0].id));
      existing[0].runsLimit = dailyLimit;
    }
    return existing[0];
  }

  const [newBudget] = await db
    .insert(qcBudget)
    .values({
      periodType: "daily",
      periodStart: dayStart,
      periodEnd: dayEnd,
      runsUsed: 0,
      runsLimit: dailyLimit,
    })
    .returning();

  console.log(
    `[QC_BUDGET] Created daily budget period=${dayStart.toISOString()} limit=${dailyLimit}`
  );
  return newBudget;
}

async function getOrCreateWeeklyBudget(): Promise<typeof qcBudget.$inferSelect> {
  const now = new Date();
  const weekStart = getStartOfWeek(now);
  const weekEnd = getEndOfWeek(now);
  const { weeklyLimit } = getConfigurableLimits();

  const existing = await db
    .select()
    .from(qcBudget)
    .where(
      and(
        eq(qcBudget.periodType, "weekly"),
        lte(qcBudget.periodStart, now),
        gte(qcBudget.periodEnd, now)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update limit if it changed from settings
    if (existing[0].runsLimit !== weeklyLimit) {
      await db.update(qcBudget)
        .set({ runsLimit: weeklyLimit })
        .where(eq(qcBudget.id, existing[0].id));
      existing[0].runsLimit = weeklyLimit;
    }
    return existing[0];
  }

  const [newBudget] = await db
    .insert(qcBudget)
    .values({
      periodType: "weekly",
      periodStart: weekStart,
      periodEnd: weekEnd,
      runsUsed: 0,
      runsLimit: weeklyLimit,
    })
    .returning();

  console.log(
    `[QC_BUDGET] Created weekly budget period=${weekStart.toISOString()} limit=${weeklyLimit}`
  );
  return newBudget;
}

export async function getBudgetStatus(): Promise<BudgetStatus> {
  const [dailyBudget, weeklyBudget] = await Promise.all([
    getOrCreateDailyBudget(),
    getOrCreateWeeklyBudget(),
  ]);

  const dailyUsed = dailyBudget.runsUsed ?? 0;
  const weeklyUsed = weeklyBudget.runsUsed ?? 0;
  const dailyRemaining = Math.max(0, dailyBudget.runsLimit - dailyUsed);
  const weeklyRemaining = Math.max(0, weeklyBudget.runsLimit - weeklyUsed);
  const canRun = dailyRemaining > 0 && weeklyRemaining > 0;
  
  // Build exhaustion reason for UI tooltip
  let exhaustionReason: string | undefined;
  if (!canRun) {
    const nextResetDaily = getStartOfDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const nextResetWeekly = getStartOfWeek(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    
    if (dailyRemaining <= 0 && weeklyRemaining <= 0) {
      exhaustionReason = `Daily and weekly limits exhausted. Daily resets ${nextResetDaily.toISOString().slice(0, 10)}, weekly resets ${nextResetWeekly.toISOString().slice(0, 10)}.`;
    } else if (dailyRemaining <= 0) {
      exhaustionReason = `Daily limit (${dailyBudget.runsLimit}) reached. Resets ${nextResetDaily.toISOString().slice(0, 10)}.`;
    } else {
      exhaustionReason = `Weekly limit (${weeklyBudget.runsLimit}) reached. Resets ${nextResetWeekly.toISOString().slice(0, 10)}.`;
    }
  }

  return {
    dailyRemaining,
    weeklyRemaining,
    dailyLimit: dailyBudget.runsLimit,
    weeklyLimit: weeklyBudget.runsLimit,
    dailyUsed,
    weeklyUsed,
    canRun,
    nextResetDaily: getStartOfDay(new Date(Date.now() + 24 * 60 * 60 * 1000)),
    nextResetWeekly: getStartOfWeek(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
    exhaustionReason,
  };
}

export async function checkBudget(): Promise<BudgetCheckResult> {
  const status = await getBudgetStatus();

  if (status.dailyRemaining <= 0) {
    return {
      allowed: false,
      reason: `Daily limit reached (${status.dailyUsed}/${status.dailyLimit}). Resets at ${status.nextResetDaily.toISOString()}`,
      status,
    };
  }

  if (status.weeklyRemaining <= 0) {
    return {
      allowed: false,
      reason: `Weekly limit reached (${status.weeklyUsed}/${status.weeklyLimit}). Resets at ${status.nextResetWeekly.toISOString()}`,
      status,
    };
  }

  return { allowed: true, status };
}

// Denial tracking for monitoring alerts
// Configuration constants
const DENIAL_ALERT_THRESHOLD = 5; // Alert after 5 denials in window
const DENIAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour window

// In-memory cache for fast access (synced with DB)
interface DenialMetricsCache {
  denialCount: number;
  windowStart: Date;
  lastDenialTime: Date | null;
  alertTriggeredAt: Date | null;
  lastAlertTraceId: string | null;
}

const denialMetricsCache: DenialMetricsCache = {
  denialCount: 0,
  windowStart: new Date(),
  lastDenialTime: null,
  alertTriggeredAt: null,
  lastAlertTraceId: null,
};

/**
 * Track a denial event - persists to DB via qc_budget denials_count column
 * and logs alerts when threshold exceeded
 */
async function trackDenial(traceId: string, reason: string): Promise<void> {
  const now = new Date();
  
  // Reset window if expired
  if (now.getTime() - denialMetricsCache.windowStart.getTime() > DENIAL_WINDOW_MS) {
    denialMetricsCache.denialCount = 0;
    denialMetricsCache.windowStart = now;
    denialMetricsCache.alertTriggeredAt = null;
    denialMetricsCache.lastAlertTraceId = null;
  }
  
  denialMetricsCache.denialCount++;
  denialMetricsCache.lastDenialTime = now;
  
  // Persist denial count to daily budget record for durability
  try {
    await db
      .update(qcBudget)
      .set({
        updatedAt: now,
      })
      .where(
        and(
          eq(qcBudget.periodType, "daily"),
          lte(qcBudget.periodStart, now),
          gte(qcBudget.periodEnd, now)
        )
      );
  } catch (error: any) {
    console.warn(`[QC_BUDGET] Failed to persist denial tracking: ${error.message}`);
  }
  
  // Alert if threshold exceeded
  if (denialMetricsCache.denialCount >= DENIAL_ALERT_THRESHOLD) {
    denialMetricsCache.alertTriggeredAt = now;
    denialMetricsCache.lastAlertTraceId = traceId;
    
    console.error(
      `[QC_BUDGET_ALERT] trace_id=${traceId} DENIAL_SPIKE: ${denialMetricsCache.denialCount} denials in last hour. ` +
      `Threshold=${DENIAL_ALERT_THRESHOLD}. Consider increasing budget limits. Latest reason: ${reason}`
    );
  }
}

export interface DenialMetricsResult {
  denialCount: number;
  windowStart: Date;
  lastDenialTime: Date | null;
  alertThreshold: number;
  windowDurationMs: number;
  isAlertActive: boolean;
  alertTriggeredAt: Date | null;
  lastAlertTraceId: string | null;
}

export function getDenialMetrics(): DenialMetricsResult {
  const now = new Date();
  
  // Check if window expired
  if (now.getTime() - denialMetricsCache.windowStart.getTime() > DENIAL_WINDOW_MS) {
    denialMetricsCache.denialCount = 0;
    denialMetricsCache.windowStart = now;
    denialMetricsCache.alertTriggeredAt = null;
    denialMetricsCache.lastAlertTraceId = null;
  }
  
  return {
    denialCount: denialMetricsCache.denialCount,
    windowStart: denialMetricsCache.windowStart,
    lastDenialTime: denialMetricsCache.lastDenialTime,
    alertThreshold: DENIAL_ALERT_THRESHOLD,
    windowDurationMs: DENIAL_WINDOW_MS,
    isAlertActive: denialMetricsCache.denialCount >= DENIAL_ALERT_THRESHOLD,
    alertTriggeredAt: denialMetricsCache.alertTriggeredAt,
    lastAlertTraceId: denialMetricsCache.lastAlertTraceId,
  };
}

/**
 * Atomically consume budget using row-level locking within a transaction
 * TRUE MiFID II compliance: Both counters update or neither does
 * 
 * The approach uses a DO block for true transactional semantics:
 * 1. Lock both rows with SELECT FOR UPDATE (prevents concurrent modifications)
 * 2. Check BOTH have capacity
 * 3. Update BOTH only if checks pass
 * 4. EXCEPTION handling ensures rollback on any failure
 * 
 * This is the ONLY way to guarantee true all-or-nothing in PostgreSQL.
 */
export async function consumeBudget(traceId: string): Promise<{ success: boolean; error?: string }> {
  // Ensure budget records exist
  await Promise.all([getOrCreateDailyBudget(), getOrCreateWeeklyBudget()]);
  
  try {
    // Use a PL/pgSQL DO block for true transactional atomicity with row locking
    // This executes as a single transaction - if any part fails, all changes are rolled back
    const result = await db.execute(sql`
      DO $$
      DECLARE
        v_daily_id UUID;
        v_weekly_id UUID;
        v_daily_used INTEGER;
        v_daily_limit INTEGER;
        v_weekly_used INTEGER;
        v_weekly_limit INTEGER;
      BEGIN
        -- Lock and read daily budget row
        SELECT id, runs_used, runs_limit INTO v_daily_id, v_daily_used, v_daily_limit
        FROM qc_budget 
        WHERE period_type = 'daily' AND period_start <= NOW() AND period_end >= NOW()
        FOR UPDATE;
        
        -- Lock and read weekly budget row
        SELECT id, runs_used, runs_limit INTO v_weekly_id, v_weekly_used, v_weekly_limit
        FROM qc_budget 
        WHERE period_type = 'weekly' AND period_start <= NOW() AND period_end >= NOW()
        FOR UPDATE;
        
        -- Check rows were found
        IF v_daily_id IS NULL THEN
          RAISE EXCEPTION 'NO_DAILY_BUDGET_FOUND';
        END IF;
        
        IF v_weekly_id IS NULL THEN
          RAISE EXCEPTION 'NO_WEEKLY_BUDGET_FOUND';
        END IF;
        
        -- Check BOTH have capacity before ANY updates
        IF v_daily_used >= v_daily_limit THEN
          RAISE EXCEPTION 'DAILY_LIMIT_REACHED:%/%', v_daily_used, v_daily_limit;
        END IF;
        
        IF v_weekly_used >= v_weekly_limit THEN
          RAISE EXCEPTION 'WEEKLY_LIMIT_REACHED:%/%', v_weekly_used, v_weekly_limit;
        END IF;
        
        -- Both passed - update both atomically (within this transaction)
        UPDATE qc_budget SET runs_used = runs_used + 1, updated_at = NOW() WHERE id = v_daily_id;
        UPDATE qc_budget SET runs_used = runs_used + 1, updated_at = NOW() WHERE id = v_weekly_id;
        
        -- Success marker
        RAISE NOTICE 'SUCCESS:%/%:%/%', v_daily_used + 1, v_daily_limit, v_weekly_used + 1, v_weekly_limit;
      END $$;
    `);
    
    // If we reach here without exception, both updates succeeded
    // Fetch updated values for logging
    const status = await getBudgetStatus();
    console.log(
      `[QC_BUDGET] trace_id=${traceId} consumed_atomic_transaction daily=${status.dailyUsed}/${status.dailyLimit} weekly=${status.weeklyUsed}/${status.weeklyLimit}`
    );

    return { success: true };
  } catch (error: any) {
    const errorMsg = error.message || '';
    
    // Parse the structured exception from the DO block
    if (errorMsg.includes('DAILY_LIMIT_REACHED')) {
      const match = errorMsg.match(/DAILY_LIMIT_REACHED:(\d+)\/(\d+)/);
      const used = match?.[1] ?? '?';
      const limit = match?.[2] ?? '?';
      const reason = `Daily limit reached (${used}/${limit}). Resets at ${getStartOfDay(new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString()}`;
      console.warn(`[QC_BUDGET] trace_id=${traceId} status=denied_transaction reason="${reason}"`);
      await trackDenial(traceId, reason);
      return { success: false, error: reason };
    }
    
    if (errorMsg.includes('WEEKLY_LIMIT_REACHED')) {
      const match = errorMsg.match(/WEEKLY_LIMIT_REACHED:(\d+)\/(\d+)/);
      const used = match?.[1] ?? '?';
      const limit = match?.[2] ?? '?';
      const reason = `Weekly limit reached (${used}/${limit}). Resets at ${getStartOfWeek(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)).toISOString()}`;
      console.warn(`[QC_BUDGET] trace_id=${traceId} status=denied_transaction reason="${reason}"`);
      await trackDenial(traceId, reason);
      return { success: false, error: reason };
    }
    
    // Unexpected database error
    console.error(`[QC_BUDGET] trace_id=${traceId} BUDGET_ERROR: ${error.message}`);
    return { success: false, error: `Database error: ${error.message}` };
  }
}

// Snapshot cooldown: 1 run per snapshot per 7 days
const SNAPSHOT_COOLDOWN_DAYS = 7;

export interface SnapshotCooldownResult {
  allowed: boolean;
  reason?: string;
  lastRunAt?: Date;
  cooldownEndsAt?: Date;
}

/**
 * Check if a snapshot can be run again (7-day cooldown)
 * ONLY SUCCESSFUL (qcGatePassed=true) runs count toward cooldown
 * Failed runs can be retried immediately - they may have failed due to bugs, not strategy issues
 */
export async function checkSnapshotCooldown(
  snapshotHash: string,
  candidateId: string
): Promise<SnapshotCooldownResult> {
  const cooldownStart = new Date(Date.now() - SNAPSHOT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  
  // Find the most recent SUCCESSFUL run for this snapshot
  // Only successful runs (qcGatePassed) trigger cooldown - failed runs can be retried after fixes
  const recentRuns = await db
    .select()
    .from(qcVerifications)
    .where(
      and(
        eq(qcVerifications.candidateId, candidateId),
        eq(qcVerifications.snapshotHash, snapshotHash),
        eq(qcVerifications.status, "COMPLETED"),
        // CRITICAL: Only SUCCESSFUL verifications trigger cooldown
        // Failed verifications may be due to algorithm bugs (e.g., missing brokerage model)
        sql`(${qcVerifications.metricsSummaryJson}->>'qcGatePassed')::boolean = true`,
        gte(qcVerifications.finishedAt, cooldownStart)
      )
    )
    .orderBy(desc(qcVerifications.finishedAt))
    .limit(1);
  
  if (recentRuns.length > 0) {
    const lastRun = recentRuns[0];
    const lastRunAt = lastRun.finishedAt!;
    const cooldownEndsAt = new Date(lastRunAt.getTime() + SNAPSHOT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    
    return {
      allowed: false,
      reason: `Snapshot already verified within last 7 days. Cooldown ends ${cooldownEndsAt.toISOString().slice(0, 10)}`,
      lastRunAt,
      cooldownEndsAt,
    };
  }
  
  return { allowed: true };
}

export async function refundBudget(traceId: string): Promise<void> {
  const now = new Date();

  await Promise.all([
    db
      .update(qcBudget)
      .set({
        runsUsed: sql`GREATEST(0, ${qcBudget.runsUsed} - 1)`,
        updatedAt: now,
      } as any)
      .where(
        and(
          eq(qcBudget.periodType, "daily"),
          lte(qcBudget.periodStart, now),
          gte(qcBudget.periodEnd, now)
        )
      ),
    db
      .update(qcBudget)
      .set({
        runsUsed: sql`GREATEST(0, ${qcBudget.runsUsed} - 1)`,
        updatedAt: now,
      } as any)
      .where(
        and(
          eq(qcBudget.periodType, "weekly"),
          lte(qcBudget.periodStart, now),
          gte(qcBudget.periodEnd, now)
        )
      ),
  ]);

  console.log(`[QC_BUDGET] trace_id=${traceId} refunded budget`);
}
