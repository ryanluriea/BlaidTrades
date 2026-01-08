/**
 * Bot Priority Score (BPS) Calculator
 * Deterministic scoring formula for ranking bots 0-100
 */

import { 
  PRIORITY_THRESHOLDS, 
  PRIORITY_BUCKET_DISPLAY,
  scoreToBucket as unifiedScoreToBucket,
  type PriorityBucket,
  type BotStageWithDegraded,
} from './constants';

// Re-export types for backward compatibility
export type HealthState = "OK" | "WARN" | "DEGRADED";
export type { PriorityBucket };
export type Stage = BotStageWithDegraded;

export interface WindowMetrics {
  sharpe: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
  trades: number;
  lastTradeAt: string | null;
}

export interface PriorityScoreInput {
  metrics7D: WindowMetrics | null;
  metrics30D: WindowMetrics | null;
  metrics90D: WindowMetrics | null;
  healthState: HealthState;
  correlationPenalty30D: number; // 0-1
  stage: Stage;
}

export interface PriorityScoreResult {
  score: number; // 0-100
  bucket: PriorityBucket;
  breakdown: {
    perf7D: number;
    perf30D: number;
    perf90D: number;
    blendedPerf: number;
    recencyFactor: number;
    healthMultiplier: number;
    correlationMultiplier: number;
    stageBonus: number;
  };
}

// Helper: Clamp value between 0 and 1
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// Normalize Sharpe: [-1..3] → [0..1]
function normSharpe(s: number | null): number {
  if (s === null) return 0.5; // neutral default
  return clamp01((s + 1) / 4);
}

// Normalize Profit Factor: [0.8..2.0] → [0..1]
function normPF(pf: number | null): number {
  if (pf === null) return 0.5;
  return clamp01((pf - 0.8) / 1.2);
}

// Normalize Expectancy (R-multiple): [-0.2..0.5] → [0..1]
function normExpectancy(exp: number | null): number {
  if (exp === null) return 0.5;
  return clamp01((exp + 0.2) / 0.7);
}

// Normalize Drawdown: [0..20%] → [0..1] (higher is worse)
function normDD(ddPct: number | null): number {
  if (ddPct === null) return 0;
  return clamp01(ddPct / 20);
}

// Normalize Win Rate: [40%..70%] → [0..1]
function normWR(wr: number | null): number {
  if (wr === null) return 0.5;
  // wr is expected as percent (40-70), not decimal
  const wrDecimal = wr > 1 ? wr / 100 : wr;
  return clamp01((wrDecimal - 0.40) / 0.30);
}

// Sample reliability based on trade count
function sampleReliability(trades: number): number {
  if (trades < 10) return 0.2;
  if (trades < 30) return 0.5;
  if (trades < 80) return 0.8;
  return 1.0;
}

// Recency factor based on last trade
function recencyFactor(lastTradeAt: string | null): number {
  if (!lastTradeAt) return 0.2;
  
  const lastTrade = new Date(lastTradeAt);
  const now = new Date();
  const daysSince = (now.getTime() - lastTrade.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSince < 1) return 1.0;
  if (daysSince < 3) return 0.8;
  if (daysSince < 7) return 0.5;
  return 0.2;
}

// Health multiplier
function healthMultiplier(health: HealthState): number {
  switch (health) {
    case "OK": return 1.0;
    case "WARN": return 0.75;
    case "DEGRADED": return 0.0;
  }
}

// Correlation multiplier: max -50% penalty
function correlationMultiplier(corrPenalty: number): number {
  return 1 - 0.5 * clamp01(corrPenalty);
}

// Stage bonus (capped)
function stageBonus(stage: Stage): number {
  switch (stage) {
    case "TRIALS": return 0;
    case "PAPER": return 2;
    case "SHADOW": return 4;
    case "LIVE": return 6;
    case "DEGRADED": return 0;
  }
}

// Compute performance score for a single window
function computeWindowPerf(m: WindowMetrics | null): number {
  if (!m) return 0;
  
  // Weighted formula:
  // 0.35 * sharpe + 0.25 * expectancy + 0.15 * profit_factor + 0.10 * win_rate - 0.15 * drawdown
  const perf = 
    0.35 * normSharpe(m.sharpe) +
    0.25 * normExpectancy(m.expectancy) +
    0.15 * normPF(m.profitFactor) +
    0.10 * normWR(m.winRate) -
    0.15 * normDD(m.maxDrawdownPct);
  
  // Apply reliability
  return perf * sampleReliability(m.trades);
}

// Get most recent last_trade_at across windows
function getMostRecentTrade(input: PriorityScoreInput): string | null {
  const trades = [
    input.metrics7D?.lastTradeAt,
    input.metrics30D?.lastTradeAt,
    input.metrics90D?.lastTradeAt,
  ].filter(Boolean) as string[];
  
  if (trades.length === 0) return null;
  
  return trades.reduce((latest, current) => 
    new Date(current) > new Date(latest) ? current : latest
  );
}

// Convert score to bucket - use unified constants
function scoreToBucket(score: number, health: HealthState): PriorityBucket {
  return unifiedScoreToBucket(score, health);
}

/**
 * Calculate Bot Priority Score (BPS)
 * Returns deterministic 0-100 score with bucket classification
 */
export function calculatePriorityScore(input: PriorityScoreInput): PriorityScoreResult {
  // Per-window performance
  const perf7D = computeWindowPerf(input.metrics7D);
  const perf30D = computeWindowPerf(input.metrics30D);
  const perf90D = computeWindowPerf(input.metrics90D);
  
  // Blend: 20% 7D + 50% 30D + 30% 90D
  let blendedPerf = 0.20 * perf7D + 0.50 * perf30D + 0.30 * perf90D;
  
  // Apply global modifiers
  const recency = recencyFactor(getMostRecentTrade(input));
  const health = healthMultiplier(input.healthState);
  const corr = correlationMultiplier(input.correlationPenalty30D);
  const bonus = stageBonus(input.stage);
  
  blendedPerf *= recency;
  blendedPerf *= health;
  blendedPerf *= corr;
  
  // Convert to 0-100 and add stage bonus
  const rawScore = Math.round(100 * clamp01(blendedPerf));
  const finalScore = Math.min(100, Math.max(0, rawScore + bonus));
  
  return {
    score: finalScore,
    bucket: scoreToBucket(finalScore, input.healthState),
    breakdown: {
      perf7D,
      perf30D,
      perf90D,
      blendedPerf,
      recencyFactor: recency,
      healthMultiplier: health,
      correlationMultiplier: corr,
      stageBonus: bonus,
    },
  };
}

// Bucket display config - use unified constants
export const BUCKET_DISPLAY: Record<PriorityBucket, { color: string; label: string }> = Object.fromEntries(
  Object.entries(PRIORITY_BUCKET_DISPLAY).map(([key, val]) => [key, { color: val.color, label: val.label }])
) as Record<PriorityBucket, { color: string; label: string }>;
