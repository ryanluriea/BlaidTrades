import crypto from "crypto";
import { db } from "./db";
import { strategyCandidates, labFeedbackTracking, bots, botJobs, botStageChanges, users, grokInjections } from "@shared/schema";
import type { LabFeedbackTracking } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { storage } from "./storage";
import { 
  runPerplexityResearch, 
  calculateConfidenceScore,
  generateRulesHash,
  calculateRegimeAdjustedScore,
  type ResearchCandidate,
  type ResearchContext,
} from "./ai-strategy-evolution";
import { 
  detectStrategyLabTrigger,
  detectMarketRegime,
  type StrategyLabRegimeTrigger,
  getStrategyLabTriggerDescription,
} from "./regime-detector";
import { queueBaselineBacktest } from "./backtest-executor";
import { validateArchetype, validateSymbol, validateSessionMode, formatValidationErrors, recordFallback } from "./fail-fast-validators";
import { inferArchetypeFromName, type StrategyArchetype } from "@shared/strategy-types";

const MIN_CONFIDENCE_FOR_LAB = 65;
const MIN_CONFIDENCE_FOR_QUEUE = 40;
const DEFAULT_USER_ID = "489c9350-10da-4fb9-8f6b-aeffc9412a46";
const SYMBOLS_TO_MONITOR = ["MES", "MNQ"];

/**
 * DUPLICATE PREVENTION: Normalize bot name to a canonical slug for comparison
 * Strips spaces, punctuation, and lowercases to catch near-duplicates like:
 * "VolComp Break" vs "VolCompBreak" vs "Vol Comp Break"
 */
export function normalizeNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
    .trim();
}

/**
 * Infer archetype from bot name for backtest job payload (local version)
 * Bot names follow pattern: "{StrategyType} {Variant}" e.g., "Vol Squeeze BB", "Tick Arb MNQ"
 * Returns CANONICAL uppercase snake_case archetype (e.g., "SCALPING", "BREAKOUT")
 */
function inferArchetypeFromBotNameLocal(botName: string): string | null {
  const nameLower = botName.toLowerCase();
  
  // Pattern matching - returns canonical uppercase values matching normalizeArchetype
  // Added: EMA, Pullback, Overnight, Unwind, MACD, MTF patterns
  if (nameLower.includes('squeeze') || nameLower.includes('compression')) return 'BREAKOUT';
  if (nameLower.includes('arb') || nameLower.includes('arbitrage')) return 'MEAN_REVERSION';
  if (nameLower.includes('momo') || nameLower.includes('momentum')) return 'TREND_FOLLOWING';
  if (nameLower.includes('scalp')) return 'SCALPING';
  if (nameLower.includes('gap')) return 'GAP_FADE';
  if (nameLower.includes('fade')) return 'GAP_FADE';
  if (nameLower.includes('revert') || nameLower.includes('reversal')) return 'MEAN_REVERSION';
  if (nameLower.includes('vwap')) return 'VWAP_BOUNCE';
  if (nameLower.includes('break') || nameLower.includes('breakout')) return 'BREAKOUT';
  if (nameLower.includes('trend')) return 'TREND_FOLLOWING';
  if (nameLower.includes('range') || nameLower.includes('mean')) return 'MEAN_REVERSION';
  if (nameLower.includes('vol') || nameLower.includes('volatility')) return 'BREAKOUT';
  if (nameLower.includes('hybrid')) return 'SCALPING';
  
  // NEW: Additional patterns for missing archetypes
  if (nameLower.includes('ema') || nameLower.includes('pullback')) return 'TREND_FOLLOWING';
  if (nameLower.includes('macd') || nameLower.includes('mtf')) return 'TREND_FOLLOWING';
  if (nameLower.includes('overnight') || nameLower.includes('unwind')) return 'GAP_FADE';
  if (nameLower.includes('auction') || nameLower.includes('liquidity')) return 'MEAN_REVERSION';
  if (nameLower.includes('cross') || nameLower.includes('signal')) return 'TREND_FOLLOWING';
  
  return null;
}

// =============================================================================
// NOVELTY/UNIQUENESS SCORE CALCULATION
// Measures how different a strategy is from existing portfolio strategies
// =============================================================================

interface NoveltyComparisonData {
  id: string;
  archetype_name: string | null;
  hypothesis: string | null;
  rules_json: any;
}

/**
 * Calculate text similarity using Jaccard index on word tokens
 */
function calculateTextSimilarity(text1: string | null, text2: string | null): number {
  if (!text1 || !text2) return 0;
  
  const tokenize = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
    );
  };
  
  const set1 = tokenize(text1);
  const set2 = tokenize(text2);
  
  if (set1.size === 0 || set2.size === 0) return 0;
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Calculate rules similarity by comparing entry/exit/filter keywords
 */
function calculateRulesSimilarity(rules1: any, rules2: any): number {
  if (!rules1 || !rules2) return 0;
  
  const extractKeywords = (rules: any): Set<string> => {
    const keywords = new Set<string>();
    const addFromArray = (arr: any[] | string | undefined) => {
      if (!arr) return;
      const items = Array.isArray(arr) ? arr : [arr];
      items.forEach(item => {
        if (typeof item === 'string') {
          item.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w: string) => w.length > 2)
            .forEach((w: string) => keywords.add(w));
        }
      });
    };
    
    addFromArray(rules.entry);
    addFromArray(rules.exit);
    addFromArray(rules.filters);
    addFromArray(rules.risk);
    
    return keywords;
  };
  
  const set1 = extractKeywords(rules1);
  const set2 = extractKeywords(rules2);
  
  if (set1.size === 0 || set2.size === 0) return 0;
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Calculate novelty score for a single strategy against all others
 * Returns 0-100 where 100 = completely unique, 0 = identical to existing
 */
export function calculateNoveltyScore(
  candidate: NoveltyComparisonData,
  allCandidates: NoveltyComparisonData[]
): number {
  // Filter out self and get comparison set
  const others = allCandidates.filter(c => c.id !== candidate.id);
  
  if (others.length === 0) {
    // First strategy is completely unique
    return 100;
  }
  
  let maxSimilarity = 0;
  
  for (const other of others) {
    // 1. Archetype similarity (40% weight)
    // Handle null/missing archetypes: treat as uncertain (0.5 similarity)
    let archetypeSim: number;
    if (!candidate.archetype_name || !other.archetype_name) {
      // Either is missing - uncertain, assume 50% similar (neither unique nor duplicate)
      archetypeSim = 0.5;
    } else {
      // Both present - exact match or not
      archetypeSim = candidate.archetype_name === other.archetype_name ? 1 : 0;
    }
    
    // 2. Hypothesis similarity (30% weight)
    const hypothesisSim = calculateTextSimilarity(candidate.hypothesis, other.hypothesis);
    
    // 3. Rules similarity (30% weight)
    const rulesSim = calculateRulesSimilarity(candidate.rules_json, other.rules_json);
    
    // Weighted average
    const overallSim = (archetypeSim * 0.4) + (hypothesisSim * 0.3) + (rulesSim * 0.3);
    
    if (overallSim > maxSimilarity) {
      maxSimilarity = overallSim;
    }
  }
  
  // Convert similarity to uniqueness (inverse)
  const novelty = (1 - maxSimilarity) * 100;
  
  // Ensure bounds
  return Math.max(0, Math.min(100, Math.round(novelty)));
}

/**
 * Backfill novelty scores for all strategy candidates
 */
export async function backfillNoveltyScores(): Promise<{ updated: number; errors: number }> {
  console.log("[NOVELTY_BACKFILL] Starting novelty score backfill...");
  
  // Get all candidates
  const result = await db.execute(sql`
    SELECT id, archetype_name, hypothesis, rules_json
    FROM strategy_candidates
  `);
  
  const candidates = result.rows as NoveltyComparisonData[];
  console.log(`[NOVELTY_BACKFILL] Found ${candidates.length} candidates to process`);
  
  let updated = 0;
  let errors = 0;
  
  for (const candidate of candidates) {
    try {
      const noveltyScore = calculateNoveltyScore(candidate, candidates);
      
      await db.execute(sql`
        UPDATE strategy_candidates
        SET novelty_score = ${noveltyScore}
        WHERE id = ${candidate.id}
      `);
      
      updated++;
    } catch (err) {
      console.error(`[NOVELTY_BACKFILL] Error updating ${candidate.id}:`, err);
      errors++;
    }
  }
  
  console.log(`[NOVELTY_BACKFILL] Complete: ${updated} updated, ${errors} errors`);
  
  return { updated, errors };
}

// =============================================================================
// ARCHETYPE-SPECIFIC MINIMUM EVALUATION WINDOWS (PHASE 2)
// Bots CANNOT be recycled until they meet these thresholds (except catastrophic)
// =============================================================================
export interface ArchetypeEvalThresholds {
  minTrades: number;
  minDays: number;
  minRegimes: number;
  description: string;
}

export const ARCHETYPE_EVAL_THRESHOLDS: Record<string, ArchetypeEvalThresholds> = {
  // Scalping strategies need more samples due to high frequency
  SCALPING: { minTrades: 75, minDays: 3, minRegimes: 2, description: "High-frequency scalping" },
  RANGE_SCALP: { minTrades: 80, minDays: 3, minRegimes: 2, description: "Range-bound scalping" },
  
  // Intraday strategies - medium sample requirements
  INTRADAY: { minTrades: 40, minDays: 5, minRegimes: 2, description: "Intraday trading" },
  MEAN_REVERSION: { minTrades: 60, minDays: 5, minRegimes: 2, description: "Mean reversion plays" },
  MOMENTUM_SURGE: { minTrades: 50, minDays: 5, minRegimes: 2, description: "Momentum bursts" },
  VWAP_TOUCH: { minTrades: 50, minDays: 5, minRegimes: 2, description: "VWAP-based entries" },
  VWAP_BOUNCE: { minTrades: 50, minDays: 5, minRegimes: 2, description: "VWAP bounce plays" },
  BREAKOUT: { minTrades: 40, minDays: 5, minRegimes: 2, description: "Breakout patterns" },
  RTH_BREAKOUT: { minTrades: 40, minDays: 5, minRegimes: 2, description: "RTH open breakouts" },
  
  // Swing strategies - fewer but larger trades
  SWING: { minTrades: 20, minDays: 7, minRegimes: 2, description: "Multi-day swings" },
  TREND_FOLLOWING: { minTrades: 30, minDays: 7, minRegimes: 2, description: "Trend continuation" },
  TREND_CONTINUATION: { minTrades: 30, minDays: 7, minRegimes: 2, description: "Trend riding" },
  
  // Position/event-based - rare occurrences
  POSITION: { minTrades: 10, minDays: 14, minRegimes: 2, description: "Long-term positions" },
  GAP_FADE: { minTrades: 25, minDays: 10, minRegimes: 2, description: "Gap fade strategies" },
  GAP_FILL: { minTrades: 25, minDays: 10, minRegimes: 2, description: "Gap fill plays" },
  
  // Default fallback
  DEFAULT: { minTrades: 30, minDays: 3, minRegimes: 2, description: "Standard evaluation" },
};

// Strategy class detection from timeframe
export type StrategyClass = "SCALPING" | "INTRADAY" | "SWING" | "POSITION";

export function detectStrategyClass(timeframe: string | string[]): StrategyClass {
  const tf = Array.isArray(timeframe) ? timeframe[0] : timeframe;
  if (!tf) return "INTRADAY";
  
  const lower = tf.toLowerCase();
  
  // Scalping: 1m, 2m, 3m
  if (/^[1-3]m$/i.test(lower)) return "SCALPING";
  
  // Intraday: 5m, 15m, 30m, 1h
  if (/^(5|10|15|30)m$/i.test(lower) || /^1h$/i.test(lower)) return "INTRADAY";
  
  // Swing: 4h, 1d, daily
  if (/^(2|4)h$/i.test(lower) || /^(1d|1D|daily)$/i.test(lower)) return "SWING";
  
  // Position: weekly, monthly
  if (/^(1w|1W|weekly|1M|monthly)$/i.test(lower)) return "POSITION";
  
  return "INTRADAY";
}

export function getMinTradesForClass(strategyClass: StrategyClass): number {
  switch (strategyClass) {
    case "SCALPING": return 75;
    case "INTRADAY": return 40;
    case "SWING": return 20;
    case "POSITION": return 10;
    default: return 30;
  }
}

export function getEvalThresholds(archetype: string | null, timeframe: string | string[]): ArchetypeEvalThresholds {
  // First try archetype-specific thresholds
  if (archetype) {
    const upper = archetype.toUpperCase().replace(/[_-]/g, "_");
    if (ARCHETYPE_EVAL_THRESHOLDS[upper]) {
      return ARCHETYPE_EVAL_THRESHOLDS[upper];
    }
  }
  
  // Fall back to strategy class based on timeframe
  const strategyClass = detectStrategyClass(timeframe);
  const minTrades = getMinTradesForClass(strategyClass);
  
  return {
    minTrades,
    minDays: strategyClass === "POSITION" ? 14 : strategyClass === "SWING" ? 7 : 3,
    minRegimes: 2,
    description: `${strategyClass} strategy (timeframe-derived)`,
  };
}

// =============================================================================
// RECYCLE DECISION THRESHOLDS (PHASE 2)
// Hard numeric thresholds for Kill/Tweak/Replace decisions
// =============================================================================
export interface RecycleThresholds {
  softSharpeFloor: number;
  hardSharpeFloor: number;
  softExpectancyFloor: number;
  hardExpectancyFloor: number;
  maxDdSoft: number;     // in R-multiples
  maxDdHard: number;     // in R-multiples
  maxTweakIterations: number;
  maxReplaceIterations: number;
}

export const RECYCLE_THRESHOLDS: RecycleThresholds = {
  softSharpeFloor: 0.2,
  hardSharpeFloor: -0.2,
  softExpectancyFloor: 0.0,
  hardExpectancyFloor: -0.1,
  maxDdSoft: 6,          // 6R drawdown = warning
  maxDdHard: 10,         // 10R drawdown = catastrophic
  maxTweakIterations: 2,
  maxReplaceIterations: 2,
};

export type RecycleDecision = "CONTINUE" | "TWEAK" | "REPLACE" | "KILL" | "INSUFFICIENT_DATA";

export interface RecycleEvaluation {
  decision: RecycleDecision;
  reasons: string[];
  meetsMinEval: boolean;
  currentTrades: number;
  requiredTrades: number;
  currentDays: number;
  requiredDays: number;
  metrics: {
    sharpe?: number;
    expectancy?: number;
    maxDrawdownR?: number;
    winRate?: number;
  };
  isCatastrophic: boolean;
  iterationCount: number;
}

export function evaluateRecycleDecision(
  archetype: string | null,
  timeframe: string | string[],
  currentTrades: number,
  currentDays: number,
  metrics: {
    sharpe?: number;
    expectancy?: number;
    maxDrawdownR?: number;
    winRate?: number;
  },
  iterationCount: number = 0
): RecycleEvaluation {
  const thresholds = getEvalThresholds(archetype, timeframe);
  const reasons: string[] = [];
  
  const meetsMinEval = currentTrades >= thresholds.minTrades && currentDays >= thresholds.minDays;
  
  // Check for catastrophic failure (allows early exit regardless of min eval)
  const isCatastrophic = 
    (metrics.maxDrawdownR !== undefined && metrics.maxDrawdownR > RECYCLE_THRESHOLDS.maxDdHard);
  
  if (isCatastrophic) {
    reasons.push(`Catastrophic DD: ${metrics.maxDrawdownR?.toFixed(1)}R > ${RECYCLE_THRESHOLDS.maxDdHard}R limit`);
    return {
      decision: "KILL",
      reasons,
      meetsMinEval,
      currentTrades,
      requiredTrades: thresholds.minTrades,
      currentDays,
      requiredDays: thresholds.minDays,
      metrics,
      isCatastrophic: true,
      iterationCount,
    };
  }
  
  // If minimum evaluation not met, continue running
  if (!meetsMinEval) {
    reasons.push(`Insufficient data: ${currentTrades}/${thresholds.minTrades} trades, ${currentDays}/${thresholds.minDays} days`);
    return {
      decision: "INSUFFICIENT_DATA",
      reasons,
      meetsMinEval: false,
      currentTrades,
      requiredTrades: thresholds.minTrades,
      currentDays,
      requiredDays: thresholds.minDays,
      metrics,
      isCatastrophic: false,
      iterationCount,
    };
  }
  
  // Minimum eval met - evaluate performance
  const sharpe = metrics.sharpe ?? 0;
  const expectancy = metrics.expectancy ?? 0;
  const dd = metrics.maxDrawdownR ?? 0;
  
  // Check if performance is good enough to continue
  if (sharpe >= RECYCLE_THRESHOLDS.softSharpeFloor && expectancy >= RECYCLE_THRESHOLDS.softExpectancyFloor) {
    reasons.push(`Performance acceptable: Sharpe=${sharpe.toFixed(2)}, Expectancy=${expectancy.toFixed(3)}R`);
    return {
      decision: "CONTINUE",
      reasons,
      meetsMinEval: true,
      currentTrades,
      requiredTrades: thresholds.minTrades,
      currentDays,
      requiredDays: thresholds.minDays,
      metrics,
      isCatastrophic: false,
      iterationCount,
    };
  }
  
  // Performance is subpar - determine recycle action
  
  // KILL conditions: exceeded iteration limits or severely negative
  if (iterationCount >= RECYCLE_THRESHOLDS.maxTweakIterations + RECYCLE_THRESHOLDS.maxReplaceIterations) {
    reasons.push(`Max iterations exceeded: ${iterationCount} >= ${RECYCLE_THRESHOLDS.maxTweakIterations + RECYCLE_THRESHOLDS.maxReplaceIterations}`);
    return {
      decision: "KILL",
      reasons,
      meetsMinEval: true,
      currentTrades,
      requiredTrades: thresholds.minTrades,
      currentDays,
      requiredDays: thresholds.minDays,
      metrics,
      isCatastrophic: false,
      iterationCount,
    };
  }
  
  // REPLACE conditions: structural issues (hard floors breached)
  if (sharpe < RECYCLE_THRESHOLDS.hardSharpeFloor || expectancy < RECYCLE_THRESHOLDS.hardExpectancyFloor) {
    reasons.push(`Structural failure: Sharpe=${sharpe.toFixed(2)} (floor=${RECYCLE_THRESHOLDS.hardSharpeFloor}), Expectancy=${expectancy.toFixed(3)}R (floor=${RECYCLE_THRESHOLDS.hardExpectancyFloor}R)`);
    return {
      decision: "REPLACE",
      reasons,
      meetsMinEval: true,
      currentTrades,
      requiredTrades: thresholds.minTrades,
      currentDays,
      requiredDays: thresholds.minDays,
      metrics,
      isCatastrophic: false,
      iterationCount,
    };
  }
  
  // TWEAK conditions: close but not quite (soft floors breached)
  reasons.push(`Parameter sensitivity: Sharpe=${sharpe.toFixed(2)} (soft floor=${RECYCLE_THRESHOLDS.softSharpeFloor}), needs tuning`);
  return {
    decision: "TWEAK",
    reasons,
    meetsMinEval: true,
    currentTrades,
    requiredTrades: thresholds.minTrades,
    currentDays,
    requiredDays: thresholds.minDays,
    metrics,
    isCatastrophic: false,
    iterationCount,
  };
}

// =============================================================================
// ADAPTIVE INTERVAL CONFIGURATION
// System automatically adjusts between fast scanning and deep research
// =============================================================================
const ADAPTIVE_INTERVALS = {
  MIN_INTERVAL_MS: 1 * 60 * 60 * 1000,   // 1 hour minimum (aggressive)
  BASE_INTERVAL_MS: 2 * 60 * 60 * 1000,  // 2 hours baseline
  MAX_INTERVAL_MS: 6 * 60 * 60 * 1000,   // 6 hours maximum (deep)
};

export type AdaptiveMode = "SCANNING" | "BALANCED" | "DEEP_RESEARCH";

interface AdaptiveState {
  currentMode: AdaptiveMode;
  currentIntervalMs: number;
  reasonForMode: string;
}

let adaptiveState: AdaptiveState = {
  currentMode: "BALANCED",
  currentIntervalMs: ADAPTIVE_INTERVALS.BASE_INTERVAL_MS,
  reasonForMode: "Initial balanced mode",
};

async function computeAdaptiveInterval(): Promise<AdaptiveState> {
  try {
    const now = Date.now();
    const recentStats = researchCycleStats.slice(-10);
    
    const pendingCount = await db.select({ count: sql<number>`count(*)` })
      .from(strategyCandidates)
      .where(eq(strategyCandidates.disposition, "PENDING_REVIEW"))
      .then(r => Number(r[0]?.count) || 0);
    
    const inLabCount = await db.select({ count: sql<number>`count(*)` })
      .from(strategyCandidates)
      .where(eq(strategyCandidates.disposition, "SENT_TO_LAB"))
      .then(r => Number(r[0]?.count) || 0);
    
    const recentSuccessCount = recentStats.filter(s => s.sentToLab > 0).length;
    const successRate = recentStats.length > 0 ? recentSuccessCount / recentStats.length : 0.5;
    
    const lastSuccessfulCycle = recentStats.filter(s => s.sentToLab > 0).pop();
    const timeSinceSuccess = lastSuccessfulCycle 
      ? now - lastSuccessfulCycle.timestamp.getTime() 
      : 12 * 60 * 60 * 1000;
    
    let mode: AdaptiveMode = "BALANCED";
    let intervalMs = ADAPTIVE_INTERVALS.BASE_INTERVAL_MS;
    let reason = "";
    
    if (pendingCount >= 5 || inLabCount >= 3) {
      mode = "DEEP_RESEARCH";
      intervalMs = ADAPTIVE_INTERVALS.MAX_INTERVAL_MS;
      reason = `Pipeline full (${pendingCount} pending, ${inLabCount} in LAB) - slowing to deep research`;
    } else if (successRate < 0.2 && recentStats.length >= 3) {
      mode = "DEEP_RESEARCH";
      intervalMs = ADAPTIVE_INTERVALS.MAX_INTERVAL_MS;
      reason = `Low discovery rate (${Math.round(successRate * 100)}%) - switching to deeper research`;
    } else if (timeSinceSuccess > 8 * 60 * 60 * 1000) {
      mode = "SCANNING";
      intervalMs = ADAPTIVE_INTERVALS.MIN_INTERVAL_MS;
      reason = `No discoveries in ${Math.round(timeSinceSuccess / 3600000)}h - accelerating scans`;
    } else if (pendingCount === 0 && inLabCount === 0) {
      mode = "SCANNING";
      intervalMs = ADAPTIVE_INTERVALS.MIN_INTERVAL_MS;
      reason = "Pipeline empty - scanning for new opportunities";
    } else {
      mode = "BALANCED";
      intervalMs = ADAPTIVE_INTERVALS.BASE_INTERVAL_MS;
      reason = "Normal operation - balanced discovery pace";
    }
    
    adaptiveState = { currentMode: mode, currentIntervalMs: intervalMs, reasonForMode: reason };
    return adaptiveState;
  } catch (error) {
    console.warn("[STRATEGY_LAB] Adaptive calculation failed, using defaults:", error);
    return adaptiveState;
  }
}

async function getCurrentResearchIntervalMs(): Promise<number> {
  const state = await computeAdaptiveInterval();
  return state.currentIntervalMs;
}

function shouldAlwaysCheckRegime(): boolean {
  return adaptiveState.currentMode === "SCANNING";
}

export function getAdaptiveState(): AdaptiveState {
  return { ...adaptiveState };
}

export type ResearchDepth = "CONTINUOUS_SCAN" | "FOCUSED_BURST" | "FRONTIER_RESEARCH";

export type AutoPromoteTier = "A" | "B" | "C" | "ANY";

export type PerplexityModel = "QUICK" | "BALANCED" | "DEEP";

export type SearchRecency = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface StrategyLabState {
  isPlaying: boolean;
  currentDepth: ResearchDepth;
  adaptiveMode: AdaptiveMode;
  adaptiveIntervalMs: number;
  adaptiveReason: string;
  lastStateChange: Date;
  pauseReason?: string;
  requireManualApproval: boolean;
  autoPromoteThreshold: number;
  autoPromoteTier: AutoPromoteTier;
  perplexityModel: PerplexityModel;
  searchRecency: SearchRecency;
  customFocus: string;
  costEfficiencyMode: boolean;
  // QC Verification settings
  qcDailyLimit: number;
  qcWeeklyLimit: number;
  qcAutoTriggerEnabled: boolean;
  qcAutoTriggerThreshold: number;
  qcAutoTriggerTier: "A" | "B" | "AB";
  // Fast Track settings (skip TRIALS → PAPER if QC exceeds thresholds)
  fastTrackEnabled: boolean;
  fastTrackMinTrades: number;
  fastTrackMinSharpe: number;
  fastTrackMinWinRate: number;
  fastTrackMaxDrawdown: number;
  // Trials auto-promotion settings (TRIALS → PAPER)
  trialsAutoPromoteEnabled: boolean;
  trialsMinTrades: number;
  trialsMinSharpe: number;
  trialsMinWinRate: number;
  trialsMaxDrawdown: number;
}

interface ResearchCycleStats {
  cycleId: string;
  timestamp: Date;
  trigger: StrategyLabRegimeTrigger;
  candidatesGenerated: number;
  sentToLab: number;
  queued: number;
  rejected: number;
  merged: number;
  durationMs: number;
  depth?: ResearchDepth;
}

let lastResearchCycleTime = 0;
let researchCycleStats: ResearchCycleStats[] = [];
const MAX_STATS_HISTORY = 20;

// Real-time research activity tracking
export interface ResearchActivity {
  isActive: boolean;
  phase: "IDLE" | "INITIALIZING" | "RESEARCHING" | "SYNTHESIZING" | "EVALUATING" | "COMPLETE";
  provider: string | null;
  startedAt: Date | null;
  message: string;
  candidatesFound: number;
  traceId: string | null;
}

let currentResearchActivity: ResearchActivity = {
  isActive: false,
  phase: "IDLE",
  provider: null,
  startedAt: null,
  message: "Waiting for next research cycle",
  candidatesFound: 0,
  traceId: null,
};

export function getResearchActivity(): ResearchActivity {
  return { ...currentResearchActivity };
}

function setResearchActivity(update: Partial<ResearchActivity>) {
  currentResearchActivity = { ...currentResearchActivity, ...update };
  console.log(`[STRATEGY_LAB_ACTIVITY] phase=${currentResearchActivity.phase} provider=${currentResearchActivity.provider || 'none'} msg="${currentResearchActivity.message}"`);
}

let strategyLabState: StrategyLabState = {
  isPlaying: true,
  currentDepth: "CONTINUOUS_SCAN",
  adaptiveMode: "BALANCED",
  adaptiveIntervalMs: ADAPTIVE_INTERVALS.BASE_INTERVAL_MS,
  adaptiveReason: "Initial balanced mode",
  lastStateChange: new Date(),
  requireManualApproval: false,
  autoPromoteThreshold: 65,
  autoPromoteTier: "B",
  perplexityModel: "BALANCED",
  searchRecency: "MONTH",
  customFocus: "",
  costEfficiencyMode: false,
  // QC Verification defaults - increased for faster pipeline throughput
  qcDailyLimit: 150,
  qcWeeklyLimit: 500,
  qcAutoTriggerEnabled: true,
  qcAutoTriggerThreshold: 80,
  qcAutoTriggerTier: "AB",
  // Fast Track defaults (skip TRIALS → PAPER if QC exceeds thresholds)
  fastTrackEnabled: true,
  fastTrackMinTrades: 50,
  fastTrackMinSharpe: 1.5,
  fastTrackMinWinRate: 55,
  fastTrackMaxDrawdown: 15,
  // Trials auto-promotion defaults (TRIALS → PAPER)
  trialsAutoPromoteEnabled: true,
  trialsMinTrades: 50,
  trialsMinSharpe: 1.0,
  trialsMinWinRate: 50,
  trialsMaxDrawdown: 20,
};

// Sync cost efficiency mode to global for AI cascade
function syncCostEfficiencyMode(enabled: boolean): void {
  (global as any).__costEfficiencyMode = enabled;
  console.log(`[STRATEGY_LAB] cost_efficiency_mode=${enabled ? 'ENABLED' : 'DISABLED'} cascade=${enabled ? 'GROQ_ONLY' : 'QUALITY_FIRST'}`);
}

export function getStrategyLabState(): StrategyLabState {
  const state = { 
    ...strategyLabState,
    adaptiveMode: adaptiveState.currentMode,
    adaptiveIntervalMs: adaptiveState.currentIntervalMs,
    adaptiveReason: adaptiveState.reasonForMode,
  };
  // Sync to global for budget governor access
  (global as any).__strategyLabState = state;
  return state;
}

export function setStrategyLabPlaying(playing: boolean, reason?: string): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    isPlaying: playing,
    lastStateChange: new Date(),
    pauseReason: playing ? undefined : reason,
  };
  console.log(`[STRATEGY_LAB] state changed: isPlaying=${playing}${reason ? ` reason=${reason}` : ''}`);
  
  // CRITICAL: When pausing, broadcast IDLE state so WebSocket clients clear live indicators
  // When resuming, don't broadcast - let the scheduler update activity when the next cycle starts
  if (!playing) {
    setResearchActivity({
      isActive: false,
      phase: "IDLE",
      provider: null,
      message: reason || "Strategy Lab paused",
      candidatesFound: 0,
      traceId: null,
    });
  }
  
  return getStrategyLabState();
}

export function setStrategyLabDepth(depth: ResearchDepth): StrategyLabState {
  console.log(`[STRATEGY_LAB] depth setting deprecated - system now uses adaptive intervals (requested: ${depth})`);
  return getStrategyLabState();
}

export function isStrategyLabRunning(): boolean {
  return strategyLabState.isPlaying;
}

export function setStrategyLabManualApproval(requireManualApproval: boolean): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    requireManualApproval,
    lastStateChange: new Date(),
  };
  console.log(`[STRATEGY_LAB] manual approval changed: requireManualApproval=${requireManualApproval}`);
  return getStrategyLabState();
}

export function setStrategyLabAutoPromoteSettings(threshold: number, tier: AutoPromoteTier): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    autoPromoteThreshold: Math.max(50, Math.min(95, threshold)),
    autoPromoteTier: tier,
    lastStateChange: new Date(),
  };
  console.log(`[STRATEGY_LAB] auto-promote settings changed: threshold=${strategyLabState.autoPromoteThreshold} tier=${tier}`);
  return getStrategyLabState();
}

export function setCostEfficiencyMode(enabled: boolean): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    costEfficiencyMode: enabled,
    lastStateChange: new Date(),
  };
  syncCostEfficiencyMode(enabled);
  
  // When cost efficiency mode is enabled, also force Quick Scan research
  if (enabled) {
    strategyLabState.perplexityModel = "QUICK";
    console.log(`[STRATEGY_LAB] cost_efficiency auto-switched perplexityModel=QUICK`);
  }
  
  return getStrategyLabState();
}

export function setStrategyLabQCSettings(settings: {
  dailyLimit?: number;
  weeklyLimit?: number;
  autoTriggerEnabled?: boolean;
  autoTriggerThreshold?: number;
  autoTriggerTier?: "A" | "B" | "AB";
}): StrategyLabState {
  if (typeof settings.dailyLimit === "number") {
    strategyLabState.qcDailyLimit = Math.max(1, Math.min(150, settings.dailyLimit));
  }
  if (typeof settings.weeklyLimit === "number") {
    strategyLabState.qcWeeklyLimit = Math.max(5, Math.min(500, settings.weeklyLimit));
  }
  if (typeof settings.autoTriggerEnabled === "boolean") {
    strategyLabState.qcAutoTriggerEnabled = settings.autoTriggerEnabled;
  }
  if (typeof settings.autoTriggerThreshold === "number") {
    strategyLabState.qcAutoTriggerThreshold = Math.max(50, Math.min(95, settings.autoTriggerThreshold));
  }
  if (settings.autoTriggerTier) {
    strategyLabState.qcAutoTriggerTier = settings.autoTriggerTier;
  }
  strategyLabState.lastStateChange = new Date();
  
  console.log(`[STRATEGY_LAB] QC settings changed: daily=${strategyLabState.qcDailyLimit} weekly=${strategyLabState.qcWeeklyLimit} autoTrigger=${strategyLabState.qcAutoTriggerEnabled} threshold=${strategyLabState.qcAutoTriggerThreshold} tier=${strategyLabState.qcAutoTriggerTier}`);
  return getStrategyLabState();
}

export function setStrategyLabFastTrackSettings(settings: {
  enabled?: boolean;
  minTrades?: number;
  minSharpe?: number;
  minWinRate?: number;
  maxDrawdown?: number;
}): StrategyLabState {
  if (typeof settings.enabled === "boolean") {
    strategyLabState.fastTrackEnabled = settings.enabled;
  }
  if (typeof settings.minTrades === "number") {
    strategyLabState.fastTrackMinTrades = Math.max(10, Math.min(500, settings.minTrades));
  }
  if (typeof settings.minSharpe === "number") {
    strategyLabState.fastTrackMinSharpe = Math.max(0.5, Math.min(5.0, settings.minSharpe));
  }
  if (typeof settings.minWinRate === "number") {
    strategyLabState.fastTrackMinWinRate = Math.max(40, Math.min(80, settings.minWinRate));
  }
  if (typeof settings.maxDrawdown === "number") {
    strategyLabState.fastTrackMaxDrawdown = Math.max(5, Math.min(50, settings.maxDrawdown));
  }
  strategyLabState.lastStateChange = new Date();
  
  console.log(`[STRATEGY_LAB] Fast Track settings changed: enabled=${strategyLabState.fastTrackEnabled} minTrades=${strategyLabState.fastTrackMinTrades} minSharpe=${strategyLabState.fastTrackMinSharpe} minWinRate=${strategyLabState.fastTrackMinWinRate} maxDrawdown=${strategyLabState.fastTrackMaxDrawdown}`);
  return getStrategyLabState();
}

export function setStrategyLabTrialsAutoPromoteSettings(settings: {
  enabled?: boolean;
  minTrades?: number;
  minSharpe?: number;
  minWinRate?: number;
  maxDrawdown?: number;
}): StrategyLabState {
  if (typeof settings.enabled === "boolean") {
    strategyLabState.trialsAutoPromoteEnabled = settings.enabled;
  }
  if (typeof settings.minTrades === "number") {
    strategyLabState.trialsMinTrades = Math.max(10, Math.min(500, settings.minTrades));
  }
  if (typeof settings.minSharpe === "number") {
    strategyLabState.trialsMinSharpe = Math.max(0.5, Math.min(5.0, settings.minSharpe));
  }
  if (typeof settings.minWinRate === "number") {
    strategyLabState.trialsMinWinRate = Math.max(40, Math.min(80, settings.minWinRate));
  }
  if (typeof settings.maxDrawdown === "number") {
    strategyLabState.trialsMaxDrawdown = Math.max(5, Math.min(50, settings.maxDrawdown));
  }
  strategyLabState.lastStateChange = new Date();
  
  console.log(`[STRATEGY_LAB] Trials auto-promote settings changed: enabled=${strategyLabState.trialsAutoPromoteEnabled} minTrades=${strategyLabState.trialsMinTrades} minSharpe=${strategyLabState.trialsMinSharpe} minWinRate=${strategyLabState.trialsMinWinRate} maxDrawdown=${strategyLabState.trialsMaxDrawdown}`);
  return getStrategyLabState();
}

let settingsInitialized = false;

export interface StrategyLabSettingsInit {
  isPlaying?: boolean;  // FIX: Persist pause state
  requireManualApproval?: boolean;
  autoPromoteThreshold?: number;
  autoPromoteTier?: string;
  perplexityModel?: string;
  searchRecency?: string;
  customFocus?: string;
  costEfficiencyMode?: boolean;
  // QC Verification settings
  qcDailyLimit?: number;
  qcWeeklyLimit?: number;
  qcAutoTriggerEnabled?: boolean;
  qcAutoTriggerThreshold?: number;
  qcAutoTriggerTier?: string;
  // Fast Track settings
  fastTrackEnabled?: boolean;
  fastTrackMinTrades?: number;
  fastTrackMinSharpe?: number;
  fastTrackMinWinRate?: number;
  fastTrackMaxDrawdown?: number;
  // Trials auto-promotion settings
  trialsAutoPromoteEnabled?: boolean;
  trialsMinTrades?: number;
  trialsMinSharpe?: number;
  trialsMinWinRate?: number;
  trialsMaxDrawdown?: number;
}

export function initializeStrategyLabFromSettings(settings: StrategyLabSettingsInit): void {
  // CRITICAL: Always load isPlaying on FIRST call with valid settings
  // This must happen before the settingsInitialized guard to ensure pause state
  // is restored from database on server restart
  if (!settingsInitialized && typeof settings.isPlaying === "boolean") {
    strategyLabState.isPlaying = settings.isPlaying;
    console.log(`[STRATEGY_LAB] Restored pause state from DB: isPlaying=${settings.isPlaying}`);
  }
  
  if (settingsInitialized) return;
  
  const validTiers = ["A", "B", "C", "ANY"];
  const validModels = ["QUICK", "BALANCED", "DEEP"];
  const validRecencies = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"];
  
  if (typeof settings.requireManualApproval === "boolean") {
    strategyLabState.requireManualApproval = settings.requireManualApproval;
  }
  if (typeof settings.autoPromoteThreshold === "number") {
    strategyLabState.autoPromoteThreshold = Math.max(50, Math.min(95, settings.autoPromoteThreshold));
  }
  if (settings.autoPromoteTier && validTiers.includes(settings.autoPromoteTier)) {
    strategyLabState.autoPromoteTier = settings.autoPromoteTier as AutoPromoteTier;
  }
  if (settings.perplexityModel && validModels.includes(settings.perplexityModel)) {
    strategyLabState.perplexityModel = settings.perplexityModel as PerplexityModel;
  }
  if (settings.searchRecency && validRecencies.includes(settings.searchRecency)) {
    strategyLabState.searchRecency = settings.searchRecency as SearchRecency;
  }
  if (typeof settings.customFocus === "string") {
    strategyLabState.customFocus = settings.customFocus;
  }
  if (typeof settings.costEfficiencyMode === "boolean") {
    strategyLabState.costEfficiencyMode = settings.costEfficiencyMode;
    syncCostEfficiencyMode(settings.costEfficiencyMode);
  }
  
  // Load QC Verification settings
  const validQCTiers = ["A", "B", "AB"];
  if (typeof settings.qcDailyLimit === "number") {
    strategyLabState.qcDailyLimit = Math.max(1, Math.min(150, settings.qcDailyLimit));
  }
  if (typeof settings.qcWeeklyLimit === "number") {
    strategyLabState.qcWeeklyLimit = Math.max(5, Math.min(500, settings.qcWeeklyLimit));
  }
  if (typeof settings.qcAutoTriggerEnabled === "boolean") {
    strategyLabState.qcAutoTriggerEnabled = settings.qcAutoTriggerEnabled;
  }
  if (typeof settings.qcAutoTriggerThreshold === "number") {
    strategyLabState.qcAutoTriggerThreshold = Math.max(50, Math.min(95, settings.qcAutoTriggerThreshold));
  }
  if (settings.qcAutoTriggerTier && validQCTiers.includes(settings.qcAutoTriggerTier)) {
    strategyLabState.qcAutoTriggerTier = settings.qcAutoTriggerTier as "A" | "B" | "AB";
  }
  
  // Load Fast Track settings
  if (typeof settings.fastTrackEnabled === "boolean") {
    strategyLabState.fastTrackEnabled = settings.fastTrackEnabled;
  }
  if (typeof settings.fastTrackMinTrades === "number") {
    strategyLabState.fastTrackMinTrades = Math.max(10, Math.min(500, settings.fastTrackMinTrades));
  }
  if (typeof settings.fastTrackMinSharpe === "number") {
    strategyLabState.fastTrackMinSharpe = Math.max(0.5, Math.min(5.0, settings.fastTrackMinSharpe));
  }
  if (typeof settings.fastTrackMinWinRate === "number") {
    strategyLabState.fastTrackMinWinRate = Math.max(40, Math.min(80, settings.fastTrackMinWinRate));
  }
  if (typeof settings.fastTrackMaxDrawdown === "number") {
    strategyLabState.fastTrackMaxDrawdown = Math.max(5, Math.min(50, settings.fastTrackMaxDrawdown));
  }
  
  // Load Trials auto-promotion settings
  // INSTITUTIONAL DEFAULT: Auto-promotion is TRUE by default (industry standard)
  // Only CANARY→LIVE requires manual approval gates; earlier stages auto-promote
  if (typeof settings.trialsAutoPromoteEnabled === "boolean") {
    strategyLabState.trialsAutoPromoteEnabled = settings.trialsAutoPromoteEnabled;
  } else {
    // Defensive fallback: if setting is null/undefined, default to TRUE
    strategyLabState.trialsAutoPromoteEnabled = true;
  }
  if (typeof settings.trialsMinTrades === "number") {
    strategyLabState.trialsMinTrades = Math.max(10, Math.min(500, settings.trialsMinTrades));
  }
  if (typeof settings.trialsMinSharpe === "number") {
    strategyLabState.trialsMinSharpe = Math.max(0.5, Math.min(5.0, settings.trialsMinSharpe));
  }
  if (typeof settings.trialsMinWinRate === "number") {
    strategyLabState.trialsMinWinRate = Math.max(40, Math.min(80, settings.trialsMinWinRate));
  }
  if (typeof settings.trialsMaxDrawdown === "number") {
    strategyLabState.trialsMaxDrawdown = Math.max(5, Math.min(50, settings.trialsMaxDrawdown));
  }
  
  settingsInitialized = true;
  console.log(`[STRATEGY_LAB] Initialized from persisted settings: isPlaying=${strategyLabState.isPlaying} requireManualApproval=${strategyLabState.requireManualApproval} threshold=${strategyLabState.autoPromoteThreshold} tier=${strategyLabState.autoPromoteTier} costEfficiency=${strategyLabState.costEfficiencyMode} qcDaily=${strategyLabState.qcDailyLimit} qcWeekly=${strategyLabState.qcWeeklyLimit} fastTrack=${strategyLabState.fastTrackEnabled} trialsAuto=${strategyLabState.trialsAutoPromoteEnabled}`);
}

export interface AutoPromoteResult {
  candidatesEvaluated: number;
  candidatesPromoted: number;
  promotedIds: string[];
  skippedReasons: { id: string; reason: string }[];
}

export async function evaluateAutoPromotions(): Promise<AutoPromoteResult> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const result: AutoPromoteResult = {
    candidatesEvaluated: 0,
    candidatesPromoted: 0,
    promotedIds: [],
    skippedReasons: [],
  };
  
  if (strategyLabState.requireManualApproval) {
    console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} auto-promote disabled (requireManualApproval=true)`);
    return result;
  }
  
  const { autoPromoteThreshold, autoPromoteTier } = strategyLabState;
  console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} evaluating candidates threshold=${autoPromoteThreshold} tier=${autoPromoteTier}`);
  
  try {
    const pendingCandidates = await getCandidatesByDisposition("PENDING_REVIEW", 100);
    result.candidatesEvaluated = pendingCandidates.length;
    
    if (pendingCandidates.length === 0) {
      console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} no pending candidates`);
      return result;
    }
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const regimeResult = await detectMarketRegime("MES", thirtyDaysAgo, now, traceId);
    
    let currentRegime: "VOLATILITY_SPIKE" | "VOLATILITY_COMPRESSION" | "TRENDING_STRONG" | "RANGE_BOUND" | "NONE" = "NONE";
    if (regimeResult.regime === "HIGH_VOLATILITY") {
      currentRegime = "VOLATILITY_SPIKE";
    } else if (regimeResult.regime === "LOW_VOLATILITY") {
      currentRegime = "VOLATILITY_COMPRESSION";
    } else if (regimeResult.regime === "BULL" || regimeResult.regime === "BEAR") {
      currentRegime = regimeResult.confidence > 0.6 ? "TRENDING_STRONG" : "RANGE_BOUND";
    } else if (regimeResult.regime === "SIDEWAYS") {
      currentRegime = "RANGE_BOUND";
    }
    
    for (const candidate of pendingCandidates) {
      // FIX: Use persisted adjusted_score when available, otherwise recalculate
      // This ensures consistency with the values shown in the UI
      let effectiveScore: number;
      
      if (candidate.adjusted_score != null) {
        // Use the persisted regime-adjusted score (authoritative)
        effectiveScore = candidate.adjusted_score;
      } else {
        // Legacy fallback: recalculate for candidates without persisted adjusted_score
        const archetypeName = candidate.archetype_name || candidate.archetypeName || "";
        const originalScore = candidate.confidence_score ?? candidate.confidenceScore ?? 50;
        const adjustment = calculateRegimeAdjustedScore(archetypeName, originalScore, currentRegime);
        effectiveScore = adjustment.adjustedScore;
      }
      
      const tier = effectiveScore >= 80 ? "A" : effectiveScore >= 65 ? "B" : effectiveScore >= 50 ? "C" : "D";
      
      const tierPasses = autoPromoteTier === "ANY" || 
                        (autoPromoteTier === "A" && tier === "A") ||
                        (autoPromoteTier === "B" && (tier === "A" || tier === "B")) ||
                        (autoPromoteTier === "C" && (tier === "A" || tier === "B" || tier === "C"));
      
      if (effectiveScore < autoPromoteThreshold) {
        result.skippedReasons.push({ 
          id: candidate.id, 
          reason: `Score ${effectiveScore} below threshold ${autoPromoteThreshold}` 
        });
        continue;
      }
      
      if (!tierPasses) {
        result.skippedReasons.push({ 
          id: candidate.id, 
          reason: `Tier ${tier} does not meet minimum tier ${autoPromoteTier}` 
        });
        continue;
      }
      
      console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} promoting candidate ${candidate.id} (score=${effectiveScore}, tier=${tier})`);
      
      try {
        const promotionResult = await promoteCandidate(candidate.id, traceId);
        if (promotionResult.success) {
          result.promotedIds.push(candidate.id);
          result.candidatesPromoted++;
        } else {
          result.skippedReasons.push({ id: candidate.id, reason: promotionResult.error || "Unknown error" });
        }
      } catch (promoteError: any) {
        result.skippedReasons.push({ id: candidate.id, reason: promoteError.message });
      }
    }
    
    console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} completed: evaluated=${result.candidatesEvaluated} promoted=${result.candidatesPromoted}`);
    return result;
    
  } catch (error: any) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} error:`, error);
    return result;
  }
}

/**
 * AUTONOMOUS PROMOTION WORKER: Promotes SENT_TO_LAB candidates to bots
 * This runs independently of requireManualApproval - candidates already in SENT_TO_LAB
 * have been pre-approved and just need bot creation.
 */
export async function promoteSentToLabCandidates(): Promise<AutoPromoteResult> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const result: AutoPromoteResult = {
    candidatesEvaluated: 0,
    candidatesPromoted: 0,
    promotedIds: [],
    skippedReasons: [],
  };
  
  try {
    // Find all SENT_TO_LAB candidates that don't have a bot yet
    const pendingPromotion = await db.select()
      .from(strategyCandidates)
      .where(
        and(
          eq(strategyCandidates.disposition, "SENT_TO_LAB"),
          sql`${strategyCandidates.createdBotId} IS NULL`
        )
      )
      .limit(10); // Process in batches of 10
    
    result.candidatesEvaluated = pendingPromotion.length;
    
    if (pendingPromotion.length === 0) {
      return result;
    }
    
    console.log(`[SENT_TO_LAB_WORKER] trace_id=${traceId} found ${pendingPromotion.length} candidates awaiting bot creation`);
    
    for (const candidate of pendingPromotion) {
      try {
        console.log(`[SENT_TO_LAB_WORKER] trace_id=${traceId} creating bot for "${candidate.strategyName}" (id=${candidate.id})`);
        const promotionResult = await promoteCandidate(candidate.id, traceId);
        
        if (promotionResult.success) {
          result.promotedIds.push(candidate.id);
          result.candidatesPromoted++;
          console.log(`[SENT_TO_LAB_WORKER] trace_id=${traceId} SUCCESS: created bot ${promotionResult.botId} for "${candidate.strategyName}"`);
        } else {
          result.skippedReasons.push({ id: candidate.id, reason: promotionResult.error || "Unknown error" });
          console.warn(`[SENT_TO_LAB_WORKER] trace_id=${traceId} SKIPPED: "${candidate.strategyName}" - ${promotionResult.error}`);
        }
      } catch (promoteError: any) {
        result.skippedReasons.push({ id: candidate.id, reason: promoteError.message });
        console.error(`[SENT_TO_LAB_WORKER] trace_id=${traceId} ERROR: "${candidate.strategyName}" - ${promoteError.message}`);
      }
    }
    
    console.log(`[SENT_TO_LAB_WORKER] trace_id=${traceId} completed: evaluated=${result.candidatesEvaluated} promoted=${result.candidatesPromoted}`);
    return result;
    
  } catch (error: any) {
    console.error(`[SENT_TO_LAB_WORKER] trace_id=${traceId} fatal error:`, error);
    return result;
  }
}

/**
 * ONE-TIME MIGRATION: Promote qualifying PENDING_REVIEW candidates to SENT_TO_LAB
 * This handles candidates that were created when requireManualApproval was true
 * but now meet the auto-promote criteria with the updated threshold.
 */
export async function migrateQualifyingCandidatesToSentToLab(): Promise<{ promoted: number; total: number }> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const threshold = strategyLabState.autoPromoteThreshold;
  
  try {
    // Find PENDING_REVIEW candidates that meet the promotion threshold
    const qualifyingCandidates = await db.select()
      .from(strategyCandidates)
      .where(
        and(
          eq(strategyCandidates.disposition, "PENDING_REVIEW"),
          sql`${strategyCandidates.confidenceScore} >= ${threshold}`,
          sql`${strategyCandidates.noveltyScore} >= 40`
        )
      )
      .limit(50); // Process in batches
    
    if (qualifyingCandidates.length === 0) {
      console.log(`[CANDIDATE_MIGRATION] trace_id=${traceId} no qualifying PENDING_REVIEW candidates found`);
      return { promoted: 0, total: 0 };
    }
    
    console.log(`[CANDIDATE_MIGRATION] trace_id=${traceId} found ${qualifyingCandidates.length} qualifying PENDING_REVIEW candidates (threshold=${threshold})`);
    
    let promoted = 0;
    for (const candidate of qualifyingCandidates) {
      try {
        await db.update(strategyCandidates)
          .set({ 
            disposition: "SENT_TO_LAB", 
            updatedAt: new Date() 
          })
          .where(eq(strategyCandidates.id, candidate.id));
        promoted++;
        console.log(`[CANDIDATE_MIGRATION] trace_id=${traceId} promoted "${candidate.strategyName}" to SENT_TO_LAB (confidence=${candidate.confidenceScore}, novelty=${candidate.noveltyScore})`);
      } catch (err: any) {
        console.error(`[CANDIDATE_MIGRATION] trace_id=${traceId} failed to promote "${candidate.strategyName}":`, err.message);
      }
    }
    
    console.log(`[CANDIDATE_MIGRATION] trace_id=${traceId} completed: promoted ${promoted}/${qualifyingCandidates.length} candidates`);
    return { promoted, total: qualifyingCandidates.length };
    
  } catch (error: any) {
    console.error(`[CANDIDATE_MIGRATION] trace_id=${traceId} fatal error:`, error);
    return { promoted: 0, total: 0 };
  }
}

async function promoteCandidate(candidateId: string, traceId: string): Promise<{ success: boolean; error?: string; botId?: number }> {
  const candidates = await db.select().from(strategyCandidates).where(eq(strategyCandidates.id, candidateId)).limit(1);
  if (candidates.length === 0) {
    return { success: false, error: "Candidate not found" };
  }
  
  const candidate = candidates[0];
  
  if (candidate.disposition === "SENT_TO_LAB" && candidate.createdBotId) {
    return { success: false, error: "Already promoted" };
  }
  
  // DUPLICATE GUARD: Check if bot with same NORMALIZED name already exists
  const candidateSlug = normalizeNameToSlug(candidate.strategyName);
  const userBots = await db.select({ id: bots.id, name: bots.name })
    .from(bots)
    .where(eq(bots.userId, DEFAULT_USER_ID));
  
  const existingBot = userBots.find(b => normalizeNameToSlug(b.name) === candidateSlug);
  
  if (existingBot) {
    console.warn(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} DUPLICATE_GUARD: "${candidate.strategyName}" matches existing "${existingBot.name}" (slug="${candidateSlug}")`);
    // Link candidate to existing bot instead of creating duplicate
    await db.update(strategyCandidates)
      .set({ createdBotId: existingBot.id, disposition: "SENT_TO_LAB", updatedAt: new Date() })
      .where(eq(strategyCandidates.id, candidateId));
    return { success: true, botId: existingBot.id };
  }
  
  // INSTITUTIONAL FAIL-CLOSED: Validate before creating bot
  const archetypeValidation = validateArchetype({
    archetypeName: candidate.archetypeName,
    strategyName: candidate.strategyName,
    traceId,
  });
  
  if (!archetypeValidation.valid) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} ARCHETYPE_VALIDATION_FAILED: ${formatValidationErrors(archetypeValidation)}`);
    recordFallback("archetype", traceId);
    // Still proceed but use inferred archetype if available
  }
  
  const validArchetype = archetypeValidation.inferredArchetype || candidate.archetypeName || "unknown";
  
  const rawSymbol = candidate.instrumentUniverse?.[0] || "MES";
  const symbolValidation = validateSymbol(rawSymbol);
  
  if (!symbolValidation.valid) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} SYMBOL_VALIDATION_FAILED: ${rawSymbol}`);
    return { success: false, error: `Invalid symbol: ${rawSymbol}` };
  }
  
  const symbol = symbolValidation.normalizedSymbol || rawSymbol;
  
  const sessionModeValidation = validateSessionMode({
    sessionMode: candidate.sessionModePreference,
    stage: "TRIALS",
    traceId,
  });
  
  if (!sessionModeValidation.valid) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} SESSION_MODE_VALIDATION_FAILED: ${candidate.sessionModePreference}`);
    return { success: false, error: `Invalid session mode: ${candidate.sessionModePreference}` };
  }
  
  if (sessionModeValidation.warnings.length > 0) {
    recordFallback("sessionMode", traceId);
  }
  
  // Extract risk config from candidate rules or use institutional defaults
  const rulesJson = candidate.rulesJson as Record<string, any> || {};
  const defaultRiskConfig = {
    stopLossTicks: 16,      // 4 points = $20 risk per MES contract
    takeProfitTicks: 80,    // 20 points = $100 profit target
    maxPositionSize: 1,     // Conservative single contract for TRIALS
    maxDailyTrades: 5,      // Prevent overtrading
    maxDailyLoss: 200,      // $200 daily loss limit
    maxDrawdownPercent: 5,  // 5% max drawdown
  };
  
  // Merge candidate's risk model with defaults (candidate values take precedence)
  const effectiveRiskConfig = {
    ...defaultRiskConfig,
    ...(rulesJson.riskModel || {}),
    ...(rulesJson.risk || {}),
  };
  
  const strategyConfig = {
    archetypeId: candidate.archetypeId || null,
    archetypeName: validArchetype,
    rules: candidate.rulesJson || {},
    explainers: candidate.explainersJson || null,
    expectedBehavior: candidate.expectedBehaviorJson || {},
    timeframes: candidate.timeframePreferences || ["5m"],
    instruments: candidate.instrumentUniverse || ["MES"],
    riskModel: effectiveRiskConfig,
    source: "strategy_lab_auto_promote",
    candidateId,
    confidenceScore: candidate.confidenceScore ?? 0,
  };
  
  // Safe max contracts defaults for TRIALS stage (conservative for testing)
  const maxContractsPerTrade = 1;  // Single contract for TRIALS
  const maxContractsPerSymbol = 2; // Max 2 concurrent contracts per symbol

  const newBot = await storage.createBot({
    userId: DEFAULT_USER_ID,
    name: candidate.strategyName,
    stage: "TRIALS",
    symbol,
    strategyConfig,
    riskConfig: effectiveRiskConfig,
    maxContractsPerTrade,
    maxContractsPerSymbol,
    healthScore: 100,
    priorityScore: candidate.confidenceScore ?? 50,
    isCandidate: true,
    candidateScore: candidate.confidenceScore ?? 50,
    candidateReasons: {
      hypothesis: candidate.hypothesis,
      confidenceBreakdown: candidate.confidenceBreakdownJson || null,
      evidence: candidate.evidenceJson || [],
      source: "AUTO_PROMOTE",
      traceId,
    },
    sessionModePreference: candidate.sessionModePreference as any || "FULL_24x5",
    sourceCandidateId: candidate.id,
    createdByAi: candidate.createdByAi || null,
    aiProvider: candidate.aiProvider || null,
    aiProviderBadge: candidate.aiProvider ? true : false,
    // AI Research Provenance (sources and reasoning transparency)
    aiReasoning: candidate.aiReasoning || null,
    aiResearchSources: candidate.aiResearchSources || null,
    aiResearchDepth: candidate.aiResearchDepth || null,
  });

  console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} created bot_id=${newBot.id} name="${newBot.name}"`);

  // INSTITUTIONAL: Create initial Generation 1 for proper lifecycle tracking
  try {
    const generationId = crypto.randomUUID();
    const timeframe = candidate.timeframePreferences?.[0] || '5m';
    
    await storage.createBotGeneration({
      id: generationId,
      botId: newBot.id,
      generationNumber: 1,
      strategyConfig,
      riskConfig: effectiveRiskConfig,
      stage: 'TRIALS',
      timeframe,
      summaryTitle: 'Strategy Lab Auto-Promote',
      mutationReasonCode: 'STRATEGY_LAB_PROMOTE',
      mutationObjective: candidate.hypothesis,
    });
    
    // Link bot to its first generation
    await db.update(bots)
      .set({ 
        currentGenerationId: generationId, 
        currentGeneration: 1,
        generationUpdatedAt: new Date(),
      })
      .where(eq(bots.id, newBot.id));
      
    console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} bot_id=${newBot.id} generation_1_created gen_id=${generationId}`);
  } catch (genError) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} bot_id=${newBot.id} generation_error:`, genError);
    // Don't fail promotion if generation creation fails - bot is already created
  }

  await db.update(strategyCandidates)
    .set({ 
      disposition: "SENT_TO_LAB",
      createdBotId: newBot.id,
      updatedAt: new Date(),
      dispositionReasonJson: {
        action: "AUTO_PROMOTED",
        traceId,
        promotedAt: new Date().toISOString(),
        source: "evaluateAutoPromotions",
      }
    })
    .where(eq(strategyCandidates.id, candidateId));

  // CRITICAL FIX: Queue baseline backtest immediately after promotion
  // This ensures newly promoted bots get their first backtest without waiting for scheduler
  try {
    const sessionId = await queueBaselineBacktest(newBot.id, traceId, {
      forceNew: true,
      reason: "STRATEGY_LAB_PROMOTION",
    });
    if (sessionId) {
      console.log(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} bot_id=${newBot.id} baseline_backtest_queued session_id=${sessionId}`);
    } else {
      console.warn(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} bot_id=${newBot.id} baseline_backtest_queue_failed`);
    }
  } catch (backtestError) {
    console.error(`[STRATEGY_LAB_AUTO_PROMOTE] trace_id=${traceId} bot_id=${newBot.id} baseline_backtest_error:`, backtestError);
    // Don't fail promotion if backtest queueing fails - scheduler will pick it up later
  }

  return { success: true, botId: newBot.id };
}

export function setStrategyLabResearchSettings(
  model: PerplexityModel,
  recency: SearchRecency,
  customFocus: string
): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    perplexityModel: model,
    searchRecency: recency,
    customFocus: customFocus.trim(),
    lastStateChange: new Date(),
  };
  console.log(`[STRATEGY_LAB] research settings changed: model=${model} recency=${recency} customFocus="${customFocus.slice(0, 50)}..."`);
  return getStrategyLabState();
}

export function setStrategyLabCostEfficiencyMode(enabled: boolean): StrategyLabState {
  strategyLabState = {
    ...strategyLabState,
    costEfficiencyMode: enabled,
    lastStateChange: new Date(),
  };
  
  // Sync to global for AI cascade to read
  (global as any).__costEfficiencyMode = enabled;
  
  // If enabling cost efficiency, force Quick Scan mode
  if (enabled && strategyLabState.perplexityModel !== "QUICK") {
    strategyLabState.perplexityModel = "QUICK";
    console.log(`[STRATEGY_LAB] Cost efficiency mode enabled - forcing Quick Scan research depth`);
  }
  
  console.log(`[STRATEGY_LAB] cost efficiency mode changed: enabled=${enabled} perplexityModel=${strategyLabState.perplexityModel}`);
  return getStrategyLabState();
}

export function getLastResearchCycleTime(): number {
  return lastResearchCycleTime;
}

export async function getRecentCandidates(limit: number = 20): Promise<any[]> {
  try {
    const candidates = await db
      .select()
      .from(strategyCandidates)
      .orderBy(desc(strategyCandidates.createdAt))
      .limit(limit);
    return candidates;
  } catch (error) {
    console.error("[STRATEGY_LAB_ENGINE] Error fetching recent candidates:", error);
    return [];
  }
}

export async function runStrategyLabResearchCycle(
  forceBurst: boolean = false,
  regimeTrigger?: StrategyLabRegimeTrigger,
  sourceLabBotId?: string
): Promise<ResearchCycleStats | null> {
  const traceId = crypto.randomUUID();
  const cycleStart = Date.now();
  
  if (!forceBurst && !isStrategyLabRunning()) {
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} skipping - Strategy Lab is paused`);
    return null;
  }
  
  if (!forceBurst) {
    const intervalMs = await getCurrentResearchIntervalMs();
    const timeSinceLast = Date.now() - lastResearchCycleTime;
    if (timeSinceLast < intervalMs) {
      const modeLabel = adaptiveState.currentMode === "SCANNING" ? "scanning" : adaptiveState.currentMode === "DEEP_RESEARCH" ? "deep" : "balanced";
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} skipping - last cycle ${Math.round(timeSinceLast / 60000)}min ago (threshold: ${Math.round(intervalMs / 60000)}min, mode: ${modeLabel})`);
      return null;
    }
  }
  
  console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} starting research cycle force=${forceBurst} trigger=${regimeTrigger || 'SCHEDULED'}`);
  
  // Set research activity to INITIALIZING
  setResearchActivity({
    isActive: true,
    phase: "INITIALIZING",
    provider: null,
    startedAt: new Date(),
    message: "Starting research cycle...",
    candidatesFound: 0,
    traceId,
  });
  
  // CRITICAL: Update lastResearchCycleTime at START of cycle attempt
  // This ensures depth-specific timing is honored even if cycle fails
  lastResearchCycleTime = Date.now();
  
  let effectiveTrigger = regimeTrigger || "NONE" as StrategyLabRegimeTrigger;
  
  const shouldCheckRegime = !regimeTrigger && (!forceBurst || shouldAlwaysCheckRegime());
  if (shouldCheckRegime) {
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} checking regime triggers (mode=${adaptiveState.currentMode})`);
    for (const symbol of SYMBOLS_TO_MONITOR) {
      try {
        const triggerResult = await detectStrategyLabTrigger(symbol, traceId);
        if (triggerResult.shouldBurstResearch && triggerResult.trigger !== "NONE") {
          effectiveTrigger = triggerResult.trigger;
          console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} burst trigger detected: ${effectiveTrigger} for ${symbol}`);
          break;
        }
      } catch (error) {
        console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} regime check failed for ${symbol}:`, error);
      }
    }
  }
  
  const context: ResearchContext = {
    regimeTrigger: effectiveTrigger !== "NONE" ? effectiveTrigger : undefined,
  };
  
  if (sourceLabBotId) {
    context.sourceLabBotId = sourceLabBotId;
    context.sourceLabFailure = await getLabBotFailureContext(sourceLabBotId, traceId);
  }
  
  // Set activity to RESEARCHING with provider
  setResearchActivity({
    phase: "RESEARCHING",
    provider: "perplexity",
    message: "Researching market patterns with Perplexity AI...",
  });
  
  let researchResult: Awaited<ReturnType<typeof runPerplexityResearch>>;
  try {
    researchResult = await runPerplexityResearch(context, DEFAULT_USER_ID);
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} research threw exception: ${errorMessage}`);
    
    // Log activity event so failure is visible in UI
    await logActivityEvent({
      eventType: "STRATEGY_LAB_RESEARCH",
      severity: "ERROR",
      title: "Strategy Lab Research Failed",
      summary: `Research failed: ${errorMessage}`,
      payload: { traceId, error: errorMessage, provider: "perplexity", success: false },
      traceId,
    });
    
    setResearchActivity({
      isActive: false,
      phase: "IDLE",
      provider: null,
      message: `Research failed: ${errorMessage}`,
      candidatesFound: 0,
    });
    return null;
  }
  
  if (!researchResult.success || researchResult.candidates.length === 0) {
    const errorMessage = researchResult.error || "No candidates found";
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} research failed or no candidates: ${errorMessage}`);
    
    // Log activity event so failure is visible in UI
    await logActivityEvent({
      eventType: "STRATEGY_LAB_RESEARCH",
      severity: "WARN",
      title: "Strategy Lab Research: No Results",
      summary: errorMessage,
      payload: { traceId, error: errorMessage, candidatesFound: 0, success: false },
      traceId,
    });
    
    setResearchActivity({
      isActive: false,
      phase: "IDLE",
      provider: null,
      message: errorMessage,
      candidatesFound: 0,
    });
    return null;
  }
  
  // Set activity to EVALUATING
  setResearchActivity({
    phase: "EVALUATING",
    message: `Evaluating ${researchResult.candidates.length} strategy candidates...`,
    candidatesFound: researchResult.candidates.length,
  });
  
  const stats: ResearchCycleStats = {
    cycleId: traceId,
    timestamp: new Date(),
    trigger: effectiveTrigger,
    candidatesGenerated: researchResult.candidates.length,
    sentToLab: 0,
    queued: 0,
    rejected: 0,
    merged: 0,
    durationMs: 0,
    depth: strategyLabState.currentDepth,
  };
  
  for (const candidate of researchResult.candidates) {
    try {
      const dispositionResult = await processCandidate(candidate, effectiveTrigger, sourceLabBotId, traceId);
      
      switch (dispositionResult.disposition) {
        case "SENT_TO_LAB":
          stats.sentToLab++;
          break;
        case "QUEUED":
        case "PENDING_REVIEW":
          stats.queued++;
          break;
        case "REJECTED":
          stats.rejected++;
          break;
        case "MERGED":
          stats.merged++;
          break;
      }
    } catch (error) {
      console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to process candidate ${candidate.strategyName}:`, error);
    }
  }
  
  stats.durationMs = Date.now() - cycleStart;
  
  // Note: lastResearchCycleTime already updated at start of cycle
  researchCycleStats.push(stats);
  if (researchCycleStats.length > MAX_STATS_HISTORY) {
    researchCycleStats.shift();
  }
  
  await logActivityEvent({
    eventType: "STRATEGY_LAB_CYCLE",
    severity: "INFO",
    title: `Strategy Lab Research Cycle Complete`,
    summary: `Generated ${stats.candidatesGenerated} candidates: ${stats.sentToLab} to LAB, ${stats.queued} queued, ${stats.rejected} rejected`,
    payload: {
      ...stats,
      trigger: effectiveTrigger,
      triggerDescription: getStrategyLabTriggerDescription(effectiveTrigger),
    },
    traceId,
  });
  
  console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} cycle complete in ${stats.durationMs}ms: generated=${stats.candidatesGenerated} toLab=${stats.sentToLab} queued=${stats.queued} rejected=${stats.rejected}`);
  
  // Set activity to COMPLETE then IDLE
  setResearchActivity({
    isActive: false,
    phase: "COMPLETE",
    provider: null,
    message: `Found ${stats.candidatesGenerated} candidates (${stats.queued} queued, ${stats.sentToLab} to LAB)`,
    candidatesFound: stats.candidatesGenerated,
  });
  
  // After a short delay, reset to IDLE
  setTimeout(() => {
    setResearchActivity({
      phase: "IDLE",
      message: "Waiting for next research cycle",
      traceId: null,
    });
  }, 3000);
  
  return stats;
}

interface CandidateProcessResult {
  disposition: "SENT_TO_LAB" | "QUEUED" | "REJECTED" | "MERGED" | "PENDING_REVIEW";
  candidateId: string | null;
  reason: string;
}

async function processCandidate(
  candidate: ResearchCandidate,
  regimeTrigger: StrategyLabRegimeTrigger,
  sourceLabBotId: string | undefined,
  traceId: string
): Promise<CandidateProcessResult> {
  const rulesHash = generateRulesHash(candidate.rules);
  
  const existingResult = await db.execute(sql`
    SELECT id, disposition, confidence_score 
    FROM strategy_candidates 
    WHERE rules_hash = ${rulesHash}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0] as any;
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} candidate ${candidate.strategyName} MERGED with existing ${existing.id.slice(0, 8)}`);
    
    await db.execute(sql`
      UPDATE strategy_candidates 
      SET updated_at = NOW(),
          merge_count = COALESCE(merge_count, 0) + 1
      WHERE id = ${existing.id}::uuid
    `);
    
    return {
      disposition: "MERGED",
      candidateId: existing.id,
      reason: `Merged with existing candidate (hash: ${rulesHash})`,
    };
  }
  
  // Additional name-based deduplication check for active candidates
  const nameCheckResult = await db.execute(sql`
    SELECT id, disposition, confidence_score 
    FROM strategy_candidates 
    WHERE strategy_name = ${candidate.strategyName}
    AND disposition IN ('PENDING_REVIEW', 'QUEUED', 'SENT_TO_LAB')
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  if (nameCheckResult.rows.length > 0) {
    const existing = nameCheckResult.rows[0] as any;
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} candidate ${candidate.strategyName} MERGED with same-name active candidate ${existing.id.slice(0, 8)}`);
    
    await db.execute(sql`
      UPDATE strategy_candidates 
      SET updated_at = NOW(),
          merge_count = COALESCE(merge_count, 0) + 1
      WHERE id = ${existing.id}::uuid
    `);
    
    return {
      disposition: "MERGED",
      candidateId: existing.id,
      reason: `Merged with same-name active candidate`,
    };
  }
  
  const confidenceScore = candidate.confidence.score;
  let disposition: "SENT_TO_LAB" | "QUEUED" | "REJECTED" | "PENDING_REVIEW";
  let reason: string;
  
  const breakdown = candidate.confidence.breakdown;
  const structuralScore = breakdown.structuralSoundness ?? 0;
  const researchScore = breakdown.researchConfidence ?? 0;
  
  // Check if manual approval is required
  const requireManualApproval = strategyLabState.requireManualApproval;
  
  // FIX: Use ADJUSTED score (raw + regime bonus) for threshold comparison
  // This matches what the UI displays and ensures consistent promotion decisions
  // Use the regimeTrigger already passed to this function (or default to NONE)
  const archetypeName = candidate.archetypeName || 'unknown';
  const effectiveRegime = regimeTrigger !== "NONE" ? regimeTrigger : "VOLATILITY_EXPANSION" as any;
  const regimeAdjustment = calculateRegimeAdjustedScore(archetypeName, confidenceScore, effectiveRegime);
  const adjustedScore = regimeAdjustment.adjustedScore;
  const regimeBonus = regimeAdjustment.regimeBonus;
  
  // User's threshold applies to the ADJUSTED score (what the UI shows)
  const userPromoteThreshold = strategyLabState.autoPromoteThreshold;
  
  if (structuralScore < 10) {
    disposition = "REJECTED";
    reason = "HARD_GATE: Structural soundness < 10";
  } else if (researchScore < 8 && structuralScore > 15) {
    disposition = requireManualApproval ? "PENDING_REVIEW" : "QUEUED";
    reason = "EXPERIMENTAL: Low research confidence + high structural soundness requires review";
  } else if (adjustedScore >= userPromoteThreshold) {
    // Only auto-promote if ADJUSTED confidence meets user's configured threshold
    disposition = requireManualApproval ? "PENDING_REVIEW" : "SENT_TO_LAB";
    reason = requireManualApproval 
      ? `Adjusted score ${adjustedScore} (${confidenceScore}+${regimeBonus}) >= ${userPromoteThreshold} (awaiting manual approval)`
      : `Adjusted score ${adjustedScore} (${confidenceScore}+${regimeBonus}) >= ${userPromoteThreshold} threshold`;
  } else if (adjustedScore >= MIN_CONFIDENCE_FOR_QUEUE) {
    // Below user's threshold but above queue minimum - put in queue for later review
    disposition = requireManualApproval ? "PENDING_REVIEW" : "QUEUED";
    reason = `Adjusted score ${adjustedScore} below auto-promote threshold (${userPromoteThreshold}), queued for review`;
  } else {
    disposition = "REJECTED";
    reason = `Adjusted score ${adjustedScore} < ${MIN_CONFIDENCE_FOR_QUEUE} minimum`;
  }
  
  const source = sourceLabBotId ? "LAB_FEEDBACK" : 
    (regimeTrigger !== "NONE" ? "BURST_RESEARCH" : "SCHEDULED_RESEARCH");
  
  const lineageChain = sourceLabBotId ? [sourceLabBotId] : [];
  
  // SEV-1 FAIL-FAST: Validate archetype before persisting candidate
  // This prevents the bug where 263/268 candidates had no archetype and defaulted incorrectly
  const archetypeValidation = validateArchetype({
    archetypeName: candidate.archetypeName,
    strategyName: candidate.strategyName,
    rulesJson: candidate.rules,
    traceId,
  });
  
  // Use validated/inferred archetype or fail closed
  let validatedArchetype: string | null = null;
  if (archetypeValidation.valid && archetypeValidation.inferredArchetype) {
    validatedArchetype = archetypeValidation.inferredArchetype;
  } else {
    // FAIL-CLOSED: Log error and reject candidate without valid archetype
    console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} ARCHETYPE_VALIDATION_FAILED strategy="${candidate.strategyName}" errors=${formatValidationErrors(archetypeValidation)}`);
    
    return {
      disposition: "REJECTED",
      candidateId: undefined,
      reason: `ARCHETYPE_REQUIRED: ${formatValidationErrors(archetypeValidation)}`,
    };
  }
  
  const insertResult = await db.insert(strategyCandidates).values({
    strategyName: candidate.strategyName,
    archetypeName: validatedArchetype,
    hypothesis: candidate.hypothesis,
    rulesJson: candidate.rules,
    confidenceScore,
    adjustedScore,   // FIX: Persist regime-adjusted score
    regimeBonus,     // FIX: Persist regime bonus for audit trail
    confidenceBreakdownJson: candidate.confidence.breakdown,
    evidenceJson: candidate.evidence,
    disposition,
    source: source as any,
    regimeTrigger: regimeTrigger !== "NONE" ? regimeTrigger as any : null,
    sourceLabBotId: sourceLabBotId || null,
    sourceLabFailureJson: candidate.sourceLabFailure || null,
    rulesHash,
    instrumentUniverse: candidate.instrumentUniverse,
    timeframePreferences: candidate.timeframePreferences,
    sessionModePreference: candidate.sessionModePreference,
    noveltyJustificationJson: candidate.noveltyJustification,
    dataRequirementsJson: candidate.dataRequirements,
    explainersJson: candidate.explainers,
    plainLanguageSummaryJson: candidate.plainLanguageSummary || null,
    lineageChain,
    researchCycleId: traceId,
  }).returning({ id: strategyCandidates.id });
  
  const candidateId = insertResult[0]?.id;
  
  // Calculate and persist novelty score for new candidate
  if (candidateId) {
    try {
      // Get all existing candidates for comparison
      const existingCandidates = await db.execute(sql`
        SELECT id, archetype_name, hypothesis, rules_json
        FROM strategy_candidates
        WHERE id != ${candidateId}
        LIMIT 500
      `);
      
      const noveltyData: NoveltyComparisonData = {
        id: candidateId,
        archetype_name: validatedArchetype,  // Use validated archetype, not raw candidate value
        hypothesis: candidate.hypothesis,
        rules_json: candidate.rules,
      };
      
      const noveltyScore = calculateNoveltyScore(noveltyData, existingCandidates.rows as NoveltyComparisonData[]);
      
      // Update the candidate with calculated novelty score
      await db.execute(sql`
        UPDATE strategy_candidates
        SET novelty_score = ${noveltyScore}
        WHERE id = ${candidateId}
      `);
      
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} novelty_score=${noveltyScore} for candidate="${candidate.strategyName}"`);
    } catch (noveltyError) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to calculate novelty:`, noveltyError);
    }
  }
  
  // Create AI injection record for feedback tracking (works for Perplexity and other providers)
  if (candidateId && disposition !== "REJECTED") {
    try {
      await db.insert(grokInjections).values({
        candidateId,
        strategyName: candidate.strategyName,
        archetypeName: validatedArchetype || "UNKNOWN",  // Use validated archetype for injection tracking
        aiProvider: "PERPLEXITY", // Strategy Lab uses Perplexity for research
        researchDepth: regimeTrigger !== "NONE" ? "BURST_RESEARCH" : "SCHEDULED_RESEARCH",
        source: sourceLabBotId ? "LAB_FEEDBACK" : "PERPLEXITY_SCHEDULED",
        disposition: disposition === "SENT_TO_LAB" ? "AUTO_CREATE_BOT" : 
                     disposition === "QUEUED" ? "QUEUE_FOR_REVIEW" : "PENDING_REVIEW",
        confidenceScore: confidenceScore,
        noveltyScore: 50, // Default novelty score, will be calculated later if needed
        hypothesis: candidate.hypothesis?.slice(0, 500),
        rulesHash,
        evolutionGeneration: 0,
      });
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} created AI injection for candidate="${candidate.strategyName}"`);
    } catch (injectionError) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to create AI injection:`, injectionError);
    }
  }
  
  if (candidateId && sourceLabBotId && disposition === "SENT_TO_LAB") {
    await linkCandidateToFeedbackLoopInternal(candidateId, sourceLabBotId, traceId);
  }
  
  // If auto-promoted to SENT_TO_LAB, actually create the LAB bot
  // Pass validated archetype to ensure consistency across all downstream processes
  if (candidateId && disposition === "SENT_TO_LAB") {
    const botResult = await createLabBotFromCandidate(candidateId, candidate, traceId, validatedArchetype);
    if (botResult) {
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} candidate ${candidate.strategyName} auto-promoted to LAB bot ${botResult.botId}`);
    } else {
      // Bot creation failed - revert to QUEUED for manual review
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} bot creation failed, reverting candidate to QUEUED`);
      await db.update(strategyCandidates)
        .set({ disposition: "QUEUED", updatedAt: new Date() })
        .where(eq(strategyCandidates.id, candidateId));
      return {
        disposition: "QUEUED",
        candidateId,
        reason: reason + " (bot creation failed, reverted to QUEUED)",
      };
    }
  }
  
  console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} candidate ${candidate.strategyName} -> ${disposition} (confidence=${confidenceScore})`);
  
  return {
    disposition,
    candidateId: candidateId || null,
    reason,
  };
}

async function createLabBotFromCandidate(
  candidateId: string,
  candidate: ResearchCandidate,
  traceId: string,
  validatedArchetype?: string | null
): Promise<{ botId: string; botName: string } | null> {
  try {
    // Get system user
    const systemUsers = await db.select().from(users).where(eq(users.username, "BlaidAgent")).limit(1);
    const userId = systemUsers.length > 0 ? systemUsers[0].id : DEFAULT_USER_ID;
    
    // DUPLICATE GUARD 1: Check if candidate already has a bot linked
    const existingCandidate = await db.select({ createdBotId: strategyCandidates.createdBotId })
      .from(strategyCandidates)
      .where(eq(strategyCandidates.id, candidateId))
      .limit(1);
    
    if (existingCandidate[0]?.createdBotId) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} DUPLICATE_GUARD: candidate ${candidateId} already has bot ${existingCandidate[0].createdBotId}`);
      return { botId: existingCandidate[0].createdBotId, botName: candidate.strategyName };
    }
    
    // DUPLICATE GUARD 2: Check if bot with same NORMALIZED name already exists for this user
    // This catches near-duplicates like "VolComp Break" vs "VolCompBreak" vs "Vol Comp Break"
    const candidateSlug = normalizeNameToSlug(candidate.strategyName);
    const userBots = await db.select({ id: bots.id, name: bots.name })
      .from(bots)
      .where(eq(bots.userId, userId));
    
    const existingBot = userBots.find(b => normalizeNameToSlug(b.name) === candidateSlug);
    
    if (existingBot) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} DUPLICATE_GUARD: bot "${candidate.strategyName}" matches existing "${existingBot.name}" (slug="${candidateSlug}", id=${existingBot.id})`);
      // Link this candidate to the existing bot
      await db.update(strategyCandidates)
        .set({ createdBotId: existingBot.id, disposition: "SENT_TO_LAB", updatedAt: new Date() })
        .where(eq(strategyCandidates.id, candidateId));
      return { botId: existingBot.id, botName: existingBot.name };
    }
    
    // Build strategy config matching the manual promote flow in routes.ts
    // ResearchCandidate.rules has: entry[], exit[], risk[], filters[], invalidation[]
    const rules = candidate.rules || { entry: [], exit: [], risk: [], filters: [], invalidation: [] };
    
    // Create riskModel matching the format used in manual promote (simple object, not nested)
    const riskModel = {
      risk: rules.risk || [],
      invalidation: rules.invalidation || [],
      filters: rules.filters || [],
    };
    
    const strategyConfig = {
      entryRules: rules.entry || [],
      exitRules: rules.exit || [],
      riskModel,
      hypothesis: candidate.hypothesis,
      timeframes: candidate.timeframePreferences || ["5m"],
      instruments: candidate.instrumentUniverse || ["MES"],
      source: "strategy_lab_auto",
      candidateId,
      confidenceScore: candidate.confidence?.score ?? 0,
    };

    // Determine symbol from instrument universe
    const symbol = candidate.instrumentUniverse?.[0] || "MES";
    
    // Safely access confidence values
    const confidenceScore = candidate.confidence?.score ?? 0;
    const confidenceBreakdown = candidate.confidence?.breakdown ?? null;

    // Create the TRIALS bot (matching manual promote flow exactly)
    const newBot = await storage.createBot({
      userId,
      name: candidate.strategyName,
      symbol,
      status: "idle",
      mode: "BACKTEST_ONLY",
      evolutionStatus: "untested",
      stage: "TRIALS",
      archetypeId: candidate.archetypeId || null,
      strategyConfig,
      riskConfig: riskModel,
      healthScore: 100,
      priorityScore: confidenceScore,
      isCandidate: true,
      candidateScore: confidenceScore,
      candidateReasons: {
        hypothesis: candidate.hypothesis,
        confidenceBreakdown,
        regimeTrigger: candidate.triggeredByRegime,
        archetypeName: validatedArchetype || candidate.archetypeName,  // Use validated archetype first
        source: "AUTONOMOUS_RESEARCH",
      },
      sessionMode: (candidate.sessionModePreference as any) || "FULL_24x5",
      sourceCandidateId: (candidate as any).id || null,
      createdByAi: (candidate as any).createdByAi || null,
      aiProvider: (candidate as any).aiProvider || null,
      aiProviderBadge: (candidate as any).aiProvider ? true : false,
      // AI Research Provenance (sources and reasoning transparency)
      aiReasoning: (candidate as any).aiReasoning || null,
      aiResearchSources: (candidate as any).aiResearchSources || null,
      aiResearchDepth: (candidate as any).aiResearchDepth || null,
    });

    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} created TRIALS bot_id=${newBot.id} name="${newBot.name}"`);

    // Update candidate with bot linkage and disposition
    await db.update(strategyCandidates)
      .set({
        createdBotId: newBot.id,
        disposition: "SENT_TO_LAB",
        disposedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(strategyCandidates.id, candidateId));

    // Create baseline backtest job
    // Use validated archetype which has already been checked upstream
    // Only fallback to inference if validated archetype is missing (shouldn't happen with SEV-1 validation)
    const resolvedArchetype = validatedArchetype?.toUpperCase().replace(/\s+/g, '_') ||
      candidate.archetypeName?.toUpperCase().replace(/\s+/g, '_') || 
      inferArchetypeFromBotNameLocal(newBot.name) || 
      "SCALPING"; // Fail-safe default (canonical format)
      
    console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} archetype_resolution: validated="${validatedArchetype}" candidate="${candidate.archetypeName}" resolved="${resolvedArchetype}"`);
    
    try {
      await db.insert(botJobs).values({
        botId: newBot.id,
        userId,
        jobType: "BACKTESTER",
        status: "QUEUED",
        priority: 50,
        payload: {
          traceId,
          candidateId,
          hypothesis: candidate.hypothesis,
          confidenceScore,
          archetype: resolvedArchetype,
          archetypeId: candidate.archetypeId,
          timeframes: candidate.timeframePreferences || ["5m"],
          instruments: candidate.instrumentUniverse || ["MES"],
          source: "STRATEGY_LAB_AUTO_PROMOTE",
          reason: "INITIAL_BACKTEST",
          iteration: 1,
        },
      });
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} created BACKTESTER job for bot ${newBot.id}`);
    } catch (jobError: any) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} job creation warning: ${jobError.message}`);
    }

    // Emit provenance event
    try {
      await db.insert(botStageChanges).values({
        botId: newBot.id,
        fromStage: "CANDIDATE",
        toStage: "TRIALS",
        decision: "AUTO_PROMOTED",
        triggeredBy: "strategy_lab_engine",
        reasonsJson: {
          traceId,
          candidateId,
          confidenceScore: candidate.confidence.score,
          source: "AUTONOMOUS_RESEARCH",
        },
      });
    } catch (e: any) {
      console.warn(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} stage change log warning: ${e.message}`);
    }

    return { botId: newBot.id, botName: newBot.name };
  } catch (error: any) {
    console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to create TRIALS bot:`, error.message);
    return null;
  }
}

async function linkCandidateToFeedbackLoopInternal(
  candidateId: string,
  sourceLabBotId: string,
  traceId: string
): Promise<void> {
  try {
    const existingLoop = await db.execute(sql`
      SELECT id FROM lab_feedback_tracking
      WHERE source_lab_bot_id = ${sourceLabBotId}::uuid
      AND state NOT IN ('RESOLVED', 'ABANDONED')
      LIMIT 1
    `);
    
    if (existingLoop.rows.length > 0) {
      const loopId = (existingLoop.rows[0] as any).id;
      await db.execute(sql`
        UPDATE lab_feedback_tracking
        SET candidate_ids = array_append(candidate_ids, ${candidateId}::uuid),
            best_candidate_id = ${candidateId}::uuid,
            state = 'CANDIDATE_FOUND',
            updated_at = NOW()
        WHERE id = ${loopId}::uuid
      `);
      console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} linked candidate ${candidateId} to feedback loop ${loopId}`);
    }
  } catch (error) {
    console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to link candidate to feedback loop:`, error);
  }
}

async function getLabBotFailureContext(
  botId: string,
  traceId: string
): Promise<ResearchContext["sourceLabFailure"] | undefined> {
  try {
    const botResult = await db.execute(sql`
      SELECT 
        b.id, b.name, b.stage,
        bg.id as gen_id, bg.generation_number,
        bg.metrics_json
      FROM bots b
      LEFT JOIN bot_generations bg ON b.id = bg.bot_id AND b.current_generation = bg.generation_number
      WHERE b.id = ${botId}::uuid
    `);
    
    if (botResult.rows.length === 0) {
      return undefined;
    }
    
    const bot = botResult.rows[0] as any;
    const metrics = bot.metrics_json || {};
    
    return {
      failureReasonCodes: ["UNDERPERFORMANCE"],
      performanceDeltas: {
        sharpeRatio: metrics.sharpeRatio || 0,
        maxDrawdown: metrics.maxDrawdownPct || 0,
        winRate: metrics.winRate || 0,
      },
      regimeAtFailure: "UNKNOWN",
    };
  } catch (error) {
    console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failed to get failure context for ${botId}:`, error);
    return undefined;
  }
}

export function getResearchCycleStats(): ResearchCycleStats[] {
  return [...researchCycleStats];
}

export interface StrategyLabStatus {
  isActive: boolean;
  lastCycleTime: Date | null;
  nextScheduledCycle: Date | null;
  recentCycles: ResearchCycleStats[];
  totalCandidates: number;
  pendingReviewCount: number;
  sentToLabCount: number;
  queuedCount: number;
}

export async function getStrategyLabStatus(): Promise<StrategyLabStatus> {
  const countsResult = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE disposition = 'PENDING_REVIEW') as pending_review,
      COUNT(*) FILTER (WHERE disposition = 'SENT_TO_LAB') as sent_to_lab,
      COUNT(*) FILTER (WHERE disposition = 'QUEUED') as queued
    FROM strategy_candidates
    WHERE created_at > NOW() - INTERVAL '7 days'
  `);
  
  const counts = countsResult.rows[0] as any || {};
  
  const intervalMs = adaptiveState.currentIntervalMs;
  const nextCycleTime = lastResearchCycleTime > 0
    ? new Date(lastResearchCycleTime + intervalMs)
    : new Date(Date.now() + intervalMs);
  
  return {
    isActive: true,
    lastCycleTime: lastResearchCycleTime > 0 ? new Date(lastResearchCycleTime) : null,
    nextScheduledCycle: nextCycleTime,
    recentCycles: researchCycleStats.slice(-5),
    totalCandidates: parseInt(counts.total) || 0,
    pendingReviewCount: parseInt(counts.pending_review) || 0,
    sentToLabCount: parseInt(counts.sent_to_lab) || 0,
    queuedCount: parseInt(counts.queued) || 0,
  };
}

export async function getCandidatesByDisposition(
  disposition: "PENDING_REVIEW" | "SENT_TO_LAB" | "QUEUED" | "QUEUED_FOR_QC" | "REJECTED" | "MERGED" | "EXPIRED" | "ALL",
  limit: number = 50
): Promise<any[]> {
  if (disposition === "ALL") {
    // Priority ordering: QUEUED_FOR_QC first (active testing), then SENT_TO_LAB, then by recency
    // This ensures Testing tab always shows all active QC candidates
    // Include evolution data: recycled_from_id, generation depth, and parent name
    const result = await db.execute(sql`
      WITH evolution_depth AS (
        -- Calculate how many generations deep each evolved candidate is
        SELECT 
          c.id,
          CASE 
            WHEN c.recycled_from_id IS NULL THEN 1
            ELSE (
              -- Count chain depth: parent + 1
              WITH RECURSIVE chain AS (
                SELECT id, recycled_from_id, 1 as depth FROM strategy_candidates WHERE id = c.id
                UNION ALL
                SELECT sc.id, sc.recycled_from_id, ch.depth + 1
                FROM strategy_candidates sc
                JOIN chain ch ON ch.recycled_from_id = sc.id
                WHERE sc.id IS NOT NULL
              )
              SELECT MAX(depth) FROM chain
            )
          END as generation
        FROM strategy_candidates c
        WHERE c.source = 'LAB_FEEDBACK' OR c.recycled_from_id IS NOT NULL
      )
      SELECT 
        c.id, c.strategy_name, c.archetype_name, c.hypothesis,
        c.confidence_score, c.adjusted_score, c.regime_bonus,
        c.confidence_breakdown_json, c.novelty_score,
        c.rules_json, c.explainers_json, c.evidence_json, 
        c.disposition, c.source, c.regime_trigger, c.instrument_universe,
        c.source_lab_bot_id, c.created_bot_id, c.created_at, c.updated_at,
        c.recycled_from_id,
        c.ai_provider, c.created_by_ai,
        COALESCE(ed.generation, 1) as evolution_generation,
        parent.strategy_name as parent_strategy_name
      FROM strategy_candidates c
      LEFT JOIN evolution_depth ed ON ed.id = c.id
      LEFT JOIN strategy_candidates parent ON c.recycled_from_id = parent.id
      ORDER BY 
        CASE 
          WHEN c.disposition = 'QUEUED_FOR_QC' THEN 0
          WHEN c.disposition = 'SENT_TO_LAB' THEN 1
          WHEN c.disposition = 'PENDING_REVIEW' THEN 2
          WHEN c.disposition = 'QUEUED' THEN 3
          ELSE 4
        END,
        c.created_at DESC
      LIMIT ${limit}
    `);
    return result.rows;
  }
  
  const result = await db.execute(sql`
    WITH evolution_depth AS (
      SELECT 
        c.id,
        CASE 
          WHEN c.recycled_from_id IS NULL THEN 1
          ELSE (
            WITH RECURSIVE chain AS (
              SELECT id, recycled_from_id, 1 as depth FROM strategy_candidates WHERE id = c.id
              UNION ALL
              SELECT sc.id, sc.recycled_from_id, ch.depth + 1
              FROM strategy_candidates sc
              JOIN chain ch ON ch.recycled_from_id = sc.id
              WHERE sc.id IS NOT NULL
            )
            SELECT MAX(depth) FROM chain
          )
        END as generation
      FROM strategy_candidates c
      WHERE c.source = 'LAB_FEEDBACK' OR c.recycled_from_id IS NOT NULL
    )
    SELECT 
      c.id, c.strategy_name, c.archetype_name, c.hypothesis,
      c.confidence_score, c.adjusted_score, c.regime_bonus,
      c.confidence_breakdown_json, c.novelty_score,
      c.rules_json, c.explainers_json, c.evidence_json, 
      c.disposition, c.source, c.regime_trigger, c.instrument_universe,
      c.source_lab_bot_id, c.created_bot_id, c.created_at, c.updated_at,
      c.recycled_from_id,
      c.ai_provider, c.created_by_ai,
      COALESCE(ed.generation, 1) as evolution_generation,
      parent.strategy_name as parent_strategy_name
    FROM strategy_candidates c
    LEFT JOIN evolution_depth ed ON ed.id = c.id
    LEFT JOIN strategy_candidates parent ON c.recycled_from_id = parent.id
    WHERE c.disposition = ${disposition}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `);
  
  return result.rows;
}

export async function triggerLabFeedbackResearch(
  labBotId: string,
  failureReasons: string[]
): Promise<ResearchCycleStats | null> {
  console.log(`[STRATEGY_LAB_ENGINE] LAB_FEEDBACK triggered for bot ${labBotId}: ${failureReasons.join(", ")}`);
  
  return runStrategyLabResearchCycle(true, "NONE", labBotId);
}

export type LabFailureReasonCode = 
  | "UNDERPERFORMANCE"
  | "DEGRADATION"
  | "REGIME_MISMATCH"
  | "STAGNATION"
  | "HIGH_DRAWDOWN"
  | "LOW_SHARPE"
  | "LOW_WIN_RATE"
  | "EXCESSIVE_LOSSES"
  | "STRUCTURAL_FLAW"
  | "TIMING_INEFFICIENCY"
  | "RISK_MISCALIBRATION"
  | "EXECUTION_INEFFICIENCY"
  | "LIQUIDITY_MISMATCH";

interface LabFailureThresholds {
  minSharpeRatio: number;
  maxDrawdownPct: number;
  minWinRate: number;
  minTradesForEval: number;
  stagnationDays: number;
  degradationWindow: number;
  degradationThresholdPct: number;
}

const DEFAULT_LAB_FAILURE_THRESHOLDS: LabFailureThresholds = {
  minSharpeRatio: 0.3,
  maxDrawdownPct: 25,
  minWinRate: 35,
  minTradesForEval: 20,
  stagnationDays: 3,
  degradationWindow: 5,
  degradationThresholdPct: 15,
};

export function determineRecycleDecision(
  reasonCodes: LabFailureReasonCode[],
  severity: "NONE" | "MINOR" | "MAJOR" | "CRITICAL" = "NONE",
  reworkAttempts: number = 0,
  regimeAtDetection: string = "UNKNOWN"
): { decision: RecycleDecision; reason: string } {
  if (reworkAttempts >= 2) {
    return { decision: "KILL", reason: "Failed twice after rework - structural issue" };
  }
  
  if (reasonCodes.includes("STRUCTURAL_FLAW")) {
    return { decision: "KILL", reason: "Structural logic flaw detected" };
  }
  
  if (reasonCodes.includes("REGIME_MISMATCH") && regimeAtDetection !== "UNKNOWN") {
    return { decision: "REPLACE", reason: `Regime mismatch in ${regimeAtDetection} - generate new archetype` };
  }
  
  if (severity === "CRITICAL" && reasonCodes.length >= 3) {
    return { decision: "KILL", reason: "Critical multi-factor failure - unfixable" };
  }
  
  if (reasonCodes.includes("EXCESSIVE_LOSSES") && reasonCodes.includes("LOW_SHARPE")) {
    return { decision: "KILL", reason: "Negative expectancy across regimes" };
  }
  
  if (reasonCodes.includes("REGIME_MISMATCH") && reasonCodes.length >= 3) {
    return { decision: "REPLACE", reason: "Regime permanently hostile - thesis invalidated" };
  }
  
  if (reasonCodes.includes("TIMING_INEFFICIENCY") || reasonCodes.includes("RISK_MISCALIBRATION")) {
    return { decision: "TWEAK", reason: "Entry/exit imbalance or risk miscalibration" };
  }
  
  if (reasonCodes.includes("LOW_WIN_RATE") && !reasonCodes.includes("LOW_SHARPE")) {
    return { decision: "TWEAK", reason: "Win rate below expectation - parameter adjustment needed" };
  }
  
  if (reasonCodes.includes("STAGNATION")) {
    return { decision: "TWEAK", reason: "Stagnation detected - timing inefficiency" };
  }
  
  if (reasonCodes.includes("HIGH_DRAWDOWN") && reasonCodes.length === 1) {
    return { decision: "TWEAK", reason: "Drawdown breach - risk envelope adjustment needed" };
  }
  
  if (reasonCodes.includes("DEGRADATION") && reasonCodes.includes("REGIME_MISMATCH")) {
    return { decision: "REPLACE", reason: "Regime shift invalidated thesis" };
  }
  
  if (reasonCodes.length >= 2) {
    return { decision: "REPLACE", reason: "Multiple failure modes - better alternative needed" };
  }
  
  return { decision: "TWEAK", reason: "Single failure mode - parameter refinement" };
}

export interface LabFailureDetectionResult {
  botId: string;
  botName: string;
  isFailure: boolean;
  reasonCodes: LabFailureReasonCode[];
  reasons: string[];
  severity: "NONE" | "MINOR" | "MAJOR" | "CRITICAL";
  recycleDecision?: RecycleDecision;
  recycleReason?: string;
  strategyClass?: StrategyClass;
  minTradesRequired?: number;
  meetsEvaluationThreshold: boolean;
  metrics: {
    sharpeRatio: number;
    maxDrawdownPct: number;
    winRate: number;
    tradeCount: number;
    daysSinceLastTrade: number;
    degradationPct: number;
  };
  regimeAtDetection: string;
  detectedAt: Date;
}

export async function detectLabBotFailure(
  botId: string,
  traceId: string,
  thresholds: Partial<LabFailureThresholds> = {}
): Promise<LabFailureDetectionResult> {
  const mergedThresholds = { ...DEFAULT_LAB_FAILURE_THRESHOLDS, ...thresholds };
  
  const botResult = await db.execute(sql`
    SELECT 
      b.id, b.name, b.stage, b.strategy_config,
      bg.id as gen_id, bg.generation_number, bg.metrics_json,
      bg.regime_at_creation
    FROM bots b
    LEFT JOIN bot_generations bg ON b.id = bg.bot_id AND b.current_generation = bg.generation_number
    WHERE b.id = ${botId}::uuid AND b.stage = 'TRIALS'
  `);
  
  if (botResult.rows.length === 0) {
    return {
      botId,
      botName: "Unknown",
      isFailure: false,
      reasonCodes: [],
      reasons: ["Bot not found or not in TRIALS stage"],
      severity: "NONE",
      meetsEvaluationThreshold: false,
      metrics: {
        sharpeRatio: 0,
        maxDrawdownPct: 0,
        winRate: 0,
        tradeCount: 0,
        daysSinceLastTrade: 0,
        degradationPct: 0,
      },
      regimeAtDetection: "UNKNOWN",
      detectedAt: new Date(),
    };
  }
  
  const bot = botResult.rows[0] as any;
  const metrics = bot.metrics_json || {};
  const strategyConfig = bot.strategy_config || {};
  
  let strategyClass: StrategyClass = "INTRADAY";
  const rawTimeframe = strategyConfig.timeframes?.[0] || strategyConfig.timeframe || "5m";
  const timeframeLower = rawTimeframe.toLowerCase();
  
  if (rawTimeframe === "1M" || timeframeLower === "1mo" || timeframeLower === "monthly" || timeframeLower === "1w" || timeframeLower === "weekly") {
    strategyClass = "POSITION";
  } else if (timeframeLower === "4h" || timeframeLower === "1d" || timeframeLower === "240m" || timeframeLower === "daily") {
    strategyClass = "SWING";
  } else if (timeframeLower === "15m" || timeframeLower === "30m" || timeframeLower === "1h" || timeframeLower === "60m") {
    strategyClass = "INTRADAY";
  } else if (timeframeLower === "1m" || timeframeLower === "5m" || (timeframeLower.includes("min") && parseInt(timeframeLower) <= 5)) {
    strategyClass = "SCALPING";
  }
  
  const minTradesRequired = getMinTradesForClass(strategyClass);
  mergedThresholds.minTradesForEval = minTradesRequired;
  
  const tradeCountResult = await db.execute(sql`
    SELECT 
      COUNT(*) as trade_count,
      MAX(entry_time) as last_trade_time
    FROM backtest_trades
    WHERE bot_id = ${botId}::uuid
    AND generation_id = ${bot.gen_id}::uuid
  `);
  
  const tradeData = tradeCountResult.rows[0] as any || {};
  const tradeCount = parseInt(tradeData.trade_count) || 0;
  const lastTradeTime = tradeData.last_trade_time ? new Date(tradeData.last_trade_time) : null;
  const daysSinceLastTrade = lastTradeTime 
    ? Math.floor((Date.now() - lastTradeTime.getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  
  const recentMetricsResult = await db.execute(sql`
    SELECT metrics_json, created_at
    FROM bot_generations
    WHERE bot_id = ${botId}::uuid
    ORDER BY generation_number DESC
    LIMIT ${mergedThresholds.degradationWindow}
  `);
  
  const sharpeRatio = parseFloat(metrics.sharpeRatio) || 0;
  const maxDrawdownPct = parseFloat(metrics.maxDrawdownPct) || 0;
  const winRate = parseFloat(metrics.winRate) || 0;
  
  let degradationPct = 0;
  if (recentMetricsResult.rows.length >= 2) {
    const recent = recentMetricsResult.rows as any[];
    const latestSharpe = parseFloat(recent[0]?.metrics_json?.sharpeRatio) || 0;
    const earliestSharpe = parseFloat(recent[recent.length - 1]?.metrics_json?.sharpeRatio) || 0;
    if (earliestSharpe > 0) {
      degradationPct = ((earliestSharpe - latestSharpe) / earliestSharpe) * 100;
    }
  }
  
  const reasonCodes: LabFailureReasonCode[] = [];
  const reasons: string[] = [];
  
  if (tradeCount >= mergedThresholds.minTradesForEval) {
    if (sharpeRatio < mergedThresholds.minSharpeRatio) {
      reasonCodes.push("LOW_SHARPE");
      reasons.push(`Sharpe ratio ${sharpeRatio.toFixed(2)} below minimum ${mergedThresholds.minSharpeRatio}`);
    }
    
    if (maxDrawdownPct > mergedThresholds.maxDrawdownPct) {
      reasonCodes.push("HIGH_DRAWDOWN");
      reasons.push(`Max drawdown ${maxDrawdownPct.toFixed(1)}% exceeds limit ${mergedThresholds.maxDrawdownPct}%`);
    }
    
    if (winRate < mergedThresholds.minWinRate) {
      reasonCodes.push("LOW_WIN_RATE");
      reasons.push(`Win rate ${winRate.toFixed(1)}% below minimum ${mergedThresholds.minWinRate}%`);
    }
  }
  
  if (daysSinceLastTrade >= mergedThresholds.stagnationDays && tradeCount > 0) {
    reasonCodes.push("STAGNATION");
    reasons.push(`No trades for ${daysSinceLastTrade} days (threshold: ${mergedThresholds.stagnationDays})`);
  }
  
  if (degradationPct >= mergedThresholds.degradationThresholdPct) {
    reasonCodes.push("DEGRADATION");
    reasons.push(`Performance degraded ${degradationPct.toFixed(1)}% over ${mergedThresholds.degradationWindow} generations`);
  }
  
  if (reasonCodes.includes("LOW_SHARPE") || reasonCodes.includes("HIGH_DRAWDOWN")) {
    reasonCodes.push("UNDERPERFORMANCE");
  }
  
  let severity: "NONE" | "MINOR" | "MAJOR" | "CRITICAL" = "NONE";
  if (reasonCodes.length >= 3 || reasonCodes.includes("HIGH_DRAWDOWN")) {
    severity = "CRITICAL";
  } else if (reasonCodes.length >= 2) {
    severity = "MAJOR";
  } else if (reasonCodes.length >= 1) {
    severity = "MINOR";
  }
  
  const isFailure = severity !== "NONE";
  const meetsEvaluationThreshold = tradeCount >= minTradesRequired;
  
  let recycleDecision: RecycleDecision | undefined;
  let recycleReason: string | undefined;
  
  if (isFailure) {
    const reworkAttempts = parseInt(strategyConfig.reworkAttempts || "0");
    const recycleResult = determineRecycleDecision(
      reasonCodes,
      severity,
      reworkAttempts,
      bot.regime_at_creation || "UNKNOWN"
    );
    recycleDecision = recycleResult.decision;
    recycleReason = recycleResult.reason;
    
    await logActivityEvent({
      botId,
      eventType: "LAB_FAILURE_DETECTED",
      severity: severity === "CRITICAL" ? "ERROR" : severity === "MAJOR" ? "WARN" : "INFO",
      title: `LAB Failure Detected: ${bot.name}`,
      summary: reasons.join("; "),
      payload: {
        reasonCodes,
        metrics: { sharpeRatio, maxDrawdownPct, winRate, tradeCount, daysSinceLastTrade, degradationPct },
        severity,
        regimeAtDetection: bot.regime_at_creation || "UNKNOWN",
        strategyClass,
        minTradesRequired,
        meetsEvaluationThreshold,
        recycleDecision,
        recycleReason,
      },
      traceId,
    });
  }
  
  return {
    botId,
    botName: bot.name,
    isFailure,
    reasonCodes,
    reasons,
    severity,
    recycleDecision,
    recycleReason,
    strategyClass,
    minTradesRequired,
    meetsEvaluationThreshold,
    metrics: {
      sharpeRatio,
      maxDrawdownPct,
      winRate,
      tradeCount,
      daysSinceLastTrade,
      degradationPct,
    },
    regimeAtDetection: bot.regime_at_creation || "UNKNOWN",
    detectedAt: new Date(),
  };
}

export async function scanLabBotsForFailures(
  traceId: string
): Promise<LabFailureDetectionResult[]> {
  const labBotsResult = await db.execute(sql`
    SELECT id FROM bots WHERE stage = 'TRIALS' AND status != 'ARCHIVED'
  `);
  
  const failures: LabFailureDetectionResult[] = [];
  
  for (const row of labBotsResult.rows as any[]) {
    try {
      const result = await detectLabBotFailure(row.id, traceId);
      if (result.isFailure) {
        failures.push(result);
      }
    } catch (error) {
      console.error(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} failure scan error for ${row.id}:`, error);
    }
  }
  
  console.log(`[STRATEGY_LAB_ENGINE] trace_id=${traceId} scanned TRIALS bots: ${labBotsResult.rows.length} total, ${failures.length} with failures`);
  
  return failures;
}

export async function processLabFailuresAndTriggerResearch(
  traceId: string
): Promise<{ processedCount: number; researchTriggered: boolean }> {
  const failures = await scanLabBotsForFailures(traceId);
  
  const criticalOrMajor = failures.filter(f => f.severity === "CRITICAL" || f.severity === "MAJOR");
  
  if (criticalOrMajor.length === 0) {
    return { processedCount: failures.length, researchTriggered: false };
  }
  
  const mostCritical = criticalOrMajor.sort((a, b) => {
    if (a.severity === "CRITICAL" && b.severity !== "CRITICAL") return -1;
    if (b.severity === "CRITICAL" && a.severity !== "CRITICAL") return 1;
    return b.reasonCodes.length - a.reasonCodes.length;
  })[0];
  
  await logActivityEvent({
    botId: mostCritical.botId,
    eventType: "LAB_FEEDBACK_TRIGGERED",
    severity: "INFO",
    title: `LAB Feedback Research Triggered`,
    summary: `Bot ${mostCritical.botName} failure triggered research: ${mostCritical.reasonCodes.join(", ")}`,
    payload: {
      triggeringBotId: mostCritical.botId,
      triggeringBotName: mostCritical.botName,
      failureReasons: mostCritical.reasonCodes,
      totalFailures: failures.length,
    },
    traceId,
  });
  
  await triggerLabFeedbackResearch(mostCritical.botId, mostCritical.reasonCodes);
  
  return { processedCount: failures.length, researchTriggered: true };
}

export type LabFeedbackState = 
  | "IDLE"
  | "FAILURE_DETECTED"
  | "RESEARCHING_REPLACEMENT"
  | "RESEARCHING_REPAIR"
  | "CANDIDATE_FOUND"
  | "CANDIDATE_TESTING"
  | "RESOLVED"
  | "ABANDONED";

export interface FeedbackLoopContext {
  trackingId: string;
  sourceLabBotId: string;
  state: LabFeedbackState;
  failureReasons: string[];
  candidateIds: string[];
  bestCandidateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createFeedbackLoop(
  failure: LabFailureDetectionResult,
  traceId: string
): Promise<string | null> {
  try {
    const existingResult = await db.execute(sql`
      SELECT id FROM lab_feedback_tracking
      WHERE source_lab_bot_id = ${failure.botId}::uuid
      AND state NOT IN ('RESOLVED', 'ABANDONED')
      LIMIT 1
    `);
    
    if (existingResult.rows.length > 0) {
      console.log(`[FEEDBACK_LOOP] trace_id=${traceId} active feedback loop already exists for ${failure.botId}`);
      return (existingResult.rows[0] as any).id;
    }
    
    const insertResult = await db.insert(labFeedbackTracking).values({
      sourceLabBotId: failure.botId,
      failureReasonCodes: failure.reasonCodes,
      failureMetricsJson: failure.metrics,
      regimeAtFailure: failure.regimeAtDetection,
      state: "FAILURE_DETECTED",
      traceId,
    }).returning({ id: labFeedbackTracking.id });
    
    const loopId = insertResult[0]?.id;
    
    console.log(`[FEEDBACK_LOOP] trace_id=${traceId} created loop ${loopId} for bot ${failure.botId} with reasons: ${failure.reasonCodes.join(", ")}`);
    
    return loopId || null;
  } catch (error) {
    console.error(`[FEEDBACK_LOOP] trace_id=${traceId} failed to create loop for ${failure.botId}:`, error);
    return null;
  }
}

export async function transitionFeedbackState(
  trackingId: string,
  newState: LabFeedbackState,
  metadata: {
    candidateId?: string;
    replacementBotId?: string;
    resolutionCode?: string;
    resolutionNotes?: string;
  } = {},
  traceId: string
): Promise<boolean> {
  try {
    const updates: Record<string, any> = {
      state: newState,
      updated_at: sql`NOW()`,
    };
    
    if (metadata.candidateId) {
      await db.execute(sql`
        UPDATE lab_feedback_tracking
        SET candidate_ids = array_append(candidate_ids, ${metadata.candidateId}::uuid),
            updated_at = NOW()
        WHERE id = ${trackingId}::uuid
      `);
    }
    
    if (newState === "CANDIDATE_FOUND" && metadata.candidateId) {
      updates.best_candidate_id = metadata.candidateId;
    }
    
    if (newState === "RESOLVED") {
      updates.resolved_at = sql`NOW()`;
      updates.replacement_bot_id = metadata.replacementBotId || null;
      updates.resolution_code = metadata.resolutionCode || "MANUAL";
      updates.resolution_notes = metadata.resolutionNotes || null;
    }
    
    if (newState === "ABANDONED") {
      updates.resolved_at = sql`NOW()`;
      updates.resolution_code = metadata.resolutionCode || "ABANDONED";
      updates.resolution_notes = metadata.resolutionNotes || "No suitable replacement found";
    }
    
    await db.execute(sql`
      UPDATE lab_feedback_tracking
      SET state = ${newState},
          updated_at = NOW()
      WHERE id = ${trackingId}::uuid
    `);
    
    console.log(`[FEEDBACK_LOOP] trace_id=${traceId} transitioned ${trackingId} to ${newState}`);
    
    return true;
  } catch (error) {
    console.error(`[FEEDBACK_LOOP] trace_id=${traceId} failed to transition ${trackingId} to ${newState}:`, error);
    return false;
  }
}

export async function getFeedbackLoopForBot(
  botId: string
): Promise<FeedbackLoopContext | null> {
  try {
    const result = await db.execute(sql`
      SELECT 
        id, source_lab_bot_id, state, failure_reason_codes,
        candidate_ids, best_candidate_id, created_at, updated_at
      FROM lab_feedback_tracking
      WHERE source_lab_bot_id = ${botId}::uuid
      AND state NOT IN ('RESOLVED', 'ABANDONED')
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0] as any;
    return {
      trackingId: row.id,
      sourceLabBotId: row.source_lab_bot_id,
      state: row.state,
      failureReasons: row.failure_reason_codes || [],
      candidateIds: row.candidate_ids || [],
      bestCandidateId: row.best_candidate_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  } catch (error) {
    console.error(`[FEEDBACK_LOOP] failed to get loop for bot ${botId}:`, error);
    return null;
  }
}

export async function getActiveFeedbackLoops(): Promise<FeedbackLoopContext[]> {
  try {
    const result = await db.execute(sql`
      SELECT 
        lft.id, lft.source_lab_bot_id, lft.state, lft.failure_reason_codes,
        lft.candidate_ids, lft.best_candidate_id, lft.created_at, lft.updated_at,
        b.name as bot_name
      FROM lab_feedback_tracking lft
      LEFT JOIN bots b ON b.id = lft.source_lab_bot_id
      WHERE lft.state NOT IN ('RESOLVED', 'ABANDONED')
      ORDER BY lft.created_at DESC
    `);
    
    return result.rows.map((row: any) => ({
      trackingId: row.id,
      sourceLabBotId: row.source_lab_bot_id,
      state: row.state,
      failureReasons: row.failure_reason_codes || [],
      candidateIds: row.candidate_ids || [],
      bestCandidateId: row.best_candidate_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  } catch (error) {
    console.error(`[FEEDBACK_LOOP] failed to get active loops:`, error);
    return [];
  }
}

export async function startResearchForFailure(
  failure: LabFailureDetectionResult,
  traceId: string
): Promise<{ trackingId: string | null; cycleTriggered: boolean }> {
  const trackingId = await createFeedbackLoop(failure, traceId);
  
  if (!trackingId) {
    return { trackingId: null, cycleTriggered: false };
  }
  
  const isRepair = failure.reasonCodes.length === 1 && 
    (failure.reasonCodes.includes("STAGNATION") || failure.reasonCodes.includes("LOW_SHARPE"));
  
  const newState: LabFeedbackState = isRepair ? "RESEARCHING_REPAIR" : "RESEARCHING_REPLACEMENT";
  
  await transitionFeedbackState(trackingId, newState, {}, traceId);
  
  await triggerLabFeedbackResearch(failure.botId, failure.reasonCodes);
  
  return { trackingId, cycleTriggered: true };
}

export async function linkCandidateToFeedbackLoop(
  candidateId: string,
  sourceLabBotId: string,
  traceId: string
): Promise<boolean> {
  const loop = await getFeedbackLoopForBot(sourceLabBotId);
  
  if (!loop) {
    console.log(`[FEEDBACK_LOOP] trace_id=${traceId} no active loop for ${sourceLabBotId} to link candidate ${candidateId}`);
    return false;
  }
  
  await transitionFeedbackState(loop.trackingId, "CANDIDATE_FOUND", {
    candidateId,
  }, traceId);
  
  console.log(`[FEEDBACK_LOOP] trace_id=${traceId} linked candidate ${candidateId} to loop ${loop.trackingId}`);
  
  return true;
}

export async function resolveFeedbackLoop(
  trackingId: string,
  resolutionCode: "REPLACED" | "REPAIRED" | "MANUAL" | "ABANDONED",
  replacementBotId: string | null,
  notes: string,
  traceId: string
): Promise<boolean> {
  const newState: LabFeedbackState = resolutionCode === "ABANDONED" ? "ABANDONED" : "RESOLVED";
  
  return transitionFeedbackState(trackingId, newState, {
    replacementBotId: replacementBotId || undefined,
    resolutionCode,
    resolutionNotes: notes,
  }, traceId);
}
