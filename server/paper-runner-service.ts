/**
 * Paper Runner Service - Real-time Paper Trade Execution
 * 
 * Evaluates strategy signals against live market data for PAPER+ stage bots.
 * Simulates order fills with realistic slippage and fees.
 * Records paper trades and updates bot metrics in real-time.
 */

import { db } from "./db";
import { bots, botInstances, paperTrades } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { liveDataService, type LiveBar } from "./live-data-service";
import { logActivityEvent } from "./activity-logger";
import type { StrategyRules, Side, EntryCondition } from "./strategy-rules";
import { isWithinTradingSession, isInNoTradeWindow, getEasternTimeComponents } from "./strategy-executor";
import { getInstrumentSpec, calculateTradePnL } from "./instrument-spec";
import { getCacheEntry, isCacheReady } from "./bar-cache";
import { livePnLWebSocket } from "./websocket-server";
import { storage } from "./storage";
import { priceAuthority } from "./price-authority";

/**
 * CME Futures Market Hours & Holiday Calendar
 * 
 * CME E-mini/Micro futures trade nearly 24 hours:
 * - Sunday 6:00 PM ET to Friday 5:00 PM ET
 * - Daily maintenance break: 5:00 PM - 6:00 PM ET (Mon-Thu)
 * - Closed on major US holidays
 */

// CME holidays for 2024-2025 (markets closed entirely or early close)
// Format: "YYYY-MM-DD" for full day closures
const CME_HOLIDAYS_2024 = [
  "2024-01-01", // New Year's Day
  "2024-01-15", // MLK Day
  "2024-02-19", // Presidents Day
  "2024-03-29", // Good Friday
  "2024-05-27", // Memorial Day
  "2024-06-19", // Juneteenth
  "2024-07-04", // Independence Day
  "2024-09-02", // Labor Day
  "2024-11-28", // Thanksgiving
  "2024-12-25", // Christmas
];

const CME_HOLIDAYS_2025 = [
  "2025-01-01", // New Year's Day
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents Day
  "2025-04-18", // Good Friday
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
];

const CME_HOLIDAYS_2026 = [
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents Day
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
];

const CME_HOLIDAYS = new Set([
  ...CME_HOLIDAYS_2024,
  ...CME_HOLIDAYS_2025,
  ...CME_HOLIDAYS_2026,
]);

// FULL-DAY closures - NO evening session opens on these days
// These are complete shutdowns where Globex remains closed until next trading day
// Includes all major US holidays where CME is fully closed
const CME_FULL_DAY_CLOSURES = new Set([
  // 2024 Full-Day Closures
  "2024-01-01", // New Year's Day
  "2024-01-15", // MLK Day
  "2024-02-19", // Presidents Day
  "2024-03-29", // Good Friday - NO trading whatsoever
  "2024-05-27", // Memorial Day
  "2024-06-19", // Juneteenth
  "2024-07-04", // Independence Day
  "2024-09-02", // Labor Day
  "2024-11-28", // Thanksgiving
  "2024-12-25", // Christmas
  
  // 2025 Full-Day Closures
  "2025-01-01", // New Year's Day
  "2025-01-20", // MLK Day
  "2025-02-17", // Presidents Day
  "2025-04-18", // Good Friday - NO trading whatsoever
  "2025-05-26", // Memorial Day
  "2025-06-19", // Juneteenth
  "2025-07-04", // Independence Day
  "2025-09-01", // Labor Day
  "2025-11-27", // Thanksgiving
  "2025-12-25", // Christmas
  
  // 2026 Full-Day Closures
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Day
  "2026-02-16", // Presidents Day
  "2026-04-03", // Good Friday - NO trading whatsoever
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

// CME Globex early close days (markets close at 12:15 PM CT / 1:15 PM ET)
// Note: New Year's Eve is NOT an early close for Globex - only for pit/floor trading
const CME_EARLY_CLOSE_2024 = [
  "2024-07-03", // Day before Independence Day
  "2024-11-29", // Day after Thanksgiving
  "2024-12-24", // Christmas Eve
  // Note: 2024-12-31 removed - Globex trades normal hours on NYE
];

const CME_EARLY_CLOSE_2025 = [
  "2025-07-03", // Day before Independence Day
  "2025-11-28", // Day after Thanksgiving
  "2025-12-24", // Christmas Eve
  // Note: 2025-12-31 removed - Globex trades normal hours on NYE
];

const CME_EARLY_CLOSE = new Set([
  ...CME_EARLY_CLOSE_2024,
  ...CME_EARLY_CLOSE_2025,
]);

/**
 * CME Futures Market Status Types
 * 
 * The market can be in three states:
 * 1. OPEN - Normal trading, entries and exits allowed
 * 2. MAINTENANCE - Daily 5-6 PM ET break, positions held but no new entries
 * 3. CLOSED - Weekend/holiday, positions should be closed
 */
export type MarketStatusType = "OPEN" | "MAINTENANCE" | "CLOSED";

export interface CMEMarketStatus {
  status: MarketStatusType;
  reason: string;
  nextOpen?: string;
  shouldLiquidate: boolean; // Only true for real market closures
}

// Holiday name lookup for UI display
const CME_HOLIDAY_NAMES: Record<string, string> = {
  "2024-01-01": "New Year's Day",
  "2024-01-15": "MLK Day",
  "2024-02-19": "Presidents Day",
  "2024-03-29": "Good Friday",
  "2024-05-27": "Memorial Day",
  "2024-06-19": "Juneteenth",
  "2024-07-04": "Independence Day",
  "2024-09-02": "Labor Day",
  "2024-11-28": "Thanksgiving",
  "2024-12-25": "Christmas",
  "2025-01-01": "New Year's Day",
  "2025-01-20": "MLK Day",
  "2025-02-17": "Presidents Day",
  "2025-04-18": "Good Friday",
  "2025-05-26": "Memorial Day",
  "2025-06-19": "Juneteenth",
  "2025-07-04": "Independence Day",
  "2025-09-01": "Labor Day",
  "2025-11-27": "Thanksgiving",
  "2025-12-25": "Christmas",
  "2026-01-01": "New Year's Day",
  "2026-01-19": "MLK Day",
  "2026-02-16": "Presidents Day",
  "2026-04-03": "Good Friday",
  "2026-05-25": "Memorial Day",
  "2026-06-19": "Juneteenth",
  "2026-07-03": "Independence Day",
  "2026-09-07": "Labor Day",
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas",
};

/**
 * Get the holiday name for a given date (if it's a CME holiday)
 */
export function getCMEHolidayName(date: Date = new Date()): string | null {
  const etFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const dateStr = etFormatter.format(date);
  return CME_HOLIDAY_NAMES[dateStr] || null;
}

/**
 * Check CME futures market status
 * 
 * Trading hours: Sunday 6:00 PM ET - Friday 5:00 PM ET
 * Daily break: 5:00 PM - 6:00 PM ET (Mon-Thu) - NO LIQUIDATION
 * Weekend: Friday 5 PM - Sunday 6 PM - LIQUIDATION
 * Holidays: Closed on major US holidays - LIQUIDATION
 * 
 * @returns Object with status, reason, and whether to liquidate positions
 */
export function getCMEMarketStatus(date: Date = new Date()): CMEMarketStatus {
  const et = getEasternTimeComponents(date);
  const currentMinutes = et.hours * 60 + et.minutes;
  
  // Format date as YYYY-MM-DD for holiday lookup using Eastern Time
  const etFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const dateStr = etFormatter.format(date);
  
  // CME trading hours in minutes from midnight ET
  const sessionOpen = 18 * 60; // 6:00 PM ET
  const dailyBreakStart = 17 * 60; // 5:00 PM ET
  const dailyBreakEnd = 18 * 60; // 6:00 PM ET
  const earlyCloseTime = 13 * 60; // 1:00 PM ET for early close days
  
  // Check if it's a CME holiday
  if (CME_HOLIDAYS.has(dateStr)) {
    // Check if it's a FULL-DAY closure (no evening session, like Good Friday/Thanksgiving)
    if (CME_FULL_DAY_CLOSURES.has(dateStr)) {
      // Full-day closure - market stays closed until next trading day
      return { 
        status: "CLOSED", 
        reason: "CME_HOLIDAY", 
        nextOpen: "Next trading day 6:00 PM ET",
        shouldLiquidate: true
      };
    }
    
    // Partial closure - day session closed but evening session opens at 6 PM ET
    // Example: Christmas Day session is closed, but evening session opens at 6 PM ET
    if (currentMinutes < sessionOpen) {
      // Before 6 PM ET on a partial holiday - day session is CLOSED
      return { 
        status: "CLOSED", 
        reason: "CME_HOLIDAY", 
        nextOpen: "Today 6:00 PM ET",
        shouldLiquidate: true
      };
    }
    // After 6 PM ET on a partial holiday - evening session is OPEN
    return { status: "OPEN", reason: "HOLIDAY_EVENING_SESSION", shouldLiquidate: false };
  }
  
  // Check for early close days - FULL CLOSURE after early close time
  if (CME_EARLY_CLOSE.has(dateStr)) {
    if (currentMinutes >= earlyCloseTime) {
      return { 
        status: "CLOSED", 
        reason: "EARLY_CLOSE", 
        nextOpen: "Next session 6:00 PM ET",
        shouldLiquidate: true
      };
    }
  }
  
  // Saturday: Market is closed all day - FULL CLOSURE
  if (et.dayOfWeek === 6) {
    return { 
      status: "CLOSED", 
      reason: "WEEKEND_SATURDAY", 
      nextOpen: "Sunday 6:00 PM ET",
      shouldLiquidate: true
    };
  }
  
  // Sunday: Market opens at 6:00 PM ET
  if (et.dayOfWeek === 0) {
    if (currentMinutes < sessionOpen) {
      return { 
        status: "CLOSED", 
        reason: "WEEKEND_SUNDAY_PRE_OPEN", 
        nextOpen: "Today 6:00 PM ET",
        shouldLiquidate: true
      };
    }
    return { status: "OPEN", reason: "SUNDAY_SESSION", shouldLiquidate: false };
  }
  
  // Friday: Market closes at 5:00 PM ET for the week - FULL CLOSURE
  if (et.dayOfWeek === 5) {
    if (currentMinutes >= dailyBreakStart) {
      return { 
        status: "CLOSED", 
        reason: "FRIDAY_CLOSE", 
        nextOpen: "Sunday 6:00 PM ET",
        shouldLiquidate: true
      };
    }
    return { status: "OPEN", reason: "FRIDAY_SESSION", shouldLiquidate: false };
  }
  
  // Monday-Thursday: Check for daily 5-6 PM ET maintenance break
  // IMPORTANT: This is NOT a full closure - positions remain open, only entries blocked
  if (currentMinutes >= dailyBreakStart && currentMinutes < dailyBreakEnd) {
    return { 
      status: "MAINTENANCE", 
      reason: "DAILY_MAINTENANCE_BREAK", 
      nextOpen: "Today 6:00 PM ET",
      shouldLiquidate: false  // CRITICAL: Do not liquidate during maintenance
    };
  }
  
  // Otherwise, market is open (Mon-Thu either before 5 PM or after 6 PM)
  return { status: "OPEN", reason: "REGULAR_SESSION", shouldLiquidate: false };
}

interface IndicatorState {
  ema9: number;
  ema20: number;
  ema21: number;
  sma50: number;
  vwap: number;
  vwapSum: number;
  volumeSum: number;
  rsi: number;
  rsiGain: number;
  rsiLoss: number;
  atr: number;
  atrValues: number[];
  momentum: number;
  highOfDay: number;
  lowOfDay: number;
  openOfDay: number;
  avgVolume: number;
  volumeHistory: number[];
  priceHistory: number[];
}

interface ActivePaperRunner {
  botId: string;
  instanceId: string;
  symbol: string;
  accountId: string | null;
  userId: string | null;
  botName: string | null;
  strategyConfig: StrategyRules;
  unsubscribe: () => void;
  barBuffer: LiveBar[];
  openPosition: {
    side: Side;
    entryPrice: number;
    entryTime: Date;
    quantity: number;
    stopPrice: number;
    targetPrice: number;
    tradeId: string;
  } | null;
  indicators: IndicatorState | null;
  traceId: string;
}

class PaperRunnerServiceImpl {
  private activeRunners: Map<string, ActivePaperRunner> = new Map();
  private isRunning = false;
  private autonomyCheckInterval: NodeJS.Timeout | null = null;
  private lastDataFeedCheck: { status: 'OK' | 'BLOCKED'; timestamp: number } = { status: 'OK', timestamp: 0 };
  private isDataFrozen = false; // INSTITUTIONAL SAFETY: Trading execution blocked when true
  
  // INSTITUTIONAL: Cache of bot-specific threshold variations (SHA-256 derived)
  // These are deterministic per botId so caching is safe across restarts
  private botThresholdCache: Map<string, { var1: number; var2: number; var3: number; var4: number; var5: number }> = new Map();

  private readonly MIN_BARS_FOR_SIGNAL = 21;
  private readonly DEFAULT_SLIPPAGE_TICKS = 1;
  private readonly DEFAULT_FEES_PER_SIDE = 2.25;
  private readonly AUTONOMY_CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // MAINTENANCE_MODE: Skip live data and runner rehydration to conserve memory
    if (process.env.MAINTENANCE_MODE === 'true') {
      console.log("[PAPER_RUNNER_SERVICE] MAINTENANCE_MODE: Skipping live data and runner rehydration");
      return;
    }
    
    // CRITICAL: Clear stale MAINTENANCE/CLOSED states on startup
    // This fixes bots showing "Paused for maintenance" outside of maintenance hours
    await this.clearStaleSessionStates();
    
    await liveDataService.start();
    console.log("[PAPER_RUNNER_SERVICE] Started");
    
    // Rehydrate orphaned runners on startup
    await this.rehydrateOrphanedRunners();
    
    // INSTITUTIONAL SAFETY: Start periodic autonomy check
    this.startAutonomyWatch();
  }
  
  /**
   * Clear stale MAINTENANCE/CLOSED activity states on startup.
   * This handles the case where a server restart happens after a maintenance window,
   * but before enforceSessionEnd runs to clear the states.
   */
  private async clearStaleSessionStates(): Promise<void> {
    const marketStatus = getCMEMarketStatus(new Date());
    
    // Only clear states if market is currently OPEN
    if (marketStatus.status !== "OPEN") {
      console.log(`[PAPER_RUNNER_SERVICE] Market is ${marketStatus.status}, not clearing session states`);
      return;
    }
    
    try {
      // Find all PAPER+ bot instances with stale MAINTENANCE or session states
      const result = await db
        .update(botInstances)
        .set({
          activityState: sql`CASE 
            WHEN ${botInstances.activityState} = 'MAINTENANCE' THEN 'SCANNING'
            WHEN ${botInstances.activityState} = 'IDLE' AND (state_json->>'sessionState' = 'MAINTENANCE' OR state_json->>'sessionState' = 'CLOSED') THEN 'SCANNING'
            ELSE ${botInstances.activityState}
          END`,
          stateJson: sql`state_json || jsonb_build_object(
            'sessionState', 'ACTIVE',
            'isSleeping', false,
            'outsideSession', false,
            'staleStateClearedAt', NOW()::text
          )`,
        })
        .where(
          sql`${botInstances.status} = 'RUNNING'
              AND ${botInstances.stoppedAt} IS NULL
              AND ${botInstances.jobType} = 'RUNNER'
              AND (${botInstances.activityState} = 'MAINTENANCE' 
                   OR state_json->>'sessionState' = 'MAINTENANCE'
                   OR state_json->>'sessionState' = 'CLOSED')`
        )
        .returning({ id: botInstances.id });
      
      if (result.length > 0) {
        console.log(`[PAPER_RUNNER_SERVICE] STARTUP_CLEANUP: Cleared ${result.length} stale MAINTENANCE/CLOSED states`);
      }
    } catch (error) {
      console.error("[PAPER_RUNNER_SERVICE] Failed to clear stale session states:", error);
    }
  }
  
  /**
   * INSTITUTIONAL SAFETY: Periodic check for data feed availability
   * 
   * If priceAuthority detects we're operating on cache-only mode,
   * broadcast DATA_FROZEN state to all runners so UI shows "Scanning for data..."
   * Runners stay alive but trading is paused. When data recovers, resume to SCANNING.
   */
  private startAutonomyWatch(): void {
    if (this.autonomyCheckInterval) return;
    
    this.autonomyCheckInterval = setInterval(async () => {
      if (!this.isRunning || this.activeRunners.size === 0) return;
      
      const shouldHalt = priceAuthority.shouldHaltAutonomy();
      const dataStatus = priceAuthority.getDataSourceStatus();
      
      if (shouldHalt && this.lastDataFeedCheck.status !== 'BLOCKED') {
        // State transition: OK -> BLOCKED (data frozen)
        this.lastDataFeedCheck = { status: 'BLOCKED', timestamp: Date.now() };
        this.isDataFrozen = true; // CRITICAL: Block trading execution
        
        console.warn(`[PAPER_RUNNER_SERVICE] DATA_FROZEN source=${dataStatus.source} - broadcasting frozen state to ${this.activeRunners.size} runners`);
        
        await logActivityEvent({
          eventType: "INTEGRATION_ERROR",
          severity: "WARN",
          title: "Data Feed Unavailable - Trading Paused",
          summary: `Runners paused: operating on ${dataStatus.source} mode. Trading will resume when live data returns.`,
          payload: {
            reason: "DATA_FEED_UNAVAILABLE",
            source: dataStatus.source,
            activeRunners: this.activeRunners.size,
          },
          traceId: crypto.randomUUID().slice(0, 8),
        });
        
        // Broadcast DATA_FROZEN to all runners - preserve position data
        await this.broadcastDataFrozenState();
        
      } else if (!shouldHalt && this.lastDataFeedCheck.status === 'BLOCKED') {
        // State transition: BLOCKED -> OK (recovery)
        this.lastDataFeedCheck = { status: 'OK', timestamp: Date.now() };
        this.isDataFrozen = false; // CRITICAL: Resume trading execution
        
        console.log(`[PAPER_RUNNER_SERVICE] DATA_RESUMED source=${dataStatus.source} - restoring runner states`);
        
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "INFO",
          title: "Data Feed Restored - Trading Resumed",
          summary: `Data feed restored: now on ${dataStatus.source}`,
          payload: {
            source: dataStatus.source,
          },
          traceId: crypto.randomUUID().slice(0, 8),
        });
        
        // Restore runners to normal state
        await this.restoreFromDataFrozen();
      }
    }, this.AUTONOMY_CHECK_INTERVAL_MS);
  }
  
  /**
   * Broadcast DATA_FROZEN state to all active runners while preserving position data.
   * UI will show "Scanning for data..." instead of potentially stale P&L.
   */
  private async broadcastDataFrozenState(): Promise<void> {
    for (const [botId, runner] of this.activeRunners) {
      // Broadcast with preserved position data
      livePnLWebSocket.broadcastLivePnL({
        botId,
        unrealizedPnl: null, // Clear P&L since we can't compute fresh value
        currentPrice: null,
        entryPrice: runner.openPosition?.entryPrice ?? null,
        side: runner.openPosition?.side ?? null,
        positionQuantity: runner.openPosition?.quantity ?? null,
        positionSide: runner.openPosition?.side ?? null,
        stopPrice: runner.openPosition?.stopPrice ?? null,
        targetPrice: runner.openPosition?.targetPrice ?? null,
        positionOpenedAt: runner.openPosition?.entryTime.toISOString() ?? null,
        livePositionActive: !!runner.openPosition, // Preserve position visibility
        markTimestamp: undefined,
        markFresh: false,
        sessionState: 'ACTIVE',
        isSleeping: false,
        runnerState: 'DATA_FROZEN',
        activityState: runner.openPosition ? 'IN_TRADE' : 'DATA_FROZEN',
      });
      
      // Update database state - use SCANNING to avoid enum issues, store frozen in stateJson
      await db.update(botInstances)
        .set({
          activityState: runner.openPosition ? "IN_TRADE" : "SCANNING",
          stateJson: sql`COALESCE(state_json, '{}')::jsonb || ${JSON.stringify({
            dataFrozen: true,
            dataFrozenAt: new Date().toISOString(),
            dataFrozenReason: "DATA_FEED_UNAVAILABLE",
          })}::jsonb`,
        })
        .where(eq(botInstances.id, runner.instanceId))
        .catch(err => console.error(`[PAPER_RUNNER_SERVICE] Failed to update frozen state for ${botId.slice(0,8)}:`, err));
    }
  }
  
  /**
   * Restore runners from DATA_FROZEN to normal SCANNING state when data resumes.
   */
  private async restoreFromDataFrozen(): Promise<void> {
    for (const [botId, runner] of this.activeRunners) {
      const activityState = runner.openPosition ? 'IN_TRADE' : 'SCANNING';
      
      // Broadcast normal state
      livePnLWebSocket.broadcastLivePnL({
        botId,
        unrealizedPnl: null, // Will be recalculated on next bar
        currentPrice: null,
        entryPrice: runner.openPosition?.entryPrice ?? null,
        side: runner.openPosition?.side ?? null,
        positionQuantity: runner.openPosition?.quantity ?? null,
        positionSide: runner.openPosition?.side ?? null,
        stopPrice: runner.openPosition?.stopPrice ?? null,
        targetPrice: runner.openPosition?.targetPrice ?? null,
        positionOpenedAt: runner.openPosition?.entryTime.toISOString() ?? null,
        livePositionActive: !!runner.openPosition,
        markTimestamp: undefined,
        markFresh: false,
        sessionState: 'ACTIVE',
        isSleeping: false,
        runnerState: activityState === 'IN_TRADE' ? 'SCANNING' : 'SCANNING',
        activityState,
      });
      
      // Clear frozen state in database
      await db.update(botInstances)
        .set({
          activityState,
          stateJson: sql`COALESCE(state_json, '{}')::jsonb || ${JSON.stringify({
            dataFrozen: false,
            dataResumedAt: new Date().toISOString(),
          })}::jsonb`,
        })
        .where(eq(botInstances.id, runner.instanceId))
        .catch(err => console.error(`[PAPER_RUNNER_SERVICE] Failed to restore state for ${botId.slice(0,8)}:`, err));
    }
  }
  
  private stopAutonomyWatch(): void {
    if (this.autonomyCheckInterval) {
      clearInterval(this.autonomyCheckInterval);
      this.autonomyCheckInterval = null;
    }
  }

  /**
   * Scan for bot instances that should be running but have no active runner.
   * This happens after server restarts - the bot instance stays in DB but the
   * in-memory runner map is empty.
   * 
   * Rehydrates instances that:
   * - Are for PAPER+ stage bots
   * - Have isActive = true
   * - Have NOT been stopped (stoppedAt IS NULL)
   * - Are RUNNER job type
   * - Have an active activity state (not STOPPED or ERROR)
   * 
   * NOTE: No longer filters by heartbeat age - all orphaned runners are rehydrated.
   * The self-healing worker (PHASE 3) will handle any that become stale again.
   */
  private async rehydrateOrphanedRunners(): Promise<void> {
    try {
      // Find all ACTIVE bot instances for PAPER+ stages that should be running
      // Filters:
      // - PAPER+ stage
      // - isActive = true (not deactivated)
      // - stoppedAt IS NULL (not manually stopped)
      // - jobType = RUNNER (not backtest/evolution jobs)
      // - activityState in active states (IDLE, SCANNING, IN_TRADE, EXITING)
      // NOTE: Removed heartbeat filter - rehydrate ALL orphaned runners on restart
      const orphanedInstances = await db
        .select({
          instanceId: botInstances.id,
          botId: botInstances.botId,
          accountId: botInstances.accountId,
          startedAt: botInstances.startedAt,
          lastHeartbeatAt: botInstances.lastHeartbeatAt,
        })
        .from(botInstances)
        .innerJoin(bots, eq(bots.id, botInstances.botId))
        .where(
          sql`${bots.stage} IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
              AND ${botInstances.status} = 'RUNNING'
              AND ${botInstances.stoppedAt} IS NULL
              AND ${botInstances.jobType} = 'RUNNER'
              AND ${bots.archivedAt} IS NULL
              AND ${bots.killedAt} IS NULL`
        );

      if (orphanedInstances.length === 0) {
        console.log("[PAPER_RUNNER_SERVICE] No orphaned runners to rehydrate");
        return;
      }

      let rehydrated = 0;
      let skippedBlown = 0;
      for (const instance of orphanedInstances) {
        // Skip if already has an active runner
        if (this.activeRunners.has(instance.botId)) {
          continue;
        }

        // BLOWN ACCOUNT GUARD: Skip rehydration for blown accounts
        if (instance.accountId) {
          const blownCheck = await storage.checkAndHandleBlownAccount(instance.accountId);
          if (blownCheck.isBlown) {
            console.log(`[PAPER_RUNNER_SERVICE] SKIPPING rehydration for bot=${instance.botId.slice(0,8)} - account ${instance.accountId.slice(0,8)} is blown`);
            skippedBlown++;
            continue;
          }
        }

        const heartbeatAge = instance.lastHeartbeatAt 
          ? Math.floor((Date.now() - new Date(instance.lastHeartbeatAt).getTime()) / 60000)
          : null;
        const staleTag = heartbeatAge && heartbeatAge > 10 ? ` [STALE: ${heartbeatAge}min]` : '';
        
        console.log(`[PAPER_RUNNER_SERVICE] REHYDRATING orphaned runner bot=${instance.botId.slice(0, 8)} instance=${instance.instanceId.slice(0, 8)}${staleTag}`);
        
        const success = await this.startBot(instance.botId, instance.instanceId);
        if (success) {
          rehydrated++;
        }
      }

      if (rehydrated > 0 || skippedBlown > 0) {
        console.log(`[PAPER_RUNNER_SERVICE] Rehydrated ${rehydrated} orphaned runners, skipped ${skippedBlown} blown accounts`);
      }
    } catch (error) {
      console.error("[PAPER_RUNNER_SERVICE] Failed to rehydrate orphaned runners:", error);
    }
  }

  stop(): void {
    this.isRunning = false;
    this.stopAutonomyWatch();
    this.activeRunners.forEach(runner => runner.unsubscribe());
    this.activeRunners.clear();
    liveDataService.stop();
    console.log("[PAPER_RUNNER_SERVICE] Stopped");
  }

  async startBot(botId: string, instanceId: string): Promise<boolean> {
    if (this.activeRunners.has(botId)) {
      console.log(`[PAPER_RUNNER_SERVICE] Bot ${botId.slice(0,8)} already running`);
      return true;
    }

    const traceId = crypto.randomUUID().slice(0, 8);

    try {
      const [bot] = await db.select().from(bots).where(eq(bots.id, botId));
      
      if (!bot) {
        console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} Bot not found: ${botId}`);
        return false;
      }

      const [instance] = await db.select().from(botInstances).where(eq(botInstances.id, instanceId));
      
      if (!instance) {
        console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} Instance not found: ${instanceId}`);
        return false;
      }

      // BLOWN ACCOUNT GUARD: Check if account is blown before starting runner
      // Prevents trading on accounts that have hit $0 and are awaiting recovery
      if (instance.accountId) {
        const blownCheck = await storage.checkAndHandleBlownAccount(instance.accountId);
        if (blownCheck.isBlown) {
          console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} BLOCKED: Account ${instance.accountId.slice(0,8)} is blown - runner not started`);
          
          // Mark instance as stopped with blown account reason
          await db.update(botInstances)
            .set({ 
              status: "STOPPED",
              stoppedAt: new Date(),
              activityState: "IDLE",
              stateJson: {
                blownAccount: true,
                blownAt: blownCheck.attempt?.blownAt?.toString() || new Date().toISOString(),
                attemptNumber: blownCheck.attempt?.attemptNumber,
                awaitingRecovery: true,
                blockedReason: "Account balance depleted - reset required",
              },
            })
            .where(eq(botInstances.id, instanceId));
          
          return false;
        }
      }

      const strategyConfig = (bot.strategyConfig || {}) as StrategyRules;
      const symbol = bot.symbol || "MES";
      const timeframe = "1m";

      // CRITICAL FIX: Check for existing open position in database to prevent duplicate entries
      const existingOpenPosition = await this.loadOpenPositionFromDb(botId, traceId);

      const runner: ActivePaperRunner = {
        botId,
        instanceId,
        symbol,
        accountId: instance.accountId,
        userId: bot.userId || null,
        botName: bot.name || null,
        strategyConfig,
        unsubscribe: () => {},
        barBuffer: [],
        openPosition: existingOpenPosition,
        indicators: null,
        traceId,
      };
      
      if (existingOpenPosition) {
        console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} HYDRATED open ${existingOpenPosition.side} position @ ${existingOpenPosition.entryPrice.toFixed(2)} for bot=${botId.slice(0,8)}`);
        
        // INSTITUTIONAL CRITICAL: Immediately get mark and broadcast P&L BEFORE bar subscription
        // This ensures frontend sees accurate P&L immediately on rehydration, not after first bar
        const markResult = await priceAuthority.getMark(symbol, timeframe);
        
        if (markResult.price !== null && markResult.isFresh) {
          const unrealizedPnl = priceAuthority.computePnL(
            existingOpenPosition.entryPrice,
            markResult.price,
            existingOpenPosition.side,
            existingOpenPosition.quantity
          );
          
          // Persist mark metadata to stateJson for audit trail
          await db.update(botInstances)
            .set({
              stateJson: sql`COALESCE(state_json, '{}') || ${JSON.stringify({
                lastMarkPrice: markResult.price,
                lastMarkTime: markResult.timestamp?.toISOString(),
                markSource: markResult.source,
                rehydratedAt: new Date().toISOString(),
              })}::jsonb`,
            })
            .where(eq(botInstances.id, instanceId));
          
          // Broadcast immediately - frontend gets fresh P&L on rehydration
          livePnLWebSocket.broadcastLivePnL({
            botId,
            unrealizedPnl,
            currentPrice: markResult.price,
            entryPrice: existingOpenPosition.entryPrice,
            side: existingOpenPosition.side,
            positionQuantity: existingOpenPosition.quantity,
            positionSide: existingOpenPosition.side,
            stopPrice: existingOpenPosition.stopPrice,
            targetPrice: existingOpenPosition.targetPrice,
            positionOpenedAt: existingOpenPosition.entryTime.toISOString(),
            livePositionActive: true,
            markTimestamp: markResult.timestamp?.getTime(),
            markFresh: true,
            sessionState: 'ACTIVE',
            isSleeping: false,
            runnerState: 'SCANNING',
            activityState: 'IN_TRADE',
          });
          
          console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} REHYDRATE_BROADCAST bot=${botId.slice(0,8)} pnl=$${unrealizedPnl.toFixed(2)} mark=${markResult.price.toFixed(2)} source=${markResult.source}`);
        } else {
          // No fresh mark available - broadcast position exists but P&L unknown
          console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} REHYDRATE_NO_MARK bot=${botId.slice(0,8)} status=${markResult.status} - P&L display will show "Awaiting live mark"`);
          
          livePnLWebSocket.broadcastLivePnL({
            botId,
            unrealizedPnl: null,
            currentPrice: null,
            entryPrice: existingOpenPosition.entryPrice,
            side: existingOpenPosition.side,
            positionQuantity: existingOpenPosition.quantity,
            positionSide: existingOpenPosition.side,
            stopPrice: existingOpenPosition.stopPrice,
            targetPrice: existingOpenPosition.targetPrice,
            positionOpenedAt: existingOpenPosition.entryTime.toISOString(),
            livePositionActive: true,
            markTimestamp: undefined,
            markFresh: false,
            sessionState: 'ACTIVE',
            isSleeping: false,
            runnerState: 'SCANNING',
            activityState: 'IN_TRADE',
          });
        }
      }

      // INDUSTRY STANDARD: Pre-seed bar buffer from cache before subscribing to live updates
      // This avoids the 21-minute warmup delay - indicators are ready immediately
      const bootstrapCount = await this.bootstrapFromCache(runner);
      
      const unsubscribe = liveDataService.subscribe({
        botId,
        symbol,
        timeframe,
        callback: (bar) => this.onNewBar(runner, bar),
      });

      runner.unsubscribe = unsubscribe;
      this.activeRunners.set(botId, runner);

      await db.update(botInstances)
        .set({ 
          activityState: "SCANNING",
          lastHeartbeatAt: new Date(),
          status: "RUNNING",
          stateJson: {
            scanningSince: new Date().toISOString(),
            barCount: bootstrapCount,
            barsNeeded: this.MIN_BARS_FOR_SIGNAL,
          },
        })
        .where(eq(botInstances.id, instanceId));

      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} Started bot=${botId.slice(0,8)} symbol=${symbol} bootstrap_bars=${bootstrapCount}`);
      
      await logActivityEvent({
        eventType: "RUNNER_STARTED",
        severity: "INFO",
        title: `${bot.name}: Paper trading started`,
        summary: `Subscribed to ${symbol} live data, scanning for signals`,
        payload: { botId, symbol, instanceId, mode: "PAPER" },
        traceId,
      });

      return true;
    } catch (error) {
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} Failed to start bot ${botId}:`, error);
      return false;
    }
  }

  async stopBot(botId: string): Promise<void> {
    const runner = this.activeRunners.get(botId);
    if (!runner) return;

    runner.unsubscribe();
    this.activeRunners.delete(botId);

    await db.update(botInstances)
      .set({ 
        activityState: "IDLE",
        stoppedAt: new Date(),
      })
      .where(eq(botInstances.id, runner.instanceId));

    console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} Stopped bot=${botId.slice(0,8)}`);
  }

  /**
   * KILL SWITCH: Immediately stop ALL running bots
   * 
   * This is an emergency shutdown that:
   * 1. Unsubscribes all active runners from live data
   * 2. Marks all running instances as stopped in the database
   * 3. Logs an audit trail of the kill switch activation
   * 
   * Returns the number of bots stopped
   */
  async stopAllRunners(): Promise<{ stoppedCount: number; botIds: string[]; errors: string[] }> {
    const traceId = crypto.randomUUID().slice(0, 8);
    const killSwitchTimestamp = new Date().toISOString();
    console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Stopping all runners...`);
    
    const stoppedBotIds: string[] = [];
    const errors: string[] = [];
    const runnerEntries = Array.from(this.activeRunners.entries());
    
    // Phase 1: Stop all active runners (unsubscribe + DB update per runner)
    for (const [botId, runner] of runnerEntries) {
      try {
        // Unsubscribe first - this is idempotent
        runner.unsubscribe();
        this.activeRunners.delete(botId);
        stoppedBotIds.push(botId);
        
        // Update DB - uses lowercase enum values: "stopped", "running"
        await db.update(botInstances)
          .set({ 
            status: "stopped",
            activityState: "IDLE",
            stoppedAt: new Date(),
            stateJson: sql`COALESCE(state_json, '{}') || jsonb_build_object('killSwitchAt', ${killSwitchTimestamp})`,
          })
          .where(eq(botInstances.id, runner.instanceId));
          
        console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Stopped bot=${botId.slice(0,8)}`);
      } catch (error) {
        const errMsg = `bot=${botId.slice(0,8)}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errMsg);
        console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Error - ${errMsg}`);
        // Continue to next bot - don't abort kill switch
      }
    }
    
    // Phase 2: Catch orphaned "running" instances in DB (uses lowercase enum value)
    try {
      const result = await db.update(botInstances)
        .set({
          status: "stopped",
          activityState: "IDLE",
          stoppedAt: new Date(),
          stateJson: sql`COALESCE(state_json, '{}') || jsonb_build_object('killSwitchAt', ${killSwitchTimestamp})`,
        })
        .where(eq(botInstances.status, "running"))
        .returning({ id: botInstances.id, botId: botInstances.botId });
      
      for (const row of result) {
        if (!stoppedBotIds.includes(row.botId)) {
          stoppedBotIds.push(row.botId);
          console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Stopped orphan bot=${row.botId.slice(0,8)}`);
        }
      }
    } catch (error) {
      const errMsg = `orphan cleanup: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errMsg);
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Error - ${errMsg}`);
    }
    
    console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Stopped ${stoppedBotIds.length} bots, ${errors.length} errors`);
    
    // Phase 3: Always log activity event, even on partial failure
    try {
      await logActivityEvent({
        eventType: "KILL_SWITCH",
        severity: errors.length > 0 ? "ERROR" : "WARN",
        title: `Kill Switch Activated`,
        summary: `Stopped ${stoppedBotIds.length} running bots${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
        payload: { 
          botIds: stoppedBotIds, 
          stoppedCount: stoppedBotIds.length,
          errors: errors.length > 0 ? errors : undefined,
          killSwitchAt: killSwitchTimestamp,
        },
        traceId,
      });
    } catch (logError) {
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} KILL_SWITCH: Failed to log activity event:`, logError);
    }
    
    return { stoppedCount: stoppedBotIds.length, botIds: stoppedBotIds, errors };
  }

  /**
   * Check if positions should be auto-flattened before session close
   * Returns number of minutes until the next session closure, or null if not nearing close
   * 
   * Flatten triggers for:
   * - Friday 5 PM ET (weekend closure)
   * - Early close days (1 PM ET)
   * - Thursday if Friday is a full-day holiday (e.g., Good Friday)
   * - Any day before a full-day closure (Christmas mid-week, etc.)
   */
  private getMinutesUntilSessionClose(now: Date): number | null {
    const et = getEasternTimeComponents(now);
    const currentMinutes = et.hours * 60 + et.minutes;
    const dailyBreakStart = 17 * 60; // 5:00 PM ET
    const earlyCloseTime = 13 * 60; // 1:00 PM ET
    
    // Get ET date string using proper timezone conversion
    const etDateStr = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD format
    
    // Check for early close days (markets close at 1 PM ET)
    if (CME_EARLY_CLOSE.has(etDateStr)) {
      if (currentMinutes < earlyCloseTime) {
        return earlyCloseTime - currentMinutes;
      }
    }
    
    // Friday: session closes at 5 PM ET for the week
    if (et.dayOfWeek === 5 && currentMinutes < dailyBreakStart) {
      return dailyBreakStart - currentMinutes;
    }
    
    // Check if next trading day is a full-day holiday closure
    // This handles cases like Thursday before Good Friday
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    
    // If tomorrow is a full-day closure AND we're still in today's session, flatten before 5 PM
    if (CME_FULL_DAY_CLOSURES.has(tomorrowStr) && currentMinutes < dailyBreakStart) {
      return dailyBreakStart - currentMinutes;
    }
    
    // Also check if day after tomorrow is a closure (for multi-day closures)
    // This handles scenarios where tomorrow is also closed (e.g., Thanksgiving weekend)
    const dayAfter = new Date(now);
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dayAfterStr = dayAfter.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    
    if (CME_FULL_DAY_CLOSURES.has(dayAfterStr) && currentMinutes < dailyBreakStart) {
      return dailyBreakStart - currentMinutes;
    }
    
    // Monday-Thursday: no flatten before maintenance (positions ride through)
    // Only flatten before weekend/holiday closures
    return null;
  }

  /**
   * SESSION ENFORCEMENT: Check CME futures market status and update bot states
   * 
   * This runs periodically (every 30s via runner worker) to enforce session rules
   * even when no bars are being received (during market breaks/holidays).
   * 
   * CME Futures Hours:
   * - Sunday 6:00 PM ET to Friday 5:00 PM ET
   * - Daily maintenance break: 5:00 PM - 6:00 PM ET (Mon-Thu) - NO LIQUIDATION
   * - Weekend closure: Friday 5 PM - Sunday 6 PM - LIQUIDATION
   * - Closed on major US holidays - LIQUIDATION
   * 
   * AUTO-FLATTEN: If enabled, force exit positions X minutes before session close
   * to avoid holding through weekend/holiday gaps.
   * 
   * CRITICAL: The daily maintenance break (5-6 PM ET) should only suppress new entries,
   * NOT force liquidate positions or set activityState to IDLE.
   * 
   * Returns object with:
   * - isOutsideSession: true if market is CLOSED (not just maintenance)
   * - positionsClosed: number of positions that were closed
   * - isSleeping: true if market is fully closed and bots are sleeping
   */
  async enforceSessionEnd(): Promise<{ isOutsideSession: boolean; positionsClosed: number; isSleeping: boolean }> {
    const traceId = crypto.randomUUID().slice(0, 8);
    const now = new Date();
    
    // Check CME futures market status (includes holidays, weekends, daily breaks)
    const marketStatus = getCMEMarketStatus(now);
    
    // AUTO-FLATTEN: Check if we should force exit positions before session close
    if (marketStatus.status === "OPEN") {
      const { getSystemPowerState } = await import("./routes");
      const powerState = getSystemPowerState();
      
      if (powerState.autoFlattenBeforeClose) {
        const minutesUntilClose = this.getMinutesUntilSessionClose(now);
        
        if (minutesUntilClose !== null && minutesUntilClose <= powerState.flattenMinutesBeforeClose) {
          let flattenedCount = 0;
          
          for (const [botId, runner] of this.activeRunners) {
            if (!runner.openPosition) continue;
            
            const latestBar = runner.barBuffer[runner.barBuffer.length - 1];
            if (latestBar) {
              console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} AUTO_FLATTEN bot=${botId.slice(0,8)} minutes_until_close=${minutesUntilClose.toFixed(0)} position=${runner.openPosition.side}`);
              await this.closePosition(runner, latestBar, "AUTO_FLATTEN_BEFORE_CLOSE");
              flattenedCount++;
            }
          }
          
          if (flattenedCount > 0) {
            console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} AUTO_FLATTEN_COMPLETE positions_closed=${flattenedCount} minutes_until_close=${minutesUntilClose.toFixed(0)}`);
          }
        }
      }
    }
    
    // Handle OPEN status - clear any stale closed state
    if (marketStatus.status === "OPEN") {
      for (const [botId, runner] of this.activeRunners) {
        const [current] = await db.select({ 
          stateJson: botInstances.stateJson, 
          activityState: botInstances.activityState,
          currentPosition: botInstances.currentPosition,
          positionSide: botInstances.positionSide,
        })
          .from(botInstances)
          .where(eq(botInstances.id, runner.instanceId))
          .limit(1);
        
        const existingState = (current?.stateJson as Record<string, unknown>) || {};
        
        // Restore active state if coming from closed/maintenance
        if (existingState.sessionState === "CLOSED" || existingState.sessionState === "MAINTENANCE") {
          // MARKET OPEN RECONCILIATION: Check for stale position data
          // If DB shows a position but runner has none, this is stale data from last session
          const hasStalePositionData = !runner.openPosition && (
            current?.currentPosition !== 0 || 
            current?.positionSide !== null ||
            existingState.openPosition !== null ||
            existingState.positionOpenedAt !== null
          );
          
          if (hasStalePositionData) {
            console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} MARKET_OPEN_RECONCILE bot=${botId.slice(0,8)} clearing stale position data`);
          }
          
          // Build update payload dynamically to avoid using undefined (which Drizzle treats as NULL)
          // Only include position-clearing fields when runner has NO open position
          const updatePayload: Record<string, unknown> = {
            // Restore activity state to SCANNING if it was set to IDLE during closure
            activityState: current?.activityState === "IDLE" ? "SCANNING" : current?.activityState,
            stateJson: {
              ...existingState,
              outsideSession: false,
              sessionState: "ACTIVE",
              isSleeping: false,
              marketReason: marketStatus.reason,
              lastSessionCheck: now.toISOString(),
              // CRITICAL: Clear stale position data on market open if no actual position
              openPosition: runner.openPosition ? existingState.openPosition : null,
              positionOpenedAt: runner.openPosition ? existingState.positionOpenedAt : null,
              scanningSince: runner.openPosition ? existingState.scanningSince : now.toISOString(),
            }
          };
          
          // Only add position-clearing fields when runner has no position (stale data cleanup)
          if (!runner.openPosition) {
            updatePayload.currentPosition = 0;
            updatePayload.unrealizedPnl = 0;
            updatePayload.entryPrice = null;
            updatePayload.positionSide = null;
          }
          
          await db.update(botInstances)
            .set(updatePayload as any)
            .where(eq(botInstances.id, runner.instanceId));
          
          console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} MARKET_OPEN bot=${botId.slice(0,8)} reason=${marketStatus.reason}`);
        }
      }
      
      return { isOutsideSession: false, positionsClosed: 0, isSleeping: false };
    }
    
    // Handle MAINTENANCE status - show "Paused" in UI, suppress entries, keep positions open
    if (marketStatus.status === "MAINTENANCE") {
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} MAINTENANCE_WINDOW reason=${marketStatus.reason} nextOpen=${marketStatus.nextOpen || 'unknown'}`);
      
      // CRITICAL: Update activityState to MAINTENANCE so UI shows "Paused" instead of "Searching"
      // This prevents user confusion about bots appearing to search during closed market hours
      for (const [botId, runner] of this.activeRunners) {
        const [current] = await db.select({ stateJson: botInstances.stateJson })
          .from(botInstances)
          .where(eq(botInstances.id, runner.instanceId))
          .limit(1);
        
        const existingState = (current?.stateJson as Record<string, unknown>) || {};
        
        await db.update(botInstances)
          .set({
            // CHANGED: Set activityState to MAINTENANCE so UI shows paused state
            activityState: "MAINTENANCE",
            stateJson: {
              ...existingState,
              outsideSession: false, // Still technically within the trading week
              sessionState: "MAINTENANCE",
              isSleeping: true, // Mark as sleeping so WebSocket broadcasts correct state
              marketReason: marketStatus.reason,
              nextMarketOpen: marketStatus.nextOpen || null,
              lastSessionCheck: now.toISOString(),
            }
          })
          .where(eq(botInstances.id, runner.instanceId));
      }
      
      // No positions closed during maintenance - they ride through the break
      // Return isSleeping: true so livePnL broadcasts show correct paused state
      return { isOutsideSession: false, positionsClosed: 0, isSleeping: true };
    }
    
    // Handle CLOSED status - this is a full market closure (weekend/holiday)
    // Only now do we liquidate positions and mark bots as sleeping
    console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} MARKET_CLOSED reason=${marketStatus.reason} nextOpen=${marketStatus.nextOpen || 'unknown'} shouldLiquidate=${marketStatus.shouldLiquidate}`);
    
    const et = getEasternTimeComponents(now);
    
    // We're outside session - check for open positions in all PAPER+ bots
    let positionsClosed = 0;
    
    // First loop: Close any open positions
    for (const [botId, runner] of this.activeRunners) {
      if (!runner.openPosition) continue;
      
      // For session-end closure, use the last buffered bar if available
      // This represents the last market price before session ended
      const latestBar = runner.barBuffer[runner.barBuffer.length - 1];
      const pos = runner.openPosition;
      const totalFees = this.DEFAULT_FEES_PER_SIDE * 2;
      
      if (latestBar) {
        // Use the latest bar to close with proper P&L calculation
        console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} SESSION_END_CLOSE bot=${botId.slice(0,8)} position=${pos.side} @ ${pos.entryPrice.toFixed(2)} exit=${latestBar.close.toFixed(2)}`);
        
        await this.closePosition(runner, latestBar, "SESSION_END");
        positionsClosed++;
      } else {
        // No bars available - close at entry price (flat fill, fees only)
        // This is a safety fallback for edge cases
        console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} SESSION_END_FLAT bot=${botId.slice(0,8)} closing at entry price (no bar data)`);
        
        await db.update(paperTrades)
          .set({
            exitPrice: pos.entryPrice,
            exitTime: now,
            pnl: -totalFees,
            pnlPercent: 0,
            status: "CLOSED",
            exitReasonCode: "SESSION_END_FLAT",
            fees: totalFees,
            updatedAt: now,
          })
          .where(eq(paperTrades.id, pos.tradeId));
        
        runner.openPosition = null;
        positionsClosed++;
      }
    }
    
    // Second loop: Update stateJson for ALL active runners to reflect market is closed
    // This ensures bots show "Sleep" status even if they had no position to close
    for (const [botId, runner] of this.activeRunners) {
      const [current] = await db.select({ stateJson: botInstances.stateJson })
        .from(botInstances)
        .where(eq(botInstances.id, runner.instanceId))
        .limit(1);
      
      const existingState = (current?.stateJson as Record<string, unknown>) || {};
      
      // CRITICAL: Clear in-memory runner position state BEFORE database update
      // This ensures WebSocket broadcasts don't send stale position data
      runner.openPosition = null;
      
      await db.update(botInstances)
        .set({
          activityState: "MARKET_CLOSED",
          currentPosition: 0,
          unrealizedPnl: 0,
          entryPrice: null,
          positionSide: null,
          stateJson: {
            ...existingState,
            outsideSession: true,
            sessionState: "CLOSED",
            isSleeping: true,
            marketReason: marketStatus.reason,
            nextMarketOpen: marketStatus.nextOpen || null,
            sessionClosedAt: now.toISOString(),
            minutesUntilSessionEnd: 0,
            isNearingSessionEnd: false,
            lastSessionCheck: now.toISOString(),
            openPosition: null,
            positionOpenedAt: null,
          }
        })
        .where(eq(botInstances.id, runner.instanceId));
      
      livePnLWebSocket.broadcastLivePnL({
        botId: runner.botId,
        unrealizedPnl: null,
        currentPrice: null,
        positionQuantity: null,
        positionSide: null,
        entryPrice: null,
        stopPrice: null,
        targetPrice: null,
        positionOpenedAt: null,
        entryReasonCode: null,
        sessionState: 'CLOSED',
        isSleeping: true,
        runnerState: 'MARKET_CLOSED',
        activityState: 'MARKET_CLOSED',
        nextMarketOpen: marketStatus.nextOpen || null,
        marketReason: marketStatus.reason,
        livePositionActive: false,
      });
      
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} MARKET_CLOSE_BROADCAST bot=${botId.slice(0,8)} cleared position state via WebSocket`);
    }
    
    // Also update any PAPER+ bot instances that don't have active runners but have open trades
    // Note: We only look for primary runners since paper_trades are only created by PAPER stage
    // primary runners (SHADOW/CANARY/LIVE use different execution paths)
    const orphanedOpenTrades = await db.execute(sql`
      SELECT pt.id as trade_id, pt.bot_id, pt.entry_price, pt.side, pt.quantity, 
             bi.id as instance_id, b.stage
      FROM paper_trades pt
      JOIN bots b ON pt.bot_id = b.id
      LEFT JOIN bot_instances bi ON bi.bot_id = b.id 
        AND bi.is_primary_runner = true 
        AND bi.status = 'RUNNING'
      WHERE pt.status = 'OPEN'
        AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
        AND b.archived_at IS NULL
        AND b.killed_at IS NULL
    `);
    
    for (const trade of orphanedOpenTrades.rows as any[]) {
      // Skip if this bot has an active runner (already handled above)
      if (this.activeRunners.has(trade.bot_id)) continue;
      
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} SESSION_END_ORPHAN bot=${trade.bot_id.slice(0,8)} closing orphaned trade`);
      
      const totalFees = this.DEFAULT_FEES_PER_SIDE * 2;
      await db.update(paperTrades)
        .set({
          exitPrice: trade.entry_price,
          exitTime: now,
          pnl: -totalFees,
          status: "CLOSED",
          exitReasonCode: "SESSION_END_ORPHAN",
          fees: totalFees,
          updatedAt: now,
        })
        .where(eq(paperTrades.id, trade.trade_id));
      
      positionsClosed++;
      
      // Update instance state if it exists
      if (trade.instance_id) {
        await db.update(botInstances)
          .set({
            currentPosition: 0,
            unrealizedPnl: 0,
            entryPrice: null,
            positionSide: null,
            stateJson: sql`
              COALESCE(state_json, '{}'::jsonb) || 
              '{"outsideSession": true, "sessionState": "CLOSED", "isSleeping": true, "openPosition": null, "positionOpenedAt": null}'::jsonb
            `,
          })
          .where(eq(botInstances.id, trade.instance_id));
      }
    }
    
    if (positionsClosed > 0) {
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} SESSION_END_COMPLETE closed ${positionsClosed} positions`);
      
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "INFO",
        title: `Session ended - ${positionsClosed} positions closed`,
        summary: `RTH session ended at 4:00 PM ET. All open PAPER+ positions were closed.`,
        payload: { positionsClosed, currentTime: now.toISOString(), etHour: et.hours, etMinute: et.minutes, action: "SESSION_END" },
        traceId,
      });
    }
    
    return { isOutsideSession: true, positionsClosed, isSleeping: true };
  }

  /**
   * Check if we're currently within trading session
   */
  isWithinTradingSession(): boolean {
    const now = new Date();
    const et = getEasternTimeComponents(now);
    const currentMinutes = et.hours * 60 + et.minutes;
    
    // RTH session: 09:30 - 16:00 ET, Monday-Friday only
    const rthStart = 9 * 60 + 30; // 09:30
    const rthEnd = 16 * 60; // 16:00
    const tradingDays = [1, 2, 3, 4, 5]; // Mon-Fri
    
    return tradingDays.includes(et.dayOfWeek) && 
           currentMinutes >= rthStart && 
           currentMinutes <= rthEnd;
  }

  /**
   * CRITICAL: Load any existing open position from database
   * 
   * This prevents duplicate position entries when bot restarts.
   * If a position was opened before restart, we MUST hydrate it
   * so the runner knows not to enter a new position.
   * 
   * RECONCILIATION: If multiple OPEN trades exist (data corruption),
   * we close all but the most recent and log a warning.
   */
  private async loadOpenPositionFromDb(botId: string, traceId: string): Promise<ActivePaperRunner['openPosition']> {
    try {
      // Query ALL open trades to detect and reconcile duplicates
      const result = await db.execute(sql`
        SELECT id, side, entry_price, entry_time, quantity, stop_price, target_price, symbol
        FROM paper_trades
        WHERE bot_id = ${botId}
          AND status = 'OPEN'
        ORDER BY created_at DESC
      `);

      if (result.rows.length === 0) {
        return null;
      }

      // RECONCILIATION: If multiple open trades exist, close all but the most recent
      if (result.rows.length > 1) {
        console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} RECONCILING ${result.rows.length} open trades for bot=${botId.slice(0,8)} - closing ${result.rows.length - 1} orphans`);
        
        const orphanIds = result.rows.slice(1).map((r: any) => r.id);
        await db.execute(sql`
          UPDATE paper_trades
          SET status = 'CLOSED',
              exit_price = entry_price,
              exit_time = NOW(),
              pnl = 0,
              exit_reason_code = 'ORPHAN_RECONCILE'
          WHERE id = ANY(${orphanIds}::uuid[])
        `);
        
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: `Reconciled ${result.rows.length - 1} orphaned open positions`,
          summary: `Bot had multiple OPEN trades - closed orphans, keeping most recent`,
          payload: { botId, orphanCount: result.rows.length - 1, action: "ORPHAN_RECONCILE" },
          traceId,
        });
      }

      const row = result.rows[0] as {
        id: string;
        side: string;
        entry_price: number;
        entry_time: Date;
        quantity: number;
        stop_price: number | null;
        target_price: number | null;
        symbol: string;
      };

      // SAFETY: If stop/target prices are missing, compute sensible defaults
      // based on entry price and standard risk parameters (20 tick stop, 40 tick target)
      const spec = getInstrumentSpec(row.symbol || "MES");
      const defaultStopTicks = 20;
      const defaultTargetTicks = 40;
      
      let stopPrice = row.stop_price;
      let targetPrice = row.target_price;
      
      if (stopPrice === null || stopPrice === 0) {
        // Compute default stop based on side
        if (spec) {
          stopPrice = row.side === "BUY" 
            ? row.entry_price - (defaultStopTicks * spec.tickSize)
            : row.entry_price + (defaultStopTicks * spec.tickSize);
          console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} HYDRATED missing stop_price=${stopPrice.toFixed(2)} for trade=${row.id.slice(0,8)}`);
        } else {
          stopPrice = row.entry_price; // Fallback - will exit on time
        }
      }
      
      if (targetPrice === null || targetPrice === 0) {
        if (spec) {
          targetPrice = row.side === "BUY"
            ? row.entry_price + (defaultTargetTicks * spec.tickSize)
            : row.entry_price - (defaultTargetTicks * spec.tickSize);
          console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} HYDRATED missing target_price=${targetPrice.toFixed(2)} for trade=${row.id.slice(0,8)}`);
        } else {
          targetPrice = row.entry_price; // Fallback - will exit on time
        }
      }

      // Map DB side (BUY/SELL) to runner side (LONG/SHORT)
      const runnerSide: Side = row.side === "BUY" ? "LONG" : "SHORT";

      return {
        tradeId: row.id,
        side: runnerSide,
        entryPrice: row.entry_price,
        entryTime: new Date(row.entry_time),
        quantity: row.quantity,
        stopPrice,
        targetPrice,
      };
    } catch (error) {
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${traceId} Failed to load open position from DB:`, error);
      return null;
    }
  }

  /**
   * INDUSTRY STANDARD: Bootstrap bar buffer from cache
   * 
   * Pre-loads recent historical bars from the institutional bar cache
   * so indicators can be calculated immediately without waiting for
   * live bars to accumulate. This is how professional trading systems work.
   * 
   * CRITICAL: Don't block waiting for cache if live data is streaming.
   * If cache isn't ready immediately, proceed with live-only warmup.
   */
  private async bootstrapFromCache(runner: ActivePaperRunner): Promise<number> {
    const symbol = runner.symbol.toUpperCase();
    
    // Quick check - if cache is ready, use it immediately
    // Don't block waiting for cache - live data should flow without delay
    if (!isCacheReady(symbol)) {
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} cache_not_ready symbol=${symbol} starting_with_live_bars`);
      
      // Record warmup start time for "scanning since" tracking
      await db.update(botInstances)
        .set({ 
          stateJson: {
            warmupStartedAt: new Date().toISOString(),
            barCount: 0,
            barsNeeded: this.MIN_BARS_FOR_SIGNAL,
            warmingUp: true,
            bootstrappedFromCache: false,
          }
        })
        .where(eq(botInstances.id, runner.instanceId));
      
      return 0;
    }

    const cacheEntry = getCacheEntry(symbol);
    if (!cacheEntry || cacheEntry.bars.length === 0) {
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} cache_empty symbol=${symbol} will_warmup_from_live`);
      return 0;
    }

    // Get the most recent bars from cache (need at least MIN_BARS_FOR_SIGNAL + buffer)
    const barsToLoad = Math.min(50, cacheEntry.bars.length);
    const recentBars = cacheEntry.bars.slice(-barsToLoad);

    // Convert DatabentoBar to LiveBar format
    for (const bar of recentBars) {
      runner.barBuffer.push({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        symbol: runner.symbol,
        timeframe: "1m",
      });
    }

    // Initialize indicators immediately since we have enough bars
    // 
    // BOOTSTRAP SEQUENCE (addresses off-by-one bug):
    // 1. slice(0, -1) gives us bars[0..N-2] for initialization (N-1 bars)
    // 2. initializeIndicators() creates indicator state based on these bars
    // 3. updateIndicators() incorporates the LAST cached bar (bar N-1)
    // 4. Result: All N cached bars are reflected in indicator state
    //
    // When first live bar arrives, prevBar = already-incorporated bar N-1, so no gap
    if (runner.barBuffer.length >= this.MIN_BARS_FOR_SIGNAL) {
      const initBars = runner.barBuffer.slice(0, -1); // bars[0..N-2], N-1 total
      runner.indicators = this.initializeIndicators(initBars);
      
      // CRITICAL: Update indicators with last cached bar to fully incorporate all data
      const lastBar = runner.barBuffer[runner.barBuffer.length - 1]; // bar N-1
      const secondLastBar = runner.barBuffer[runner.barBuffer.length - 2]; // bar N-2
      this.updateIndicators(runner.indicators, lastBar, secondLastBar);
      
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} BOOTSTRAP_COMPLETE symbol=${symbol} bars=${runner.barBuffer.length} indicators_ready=true`);
      
      // ARCHITECT RECOMMENDATION: Log indicator snapshot after bootstrap for auditing
      // This helps verify the warmup window matches the cached bar count
      const indicatorSnapshot = {
        ema9: runner.indicators.ema9.toFixed(2),
        ema21: runner.indicators.ema21.toFixed(2),
        sma50: runner.indicators.sma50.toFixed(2),
        vwap: runner.indicators.vwap.toFixed(2),
        rsi: runner.indicators.rsi.toFixed(1),
        atr: runner.indicators.atr.toFixed(2),
        highOfDay: runner.indicators.highOfDay.toFixed(2),
        lowOfDay: runner.indicators.lowOfDay.toFixed(2),
        priceHistoryLen: runner.indicators.priceHistory.length,
      };
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} INDICATOR_SNAPSHOT symbol=${symbol} ${JSON.stringify(indicatorSnapshot)}`);
      
      // REGRESSION GUARD: Verify indicator warmup completed correctly
      // Note: priceHistory is intentionally capped at 20 entries for momentum calculation
      // The key invariant is that we have MIN_BARS_FOR_SIGNAL (21) bars in buffer
      const priceHistoryMax = 20; // hardcoded in initializeIndicators: closes.slice(-20)
      if (runner.indicators.priceHistory.length !== priceHistoryMax) {
        console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} INDICATOR_INIT_WARNING priceHistory=${runner.indicators.priceHistory.length} expected=${priceHistoryMax}`);
      }
      
      // Update stateJson to show we're ready for evaluation
      const bootstrapState = {
        barCount: runner.barBuffer.length,
        barsNeeded: this.MIN_BARS_FOR_SIGNAL,
        warmingUp: false,
        bootstrappedFromCache: true,
        bootstrapTime: new Date().toISOString(),
        lastBarClose: runner.barBuffer[runner.barBuffer.length - 1]?.close,
        lastBarTime: runner.barBuffer[runner.barBuffer.length - 1]?.time.toISOString(),
      };
      
      await db.update(botInstances)
        .set({ stateJson: bootstrapState })
        .where(eq(botInstances.id, runner.instanceId));
    } else {
      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} BOOTSTRAP_PARTIAL symbol=${symbol} bars=${runner.barBuffer.length} need=${this.MIN_BARS_FOR_SIGNAL}`);
    }

    return runner.barBuffer.length;
  }

  private async onNewBar(runner: ActivePaperRunner, bar: LiveBar): Promise<void> {
    runner.barBuffer.push(bar);

    if (runner.barBuffer.length > 100) {
      runner.barBuffer = runner.barBuffer.slice(-100);
    }

    const now = new Date();
    
    // Update heartbeat and warmup status immediately when we receive a bar
    const [current] = await db.select({ stateJson: botInstances.stateJson })
      .from(botInstances)
      .where(eq(botInstances.id, runner.instanceId))
      .limit(1);
    
    const existingState = (current?.stateJson as Record<string, unknown>) || {};
    
    // Track when warmup started (first bar received)
    const warmupStartedAt = existingState.warmupStartedAt || now.toISOString();
    
    const warmupState = {
      ...existingState,
      warmupStartedAt,
      lastHeartbeatAt: now.toISOString(),
      barCount: runner.barBuffer.length,
      barsNeeded: this.MIN_BARS_FOR_SIGNAL,
      warmingUp: runner.barBuffer.length < this.MIN_BARS_FOR_SIGNAL,
      lastBarTime: bar.time.toISOString(),
      lastBarClose: bar.close,
    };
    
    await db.update(botInstances)
      .set({ lastHeartbeatAt: now, stateJson: warmupState })
      .where(eq(botInstances.id, runner.instanceId));

    if (runner.barBuffer.length < this.MIN_BARS_FOR_SIGNAL) {
      // Log warmup progress periodically
      if (runner.barBuffer.length % 5 === 0) {
        console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} WARMING_UP bars=${runner.barBuffer.length}/${this.MIN_BARS_FOR_SIGNAL}`);
      }
      return;
    }
    
    // INSTITUTIONAL SAFETY: Block trading execution when data feed is frozen
    // Runners stay alive to collect bars, but no entry/exit decisions are made
    if (this.isDataFrozen) {
      console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} EXECUTION_BLOCKED data_frozen=true`);
      return;
    }

    const bars = runner.barBuffer;
    const latestIdx = bars.length - 1;
    const latestBar = bars[latestIdx];
    const prevBar = bars[latestIdx - 1];

    // SESSION ENFORCEMENT: Check if we're within trading hours
    // Get session config from bot's strategy rules
    const sessionConfig = runner.strategyConfig?.session;
    const barTime = bar.time;
    
    // Calculate minutes until session end for UI indicator
    let minutesUntilSessionEnd: number | null = null;
    let isNearingSessionEnd = false;
    
    if (sessionConfig?.rthEnd) {
      const et = getEasternTimeComponents(barTime);
      const currentMinutes = et.hours * 60 + et.minutes;
      const [endHour, endMin] = sessionConfig.rthEnd.split(":").map(Number);
      const endMinutes = endHour * 60 + endMin;
      minutesUntilSessionEnd = endMinutes - currentMinutes;
      // Mark as nearing end if within 15 minutes of session close
      isNearingSessionEnd = minutesUntilSessionEnd > 0 && minutesUntilSessionEnd <= 15;
    }
    
    // Check if within trading session
    if (sessionConfig && !isWithinTradingSession(barTime, sessionConfig)) {
      // Outside trading session - close any open position
      if (runner.openPosition) {
        console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} SESSION_END closing position`);
        await this.closePosition(runner, latestBar, "SESSION_END");
      }
      
      // Update state to reflect we're outside session
      await db.update(botInstances)
        .set({ 
          activityState: "IDLE",
          stateJson: {
            ...warmupState,
            outsideSession: true,
            sessionState: "CLOSED",
            lastSessionCheck: barTime.toISOString(),
          }
        })
        .where(eq(botInstances.id, runner.instanceId));
      
      return; // Skip signal evaluation outside session
    }
    
    // Check for no-trade windows (first/last X minutes of session)
    if (sessionConfig?.noTradeWindows && isInNoTradeWindow(barTime, sessionConfig.noTradeWindows)) {
      // In no-trade window - don't enter new positions, but still manage exits
      if (!runner.indicators) {
        runner.indicators = this.initializeIndicators(bars.slice(0, -1));
      } else {
        this.updateIndicators(runner.indicators, latestBar, prevBar);
      }
      
      // Still check exits if we have a position
      if (runner.openPosition) {
        const exitResult = this.checkExit(runner, latestBar);
        if (exitResult) {
          await this.closePosition(runner, latestBar, exitResult.reason);
        }
      }
      
      // Update state to show we're in no-trade window
      await db.update(botInstances)
        .set({ 
          stateJson: {
            ...warmupState,
            inNoTradeWindow: true,
            sessionState: "NO_TRADE_WINDOW",
            minutesUntilSessionEnd,
            isNearingSessionEnd,
          }
        })
        .where(eq(botInstances.id, runner.instanceId));
      
      return; // Skip entry evaluation in no-trade window
    }

    if (!runner.indicators) {
      runner.indicators = this.initializeIndicators(bars.slice(0, -1));
    } else {
      this.updateIndicators(runner.indicators, latestBar, prevBar);
    }

    // Track when we evaluated signals (this is what matters for "is bot able to trade")
    const evaluationTime = new Date();
    
    // Track if we closed a position this bar - if so, don't overwrite scanningSince
    let closedPositionThisBar = false;
    
    if (runner.openPosition) {
      const exitResult = this.checkExit(runner, latestBar);
      if (exitResult) {
        await this.closePosition(runner, latestBar, exitResult.reason);
        closedPositionThisBar = true;
      }
    } else {
      // CRITICAL: Check if trading should be frozen due to unavailable/stale marks
      const freezeCheck = await priceAuthority.shouldFreezeTrading(runner.symbol, "1m");
      if (freezeCheck.frozen) {
        // Trading is frozen - log and skip entry evaluation
        console.log(`[PAPER_RUNNER_SERVICE] Trading FROZEN for ${runner.symbol}: ${freezeCheck.reason}`);
        
        // INSTITUTIONAL AUDIT: Persist trading freeze decision for compliance
        await priceAuthority.persistFreshnessAudit(runner.botId, runner.symbol, freezeCheck.mark, {
          action: "trading_freeze",
          displayAllowed: false,
          userId: runner.userId || undefined,
          traceId: runner.traceId,
        }).catch(err => console.error(`[PAPER_RUNNER_SERVICE] Audit log failed:`, err));
        
        // Notify user on first freeze detection (cooldown handled in priceAuthority)
        if (runner.userId) {
          await priceAuthority.notifyTradingFrozen(
            runner.userId,
            runner.botId,
            runner.botName || runner.botId.slice(0, 8),
            runner.symbol,
            freezeCheck.reason
          ).catch(err => console.error(`[PAPER_RUNNER_SERVICE] Failed to notify trading freeze:`, err));
        }
        
        // Update instance state to reflect frozen trading (use SCANNING for enum, store frozen in stateJson)
        await db.update(botInstances)
          .set({
            activityState: "SCANNING",
            stateJson: {
              ...warmupState,
              dataFrozen: true,
              tradingFrozen: true,
              tradingFrozenReason: freezeCheck.reason,
              tradingFrozenAt: new Date().toISOString(),
              dataSource: freezeCheck.mark.source,
              markStatus: freezeCheck.mark.status,
            }
          })
          .where(eq(botInstances.id, runner.instanceId))
          .catch(err => console.error(`[PAPER_RUNNER_SERVICE] Failed to update frozen state:`, err));
        
        // Broadcast DATA_FROZEN state to UI so user sees "Scanning for data" instead of stale info
        // Note: No open position at this point (we're in the else branch)
        livePnLWebSocket.broadcastLivePnL({
          botId: runner.botId,
          unrealizedPnl: null,
          currentPrice: null,
          entryPrice: null,
          side: null,
          livePositionActive: false,
          markTimestamp: undefined,
          markFresh: false,
          sessionState: 'ACTIVE',
          isSleeping: false,
          runnerState: 'DATA_FROZEN',
          activityState: 'SCANNING', // Valid enum but runnerState tells UI about freeze
        });
        
        // Don't evaluate entry signals when trading is frozen
      } else {
        const entrySignal = this.checkEntry(runner, latestBar);
        if (entrySignal) {
          await this.openPosition(runner, latestBar, entrySignal);
        }
      }
    }
    
    // Update session state in stateJson for UI indicators
    const sessionStateUpdate = {
      outsideSession: false,
      inNoTradeWindow: false,
      sessionState: "ACTIVE",
      minutesUntilSessionEnd,
      isNearingSessionEnd,
    };
    
    // Broadcast real-time LIVE P&L update via WebSocket for open positions
    // Also persist unrealized P&L AND current mark price to database for:
    // 1. Recovery across restarts
    // 2. REST API parity with WebSocket (prevents stale REST data from overwriting fresh WS data)
    // INSTITUTIONAL: Only broadcast P&L if mark is FRESH - ZERO tolerance for stale data display
    if (runner.openPosition) {
      const markResult = await priceAuthority.getMark(runner.symbol, "1m");
      // ZERO TOLERANCE: Only allow display when mark is genuinely FRESH - never stale
      const displayAllowed = markResult.isFresh && markResult.status === "FRESH";
      
      // Audit this P&L display decision
      await priceAuthority.persistFreshnessAudit(runner.botId, runner.symbol, markResult, {
        action: "pnl_display",
        displayAllowed,
        userId: runner.userId || undefined,
        traceId: runner.traceId,
      }).catch(err => console.error(`[PAPER_RUNNER_SERVICE] P&L audit log failed:`, err));
      
      if (displayAllowed && markResult.price !== null) {
        const unrealizedPnl = priceAuthority.computePnL(
          runner.openPosition.entryPrice,
          markResult.price,
          runner.openPosition.side,
          runner.openPosition.quantity
        );
        
        livePnLWebSocket.broadcastLivePnL({
          botId: runner.botId,
          unrealizedPnl,
          currentPrice: markResult.price,
          entryPrice: runner.openPosition.entryPrice,
          side: runner.openPosition.side,
          livePositionActive: true,
          markTimestamp: markResult.timestamp?.getTime(),
          markFresh: markResult.isFresh,
        });
        
        // CRITICAL: Persist unrealized P&L to bot_instances for quick lookups
        db.update(botInstances)
          .set({ 
            unrealizedPnl,
            updatedAt: new Date(),
          })
          .where(eq(botInstances.id, runner.instanceId))
          .catch(err => console.error(`[PAPER_RUNNER_SERVICE] Failed to persist unrealized P&L to instance:`, err));
      } else {
        // Mark unavailable/stale - broadcast DATA_FROZEN state to indicate data issue
        // Keep position info visible but show we're waiting for fresh data
        livePnLWebSocket.broadcastLivePnL({
          botId: runner.botId,
          unrealizedPnl: null, // Clear P&L since we can't compute fresh value
          currentPrice: null,
          entryPrice: runner.openPosition.entryPrice,
          side: runner.openPosition.side,
          positionQuantity: runner.openPosition.quantity,
          positionSide: runner.openPosition.side,
          stopPrice: runner.openPosition.stopPrice,
          targetPrice: runner.openPosition.targetPrice,
          positionOpenedAt: runner.openPosition.entryTime.toISOString(),
          livePositionActive: true, // Position is still open
          markTimestamp: undefined,
          markFresh: false,
          sessionState: 'ACTIVE',
          isSleeping: false,
          runnerState: 'DATA_FROZEN', // UI shows "Scanning for data..."
          activityState: 'IN_TRADE',
        });
        
        console.warn(`[PAPER_RUNNER_SERVICE] DATA_FROZEN bot=${runner.botId.slice(0, 8)} - mark is ${markResult.status}/${markResult.source}`);
      }
    }
    
    // Update lastEvaluationAt in stateJson to track active signal checking
    // CRITICAL: If we just closed a position, closePosition already set fresh scanningSince
    // We need to re-read from DB to avoid overwriting it with stale warmupState
    if (closedPositionThisBar) {
      // Re-read the fresh state that closePosition just wrote
      const [freshState] = await db.select({ stateJson: botInstances.stateJson })
        .from(botInstances)
        .where(eq(botInstances.id, runner.instanceId))
        .limit(1);
      
      const freshStateJson = (freshState?.stateJson as Record<string, unknown>) || {};
      
      const evaluationState = {
        ...freshStateJson,
        ...sessionStateUpdate,
        lastEvaluationAt: evaluationTime.toISOString(),
        lastBarClose: latestBar.close,
        lastBarTime: latestBar.time.toISOString(),
        warmingUp: false,
      };
      
      await db.update(botInstances)
        .set({ stateJson: evaluationState })
        .where(eq(botInstances.id, runner.instanceId));
    } else {
      // No position change - use the warmupState we already have
      const evaluationState = {
        ...warmupState,
        ...sessionStateUpdate,
        lastEvaluationAt: evaluationTime.toISOString(),
        lastBarClose: latestBar.close,
        lastBarTime: latestBar.time.toISOString(),
        warmingUp: false,
      };
      
      await db.update(botInstances)
        .set({ stateJson: evaluationState })
        .where(eq(botInstances.id, runner.instanceId));
    }
  }

  private initializeIndicators(bars: LiveBar[]): IndicatorState {
    const closes = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    
    return {
      ema9: this.calculateEMA(closes, 9),
      ema20: this.calculateEMA(closes, 20),
      ema21: this.calculateEMA(closes, 21),
      sma50: closes.reduce((a, b) => a + b, 0) / closes.length,
      vwap: closes[closes.length - 1],
      vwapSum: closes.reduce((sum, c, i) => sum + c * volumes[i], 0),
      volumeSum: volumes.reduce((a, b) => a + b, 0),
      rsi: 50,
      rsiGain: 0,
      rsiLoss: 0,
      atr: this.calculateATR(bars),
      atrValues: [],
      momentum: 0,
      highOfDay: Math.max(...bars.map(b => b.high)),
      lowOfDay: Math.min(...bars.map(b => b.low)),
      openOfDay: bars[0].open,
      avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
      volumeHistory: volumes.slice(-20),
      priceHistory: closes.slice(-20),
    };
  }

  private updateIndicators(indicators: IndicatorState, bar: LiveBar, prevBar: LiveBar): void {
    const ema9Mult = 2 / (9 + 1);
    const ema20Mult = 2 / (20 + 1);
    const ema21Mult = 2 / (21 + 1);
    
    indicators.ema9 = bar.close * ema9Mult + indicators.ema9 * (1 - ema9Mult);
    indicators.ema20 = bar.close * ema20Mult + indicators.ema20 * (1 - ema20Mult);
    indicators.ema21 = bar.close * ema21Mult + indicators.ema21 * (1 - ema21Mult);
    
    indicators.vwapSum += bar.close * bar.volume;
    indicators.volumeSum += bar.volume;
    indicators.vwap = indicators.volumeSum > 0 ? indicators.vwapSum / indicators.volumeSum : bar.close;
    
    const change = bar.close - prevBar.close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    const rsiMult = 1 / 14;
    
    indicators.rsiGain = gain * rsiMult + indicators.rsiGain * (1 - rsiMult);
    indicators.rsiLoss = loss * rsiMult + indicators.rsiLoss * (1 - rsiMult);
    
    if (indicators.rsiLoss > 0) {
      const rs = indicators.rsiGain / indicators.rsiLoss;
      indicators.rsi = 100 - (100 / (1 + rs));
    }
    
    const tr = Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prevBar.close),
      Math.abs(bar.low - prevBar.close)
    );
    indicators.atrValues.push(tr);
    if (indicators.atrValues.length > 14) {
      indicators.atrValues.shift();
    }
    indicators.atr = indicators.atrValues.reduce((a, b) => a + b, 0) / indicators.atrValues.length;
    
    indicators.priceHistory.push(bar.close);
    if (indicators.priceHistory.length > 20) {
      indicators.priceHistory.shift();
    }
    if (indicators.priceHistory.length >= 10) {
      indicators.momentum = bar.close - indicators.priceHistory[indicators.priceHistory.length - 10];
    }
    
    indicators.highOfDay = Math.max(indicators.highOfDay, bar.high);
    indicators.lowOfDay = Math.min(indicators.lowOfDay, bar.low);
    
    indicators.volumeHistory.push(bar.volume);
    if (indicators.volumeHistory.length > 20) {
      indicators.volumeHistory.shift();
    }
    indicators.avgVolume = indicators.volumeHistory.reduce((a, b) => a + b, 0) / indicators.volumeHistory.length;
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
  }

  private calculateATR(bars: LiveBar[]): number {
    if (bars.length < 2) return 1;
    let atr = 0;
    for (let i = 1; i < Math.min(bars.length, 15); i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i-1].close),
        Math.abs(bars[i].low - bars[i-1].close)
      );
      atr += tr;
    }
    return atr / Math.min(bars.length - 1, 14);
  }

  /**
   * Derive entry condition type from strategy config.
   * Falls back to strategy type name if explicit entry.condition is not set.
   */
  private deriveEntryConditionType(config: StrategyRules): string | null {
    // First check explicit entry condition
    if (config?.entry?.condition?.type) {
      return config.entry.condition.type;
    }
    
    // Check top-level entryConditionType
    if ((config as any)?.entryConditionType) {
      return (config as any).entryConditionType;
    }
    
    // Derive from strategy type name
    const strategyType = ((config as any)?.type || "").toLowerCase();
    
    if (strategyType.includes("mean") || strategyType.includes("reversion") || strategyType.includes("fade") || strategyType.includes("exhaustion")) {
      return "MEAN_REVERSION";
    }
    if (strategyType.includes("trend") || strategyType.includes("momentum") || strategyType.includes("surge")) {
      return "TREND_CONTINUATION";
    }
    if (strategyType.includes("vwap") || strategyType.includes("bias")) {
      return "VWAP_TOUCH";
    }
    if (strategyType.includes("breakout") || strategyType.includes("orb") || strategyType.includes("range")) {
      return "BREAKOUT";
    }
    if (strategyType.includes("scalp") || strategyType.includes("micro") || strategyType.includes("pullback")) {
      return "MOMENTUM_SURGE";
    }
    
    // Default fallback for unknown types
    return "TREND_CONTINUATION";
  }

  /**
   * INSTITUTIONAL STANDARD: Extract bot-specific threshold parameters
   * 
   * Each bot MUST have unique threshold parameters to ensure strategy isolation.
   * Uses cryptographic SHA-256 hash of botId to create deterministic but 
   * collision-resistant parameter variations that are ALWAYS applied.
   * 
   * CRITICAL: The bot-specific variation is ALWAYS added to base thresholds,
   * even when explicit parameters are provided in strategyConfig. This guarantees
   * that two bots with identical configs will still have different thresholds.
   * 
   * ENTROPY: SHA-256 provides 256 bits of entropy, with 32-bit slices per threshold.
   * This yields 4.3 billion unique values per parameter with cryptographic collision
   * resistance. Birthday bound: need ~65k bots for 50% chance of ANY single collision.
   */
  private getBotSpecificThresholds(runner: ActivePaperRunner): {
    rsiOversold: number;
    rsiOverbought: number;
    deviationThreshold: number;
    momentumMultiplier: number;
    vwapDistanceThreshold: number;
  } {
    const config = runner.strategyConfig;
    
    // Use cached thresholds if available
    if (this.botThresholdCache.has(runner.botId)) {
      const cached = this.botThresholdCache.get(runner.botId)!;
      // Apply to current config (config may change between calls)
      const baseRsiOversold = (config as any)?.entry?.rsiOversold ?? 30;
      const baseRsiOverbought = (config as any)?.entry?.rsiOverbought ?? 70;
      const baseDeviationThreshold = (config as any)?.entry?.deviationThreshold ?? 1.0;
      const baseMomentumMultiplier = (config as any)?.entry?.momentumMultiplier ?? 2.0;
      const baseVwapDistanceThreshold = (config as any)?.entry?.vwapDistanceThreshold ?? 0.5;
      
      return {
        rsiOversold: Math.max(20, Math.min(40, baseRsiOversold + cached.var1)),
        rsiOverbought: Math.max(60, Math.min(80, baseRsiOverbought - cached.var2)),
        deviationThreshold: Math.max(0.5, Math.min(2.0, baseDeviationThreshold + cached.var3)),
        momentumMultiplier: Math.max(1.0, Math.min(4.0, baseMomentumMultiplier + cached.var4)),
        vwapDistanceThreshold: Math.max(0.2, Math.min(1.0, baseVwapDistanceThreshold + cached.var5)),
      };
    }
    
    // CRYPTOGRAPHIC HASH: Use SHA-256 for collision-resistant entropy
    // SHA-256 produces 256 bits (64 hex chars), far more than UUID's 128 bits
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(runner.botId).digest('hex');
    
    // Extract 5 independent 32-bit (8-char) segments from the 64-char hash
    // Each 32-bit segment provides ~4.3 billion unique values
    const seg1 = parseInt(hash.slice(0, 8), 16);   // chars 0-7 for RSI oversold
    const seg2 = parseInt(hash.slice(8, 16), 16);  // chars 8-15 for RSI overbought
    const seg3 = parseInt(hash.slice(16, 24), 16); // chars 16-23 for deviation
    const seg4 = parseInt(hash.slice(24, 32), 16); // chars 24-31 for momentum
    const seg5 = parseInt(hash.slice(32, 40), 16); // chars 32-39 for VWAP
    
    // Convert to floating point variations within trading-reasonable ranges
    // Each segment normalized to [0, 1) then scaled to appropriate range
    const var1 = (seg1 / 0xFFFFFFFF) * 10 - 5; // -5 to +5 for RSI oversold
    const var2 = (seg2 / 0xFFFFFFFF) * 10 - 5; // -5 to +5 for RSI overbought
    const var3 = (seg3 / 0xFFFFFFFF) * 0.5 - 0.25; // -0.25 to +0.25 for deviation
    const var4 = (seg4 / 0xFFFFFFFF) * 1.0 - 0.5; // -0.5 to +0.5 for momentum
    const var5 = (seg5 / 0xFFFFFFFF) * 0.2 - 0.1; // -0.1 to +0.1 for VWAP
    
    // Cache the variations (hash is deterministic so these never change)
    this.botThresholdCache.set(runner.botId, { var1, var2, var3, var4, var5 });
    
    // Read base values from strategy config (or use defaults)
    const baseRsiOversold = (config as any)?.entry?.rsiOversold ?? 30;
    const baseRsiOverbought = (config as any)?.entry?.rsiOverbought ?? 70;
    const baseDeviationThreshold = (config as any)?.entry?.deviationThreshold ?? 1.0;
    const baseMomentumMultiplier = (config as any)?.entry?.momentumMultiplier ?? 2.0;
    const baseVwapDistanceThreshold = (config as any)?.entry?.vwapDistanceThreshold ?? 0.5;
    
    // CRITICAL: ALWAYS apply bot-specific variation to base values
    // This ensures even identical configs produce different signals per bot
    const rsiOversold = baseRsiOversold + var1;
    const rsiOverbought = baseRsiOverbought - var2;
    const deviationThreshold = baseDeviationThreshold + var3;
    const momentumMultiplier = baseMomentumMultiplier + var4;
    const vwapDistanceThreshold = baseVwapDistanceThreshold + var5;
    
    return {
      rsiOversold: Math.max(20, Math.min(40, rsiOversold)),
      rsiOverbought: Math.max(60, Math.min(80, rsiOverbought)),
      deviationThreshold: Math.max(0.5, Math.min(2.0, deviationThreshold)),
      momentumMultiplier: Math.max(1.0, Math.min(4.0, momentumMultiplier)),
      vwapDistanceThreshold: Math.max(0.2, Math.min(1.0, vwapDistanceThreshold)),
    };
  }

  private checkEntry(
    runner: ActivePaperRunner, 
    bar: LiveBar
  ): { side: Side; stopPrice: number; targetPrice: number; reasonCode: string } | null {
    const config = runner.strategyConfig;
    const indicators = runner.indicators;
    
    if (!indicators) {
      console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} SKIP_ENTRY reason=no_indicators`);
      return null;
    }
    
    // Derive condition type from config
    const conditionType = this.deriveEntryConditionType(config);
    if (!conditionType) {
      console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} SKIP_ENTRY reason=no_condition_type`);
      return null;
    }

    const close = bar.close;
    
    // INSTITUTIONAL CRITICAL: Get BOT-SPECIFIC thresholds to ensure unique signals per bot
    // This prevents the duplicate trades bug where all bots using same hardcoded thresholds
    // would generate identical signals from the same market data
    const thresholds = this.getBotSpecificThresholds(runner);
    
    let side: Side | null = null;
    let reasonCode = "";

    switch (conditionType) {
      case "MEAN_REVERSION":
        const deviation = Math.abs(close - indicators.vwap) / indicators.atr;
        // Use bot-specific RSI and deviation thresholds
        if (indicators.rsi < thresholds.rsiOversold && deviation > thresholds.deviationThreshold && close < indicators.vwap) {
          side = "LONG";
          reasonCode = "ENTRY_RSI_OVERSOLD";
        } else if (indicators.rsi > thresholds.rsiOverbought && deviation > thresholds.deviationThreshold && close > indicators.vwap) {
          side = "SHORT";
          reasonCode = "ENTRY_RSI_OVERBOUGHT";
        }
        break;
        
      case "TREND_CONTINUATION":
        // Use bot-specific momentum threshold
        if (indicators.ema9 > indicators.ema21 && indicators.momentum > (indicators.atr * (thresholds.momentumMultiplier * 0.1))) {
          side = "LONG";
          reasonCode = "ENTRY_EMA_CROSSOVER_UP";
        } else if (indicators.ema9 < indicators.ema21 && indicators.momentum < -(indicators.atr * (thresholds.momentumMultiplier * 0.1))) {
          side = "SHORT";
          reasonCode = "ENTRY_EMA_CROSSUNDER_DOWN";
        }
        break;
        
      case "VWAP_TOUCH":
        // Use bot-specific VWAP distance threshold
        const vwapDist = Math.abs(close - indicators.vwap) / indicators.atr;
        if (vwapDist < thresholds.vwapDistanceThreshold && close > indicators.vwap) {
          side = "LONG";
          reasonCode = "ENTRY_VWAP_BOUNCE_LONG";
        } else if (vwapDist < thresholds.vwapDistanceThreshold && close < indicators.vwap) {
          side = "SHORT";
          reasonCode = "ENTRY_VWAP_BOUNCE_SHORT";
        }
        break;
        
      case "MOMENTUM_SURGE":
        // Use bot-specific momentum multiplier
        if (indicators.momentum > indicators.atr * thresholds.momentumMultiplier) {
          side = "LONG";
          reasonCode = "ENTRY_MOMENTUM_LONG";
        } else if (indicators.momentum < -indicators.atr * thresholds.momentumMultiplier) {
          side = "SHORT";
          reasonCode = "ENTRY_MOMENTUM_SHORT";
        }
        break;
        
      case "BREAKOUT":
        // Use bot-specific momentum threshold for confirmation
        const breakoutMomentum = indicators.atr * (thresholds.momentumMultiplier * 0.5);
        if (close > indicators.highOfDay && indicators.momentum > breakoutMomentum) {
          side = "LONG";
          reasonCode = "ENTRY_BREAKOUT_HIGH";
        } else if (close < indicators.lowOfDay && indicators.momentum < -breakoutMomentum) {
          side = "SHORT";
          reasonCode = "ENTRY_BREAKOUT_LOW";
        }
        break;
    }

    if (!side) {
      // Log periodic diagnostic info (every 10 bars to avoid log spam)
      if (runner.barBuffer.length % 10 === 0) {
        console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} NO_SIGNAL type=${conditionType} thresholds=${JSON.stringify(thresholds)} close=${close.toFixed(2)} rsi=${indicators.rsi.toFixed(1)} ema9=${indicators.ema9.toFixed(2)} ema21=${indicators.ema21.toFixed(2)} vwap=${indicators.vwap.toFixed(2)} atr=${indicators.atr.toFixed(2)} momentum=${indicators.momentum.toFixed(2)}`);
      }
      return null;
    }

    console.log(`[PAPER_RUNNER] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} SIGNAL_FOUND side=${side} reason=${reasonCode} thresholds=${JSON.stringify(thresholds)}`);

    const spec = getInstrumentSpec(runner.symbol);
    if (!spec) return null;
    
    const stopTicks = config.exit?.stopLoss?.[0]?.ticks || 20;
    const targetTicks = config.exit?.takeProfit?.[0]?.ticks || 40;

    const stopPrice = side === "LONG" 
      ? close - (stopTicks * spec.tickSize)
      : close + (stopTicks * spec.tickSize);
    
    const targetPrice = side === "LONG"
      ? close + (targetTicks * spec.tickSize)
      : close - (targetTicks * spec.tickSize);

    return { side, stopPrice, targetPrice, reasonCode };
  }

  private checkExit(
    runner: ActivePaperRunner,
    bar: LiveBar
  ): { reason: string } | null {
    const pos = runner.openPosition!;
    const close = bar.close;

    if (pos.side === "LONG") {
      if (close <= pos.stopPrice) return { reason: "EXIT_SL" };
      if (close >= pos.targetPrice) return { reason: "EXIT_TP" };
    } else {
      if (close >= pos.stopPrice) return { reason: "EXIT_SL" };
      if (close <= pos.targetPrice) return { reason: "EXIT_TP" };
    }

    const holdMinutes = (bar.time.getTime() - pos.entryTime.getTime()) / 60000;
    if (holdMinutes > 60) {
      return { reason: "EXIT_TIME" };
    }

    return null;
  }

  private async openPosition(
    runner: ActivePaperRunner,
    bar: LiveBar,
    signal: { side: Side; stopPrice: number; targetPrice: number; reasonCode: string }
  ): Promise<void> {
    const spec = getInstrumentSpec(runner.symbol);
    if (!spec) return;
    
    const slippage = this.DEFAULT_SLIPPAGE_TICKS * spec.tickSize;
    
    const entryPrice = signal.side === "LONG" 
      ? bar.close + slippage 
      : bar.close - slippage;

    const quantity = 1;
    const dbSide = signal.side === "LONG" ? "BUY" : "SELL";

    try {
      // INSTITUTIONAL GUARDRAIL: Duplicate trade detection
      // Check if ANY bot has recently opened a trade with identical parameters within the same minute
      // This prevents the duplicate trades bug from ever recurring
      const duplicateCheck = await db.execute(sql`
        SELECT COUNT(*) as count 
        FROM paper_trades 
        WHERE symbol = ${runner.symbol}
          AND entry_time = ${bar.time}
          AND entry_price = ${entryPrice}
          AND side = ${dbSide}
          AND bot_id != ${runner.botId}
          AND status = 'OPEN'
      `);
      
      const duplicateCount = parseInt((duplicateCheck.rows[0] as any).count || '0', 10);
      if (duplicateCount > 0) {
        console.warn(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} DUPLICATE_TRADE_BLOCKED - ${duplicateCount} identical trades already exist at ${bar.time.toISOString()} price=${entryPrice.toFixed(2)} side=${dbSide}`);
        
        await logActivityEvent({
          eventType: "ORDER_BLOCKED_RISK",
          severity: "WARN",
          title: "Duplicate Trade Prevented",
          summary: `Bot ${runner.botId.slice(0,8)} attempted to open identical trade that ${duplicateCount} other bot(s) already opened`,
          payload: {
            botId: runner.botId,
            symbol: runner.symbol,
            side: dbSide,
            entryPrice,
            entryTime: bar.time.toISOString(),
            duplicateCount,
            reason: "DUPLICATE_TRADE_GUARDRAIL",
          },
          traceId: runner.traceId,
        });
        
        return; // Don't open duplicate trade
      }
      
      // Look up the current ACTIVE account attempt for proper trade scoping
      let accountAttemptId: string | null = null;
      if (runner.accountId) {
        const attemptResult = await db.execute(sql`
          SELECT id FROM account_attempts 
          WHERE account_id = ${runner.accountId}::uuid AND status = 'ACTIVE'
          ORDER BY attempt_number DESC LIMIT 1
        `);
        if (attemptResult.rows.length > 0) {
          accountAttemptId = (attemptResult.rows[0] as any).id;
        }
      }

      const [trade] = await db.insert(paperTrades).values({
        botId: runner.botId,
        botInstanceId: runner.instanceId,
        accountId: runner.accountId,
        accountAttemptId: accountAttemptId,
        symbol: runner.symbol,
        side: dbSide,
        quantity,
        entryPrice: entryPrice,
        entryTime: bar.time,
        stopPrice: signal.stopPrice,
        targetPrice: signal.targetPrice,
        status: "OPEN",
        entryReasonCode: signal.reasonCode,
        entryBarTime: bar.time,
        fees: this.DEFAULT_FEES_PER_SIDE,
        slippage: slippage,
      }).returning();

      runner.openPosition = {
        side: signal.side,
        entryPrice,
        entryTime: bar.time,
        quantity,
        stopPrice: signal.stopPrice,
        targetPrice: signal.targetPrice,
        tradeId: trade.id,
      };

      // CRITICAL FIX: Update both activityState AND stateJson with position data
      // This ensures UI immediately reflects the open position (not stale "Scanning" timer)
      // Also persist position data for recovery across restarts
      const now = new Date();
      await db.update(botInstances)
        .set({ 
          activityState: "IN_TRADE",
          lastHeartbeatAt: now,
          currentPosition: quantity,
          unrealizedPnl: 0,
          entryPrice: entryPrice,
          positionSide: signal.side,
          stateJson: {
            lastTradeAt: now.toISOString(),
            openPosition: {
              side: signal.side,
              quantity,
              entryPrice,
              stopPrice: signal.stopPrice,
              targetPrice: signal.targetPrice,
              entryReasonCode: signal.reasonCode,
              openedAt: bar.time.toISOString(),
            },
          },
        })
        .where(eq(botInstances.id, runner.instanceId));

      // IMMEDIATE BROADCAST: Push position update via WebSocket (don't wait for next bar)
      livePnLWebSocket.broadcastLivePnL({
        botId: runner.botId,
        unrealizedPnl: 0,
        currentPrice: entryPrice,
        entryPrice: entryPrice,
        side: signal.side,
        livePositionActive: true, // INSTITUTIONAL: Explicit flag = position is active
      });

      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} OPENED ${signal.side} @ ${entryPrice.toFixed(2)} reason=${signal.reasonCode}`);

      await logActivityEvent({
        eventType: "TRADE_EXECUTED",
        severity: "INFO",
        title: `Paper ${signal.side} opened @ ${entryPrice.toFixed(2)}`,
        summary: `${runner.symbol} ${signal.side} x${quantity}, SL=${signal.stopPrice.toFixed(2)}, TP=${signal.targetPrice.toFixed(2)}`,
        payload: { 
          botId: runner.botId, 
          tradeId: trade.id,
          side: signal.side,
          entryPrice,
          reasonCode: signal.reasonCode,
          mode: "PAPER",
        },
        traceId: runner.traceId,
      });

    } catch (error) {
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} Failed to open position:`, error);
    }
  }

  private async closePosition(
    runner: ActivePaperRunner,
    bar: LiveBar,
    exitReason: string
  ): Promise<void> {
    const pos = runner.openPosition!;
    const spec = getInstrumentSpec(runner.symbol);
    if (!spec) return;
    
    const slippage = this.DEFAULT_SLIPPAGE_TICKS * spec.tickSize;
    
    const exitPrice = pos.side === "LONG" 
      ? bar.close - slippage 
      : bar.close + slippage;

    const tradeSide = pos.side === "LONG" ? "BUY" : "SELL" as "BUY" | "SELL";
    const pnlResult = calculateTradePnL(
      pos.entryPrice,
      exitPrice,
      pos.quantity,
      tradeSide,
      spec
    );

    const totalFees = this.DEFAULT_FEES_PER_SIDE * 2;
    const netPnl = pnlResult.netPnl - totalFees;

    try {
      await db.update(paperTrades)
        .set({
          exitPrice: exitPrice,
          exitTime: bar.time,
          pnl: netPnl,
          pnlPercent: (netPnl / (pos.entryPrice * pos.quantity * spec.pointValue)) * 100,
          status: "CLOSED",
          exitReasonCode: exitReason,
          exitBarTime: bar.time,
          fees: totalFees,
          updatedAt: new Date(),
        })
        .where(eq(paperTrades.id, pos.tradeId));

      await this.updateBotPaperMetrics(runner.botId);

      // Update per-bot account P&L tracking for dynamic balance calculation
      if (runner.accountId) {
        try {
          await storage.upsertBotAccountPnl(runner.botId, runner.accountId, {
            realizedPnl: pnlResult.netPnl,
            fees: totalFees,
            isWin: netPnl > 0,
          });

          // Check if account is blown (balance hit $0)
          const blownCheck = await storage.checkAndHandleBlownAccount(runner.accountId);
          if (blownCheck.isBlown) {
            const accountId = runner.accountId;
            console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} ACCOUNT BLOWN: account=${accountId.slice(0,8)} - isolating bot-account pair`);
            
            await logActivityEvent({
              eventType: "RUNNER_STOPPED",
              severity: "CRITICAL",
              title: `Account Blown - Balance Depleted`,
              summary: `Account ${accountId.slice(0,8)} has hit $0. Runner stopped for recovery.`,
              payload: { 
                botId: runner.botId, 
                accountId: accountId,
                attemptNumber: blownCheck.attempt?.attemptNumber,
                blownReason: blownCheck.attempt?.blownReason,
                blownAccountRecovery: true,
              },
              traceId: runner.traceId,
            });

            // Account-scoped shutdown: remove this specific runner from active tracking
            // This allows other bots/accounts to continue operating
            this.activeRunners.delete(runner.botId);
            runner.unsubscribe();
            
            // Mark the instance as stopped in the database
            await db.update(botInstances)
              .set({ 
                status: "STOPPED",
                stoppedAt: new Date(),
                stateJson: {
                  blownAccount: true,
                  blownAt: new Date().toISOString(),
                  attemptNumber: blownCheck.attempt?.attemptNumber,
                  awaitingRecovery: true,
                },
              })
              .where(eq(botInstances.id, runner.instanceId));
          }
        } catch (pnlError) {
          console.error(`[PAPER_RUNNER_SERVICE] Failed to update bot account P&L:`, pnlError);
        }
      }

      // CRITICAL FIX: Reset scanningSince timer when closing a trade
      // This ensures the "Scanning for trade" UI timer starts fresh after each trade
      // Also clear persisted position data for clean restart
      const now = new Date();
      await db.update(botInstances)
        .set({ 
          activityState: "SCANNING",
          lastHeartbeatAt: now,
          currentPosition: 0,
          unrealizedPnl: 0,
          entryPrice: null,
          positionSide: null,
          stateJson: {
            scanningSince: now.toISOString(),
            lastTradeClosedAt: now.toISOString(),
            lastTradeResult: netPnl >= 0 ? "WIN" : "LOSS",
            lastTradePnl: netPnl,
            openPosition: null, // Clear position data
          },
        })
        .where(eq(botInstances.id, runner.instanceId));

      console.log(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} bot=${runner.botId.slice(0,8)} CLOSED ${pos.side} @ ${exitPrice.toFixed(2)} PnL=${netPnl.toFixed(2)} reason=${exitReason}`);

      await logActivityEvent({
        eventType: "TRADE_EXITED",
        severity: netPnl >= 0 ? "INFO" : "WARN",
        title: `Paper ${pos.side} closed @ ${exitPrice.toFixed(2)} (${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)})`,
        summary: `${runner.symbol} ${pos.side} x${pos.quantity}, Entry=${pos.entryPrice.toFixed(2)}, Exit=${exitPrice.toFixed(2)}, ${exitReason}`,
        payload: { 
          botId: runner.botId, 
          tradeId: pos.tradeId,
          side: pos.side,
          entryPrice: pos.entryPrice,
          exitPrice,
          pnl: netPnl,
          exitReason,
          mode: "PAPER",
        },
        traceId: runner.traceId,
      });

      runner.openPosition = null;

    } catch (error) {
      console.error(`[PAPER_RUNNER_SERVICE] trace_id=${runner.traceId} Failed to close position:`, error);
    }
  }

  private async updateBotPaperMetrics(botId: string): Promise<void> {
    try {
      // CRITICAL: Exclude ORPHAN_RECONCILE trades - these are cleanup closures, not real trades
      const result = await db.execute(sql`
        SELECT 
          COUNT(*) as total_trades,
          SUM(CASE WHEN CAST(pnl AS NUMERIC) > 0 THEN 1 ELSE 0 END) as winners,
          SUM(COALESCE(CAST(pnl AS NUMERIC), 0)) as total_pnl
        FROM paper_trades
        WHERE bot_id = ${botId}::uuid 
          AND status = 'CLOSED'
          AND (exit_reason_code IS NULL OR exit_reason_code != 'ORPHAN_RECONCILE')
      `);

      const stats = result.rows[0] as { total_trades: string; winners: string; total_pnl: string };
      const totalTrades = Number(stats?.total_trades || 0);
      const winners = Number(stats?.winners || 0);
      const totalPnl = Number(stats?.total_pnl || 0);
      const winRate = totalTrades > 0 ? winners / totalTrades : 0;

      await db.update(bots)
        .set({
          livePnl: totalPnl,
          liveTotalTrades: totalTrades,
          liveWinRate: winRate,
          lastTradeAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bots.id, botId));

    } catch (error) {
      console.error(`[PAPER_RUNNER_SERVICE] Failed to update metrics for bot ${botId}:`, error);
    }
  }

  getActiveRunnerCount(): number {
    return this.activeRunners.size;
  }

  getStatus(): { isRunning: boolean; activeCount: number; activeRunners: string[] } {
    return {
      isRunning: this.isRunning,
      activeCount: this.activeRunners.size,
      activeRunners: Array.from(this.activeRunners.keys()),
    };
  }

  getRunnerStatus(botId: string): { running: boolean; hasPosition: boolean; barCount: number } | null {
    const runner = this.activeRunners.get(botId);
    if (!runner) return null;
    
    return {
      running: true,
      hasPosition: runner.openPosition !== null,
      barCount: runner.barBuffer.length,
    };
  }

  isRunnerActive(botId: string): boolean {
    return this.activeRunners.has(botId);
  }

  /**
   * Calculate unrealized PnL for a bot's open position using current market price.
   * Returns null if no open position.
   */
  getUnrealizedPnL(botId: string): { unrealizedPnl: number; currentPrice: number; side: Side; entryPrice: number } | null {
    const runner = this.activeRunners.get(botId);
    if (!runner || !runner.openPosition) return null;

    const pos = runner.openPosition;
    const latestBar = runner.barBuffer[runner.barBuffer.length - 1];
    if (!latestBar) return null;

    const currentPrice = latestBar.close;
    const spec = getInstrumentSpec(runner.symbol);
    if (!spec) return null;

    const priceDiff = pos.side === "LONG" 
      ? currentPrice - pos.entryPrice 
      : pos.entryPrice - currentPrice;
    
    const unrealizedPnl = priceDiff * pos.quantity * spec.pointValue;

    return {
      unrealizedPnl,
      currentPrice,
      side: pos.side,
      entryPrice: pos.entryPrice,
    };
  }

  /**
   * Get live PnL summary for a bot (realized + unrealized).
   * Used by execution-proof and bots-overview endpoints.
   */
  async getLivePnLSummary(botId: string): Promise<{
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    openTrades: number;
    closedTrades: number;
    totalTrades: number;
    hasOpenPosition: boolean;
    openPosition?: {
      side: Side;
      entryPrice: number;
      currentPrice: number;
      unrealizedPnl: number;
    };
  }> {
    // CRITICAL: Exclude ORPHAN_RECONCILE trades - these are cleanup closures, not real trades
    // CRITICAL: Filter by ACTIVE account attempt only to prevent stale metrics from blown attempts
    const result = await db.execute(sql`
      SELECT 
        SUM(CASE WHEN pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
            THEN COALESCE(CAST(pt.pnl AS NUMERIC), 0) ELSE 0 END) as realized_pnl,
        COUNT(CASE WHEN pt.status = 'CLOSED' AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE') 
            THEN 1 END) as closed_trades,
        COUNT(CASE WHEN pt.status = 'OPEN' THEN 1 END) as open_trades
      FROM paper_trades pt
      LEFT JOIN account_attempts aa ON pt.account_attempt_id = aa.id
      WHERE pt.bot_id = ${botId}::uuid
        AND (pt.account_attempt_id IS NULL OR aa.status = 'ACTIVE')
    `);

    const stats = result.rows[0] as { 
      realized_pnl: string | null; 
      closed_trades: string; 
      open_trades: string;
    };

    const realizedPnl = Number(stats?.realized_pnl || 0);
    const closedTrades = Number(stats?.closed_trades || 0);
    const openTrades = Number(stats?.open_trades || 0);

    const unrealizedData = this.getUnrealizedPnL(botId);
    const unrealizedPnl = unrealizedData?.unrealizedPnl || 0;
    const hasOpenPosition = unrealizedData !== null;

    return {
      realizedPnl,
      unrealizedPnl,
      totalPnl: realizedPnl + unrealizedPnl,
      openTrades,
      closedTrades,
      totalTrades: closedTrades + openTrades,
      hasOpenPosition,
      openPosition: hasOpenPosition ? {
        side: unrealizedData!.side,
        entryPrice: unrealizedData!.entryPrice,
        currentPrice: unrealizedData!.currentPrice,
        unrealizedPnl: unrealizedData!.unrealizedPnl,
      } : undefined,
    };
  }

  /**
   * Get all active runners with their live PnL data.
   * Used for the bots overview to show real-time paper trading performance.
   */
  async getAllLivePnL(): Promise<Map<string, {
    realizedPnl: number;
    unrealizedPnl: number;
    totalPnl: number;
    hasOpenPosition: boolean;
    closedTrades: number;
    openTrades: number;
    totalTrades: number;
    winRate: number | null;
    maxDrawdownPct: number | null;
    sharpe: number | null;
  }>> {
    const results = new Map();
    
    for (const [botId] of this.activeRunners) {
      const summary = await this.getLivePnLSummary(botId);
      
      // Compute metrics from closed paper trades using institutional-grade calculations
      let winRate: number | null = null;
      let maxDrawdownPct: number | null = null;
      let sharpe: number | null = null;
      
      if (summary.closedTrades > 0) {
        // Get all closed trades ordered by exit time to build equity curve
        // Include symbol for proper instrument spec lookup
        // CRITICAL: Exclude ORPHAN_RECONCILE trades - these are cleanup closures, not real trades
        // CRITICAL: Filter by ACTIVE account attempt only to prevent stale metrics from blown attempts
        const tradesResult = await db.execute(sql`
          SELECT pt.pnl, pt.exit_time, pt.entry_price, pt.quantity, pt.symbol
          FROM paper_trades pt
          LEFT JOIN account_attempts aa ON pt.account_attempt_id = aa.id
          WHERE pt.bot_id = ${botId}::uuid 
            AND pt.status = 'CLOSED'
            AND (pt.exit_reason_code IS NULL OR pt.exit_reason_code != 'ORPHAN_RECONCILE')
            AND (pt.account_attempt_id IS NULL OR aa.status = 'ACTIVE')
          ORDER BY pt.exit_time ASC
        `);
        
        const trades = tradesResult.rows as { pnl: number; exit_time: Date; entry_price: number; quantity: number; symbol: string }[];
        
        // Win rate calculation
        const wins = trades.filter(t => Number(t.pnl) > 0).length;
        winRate = (wins / summary.closedTrades) * 100;
        
        // INSTITUTIONAL MAX DD: Peak-to-trough equity curve tracking
        // Uses running equity from trade-to-trade to find maximum drawdown
        const initialCapital = 10000; // Notional starting capital for percentage calculations
        let equity = initialCapital;
        let peak = initialCapital;
        let maxDrawdown = 0;
        
        for (const trade of trades) {
          equity += Number(trade.pnl);
          peak = Math.max(peak, equity);
          const drawdown = peak - equity;
          maxDrawdown = Math.max(maxDrawdown, drawdown);
        }
        
        // MAX DD as percentage of peak
        maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;
        
        // INSTITUTIONAL SHARPE: Annualized risk-adjusted return
        // Uses percentage returns per trade, normalized by position size with CORRECT point value
        if (trades.length >= 2) {
          // Calculate percentage returns for each trade using actual instrument spec
          const returns: number[] = [];
          for (const trade of trades) {
            // Get the correct point value for this instrument
            const spec = getInstrumentSpec(trade.symbol || "MES");
            if (!spec) {
              console.warn(`[PAPER_RUNNER_SERVICE] Unknown instrument ${trade.symbol} for Sharpe calculation, skipping trade`);
              continue;
            }
            
            // Return as percentage of notional position value using correct point value
            // Point value: MES=$5, MNQ=$2, ES=$50, NQ=$20
            const positionValue = Number(trade.entry_price) * Number(trade.quantity) * spec.pointValue;
            const returnPct = positionValue > 0 ? (Number(trade.pnl) / positionValue) : 0;
            returns.push(returnPct);
          }
          
          if (returns.length >= 2) {
            // Mean and standard deviation of returns
            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);
            
            // Annualized Sharpe Ratio (assuming ~252 trading days, ~2 trades/day conservative)
            const tradesPerYear = 252 * 2;
            sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(tradesPerYear) : 0;
          }
        }
      }
      
      results.set(botId, {
        realizedPnl: summary.realizedPnl,
        unrealizedPnl: summary.unrealizedPnl,
        totalPnl: summary.totalPnl,
        hasOpenPosition: summary.hasOpenPosition,
        closedTrades: summary.closedTrades,
        openTrades: summary.openTrades,
        totalTrades: summary.totalTrades,
        winRate,
        maxDrawdownPct,
        sharpe,
      });
    }

    return results;
  }
}

export const paperRunnerService = new PaperRunnerServiceImpl();
