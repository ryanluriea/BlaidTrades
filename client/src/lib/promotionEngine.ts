/**
 * TRIALS → PAPER Auto-Promotion Engine
 * 
 * Evaluates bots for promotion using deterministic, rule-based logic.
 * Every decision is logged to bot_stage_changes for audit.
 */

// Import unified thresholds from shared source of truth
import { UNIFIED_STAGE_THRESHOLDS } from '@shared/graduationGates';

export interface PromotionRules {
  lab_autopromote_enabled: boolean;
  lab_autopromote_min_trades: number;
  lab_autopromote_min_days: number;
  lab_autopromote_window_days: number;
  lab_autopromote_min_profit_factor: number;
  lab_autopromote_min_sharpe: number;
  lab_autopromote_max_drawdown_pct: number;
  lab_autopromote_min_expectancy: number;
  lab_autopromote_health_required: 'OK_ONLY' | 'WARN_OK';
  lab_autopromote_requires_recent_activity_days: number;
  lab_autopromote_requires_backtest_coverage: boolean;
  lab_autopromote_backtest_max_age_days: number;
  lab_autopromote_manual_override_allowed: boolean;
}

// Get TRIALS thresholds for TRIALS → PAPER promotion
const trialsThresholds = UNIFIED_STAGE_THRESHOLDS.TRIALS;

export const DEFAULT_PROMOTION_RULES: PromotionRules = {
  lab_autopromote_enabled: true,
  lab_autopromote_min_trades: trialsThresholds.minTrades,           // 50 (unified)
  lab_autopromote_min_days: 3,
  lab_autopromote_window_days: 30,
  lab_autopromote_min_profit_factor: trialsThresholds.minProfitFactor, // 1.2 (unified)
  lab_autopromote_min_sharpe: trialsThresholds.minSharpe,           // 0.5 (unified)
  lab_autopromote_max_drawdown_pct: trialsThresholds.maxDrawdownPct, // 20 (unified)
  lab_autopromote_min_expectancy: trialsThresholds.minExpectancy,   // 10 (unified)
  lab_autopromote_health_required: 'WARN_OK',
  lab_autopromote_requires_recent_activity_days: 7,
  lab_autopromote_requires_backtest_coverage: true,
  lab_autopromote_backtest_max_age_days: 7,
  lab_autopromote_manual_override_allowed: true,
};

export interface MetricsRollup {
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDdPct: number | null;
  activeDays: number;
  lastTradeAt: string | null;
}

export interface BotPromotionInput {
  botId: string;
  currentStage: string;
  healthState: 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN';
  healthReasons: string[];
  rollup30: MetricsRollup | null;
  lastBacktestCompletedAt: string | null;
  lastBacktestStatus: string | null;
}

export type PromotionDecision = 'PROMOTE' | 'DEMOTE' | 'KEEP' | 'FREEZE';

export interface PromotionResult {
  botId: string;
  decision: PromotionDecision;
  fromStage: string;
  toStage: string;
  reasons: string[];
  metricsSnapshot: MetricsRollup | null;
}

/**
 * Evaluate a bot for TRIALS → PAPER promotion
 */
export function evaluateTrialsToPaperPromotion(
  input: BotPromotionInput,
  rules: PromotionRules = DEFAULT_PROMOTION_RULES
): PromotionResult {
  const reasons: string[] = [];
  let shouldPromote = true;

  // Only evaluate TRIALS stage bots
  if (input.currentStage !== 'TRIALS') {
    return {
      botId: input.botId,
      decision: 'KEEP',
      fromStage: input.currentStage,
      toStage: input.currentStage,
      reasons: ['Not in TRIALS stage - skipping TRIALS→PAPER evaluation'],
      metricsSnapshot: input.rollup30,
    };
  }

  // Auto-promote disabled
  if (!rules.lab_autopromote_enabled) {
    return {
      botId: input.botId,
      decision: 'KEEP',
      fromStage: 'TRIALS',
      toStage: 'TRIALS',
      reasons: ['Auto-promotion is disabled'],
      metricsSnapshot: input.rollup30,
    };
  }

  // FREEZE if DEGRADED/FROZEN
  if (input.healthState === 'DEGRADED' || input.healthState === 'FROZEN') {
    return {
      botId: input.botId,
      decision: 'FREEZE',
      fromStage: 'TRIALS',
      toStage: 'TRIALS',
      reasons: [`Health state is ${input.healthState}: ${input.healthReasons.join(', ')}`],
      metricsSnapshot: input.rollup30,
    };
  }

  // Check health requirement
  if (rules.lab_autopromote_health_required === 'OK_ONLY' && input.healthState !== 'OK') {
    reasons.push(`Health must be OK, currently ${input.healthState}`);
    shouldPromote = false;
  }

  // No metrics available
  if (!input.rollup30) {
    return {
      botId: input.botId,
      decision: 'KEEP',
      fromStage: 'TRIALS',
      toStage: 'TRIALS',
      reasons: ['No 30-day metrics available yet'],
      metricsSnapshot: null,
    };
  }

  const r = input.rollup30;

  // Check minimum trades
  if (r.trades < rules.lab_autopromote_min_trades) {
    reasons.push(`Trades ${r.trades} < required ${rules.lab_autopromote_min_trades}`);
    shouldPromote = false;
  }

  // Check minimum active days
  if (r.activeDays < rules.lab_autopromote_min_days) {
    reasons.push(`Active days ${r.activeDays} < required ${rules.lab_autopromote_min_days}`);
    shouldPromote = false;
  }

  // Check profit factor
  if (r.profitFactor !== null && r.profitFactor < rules.lab_autopromote_min_profit_factor) {
    reasons.push(`Profit factor ${r.profitFactor.toFixed(2)} < required ${rules.lab_autopromote_min_profit_factor}`);
    shouldPromote = false;
  } else if (r.profitFactor === null) {
    reasons.push('Profit factor not available');
    shouldPromote = false;
  }

  // Check sharpe
  if (r.sharpe !== null && r.sharpe < rules.lab_autopromote_min_sharpe) {
    reasons.push(`Sharpe ${r.sharpe.toFixed(2)} < required ${rules.lab_autopromote_min_sharpe}`);
    shouldPromote = false;
  } else if (r.sharpe === null) {
    reasons.push('Sharpe ratio not available');
    shouldPromote = false;
  }

  // Check max drawdown
  if (r.maxDdPct !== null && r.maxDdPct > rules.lab_autopromote_max_drawdown_pct) {
    reasons.push(`Max DD ${r.maxDdPct.toFixed(1)}% > allowed ${rules.lab_autopromote_max_drawdown_pct}%`);
    shouldPromote = false;
  }

  // Check expectancy
  if (r.expectancy !== null && r.expectancy < rules.lab_autopromote_min_expectancy) {
    reasons.push(`Expectancy ${r.expectancy.toFixed(2)} < required ${rules.lab_autopromote_min_expectancy}`);
    shouldPromote = false;
  }

  // Check recent activity
  if (r.lastTradeAt) {
    const lastTrade = new Date(r.lastTradeAt);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rules.lab_autopromote_requires_recent_activity_days);
    if (lastTrade < cutoff) {
      reasons.push(`Last trade ${Math.floor((Date.now() - lastTrade.getTime()) / (1000 * 60 * 60 * 24))} days ago > ${rules.lab_autopromote_requires_recent_activity_days} day limit`);
      shouldPromote = false;
    }
  } else {
    reasons.push('No trade activity recorded');
    shouldPromote = false;
  }

  // Check backtest coverage
  if (rules.lab_autopromote_requires_backtest_coverage) {
    if (!input.lastBacktestCompletedAt) {
      reasons.push('No completed backtest found');
      shouldPromote = false;
    } else {
      const lastBacktest = new Date(input.lastBacktestCompletedAt);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - rules.lab_autopromote_backtest_max_age_days);
      if (lastBacktest < cutoff) {
        reasons.push(`Backtest ${Math.floor((Date.now() - lastBacktest.getTime()) / (1000 * 60 * 60 * 24))} days old > ${rules.lab_autopromote_backtest_max_age_days} day limit`);
        shouldPromote = false;
      }
      if (input.lastBacktestStatus !== 'completed') {
        reasons.push(`Last backtest status: ${input.lastBacktestStatus || 'unknown'}`);
        shouldPromote = false;
      }
    }
  }

  if (shouldPromote) {
    return {
      botId: input.botId,
      decision: 'PROMOTE',
      fromStage: 'TRIALS',
      toStage: 'PAPER',
      reasons: [
        `Passed all promotion criteria`,
        `Trades: ${r.trades}`,
        `Sharpe: ${r.sharpe?.toFixed(2)}`,
        `PF: ${r.profitFactor?.toFixed(2)}`,
        `Max DD: ${r.maxDdPct?.toFixed(1)}%`,
      ],
      metricsSnapshot: r,
    };
  }

  return {
    botId: input.botId,
    decision: 'KEEP',
    fromStage: 'TRIALS',
    toStage: 'TRIALS',
    reasons,
    metricsSnapshot: r,
  };
}

// Backward compatibility alias
export const evaluateLabToPaperPromotion = evaluateTrialsToPaperPromotion;

/**
 * Evaluate promotion for any stage
 */
export function evaluatePromotion(
  input: BotPromotionInput,
  rules: PromotionRules = DEFAULT_PROMOTION_RULES
): PromotionResult {
  switch (input.currentStage) {
    case 'TRIALS':
      return evaluateTrialsToPaperPromotion(input, rules);
    // Future: PAPER → SHADOW, SHADOW → LIVE
    default:
      return {
        botId: input.botId,
        decision: 'KEEP',
        fromStage: input.currentStage,
        toStage: input.currentStage,
        reasons: [`Stage ${input.currentStage} evaluation not yet implemented`],
        metricsSnapshot: input.rollup30,
      };
  }
}
