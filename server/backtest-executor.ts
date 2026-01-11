import { db, withTracedTransaction } from "./db";
import { storage } from "./storage";
import { backtestSessions, tradeLogs, integrationUsageEvents, bots, generationMetricsHistory, botGenerations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import * as crypto from "crypto";
import { logActivityEvent } from "./activity-logger";
import Decimal from "decimal.js";
import { classifyBacktestError, recordBatchMetrics } from "./fail-fast-validators";

Decimal.config({ precision: 20, rounding: Decimal.ROUND_HALF_UP });
import {
  getInstrumentSpec,
  roundToTick,
  calculateTradePnL,
  validateBar,
  isWithinRTH,
  type InstrumentSpec,
} from "./instrument-spec";
import { fetchDatabentoHistoricalBars, resampleBars, type DatabentoBar } from "./databento-client";
import { getCachedBars, isCacheReady, BAR_CACHE_CONFIG, BACKTEST_HISTORY_DAYS } from "./bar-cache";
import { getBarsCached } from "./market/barsCache";
import { createStrategyRules, type StrategyRules, serializeStrategyRules, computeRulesHash, generateRulesSummary } from "./strategy-rules";
import { 
  ARCHETYPE_TO_ENTRY_CONDITION,
  type EntryConditionType as SharedEntryConditionType,
} from "@shared/strategy-types";
import { executeStrategy, type Trade as StrategyTrade, type Bar, setLabModeRelaxation, setSessionBypass } from "./strategy-executor";
import { 
  normalizeArchetype, 
  verifyStrategyMapping, 
  logStrategyResolution,
  type StrategyArchetype,
} from "@shared/strategy-types";

type SamplingMethod = "FULL_RANGE" | "RANDOM_WINDOWS";

interface SamplingWindow {
  start: Date;
  end: Date;
  index: number;
}

interface WindowResult {
  windowIndex: number;
  start: string;
  end: string;
  trades: number;
  netPnl: number;
  maxDrawdownPct: number;
  winRate: number;
}

interface BacktestConfig {
  botId: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  archetype?: string;
  strategyConfig?: Record<string, any>;
  samplingMethod?: SamplingMethod;
  windowCount?: number;
  windowLengthDays?: number;
}

// Legacy mapping for backwards compatibility - prefer normalizeArchetype() from @shared/strategy-types
const LEGACY_SUPPORTED_CATEGORIES: Record<string, string> = {
  "breakout": "breakout",
  "orb breakout": "orb_breakout",
  "rth breakout": "rth_breakout",
  "breakout retest": "breakout_retest",
  "mean reversion": "mean_reversion",
  "mean reversion bb": "mean_reversion",
  "mean reversion keltner": "mean_reversion",
  "exhaustion fade": "exhaustion_fade",
  "gap fade": "gap_fade",  // FIXED: Now maps to gap_fade, not mean_reversion
  "scalping": "scalping",
  "micro pullback": "micro_pullback",
  "range scalper": "range_scalper",
  "vwap scalper": "vwap_scalper",
  "vwap": "vwap",
  "vwap bounce": "vwap_bounce",
  "vwap reclaim": "vwap_reclaim",
  "vwap deviation bands": "vwap",
  "trend following": "trend_following",
  "trend ema cross": "trend_ema_cross",
  "trend macd": "trend_macd",
  "momentum surge": "momentum_surge",
  "gap": "gap_fade",
  "gap fill": "gap_fill",  // FIXED: Now maps to gap_fill, not breakout
  "gap and go": "gap_and_go",
  "reversal": "reversal",  // FIXED: Now maps to reversal, not mean_reversion
  "reversal hunter": "reversal_hunter",
  "double bottom/top": "reversal",
  "rsi divergence": "mean_reversion",
};

interface SimulatedBar {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface SimulatedTrade {
  entryTime: Date;
  exitTime: Date;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  entryReason: string;
  exitReason: string;
}

interface TradePnlResult {
  netPnl: number;
  grossPnl: number;
  fees: number;
  slippage: number;
}

interface MatrixBacktestConfig {
  botId: string;
  symbol: string;
  timeframe: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
}

interface MatrixBacktestResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  metrics?: {
    profitFactor: number;
    totalTrades: number;
    winRate: number;
    netPnl: number;
    maxDrawdownPct: number;
    sharpeRatio: number;
  };
}

/**
 * Execute a backtest for matrix testing - returns metrics for cell population
 */
export async function executeMatrixBacktest(
  config: MatrixBacktestConfig,
  traceId: string
): Promise<MatrixBacktestResult> {
  const bot = await storage.getBot(config.botId);
  if (!bot) {
    return { success: false, error: "Bot not found" };
  }
  
  // Create a temporary session for this matrix cell
  const sessionId = crypto.randomUUID();
  
  try {
    // Create session record
    await db.insert(backtestSessions).values({
      id: sessionId,
      botId: config.botId,
      generationId: bot.currentGenerationId,
      status: "running",
      startedAt: new Date(),
      configSnapshot: {
        symbol: config.symbol,
        timeframe: config.timeframe,
        startDate: config.startDate.toISOString(),
        endDate: config.endDate.toISOString(),
        initialCapital: config.initialCapital,
        matrixCell: true,
      },
    });
    
    // Execute the backtest
    const result = await executeBacktest(sessionId, {
      botId: config.botId,
      symbol: config.symbol,
      timeframe: config.timeframe,
      startDate: config.startDate,
      endDate: config.endDate,
      initialCapital: config.initialCapital,
    }, traceId);
    
    if (!result.success) {
      return { success: false, sessionId, error: result.error };
    }
    
    // Fetch session results to get metrics
    const sessions = await db.select().from(backtestSessions).where(eq(backtestSessions.id, sessionId)).limit(1);
    const session = sessions[0];
    
    if (!session) {
      return { success: false, sessionId, error: "Session not found after execution" };
    }
    
    return {
      success: true,
      sessionId,
      metrics: {
        profitFactor: session.profitFactor || 0,
        totalTrades: session.totalTrades || 0,
        winRate: session.winRate || 0,
        netPnl: session.netPnl || 0,
        maxDrawdownPct: session.maxDrawdownPct || 0,
        sharpeRatio: session.sharpeRatio || 0,
      },
    };
    
  } catch (error) {
    console.error(`[MATRIX_BACKTEST] trace_id=${traceId} session_id=${sessionId} error=`, error);
    return {
      success: false,
      sessionId,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function executeBacktest(
  sessionId: string,
  config: BacktestConfig,
  traceId: string
): Promise<{ success: boolean; error?: string }> {
  const bot = await storage.getBot(config.botId);
  if (!bot) {
    return { success: false, error: "Bot not found" };
  }

  console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} session_id=${sessionId} bot_id=${config.botId} starting`);

  // ============ HARD ASSERTION 1: Instrument spec exists ============
  const instrumentSpec = getInstrumentSpec(config.symbol);
  if (!instrumentSpec) {
    const errorCode = "INSTRUMENT_NOT_SUPPORTED";
    const message = `Symbol ${config.symbol} is not in the canonical instrument registry`;
    const suggestedFix = "Use a supported symbol: MES, MNQ, ES, NQ, YM, MYM, RTY, M2K, CL, GC";
    
    console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAILED: ${errorCode} - ${message}`);
    
    await db.update(backtestSessions)
      .set({ status: "failed", completedAt: new Date(), errorMessage: message })
      .where(eq(backtestSessions.id, sessionId));
    
    await logActivityEvent({
      botId: config.botId,
      eventType: "BACKTEST_FAILED",
      severity: "ERROR",
      title: `Backtest failed: ${errorCode}`,
      summary: message,
      payload: { sessionId, errorCode, message, suggestedFix, symbol: config.symbol },
      traceId,
      symbol: config.symbol,
    });
    
    return { success: false, error: `${errorCode}: ${message}` };
  }

  // Generate deterministic seed for replayability
  const seed = generateBacktestSeed(config.botId, sessionId);
  const configHash = generateConfigHash(config, instrumentSpec);

  try {
    await db.update(backtestSessions)
      .set({ 
        status: "running", 
        startedAt: new Date(),
        // INSTITUTIONAL: Persist seed for reproducible replay (SEV-1 requirement)
        randomSeed: seed,
        // Store replayability fields in configSnapshot
        configSnapshot: {
          seed,
          configHash,
          instrumentSpec: {
            symbol: instrumentSpec.symbol,
            tickSize: instrumentSpec.tickSize,
            pointValue: instrumentSpec.pointValue,
            commission: instrumentSpec.commission,
            slippageTicks: instrumentSpec.slippageTicks,
          },
          dataStart: config.startDate.toISOString(),
          dataEnd: config.endDate.toISOString(),
          dateFrom: config.startDate.toISOString(),
          dateTo: config.endDate.toISOString(),
          timeframe: config.timeframe,
          initialCapital: config.initialCapital,
          sessionFilter: "RTH",
          fillModel: "NEXT_BAR_OPEN",
          samplingMethod: config.samplingMethod || "FULL_RANGE",
          windowCount: config.windowCount || null,
          windowLengthDays: config.windowLengthDays || null,
        },
      })
      .where(eq(backtestSessions.id, sessionId));

    await logActivityEvent({
      botId: config.botId,
      eventType: "BACKTEST_STARTED",
      severity: "INFO",
      title: `Backtest started for ${bot.name}`,
      summary: `Running backtest on ${config.symbol} with ${instrumentSpec.fullName}`,
      payload: { 
        sessionId, 
        symbol: config.symbol, 
        timeframe: config.timeframe,
        seed,
        configHash,
        tickSize: instrumentSpec.tickSize,
        pointValue: instrumentSpec.pointValue,
      },
      traceId,
      symbol: config.symbol,
    });

    const barsResult = await fetchHistoricalBars(config, traceId, instrumentSpec, seed);
    const bars = barsResult.bars;
    
    if (bars.length === 0) {
      throw new Error("No historical data available for backtest");
    }
    
    // Store data provenance immediately (SEV-0 institutional requirement)
    await db.update(backtestSessions)
      .set({
        dataSource: barsResult.dataSource,
        dataProvider: barsResult.dataProvider,
        dataSchema: barsResult.dataSchema,
        dataStartTs: barsResult.dataStartTs,
        dataEndTs: barsResult.dataEndTs,
        barCount: barsResult.barCount,
        rawRequestId: barsResult.rawRequestId,
      })
      .where(eq(backtestSessions.id, sessionId));

    // ============ HARD ASSERTION 2: Validate bars ============
    const barValidationErrors: string[] = [];
    let previousClose: number | undefined;
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const validation = validateBar(bar, instrumentSpec, previousClose);
      if (!validation.valid) {
        barValidationErrors.push(`Bar ${i}: ${validation.errors.join(", ")}`);
      }
      previousClose = bar.close;
    }

    if (barValidationErrors.length > 0) {
      const errorCode = "BAR_VALIDATION_FAILED";
      const message = `Bar data failed sanity checks: ${barValidationErrors.slice(0, 3).join("; ")}${barValidationErrors.length > 3 ? ` (+${barValidationErrors.length - 3} more)` : ""}`;
      
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAILED: ${errorCode} - ${barValidationErrors.length} errors`);
      
      throw new Error(`${errorCode}: ${message}`);
    }

    const archetypes = bot.archetypeId ? await storage.getStrategyArchetypes() : [];
    const archetype = archetypes.find(a => a.id === bot.archetypeId) || null;
    
    // INFER archetype from bot name if archetypeId is NULL
    // Bot names follow pattern: "{SYMBOL} {Strategy Type}" e.g., "MES Gap Fade", "MNQ VWAP Bounce"
    const inferredArchetype = inferArchetypeFromName(bot.name, traceId);
    
    // Determine raw category with explicit priority: archetype.category > config.archetype > inferredArchetype
    // FAIL-CLOSED: If no source provides a valid archetype, fail the backtest (no silent breakout default)
    const rawCategory = archetype?.category || config.archetype || inferredArchetype;
    
    if (!rawCategory) {
      const errorCode = "ARCHETYPE_INFERENCE_FAILED";
      const message = `Could not determine strategy archetype from bot.archetypeId, config.archetype, or bot name "${bot.name}"`;
      
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAILED: ${errorCode} - ${message}`);
      
      await db.update(backtestSessions)
        .set({ status: "failed", completedAt: new Date(), errorMessage: message })
        .where(eq(backtestSessions.id, sessionId));
      
      await logActivityEvent({
        botId: config.botId,
        eventType: "BACKTEST_FAILED",
        severity: "ERROR",
        title: `Backtest failed: ${errorCode}`,
        summary: message,
        payload: { sessionId, errorCode, message, botName: bot.name },
        traceId,
        symbol: config.symbol,
      });
      
      return { success: false, error: `${errorCode}: ${message}` };
    }
    
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_name="${bot.name}" inferred_archetype="${inferredArchetype || 'none'}" using="${rawCategory}"`);
    
    // ============ HARD ASSERTION 3: Archetype must be supported ============
    const mappedStrategy = mapArchetypeToImplementation(rawCategory);
    if (!mappedStrategy) {
      const errorCode = "ARCHETYPE_NOT_IMPLEMENTED";
      const message = `Strategy archetype '${rawCategory}' is not implemented`;
      const suggestedFix = "Use a supported archetype category: Breakout, Mean Reversion, Scalping, VWAP, Trend Following, Gap, Reversal";
      
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAILED: ${errorCode} - ${message}`);
      
      await db.update(backtestSessions)
        .set({ status: "failed", completedAt: new Date(), errorMessage: message })
        .where(eq(backtestSessions.id, sessionId));
      
      await logActivityEvent({
        botId: config.botId,
        eventType: "BACKTEST_FAILED",
        severity: "ERROR",
        title: `Backtest failed: ${errorCode}`,
        summary: message,
        payload: { sessionId, errorCode, message, suggestedFix, archetype: rawCategory },
        traceId,
        symbol: config.symbol,
      });
      
      return { success: false, error: `${errorCode}: ${message}` };
    }
    
    const strategyType = mappedStrategy;
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} archetype=${rawCategory} mapped_to=${strategyType}`);

    // ============ REAL STRATEGY EXECUTION (NO RANDOMNESS) ============
    // Create explicit, inspectable strategy rules based on archetype
    const strategyRules = createStrategyRules(
      strategyType,
      config.symbol,
      config.strategyConfig || {}
    );
    
    // ============ TRIALS SESSION WIDENING (SEV-1 FIX) ============
    // TRIALS mode needs wider session windows to generate baseline trades
    // Many archetypes have narrow windows that filter out 80%+ of bars
    // For TRIALS: widen to full RTH (09:30-16:00 ET) to maximize signal opportunities
    if (bot.stage === "TRIALS" || bot.stage === "PAPER") {
      const originalStart = strategyRules.session.rthStart;
      const originalEnd = strategyRules.session.rthEnd;
      
      // Widen to near-full RTH for TRIALS calibration
      // Keep minimal warmup (09:35) to allow for indicator initialization
      strategyRules.session.rthStart = "09:35";
      strategyRules.session.rthEnd = "15:55";
      
      console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} TRIALS_SESSION_WIDENING original=${originalStart}-${originalEnd} widened=09:35-15:55`);
    }
    
    // ============ STRATEGY PROVENANCE ATTESTATION (SEV-0 INSTITUTIONAL REQUIREMENT) ============
    // Compute expected entry condition from canonical mapping
    const normalizedArch = normalizeArchetype(strategyType);
    const expectedEntryCondition = ARCHETYPE_TO_ENTRY_CONDITION[normalizedArch];
    
    // Get actual entry condition from the created rules
    const actualEntryCondition = strategyRules.entryConditionType;
    
    // FAIL-CLOSED: If expected !== actual, abort backtest with STRATEGY_PROVENANCE_VIOLATION
    if (expectedEntryCondition !== actualEntryCondition) {
      const errorCode = "STRATEGY_PROVENANCE_VIOLATION";
      const message = `Strategy provenance mismatch: expected ${expectedEntryCondition} from mapping, got ${actualEntryCondition} from rules`;
      
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAIL-CLOSED: ${errorCode} - ${message}`);
      
      await db.update(backtestSessions)
        .set({ 
          status: "failed", 
          completedAt: new Date(), 
          errorMessage: message,
          expectedEntryCondition,
          actualEntryCondition,
          provenanceStatus: "MISMATCH",
        })
        .where(eq(backtestSessions.id, sessionId));
      
      await logActivityEvent({
        botId: config.botId,
        eventType: "BACKTEST_FAILED",
        severity: "CRITICAL",
        title: `Backtest failed: ${errorCode}`,
        summary: message,
        payload: { sessionId, errorCode, expectedEntryCondition, actualEntryCondition },
        traceId,
        symbol: config.symbol,
      });
      
      return { success: false, error: `${errorCode}: ${message}` };
    }
    
    // Compute rules hash and summary for provenance
    const rulesHash = computeRulesHash(strategyRules);
    const rulesSummary = generateRulesSummary(strategyRules);
    
    // Store full provenance attestation (SEV-0 institutional requirement)
    await db.update(backtestSessions)
      .set({ 
        rulesHash,
        expectedEntryCondition,
        actualEntryCondition,
        rulesSummary,
        provenanceStatus: "VERIFIED",
      })
      .where(eq(backtestSessions.id, sessionId));
    
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} using_real_strategy version=${strategyRules.version} rules=${strategyRules.name} rules_hash=${rulesHash}`);
    
    // Convert bars to strategy executor format - ensure time is a proper Date
    const executorBars: Bar[] = bars.map(b => {
      // Force Date conversion from any format
      let barTime: Date;
      if (b.time instanceof Date) {
        barTime = b.time;
      } else if (typeof b.time === 'string') {
        barTime = new Date(b.time);
      } else if (typeof b.time === 'number') {
        barTime = new Date(b.time);
      } else {
        // Last resort - try to coerce
        barTime = new Date(String(b.time));
      }
      
      return {
        time: barTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
    });
    
    // ============ TRIALS MODE ENTRY RELAXATION (SEV-1 FIX) ============
    // Only TRIALS stage gets relaxed entry conditions for baseline generation
    // PAPER stage runs PRODUCTION rules by default (no relaxation leakage)
    // SEV-1 REQUIREMENT: Relaxation must be bounded to TRIALS only
    const isLabMode = bot.stage === "TRIALS";
    const rulesProfileUsed = isLabMode ? "TRIALS_RELAXED" : "PRODUCTION";
    setLabModeRelaxation(isLabMode);
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} RULES_PROFILE=${rulesProfileUsed} stage=${bot.stage}`);
    
    // ============ SESSION MODE CONFIGURATION (SEV-1 FIX) ============
    // Session mode comes from bot config, not archetype defaults
    // FULL_24x5 (default for TRIALS) = no session filtering
    const sessionMode = (bot as any).sessionMode || "FULL_24x5";
    const sessionTimezone = (bot as any).sessionTimezone || "America/New_York";
    const sessionStart = (bot as any).sessionStart;
    const sessionEnd = (bot as any).sessionEnd;
    
    // Enable session bypass for FULL_24x5 mode - no hidden session gating
    const isFull24x5 = sessionMode === "FULL_24x5";
    setSessionBypass(isFull24x5);
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} SESSION_MODE=${sessionMode} SESSION_BYPASS=${isFull24x5} timezone=${sessionTimezone}`);
    
    // Store total bar count before any session filtering
    const totalBarCount = executorBars.length;
    
    // Execute strategy with explicit rules - NO randomness
    const executionResult = executeStrategy(
      executorBars,
      strategyRules,
      instrumentSpec,
      config.initialCapital
    );
    
    const trades = executionResult.trades;
    
    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} REAL_EXECUTION trades=${trades.length} pnl=${executionResult.totalPnl.toFixed(2)} win_rate=${executionResult.winRate.toFixed(1)}%`);

    // ============ FAIL-FAST GUARD: Zero Trades (SEV-0 AUTONOMY FIX) ============
    // A backtest that produces zero trades is a FAILURE, not a success.
    // This prevents evolution cycles from spinning on broken strategies.
    if (trades.length === 0) {
      const errorCode = "ZERO_TRADES_GENERATED";
      const message = `Strategy produced 0 trades over ${bars.length} bars. Check entry conditions or data quality.`;
      
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} FAIL_FAST: ${errorCode} - ${message}`);
      
      await db.update(backtestSessions)
        .set({ 
          status: "failed", 
          completedAt: new Date(), 
          errorMessage: `${errorCode}: ${message}`,
          totalTrades: 0,
          totalBarCount,
          sessionFilterBarCount: executionResult.tradingBars || totalBarCount,
          dataSource: barsResult.dataSource,
        })
        .where(eq(backtestSessions.id, sessionId));
      
      await logActivityEvent({
        botId: config.botId,
        eventType: "BACKTEST_FAILED",
        severity: "WARN",
        title: `Backtest failed: ${errorCode}`,
        summary: message,
        payload: { 
          sessionId, 
          traceId, 
          errorCode, 
          barsProcessed: bars.length,
          tradingBars: executionResult.tradingBars,
          archetype: strategyType,
          stage: bot.stage,
        },
        traceId,
      });
      
      return {
        success: false,
        error: message,
      };
    }

    // INSTITUTIONAL: Atomic transaction for trade inserts (SEV-1 requirement)
    // All trades for a session are committed together or rolled back on failure
    await withTracedTransaction(traceId, `BACKTEST_TRADES:${sessionId.slice(0,8)}`, async (tx) => {
      for (const trade of trades) {
        // Generate canonical entry reason code (SEV-0 REQUIREMENT)
        const entryReasonCode = `ENTRY_${actualEntryCondition}` as const;
        
        await tx.insert(tradeLogs).values({
          botId: config.botId,
          backtestSessionId: sessionId,
          symbol: config.symbol,
          side: trade.side === "LONG" ? "BUY" : "SELL",
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          quantity: trade.quantity,
          pnl: trade.pnl,
          pnlPercent: (trade.pnl / (trade.entryPrice * trade.quantity * instrumentSpec.pointValue)) * 100,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          isOpen: false,
          sourceType: "BACKTEST",
          entryReason: trade.entryReason,
          exitReason: trade.exitReason,
          entryReasonCode, // SEV-0 REQUIREMENT: Canonical entry reason code for provenance
          metadata: { 
            traceId, 
            archetype: strategyType,
            ruleVersion: trade.ruleVersion,
            dataSource: barsResult.dataSource,
            entryConditionType: actualEntryCondition, // Embedded in metadata for audit
          },
        });
      }
    });

    // Convert strategy trades to format expected by calculateMetrics
    const simulatedTrades: SimulatedTrade[] = trades.map(t => ({
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      side: t.side === "LONG" ? "BUY" as const : "SELL" as const,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      quantity: t.quantity,
      pnl: t.pnl,
      grossPnl: t.grossPnl,
      fees: t.fees,
      slippage: t.slippage,
      entryReason: t.entryReason,
      exitReason: t.exitReason,
    }));

    const metrics = calculateMetrics(simulatedTrades, config.initialCapital);
    
    // Build comprehensive configSnapshot with strategy rules for full audit trail
    const fullConfigSnapshot = {
      archetype: config.archetype || rawCategory || "default",
      strategy: config.strategyConfig || {},
      // INSTITUTIONAL: Full strategy rules included for audit
      strategyRules: {
        version: strategyRules.version,
        name: strategyRules.name,
        archetype: strategyRules.archetype,
        entry: strategyRules.entry,
        exit: strategyRules.exit,
        risk: strategyRules.risk,
        session: strategyRules.session,
      },
      instrumentSpec: {
        symbol: instrumentSpec.symbol,
        tickSize: instrumentSpec.tickSize,
        pointValue: instrumentSpec.pointValue,
        tickValue: instrumentSpec.tickSize * instrumentSpec.pointValue,
        commission: instrumentSpec.commission,
        slippageTicks: instrumentSpec.slippageTicks,
      },
      dataSource: barsResult.dataSource,
      samplingMethod: config.samplingMethod || "FULL_RANGE",
      seed,
      windowsGenerated: null,
      dataStart: config.startDate.toISOString(),
      dataEnd: config.endDate.toISOString(),
      configHash,
      barsProcessed: bars.length,
      tradingBars: executionResult.tradingBars,
    };

    // Calculate session-filtered bar count (after session filtering in executor)
    const sessionFilterBarCount = executionResult.tradingBars || totalBarCount;
    
    // Build relaxed flags list for provenance
    const relaxedFlagsApplied = isLabMode 
      ? ["WIDER_RSI_BANDS", "SKIP_VOLUME_CONFIRM", "LOWER_THRESHOLDS", "RELAXED_ENTRY"]
      : [];
    
    // Determine effective session start/end based on mode
    let effectiveSessionStart: string | undefined;
    let effectiveSessionEnd: string | undefined;
    if (sessionMode === "CUSTOM") {
      effectiveSessionStart = sessionStart;
      effectiveSessionEnd = sessionEnd;
    } else if (sessionMode === "RTH_US") {
      effectiveSessionStart = "09:30";
      effectiveSessionEnd = "16:15";
    } else if (sessionMode === "ETH") {
      effectiveSessionStart = "18:00";
      effectiveSessionEnd = "09:30";
    }
    // FULL_24x5 has no start/end (unrestricted)

    await db.update(backtestSessions)
      .set({
        status: "completed",
        completedAt: new Date(),
        totalTrades: metrics.totalTrades,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        winRate: metrics.winRate,
        netPnl: metrics.netPnl,
        finalCapital: config.initialCapital + metrics.netPnl,
        profitFactor: metrics.profitFactor,
        sharpeRatio: metrics.sharpeRatio,
        maxDrawdown: metrics.maxDrawdown,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        expectancy: metrics.expectancy,
        tradesJson: trades,
        metricsJson: { ...metrics, equityCurve: metrics.equityCurve || [] },
        configSnapshot: fullConfigSnapshot,
        // SEV-1: Session provenance fields for institutional audit
        stage: bot.stage || "TRIALS",
        sessionModeUsed: sessionMode as any,
        sessionTimezoneUsed: sessionTimezone,
        sessionStartUsed: effectiveSessionStart,
        sessionEndUsed: effectiveSessionEnd,
        totalBarCount,
        sessionFilterBarCount,
        rulesProfileUsed: rulesProfileUsed as any,
        relaxedFlagsApplied,
      })
      .where(eq(backtestSessions.id, sessionId));

    await db.update(bots)
      .set({
        lastBacktestAt: new Date(),
        simTotalTrades: sql`COALESCE(${bots.simTotalTrades}, 0) + ${metrics.totalTrades}`,
        simPnl: sql`COALESCE(${bots.simPnl}, 0) + ${metrics.netPnl}`,
        evolutionStatus: "sim_ready",
        updatedAt: new Date(),
      })
      .where(eq(bots.id, config.botId));

    // Save to generation metrics history for trend tracking and auto-revert
    try {
      const currentGenNumber = bot.currentGeneration ?? 1;
      
      // Get historical peak and previous generation data (one record per generation using DISTINCT ON)
      const historicalMetrics = await db.execute(sql`
        SELECT DISTINCT ON (generation_number) 
          generation_number as "generationNumber", 
          sharpe_ratio as "sharpeRatio"
        FROM generation_metrics_history 
        WHERE bot_id = ${config.botId}
        ORDER BY generation_number DESC, created_at DESC NULLS LAST, id DESC
        LIMIT 10
      `) as { rows: { generationNumber: number; sharpeRatio: number | null }[] };
      
      // Calculate peak Sharpe from history
      let peakSharpe = metrics.sharpeRatio;
      let peakGeneration = currentGenNumber;
      for (const hist of historicalMetrics.rows) {
        if (hist.sharpeRatio !== null && hist.sharpeRatio > (peakSharpe ?? -999)) {
          peakSharpe = hist.sharpeRatio;
          peakGeneration = hist.generationNumber;
        }
      }
      
      // Determine trend direction by comparing to nearest previous generation
      // (not just gen-1, to handle gaps from skipped generations)
      let trendDirection = "INSUFFICIENT_DATA";
      let declineFromPeakPct: number | null = null;
      
      // Find the nearest previous generation (any gen < currentGenNumber)
      const previousGens = historicalMetrics.rows
        .filter(h => h.generationNumber < currentGenNumber)
        .sort((a, b) => b.generationNumber - a.generationNumber);
      const previousGen = previousGens[0]; // Nearest previous generation
      
      if (previousGen && previousGen.sharpeRatio !== null && metrics.sharpeRatio !== null) {
        const sharpeDelta = metrics.sharpeRatio - previousGen.sharpeRatio;
        if (sharpeDelta > 0.1) trendDirection = "IMPROVING";
        else if (sharpeDelta < -0.1) trendDirection = "DECLINING";
        else trendDirection = "STABLE";
      }
      
      // Calculate decline from peak (for regression detection)
      if (peakSharpe !== null && peakSharpe > 0 && metrics.sharpeRatio !== null) {
        declineFromPeakPct = ((peakSharpe - metrics.sharpeRatio) / peakSharpe) * 100;
      }
      
      // Determine if this is a revert candidate (20%+ decline with sufficient trades)
      const isRevertCandidate = 
        metrics.totalTrades >= 20 &&
        declineFromPeakPct !== null &&
        declineFromPeakPct > 20 &&
        peakGeneration !== currentGenNumber;
      
      // Calculate trend confidence based on trade count
      const trendConfidence = 
        metrics.totalTrades >= 100 ? 90 :
        metrics.totalTrades >= 50 ? 70 :
        metrics.totalTrades >= 30 ? 50 :
        metrics.totalTrades >= 20 ? 30 : 10;
      
      await db.insert(generationMetricsHistory).values({
        botId: config.botId,
        generationNumber: currentGenNumber,
        backtestSessionId: sessionId,
        sharpeRatio: metrics.sharpeRatio,
        profitFactor: metrics.profitFactor,
        winRate: metrics.winRate,
        maxDrawdownPct: metrics.maxDrawdownPct,
        totalTrades: metrics.totalTrades,
        netPnl: metrics.netPnl,
        expectancy: metrics.expectancy,
        peakSharpe,
        peakGeneration,
        trendDirection,
        trendConfidence,
        declineFromPeakPct,
        isRevertCandidate,
      });
      
      if (isRevertCandidate) {
        console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${config.botId} REVERT_CANDIDATE gen=${currentGenNumber} peak_gen=${peakGeneration} decline=${declineFromPeakPct?.toFixed(1)}%`);
      }
    } catch (histError) {
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} Failed to save generation metrics history:`, histError);
    }

    // INSTITUTIONAL: Update generation performanceSnapshot with validated post-backtest metrics
    // This captures the point-in-time metrics for the generation audit trail
    // CRITICAL: Only update performanceSnapshot if trades > 0 to prevent impossible metrics (P&L with 0 trades)
    if (bot.currentGenerationId) {
      try {
        // INSTITUTIONAL GUARD: Only update performanceSnapshot if we have actual trades
        // This prevents the bug where generations inherit parent P&L but show 0 trades
        if (metrics.totalTrades > 0) {
          const performanceSnapshot = {
            generation: bot.currentGeneration ?? 1,
            snapshotAt: new Date().toISOString(),
            backtestSessionId: sessionId,
            totalTrades: metrics.totalTrades,
            winRate: metrics.winRate,
            netPnl: metrics.netPnl,
            profitFactor: metrics.profitFactor,
            sharpeRatio: metrics.sharpeRatio,
            maxDrawdownPct: metrics.maxDrawdownPct,
            expectancy: metrics.expectancy,
            avgWin: metrics.avgWin,
            avgLoss: metrics.avgLoss,
          };
          await storage.updateGenerationPerformance(bot.currentGenerationId, performanceSnapshot);
          console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} updated generation performanceSnapshot gen_id=${bot.currentGenerationId}`);
        } else {
          console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} SKIPPING performanceSnapshot update - no trades gen_id=${bot.currentGenerationId}`);
        }
        
        // SEV-1: LAB Baseline Tracking - Mark generation as having valid baseline
        // A baseline is valid if we have sufficient trades (≥20) for statistical significance
        // Note: If we reach this point, provenance was already verified (FAIL-CLOSED earlier)
        const MIN_BASELINE_TRADES = 20;
        const baselineValid = metrics.totalTrades >= MIN_BASELINE_TRADES;
        const baselineFailureReason = baselineValid 
          ? null 
          : metrics.totalTrades === 0 
            ? "NO_TRADES" 
            : metrics.totalTrades < MIN_BASELINE_TRADES
              ? "INSUFFICIENT_TRADES"
              : "UNKNOWN";
        
        const baselineMetrics = {
          totalTrades: metrics.totalTrades,
          winRate: metrics.winRate,
          netPnl: metrics.netPnl,
          sharpeRatio: metrics.sharpeRatio,
          maxDrawdownPct: metrics.maxDrawdownPct,
          profitFactor: metrics.profitFactor,
          rulesProfileUsed,
          relaxedFlagsApplied,
          sessionModeUsed: sessionMode,
          validatedAt: new Date().toISOString(),
        };
        
        await db.update(botGenerations)
          .set({
            baselineValid,
            baselineFailureReason,
            baselineBacktestId: sessionId,
            baselineMetrics,
          })
          .where(eq(botGenerations.id, bot.currentGenerationId));
        
        console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} LAB_BASELINE gen_id=${bot.currentGenerationId} valid=${baselineValid} reason=${baselineFailureReason ?? 'N/A'} trades=${metrics.totalTrades}`);
      } catch (genError) {
        console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} Failed to update generation performance:`, genError);
      }
    }

    await logActivityEvent({
      botId: config.botId,
      eventType: "BACKTEST_COMPLETED",
      severity: "INFO",
      title: `Backtest completed for ${bot.name}`,
      summary: `${metrics.totalTrades} trades, PnL: $${metrics.netPnl.toFixed(2)}, Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`,
      payload: {
        sessionId,
        symbol: config.symbol,
        tradesCount: metrics.totalTrades,
        realizedPnl: metrics.netPnl,
        sharpe: metrics.sharpeRatio,
        maxDd: metrics.maxDrawdownPct,
        winRate: metrics.winRate,
      },
      traceId,
      symbol: config.symbol,
    });

    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} session_id=${sessionId} completed trades=${metrics.totalTrades} pnl=${metrics.netPnl.toFixed(2)}`);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // INSTITUTIONAL FAIL-CLOSED: Classify backtest errors for proper handling
    const classification = classifyBacktestError(errorMessage);
    const classificationInfo = {
      code: classification.code,
      severity: classification.severity,
      shouldHalt: classification.shouldHalt,
    };
    
    console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} session_id=${sessionId} error_class=${classification.code} severity=${classification.severity} halt=${classification.shouldHalt} error=`, error);

    await db.update(backtestSessions)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage,
        // Store classification for downstream analysis
        errorClassification: classificationInfo,
      } as any)
      .where(eq(backtestSessions.id, sessionId));

    await logActivityEvent({
      botId: config.botId,
      eventType: "BACKTEST_FAILED",
      severity: classification.severity === "CRITICAL" ? "CRITICAL" : "ERROR",
      title: `Backtest failed for ${bot.name}: ${classification.code}`,
      summary: errorMessage,
      payload: { 
        sessionId, 
        error: errorMessage, 
        classification: classificationInfo,
        suggestedFix: classification.shouldHalt 
          ? "Critical error - investigate before retrying" 
          : "Check bot configuration and data availability" 
      },
      traceId,
    });

    // For critical errors, log the halt (don't throw - we already marked session as failed)
    if (classification.shouldHalt) {
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} CRITICAL_HALT code=${classification.code} - ${classification.message}`);
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * Seeded random number generator for deterministic replays
 * Uses mulberry32 algorithm - fast and simple
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return function() {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate deterministic seed from bot and session IDs
 */
function generateBacktestSeed(botId: string, sessionId: string): number {
  const hash = crypto.createHash("sha256").update(`${botId}:${sessionId}`).digest("hex");
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Generate config hash for replayability verification
 */
function generateConfigHash(config: BacktestConfig, spec: InstrumentSpec): string {
  const configData = {
    symbol: config.symbol,
    timeframe: config.timeframe,
    startDate: config.startDate.toISOString(),
    endDate: config.endDate.toISOString(),
    initialCapital: config.initialCapital,
    tickSize: spec.tickSize,
    pointValue: spec.pointValue,
    commission: spec.commission,
    slippageTicks: spec.slippageTicks,
    archetype: config.archetype || "default",
    samplingMethod: config.samplingMethod || "FULL_RANGE",
  };
  return crypto.createHash("sha256").update(JSON.stringify(configData)).digest("hex").substring(0, 16);
}

/**
 * Generate random sampling windows for RANDOM_WINDOWS mode
 * Each window is 30-60 days, distributed across the full date range
 */
function generateSamplingWindows(
  startDate: Date,
  endDate: Date,
  windowCount: number,
  windowLengthDays: number,
  seed: number
): SamplingWindow[] {
  const windows: SamplingWindow[] = [];
  const random = createSeededRandom(seed);
  
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  
  if (totalDays < windowLengthDays) {
    return [{
      start: startDate,
      end: endDate,
      index: 0,
    }];
  }
  
  const availableStartDays = totalDays - windowLengthDays;
  const stepSize = Math.floor(availableStartDays / windowCount);
  
  for (let i = 0; i < windowCount; i++) {
    const baseOffset = i * stepSize;
    const jitter = Math.floor(random() * Math.min(stepSize, 10));
    const offsetDays = Math.min(baseOffset + jitter, availableStartDays);
    
    const windowStart = new Date(startDate);
    windowStart.setDate(windowStart.getDate() + offsetDays);
    
    const actualLength = windowLengthDays + Math.floor(random() * 15) - 7;
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowEnd.getDate() + Math.max(30, actualLength));
    
    if (windowEnd > endDate) {
      windowEnd.setTime(endDate.getTime());
    }
    
    windows.push({
      start: windowStart,
      end: windowEnd,
      index: i,
    });
  }
  
  return windows;
}

/**
 * Infer archetype from bot name using canonical normalization
 * Bot names follow pattern: "{SYMBOL} {Strategy Type}" e.g., "MES Gap Fade", "MNQ VWAP Bounce"
 * 
 * Uses the canonical normalizeArchetype function from shared/strategy-types.ts
 * which handles all aliases, instrument prefix stripping, and partial matches.
 * 
 * FAIL-CLOSED: Returns null and logs warning if archetype cannot be determined.
 * The caller must decide whether to fail the backtest or use a fallback.
 */
function inferArchetypeFromName(botName: string, traceId?: string): StrategyArchetype | null {
  if (!botName) {
    if (traceId) {
      console.warn(`[STRATEGY_INFERENCE] trace_id=${traceId} FAILED: empty bot name`);
    }
    return null;
  }
  
  // Try canonical normalization on the full bot name
  // normalizeArchetype already strips instrument prefixes and handles aliases
  try {
    const archetype = normalizeArchetype(botName);
    if (traceId && archetype) {
      console.log(`[STRATEGY_INFERENCE] trace_id=${traceId} bot_name="${botName}" inferred_archetype="${archetype}"`);
    }
    return archetype;
  } catch (e) {
    // normalizeArchetype throws on unknown - this is expected for some names
  }
  
  // Try extracting just the strategy part after the symbol
  // Bot names are typically "{SYMBOL} {Strategy}" like "MES Gap Fade"
  const parts = botName.split(' ');
  if (parts.length >= 2) {
    // Skip first part (symbol) and try the rest
    const strategyPart = parts.slice(1).join(' ');
    try {
      const archetype = normalizeArchetype(strategyPart);
      if (traceId && archetype) {
        console.log(`[STRATEGY_INFERENCE] trace_id=${traceId} bot_name="${botName}" strategy_part="${strategyPart}" inferred_archetype="${archetype}"`);
      }
      return archetype;
    } catch (e) {
      // Still couldn't normalize - continue to fallback
    }
  }
  
  // FAIL-CLOSED: Log warning and return null (no silent fallback to breakout)
  if (traceId) {
    console.warn(`[STRATEGY_INFERENCE] trace_id=${traceId} FAILED: could not infer archetype from bot_name="${botName}"`);
  }
  return null;
}

/**
 * Map archetype category to supported implementation
 * Uses canonical normalization from shared/strategy-types.ts
 * Returns null if archetype is not supported
 */
function mapArchetypeToImplementation(category: string, traceId?: string): StrategyArchetype | null {
  // First try canonical normalization
  const canonicalArchetype = normalizeArchetype(category);
  
  if (canonicalArchetype) {
    if (traceId) {
      const verification = verifyStrategyMapping(category);
      logStrategyResolution(traceId, category, verification.normalizedArchetype, verification.entryConditionType);
    }
    return canonicalArchetype;
  }
  
  // Fallback to legacy mapping for backwards compatibility
  const normalized = category.toLowerCase().trim();
  const legacyResult = LEGACY_SUPPORTED_CATEGORIES[normalized];
  
  if (legacyResult) {
    // Try to normalize the legacy result to canonical
    const canonicalFromLegacy = normalizeArchetype(legacyResult);
    if (canonicalFromLegacy) {
      if (traceId) {
        console.warn(`[STRATEGY_MAPPING] trace_id=${traceId} Used LEGACY mapping: "${category}" → "${legacyResult}" → "${canonicalFromLegacy}"`);
      }
      return canonicalFromLegacy;
    }
  }
  
  // Not found in either system
  if (traceId) {
    console.error(`[STRATEGY_MAPPING_FAILED] trace_id=${traceId} archetype="${category}" NOT FOUND in canonical or legacy mappings`);
  }
  return null;
}

// Institutional fail-closed behavior: ALLOW_SIM_FALLBACK defaults to FALSE everywhere
// When false, backtests FAIL if real data is unavailable - no silent simulated fallback
// This ensures institutional data provenance: only explicit opt-in allows simulated data
function isSimFallbackAllowed(): boolean {
  const envValue = process.env.ALLOW_SIM_FALLBACK;
  // INSTITUTIONAL DEFAULT: FALSE everywhere (dev and production)
  // Must explicitly set ALLOW_SIM_FALLBACK=true to enable simulated fallback
  if (envValue === undefined) {
    return false; // Fail-closed by default in ALL environments
  }
  return envValue.toLowerCase() === 'true' || envValue === '1';
}

interface HistoricalBarsResult {
  bars: SimulatedBar[];
  dataSource: 'DATABENTO_REAL' | 'SIMULATED_FALLBACK';
  dataProvider: string;
  dataSchema: string;
  dataStartTs: Date;
  dataEndTs: Date;
  barCount: number;
  rawRequestId: string;
}

async function fetchHistoricalBars(
  config: BacktestConfig, 
  traceId: string, 
  spec: InstrumentSpec, 
  seed: number
): Promise<HistoricalBarsResult> {
  const startTime = Date.now();
  const hasDatabento = !!process.env.DATABENTO_API_KEY;
  const allowSimFallback = isSimFallbackAllowed();
  
  // ============ REAL DATA FIRST: Use Bar Cache (institutional standard) ============
  if (hasDatabento) {
    try {
      // INSTITUTIONAL STANDARD: Use bar cache for efficient parallel backtesting
      // Cache stores 5 years of data per symbol, shared by all bots (industry standard)
      const useCache = BAR_CACHE_CONFIG.CACHEABLE_SYMBOLS.includes(config.symbol.toUpperCase());
      
      console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} using REAL Databento data for ${config.symbol} via ${useCache ? 'BAR_CACHE' : 'DIRECT_API'}`);
      
      let allBars: DatabentoBar[];
      
      let dataSourceInfo = { dataset: "GLBX.MDP3", schema: "ohlcv-1m" };
      let actualDataSource: "BAR_CACHE" | "DATABENTO_REAL" = useCache ? "BAR_CACHE" : "DATABENTO_REAL";
      
      if (useCache) {
        // Use cached bars - no API rate limits, enables 50+ parallel backtests
        // Tiered architecture: 2 years in memory (warm), 5 years total via cold storage
        // Calculate requested history span to determine if cold storage is needed
        const requestedDays = Math.ceil((config.endDate.getTime() - config.startDate.getTime()) / (24 * 60 * 60 * 1000));
        const needsColdStorage = requestedDays > BAR_CACHE_CONFIG.WARM_TIER_HISTORY_DAYS;
        
        if (needsColdStorage) {
          // INSTITUTIONAL: Load from cold storage for 5-year backtests
          console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} loading_5year_history symbol=${config.symbol} days=${requestedDays} source=COLD_STORAGE`);
          const { loadFromColdStorage } = await import("./bar-cache");
          allBars = await loadFromColdStorage(
            config.symbol, 
            traceId, 
            config.startDate.getTime(), 
            config.endDate.getTime()
          );
          
          // Fall back to Redis cache + API if cold storage is empty
          if (!allBars || allBars.length === 0) {
            console.warn(`[BACKTEST_EXECUTOR] trace_id=${traceId} cold_storage_empty falling_back_to_redis_cache`);
            actualDataSource = "DATABENTO_REAL";
            const cachedResult = await getBarsCached(
              {
                symbol: config.symbol,
                timeframe: config.timeframe,
                sessionMode: "ALL",
                startTs: config.startDate.getTime(),
                endTs: config.endDate.getTime(),
              },
              traceId,
              config.botId
            );
            allBars = cachedResult.bars;
            dataSourceInfo = {
              dataset: "GLBX.MDP3",
              schema: "ohlcv-1m",
            };
          }
        } else {
          // Standard case: Use warm cache for shorter backtests
          allBars = await getCachedBars(config.symbol, traceId, {
            historyDays: BAR_CACHE_CONFIG.WARM_TIER_HISTORY_DAYS,
          });
          
          // Validate cache returned data
          if (!allBars || allBars.length === 0) {
            console.warn(`[BACKTEST_EXECUTOR] trace_id=${traceId} cache_empty symbol=${config.symbol} falling_back_to_redis_cache`);
            actualDataSource = "DATABENTO_REAL";
            const cachedResult = await getBarsCached(
              {
                symbol: config.symbol,
                timeframe: config.timeframe,
                sessionMode: "ALL",
                startTs: config.startDate.getTime(),
                endTs: config.endDate.getTime(),
              },
              traceId,
              config.botId
            );
            allBars = cachedResult.bars;
            dataSourceInfo = {
              dataset: "GLBX.MDP3",
              schema: "ohlcv-1m",
            };
          }
        }
      } else {
        // Fallback to Redis cache for non-warm-cached symbols
        console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} using Redis cache for non-warm-cached symbol ${config.symbol}`);
        const cachedResult = await getBarsCached(
          {
            symbol: config.symbol,
            timeframe: config.timeframe,
            sessionMode: "ALL",
            startTs: config.startDate.getTime(),
            endTs: config.endDate.getTime(),
          },
          traceId,
          config.botId
        );
        allBars = cachedResult.bars;
        dataSourceInfo = {
          dataset: "GLBX.MDP3",
          schema: "ohlcv-1m",
        };
      }
      
      // Filter cached bars to the requested date range
      const requestStartMs = config.startDate.getTime();
      const requestEndMs = config.endDate.getTime();
      let filteredBars = allBars.filter((bar: DatabentoBar) => {
        const barTime = bar.time.getTime();
        return barTime >= requestStartMs && barTime <= requestEndMs;
      });
      
      // Resample cached 1-minute bars to requested timeframe if needed
      // This matches the behavior of the direct Databento API path
      const needsResampling = ["5m", "15m"].includes(config.timeframe);
      const resampleFactor = config.timeframe === "5m" ? 5 : config.timeframe === "15m" ? 15 : 1;
      
      if (useCache && needsResampling && filteredBars.length > 0) {
        console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} resampling cached bars from 1m to ${config.timeframe} (factor=${resampleFactor})`);
        filteredBars = resampleBars(filteredBars, resampleFactor);
      }
      
      // Convert Databento bars to SimulatedBar format
      const bars: SimulatedBar[] = filteredBars.map((bar: DatabentoBar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }));
      
      const latencyMs = Date.now() - startTime;
      const rawRequestId = `${actualDataSource === "BAR_CACHE" ? 'cached' : 'databento'}-${config.symbol}-${config.startDate.toISOString()}-${config.endDate.toISOString()}`;
      
      await db.insert(integrationUsageEvents).values({
        integration: "databento",
        operation: "HISTORICAL_BARS",
        status: "OK",
        latencyMs,
        symbol: config.symbol,
        timeframe: config.timeframe,
        records: bars.length,
        traceId,
        metadata: { 
          startDate: config.startDate.toISOString(),
          endDate: config.endDate.toISOString(),
          barCount: bars.length,
          tickSize: spec.tickSize,
          pointValue: spec.pointValue,
          provider: "databento",
          dataset: dataSourceInfo.dataset,
          schema: dataSourceInfo.schema,
          sessionFilter: "RTH",
          dataSource: actualDataSource,
          rawRequestId,
        },
      });

      console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} REAL_DATA fetched_bars=${bars.length} provider=databento latency=${latencyMs}ms`);

      return {
        bars,
        dataSource: 'DATABENTO_REAL',
        dataProvider: 'DATABENTO',
        dataSchema: dataSourceInfo.schema || 'ohlcv-1m',
        dataStartTs: config.startDate,
        dataEndTs: config.endDate,
        barCount: bars.length,
        rawRequestId,
      };
      
    } catch (databentoError) {
      const errorMsg = databentoError instanceof Error ? databentoError.message : "Unknown Databento error";
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} Databento fetch failed: ${errorMsg}`);
      
      // ============ FAIL-CLOSED CHECK ============
      if (!allowSimFallback) {
        const errorCode = "DATA_PROVENANCE_VIOLATION";
        const message = `Real market data unavailable and ALLOW_SIM_FALLBACK=false. Institutional fail-closed behavior active.`;
        
        await logActivityEvent({
          eventType: "INTEGRATION_ERROR",
          severity: "ERROR",
          title: "Backtest Blocked: No Real Data",
          summary: `Databento failed (${errorMsg.substring(0, 50)}...) and simulated fallback is disabled`,
          payload: { 
            symbol: config.symbol, 
            error: errorMsg,
            failClosed: true,
            allowSimFallback: false,
          },
          traceId,
        });
        
        throw new Error(`${errorCode}: ${message} Original error: ${errorMsg}`);
      }
      
      // Log the fallback event (only when allowed)
      await logActivityEvent({
        eventType: "INTEGRATION_ERROR",
        severity: "WARN",
        title: "Databento Fallback to Simulated",
        summary: `Real data unavailable, using simulated bars: ${errorMsg.substring(0, 100)}`,
        payload: { symbol: config.symbol, error: errorMsg, allowSimFallback: true },
        traceId,
      });
    }
  } else if (!allowSimFallback) {
    // No Databento API key and fallback not allowed
    const errorCode = "DATA_PROVENANCE_VIOLATION";
    const message = `DATABENTO_API_KEY not configured and ALLOW_SIM_FALLBACK=false. Institutional fail-closed behavior requires real market data.`;
    
    await logActivityEvent({
      eventType: "INTEGRATION_ERROR",
      severity: "ERROR",
      title: "Backtest Blocked: No Data Provider",
      summary: "No market data provider configured and simulated fallback is disabled",
      payload: { 
        symbol: config.symbol, 
        failClosed: true,
        allowSimFallback: false,
        hasDatabento: false,
      },
      traceId,
    });
    
    throw new Error(`${errorCode}: ${message}`);
  }
  
  // ============ FALLBACK: Simulated bars (only when allowed) ============
  const provider = "simulated";
  console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} using SIMULATED data for ${config.symbol} (ALLOW_SIM_FALLBACK=${allowSimFallback})`);

  const bars = generateSimulatedBars(config.startDate, config.endDate, spec, seed);
  const rawRequestId = `sim-${config.symbol}-${seed}-${config.startDate.toISOString()}`;

  const latencyMs = Date.now() - startTime;
  
  await db.insert(integrationUsageEvents).values({
    integration: provider,
    operation: "HISTORICAL_BARS",
    status: "OK",
    latencyMs,
    symbol: config.symbol,
    timeframe: config.timeframe,
    records: bars.length,
    traceId,
    metadata: { 
      startDate: config.startDate.toISOString(),
      endDate: config.endDate.toISOString(),
      barCount: bars.length,
      seed,
      tickSize: spec.tickSize,
      pointValue: spec.pointValue,
      provider,
      sessionFilter: "RTH",
      dataSource: "SIMULATED_FALLBACK",
      rawRequestId,
    },
  });

  console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} SIMULATED fetched_bars=${bars.length} provider=${provider} seed=${seed} latency=${latencyMs}ms`);

  return {
    bars,
    dataSource: 'SIMULATED_FALLBACK',
    dataProvider: 'SIMULATED',
    dataSchema: 'simulated-ohlcv',
    dataStartTs: config.startDate,
    dataEndTs: config.endDate,
    barCount: bars.length,
    rawRequestId,
  };
}

function generateSimulatedBars(
  startDate: Date, 
  endDate: Date, 
  spec: InstrumentSpec,
  seed: number
): SimulatedBar[] {
  const bars: SimulatedBar[] = [];
  const random = createSeededRandom(seed);
  
  // Use realistic current prices based on asset class (late 2024/2025 levels)
  let basePrice: number;
  switch (spec.symbol) {
    case "ES": case "MES":
      basePrice = 6050; // S&P 500 around 6000
      break;
    case "NQ": case "MNQ":
      basePrice = 21500; // Nasdaq around 21000-22000
      break;
    case "YM": case "MYM":
      basePrice = 44000; // Dow around 44000
      break;
    case "RTY": case "M2K":
      basePrice = 2350; // Russell 2000 around 2300
      break;
    case "CL":
      basePrice = 72; // Crude oil around $70-75
      break;
    case "GC":
      basePrice = 2650; // Gold around $2600
      break;
    default:
      basePrice = (spec.priceBounds.min + spec.priceBounds.max) / 2;
  }
  
  const volatility = basePrice * 0.002; // 0.2% per bar
  const meanReversionStrength = 0.01; // Pull back towards base price
  
  let currentDate = new Date(startDate);
  let currentPrice = basePrice;
  
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }
    
    // Use RTH hours from instrument spec
    const [startH] = spec.tradingHours.rth.start.split(":").map(Number);
    const [endH] = spec.tradingHours.rth.end.split(":").map(Number);
    
    for (let hour = startH; hour < endH; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const time = new Date(currentDate);
        time.setHours(hour, minute, 0, 0);
        
        // Mean reversion: pull price back towards base when it drifts too far
        const deviation = currentPrice - basePrice;
        const meanReversionForce = -deviation * meanReversionStrength;
        
        // Use seeded random for deterministic replays
        const trendBias = Math.sin(hour / 24 * Math.PI) * volatility * 0.3;
        const randomMove = (random() - 0.5) * volatility * 2 + trendBias + meanReversionForce;
        
        // Clamp prices within bounds to prevent validation failures
        const clampPrice = (price: number) => Math.max(spec.priceBounds.min + 100, Math.min(spec.priceBounds.max - 100, price));
        
        const open = roundToTick(clampPrice(currentPrice), spec);
        const close = roundToTick(clampPrice(open + randomMove), spec);
        const high = roundToTick(clampPrice(Math.max(open, close) + random() * volatility * 0.5), spec);
        const low = roundToTick(clampPrice(Math.min(open, close) - random() * volatility * 0.5), spec);
        
        bars.push({
          time,
          open,
          high,
          low,
          close,
          volume: Math.floor(random() * 1000) + 100,
        });
        
        currentPrice = close;
      }
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return bars;
}

function simulateTrades(bars: SimulatedBar[], strategyType: string, config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  
  if (bars.length < 20) return trades;

  switch (strategyType.toLowerCase()) {
    case "breakout":
    case "orb breakout":
    case "rth breakout":
    case "breakout retest":
      return simulateBreakoutStrategy(bars, config, spec);
    case "mean reversion":
    case "mean reversion bb":
    case "mean reversion keltner":
    case "mean revert":
      return simulateMeanReversionStrategy(bars, config, spec);
    case "scalping":
    case "momentum burst":
    case "micro pullback":
    case "momentum surge":
    case "scalper":
      return simulateScalpingStrategy(bars, config, spec);
    case "vwap":
    case "vwap reclaim":
    case "vwap bias":
    case "vwap bounce":
    case "vwap scalper":
      return simulateVWAPStrategy(bars, config, spec);
    case "trend following":
    case "trend rider":
      return simulateTrendStrategy(bars, config, spec);
    case "gap fade":
    case "gap fill":
    case "exhaustion fade":
    case "reversal hunter":
    case "range scalper":
      return simulateMeanReversionStrategy(bars, config, spec);
    default:
      // Log unknown strategy type for debugging
      console.log(`[BACKTEST_EXECUTOR] unknown strategy_type="${strategyType}" falling back to breakout`);
      return simulateBreakoutStrategy(bars, config, spec);
  }
}

/**
 * Calculate realistic PnL for a trade using instrument spec
 * PnL = (ticks_moved * tick_value * quantity) - fees - slippage
 * 
 * tickValue = pointValue * tickSize (e.g., MES: $5 * 0.25 = $1.25/tick)
 * 
 * INSTITUTIONAL: Uses Decimal.js for all calculations to prevent floating-point drift
 * 
 * Returns all components for auditable transparency
 */
function calculateTradePnl(
  side: "BUY" | "SELL",
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  spec: InstrumentSpec
): TradePnlResult {
  const dEntry = new Decimal(entryPrice);
  const dExit = new Decimal(exitPrice);
  const dQty = new Decimal(quantity);
  const dTickSize = new Decimal(spec.tickSize);
  const dPointValue = new Decimal(spec.pointValue);
  const dCommission = new Decimal(spec.commission);
  const dSlippageTicks = new Decimal(spec.slippageTicks);
  
  const priceDiff = side === "BUY" ? dExit.minus(dEntry) : dEntry.minus(dExit);
  const ticksMove = priceDiff.dividedBy(dTickSize);
  
  const tickValue = dPointValue.times(dTickSize);
  const grossPnl = ticksMove.times(tickValue).times(dQty);
  
  const fees = dCommission.times(2).times(dQty);
  const slippage = dSlippageTicks.times(tickValue).times(2).times(dQty);
  const netPnl = grossPnl.minus(fees).minus(slippage);
  
  return {
    netPnl: netPnl.toDecimalPlaces(2).toNumber(),
    grossPnl: grossPnl.toDecimalPlaces(2).toNumber(),
    fees: fees.toDecimalPlaces(2).toNumber(),
    slippage: slippage.toDecimalPlaces(2).toNumber(),
  };
}

function simulateBreakoutStrategy(bars: SimulatedBar[], config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  const lookback = 20;
  
  let inPosition = false;
  let entryBar: SimulatedBar | null = null;
  let entryPrice = 0;
  let stopPrice = 0;
  let targetPrice = 0;
  let side: "BUY" | "SELL" = "BUY";

  for (let i = lookback; i < bars.length; i++) {
    const currentBar = bars[i];
    const recentBars = bars.slice(i - lookback, i);
    
    const highOfRange = Math.max(...recentBars.map(b => b.high));
    const lowOfRange = Math.min(...recentBars.map(b => b.low));
    const rangeSize = highOfRange - lowOfRange;

    if (!inPosition) {
      if (currentBar.close > highOfRange && rangeSize > 0) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "BUY";
        stopPrice = entryPrice - rangeSize * 0.5;
        targetPrice = entryPrice + rangeSize * 1.5;
      } else if (currentBar.close < lowOfRange && rangeSize > 0) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "SELL";
        stopPrice = entryPrice + rangeSize * 0.5;
        targetPrice = entryPrice - rangeSize * 1.5;
      }
    } else {
      let exitPrice = 0;
      let exitReason = "";

      if (side === "BUY") {
        if (currentBar.low <= stopPrice) {
          exitPrice = stopPrice;
          exitReason = "STOP_LOSS";
        } else if (currentBar.high >= targetPrice) {
          exitPrice = targetPrice;
          exitReason = "TAKE_PROFIT";
        }
      } else {
        if (currentBar.high >= stopPrice) {
          exitPrice = stopPrice;
          exitReason = "STOP_LOSS";
        } else if (currentBar.low <= targetPrice) {
          exitPrice = targetPrice;
          exitReason = "TAKE_PROFIT";
        }
      }

      if (exitPrice > 0 && entryBar) {
        const pnlResult = calculateTradePnl(side, entryPrice, exitPrice, 1, spec);
        trades.push({
          entryTime: entryBar.time,
          exitTime: currentBar.time,
          side,
          entryPrice,
          exitPrice,
          quantity: 1,
          pnl: pnlResult.netPnl,
          grossPnl: pnlResult.grossPnl,
          fees: pnlResult.fees,
          slippage: pnlResult.slippage,
          entryReason: "BREAKOUT",
          exitReason,
        });
        inPosition = false;
        entryBar = null;
      }
    }
  }

  return trades;
}

function simulateMeanReversionStrategy(bars: SimulatedBar[], config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  const lookback = 20;
  const zThreshold = 2.0;

  let inPosition = false;
  let entryBar: SimulatedBar | null = null;
  let entryPrice = 0;
  let side: "BUY" | "SELL" = "BUY";

  for (let i = lookback; i < bars.length; i++) {
    const currentBar = bars[i];
    const recentBars = bars.slice(i - lookback, i);
    
    const closes = recentBars.map(b => b.close);
    const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
    const stdDev = Math.sqrt(closes.map(c => Math.pow(c - mean, 2)).reduce((a, b) => a + b, 0) / closes.length);
    const zScore = stdDev > 0 ? (currentBar.close - mean) / stdDev : 0;

    if (!inPosition) {
      if (zScore < -zThreshold) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "BUY";
      } else if (zScore > zThreshold) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "SELL";
      }
    } else if (entryBar) {
      const holdingPeriod = i - bars.indexOf(entryBar);
      const revertedToMean = Math.abs(currentBar.close - mean) < stdDev * 0.5;
      const stopTriggered = Math.abs(currentBar.close - entryPrice) > stdDev * 3;

      if (revertedToMean || holdingPeriod > 50 || stopTriggered) {
        const pnlResult = calculateTradePnl(side, entryPrice, currentBar.close, 1, spec);
        trades.push({
          entryTime: entryBar.time,
          exitTime: currentBar.time,
          side,
          entryPrice,
          exitPrice: currentBar.close,
          quantity: 1,
          pnl: pnlResult.netPnl,
          grossPnl: pnlResult.grossPnl,
          fees: pnlResult.fees,
          slippage: pnlResult.slippage,
          entryReason: "MEAN_REVERSION",
          exitReason: stopTriggered ? "STOP_LOSS" : revertedToMean ? "MEAN_REVERT" : "TIME_EXIT",
        });
        inPosition = false;
        entryBar = null;
      }
    }
  }

  return trades;
}

function simulateScalpingStrategy(bars: SimulatedBar[], config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  const momentumLookback = 5;

  let inPosition = false;
  let entryBar: SimulatedBar | null = null;
  let entryPrice = 0;
  let side: "BUY" | "SELL" = "BUY";

  for (let i = momentumLookback; i < bars.length; i++) {
    const currentBar = bars[i];
    const prevBars = bars.slice(i - momentumLookback, i);
    
    const momentum = currentBar.close - prevBars[0].close;
    const avgVolume = prevBars.reduce((a, b) => a + b.volume, 0) / prevBars.length;
    const volumeSpike = currentBar.volume > avgVolume * 1.5;

    if (!inPosition && volumeSpike) {
      if (momentum > 0) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "BUY";
      } else if (momentum < 0) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "SELL";
      }
    } else if (inPosition && entryBar) {
      const holdingPeriod = i - bars.indexOf(entryBar);
      const rawPnl = side === "BUY" ? currentBar.close - entryPrice : entryPrice - currentBar.close;
      const stopLoss = Math.abs(rawPnl) > entryPrice * 0.002;
      const takeProfit = rawPnl > entryPrice * 0.001;

      if (stopLoss || takeProfit || holdingPeriod > 10) {
        const pnlResult = calculateTradePnl(side, entryPrice, currentBar.close, 1, spec);
        trades.push({
          entryTime: entryBar.time,
          exitTime: currentBar.time,
          side,
          entryPrice,
          exitPrice: currentBar.close,
          quantity: 1,
          pnl: pnlResult.netPnl,
          grossPnl: pnlResult.grossPnl,
          fees: pnlResult.fees,
          slippage: pnlResult.slippage,
          entryReason: "MOMENTUM_SCALP",
          exitReason: stopLoss ? "STOP_LOSS" : takeProfit ? "TAKE_PROFIT" : "TIME_EXIT",
        });
        inPosition = false;
        entryBar = null;
      }
    }
  }

  return trades;
}

function simulateVWAPStrategy(bars: SimulatedBar[], config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let inPosition = false;
  let entryBar: SimulatedBar | null = null;
  let entryPrice = 0;
  let side: "BUY" | "SELL" = "BUY";

  for (let i = 1; i < bars.length; i++) {
    const currentBar = bars[i];
    const typicalPrice = (currentBar.high + currentBar.low + currentBar.close) / 3;
    
    cumulativeTPV += typicalPrice * currentBar.volume;
    cumulativeVolume += currentBar.volume;
    const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;

    const deviation = (currentBar.close - vwap) / vwap * 100;

    if (!inPosition) {
      if (deviation < -0.3 && currentBar.close > bars[i-1].close) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "BUY";
      } else if (deviation > 0.3 && currentBar.close < bars[i-1].close) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "SELL";
      }
    } else if (entryBar) {
      const reclaimedVWAP = side === "BUY" ? currentBar.close >= vwap : currentBar.close <= vwap;
      const rawPnl = side === "BUY" ? currentBar.close - entryPrice : entryPrice - currentBar.close;
      const stopLoss = rawPnl < -Math.abs(entryPrice * 0.005);

      if (reclaimedVWAP || stopLoss) {
        const pnlResult = calculateTradePnl(side, entryPrice, currentBar.close, 1, spec);
        trades.push({
          entryTime: entryBar.time,
          exitTime: currentBar.time,
          side,
          entryPrice,
          exitPrice: currentBar.close,
          quantity: 1,
          pnl: pnlResult.netPnl,
          grossPnl: pnlResult.grossPnl,
          fees: pnlResult.fees,
          slippage: pnlResult.slippage,
          entryReason: "VWAP_FADE",
          exitReason: stopLoss ? "STOP_LOSS" : "VWAP_RECLAIM",
        });
        inPosition = false;
        entryBar = null;
      }
    }
  }

  return trades;
}

function simulateTrendStrategy(bars: SimulatedBar[], config: BacktestConfig, spec: InstrumentSpec): SimulatedTrade[] {
  const trades: SimulatedTrade[] = [];
  const fastPeriod = 10;
  const slowPeriod = 30;

  let inPosition = false;
  let entryBar: SimulatedBar | null = null;
  let entryPrice = 0;
  let side: "BUY" | "SELL" = "BUY";

  for (let i = slowPeriod; i < bars.length; i++) {
    const fastMA = bars.slice(i - fastPeriod, i).reduce((a, b) => a + b.close, 0) / fastPeriod;
    const slowMA = bars.slice(i - slowPeriod, i).reduce((a, b) => a + b.close, 0) / slowPeriod;
    const prevFastMA = bars.slice(i - fastPeriod - 1, i - 1).reduce((a, b) => a + b.close, 0) / fastPeriod;
    const prevSlowMA = bars.slice(i - slowPeriod - 1, i - 1).reduce((a, b) => a + b.close, 0) / slowPeriod;

    const currentBar = bars[i];
    const bullishCross = prevFastMA <= prevSlowMA && fastMA > slowMA;
    const bearishCross = prevFastMA >= prevSlowMA && fastMA < slowMA;

    if (!inPosition) {
      if (bullishCross) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "BUY";
      } else if (bearishCross) {
        inPosition = true;
        entryBar = currentBar;
        entryPrice = currentBar.close;
        side = "SELL";
      }
    } else if (entryBar) {
      const exitSignal = side === "BUY" ? bearishCross : bullishCross;

      if (exitSignal) {
        const pnlResult = calculateTradePnl(side, entryPrice, currentBar.close, 1, spec);
        trades.push({
          entryTime: entryBar.time,
          exitTime: currentBar.time,
          side,
          entryPrice,
          exitPrice: currentBar.close,
          quantity: 1,
          pnl: pnlResult.netPnl,
          grossPnl: pnlResult.grossPnl,
          fees: pnlResult.fees,
          slippage: pnlResult.slippage,
          entryReason: "TREND_CROSS",
          exitReason: "REVERSAL_SIGNAL",
        });
        inPosition = false;
        entryBar = null;
      }
    }
  }

  return trades;
}

function calculateMetrics(trades: SimulatedTrade[], initialCapital: number) {
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.pnl > 0).length;
  const losingTrades = trades.filter(t => t.pnl <= 0).length;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  const avgWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
  const expectancy = totalTrades > 0 ? totalPnl / totalTrades : 0;

  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  const equityCurve: { time: string; equity: number; drawdownPct: number }[] = [];
  
  equityCurve.push({ time: "start", equity: initialCapital, drawdownPct: 0 });
  
  for (const trade of trades) {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, dd);
    const currentDdPct = peak > 0 ? (dd / peak) * 100 : 0;
    
    equityCurve.push({
      time: trade.exitTime.toISOString(),
      equity: Number(equity.toFixed(2)),
      drawdownPct: Number(currentDdPct.toFixed(4)),
    });
  }
  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  const returns = trades.map(t => t.pnl / initialCapital);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdDev = returns.length > 1 
    ? Math.sqrt(returns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    netPnl: totalPnl,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    maxDrawdownPct,
    avgWin,
    avgLoss,
    expectancy,
    equityCurve,
    grossProfit,
    grossLoss,
  };
}

export async function queueBaselineBacktest(
  botId: string, 
  traceId: string,
  options?: { forceNew?: boolean; reason?: string }
): Promise<string | null> {
  const { forceNew = false, reason } = options || {};
  
  try {
    const bot = await storage.getBot(botId);
    if (!bot) {
      console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_not_found bot_id=${botId}`);
      return null;
    }

    const existingSession = await storage.getLatestBacktestSession(botId);
    
    // FIX: Respect metrics_reset_at - only treat as valid baseline if completed AFTER reset
    const metricsResetAt = (bot as any).metricsResetAt;
    let hasValidBaseline = false;
    
    if (existingSession && existingSession.status === "completed") {
      // FIX: A baseline with 0 trades is NOT valid - strategy needs to generate trades
      const hasTrades = (existingSession.totalTrades || 0) > 0;
      
      if (!hasTrades) {
        console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} baseline_invalid_zero_trades session_id=${existingSession.id}`);
        hasValidBaseline = false;
      } else if (metricsResetAt) {
        // If metrics were reset, only valid if backtest completed AFTER reset
        const resetTime = new Date(metricsResetAt).getTime();
        const completedTime = existingSession.completedAt ? new Date(existingSession.completedAt).getTime() : 0;
        hasValidBaseline = completedTime > resetTime;
        
        if (!hasValidBaseline) {
          console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} baseline_stale_after_reset reset_at=${metricsResetAt} completed_at=${existingSession.completedAt}`);
        }
      } else {
        // No reset, existing completed session with trades is valid
        hasValidBaseline = true;
      }
    }
    
    // PROMOTION_GUARD: forceNew bypasses the valid baseline check to accumulate more trades
    if (hasValidBaseline && !forceNew) {
      console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} already_has_valid_baseline`);
      return existingSession!.id;
    }
    
    if (forceNew && hasValidBaseline) {
      console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} FORCE_NEW: bypassing valid baseline (${existingSession?.totalTrades} trades) reason=${reason || 'unspecified'}`);
    }

    const symbol = bot.symbol || (bot.name?.includes("MNQ") ? "MNQ" : "MES");
    
    // INSTITUTIONAL: Use full 5-year history for comprehensive backtesting
    // This ensures bots have statistically significant trade samples (50+ trades)
    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0); // Normalize to midnight
    const startDate = new Date(endDate.getTime() - BACKTEST_HISTORY_DAYS * 24 * 60 * 60 * 1000);

    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} queueing_5year_backtest days=${BACKTEST_HISTORY_DAYS} start=${startDate.toISOString()} end=${endDate.toISOString()}`);

    // INSTITUTIONAL: Always link session to current generation for data lineage
    const generationId = bot.currentGenerationId || null;
    if (!generationId) {
      console.warn(`[BACKTEST_EXECUTOR] trace_id=${traceId} bot_id=${botId} WARNING: No currentGenerationId - session will have broken lineage`);
    }

    const session = await storage.createBacktestSession({
      botId,
      generationId, // Critical: Links session to generation for audit trail
      status: "queued",
      symbol,
      startDate,
      endDate,
      initialCapital: 10000,
      configSnapshot: { 
        archetype: bot.archetypeId, 
        strategy: bot.strategyConfig,
        samplingMethod: "FULL_RANGE",
        historyDays: BACKTEST_HISTORY_DAYS,
        generationId, // Also store in config for redundancy
      },
    });

    await logActivityEvent({
      botId,
      eventType: "BACKTEST_STARTED",
      severity: "INFO",
      title: `Backtest queued for ${bot.name}`,
      summary: `5-year full-range backtest queued on ${symbol} (${BACKTEST_HISTORY_DAYS} days)`,
      payload: { sessionId: session.id, symbol, status: "QUEUED", historyDays: BACKTEST_HISTORY_DAYS },
      traceId,
      symbol,
      dedupeKey: `backtest_queued_${botId}_${session.id}`,
    });

    await storage.createBotJob({
      botId,
      jobType: "BACKTESTER",
      status: "QUEUED",
      priority: 5,
      payload: {
        sessionId: session.id,
        symbol,
        timeframe: "5m",
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        initialCapital: 10000,
        samplingMethod: "FULL_RANGE",
        historyDays: BACKTEST_HISTORY_DAYS,
        traceId,
      },
    });

    console.log(`[BACKTEST_EXECUTOR] trace_id=${traceId} queued_baseline session_id=${session.id} bot_id=${botId}`);

    return session.id;
  } catch (error) {
    console.error(`[BACKTEST_EXECUTOR] trace_id=${traceId} queue_baseline_error=`, error);
    return null;
  }
}
