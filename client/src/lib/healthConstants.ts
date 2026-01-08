/**
 * UNIFIED HEALTH CONSTANTS - SINGLE SOURCE OF TRUTH
 * 
 * All health thresholds and display logic MUST use these constants.
 * DO NOT define thresholds elsewhere.
 */

// =============================================
// THRESHOLDS
// =============================================

export const HEALTH_THRESHOLDS = {
  DEGRADED: 40,      // Score < 40 = DEGRADED
  WARN: 60,          // Score < 60 = WARN (if not DEGRADED)
  OK: 60,            // Score >= 60 = OK (if no blockers)
} as const;

export const HEARTBEAT_THRESHOLDS = {
  STALE_MS: 120_000,    // 2 minutes = stale (DEGRADED)
  WARNING_MS: 60_000,   // 1 minute = warning
} as const;

// Grace period for newly promoted bots
export const GRACE_PERIOD_MS = 180_000; // 3 minutes grace after promotion
export const AUTO_HEAL_ATTEMPTS_THRESHOLD = 3; // Only degrade after 3+ failed heal attempts

// =============================================
// DISPLAY STATES
// =============================================

// HealthState is the DB/computed state
export type HealthState = 'OK' | 'WARN' | 'DEGRADED';

// DisplayHealthState includes transitional states for UI display
export type DisplayHealthState = HealthState | 'BLOCKED' | 'STARTING' | 'HEALING';

// Reason codes for health issues
export type HealthReasonCode = 
  | 'NO_RUNNER'
  | 'STALE_HEARTBEAT'
  | 'STALE_QUOTES'
  | 'JOB_DOWN'
  | 'BACKTEST_FAILURES'
  | 'EVOLUTION_ROLLBACKS'
  | 'PROMOTION_FAILURES'
  | 'HIGH_DRAWDOWN'
  | 'FREQUENT_ERRORS'
  | 'CIRCUIT_BREAKER'
  | 'AUTO_HEAL_FAILED'
  | 'STARTING_UP'
  | 'HEALING_IN_PROGRESS';

/**
 * Compute the display state for UI rendering
 * 
 * STARTING = Recently promoted, within grace period
 * HEALING = Auto-heal in progress
 * BLOCKED = High score but critical blockers (score >= 60 but blockers prevent operation)
 * DEGRADED = Low score (< 40) or critical issues after grace/heal attempts exhausted
 * WARN = Medium score (40-60) or warning issues  
 * OK = Healthy (>= 60) with no issues
 */
export function getDisplayHealthState(
  healthState: HealthState,
  healthScore: number,
  hasCriticalBlockers: boolean,
  options?: {
    promotedAt?: string | Date | null;
    isHealing?: boolean;
    autoHealAttempts?: number;
  }
): DisplayHealthState {
  const now = Date.now();
  const promotedAt = options?.promotedAt ? new Date(options.promotedAt).getTime() : null;
  const isHealing = options?.isHealing ?? false;
  const autoHealAttempts = options?.autoHealAttempts ?? 0;

  // Check if within grace period after promotion
  if (promotedAt && (now - promotedAt) < GRACE_PERIOD_MS) {
    // Within grace period - show STARTING if there are issues
    if (healthState === 'DEGRADED' || hasCriticalBlockers) {
      return 'STARTING';
    }
  }

  // Check if auto-healing is in progress
  if (isHealing) {
    return 'HEALING';
  }

  // After grace period, only show DEGRADED if heal attempts exceeded threshold
  if (healthState === 'DEGRADED' && autoHealAttempts < AUTO_HEAL_ATTEMPTS_THRESHOLD) {
    // Still trying to heal - show HEALING
    return 'HEALING';
  }

  // High score but blocked by issues = BLOCKED (not DEGRADED)
  if (healthState === 'DEGRADED' && healthScore >= HEALTH_THRESHOLDS.OK && hasCriticalBlockers) {
    return 'BLOCKED';
  }

  return healthState;
}

/**
 * Determine health state from score and blockers
 */
export function computeHealthStateFromScore(
  score: number,
  hasCriticalBlockers: boolean,
  hasWarningBlockers: boolean
): HealthState {
  if (hasCriticalBlockers || score < HEALTH_THRESHOLDS.DEGRADED) {
    return 'DEGRADED';
  }
  if (hasWarningBlockers || score < HEALTH_THRESHOLDS.WARN) {
    return 'WARN';
  }
  return 'OK';
}

// =============================================
// DISPLAY COLORS
// =============================================

export const HEALTH_DISPLAY_COLORS: Record<DisplayHealthState, {
  bg: string;
  border: string;
  text: string;
  label: string;
}> = {
  OK: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    label: 'Healthy',
  },
  WARN: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    label: 'Warning',
  },
  DEGRADED: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    label: 'Degraded',
  },
  BLOCKED: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    label: 'Blocked',
  },
  STARTING: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    label: 'Starting…',
  },
  HEALING: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    text: 'text-cyan-400',
    label: 'Auto-healing…',
  },
};

// =============================================
// TRIALS BOT RULES
// =============================================

/**
 * Should health badge be shown for this stage?
 * TRIALS bots don't show health badges - low scores are expected during evolution
 */
export function shouldShowHealthBadge(stage: string, healthState: HealthState): boolean {
  if (stage === 'TRIALS') return false;
  return healthState !== 'OK';
}

// =============================================
// REASON CODE LABELS
// =============================================

export const HEALTH_REASON_LABELS: Record<HealthReasonCode, {
  title: string;
  description: string;
  action?: string;
}> = {
  NO_RUNNER: {
    title: 'No Runner',
    description: 'No active runner process for this bot',
    action: 'Runner will auto-start shortly',
  },
  STALE_HEARTBEAT: {
    title: 'Stale Heartbeat',
    description: 'Runner heartbeat is outdated',
    action: 'Auto-restart in progress',
  },
  STALE_QUOTES: {
    title: 'Stale Market Data',
    description: 'Market data feed is stale',
    action: 'Check market data connections',
  },
  JOB_DOWN: {
    title: 'Job System Down',
    description: 'Job processing system is not responding',
    action: 'Check system status',
  },
  BACKTEST_FAILURES: {
    title: 'Backtest Failures',
    description: 'Recent backtests have been failing',
  },
  EVOLUTION_ROLLBACKS: {
    title: 'Evolution Rollbacks',
    description: 'Multiple evolution rollbacks detected',
  },
  PROMOTION_FAILURES: {
    title: 'Promotion Gate Failures',
    description: 'Bot is failing promotion gates',
  },
  HIGH_DRAWDOWN: {
    title: 'High Drawdown',
    description: 'Drawdown exceeds safe thresholds',
  },
  FREQUENT_ERRORS: {
    title: 'Frequent Errors',
    description: 'Too many errors in recent history',
  },
  CIRCUIT_BREAKER: {
    title: 'Circuit Breaker Open',
    description: 'Safety circuit has tripped',
    action: 'Manual review required',
  },
  AUTO_HEAL_FAILED: {
    title: 'Auto-heal Failed',
    description: 'Automatic recovery attempts exhausted',
    action: 'Manual intervention required',
  },
  STARTING_UP: {
    title: 'Starting Up',
    description: 'Bot is initializing after promotion',
  },
  HEALING_IN_PROGRESS: {
    title: 'Healing',
    description: 'Automatic recovery in progress',
  },
};
