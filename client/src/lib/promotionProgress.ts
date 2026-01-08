/**
 * Promotion Progress Calculator
 * 
 * Computes how close a bot is to the NEXT promotion step.
 * Uses the same gates/settings as auto-promotion for consistency.
 */

import { PromotionRules, DEFAULT_PROMOTION_RULES, MetricsRollup } from './promotionEngine';

export interface GateResult {
  value: number | string | boolean | null;
  required: number | string | boolean;
  pass: boolean;
  score: number; // 0..1
  label: string;
}

export interface PromotionProgress {
  targetStage: 'PAPER' | 'SHADOW' | 'LIVE' | null;
  percent: number;
  blocked: boolean;
  blockReason: string | null;
  gates: {
    trades: GateResult;
    days: GateResult;
    sharpe: GateResult;
    pf: GateResult;
    dd: GateResult;
    expectancy: GateResult;
    recent: GateResult;
    backtest: GateResult;
    health: GateResult;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export interface PromotionProgressInput {
  currentStage: string;
  healthState: 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN';
  rollup30: MetricsRollup | null;
  lastBacktestCompletedAt: string | null;
  lastBacktestStatus: string | null;
}

/**
 * Compute promotion progress for a bot
 */
export function computePromotionProgress(
  input: PromotionProgressInput,
  rules: PromotionRules = DEFAULT_PROMOTION_RULES
): PromotionProgress {
  // Determine target stage
  const targetStage = getTargetStage(input.currentStage);
  
  // If already LIVE or unknown stage, no progress to show
  if (!targetStage) {
    return createEmptyProgress(null);
  }
  
  // Check if blocked by health
  if (input.healthState === 'DEGRADED' || input.healthState === 'FROZEN') {
    return createBlockedProgress(targetStage, `Health: ${input.healthState}`);
  }
  
  // No metrics available
  if (!input.rollup30) {
    return createBlockedProgress(targetStage, 'No metrics available');
  }
  
  const r = input.rollup30;
  
  // TRUTHFULNESS CHECK: If no actual trades, progress is 0%
  // Don't give credit for gates that pass due to null/default values
  if (r.trades === 0) {
    const hasBacktest = input.lastBacktestCompletedAt && input.lastBacktestStatus === 'COMPLETED';
    return {
      targetStage,
      percent: 0,
      blocked: false,
      blockReason: null,
      gates: computeGates(r, input, rules),
    };
  }
  
  // Compute each gate
  const gates = computeGates(r, input, rules);
  
  // Health multiplier
  const healthMultiplier = input.healthState === 'OK' ? 1.0 : 0.7;
  
  // Weighted progress formula
  const weightedSum = 
    0.20 * gates.trades.score +
    0.10 * gates.days.score +
    0.15 * gates.sharpe.score +
    0.15 * gates.pf.score +
    0.15 * gates.dd.score +
    0.10 * gates.expectancy.score +
    0.10 * gates.recent.score +
    0.05 * gates.backtest.score;
  
  const percent = Math.round(100 * healthMultiplier * weightedSum);
  
  return {
    targetStage,
    percent,
    blocked: false,
    blockReason: null,
    gates,
  };
}

function getTargetStage(currentStage: string): 'PAPER' | 'SHADOW' | 'LIVE' | null {
  switch (currentStage) {
    case 'TRIALS': return 'PAPER';
    case 'PAPER': return 'SHADOW';
    case 'SHADOW': return 'LIVE';
    default: return null;
  }
}

function createEmptyProgress(targetStage: 'PAPER' | 'SHADOW' | 'LIVE' | null): PromotionProgress {
  const emptyGate: GateResult = { value: null, required: 0, pass: false, score: 0, label: '' };
  return {
    targetStage,
    percent: 0,
    blocked: targetStage === null ? false : true,
    blockReason: targetStage === null ? null : 'Already at target stage',
    gates: {
      trades: { ...emptyGate, label: 'Trades' },
      days: { ...emptyGate, label: 'Days' },
      sharpe: { ...emptyGate, label: 'Sharpe' },
      pf: { ...emptyGate, label: 'Profit Factor' },
      dd: { ...emptyGate, label: 'Max Drawdown' },
      expectancy: { ...emptyGate, label: 'Expectancy' },
      recent: { ...emptyGate, label: 'Recent Activity' },
      backtest: { ...emptyGate, label: 'Backtest' },
      health: { ...emptyGate, label: 'Health' },
    },
  };
}

function createBlockedProgress(targetStage: 'PAPER' | 'SHADOW' | 'LIVE', reason: string): PromotionProgress {
  const progress = createEmptyProgress(targetStage);
  progress.blocked = true;
  progress.blockReason = reason;
  return progress;
}

function computeGates(
  r: MetricsRollup,
  input: PromotionProgressInput,
  rules: PromotionRules
): PromotionProgress['gates'] {
  // Trades gate
  const tradesScore = clamp(r.trades / rules.lab_autopromote_min_trades, 0, 1);
  const tradesPass = r.trades >= rules.lab_autopromote_min_trades;
  
  // Days gate
  const daysScore = clamp(r.activeDays / rules.lab_autopromote_min_days, 0, 1);
  const daysPass = r.activeDays >= rules.lab_autopromote_min_days;
  
  // Sharpe gate
  const sharpeVal = r.sharpe ?? 0;
  const sharpeScore = clamp(sharpeVal / rules.lab_autopromote_min_sharpe, 0, 1);
  const sharpePass = r.sharpe !== null && r.sharpe >= rules.lab_autopromote_min_sharpe;
  
  // Profit factor gate
  const pfVal = r.profitFactor ?? 0;
  const pfScore = clamp(pfVal / rules.lab_autopromote_min_profit_factor, 0, 1);
  const pfPass = r.profitFactor !== null && r.profitFactor >= rules.lab_autopromote_min_profit_factor;
  
  // Drawdown gate (inverted - lower is better)
  const ddVal = r.maxDdPct ?? 0;
  const ddScore = clamp(1 - (ddVal / rules.lab_autopromote_max_drawdown_pct), 0, 1);
  const ddPass = r.maxDdPct === null || r.maxDdPct <= rules.lab_autopromote_max_drawdown_pct;
  
  // Expectancy gate
  let expectancyScore: number;
  let expectancyPass: boolean;
  if (rules.lab_autopromote_min_expectancy === 0) {
    expectancyScore = (r.expectancy ?? 0) >= 0 ? 1 : 0;
    expectancyPass = r.expectancy !== null && r.expectancy >= 0;
  } else {
    expectancyScore = clamp((r.expectancy ?? 0) / rules.lab_autopromote_min_expectancy, 0, 1);
    expectancyPass = r.expectancy !== null && r.expectancy >= rules.lab_autopromote_min_expectancy;
  }
  
  // Recent activity gate
  const daysSinceLastTrade = daysSince(r.lastTradeAt);
  const recentPass = daysSinceLastTrade !== null && daysSinceLastTrade <= rules.lab_autopromote_requires_recent_activity_days;
  const recentScore = recentPass ? 1 : 0;
  
  // Backtest coverage gate
  let backtestScore = 1;
  let backtestPass = true;
  let backtestValue: string = 'Not required';
  
  if (rules.lab_autopromote_requires_backtest_coverage) {
    const daysSinceBacktest = daysSince(input.lastBacktestCompletedAt);
    const backtestRecent = daysSinceBacktest !== null && daysSinceBacktest <= rules.lab_autopromote_backtest_max_age_days;
    const backtestSucceeded = input.lastBacktestStatus === 'completed';
    
    backtestPass = backtestRecent && backtestSucceeded;
    backtestScore = backtestPass ? 1 : 0;
    
    if (!input.lastBacktestCompletedAt) {
      backtestValue = 'None';
    } else if (!backtestSucceeded) {
      backtestValue = `Status: ${input.lastBacktestStatus || 'unknown'}`;
    } else if (!backtestRecent) {
      backtestValue = `${daysSinceBacktest}d ago`;
    } else {
      backtestValue = 'OK';
    }
  }
  
  // Health gate
  const healthPass = input.healthState === 'OK' || 
    (rules.lab_autopromote_health_required === 'WARN_OK' && input.healthState === 'WARN');
  const healthScore = input.healthState === 'OK' ? 1 : input.healthState === 'WARN' ? 0.7 : 0;
  
  return {
    trades: {
      value: r.trades,
      required: rules.lab_autopromote_min_trades,
      pass: tradesPass,
      score: tradesScore,
      label: 'Trades',
    },
    days: {
      value: r.activeDays,
      required: rules.lab_autopromote_min_days,
      pass: daysPass,
      score: daysScore,
      label: 'Active Days',
    },
    sharpe: {
      value: r.sharpe !== null ? Number(r.sharpe.toFixed(2)) : null,
      required: rules.lab_autopromote_min_sharpe,
      pass: sharpePass,
      score: sharpeScore,
      label: 'Sharpe',
    },
    pf: {
      value: r.profitFactor !== null ? Number(r.profitFactor.toFixed(2)) : null,
      required: rules.lab_autopromote_min_profit_factor,
      pass: pfPass,
      score: pfScore,
      label: 'Profit Factor',
    },
    dd: {
      value: r.maxDdPct !== null ? Number(r.maxDdPct.toFixed(1)) : null,
      required: `≤${rules.lab_autopromote_max_drawdown_pct}%`,
      pass: ddPass,
      score: ddScore,
      label: 'Max Drawdown',
    },
    expectancy: {
      value: r.expectancy !== null ? Number(r.expectancy.toFixed(2)) : null,
      required: rules.lab_autopromote_min_expectancy,
      pass: expectancyPass,
      score: expectancyScore,
      label: 'Expectancy',
    },
    recent: {
      value: daysSinceLastTrade !== null ? `${daysSinceLastTrade}d ago` : 'Never',
      required: `≤${rules.lab_autopromote_requires_recent_activity_days}d`,
      pass: recentPass,
      score: recentScore,
      label: 'Recent Trade',
    },
    backtest: {
      value: backtestValue,
      required: rules.lab_autopromote_requires_backtest_coverage ? 'Required' : 'Optional',
      pass: backtestPass,
      score: backtestScore,
      label: 'Backtest',
    },
    health: {
      value: input.healthState,
      required: rules.lab_autopromote_health_required === 'OK_ONLY' ? 'OK' : 'OK or WARN',
      pass: healthPass,
      score: healthScore,
      label: 'Health',
    },
  };
}

/**
 * Get missing gates for tooltip display
 */
export function getMissingGates(progress: PromotionProgress): string[] {
  if (progress.blocked) {
    return [progress.blockReason || 'Blocked'];
  }
  
  const missing: string[] = [];
  const gates = progress.gates;
  
  if (!gates.trades.pass) {
    missing.push(`Trades: ${gates.trades.value} / ${gates.trades.required}`);
  }
  if (!gates.days.pass) {
    missing.push(`Days: ${gates.days.value} / ${gates.days.required}`);
  }
  if (!gates.sharpe.pass) {
    missing.push(`Sharpe: ${gates.sharpe.value ?? 'N/A'} / ${gates.sharpe.required}`);
  }
  if (!gates.pf.pass) {
    missing.push(`PF: ${gates.pf.value ?? 'N/A'} / ${gates.pf.required}`);
  }
  if (!gates.dd.pass) {
    missing.push(`Max DD: ${gates.dd.value}% ${gates.dd.required}`);
  }
  if (!gates.expectancy.pass) {
    missing.push(`Expectancy: ${gates.expectancy.value ?? 'N/A'} / ${gates.expectancy.required}`);
  }
  if (!gates.recent.pass) {
    missing.push(`Recent: ${gates.recent.value} ${gates.recent.required}`);
  }
  if (!gates.backtest.pass) {
    missing.push(`Backtest: ${gates.backtest.value}`);
  }
  if (!gates.health.pass) {
    missing.push(`Health: ${gates.health.value}`);
  }
  
  return missing;
}
