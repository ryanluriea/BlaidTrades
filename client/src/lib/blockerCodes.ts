/**
 * CANONICAL BLOCKER CODES - SINGLE SOURCE OF TRUTH
 * 
 * Used everywhere: bots.health_reason_code, bot_jobs.blocker_code, 
 * UI "Why not trading", logs, alerts.
 * 
 * Rule: UI shows exactly ONE primary blocker_code + remediation + ETA
 */

export type BlockerSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface BlockerDefinition {
  code: string;
  category: 'PROVIDER' | 'RUNNER' | 'JOB' | 'EVOLUTION' | 'GATE' | 'USER' | 'SYSTEM' | 'DATA';
  severity: BlockerSeverity;
  message: string;
  remediation: string;
  auto_healable: boolean;
  requires_user_action: boolean;
  dlq_immediately?: boolean;
  backoff_strategy?: 'EXPONENTIAL' | 'LINEAR' | 'NONE';
  initial_backoff_ms?: number;
  max_backoff_ms?: number;
}

export const BLOCKER_CODES: Record<string, BlockerDefinition> = {
  // =============================================
  // PROVIDER BLOCKERS
  // =============================================
  NO_PROVIDER_CONFIG: {
    code: 'NO_PROVIDER_CONFIG',
    category: 'PROVIDER',
    severity: 'CRITICAL',
    message: 'No market data provider configured',
    remediation: 'Configure a market data provider in System Status → Connections',
    auto_healable: false,
    requires_user_action: true,
    dlq_immediately: true,
  },
  PROVIDER_RATE_LIMIT: {
    code: 'PROVIDER_RATE_LIMIT',
    category: 'PROVIDER',
    severity: 'WARNING',
    message: 'Rate limited by data provider',
    remediation: 'Backing off automatically. Will retry in {eta}',
    auto_healable: true,
    requires_user_action: false,
    backoff_strategy: 'EXPONENTIAL',
    initial_backoff_ms: 30_000,
    max_backoff_ms: 600_000,
  },
  PROVIDER_AUTH_FAIL: {
    code: 'PROVIDER_AUTH_FAIL',
    category: 'PROVIDER',
    severity: 'CRITICAL',
    message: 'Authentication failed with data provider',
    remediation: 'Check API key in System Status → Connections',
    auto_healable: false,
    requires_user_action: true,
    dlq_immediately: true,
  },
  PROVIDER_TIMEOUT: {
    code: 'PROVIDER_TIMEOUT',
    category: 'PROVIDER',
    severity: 'WARNING',
    message: 'Data provider request timed out',
    remediation: 'Retrying with fallback provider',
    auto_healable: true,
    requires_user_action: false,
    backoff_strategy: 'LINEAR',
    initial_backoff_ms: 5_000,
    max_backoff_ms: 60_000,
  },
  PROVIDER_CIRCUIT_OPEN: {
    code: 'PROVIDER_CIRCUIT_OPEN',
    category: 'PROVIDER',
    severity: 'CRITICAL',
    message: 'Provider circuit breaker engaged',
    remediation: 'Too many failures. Circuit will close in {eta}',
    auto_healable: true,
    requires_user_action: false,
  },

  // =============================================
  // DATA BLOCKERS
  // =============================================
  DATA_EMPTY_BARS: {
    code: 'DATA_EMPTY_BARS',
    category: 'DATA',
    severity: 'CRITICAL',
    message: 'No market data returned for requested period',
    remediation: 'Market may be closed or symbol invalid. Trying fallback provider.',
    auto_healable: true,
    requires_user_action: false,
    backoff_strategy: 'EXPONENTIAL',
    initial_backoff_ms: 10_000,
    max_backoff_ms: 300_000,
  },
  DATA_INSUFFICIENT_BARS: {
    code: 'DATA_INSUFFICIENT_BARS',
    category: 'DATA',
    severity: 'WARNING',
    message: 'Insufficient data bars for analysis',
    remediation: 'Need at least {required} bars, got {actual}',
    auto_healable: false,
    requires_user_action: false,
  },
  DATA_STALE: {
    code: 'DATA_STALE',
    category: 'DATA',
    severity: 'WARNING',
    message: 'Market data is stale',
    remediation: 'Last update was {age}s ago. Reconnecting.',
    auto_healable: true,
    requires_user_action: false,
  },

  // =============================================
  // RUNNER BLOCKERS
  // =============================================
  RUNNER_STALE_HEARTBEAT: {
    code: 'RUNNER_STALE_HEARTBEAT',
    category: 'RUNNER',
    severity: 'CRITICAL',
    message: 'Runner heartbeat is stale',
    remediation: 'Auto-restart queued',
    auto_healable: true,
    requires_user_action: false,
  },
  RUNNER_CIRCUIT_BREAK: {
    code: 'RUNNER_CIRCUIT_BREAK',
    category: 'RUNNER',
    severity: 'CRITICAL',
    message: 'Runner circuit breaker engaged (too many restarts)',
    remediation: 'Manual intervention required or wait for {eta}',
    auto_healable: false,
    requires_user_action: true,
  },
  RUNNER_NO_INSTANCE: {
    code: 'RUNNER_NO_INSTANCE',
    category: 'RUNNER',
    severity: 'CRITICAL',
    message: 'No runner instance exists',
    remediation: 'Start runner or attach to account',
    auto_healable: true,
    requires_user_action: false,
  },
  RUNNER_ERROR: {
    code: 'RUNNER_ERROR',
    category: 'RUNNER',
    severity: 'CRITICAL',
    message: 'Runner encountered an error',
    remediation: 'Check logs. Auto-restart in {eta}',
    auto_healable: true,
    requires_user_action: false,
  },

  // =============================================
  // JOB BLOCKERS
  // =============================================
  JOB_TIMEOUT: {
    code: 'JOB_TIMEOUT',
    category: 'JOB',
    severity: 'CRITICAL',
    message: 'Job exceeded maximum runtime',
    remediation: 'Requeuing with fresh attempt',
    auto_healable: true,
    requires_user_action: false,
  },
  JOB_MAX_ATTEMPTS: {
    code: 'JOB_MAX_ATTEMPTS',
    category: 'JOB',
    severity: 'CRITICAL',
    message: 'Job failed after maximum attempts',
    remediation: 'Moved to dead letter queue. Manual review needed.',
    auto_healable: false,
    requires_user_action: true,
    dlq_immediately: true,
  },
  JOB_WORKER_UNAVAILABLE: {
    code: 'JOB_WORKER_UNAVAILABLE',
    category: 'JOB',
    severity: 'WARNING',
    message: 'No worker available to process job',
    remediation: 'Job queued. Will process when worker available.',
    auto_healable: true,
    requires_user_action: false,
  },

  // =============================================
  // EVOLUTION BLOCKERS
  // =============================================
  EVOLVE_NO_MUTATION_DIFF: {
    code: 'EVOLVE_NO_MUTATION_DIFF',
    category: 'EVOLUTION',
    severity: 'WARNING',
    message: 'Evolution produced no meaningful mutation',
    remediation: 'Trying alternative mutation strategy',
    auto_healable: true,
    requires_user_action: false,
  },
  TOURNAMENT_NO_QUALIFIED_WINNER: {
    code: 'TOURNAMENT_NO_QUALIFIED_WINNER',
    category: 'EVOLUTION',
    severity: 'INFO',
    message: 'No generation met promotion criteria',
    remediation: 'Keeping current generation. Will evolve toward failing gate.',
    auto_healable: true,
    requires_user_action: false,
  },
  EVOLUTION_EXHAUSTED: {
    code: 'EVOLUTION_EXHAUSTED',
    category: 'EVOLUTION',
    severity: 'WARNING',
    message: 'Evolution attempts exhausted',
    remediation: 'Bot has reached improvement limit. Consider archetype change.',
    auto_healable: false,
    requires_user_action: true,
  },

  // =============================================
  // GATE BLOCKERS
  // =============================================
  GATES_FAILED_MIN_TRADES: {
    code: 'GATES_FAILED_MIN_TRADES',
    category: 'GATE',
    severity: 'INFO',
    message: 'Insufficient trades for promotion',
    remediation: 'Need {required} trades, have {actual}. Keep running.',
    auto_healable: false,
    requires_user_action: false,
  },
  GATES_FAILED_MIN_WR: {
    code: 'GATES_FAILED_MIN_WR',
    category: 'GATE',
    severity: 'INFO',
    message: 'Win rate below threshold',
    remediation: 'Need {required}% win rate, have {actual}%',
    auto_healable: false,
    requires_user_action: false,
  },
  GATES_FAILED_MIN_PF: {
    code: 'GATES_FAILED_MIN_PF',
    category: 'GATE',
    severity: 'INFO',
    message: 'Profit factor below threshold',
    remediation: 'Need {required} PF, have {actual}',
    auto_healable: false,
    requires_user_action: false,
  },
  GATES_FAILED_MAX_DD: {
    code: 'GATES_FAILED_MAX_DD',
    category: 'GATE',
    severity: 'WARNING',
    message: 'Drawdown exceeds limit',
    remediation: 'Max {required}% DD allowed, have {actual}%',
    auto_healable: false,
    requires_user_action: false,
  },
  GATES_FAILED_MIN_SHARPE: {
    code: 'GATES_FAILED_MIN_SHARPE',
    category: 'GATE',
    severity: 'INFO',
    message: 'Sharpe ratio below threshold',
    remediation: 'Need {required} Sharpe, have {actual}',
    auto_healable: false,
    requires_user_action: false,
  },

  // =============================================
  // USER BLOCKERS
  // =============================================
  USER_PAUSED: {
    code: 'USER_PAUSED',
    category: 'USER',
    severity: 'INFO',
    message: 'Paused by user',
    remediation: 'Click Resume to continue',
    auto_healable: false,
    requires_user_action: true,
  },
  USER_TRADING_DISABLED: {
    code: 'USER_TRADING_DISABLED',
    category: 'USER',
    severity: 'INFO',
    message: 'Trading disabled by user',
    remediation: 'Enable trading in bot settings',
    auto_healable: false,
    requires_user_action: true,
  },

  // =============================================
  // SYSTEM BLOCKERS
  // =============================================
  COOLDOWN_ACTIVE: {
    code: 'COOLDOWN_ACTIVE',
    category: 'SYSTEM',
    severity: 'INFO',
    message: 'In cooldown period',
    remediation: 'Will resume in {eta}',
    auto_healable: true,
    requires_user_action: false,
  },
  MARKET_CLOSED: {
    code: 'MARKET_CLOSED',
    category: 'SYSTEM',
    severity: 'INFO',
    message: 'Market is closed',
    remediation: 'Will resume at market open',
    auto_healable: true,
    requires_user_action: false,
  },
  SYSTEM_MAINTENANCE: {
    code: 'SYSTEM_MAINTENANCE',
    category: 'SYSTEM',
    severity: 'WARNING',
    message: 'System under maintenance',
    remediation: 'Operations paused temporarily',
    auto_healable: true,
    requires_user_action: false,
  },
};

// =============================================
// HELPER FUNCTIONS
// =============================================

export function getBlockerDefinition(code: string): BlockerDefinition | undefined {
  return BLOCKER_CODES[code];
}

export function formatBlockerMessage(code: string, params: Record<string, string | number> = {}): string {
  const def = BLOCKER_CODES[code];
  if (!def) return `Unknown blocker: ${code}`;
  
  let message = def.message;
  for (const [key, value] of Object.entries(params)) {
    message = message.replace(`{${key}}`, String(value));
  }
  return message;
}

export function formatRemediation(code: string, params: Record<string, string | number> = {}): string {
  const def = BLOCKER_CODES[code];
  if (!def) return 'Unknown remediation';
  
  let remediation = def.remediation;
  for (const [key, value] of Object.entries(params)) {
    remediation = remediation.replace(`{${key}}`, String(value));
  }
  return remediation;
}

export function shouldDLQImmediately(code: string): boolean {
  return BLOCKER_CODES[code]?.dlq_immediately ?? false;
}

export function getBackoffMs(code: string, attempt: number): number {
  const def = BLOCKER_CODES[code];
  if (!def || !def.backoff_strategy || def.backoff_strategy === 'NONE') return 0;
  
  const initial = def.initial_backoff_ms ?? 5000;
  const max = def.max_backoff_ms ?? 300000;
  
  if (def.backoff_strategy === 'LINEAR') {
    return Math.min(initial * attempt, max);
  }
  
  // EXPONENTIAL
  return Math.min(initial * Math.pow(2, attempt - 1), max);
}

export function getPrimaryBlocker(blockers: Array<{ code: string; severity?: string }>): { code: string; definition: BlockerDefinition } | null {
  if (!blockers.length) return null;
  
  // Priority: CRITICAL > WARNING > INFO
  const severityOrder = ['CRITICAL', 'WARNING', 'INFO'];
  
  for (const severity of severityOrder) {
    const blocker = blockers.find(b => {
      const def = BLOCKER_CODES[b.code];
      return def?.severity === severity || b.severity === severity;
    });
    if (blocker) {
      const definition = BLOCKER_CODES[blocker.code];
      if (definition) {
        return { code: blocker.code, definition };
      }
    }
  }
  
  // Fallback to first blocker
  const first = blockers[0];
  const definition = BLOCKER_CODES[first.code];
  return definition ? { code: first.code, definition } : null;
}

// =============================================
// BLOCKER CODE LIST BY CATEGORY
// =============================================

export function getBlockersByCategory(category: BlockerDefinition['category']): BlockerDefinition[] {
  return Object.values(BLOCKER_CODES).filter(b => b.category === category);
}

export const ALL_BLOCKER_CODES = Object.keys(BLOCKER_CODES);
