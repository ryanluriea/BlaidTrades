/**
 * TRUTH MAP - Single Source of Truth per Stage
 * 
 * Defines canonical artifacts, required tables, and validation rules
 * for each trading stage (LAB → PAPER → SHADOW → CANARY → LIVE).
 * 
 * This is the authoritative contract for what data MUST exist at each stage.
 */

// ============================================================
// STAGE DEFINITIONS
// ============================================================

export type TradingStage = 'TRIALS' | 'PAPER' | 'SHADOW' | 'CANARY' | 'LIVE';
export type ExecutionMode = 'BACKTEST_ONLY' | 'SIM_LIVE' | 'SHADOW' | 'LIVE';

// ============================================================
// ARTIFACT TYPES
// ============================================================

export interface ArtifactDefinition {
  table: string;
  description: string;
  required: boolean;
  keyColumns: readonly string[];
  validationRules: string[];
}

export interface StageArtifacts {
  stage: TradingStage;
  mode: ExecutionMode;
  artifacts: Record<string, ArtifactDefinition>;
  invariants: string[];
  promotionGates: string[];
}

// ============================================================
// CANONICAL TABLES - SINGLE SOURCE OF TRUTH
// ============================================================

export const CANONICAL_TABLES = {
  // A) Decisions/Signals
  DECISIONS: {
    table: 'trade_decision_trace',
    description: 'Every trading decision with sources, risk checks, and arbiter verdict',
    keyColumns: ['id', 'bot_id', 'mode', 'stage', 'symbol', 'timestamp'],
  },
  DECISION_SOURCES: {
    table: 'trade_decision_sources',
    description: 'Sources contributing to each decision with weights',
    keyColumns: ['decision_id', 'source_id', 'contribution_score'],
  },
  
  // B) Orders
  ORDERS: {
    table: 'orders',
    description: 'All order submissions (SIM/SHADOW/LIVE)',
    keyColumns: ['id', 'user_id', 'bot_instance_id', 'account_id', 'instrument', 'status'],
  },
  
  // C) Fills
  FILLS: {
    table: 'execution_fills',
    description: 'Execution fills linked to orders',
    keyColumns: ['id', 'order_id', 'fill_price', 'fill_quantity', 'filled_at'],
  },
  
  // D) Positions (derived from trade_logs.is_open)
  POSITIONS: {
    table: 'trade_logs',
    description: 'Open positions (is_open = true)',
    keyColumns: ['id', 'instrument', 'side', 'quantity', 'entry_price', 'is_open'],
  },
  
  // E) Trades (closed)
  TRADES: {
    table: 'trade_logs',
    description: 'Closed trades with PnL',
    keyColumns: ['id', 'instrument', 'pnl', 'entry_time', 'exit_time', 'is_open'],
  },
  
  // F) Jobs
  JOBS: {
    table: 'bot_jobs',
    description: 'Runner actions (BACKTEST, EVOLVE, SCAN, TRADE)',
    keyColumns: ['id', 'bot_id', 'job_type', 'status', 'started_at'],
  },
  
  // G) Runners
  RUNNERS: {
    table: 'bot_instances',
    description: 'Bot runner processes with heartbeats',
    keyColumns: ['id', 'bot_id', 'status', 'activity_state', 'last_heartbeat_at', 'is_primary_runner'],
  },
  
  // H) Stage History
  HISTORY: {
    table: 'bot_history_events',
    description: 'All bot lifecycle events including promotions',
    keyColumns: ['id', 'bot_id', 'event_type', 'from_value', 'to_value', 'created_at'],
  },
  
  // I) Accounts
  ACCOUNTS: {
    table: 'accounts',
    description: 'Trading accounts (VIRTUAL/SIM/LIVE)',
    keyColumns: ['id', 'user_id', 'account_type', 'source_type', 'current_balance'],
  },
  
  // J) Backtests
  BACKTESTS: {
    table: 'backtest_sessions',
    description: 'Historical backtest sessions',
    keyColumns: ['id', 'bot_id', 'status', 'total_trades', 'profit_factor', 'win_rate'],
  },
  
  // K) Autonomy Status
  AUTONOMY: {
    table: 'autonomy_loop_status',
    description: 'Scheduler/cron job health',
    keyColumns: ['id', 'loop_name', 'is_enabled', 'last_run_at', 'last_success_at'],
  },
} as const;

// ============================================================
// STAGE-SPECIFIC ARTIFACT REQUIREMENTS
// ============================================================

export const STAGE_ARTIFACTS: Record<TradingStage, StageArtifacts> = {
  TRIALS: {
    stage: 'TRIALS',
    mode: 'BACKTEST_ONLY',
    artifacts: {
      backtests: {
        ...CANONICAL_TABLES.BACKTESTS,
        required: true,
        validationRules: [
          'At least 1 completed backtest',
          'No zero-bar sessions',
          'Profit factor computable',
        ],
      },
      jobs: {
        ...CANONICAL_TABLES.JOBS,
        required: true,
        validationRules: [
          'BACKTEST jobs completing',
          'No dead-letter storm',
        ],
      },
    },
    invariants: [
      'No live runner required',
      'No orders/fills/positions allowed',
      'Backtest metrics only',
    ],
    promotionGates: [
      'MIN_TRADES: >= 20',
      'MIN_WIN_RATE: >= 45%',
      'MIN_PROFIT_FACTOR: >= 1.1',
      'MAX_DRAWDOWN: <= 15%',
      'MIN_EXPECTANCY: >= $10/trade',
    ],
  },
  
  PAPER: {
    stage: 'PAPER',
    mode: 'SIM_LIVE',
    artifacts: {
      runners: {
        ...CANONICAL_TABLES.RUNNERS,
        required: true,
        validationRules: [
          'Primary runner exists',
          'Heartbeat fresh (< 60s)',
          'Status = running',
        ],
      },
      decisions: {
        ...CANONICAL_TABLES.DECISIONS,
        required: true,
        validationRules: [
          'Decisions logged with sources',
          'Mode = SIM_LIVE',
        ],
      },
      orders: {
        ...CANONICAL_TABLES.ORDERS,
        required: true,
        validationRules: [
          'Orders route to SIM engine only',
          'No broker_order_id (internal sim)',
        ],
      },
      fills: {
        ...CANONICAL_TABLES.FILLS,
        required: true,
        validationRules: [
          'Every order has fills (unless cancelled)',
          'Fill quantity sums match',
        ],
      },
      trades: {
        ...CANONICAL_TABLES.TRADES,
        required: true,
        validationRules: [
          'Trades linked to fills',
          'PnL computable',
        ],
      },
      positions: {
        ...CANONICAL_TABLES.POSITIONS,
        required: false,
        validationRules: [
          'Open positions reconcile with fills',
        ],
      },
    },
    invariants: [
      'Runner must be active and heartbeating',
      'Orders route to INTERNAL_SIM_FILLS only',
      'No broker API calls',
      'Market data is LIVE or HISTORICAL_REPLAY',
      'All decisions logged with sources',
    ],
    promotionGates: [
      'MIN_TRADES: >= 50',
      'MIN_WIN_RATE: >= 48%',
      'MIN_PROFIT_FACTOR: >= 1.2',
      'MAX_DRAWDOWN: <= 12%',
      'MIN_RUNTIME_HOURS: >= 120h (5 days)',
      'HEARTBEAT_UPTIME: >= 95%',
      'ORPHAN_RATE: <= 1%',
    ],
  },
  
  SHADOW: {
    stage: 'SHADOW',
    mode: 'SHADOW',
    artifacts: {
      runners: {
        ...CANONICAL_TABLES.RUNNERS,
        required: true,
        validationRules: [
          'Primary runner exists',
          'Heartbeat fresh (< 60s)',
          'Mode = SHADOW',
        ],
      },
      decisions: {
        ...CANONICAL_TABLES.DECISIONS,
        required: true,
        validationRules: [
          'Decisions logged',
          'Mode = SHADOW',
          'Same risk checks as LIVE',
        ],
      },
      orders: {
        ...CANONICAL_TABLES.ORDERS,
        required: true,
        validationRules: [
          'Orders created (shadow)',
          'Routes to SIM engine (not broker)',
        ],
      },
      fills: {
        ...CANONICAL_TABLES.FILLS,
        required: true,
        validationRules: [
          'Fills simulated with realistic slippage',
        ],
      },
      trades: {
        ...CANONICAL_TABLES.TRADES,
        required: true,
        validationRules: [
          'Full trade lifecycle',
        ],
      },
    },
    invariants: [
      'Identical risk checks to LIVE',
      'Identical sizing logic to LIVE',
      'Routes to SIM fills only (not broker)',
      'Live market data required',
    ],
    promotionGates: [
      'MIN_TRADES: >= 100',
      'MIN_WIN_RATE: >= 50%',
      'MIN_PROFIT_FACTOR: >= 1.3',
      'MAX_DRAWDOWN: <= 10%',
      'MIN_RUNTIME_DAYS: >= 10',
      'MIN_SHARPE: >= 0.8',
    ],
  },
  
  CANARY: {
    stage: 'CANARY',
    mode: 'LIVE',
    artifacts: {
      runners: {
        ...CANONICAL_TABLES.RUNNERS,
        required: true,
        validationRules: [
          'Primary runner exists',
          'Heartbeat fresh (< 30s)',
          'Mode = LIVE',
        ],
      },
      orders: {
        ...CANONICAL_TABLES.ORDERS,
        required: true,
        validationRules: [
          'Orders route to BROKER',
          'broker_order_id present',
          'Minimum size enforced',
        ],
      },
      fills: {
        ...CANONICAL_TABLES.FILLS,
        required: true,
        validationRules: [
          'Broker fills received',
          'Reconciliation with broker',
        ],
      },
    },
    invariants: [
      'Real broker execution',
      'Minimum size cap (e.g., 1 micro)',
      'Tighter risk caps than full LIVE',
      'Auto-demotion on critical error',
    ],
    promotionGates: [
      'MIN_TRADES: >= 150',
      'MIN_WIN_RATE: >= 52%',
      'MIN_PROFIT_FACTOR: >= 1.4',
      'MAX_DRAWDOWN: <= 8%',
      'MIN_RUNTIME_DAYS: >= 14',
      'MIN_SHARPE: >= 1.0',
      'REQUIRES_MANUAL_APPROVAL: true',
    ],
  },
  
  LIVE: {
    stage: 'LIVE',
    mode: 'LIVE',
    artifacts: {
      runners: {
        ...CANONICAL_TABLES.RUNNERS,
        required: true,
        validationRules: [
          'Primary runner exists',
          'Heartbeat fresh (< 30s)',
          'Mode = LIVE',
        ],
      },
      orders: {
        ...CANONICAL_TABLES.ORDERS,
        required: true,
        validationRules: [
          'Orders route to BROKER',
          'Full size allowed',
        ],
      },
      fills: {
        ...CANONICAL_TABLES.FILLS,
        required: true,
        validationRules: [
          'Broker fills reconciled',
        ],
      },
    },
    invariants: [
      'Full production execution',
      'Kill switch verified',
      'Max loss locks active',
      'Account armed',
    ],
    promotionGates: [], // Already at max stage
  },
};

// ============================================================
// VALIDATION THRESHOLDS
// ============================================================

export const VALIDATION_THRESHOLDS = {
  // Runner health
  HEARTBEAT_STALE_SECONDS: 60,
  HEARTBEAT_CRITICAL_SECONDS: 300,
  HEARTBEAT_UPTIME_TARGET_PCT: 95,
  
  // Order lifecycle
  ORDER_ACK_TIMEOUT_MS: 5000,
  FILL_TIMEOUT_MS: 30000,
  ORPHAN_RATE_MAX_PCT: 1,
  
  // PnL reconciliation
  PNL_TOLERANCE_USD: 1.00,
  PNL_TOLERANCE_PCT: 0.1,
  
  // Market data
  MARKET_DATA_GAP_MAX_SECONDS: 60,
  
  // Autonomy
  SCHEDULER_STALE_MINUTES: 15,
  JOB_COMPLETION_TARGET_PCT: 95,
  DEAD_LETTER_MAX_PCT: 5,
  
  // Performance budgets
  OVERVIEW_P95_MS: 800,
  AUDIT_TIMEOUT_MS: 5000,
} as const;

// ============================================================
// ORDER LIFECYCLE STATES
// ============================================================

export const ORDER_LIFECYCLE = {
  VALID_STATES: ['pending', 'submitted', 'filled', 'partial', 'cancelled', 'rejected'],
  TERMINAL_STATES: ['filled', 'cancelled', 'rejected'],
  REQUIRES_FILLS: ['filled', 'partial'],
} as const;

// ============================================================
// EXECUTION ROUTES
// ============================================================

export const EXECUTION_ROUTES = {
  TRIALS: 'NONE', // No execution in TRIALS
  PAPER: 'INTERNAL_SIM_FILLS',
  SHADOW: 'INTERNAL_SIM_FILLS', // Same as PAPER, but with LIVE data
  CANARY: 'BROKER_FILLS',
  LIVE: 'BROKER_FILLS',
} as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get required artifacts for a stage
 */
export function getStageArtifacts(stage: TradingStage): StageArtifacts {
  return STAGE_ARTIFACTS[stage];
}

/**
 * Get promotion gates for transitioning FROM a stage
 */
export function getPromotionGates(fromStage: TradingStage): string[] {
  return STAGE_ARTIFACTS[fromStage].promotionGates;
}

/**
 * Get the expected execution route for a mode
 */
export function getExpectedRoute(mode: ExecutionMode): string {
  switch (mode) {
    case 'BACKTEST_ONLY':
      return 'NONE';
    case 'SIM_LIVE':
    case 'SHADOW':
      return 'INTERNAL_SIM_FILLS';
    case 'LIVE':
      return 'BROKER_FILLS';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Validate that a mode/stage combination is allowed
 */
export function validateModeStage(mode: ExecutionMode, stage: TradingStage): boolean {
  const stageArtifacts = STAGE_ARTIFACTS[stage];
  return stageArtifacts.mode === mode;
}

/**
 * Get metric provenance label
 */
export function getProvenanceLabel(
  source: 'BACKTEST' | 'PAPER' | 'SHADOW' | 'LIVE',
  sessionId?: string,
  matrixRunId?: string
): string {
  const parts: string[] = [source];
  if (matrixRunId) parts.push(`matrix:${matrixRunId.slice(0, 8)}`);
  if (sessionId) parts.push(`session:${sessionId.slice(0, 8)}`);
  return parts.join(' | ');
}
