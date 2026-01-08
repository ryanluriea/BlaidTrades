/**
 * Metrics Policy - Single Source of Truth for Stage-Based Metrics
 * 
 * This module defines which metric source (BACKTEST vs LIVE) applies to each bot stage.
 * Both backend and frontend MUST use this policy to determine metric display.
 * 
 * ADDING A NEW STAGE: You MUST add an entry here or TypeScript will error.
 * ADDING A NEW METRIC: Add to NormalizedMetrics and update normalizeMetrics().
 */

export type BotStage = 'TRIALS' | 'PAPER' | 'SHADOW' | 'CANARY' | 'LIVE';
export type MetricSource = 'BACKTEST' | 'LIVE' | 'NONE';

/**
 * Defines which metric source to use for each stage.
 * - TRIALS: Uses backtest metrics (no live trading)
 * - PAPER+: Uses live/paper trade metrics
 */
export const STAGE_METRIC_SOURCE: Record<BotStage, MetricSource> = {
  TRIALS: 'BACKTEST',
  PAPER: 'LIVE',
  SHADOW: 'LIVE',
  CANARY: 'LIVE',
  LIVE: 'LIVE',
} as const;

/**
 * Get the metric source for a given stage.
 * Returns 'BACKTEST' for unknown stages as safe default.
 */
export function getMetricSourceForStage(stage: string): MetricSource {
  const normalizedStage = stage?.toUpperCase() as BotStage;
  return STAGE_METRIC_SOURCE[normalizedStage] ?? 'BACKTEST';
}

/**
 * Check if a stage uses backtest metrics
 */
export function usesBacktestMetrics(stage: string): boolean {
  return getMetricSourceForStage(stage) === 'BACKTEST';
}

/**
 * Check if a stage uses live/paper trade metrics
 */
export function usesLiveMetrics(stage: string): boolean {
  return getMetricSourceForStage(stage) === 'LIVE';
}

/**
 * Raw metrics from different sources (as returned by API before normalization)
 */
export interface RawMetrics {
  // Live trade metrics
  trades: number | null;
  winRate: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  pnl: number | null;
  
  // Backtest metrics
  backtestTrades: number | null;
  backtestWinRate: number | null;
  backtestSharpe: number | null;
  backtestMaxDD: number | null;
  backtestPF: number | null;
  backtestExpectancy: number | null;
  backtestPnl: number | null;
}

/**
 * Normalized metrics - stage-correct values ready for display.
 * Frontend should ONLY use these, never raw backtest/live fields.
 */
export interface NormalizedMetrics {
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  pnl: number;
  source: MetricSource;
}

/**
 * Normalize raw metrics based on bot stage.
 * Returns stage-appropriate values - frontend displays these directly.
 * 
 * @param stage - Bot lifecycle stage
 * @param raw - Raw metrics containing both backtest and live data
 * @returns Normalized metrics ready for display
 */
export function normalizeMetrics(stage: string, raw: Partial<RawMetrics>): NormalizedMetrics {
  const source = getMetricSourceForStage(stage);
  
  if (source === 'BACKTEST') {
    return {
      trades: raw.backtestTrades ?? 0,
      winRate: raw.backtestWinRate ?? null,
      sharpe: raw.backtestSharpe ?? null,
      maxDrawdownPct: raw.backtestMaxDD ?? null,
      profitFactor: raw.backtestPF ?? null,
      expectancy: raw.backtestExpectancy ?? null,
      pnl: raw.backtestPnl ?? raw.pnl ?? 0,
      source,
    };
  }
  
  // LIVE source (PAPER, SHADOW, CANARY, LIVE stages)
  return {
    trades: raw.trades ?? 0,
    winRate: raw.winRate ?? null,
    sharpe: raw.sharpe ?? null,
    maxDrawdownPct: raw.maxDrawdownPct ?? null,
    profitFactor: raw.profitFactor ?? null,
    expectancy: raw.expectancy ?? null,
    pnl: raw.pnl ?? 0,
    source,
  };
}

/**
 * Validate that required metrics exist for a given stage.
 * Returns array of missing metric names (empty if all present).
 */
export function validateMetricsForStage(stage: string, raw: Partial<RawMetrics>): string[] {
  const source = getMetricSourceForStage(stage);
  const missing: string[] = [];
  
  if (source === 'BACKTEST') {
    if (raw.backtestTrades === undefined || raw.backtestTrades === null) {
      missing.push('backtestTrades');
    }
  } else {
    // For LIVE stages, we don't require metrics (bot might not have traded yet)
  }
  
  return missing;
}

/**
 * All valid bot stages for iteration/validation
 */
export const ALL_STAGES: readonly BotStage[] = ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE'] as const;

/**
 * Type guard to check if a string is a valid BotStage
 */
export function isValidStage(stage: string): stage is BotStage {
  return ALL_STAGES.includes(stage.toUpperCase() as BotStage);
}
