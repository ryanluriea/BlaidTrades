/**
 * UNIFIED CONSTANTS - SINGLE SOURCE OF TRUTH
 * 
 * All stage, mode, bucket, and threshold definitions MUST come from here.
 * DO NOT define these values elsewhere.
 */

// Import unified thresholds from shared source of truth
import { UNIFIED_STAGE_THRESHOLDS } from '@shared/graduationGates';

// =============================================
// BOT STAGES (Lifecycle Gates)
// =============================================

export const BOT_STAGES = ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE'] as const;
export type BotStage = typeof BOT_STAGES[number];

export const BOT_STAGES_WITH_DEGRADED = [...BOT_STAGES, 'DEGRADED'] as const;
export type BotStageWithDegraded = typeof BOT_STAGES_WITH_DEGRADED[number];

export const STAGE_ORDER: Record<BotStage, number> = {
  TRIALS: 0,
  PAPER: 1,
  SHADOW: 2,
  CANARY: 3,
  LIVE: 4,
};

export const STAGE_DISPLAY: Record<BotStageWithDegraded, { label: string; color: string }> = {
  TRIALS: { label: 'Trials', color: 'text-purple-400' },
  PAPER: { label: 'Paper', color: 'text-blue-400' },
  SHADOW: { label: 'Shadow', color: 'text-amber-400' },
  CANARY: { label: 'Canary', color: 'text-orange-400' },
  LIVE: { label: 'Live', color: 'text-emerald-400' },
  DEGRADED: { label: 'Degraded', color: 'text-red-400' },
};

// =============================================
// EXECUTION MODES
// =============================================

export const EXECUTION_MODES = ['BACKTEST_ONLY', 'SIM_LIVE', 'SHADOW', 'LIVE'] as const;
export type ExecutionMode = typeof EXECUTION_MODES[number];

export const MODE_DISPLAY: Record<ExecutionMode, { label: string; shortLabel: string }> = {
  BACKTEST_ONLY: { label: 'Backtest Only', shortLabel: 'BT' },
  SIM_LIVE: { label: 'Simulation', shortLabel: 'SIM' },
  SHADOW: { label: 'Shadow', shortLabel: 'SHADOW' },
  LIVE: { label: 'Live', shortLabel: 'LIVE' },
};

// =============================================
// STAGE → MODE MAPPING
// =============================================

export const STAGE_TO_MODE: Record<BotStageWithDegraded, ExecutionMode> = {
  TRIALS: 'BACKTEST_ONLY',
  PAPER: 'SIM_LIVE',
  SHADOW: 'SHADOW',
  CANARY: 'LIVE',
  LIVE: 'LIVE',
  DEGRADED: 'BACKTEST_ONLY',
};

// =============================================
// ACCOUNT TYPES
// =============================================

export const ACCOUNT_TYPES = ['VIRTUAL', 'SIM', 'LIVE'] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];

// =============================================
// EXECUTION ROUTING
// =============================================

export type ExecutionRouting = 'INTERNAL_SIM_FILLS' | 'BROKER_FILLS' | 'BLOCKED';

export function getExecutionRouting(accountType: string, executionMode: string): ExecutionRouting {
  if (executionMode === 'BACKTEST_ONLY') return 'INTERNAL_SIM_FILLS';
  if (executionMode === 'SIM_LIVE' || executionMode === 'SHADOW') return 'INTERNAL_SIM_FILLS';
  if (executionMode === 'LIVE') {
    if (accountType === 'LIVE') return 'BROKER_FILLS';
    return 'BLOCKED';
  }
  return 'BLOCKED';
}

// =============================================
// PRIORITY SCORE BUCKETS
// =============================================

export const PRIORITY_BUCKETS = ['A+', 'A', 'B', 'C', 'D', 'FROZEN'] as const;
export type PriorityBucket = typeof PRIORITY_BUCKETS[number];

export const PRIORITY_THRESHOLDS = {
  A_PLUS: 90,
  A: 75,
  B: 55,
  C: 35,
  // Below 35 = D, DEGRADED health = FROZEN
} as const;

export const PRIORITY_BUCKET_DISPLAY: Record<PriorityBucket, { 
  label: string; 
  color: string; 
  bgColor: string;
  description: string;
}> = {
  'A+': { 
    label: 'A+', 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/10',
    description: 'Top performer - max allocation',
  },
  'A': { 
    label: 'A', 
    color: 'text-green-400', 
    bgColor: 'bg-green-500/10',
    description: 'Strong performer - high allocation',
  },
  'B': { 
    label: 'B', 
    color: 'text-blue-400', 
    bgColor: 'bg-blue-500/10',
    description: 'Average performer - standard allocation',
  },
  'C': { 
    label: 'C', 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/10',
    description: 'Underperformer - reduced allocation',
  },
  'D': { 
    label: 'D', 
    color: 'text-orange-400', 
    bgColor: 'bg-orange-500/10',
    description: 'Poor performer - minimal allocation',
  },
  'FROZEN': { 
    label: 'Frozen', 
    color: 'text-red-400', 
    bgColor: 'bg-red-500/10',
    description: 'Frozen - no allocation (fix issues)',
  },
};

export function scoreToBucket(score: number, healthState: string): PriorityBucket {
  if (healthState === 'DEGRADED' || healthState === 'FROZEN') return 'FROZEN';
  if (score >= PRIORITY_THRESHOLDS.A_PLUS) return 'A+';
  if (score >= PRIORITY_THRESHOLDS.A) return 'A';
  if (score >= PRIORITY_THRESHOLDS.B) return 'B';
  if (score >= PRIORITY_THRESHOLDS.C) return 'C';
  return 'D';
}

// =============================================
// RUNNER STATES
// =============================================

export const RUNNER_STATES = [
  'NO_RUNNER', 
  'STARTING', 
  'SCANNING', 
  'TRADING', 
  'RUNNING',
  'PAUSED', 
  'STOPPED', 
  'STALLED', 
  'STALE',
  'ERROR', 
  'BLOCKED',
  'REQUIRED',
  'CIRCUIT_BREAK',
  'RESTARTING',
  'UNKNOWN',
] as const;
export type RunnerState = typeof RUNNER_STATES[number];

// =============================================
// JOB STATES
// =============================================

export const JOB_STATES = [
  'IDLE',
  'BACKTEST_QUEUED',
  'BACKTEST_RUNNING',
  'EVOLVING',
  'TOURNAMENT_RUNNING',
  'AWAITING_BACKTEST',
  'MUTATION_PENDING',
  'COOLDOWN',
  'NEEDS_BACKTEST',
  'UNKNOWN',
] as const;
export type JobState = typeof JOB_STATES[number];

// =============================================
// BLOCKER TYPES
// =============================================

export const BLOCKER_TYPES = [
  'NONE',
  'NO_ACCOUNT',
  'NO_MARKET_DATA',
  'NO_BROKER',
  'CIRCUIT_BREAKER',
  'DAILY_LOSS_LIMIT',
  'MAX_EXPOSURE',
  'DEGRADED_HEALTH',
  'MARKET_CLOSED',
  'COOLDOWN_ACTIVE',
  'EVOLUTION_PAUSED',
  'MANUAL_PAUSE',
  'INSUFFICIENT_CAPITAL',
  'STALE_HEARTBEAT',
  'JOB_FAILED',
  'CONFIG_ERROR',
  'AUTH_ERROR',
] as const;
export type BlockerType = typeof BLOCKER_TYPES[number];

// =============================================
// RISK TIERS
// =============================================

export const RISK_TIERS = ['conservative', 'moderate', 'aggressive'] as const;
export type RiskTier = typeof RISK_TIERS[number];

export const RISK_TIER_DISPLAY: Record<RiskTier, { label: string; description: string }> = {
  conservative: { 
    label: 'Conservative', 
    description: 'Lower risk, smaller positions, slower promotion',
  },
  moderate: { 
    label: 'Moderate', 
    description: 'Balanced risk and position sizing',
  },
  aggressive: { 
    label: 'Aggressive', 
    description: 'Higher risk, larger positions, faster evolution',
  },
};

// =============================================
// JOB SLA DEFINITIONS (EXACT)
// =============================================

export const JOB_SLA_MS = {
  BACKTEST: 10 * 60 * 1000,      // 10 minutes
  EVOLVE: 15 * 60 * 1000,        // 15 minutes
  RUNNER_START: 60 * 1000,       // 60 seconds
  PROMOTION_CHECK: 2 * 60 * 1000, // 2 minutes
  DEMOTION_CHECK: 2 * 60 * 1000,  // 2 minutes
  HEALTH_RECONCILE: 60 * 1000,    // 60 seconds
  PRIORITY_COMPUTE: 60 * 1000,    // 60 seconds
  HEALTH_SCORE: 60 * 1000,        // 60 seconds
} as const;

export type JobType = keyof typeof JOB_SLA_MS;

export const JOB_SLA_CONFIG: Record<string, { 
  maxRuntimeMs: number; 
  heartbeatIntervalMs: number;
  maxAttempts: number;
  staleThresholdMs: number;
}> = {
  BACKTEST: { 
    maxRuntimeMs: JOB_SLA_MS.BACKTEST, 
    heartbeatIntervalMs: 10_000,
    maxAttempts: 5,
    staleThresholdMs: 30_000,
  },
  EVOLVE: { 
    maxRuntimeMs: JOB_SLA_MS.EVOLVE, 
    heartbeatIntervalMs: 15_000,
    maxAttempts: 3,
    staleThresholdMs: 45_000,
  },
  RUNNER: { 
    maxRuntimeMs: 0, // Runners run indefinitely
    heartbeatIntervalMs: 5_000,
    maxAttempts: 5,
    staleThresholdMs: 30_000,
  },
  PRIORITY_COMPUTE: {
    maxRuntimeMs: JOB_SLA_MS.PRIORITY_COMPUTE,
    heartbeatIntervalMs: 10_000,
    maxAttempts: 3,
    staleThresholdMs: 30_000,
  },
  HEALTH_SCORE: {
    maxRuntimeMs: JOB_SLA_MS.HEALTH_SCORE,
    heartbeatIntervalMs: 10_000,
    maxAttempts: 3,
    staleThresholdMs: 30_000,
  },
};

// =============================================
// HEARTBEAT THRESHOLDS
// =============================================

export const HEARTBEAT_THRESHOLDS = {
  STALE_MS: 90_000,      // 90 seconds = stale heartbeat
  WARNING_MS: 60_000,    // 60 seconds = warning
  CRITICAL_MS: 120_000,  // 2 minutes = critical
} as const;

// =============================================
// PRODUCTION READINESS GATES
// Uses unified thresholds from shared/graduationGates.ts
// =============================================

// Derive from PAPER stage thresholds (readiness for production)
const paperThresholds = UNIFIED_STAGE_THRESHOLDS.PAPER;
export const READINESS_GATES = {
  MIN_BACKTESTS_FOR_PROMOTION: 5,
  MIN_WIN_RATE_PAPER: paperThresholds.minWinRate,           // 40 (unified)
  MIN_PROFIT_FACTOR_PAPER: paperThresholds.minProfitFactor, // 1.3 (unified)
  MAX_DRAWDOWN_PCT_PAPER: paperThresholds.maxDrawdownPct,   // 15 (unified)
  MIN_TRADES_FOR_METRICS: 10,
} as const;
