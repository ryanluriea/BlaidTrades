/**
 * Gate-based graduation logic - industry standard approach
 * No misleading percentages - clear pass/fail gates with reasons
 * 
 * IMPORTS FROM shared/graduationGates.ts - SINGLE SOURCE OF TRUTH
 */

import { UNIFIED_STAGE_THRESHOLDS, DEFAULT_THRESHOLDS } from '@shared/graduationGates';

export interface GraduationGate {
  id: string;
  name: string;
  description: string;
  required: number;
  current: number;
  passed: boolean;
  unit: string;
  direction: 'min' | 'max'; // min = current >= required, max = current <= required
}

export interface GraduationStatus {
  gates: GraduationGate[];
  gatesPassed: number;
  gatesTotal: number;
  progressPercent: number;
  isEligible: boolean;
  blockers: string[];
  bucket: 'A+' | 'A' | 'B' | 'C' | 'D' | 'UNRATED';
}

// Re-export unified thresholds from shared module - SINGLE SOURCE OF TRUTH
// DO NOT define thresholds here - import from shared/graduationGates.ts
export const STAGE_GATE_THRESHOLDS = UNIFIED_STAGE_THRESHOLDS;

// Default for backwards compatibility (same as TRIALS)
export const DEFAULT_GATE_THRESHOLDS = DEFAULT_THRESHOLDS;

export interface BotMetricsInput {
  totalTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number | null;
  expectancy: number | null;
  sharpe: number | null;
  pnl: number;
}

export function computeGraduationStatus(
  metrics: BotMetricsInput,
  stage: string = 'TRIALS',
  thresholds?: typeof DEFAULT_GATE_THRESHOLDS
): GraduationStatus {
  // Use stage-specific thresholds if not provided
  const stageThresholds = thresholds ?? (STAGE_GATE_THRESHOLDS[stage as keyof typeof STAGE_GATE_THRESHOLDS] ?? DEFAULT_GATE_THRESHOLDS);
  const gates: GraduationGate[] = [];

  // Gate 1: Minimum trades (sample size)
  const tradesPassed = metrics.totalTrades >= stageThresholds.minTrades;
  gates.push({
    id: 'trades',
    name: 'Sample Size',
    description: 'Minimum trades for statistical significance',
    required: stageThresholds.minTrades,
    current: metrics.totalTrades,
    passed: tradesPassed,
    unit: 'trades',
    direction: 'min',
  });

  // Gate 2: Win Rate
  const winRate = metrics.winRate ?? 0;
  const winRatePassed = winRate >= stageThresholds.minWinRate;
  gates.push({
    id: 'winRate',
    name: 'Win Rate',
    description: 'Percentage of winning trades',
    required: stageThresholds.minWinRate,
    current: winRate,
    passed: winRatePassed,
    unit: '%',
    direction: 'min',
  });

  // Gate 3: Profit Factor
  const pf = metrics.profitFactor ?? 0;
  const pfPassed = pf >= stageThresholds.minProfitFactor;
  gates.push({
    id: 'profitFactor',
    name: 'Profit Factor',
    description: 'Gross profit / gross loss ratio',
    required: stageThresholds.minProfitFactor,
    current: pf,
    passed: pfPassed,
    unit: 'x',
    direction: 'min',
  });

  // Gate 4: Max Drawdown (only passes if we have trades AND drawdown is within threshold)
  // With 0 trades, drawdown is undefined/null - should NOT pass
  const dd = metrics.maxDrawdownPct ?? null;
  const ddPassed = metrics.totalTrades > 0 && dd !== null && dd <= stageThresholds.maxDrawdownPct;
  gates.push({
    id: 'maxDrawdown',
    name: 'Max Drawdown',
    description: 'Maximum peak-to-trough decline',
    required: stageThresholds.maxDrawdownPct,
    current: dd ?? 0,
    passed: ddPassed,
    unit: '%',
    direction: 'max',
  });

  // Gate 5: Positive Expectancy
  const exp = metrics.expectancy ?? 0;
  const expPassed = exp >= stageThresholds.minExpectancy;
  gates.push({
    id: 'expectancy',
    name: 'Expectancy',
    description: 'Average profit per trade',
    required: stageThresholds.minExpectancy,
    current: exp,
    passed: expPassed,
    unit: '$',
    direction: 'min',
  });

  // Calculate overall status
  const gatesPassed = gates.filter(g => g.passed).length;
  const gatesTotal = gates.length;
  const progressPercent = Math.round((gatesPassed / gatesTotal) * 100);

  // Blockers are gates that haven't passed
  const blockers = gates
    .filter(g => !g.passed)
    .map(g => g.name);

  // Bucket calculation based on gates passed and quality
  let bucket: GraduationStatus['bucket'] = 'UNRATED';
  
  if (metrics.totalTrades === 0) {
    bucket = 'UNRATED';
  } else if (gatesPassed === gatesTotal) {
    // All gates passed - check quality for A+ vs A
    if (winRate >= 55 && pf >= 1.5 && (metrics.sharpe ?? 0) >= 1.0) {
      bucket = 'A+';
    } else {
      bucket = 'A';
    }
  } else if (gatesPassed >= 4) {
    bucket = 'B';
  } else if (gatesPassed >= 3) {
    bucket = 'C';
  } else if (gatesPassed >= 1) {
    bucket = 'D';
  } else {
    bucket = 'UNRATED';
  }

  return {
    gates,
    gatesPassed,
    gatesTotal,
    progressPercent,
    isEligible: gatesPassed === gatesTotal,
    blockers,
    bucket,
  };
}

// Bot blocker reasons - aligned with canonical state evaluator
export type BlockerType = 
  | 'MARKET_CLOSED'
  | 'NO_MARKET_DATA'
  | 'MACRO_EVENT_BLOCK'
  | 'RISK_ENGINE_BLOCK'
  | 'JOB_QUEUE_EMPTY'
  | 'STRATEGY_SANITY_FAIL'
  | 'BROKER_NOT_VALIDATED'
  | 'NO_ACCOUNT_ATTACHED'
  | 'ACCOUNT_NOT_ARMED'
  | 'HEALTH_DEGRADED'
  | 'BACKTEST_IN_PROGRESS'
  | 'WAITING_FOR_SIGNAL'
  | 'NONE'
  // New canonical blockers
  | 'CIRCUIT_BREAKER_OPEN'
  | 'RUNNER_ERROR'
  | 'RUNNER_STALLED'
  | 'RUNNER_HEARTBEAT_WARNING'
  | 'NO_PRIMARY_RUNNER'
  | 'MODE_STAGE_MISMATCH'
  | 'TRIALS_RUNNER_ACTIVE'
  | 'TRADING_DISABLED_RUNNER_ACTIVE'
  | 'JOB_STALLED'
  | 'JOB_DEAD_LETTER';

export interface BotBlockerInfo {
  blocker: BlockerType;
  message: string;
  severity: 'info' | 'warning' | 'error';
  actionHint?: string;
}

export function computeBotBlocker(input: {
  marketOpen: boolean;
  hasMarketData: boolean;
  hasMacroBlock: boolean;
  hasRiskBlock: boolean;
  hasJobQueued: boolean;
  hasAccountAttached: boolean;
  accountArmed: boolean;
  healthStatus: 'OK' | 'WARN' | 'DEGRADED';
  isBacktesting: boolean;
  stage: string;
  mode?: string;
}): BotBlockerInfo {
  // Priority order - most critical first
  if (input.healthStatus === 'DEGRADED') {
    return {
      blocker: 'HEALTH_DEGRADED',
      message: 'Bot health degraded',
      severity: 'error',
      actionHint: 'Check bot configuration and logs',
    };
  }

  if (!input.hasAccountAttached) {
    return {
      blocker: 'NO_ACCOUNT_ATTACHED',
      message: 'No account attached',
      severity: 'warning',
      actionHint: 'Attach a trading account',
    };
  }

  if (input.isBacktesting) {
    return {
      blocker: 'BACKTEST_IN_PROGRESS',
      message: 'Backtest running',
      severity: 'info',
    };
  }

  if (!input.hasMarketData) {
    return {
      blocker: 'NO_MARKET_DATA',
      message: 'No market data available',
      severity: 'error',
      actionHint: 'Configure market data provider',
    };
  }

  if (!input.marketOpen) {
    return {
      blocker: 'MARKET_CLOSED',
      message: 'Market closed',
      severity: 'info',
    };
  }

  if (input.hasMacroBlock) {
    return {
      blocker: 'MACRO_EVENT_BLOCK',
      message: 'Blocked by macro event',
      severity: 'warning',
    };
  }

  if (input.hasRiskBlock) {
    return {
      blocker: 'RISK_ENGINE_BLOCK',
      message: 'Risk limits reached',
      severity: 'warning',
      actionHint: 'Review daily loss limits',
    };
  }

  if (input.stage === 'LIVE' && !input.accountArmed) {
    return {
      blocker: 'ACCOUNT_NOT_ARMED',
      message: 'Account not armed for live',
      severity: 'warning',
      actionHint: 'Arm account for live trading',
    };
  }

  return {
    blocker: 'WAITING_FOR_SIGNAL',
    message: 'Waiting for signal',
    severity: 'info',
  };
}
