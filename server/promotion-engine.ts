/**
 * Promotion Engine - Automated Bot Stage Promotion Pipeline
 * 
 * Institutional-grade promotion/demotion logic with metric-based gates.
 * Handles autonomous stage transitions and audit trail logging.
 * 
 * Valid stages: TRIALS (LAB) → PAPER → SHADOW → CANARY → LIVE
 */

import { db, withTracedTransaction, DbTransaction } from "./db";
import { bots, botStageChanges, backtestSessions } from "@shared/schema";
import type { Bot, InsertBotStageChange } from "@shared/schema";
import { eq, desc, and, gte, isNull } from "drizzle-orm";
import { logActivityEvent, logBotPromotion, logBotDemotion } from "./activity-logger";
import { storage } from "./storage";
import { validatePromotionGate, formatValidationErrors } from "./fail-fast-validators";

// Valid stage progression (TRIALS is internally called LAB in task requirements)
export const BOT_STAGES = ["TRIALS", "PAPER", "SHADOW", "CANARY", "LIVE"] as const;
export type BotStage = typeof BOT_STAGES[number];

// Stage aliases for compatibility
const STAGE_ALIASES: Record<string, BotStage> = {
  LAB: "TRIALS",
  TRIALS: "TRIALS",
  PAPER: "PAPER",
  SHADOW: "SHADOW",
  CANARY: "CANARY",
  LIVE: "LIVE",
};

function normalizeStage(stage: string): BotStage {
  const normalized = STAGE_ALIASES[stage?.toUpperCase()] || "TRIALS";
  return normalized as BotStage;
}

function getStageIndex(stage: string): number {
  return BOT_STAGES.indexOf(normalizeStage(stage));
}

function getNextStage(currentStage: string): BotStage | null {
  const idx = getStageIndex(currentStage);
  if (idx < 0 || idx >= BOT_STAGES.length - 1) return null;
  return BOT_STAGES[idx + 1];
}

function getPreviousStage(currentStage: string): BotStage | null {
  const idx = getStageIndex(currentStage);
  if (idx <= 0) return null;
  return BOT_STAGES[idx - 1];
}

// Promotion Gates Configuration
export interface PromotionGateConfig {
  minConfidenceScore?: number;
  minUniquenessScore?: number;
  minWinRate?: number;
  minProfitFactor?: number;
  minTrades?: number;
  minSharpeRatio?: number;
  maxDrawdown?: number;
  minDays?: number;
  requiresApproval?: boolean;
}

export const PROMOTION_GATES: Record<string, PromotionGateConfig> = {
  // TRIALS (LAB) → PAPER: confidence and uniqueness scores
  "TRIALS_TO_PAPER": {
    minConfidenceScore: 65,
    minUniquenessScore: 40,
  },
  // PAPER → SHADOW: trade performance metrics
  "PAPER_TO_SHADOW": {
    minWinRate: 45,
    minProfitFactor: 1.2,
    minTrades: 20,
  },
  // SHADOW → CANARY: stricter performance with time requirement
  "SHADOW_TO_CANARY": {
    minWinRate: 50,
    minProfitFactor: 1.4,
    minSharpeRatio: 0.8,
    maxDrawdown: 15,
    minDays: 5,
  },
  // CANARY → LIVE: requires maker-checker approval
  "CANARY_TO_LIVE": {
    requiresApproval: true,
  },
};

// Demotion Thresholds Configuration
export interface DemotionThresholdConfig {
  maxDrawdown?: number;
  minProfitFactor?: number;
  minSharpeRatio?: number;
  maxConsecutiveLosingDays?: number;
  minWinRate?: number;
}

export const DEMOTION_THRESHOLDS: Record<string, DemotionThresholdConfig> = {
  // LIVE → CANARY: severe risk breach
  "LIVE_TO_CANARY": {
    maxDrawdown: 20,
    minProfitFactor: 1.0,
  },
  // CANARY → SHADOW: degraded performance
  "CANARY_TO_SHADOW": {
    minSharpeRatio: 0.5,
    maxConsecutiveLosingDays: 3,
  },
  // SHADOW → PAPER: poor win rate
  "SHADOW_TO_PAPER": {
    minWinRate: 35,
  },
};

// Bot metrics interface for evaluation
export interface BotMetrics {
  confidenceScore: number;
  uniquenessScore: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  sharpeRatio: number;
  maxDrawdown: number;
  daysActive: number;
  consecutiveLosingDays: number;
  expectancy?: number | null;  // Can be null for legacy bots without expectancy tracking
  hasApproval: boolean;
}

// Promotion evaluation result
export interface PromotionEvaluation {
  eligible: boolean;
  targetStage: string;
  blockers: string[];
  metrics: Partial<BotMetrics>;
}

// Demotion evaluation result
export interface DemotionEvaluation {
  shouldDemote: boolean;
  targetStage: string;
  reason: string;
  metrics: Partial<BotMetrics>;
}

// Promotion execution result
export interface PromotionResult {
  success: boolean;
  botId: string;
  fromStage: string;
  toStage: string;
  stageChangeId: string | null;
  activityEventId: string | null;
  error?: string;
}

/**
 * Extract bot metrics from database and backtest sessions
 */
async function getBotMetrics(bot: Bot): Promise<BotMetrics> {
  const stage = normalizeStage(bot.stage || "TRIALS");
  
  // Get latest backtest session for confidence/uniqueness scores
  let confidenceScore = 0;
  let uniquenessScore = 0;
  let backtestWinRate = 0;
  let backtestPF = 0;
  let backtestTrades = 0;
  let backtestSharpe = 0;
  let backtestMaxDD = 0;
  let backtestExpectancy: number | null = null;
  
  try {
    const [latestBacktest] = await db
      .select()
      .from(backtestSessions)
      .where(eq(backtestSessions.botId, bot.id))
      .orderBy(desc(backtestSessions.endedAt))
      .limit(1);
    
    if (latestBacktest?.results) {
      const results = latestBacktest.results as Record<string, any>;
      confidenceScore = results.confidenceScore ?? results.confidence_score ?? 0;
      uniquenessScore = results.uniquenessScore ?? results.uniqueness_score ?? 0;
      backtestWinRate = (results.winRate ?? results.win_rate ?? 0) * 100;
      backtestPF = results.profitFactor ?? results.profit_factor ?? 0;
      backtestTrades = results.totalTrades ?? results.total_trades ?? 0;
      backtestSharpe = results.sharpe ?? results.sharpeRatio ?? 0;
      backtestMaxDD = Math.abs(results.maxDrawdownPct ?? results.max_drawdown_pct ?? 0);
      backtestExpectancy = results.expectancy ?? (latestBacktest as any).expectancy ?? null;
      
      // Calculate expectancy if not stored: (winRate * avgWin) - ((1 - winRate) * avgLoss)
      // NOTE: winRate in results is in decimal form (0.0 to 1.0), NOT percentage
      if (backtestExpectancy === null && results.avgWin != null && results.avgLoss != null) {
        const avgWin = results.avgWin ?? results.avg_win ?? 0;
        const avgLoss = Math.abs(results.avgLoss ?? results.avg_loss ?? 0);
        // Normalize winRate to decimal (0.0-1.0) if stored as percentage
        let wr = results.winRate ?? results.win_rate ?? 0;
        if (wr > 1) {
          wr = wr / 100; // Convert from percentage to decimal
        }
        if (avgWin > 0 || avgLoss > 0) {
          backtestExpectancy = (wr * avgWin) - ((1 - wr) * avgLoss);
        }
      }
    }
  } catch (err) {
    console.warn(`[PROMOTION_ENGINE] Failed to fetch backtest for bot ${bot.id}:`, err);
  }
  
  // Use live metrics for PAPER+ stages, backtest for TRIALS
  const useLiveMetrics = stage !== "TRIALS";
  
  const winRate = useLiveMetrics ? (bot.liveWinRate ?? 0) * 100 : backtestWinRate;
  const profitFactor = useLiveMetrics 
    ? ((bot as any).liveProfitFactor ?? backtestPF) 
    : backtestPF;
  const totalTrades = useLiveMetrics ? (bot.liveTotalTrades ?? 0) : backtestTrades;
  const sharpeRatio = useLiveMetrics 
    ? ((bot as any).liveSharpe ?? backtestSharpe) 
    : backtestSharpe;
  const maxDrawdown = useLiveMetrics 
    ? ((bot as any).liveMaxDrawdown ?? backtestMaxDD) 
    : backtestMaxDD;
  
  // Calculate days active based on stage update
  const stageUpdatedAt = bot.stageUpdatedAt ? new Date(bot.stageUpdatedAt) : bot.createdAt;
  const daysActive = stageUpdatedAt 
    ? Math.floor((Date.now() - new Date(stageUpdatedAt).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  
  // Consecutive losing days - would need trade log analysis
  // For now, default to 0 (can be enhanced with actual trade log queries)
  const consecutiveLosingDays = 0;
  
  // Compute expectancy from live or backtest data
  const expectancy = useLiveMetrics
    ? ((bot as any).liveExpectancy ?? backtestExpectancy)
    : backtestExpectancy;
  
  return {
    confidenceScore,
    uniquenessScore,
    winRate,
    profitFactor,
    totalTrades,
    sharpeRatio,
    maxDrawdown,
    daysActive,
    consecutiveLosingDays,
    expectancy,
    hasApproval: bot.promotionMode === "MANUAL_APPROVED",
  };
}

/**
 * Evaluate if a bot is eligible for promotion to the next stage
 */
export async function evaluateBotForPromotion(botId: string): Promise<PromotionEvaluation> {
  const bot = await storage.getBot(botId);
  
  if (!bot) {
    return {
      eligible: false,
      targetStage: "",
      blockers: ["Bot not found"],
      metrics: {},
    };
  }
  
  const currentStage = normalizeStage(bot.stage || "TRIALS");
  const targetStage = getNextStage(currentStage);
  
  if (!targetStage) {
    return {
      eligible: false,
      targetStage: currentStage,
      blockers: ["Bot is already at maximum stage (LIVE)"],
      metrics: {},
    };
  }
  
  // Check if bot is archived or killed
  if (bot.archivedAt || bot.killedAt) {
    return {
      eligible: false,
      targetStage: "",
      blockers: ["Bot is archived or killed"],
      metrics: {},
    };
  }
  
  // Check stage lock
  if (bot.stageLockedUntil && new Date(bot.stageLockedUntil) > new Date()) {
    return {
      eligible: false,
      targetStage: "",
      blockers: [`Stage locked until ${bot.stageLockedUntil} - ${bot.stageLockReason || 'Unknown reason'}`],
      metrics: {},
    };
  }
  
  const metrics = await getBotMetrics(bot);
  const gateKey = `${currentStage}_TO_${targetStage}`;
  const gates = PROMOTION_GATES[gateKey];
  
  // SEV-0 HARD STOP: Validate ALL critical metrics are non-null before any promotion
  // This is a circuit breaker - any NULL metric blocks the entire promotion
  const traceId = `promo_${botId.slice(0, 8)}_${Date.now()}`;
  const gateValidation = validatePromotionGate({
    metrics: {
      sharpeRatio: metrics.sharpeRatio,
      maxDrawdownPercent: metrics.maxDrawdown,
      winRate: metrics.winRate,
      totalTrades: metrics.totalTrades,
      profitFactor: metrics.profitFactor,
      expectancy: metrics.expectancy,
    },
    fromStage: currentStage,
    toStage: targetStage,
    botId,
    traceId,
  });
  
  if (!gateValidation.valid) {
    // Circuit breaker: Block promotion with NULL metrics
    const errorMessages = gateValidation.errors.map(e => `[${e.severity}] ${e.message}`);
    console.error(`[PROMOTION_ENGINE] HARD_STOP trace_id=${traceId} bot=${botId.slice(0, 8)} ${currentStage}→${targetStage} NULL_METRICS_BLOCKED`);
    return {
      eligible: false,
      targetStage,
      blockers: errorMessages,
      metrics,
    };
  }
  
  if (!gates) {
    return {
      eligible: false,
      targetStage: targetStage,
      blockers: [`No promotion gates configured for ${gateKey}`],
      metrics,
    };
  }
  
  const blockers: string[] = [];
  
  // Evaluate each gate
  if (gates.minConfidenceScore !== undefined && metrics.confidenceScore < gates.minConfidenceScore) {
    blockers.push(`Confidence score ${metrics.confidenceScore.toFixed(1)} < required ${gates.minConfidenceScore}`);
  }
  
  if (gates.minUniquenessScore !== undefined && metrics.uniquenessScore < gates.minUniquenessScore) {
    blockers.push(`Uniqueness score ${metrics.uniquenessScore.toFixed(1)} < required ${gates.minUniquenessScore}`);
  }
  
  if (gates.minWinRate !== undefined && metrics.winRate < gates.minWinRate) {
    blockers.push(`Win rate ${metrics.winRate.toFixed(1)}% < required ${gates.minWinRate}%`);
  }
  
  if (gates.minProfitFactor !== undefined && metrics.profitFactor < gates.minProfitFactor) {
    blockers.push(`Profit factor ${metrics.profitFactor.toFixed(2)} < required ${gates.minProfitFactor}`);
  }
  
  if (gates.minTrades !== undefined && metrics.totalTrades < gates.minTrades) {
    blockers.push(`Total trades ${metrics.totalTrades} < required ${gates.minTrades}`);
  }
  
  if (gates.minSharpeRatio !== undefined && metrics.sharpeRatio < gates.minSharpeRatio) {
    blockers.push(`Sharpe ratio ${metrics.sharpeRatio.toFixed(2)} < required ${gates.minSharpeRatio}`);
  }
  
  if (gates.maxDrawdown !== undefined && metrics.maxDrawdown > gates.maxDrawdown) {
    blockers.push(`Max drawdown ${metrics.maxDrawdown.toFixed(1)}% > allowed ${gates.maxDrawdown}%`);
  }
  
  if (gates.minDays !== undefined && metrics.daysActive < gates.minDays) {
    blockers.push(`Days in stage ${metrics.daysActive} < required ${gates.minDays}`);
  }
  
  if (gates.requiresApproval && !metrics.hasApproval) {
    blockers.push(`Requires maker-checker approval for ${targetStage} promotion`);
  }
  
  return {
    eligible: blockers.length === 0,
    targetStage,
    blockers,
    metrics,
  };
}

/**
 * Evaluate if a bot should be demoted based on performance thresholds
 */
export async function evaluateBotForDemotion(botId: string): Promise<DemotionEvaluation> {
  const bot = await storage.getBot(botId);
  
  if (!bot) {
    return {
      shouldDemote: false,
      targetStage: "",
      reason: "Bot not found",
      metrics: {},
    };
  }
  
  const currentStage = normalizeStage(bot.stage || "TRIALS");
  
  // Can't demote from TRIALS
  if (currentStage === "TRIALS") {
    return {
      shouldDemote: false,
      targetStage: currentStage,
      reason: "Already at minimum stage",
      metrics: {},
    };
  }
  
  const metrics = await getBotMetrics(bot);
  const previousStage = getPreviousStage(currentStage);
  
  if (!previousStage) {
    return {
      shouldDemote: false,
      targetStage: currentStage,
      reason: "No previous stage available",
      metrics,
    };
  }
  
  const thresholdKey = `${currentStage}_TO_${previousStage}`;
  const thresholds = DEMOTION_THRESHOLDS[thresholdKey];
  
  if (!thresholds) {
    return {
      shouldDemote: false,
      targetStage: currentStage,
      reason: `No demotion thresholds for ${thresholdKey}`,
      metrics,
    };
  }
  
  const reasons: string[] = [];
  
  // Check demotion thresholds
  if (thresholds.maxDrawdown !== undefined && metrics.maxDrawdown > thresholds.maxDrawdown) {
    reasons.push(`Drawdown ${metrics.maxDrawdown.toFixed(1)}% exceeds ${thresholds.maxDrawdown}%`);
  }
  
  if (thresholds.minProfitFactor !== undefined && metrics.profitFactor < thresholds.minProfitFactor) {
    reasons.push(`Profit factor ${metrics.profitFactor.toFixed(2)} below ${thresholds.minProfitFactor}`);
  }
  
  if (thresholds.minSharpeRatio !== undefined && metrics.sharpeRatio < thresholds.minSharpeRatio) {
    reasons.push(`Sharpe ratio ${metrics.sharpeRatio.toFixed(2)} below ${thresholds.minSharpeRatio}`);
  }
  
  if (thresholds.maxConsecutiveLosingDays !== undefined && metrics.consecutiveLosingDays >= thresholds.maxConsecutiveLosingDays) {
    reasons.push(`${metrics.consecutiveLosingDays} consecutive losing days exceeds ${thresholds.maxConsecutiveLosingDays}`);
  }
  
  if (thresholds.minWinRate !== undefined && metrics.winRate < thresholds.minWinRate) {
    reasons.push(`Win rate ${metrics.winRate.toFixed(1)}% below ${thresholds.minWinRate}%`);
  }
  
  return {
    shouldDemote: reasons.length > 0,
    targetStage: reasons.length > 0 ? previousStage : currentStage,
    reason: reasons.join("; ") || "No demotion triggers",
    metrics,
  };
}

/**
 * Execute bot promotion - update database and create audit trail
 * 
 * INSTITUTIONAL: Uses transactional wrapper for atomic execution
 * Critical database operations (bot stage update, stage change log) are
 * wrapped in a transaction. Activity logging and notifications run after
 * transaction commits to preserve their side effects (AI feedback, Discord).
 * On transaction failure, all critical changes are automatically rolled back.
 */
export async function executePromotion(
  botId: string,
  targetStage: string,
  approvedBy?: string,
  triggeredBy: "autonomous" | "manual" = "autonomous"
): Promise<PromotionResult> {
  const bot = await storage.getBot(botId);
  
  if (!bot) {
    return {
      success: false,
      botId,
      fromStage: "",
      toStage: targetStage,
      stageChangeId: null,
      activityEventId: null,
      error: "Bot not found",
    };
  }
  
  const fromStage = normalizeStage(bot.stage || "TRIALS");
  const normalizedTarget = normalizeStage(targetStage);
  
  // Validate stage transition
  const fromIdx = getStageIndex(fromStage);
  const toIdx = getStageIndex(normalizedTarget);
  
  if (toIdx <= fromIdx) {
    return {
      success: false,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId: null,
      activityEventId: null,
      error: `Invalid promotion: ${fromStage} → ${normalizedTarget} (must advance)`,
    };
  }
  
  const traceId = `promo-${botId.substring(0, 8)}-${Date.now().toString(36)}`;
  
  try {
    // TRANSACTIONAL: Critical DB operations are atomic - rollback on any failure
    const stageChangeId = await withTracedTransaction(
      traceId,
      `BOT_PROMOTION ${bot.name}: ${fromStage}→${normalizedTarget}`,
      async (tx: DbTransaction) => {
        // 1. Update bot stage in database
        await tx
          .update(bots)
          .set({
            stage: normalizedTarget,
            stageUpdatedAt: new Date(),
            stageReasonCode: triggeredBy === "autonomous" ? "AUTO_PROMOTION" : "MANUAL_PROMOTION",
            updatedAt: new Date(),
          })
          .where(eq(bots.id, botId));
        
        // 2. Log stage change to bot_stage_changes table (audit trail)
        const stageChangeData: InsertBotStageChange = {
          botId,
          fromStage,
          toStage: normalizedTarget,
          decision: "PROMOTED",
          reasonsJson: {
            triggeredBy,
            approvedBy: approvedBy || null,
            timestamp: new Date().toISOString(),
            traceId,
          },
          triggeredBy: approvedBy || "system",
        };
        
        const [stageChange] = await tx
          .insert(botStageChanges)
          .values(stageChangeData)
          .returning({ id: botStageChanges.id });
        
        return stageChange?.id || null;
      }
    );
    
    // POST-TRANSACTION: Activity logging with side effects (AI feedback, notifications)
    // Runs after commit to ensure side effects only trigger on successful promotion
    const activityEventId = await logBotPromotion(
      bot.userId,
      botId,
      bot.name,
      fromStage,
      normalizedTarget,
      traceId,
      triggeredBy
    );
    
    console.log(`[PROMOTION_ENGINE] trace_id=${traceId} Promoted bot ${bot.name} (${botId}): ${fromStage} → ${normalizedTarget}`);
    
    return {
      success: true,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId,
      activityEventId,
    };
  } catch (error) {
    console.error(`[PROMOTION_ENGINE] trace_id=${traceId} Failed to promote bot ${botId}:`, error);
    return {
      success: false,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId: null,
      activityEventId: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute bot demotion - update database and create audit trail
 * 
 * INSTITUTIONAL: Uses transactional wrapper for atomic execution
 * Critical database operations (bot stage update, stage change log) are
 * wrapped in a transaction. Activity logging and notifications run after
 * transaction commits to preserve their side effects (AI feedback, Discord).
 * On transaction failure, all critical changes are automatically rolled back.
 */
export async function executeDemotion(
  botId: string,
  targetStage: string,
  reason: string,
  triggeredBy: "autonomous" | "manual" | "risk_breach" | "self_healing" = "autonomous"
): Promise<PromotionResult> {
  const bot = await storage.getBot(botId);
  
  if (!bot) {
    return {
      success: false,
      botId,
      fromStage: "",
      toStage: targetStage,
      stageChangeId: null,
      activityEventId: null,
      error: "Bot not found",
    };
  }
  
  const fromStage = normalizeStage(bot.stage || "TRIALS");
  const normalizedTarget = normalizeStage(targetStage);
  
  // Validate stage transition
  const fromIdx = getStageIndex(fromStage);
  const toIdx = getStageIndex(normalizedTarget);
  
  if (toIdx >= fromIdx) {
    return {
      success: false,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId: null,
      activityEventId: null,
      error: `Invalid demotion: ${fromStage} → ${normalizedTarget} (must go down)`,
    };
  }
  
  const traceId = `demo-${botId.substring(0, 8)}-${Date.now().toString(36)}`;
  
  try {
    // TRANSACTIONAL: Critical DB operations are atomic - rollback on any failure
    const stageChangeId = await withTracedTransaction(
      traceId,
      `BOT_DEMOTION ${bot.name}: ${fromStage}→${normalizedTarget}`,
      async (tx: DbTransaction) => {
        // 1. Update bot stage in database
        await tx
          .update(bots)
          .set({
            stage: normalizedTarget,
            stageUpdatedAt: new Date(),
            stageReasonCode: triggeredBy === "risk_breach" ? "RISK_DEMOTION" : "AUTO_DEMOTION",
            updatedAt: new Date(),
          })
          .where(eq(bots.id, botId));
        
        // 2. Log stage change to bot_stage_changes table (audit trail)
        const stageChangeData: InsertBotStageChange = {
          botId,
          fromStage,
          toStage: normalizedTarget,
          decision: "DEMOTED",
          reasonsJson: {
            triggeredBy,
            reason,
            timestamp: new Date().toISOString(),
            traceId,
          },
          triggeredBy: "system",
        };
        
        const [stageChange] = await tx
          .insert(botStageChanges)
          .values(stageChangeData)
          .returning({ id: botStageChanges.id });
        
        return stageChange?.id || null;
      }
    );
    
    // POST-TRANSACTION: Activity logging with side effects (AI feedback, notifications)
    // Runs after commit to ensure side effects only trigger on successful demotion
    const activityEventId = await logBotDemotion(
      bot.userId,
      botId,
      bot.name,
      fromStage,
      normalizedTarget,
      reason,
      traceId,
      triggeredBy
    );
    
    console.log(`[PROMOTION_ENGINE] trace_id=${traceId} Demoted bot ${bot.name} (${botId}): ${fromStage} → ${normalizedTarget} - ${reason}`);
    
    return {
      success: true,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId,
      activityEventId,
    };
  } catch (error) {
    console.error(`[PROMOTION_ENGINE] trace_id=${traceId} Failed to demote bot ${botId}:`, error);
    return {
      success: false,
      botId,
      fromStage,
      toStage: normalizedTarget,
      stageChangeId: null,
      activityEventId: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Scheduled Promotion Worker - Evaluate all active bots for promotion/demotion
 * Called by the scheduler on a regular interval
 */
export async function runPromotionWorker(): Promise<{
  promotions: PromotionResult[];
  demotions: PromotionResult[];
  evaluated: number;
  errors: string[];
}> {
  const startTime = Date.now();
  const promotions: PromotionResult[] = [];
  const demotions: PromotionResult[] = [];
  const errors: string[] = [];
  
  try {
    // Get all active bots (not archived, not killed)
    const activeBots = await db
      .select()
      .from(bots)
      .where(
        and(
          isNull(bots.archivedAt),
          isNull(bots.killedAt)
        )
      );
    
    console.log(`[PROMOTION_ENGINE] Evaluating ${activeBots.length} active bots for stage changes`);
    
    for (const bot of activeBots) {
      try {
        // Skip bots with manual promotion mode unless they have approval
        if (bot.promotionMode === "MANUAL" && bot.stage !== "CANARY") {
          continue;
        }
        
        // First check for demotion (higher priority)
        const demotionEval = await evaluateBotForDemotion(bot.id);
        if (demotionEval.shouldDemote) {
          const result = await executeDemotion(
            bot.id,
            demotionEval.targetStage,
            demotionEval.reason,
            "autonomous"
          );
          demotions.push(result);
          continue; // Don't check for promotion if demoted
        }
        
        // Check for promotion
        const promotionEval = await evaluateBotForPromotion(bot.id);
        if (promotionEval.eligible) {
          // Skip CANARY → LIVE without approval
          const gates = PROMOTION_GATES[`${normalizeStage(bot.stage || "TRIALS")}_TO_${promotionEval.targetStage}`];
          if (gates?.requiresApproval) {
            console.log(`[PROMOTION_ENGINE] Bot ${bot.name} eligible for ${promotionEval.targetStage} but requires approval`);
            continue;
          }
          
          const result = await executePromotion(
            bot.id,
            promotionEval.targetStage,
            undefined,
            "autonomous"
          );
          promotions.push(result);
        }
      } catch (err) {
        const errorMsg = `Failed to evaluate bot ${bot.id}: ${err instanceof Error ? err.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`[PROMOTION_ENGINE] ${errorMsg}`);
      }
    }
    
    const durationMs = Date.now() - startTime;
    console.log(`[PROMOTION_ENGINE] Worker completed in ${durationMs}ms - ${promotions.length} promotions, ${demotions.length} demotions, ${errors.length} errors`);
    
    return {
      promotions,
      demotions,
      evaluated: activeBots.length,
      errors,
    };
  } catch (err) {
    const errorMsg = `Promotion worker failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
    errors.push(errorMsg);
    console.error(`[PROMOTION_ENGINE] ${errorMsg}`);
    
    return {
      promotions,
      demotions,
      evaluated: 0,
      errors,
    };
  }
}

/**
 * Get promotion gates configuration for a specific transition
 */
export function getPromotionGates(fromStage: string, toStage: string): PromotionGateConfig | null {
  const key = `${normalizeStage(fromStage)}_TO_${normalizeStage(toStage)}`;
  return PROMOTION_GATES[key] || null;
}

/**
 * Get demotion thresholds for a specific transition
 */
export function getDemotionThresholds(fromStage: string, toStage: string): DemotionThresholdConfig | null {
  const key = `${normalizeStage(fromStage)}_TO_${normalizeStage(toStage)}`;
  return DEMOTION_THRESHOLDS[key] || null;
}

/**
 * Check if a bot can be manually promoted to a target stage
 */
export async function canManuallyPromote(botId: string, targetStage: string): Promise<{
  canPromote: boolean;
  reason: string;
}> {
  const bot = await storage.getBot(botId);
  
  if (!bot) {
    return { canPromote: false, reason: "Bot not found" };
  }
  
  const currentStage = normalizeStage(bot.stage || "TRIALS");
  const normalizedTarget = normalizeStage(targetStage);
  
  const currentIdx = getStageIndex(currentStage);
  const targetIdx = getStageIndex(normalizedTarget);
  
  if (targetIdx <= currentIdx) {
    return { canPromote: false, reason: "Target stage must be higher than current stage" };
  }
  
  if (bot.archivedAt || bot.killedAt) {
    return { canPromote: false, reason: "Bot is archived or killed" };
  }
  
  if (bot.stageLockedUntil && new Date(bot.stageLockedUntil) > new Date()) {
    return { canPromote: false, reason: `Stage locked until ${bot.stageLockedUntil}` };
  }
  
  return { canPromote: true, reason: "OK" };
}
