import { pgTable, text, serial, integer, bigint, boolean, timestamp, jsonb, real, uuid, pgEnum, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const accountProviderEnum = pgEnum("account_provider", ["INTERNAL", "IRONBEAM", "TRADOVATE", "OTHER"]);
export const accountTypeEnum = pgEnum("account_type", ["SIM", "LIVE", "VIRTUAL"]);
export const alertCategoryEnum = pgEnum("alert_category", [
  "PROMOTION_READY", "LIVE_PROMOTION_RECOMMENDED", "BOT_DEGRADED", "BOT_STALLED",
  "DATA_HEALTH", "EXECUTION_RISK", "ACCOUNT_RISK_BREACH", "ARBITER_DECISION_ANOMALY"
]);
export const alertEntityTypeEnum = pgEnum("alert_entity_type", ["BOT", "ACCOUNT", "SYSTEM", "TRADE"]);
export const alertSeverityEnum = pgEnum("alert_severity", ["INFO", "WARN", "CRITICAL"]);
export const alertSourceEnum = pgEnum("alert_source", ["promotion_engine", "risk_engine", "arbiter", "data_hub", "system"]);
export const alertStatusEnum = pgEnum("alert_status", ["OPEN", "ACKED", "SNOOZED", "DISMISSED", "RESOLVED"]);
export const appRoleEnum = pgEnum("app_role", ["admin", "user"]);
export const biasTypeEnum = pgEnum("bias_type", ["bullish", "bearish", "neutral", "mixed"]);
export const botModeEnum = pgEnum("bot_mode", ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW", "LIVE"]);
export const botStatusEnum = pgEnum("bot_status", ["idle", "running", "paused", "error", "stopped"]);
export const dataFeedModeEnum = pgEnum("data_feed_mode", ["HISTORICAL_DATA", "LIVE_DATA"]);
export const eventSeverityEnum = pgEnum("event_severity", ["info", "warning", "error", "critical"]);
export const evolutionModeEnum = pgEnum("evolution_mode", ["auto", "locked", "paused"]);
export const evolutionStatusEnum = pgEnum("evolution_status", [
  "untested", "backtesting", "sim_ready", "sim_live", "shadow", "live", "retired"
]);
export const orderSideEnum = pgEnum("order_side", ["BUY", "SELL"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "submitted", "filled", "partial", "cancelled", "rejected"]);
export const orderTypeEnum = pgEnum("order_type", ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"]);
export const providerStatusEnum = pgEnum("provider_status", ["connected", "degraded", "disconnected", "error"]);
export const providerTypeEnum = pgEnum("provider_type", ["data", "broker"]);
export const riskTierEnum = pgEnum("risk_tier", ["conservative", "moderate", "aggressive"]);
export const signalTypeEnum = pgEnum("signal_type", ["entry", "exit", "scale_in", "scale_out", "stop_adjustment"]);
export const sessionModeEnum = pgEnum("session_mode", ["FULL_24x5", "RTH_US", "ETH", "CUSTOM"]);
export const rulesProfileEnum = pgEnum("rules_profile", ["PRODUCTION", "LAB_RELAXED"]);

// AI Provenance Tracking Enum (Grok integration)
export const aiProviderEnum = pgEnum("ai_provider", [
  "PERPLEXITY",
  "GROK",
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "OPENROUTER",
  "OTHER"
]);

// Walk-Forward Optimization & Institutional Backtesting Enums
export const segmentTypeEnum = pgEnum("segment_type", [
  "TRAINING",      // In-sample period for parameter optimization
  "TESTING",       // Out-of-sample period for validation
  "VALIDATION",    // Holdout period never used in training
  "STRESS_TEST",   // Specific stress scenario testing
  "FULL_RANGE"     // Traditional full-range backtest (no segmentation)
]);

export const marketRegimeEnum = pgEnum("market_regime", [
  "BULL",           // Sustained uptrend
  "BEAR",           // Sustained downtrend
  "SIDEWAYS",       // Range-bound, low directional bias
  "HIGH_VOLATILITY", // Elevated volatility (VIX spike, crisis)
  "LOW_VOLATILITY",  // Compressed volatility
  "UNKNOWN"         // Regime not yet classified
]);

export const walkForwardStatusEnum = pgEnum("walk_forward_status", [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED"
]);

// TRIALS Idle Reason Codes - Institutional audit trail for bot activity state
export const IDLE_REASON_CODES = [
  "RUNNING",           // Job currently executing
  "QUEUED",            // Job queued awaiting worker
  "SLA_BREACH",        // No work for too long (overdue - only when NO active work)
  "WAITING_ON_DATA",   // Awaiting data feed or bar cache
  "WAITING_ON_WORKER", // Worker capacity exhausted
  "SATURATED",         // System at capacity
  "NEEDS_BASELINE",    // First backtest needed
  "BACKTEST_DUE",      // Backtest interval exceeded
  "IMPROVE_DUE",       // Improvement due after backtest
  "EVOLVE_DUE",        // Evolution cycle due
  "HEALTHY_IDLE",      // Normal wait between scheduled work
] as const;

export type IdleReasonCode = typeof IDLE_REASON_CODES[number];

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  username: text("username"),
  password: text("password").notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecretEncrypted: text("two_factor_secret_encrypted"),
  twoFactorBackupCodesHash: jsonb("two_factor_backup_codes_hash"),
  twoFactorEnrolledAt: timestamp("two_factor_enrolled_at"),
  phoneE164: text("phone_e164"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  accountType: accountTypeEnum("account_type").default("SIM"),
  provider: accountProviderEnum("provider").default("INTERNAL"),
  broker: text("broker"),
  brokerAccountId: text("broker_account_id"),
  brokerConnectionId: uuid("broker_connection_id"),
  currency: text("currency").default("USD"),
  initialBalance: real("initial_balance").default(10000),
  currentBalance: real("current_balance").default(10000),
  peakBalance: real("peak_balance"),
  armedLive: boolean("armed_live").default(false),
  isActive: boolean("is_active").default(true),
  riskTier: riskTierEnum("risk_tier").default("moderate"),
  riskProfile: jsonb("risk_profile").default({}),
  maxDailyLossPercent: real("max_daily_loss_percent"),
  maxDailyLossDollars: real("max_daily_loss_dollars"),
  maxDrawdown: real("max_drawdown"),
  maxContractsPerTrade: integer("max_contracts_per_trade"),
  maxContractsPerSymbol: integer("max_contracts_per_symbol"),
  maxTotalExposureContracts: integer("max_total_exposure_contracts"),
  riskPercentPerTrade: real("risk_percent_per_trade"),
  maxRiskDollarsPerTrade: real("max_risk_dollars_per_trade"),
  sourceType: text("source_type").default("MANUAL"),
  verificationState: text("verification_state"),
  lastVerifiedAt: timestamp("last_verified_at"),
  dataFeedModeOverride: dataFeedModeEnum("data_feed_mode_override"),
  allowSharedBots: boolean("allow_shared_bots").default(true),
  // Metrics mode: ISOLATED = separate P&L per bot, POOLED = combined balance pool
  metricsMode: text("metrics_mode").default("ISOLATED"),
  // Auto-flatten: force exit all positions before session close
  autoFlattenBeforeClose: boolean("auto_flatten_before_close").default(true),
  flattenMinutesBeforeClose: integer("flatten_minutes_before_close").default(15),
  // Account attempt tracking for blown account recovery
  currentAttemptNumber: integer("current_attempt_number").default(1),
  consecutiveBlownCount: integer("consecutive_blown_count").default(0),
  totalBlownCount: integer("total_blown_count").default(0),
  lastBlownAt: timestamp("last_blown_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const healthStateEnum = pgEnum("health_state", ["OK", "WARN", "DEGRADED"]);

// Account attempt status for tracking blown accounts
export const accountAttemptStatusEnum = pgEnum("account_attempt_status", [
  "ACTIVE",      // Currently trading
  "BLOWN",       // Hit $0 or below threshold
  "RETIRED",     // Manually closed/archived
  "GRADUATED"    // Bot promoted to next stage
]);

// Track account "attempts" - each time an account blows, snapshot and reset
export const accountAttempts = pgTable("account_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull().default(1),
  status: accountAttemptStatusEnum("status").default("ACTIVE"),
  
  // Balance tracking
  startingBalance: real("starting_balance").notNull(),
  endingBalance: real("ending_balance"),
  peakBalance: real("peak_balance"),
  lowestBalance: real("lowest_balance"),
  
  // Blow-up details
  blownAt: timestamp("blown_at"),
  blownReason: text("blown_reason"),           // AI analysis of why
  blownReasonCode: text("blown_reason_code"),  // "SINGLE_BAD_TRADE", "CONSISTENT_LOSSES", "BLACK_SWAN"
  
  // Bot state at time of blow
  botGenerationAtBlow: integer("bot_generation_at_blow"),
  botStageAtBlow: text("bot_stage_at_blow"),
  
  // Performance metrics snapshot at blow
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  losingTrades: integer("losing_trades").default(0),
  totalPnl: real("total_pnl").default(0),
  largestWin: real("largest_win"),
  largestLoss: real("largest_loss"),
  metricsSnapshot: jsonb("metrics_snapshot"),  // Full metrics at blow time
  
  // AI decision after blow
  aiRecommendation: text("ai_recommendation"),  // "CONTINUE_PAPER", "DEMOTE_TO_LAB", "RETIRE"
  aiAnalysis: jsonb("ai_analysis"),            // Full AI reasoning
  
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bots = pgTable("bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  symbol: text("symbol").default("MES"),
  status: botStatusEnum("status").default("idle"),
  mode: botModeEnum("mode").default("BACKTEST_ONLY"),
  evolutionStatus: evolutionStatusEnum("evolution_status").default("untested"),
  evolutionMode: evolutionModeEnum("evolution_mode").default("auto"),
  stage: text("stage").default("TRIALS"),
  currentGenerationId: uuid("current_generation_id"),
  archetypeId: uuid("archetype_id"),
  strategyConfig: jsonb("strategy_config").default({}),
  riskConfig: jsonb("risk_config").default({}),
  healthScore: real("health_score").default(100),
  healthJson: jsonb("health_json").default({}),
  priorityScore: real("priority_score").default(0),
  isCandidate: boolean("is_candidate").default(false),
  candidateScore: real("candidate_score"),
  candidateReasons: jsonb("candidate_reasons"),
  lastBacktestAt: timestamp("last_backtest_at"),
  lastEvolutionAt: timestamp("last_evolution_at"),
  lastSignalAt: timestamp("last_signal_at"),
  lastTradeAt: timestamp("last_trade_at"),
  livePnl: real("live_pnl").default(0),
  liveTotalTrades: integer("live_total_trades").default(0),
  liveWinRate: real("live_win_rate").default(0),
  simPnl: real("sim_pnl").default(0),
  simTotalTrades: integer("sim_total_trades").default(0),
  blockerCode: text("blocker_code"),
  blockerDetails: jsonb("blocker_details"),
  killReason: text("kill_reason"),
  killedAt: timestamp("killed_at"),
  archivedAt: timestamp("archived_at"),
  isTradingEnabled: boolean("is_trading_enabled").default(true),
  defaultAccountId: uuid("default_account_id").references(() => accounts.id),
  capitalAllocated: real("capital_allocated").default(0),
  healthState: healthStateEnum("health_state").default("OK"),
  healthReasonCode: text("health_reason_code"),
  healthReasonDetail: text("health_reason_detail"),
  healthDegradedSince: timestamp("health_degraded_since"),
  stageUpdatedAt: timestamp("stage_updated_at"),
  stageReasonCode: text("stage_reason_code"),
  stageLockedUntil: timestamp("stage_locked_until"),
  stageLockReason: text("stage_lock_reason"),
  promotionMode: text("promotion_mode").default("AUTO"),
  // Metrics reset fields for institutional P&L baseline
  metricsResetAt: timestamp("metrics_reset_at"),
  metricsResetReasonCode: text("metrics_reset_reason_code"),
  metricsResetBy: text("metrics_reset_by"),
  metricsResetScope: text("metrics_reset_scope").default("ALL"),
  // Generation tracking (backend truth)
  currentGeneration: integer("current_generation").default(1).notNull(),
  generationUpdatedAt: timestamp("generation_updated_at").defaultNow(),
  generationReasonCode: text("generation_reason_code"),
  // Session configuration (SEV-1: explicit, auditable session windows)
  sessionMode: sessionModeEnum("session_mode").default("FULL_24x5"),
  sessionTimezone: text("session_timezone").default("America/New_York"),
  sessionStart: text("session_start"), // HH:MM format, only for CUSTOM mode
  sessionEnd: text("session_end"), // HH:MM format, only for CUSTOM mode
  // Matrix testing aggregate data (promoted from matrix_runs)
  matrixAggregate: jsonb("matrix_aggregate"),
  matrixBestCell: jsonb("matrix_best_cell"),
  matrixWorstCell: jsonb("matrix_worst_cell"),
  matrixUpdatedAt: timestamp("matrix_updated_at"),
  // AI Provenance Tracking (Grok integration)
  createdByAi: text("created_by_ai"),           // e.g., "Grok xAI", "Perplexity"
  aiProvider: aiProviderEnum("ai_provider"),    // GROK, PERPLEXITY, etc.
  aiProviderBadge: boolean("ai_provider_badge").default(false), // Display badge in UI
  sourceCandidateId: uuid("source_candidate_id"), // Link to originating strategy candidate
  // AI Research Provenance (sources and reasoning transparency)
  aiResearchSources: jsonb("ai_research_sources"),  // Array of sources: [{type, label, detail}]
  aiReasoning: text("ai_reasoning"),               // Plain-language explanation of why this strategy
  aiResearchDepth: text("ai_research_depth"),      // CONTRARIAN_SCAN, SENTIMENT_BURST, DEEP_REASONING
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Junction table for multi-account trading per bot
export const botAccounts = pgTable("bot_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").default(false),
  allocationPercent: real("allocation_percent").default(100),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botStageEvents = pgTable("bot_stage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  fromStage: text("from_stage"),
  toStage: text("to_stage").notNull(),
  reasonCode: text("reason_code").notNull(),
  actor: text("actor").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botGenerations = pgTable("bot_generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationNumber: integer("generation_number").default(1).notNull(),
  parentGenerationNumber: integer("parent_generation_number"),
  parentGenerationId: uuid("parent_generation_id"),
  createdByJobId: uuid("created_by_job_id"),
  mutationReasonCode: text("mutation_reason_code"),
  summaryTitle: text("summary_title"),
  summaryDiff: jsonb("summary_diff"),
  strategyConfig: jsonb("strategy_config").default({}).notNull(),
  riskConfig: jsonb("risk_config").default({}),
  humanRulesMd: text("human_rules_md"),
  mutationsSummary: jsonb("mutations_summary"),
  fitnessScore: real("fitness_score"),
  fitnessDetails: jsonb("fitness_details"),
  performanceSnapshot: jsonb("performance_snapshot"),
  // INSTITUTIONAL: Parent's pre-evolution snapshot for audit trail (only set on evolved generations)
  parentSnapshot: jsonb("parent_snapshot"),
  // Stage tracking - records which stage the bot was in when this generation was created
  stage: text("stage").default("TRIALS"),
  // Timeframe tracking - records the active timeframe when this generation was created (e.g., "1m", "5m", "15m")
  timeframe: text("timeframe"),
  // Institutional rules versioning (SEV-0 requirement)
  beforeRulesHash: text("before_rules_hash"),
  afterRulesHash: text("after_rules_hash"),
  rulesDiffSummary: text("rules_diff_summary"),
  mutationObjective: text("mutation_objective"),
  performanceDeltas: jsonb("performance_deltas"),
  // TRIALS Baseline Tracking (SEV-1 institutional requirement)
  baselineValid: boolean("baseline_valid"), // True if generation has valid baseline with sufficient trades
  baselineFailureReason: text("baseline_failure_reason"), // NO_TRADES | INSUFFICIENT_DATA | STRATEGY_MISMATCH | TIMEOUT
  baselineBacktestId: uuid("baseline_backtest_id"), // Reference to the baseline backtest session
  baselineMetrics: jsonb("baseline_metrics"), // Snapshot of baseline metrics for comparison
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const backtestSessions = pgTable("backtest_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  status: text("status").default("pending"),
  symbol: text("symbol"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  initialCapital: real("initial_capital"),
  finalCapital: real("final_capital"),
  netPnl: real("net_pnl"),
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  losingTrades: integer("losing_trades").default(0),
  winRate: real("win_rate"),
  profitFactor: real("profit_factor"),
  sharpeRatio: real("sharpe_ratio"),
  maxDrawdown: real("max_drawdown"),
  maxDrawdownPct: real("max_drawdown_pct"),
  avgWin: real("avg_win"),
  avgLoss: real("avg_loss"),
  expectancy: real("expectancy"),
  recoveryFactor: real("recovery_factor"),
  tradesJson: jsonb("trades_json"),
  metricsJson: jsonb("metrics_json"),
  configSnapshot: jsonb("config_snapshot"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  // Institutional data provenance (SEV-0 requirement)
  dataSource: text("data_source"), // DATABENTO_REAL | SIMULATED_FALLBACK
  dataProvider: text("data_provider"), // DATABENTO
  dataSchema: text("data_schema"), // ohlcv-1m, etc.
  dataStartTs: timestamp("data_start_ts"),
  dataEndTs: timestamp("data_end_ts"),
  barCount: integer("bar_count"),
  rawRequestId: text("raw_request_id"), // Reproducible query fingerprint
  rulesHash: text("rules_hash"), // Strategy rules hash used for this session
  // Strategy provenance / attestation (SEV-0 institutional requirement)
  expectedEntryCondition: text("expected_entry_condition"), // From canonical mapping
  actualEntryCondition: text("actual_entry_condition"), // What executor actually used
  rulesSummary: text("rules_summary"), // Human readable rules summary
  provenanceStatus: text("provenance_status"), // VERIFIED | MISMATCH | ERROR
  // Session provenance (SEV-1: explicit, auditable session filtering)
  stage: text("stage"), // TRIALS | PAPER | SHADOW | CANARY | LIVE
  sessionModeUsed: sessionModeEnum("session_mode_used"),
  sessionTimezoneUsed: text("session_timezone_used"),
  sessionStartUsed: text("session_start_used"), // HH:MM format
  sessionEndUsed: text("session_end_used"), // HH:MM format
  totalBarCount: integer("total_bar_count"), // Bars before session filtering
  sessionFilterBarCount: integer("session_filter_bar_count"), // Bars after session filtering
  rulesProfileUsed: rulesProfileEnum("rules_profile_used"), // PRODUCTION | LAB_RELAXED
  relaxedFlagsApplied: jsonb("relaxed_flags_applied"), // Array of relaxation flags
  // Walk-Forward Optimization fields (Institutional Enhancement)
  walkForwardRunId: uuid("walk_forward_run_id"), // Parent walk-forward run
  segmentType: segmentTypeEnum("segment_type").default("FULL_RANGE"), // TRAINING | TESTING | VALIDATION | STRESS_TEST | FULL_RANGE
  segmentIndex: integer("segment_index"), // 0, 1, 2... for ordered segments
  segmentStart: timestamp("segment_start"), // Segment start date
  segmentEnd: timestamp("segment_end"), // Segment end date
  // Market Regime Detection
  regimeLabel: marketRegimeEnum("regime_label"), // BULL | BEAR | SIDEWAYS | etc.
  regimeConfidence: real("regime_confidence"), // 0.0 - 1.0 confidence score
  regimeMetrics: jsonb("regime_metrics"), // volatility, trend strength, etc.
  // Stress Test Reference
  stressTestPresetId: uuid("stress_test_preset_id"), // Reference to stress test preset
  // INSTITUTIONAL: Random seed for reproducible backtests (SEV-1 requirement)
  randomSeed: bigint("random_seed", { mode: "number" }), // Persisted seed for deterministic replay (BIGINT for values > 2^31)
  createdAt: timestamp("created_at").defaultNow(),
});

// Walk-Forward Runs - Parent container for walk-forward optimization sequences
export const walkForwardRuns = pgTable("walk_forward_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  status: walkForwardStatusEnum("status").default("PENDING"),
  // Configuration
  totalSegments: integer("total_segments").default(4), // Number of train/test cycles
  trainingWindowDays: integer("training_window_days").default(365), // 1 year training
  testingWindowDays: integer("testing_window_days").default(90), // 3 month testing
  validationWindowDays: integer("validation_window_days").default(90), // 3 month holdout
  stepForwardDays: integer("step_forward_days").default(90), // How far to slide window
  fullRangeStart: timestamp("full_range_start"), // Overall data range start
  fullRangeEnd: timestamp("full_range_end"), // Overall data range end
  // Aggregate Results
  trainingAvgSharpe: real("training_avg_sharpe"),
  testingAvgSharpe: real("testing_avg_sharpe"),
  validationSharpe: real("validation_sharpe"),
  consistencyScore: real("consistency_score"), // How consistent across segments
  overfitRatio: real("overfit_ratio"), // training vs testing performance ratio
  passedValidation: boolean("passed_validation").default(false),
  // Metadata
  completedSegments: integer("completed_segments").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Stress Test Presets - Curated historical stress scenarios
export const stressTestPresets = pgTable("stress_test_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "COVID Crash", "Fed Pivot 2022", etc.
  description: text("description"),
  eventType: text("event_type"), // FLASH_CRASH | SUSTAINED_CRISIS | POLICY_SHOCK | VOLATILITY_SPIKE
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  regimeLabel: marketRegimeEnum("regime_label"), // Expected regime during event
  severity: integer("severity").default(5), // 1-10 scale
  expectedBehavior: text("expected_behavior"), // What a robust strategy should do
  passThreshold: jsonb("pass_threshold"), // { maxDrawdownPct: 25, minWinRate: 30, ... }
  symbols: text("symbols").array(), // Which symbols this applies to
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Stress Test Results - Results of running bots against stress presets
export const stressTestResults = pgTable("stress_test_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  presetId: uuid("preset_id").notNull().references(() => stressTestPresets.id),
  backtestSessionId: uuid("backtest_session_id").references(() => backtestSessions.id),
  // Results
  passed: boolean("passed").default(false),
  netPnl: real("net_pnl"),
  maxDrawdownPct: real("max_drawdown_pct"),
  winRate: real("win_rate"),
  totalTrades: integer("total_trades"),
  sharpeRatio: real("sharpe_ratio"),
  // Analysis
  failureReasons: jsonb("failure_reasons"), // Why it failed if applicable
  performanceNotes: text("performance_notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobStatusEnum = pgEnum("job_status", [
  "CREATED", "QUEUED", "RUNNING", "DEGRADED", "BLOCKED", "COMPLETED", "FAILED", "CANCELED", "TIMEOUT"
]);

export const botJobs = pgTable("bot_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").references(() => bots.id),
  userId: uuid("user_id").references(() => users.id),
  jobType: text("job_type").notNull(),
  status: jobStatusEnum("status").default("CREATED"),
  statusReasonCode: text("status_reason_code"),
  statusReasonHuman: text("status_reason_human"),
  priority: integer("priority").default(0),
  payload: jsonb("payload"),
  result: jsonb("result"),
  errorMessage: text("error_message"),
  error: jsonb("error"),
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  scheduledFor: timestamp("scheduled_for"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  leaseOwner: text("lease_owner"), // Worker instance ID for autoscale deduplication
  leaseExpiresAt: timestamp("lease_expires_at"), // When lease expires if heartbeat missed
  traceId: uuid("trace_id").defaultRandom(),
  inputHash: text("input_hash"),
  dataSourcesUsed: jsonb("data_sources_used"),
  metrics: jsonb("metrics"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const jobRunEvents = pgTable("job_run_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => botJobs.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  reasonCode: text("reason_code"),
  reason: text("reason"),
  traceId: uuid("trace_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activityStateEnum = pgEnum("activity_state", ["IDLE", "SCANNING", "IN_TRADE", "EXITING", "STOPPED", "ERROR", "MAINTENANCE", "MARKET_CLOSED"]);
export const jobTypeEnum = pgEnum("job_type", ["RUNNER", "BACKTESTER", "EVOLVER", "RECONCILER"]);

export const botInstances = pgTable("bot_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  accountId: uuid("account_id").references(() => accounts.id),
  executionMode: text("execution_mode").default("SIM"),
  status: text("status").default("idle"),
  isActive: boolean("is_active").default(true),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  stateJson: jsonb("state_json"),
  jobType: jobTypeEnum("job_type").default("RUNNER"),
  activityState: activityStateEnum("activity_state").default("IDLE"),
  isPrimaryRunner: boolean("is_primary_runner").default(false),
  startedAt: timestamp("started_at"),
  stoppedAt: timestamp("stopped_at"),
  currentPosition: integer("current_position").default(0),
  unrealizedPnl: real("unrealized_pnl").default(0),
  entryPrice: real("entry_price"),
  positionSide: text("position_side"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("bot_instances_single_primary_runner_idx")
    .on(table.botId)
    .where(sql`${table.isPrimaryRunner} = true AND ${table.jobType} = 'RUNNER'`)
]);

export const tradeLogs = pgTable("trade_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  botInstanceId: uuid("bot_instance_id").references(() => botInstances.id),
  botId: uuid("bot_id").references(() => bots.id),
  backtestSessionId: uuid("backtest_session_id").references(() => backtestSessions.id),
  symbol: text("symbol"),
  side: orderSideEnum("side"),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  quantity: integer("quantity").default(1),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  entryTime: timestamp("entry_time"),
  exitTime: timestamp("exit_time"),
  isOpen: boolean("is_open").default(true),
  isInvalid: boolean("is_invalid").default(false),
  sourceType: text("source_type"),
  entryReason: text("entry_reason"),
  exitReason: text("exit_reason"),
  entryReasonCode: text("entry_reason_code"), // Canonical code: ENTRY_GAP_FADE, ENTRY_RANGE_SCALP, etc.
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  category: alertCategoryEnum("category").notNull(),
  severity: alertSeverityEnum("severity").default("INFO"),
  status: alertStatusEnum("status").default("OPEN"),
  source: alertSourceEnum("source").default("system"),
  entityType: alertEntityTypeEnum("entity_type").notNull(),
  entityId: uuid("entity_id"),
  title: text("title").notNull(),
  message: text("message"),
  payloadJson: jsonb("payload_json"),
  actionHintsJson: jsonb("action_hints_json"),
  dedupeKey: text("dedupe_key"),
  snoozedUntil: timestamp("snoozed_until"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  providerType: providerTypeEnum("provider_type"),
  status: providerStatusEnum("status").default("disconnected"),
  configJson: jsonb("config_json"),
  credentialsJson: jsonb("credentials_json"),
  lastProbeAt: timestamp("last_probe_at"),
  lastProbeStatus: text("last_probe_status"),
  lastProbeError: text("last_probe_error"),
  lastProbeLatencyMs: integer("last_probe_latency_ms"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const strategyArchetypes = pgTable("strategy_archetypes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  isActive: boolean("is_active").default(true),
  isUserDefined: boolean("is_user_defined").default(false),
  userId: uuid("user_id").references(() => users.id),
  sourceCandidateId: uuid("source_candidate_id"),
  configSchemaJson: jsonb("config_schema_json"),
  defaultConfigJson: jsonb("default_config_json"),
  testSuiteJson: jsonb("test_suite_json"),
  rulesJson: jsonb("rules_json"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const candidateDispositionEnum = pgEnum("candidate_disposition", [
  "PENDING_REVIEW",
  "QUEUED_FOR_QC",
  "SENT_TO_LAB",
  "QUEUED",
  "READY",  // Ready for promotion after QC bypass
  "REJECTED",
  "MERGED",
  "EXPIRED",
  "RECYCLED"
]);

export const rejectionReasonEnum = pgEnum("rejection_reason", [
  "TOO_RISKY",
  "UNCLEAR_EDGE",
  "POOR_TIMING",
  "DUPLICATE_STRATEGY",
  "LOW_CONFIDENCE",
  "NOT_NOVEL",
  "BAD_MARKET_FIT",
  "OTHER"
]);

export const noveltyTierEnum = pgEnum("novelty_tier", [
  "LOW",
  "MODERATE",
  "HIGH",
  "BREAKTHROUGH"
]);

export const candidateSourceEnum = pgEnum("candidate_source", [
  "SCHEDULED_RESEARCH",
  "BURST_RESEARCH",
  "LAB_FEEDBACK",
  "REGIME_SHIFT",
  "MANUAL",
  "EXTERNAL_AI",
  "GROK_RESEARCH"
]);

export const sourceTierEnum = pgEnum("source_tier", [
  "PRIMARY",
  "SECONDARY",
  "TERTIARY"
]);

export const regimeTriggerEnum = pgEnum("regime_trigger", [
  "VOLATILITY_SPIKE",
  "VOLATILITY_COMPRESSION",
  "TRENDING_STRONG",
  "RANGE_BOUND",
  "LIQUIDITY_THIN",
  "NEWS_SHOCK",
  "MACRO_EVENT_CLUSTER",
  "NONE"
]);

export const researchDepthEnum = pgEnum("research_depth", [
  "QUICK",
  "BALANCED", 
  "DEEP"
]);

export const searchRecencyEnum = pgEnum("search_recency", [
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "YEAR"
]);

// QuantConnect Verification Enums
export const qcRunStatusEnum = pgEnum("qc_run_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED"
]);

export const qcBadgeStateEnum = pgEnum("qc_badge_state", [
  "VERIFIED",
  "DIVERGENT",
  "INCONCLUSIVE",
  "FAILED",
  "QC_BYPASSED"  // Admin bypass state - not verified but allowed through
]);

export const strategyCandidates = pgTable("strategy_candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategyName: text("strategy_name").notNull(),
  archetypeId: uuid("archetype_id").references(() => strategyArchetypes.id),
  archetypeName: text("archetype_name"),
  entryConditionType: text("entry_condition_type"),
  instrumentUniverse: text("instrument_universe").array(),
  timeframePreferences: text("timeframe_preferences").array(),
  sessionModePreference: text("session_mode_preference"),
  hypothesis: text("hypothesis").notNull(),
  rulesJson: jsonb("rules_json").notNull(),
  noveltyJustificationJson: jsonb("novelty_justification_json"),
  dataRequirementsJson: jsonb("data_requirements_json"),
  evidenceJson: jsonb("evidence_json"),
  confidenceScore: integer("confidence_score").default(0),
  adjustedScore: integer("adjusted_score"),  // Regime-adjusted score for promotion decisions
  regimeBonus: integer("regime_bonus"),      // Bonus/penalty applied based on regime + archetype
  confidenceBreakdownJson: jsonb("confidence_breakdown_json"),
  explainersJson: jsonb("explainers_json"),
  disposition: candidateDispositionEnum("disposition").default("PENDING_REVIEW"),
  source: candidateSourceEnum("source").default("SCHEDULED_RESEARCH"),
  regimeTrigger: regimeTriggerEnum("regime_trigger").default("NONE"),
  regimeSnapshotJson: jsonb("regime_snapshot_json"),
  rulesHash: text("rules_hash"),
  sourceLabBotId: uuid("source_lab_bot_id").references(() => bots.id),
  sourceLabFailureJson: jsonb("source_lab_failure_json"),
  createdBotId: uuid("created_bot_id").references(() => bots.id),
  lineageChain: text("lineage_chain").array(),
  researchCycleId: uuid("research_cycle_id"),
  perplexityTraceId: text("perplexity_trace_id"),
  
  // Rejection workflow fields
  rejectionReason: rejectionReasonEnum("rejection_reason"),
  rejectionNotes: text("rejection_notes"),
  rejectedAt: timestamp("rejected_at"),
  recycledFromId: uuid("recycled_from_id"),
  
  // Novelty assessment fields
  noveltyScore: integer("novelty_score"),
  noveltyTier: noveltyTierEnum("novelty_tier"),
  noveltyDifferentiators: jsonb("novelty_differentiators"),
  
  // Plain-language summary fields (What/How/When format)
  plainLanguageSummaryJson: jsonb("plain_language_summary_json"),
  
  // Deduplication tracking
  mergeCount: integer("merge_count").default(0),
  
  // Research settings tracking
  researchDepth: researchDepthEnum("research_depth").default("BALANCED"),
  searchRecency: searchRecencyEnum("search_recency").default("MONTH"),
  customFocusUsed: text("custom_focus_used"),
  isFavorite: boolean("is_favorite").default(false),
  
  // AI Provenance Tracking (Grok integration)
  createdByAi: text("created_by_ai"),           // e.g., "Grok xAI", "Perplexity"
  aiProvider: aiProviderEnum("ai_provider"),    // GROK, PERPLEXITY, etc.
  // AI Research Provenance (sources and reasoning transparency)
  aiResearchSources: jsonb("ai_research_sources"),  // Array of sources: [{type, label, detail}]
  aiReasoning: text("ai_reasoning"),               // Plain-language explanation of why this strategy
  aiResearchDepth: text("ai_research_depth"),      // CONTRARIAN_SCAN, SENTIMENT_BURST, DEEP_REASONING
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  disposedAt: timestamp("disposed_at"),
});

export const insertStrategyCandidateSchema = createInsertSchema(strategyCandidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  disposedAt: true,
  rejectedAt: true,
});

export type InsertStrategyCandidate = z.infer<typeof insertStrategyCandidateSchema>;
export type StrategyCandidate = typeof strategyCandidates.$inferSelect;

export const labFeedbackStateEnum = pgEnum("lab_feedback_state", [
  "IDLE",
  "FAILURE_DETECTED",
  "RESEARCHING_REPLACEMENT",
  "RESEARCHING_REPAIR",
  "CANDIDATE_FOUND",
  "CANDIDATE_TESTING",
  "RESOLVED",
  "ABANDONED"
]);

export const labFeedbackTracking = pgTable("lab_feedback_tracking", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceLabBotId: uuid("source_lab_bot_id").notNull().references(() => bots.id),
  failureReasonCodes: text("failure_reason_codes").array().notNull(),
  failureMetricsJson: jsonb("failure_metrics_json"),
  regimeAtFailure: text("regime_at_failure"),
  state: labFeedbackStateEnum("state").default("FAILURE_DETECTED"),
  researchCycleId: uuid("research_cycle_id"),
  candidateIds: uuid("candidate_ids").array().default([]),
  bestCandidateId: uuid("best_candidate_id").references(() => strategyCandidates.id),
  replacementBotId: uuid("replacement_bot_id").references(() => bots.id),
  resolutionCode: text("resolution_code"),
  resolutionNotes: text("resolution_notes"),
  traceId: text("trace_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertLabFeedbackTrackingSchema = createInsertSchema(labFeedbackTracking).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type InsertLabFeedbackTracking = z.infer<typeof insertLabFeedbackTrackingSchema>;
export type LabFeedbackTracking = typeof labFeedbackTracking.$inferSelect;

// QuantConnect Verification Tables
export const qcVerifications = pgTable("qc_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull().references(() => strategyCandidates.id),
  botId: uuid("bot_id").references(() => bots.id),
  snapshotHash: text("snapshot_hash").notNull(),
  tierAtRun: text("tier_at_run"),
  confidenceAtRun: integer("confidence_at_run"),
  status: qcRunStatusEnum("status").default("QUEUED"),
  badgeState: qcBadgeStateEnum("badge_state"),
  qcScore: real("qc_score"),
  qcProjectId: text("qc_project_id"),
  qcBacktestId: text("qc_backtest_id"),
  metricsSummaryJson: jsonb("metrics_summary_json"),
  assumptionsJson: jsonb("assumptions_json"),
  divergenceDetailsJson: jsonb("divergence_details_json"),
  errorMessage: text("error_message"),
  traceId: text("trace_id"),
  // Progress tracking for UI display
  progressPct: integer("progress_pct").default(0),
  // Attempt tracking for autonomous retry system
  attemptCount: integer("attempt_count").default(1),
  maxAttempts: integer("max_attempts").default(3),
  lastRetryAt: timestamp("last_retry_at"),
  retryReason: text("retry_reason"),
  queuedAt: timestamp("queued_at").defaultNow(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

export const insertQcVerificationSchema = createInsertSchema(qcVerifications).omit({
  id: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
});

export type InsertQcVerification = z.infer<typeof insertQcVerificationSchema>;
export type QcVerification = typeof qcVerifications.$inferSelect;

export const qcBudget = pgTable("qc_budget", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodType: text("period_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  runsUsed: integer("runs_used").default(0),
  runsLimit: integer("runs_limit").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertQcBudgetSchema = createInsertSchema(qcBudget).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertQcBudget = z.infer<typeof insertQcBudgetSchema>;
export type QcBudget = typeof qcBudget.$inferSelect;

export const systemEvents = pgTable("system_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  title: text("title"),
  message: text("message"),
  severity: eventSeverityEnum("severity").default("info"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const killEventTypeEnum = pgEnum("kill_event_type", ["KILL", "RESURRECT"]);

export const killEvents = pgTable("kill_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  eventType: killEventTypeEnum("event_type").notNull(),
  actor: text("actor").notNull(),
  reasonCode: text("reason_code").notNull(),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const instruments = pgTable("instruments", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().unique(),
  name: text("name").notNull(),
  exchange: text("exchange").notNull(),
  tickSize: real("tick_size").notNull(),
  pointValue: real("point_value").notNull(),
  currency: text("currency").default("USD"),
  minQty: integer("min_qty").default(1),
  maxQty: integer("max_qty").default(100),
  session: text("session"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const brokerAccountEventTypeEnum = pgEnum("broker_account_event_type", ["LINK", "UNLINK", "UPDATE", "VERIFY"]);

export const brokerAccountEvents = pgTable("broker_account_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  eventType: brokerAccountEventTypeEnum("event_type").notNull(),
  actor: text("actor").notNull(),
  metadata: jsonb("metadata"),
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditReports = pgTable("audit_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  suiteType: text("suite_type"),
  status: text("status"),
  checksJson: jsonb("checks_json"),
  summaryJson: jsonb("summary_json"),
  performanceJson: jsonb("performance_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const economicEvents = pgTable("economic_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull().default("FMP"),
  eventName: text("event_name").notNull(),
  eventType: text("event_type"),
  country: text("country"),
  currency: text("currency"),
  impactLevel: text("impact_level"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  actual: real("actual"),
  forecast: real("forecast"),
  previous: real("previous"),
  unit: text("unit"),
  change: real("change"),
  changePercent: real("change_percent"),
  rawJson: jsonb("raw_json"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}); // Unique index on (source, event_name, scheduled_at) for idempotent upserts

export const autonomyLoops = pgTable("autonomy_loops", {
  id: uuid("id").primaryKey().defaultRandom(),
  loopName: text("loop_name").notNull().unique(),
  lastRunAt: timestamp("last_run_at"),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastError: text("last_error"),
  runCount: integer("run_count").default(0),
  successCount: integer("success_count").default(0),
  errorCount: integer("error_count").default(0),
  avgDurationMs: integer("avg_duration_ms"),
  isHealthy: boolean("is_healthy").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const autonomyPlannerRuns = pgTable("autonomy_planner_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  traceId: uuid("trace_id").defaultRandom(),
  startedAt: timestamp("started_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
  botsEvaluated: integer("bots_evaluated").default(0),
  jobsEnqueued: integer("jobs_enqueued").default(0),
  blocked: integer("blocked").default(0),
  summaryJson: jsonb("summary_json"),
  reasonsTopJson: jsonb("reasons_top_json"),
  errorJson: jsonb("error_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const autonomyBotDecisions = pgTable("autonomy_bot_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => autonomyPlannerRuns.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  decision: text("decision").notNull(),
  reasonCode: text("reason_code"),
  blockersJson: jsonb("blockers_json"),
  jobEnqueued: text("job_enqueued"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id).unique(),
  general: jsonb("general").default({}),
  appearance: jsonb("appearance").default({}),
  brokers: jsonb("brokers").default({}),
  dataProviders: jsonb("data_providers").default({}),
  riskDefaults: jsonb("risk_defaults").default({}),
  promotionRules: jsonb("promotion_rules").default({}),
  arbiterSettings: jsonb("arbiter_settings").default({}),
  labs: jsonb("labs").default({}),
  notifications: jsonb("notifications").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const evaluationRuns = pgTable("evaluation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  status: text("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  botsEvaluated: integer("bots_evaluated"),
  botsPromoted: integer("bots_promoted"),
  botsDemoted: integer("bots_demoted"),
  errorMessage: text("error_message"),
  resultsJson: jsonb("results_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botStageChanges = pgTable("bot_stage_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  decision: text("decision").notNull(),
  reasonsJson: jsonb("reasons_json"),
  triggeredBy: text("triggered_by").notNull().default("system"),
  evaluationRunId: uuid("evaluation_run_id").references(() => evaluationRuns.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const schedulerState = pgTable("scheduler_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  schedulerType: text("scheduler_type").notNull(),
  enabled: boolean("enabled").default(true),
  frequencyMinutes: integer("frequency_minutes").default(60),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  runningJobs: integer("running_jobs").default(0),
  queueDepth: integer("queue_depth").default(0),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const userSecurity = pgTable("user_security", {
  userId: uuid("user_id").primaryKey().notNull().references(() => users.id),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  last2faAt: timestamp("last_2fa_at"),
  failed2faAttempts: integer("failed_2fa_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  totpSecret: text("totp_secret"),
  backupCodes: jsonb("backup_codes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tempTokenPurposeEnum = pgEnum("temp_token_purpose", ["2FA_LOGIN", "PASSWORD_RESET", "EMAIL_VERIFY"]);

export const authTempTokens = pgTable("auth_temp_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  purpose: tempTokenPurposeEnum("purpose").notNull().default("2FA_LOGIN"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
});

export const readinessRuns = pgTable("readiness_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  score: integer("score").notNull().default(0),
  runnerScore: integer("runner_score"),
  jobQueueScore: integer("job_queue_score"),
  dataIntegrityScore: integer("data_integrity_score"),
  evolutionScore: integer("evolution_score"),
  promotionScore: integer("promotion_score"),
  uiConsistencyScore: integer("ui_consistency_score"),
  securityScore: integer("security_score"),
  metricsJson: jsonb("metrics_json"),
  failuresJson: jsonb("failures_json"),
  recommendedActions: jsonb("recommended_actions"),
  runType: text("run_type").default("manual"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const usageEventStatusEnum = pgEnum("usage_event_status", ["OK", "ERROR", "BLOCKED", "TIMEOUT"]);

export const integrationUsageEvents = pgTable("integration_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  botId: uuid("bot_id").references(() => bots.id),
  runId: uuid("run_id"),
  integrationId: uuid("integration_id").references(() => integrations.id),
  integration: text("integration").notNull(),
  operation: text("operation").notNull(),
  status: usageEventStatusEnum("status").notNull().default("OK"),
  latencyMs: integer("latency_ms"),
  symbol: text("symbol"),
  timeframe: text("timeframe"),
  records: integer("records"),
  reasonCode: text("reason_code"),
  traceId: text("trace_id"), // Changed from uuid to text to allow non-UUID trace IDs like "cache-xxx"
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

// LLM Usage Tracking - Tracks every AI/LLM API call for cost attribution per bot
export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").references(() => bots.id),
  userId: uuid("user_id").references(() => users.id),
  provider: text("provider").notNull(), // groq, openai, anthropic, gemini, xai, openrouter, perplexity
  model: text("model").notNull(), // llama-3.3-70b-versatile, gpt-4o-mini, etc
  operation: text("operation").notNull(), // evolution, signal_analysis, research, strategy_gen
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0), // Calculated cost in USD
  latencyMs: integer("latency_ms"),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
  traceId: text("trace_id"),
  sessionId: uuid("session_id"), // Optional backtest/evolution session reference
  metadata: jsonb("metadata").default({}), // Additional context (temperature, purpose, etc)
  createdAt: timestamp("created_at").defaultNow(),
});

// ML Models - Trained gradient boosting and RL models for alpha generation
export const mlModels = pgTable("ml_models", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  modelType: text("model_type").notNull(), // GRADIENT_BOOSTING, DQN, PPO
  version: integer("version").notNull().default(1),
  trainAccuracy: real("train_accuracy").notNull(),
  testAccuracy: real("test_accuracy").notNull(),
  trainPrecision: real("train_precision"),
  testPrecision: real("test_precision"),
  trainRecall: real("train_recall"),
  testRecall: real("test_recall"),
  trainF1: real("train_f1"),
  testF1: real("test_f1"),
  trainAuc: real("train_auc"),
  testAuc: real("test_auc"),
  featureImportance: text("feature_importance"), // JSON serialized
  isActive: boolean("is_active").notNull().default(false),
  modelData: text("model_data").notNull(), // JSON serialized model
  createdAt: timestamp("created_at").defaultNow(),
});

// RL Training Episodes - Tracks reinforcement learning training progress
export const rlTrainingEpisodes = pgTable("rl_training_episodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: text("model_id").references(() => mlModels.id),
  symbol: text("symbol").notNull(),
  episode: integer("episode").notNull(),
  totalReward: real("total_reward").notNull(),
  sharpeReward: real("sharpe_reward"),
  pnlReward: real("pnl_reward"),
  drawdownPenalty: real("drawdown_penalty"),
  actions: integer("actions").notNull(),
  avgQ: real("avg_q"),
  epsilon: real("epsilon"),
  loss: real("loss"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ML Predictions - Log of predictions made for audit and analysis
export const mlPredictions = pgTable("ml_predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  modelId: text("model_id").references(() => mlModels.id),
  botId: uuid("bot_id").references(() => bots.id),
  symbol: text("symbol").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  prediction: integer("prediction").notNull(), // 0 or 1 for direction
  probability: real("probability").notNull(),
  confidence: real("confidence").notNull(),
  actualOutcome: integer("actual_outcome"), // Filled in later
  wasCorrect: boolean("was_correct"),
  features: jsonb("features").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const decisionTraces = pgTable("decision_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  tradeLogId: uuid("trade_log_id").references(() => tradeLogs.id),
  runId: uuid("run_id"),
  decision: text("decision").notNull(),
  confidence: real("confidence"),
  variablesUsed: jsonb("variables_used").default([]),
  aiOutputs: jsonb("ai_outputs").default([]),
  riskChecks: jsonb("risk_checks").default([]),
  executionContext: jsonb("execution_context").default({}),
  rejectedAlternatives: jsonb("rejected_alternatives").default([]),
  finalReasoning: text("final_reasoning"),
  profitAttribution: jsonb("profit_attribution").default([]),
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const suppressionTypeEnum = pgEnum("suppression_type", ["RISK", "AI", "DATA", "RULE", "AUTONOMY_GATE", "EXECUTION"]);
export const suppressionDecisionEnum = pgEnum("suppression_decision", ["BLOCKED", "DEFERRED"]);

export const noTradeTraces = pgTable("no_trade_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  runId: uuid("run_id"),
  marketContextSnapshot: jsonb("market_context_snapshot").default({}),
  evaluatedSignals: jsonb("evaluated_signals").default([]),
  aiOutputs: jsonb("ai_outputs").default([]),
  suppressionReasons: jsonb("suppression_reasons").default([]),
  finalOutcome: text("final_outcome").notNull().default("NO_TRADE"),
  reEvaluationTime: timestamp("re_evaluation_time"),
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const autonomyTierEnum = pgEnum("autonomy_tier", ["LOCKED", "SUPERVISED", "SEMI_AUTONOMOUS", "FULL_AUTONOMY"]);

export const autonomyScores = pgTable("autonomy_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id).unique(),
  autonomyScore: real("autonomy_score").notNull().default(0),
  dataReliabilityScore: real("data_reliability_score").default(0),
  decisionQualityScore: real("decision_quality_score").default(0),
  riskDisciplineScore: real("risk_discipline_score").default(0),
  executionHealthScore: real("execution_health_score").default(0),
  supervisorTrustScore: real("supervisor_trust_score").default(0),
  breakdown: jsonb("breakdown").default({}),
  autonomyTier: autonomyTierEnum("autonomy_tier").default("LOCKED"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const variableStateEnum = pgEnum("variable_state", ["ACTIVE", "STALE", "BLOCKED"]);

// INSTITUTIONAL REQUIREMENT: Promotion Decision Audit Trail
// Every promotion/demotion decision must be logged with full gate values for compliance
export const promotionDecisionEnum = pgEnum("promotion_decision", ["PROMOTE", "DEMOTE", "HOLD", "BLOCKED"]);

export const promotionAuditTrail = pgTable("promotion_audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage"),
  decision: promotionDecisionEnum("decision").notNull(),
  traceId: uuid("trace_id"),
  
  // Gate values snapshot at decision time
  gatesSnapshot: jsonb("gates_snapshot").default({}), // { gate_name: { passed, actual, required } }
  passedGatesCount: integer("passed_gates_count").default(0),
  totalGatesCount: integer("total_gates_count").default(0),
  blockerCodes: text("blocker_codes").array(),
  
  // Metrics at decision time
  metricsSnapshot: jsonb("metrics_snapshot").default({}), // { totalTrades, winRate, pnl, sharpe, etc }
  autonomyScore: real("autonomy_score"),
  autonomyTier: text("autonomy_tier"),
  
  // Decision metadata
  decisionReason: text("decision_reason"),
  humanApprovalRequired: boolean("human_approval_required").default(false),
  humanApprovedBy: text("human_approved_by"),
  humanApprovedAt: timestamp("human_approved_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPromotionAuditTrailSchema = createInsertSchema(promotionAuditTrail).omit({ id: true, createdAt: true });
export type PromotionAuditTrail = typeof promotionAuditTrail.$inferSelect;
export type InsertPromotionAuditTrail = typeof promotionAuditTrail.$inferInsert;

export const profitVariables = pgTable("profit_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  sourceIntegration: text("source_integration"),
  variableType: text("variable_type").default("number"),
  state: variableStateEnum("state").default("ACTIVE"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  usedByBotIds: jsonb("used_by_bot_ids").default([]),
  profitContributionEstimate: real("profit_contribution_estimate"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Databento request logging for institutional proof (SEV-0 requirement)
export const databentoRequests = pgTable("databento_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  startTs: timestamp("start_ts").notNull(),
  endTs: timestamp("end_ts").notNull(),
  dataset: text("dataset").default("GLBX.MDP3"),
  schema: text("schema").default("ohlcv-1m"),
  barsReturned: integer("bars_returned"),
  latencyMs: integer("latency_ms"),
  httpStatus: integer("http_status"),
  success: boolean("success").default(false),
  errorMessage: text("error_message"),
  requestFingerprint: text("request_fingerprint"), // Unique identifier for reproducibility
  botId: uuid("bot_id").references(() => bots.id),
  sessionId: uuid("session_id").references(() => backtestSessions.id),
  traceId: text("trace_id"),
});

export const insertDatabentoRequestSchema = createInsertSchema(databentoRequests).omit({ id: true, createdAt: true });
export type DatabentoRequest = typeof databentoRequests.$inferSelect;
export type InsertDatabentoRequest = typeof databentoRequests.$inferInsert;

// SEV-0 INSTITUTIONAL: Integration request logging tables
// Each external call MUST write exactly one request log row with trace_id

export const macroRequests = pgTable("macro_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  stage: text("stage"),
  seriesIds: text("series_ids").array(),
  provider: text("provider").default("FRED"),
  endpoint: text("endpoint"),
  recordsReturned: integer("records_returned"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestFingerprint: text("request_fingerprint"),
});

export const insertMacroRequestSchema = createInsertSchema(macroRequests).omit({ id: true, createdAt: true });
export type MacroRequest = typeof macroRequests.$inferSelect;
export type InsertMacroRequest = typeof macroRequests.$inferInsert;

export const optionsFlowRequests = pgTable("options_flow_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  stage: text("stage"),
  symbol: text("symbol"),
  provider: text("provider").default("UNUSUAL_WHALES"),
  endpoint: text("endpoint"),
  recordsReturned: integer("records_returned"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestFingerprint: text("request_fingerprint"),
});

export const insertOptionsFlowRequestSchema = createInsertSchema(optionsFlowRequests).omit({ id: true, createdAt: true });
export type OptionsFlowRequest = typeof optionsFlowRequests.$inferSelect;
export type InsertOptionsFlowRequest = typeof optionsFlowRequests.$inferInsert;

export const newsRequests = pgTable("news_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  stage: text("stage"),
  symbol: text("symbol"),
  keywords: text("keywords"),
  provider: text("provider").notNull(), // FINNHUB, NEWSAPI, MARKETAUX
  endpoint: text("endpoint"),
  recordsReturned: integer("records_returned"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestFingerprint: text("request_fingerprint"),
});

export const insertNewsRequestSchema = createInsertSchema(newsRequests).omit({ id: true, createdAt: true });
export type NewsRequest = typeof newsRequests.$inferSelect;
export type InsertNewsRequest = typeof newsRequests.$inferInsert;

export const aiRequests = pgTable("ai_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  stage: text("stage"),
  provider: text("provider").notNull(), // GROQ, OPENAI, ANTHROPIC, GEMINI, XAI, OPENROUTER
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  purpose: text("purpose"), // EVOLUTION, STRATEGY_MUTATION, SIGNAL_ANALYSIS
  requestFingerprint: text("request_fingerprint"),
});

export const insertAiRequestSchema = createInsertSchema(aiRequests).omit({ id: true, createdAt: true });
export type AiRequest = typeof aiRequests.$inferSelect;
export type InsertAiRequest = typeof aiRequests.$inferInsert;

export const brokerRequests = pgTable("broker_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  accountId: uuid("account_id").references(() => accounts.id),
  stage: text("stage"),
  broker: text("broker").notNull(), // IRONBEAM, TRADOVATE, INTERNAL
  action: text("action").notNull(), // CONNECT, PLACE_ORDER, CANCEL_ORDER, GET_POSITIONS
  symbol: text("symbol"),
  qty: integer("qty"),
  orderType: text("order_type"),
  latencyMs: integer("latency_ms"),
  success: boolean("success").default(false),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  orderId: text("order_id"),
  fillId: text("fill_id"),
  requestFingerprint: text("request_fingerprint"),
});

export const insertBrokerRequestSchema = createInsertSchema(brokerRequests).omit({ id: true, createdAt: true });
export type BrokerRequest = typeof brokerRequests.$inferSelect;
export type InsertBrokerRequest = typeof brokerRequests.$inferInsert;

// Stage policies for fail-closed enforcement
export const stagePolicies = pgTable("stage_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  stage: text("stage").notNull().unique(), // TRIALS, PAPER, SHADOW, CANARY, LIVE
  marketDataRequired: boolean("market_data_required").default(true),
  brokerRequired: boolean("broker_required").default(false),
  macroRequired: boolean("macro_required").default(false),
  optionsFlowRequired: boolean("options_flow_required").default(false),
  newsRequired: boolean("news_required").default(false),
  aiAllowed: boolean("ai_allowed").default(true),
  marketDataFallback: text("market_data_fallback").default("none"), // none, sim, alt_provider
  maxLatencyMs: jsonb("max_latency_ms").default({}), // per source
  cooldowns: jsonb("cooldowns").default({}),
  retryLimits: jsonb("retry_limits").default({}),
  jobCadenceMinutes: integer("job_cadence_minutes").default(30),
  failClosedMode: boolean("fail_closed_mode").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertStagePolicySchema = createInsertSchema(stagePolicies).omit({ id: true, createdAt: true, updatedAt: true });
export type StagePolicy = typeof stagePolicies.$inferSelect;
export type InsertStagePolicy = typeof stagePolicies.$inferInsert;

export const activityEventTypeEnum = pgEnum("activity_event_type", [
  "TRADE_EXECUTED", "TRADE_EXITED", "ORDER_BLOCKED_RISK", "ORDER_EXECUTION",
  "PROMOTED", "DEMOTED", "GRADUATED",
  "BACKTEST_STARTED", "BACKTEST_COMPLETED", "BACKTEST_FAILED",
  "RUNNER_STARTED", "RUNNER_RESTARTED", "RUNNER_STOPPED",
  "JOB_TIMEOUT", "KILL_TRIGGERED", "KILL_SWITCH",
  "AUTONOMY_TIER_CHANGED", "AUTONOMY_GATE_BLOCKED",
  "INTEGRATION_VERIFIED", "INTEGRATION_USAGE_PROOF",
  "INTEGRATION_ERROR", "INTEGRATION_PROOF",
  "NOTIFY_DISCORD_SENT", "NOTIFY_DISCORD_FAILED",
  "SYSTEM_STATUS_CHANGED", "BOT_CREATED", "BOT_ARCHIVED", "BOT_AUTO_REVERTED",
  "EVOLUTION_COMPLETED", "EVOLUTION_CONVERGED", "EVOLUTION_RESUMED", "STRATEGY_MUTATED", "STRATEGY_EVOLVED",
  "SOURCE_GOVERNOR_DECISION", "SOURCE_GOVERNOR_BLOCKED",
  "ADAPTIVE_WEIGHTS_RESET", "SOURCE_STATE_RESET",
  "WALK_FORWARD_COMPLETED", "STRESS_TEST_COMPLETED",
  "SELF_HEALING_RECOVERY", "SELF_HEALING_DEMOTION", "SELF_HEALING_SKIPPED", "SELF_HEALING_FAILED",
  "PAPER_TRADE_STALL", "PAPER_TRADE_ENTRY", "PAPER_TRADE_EXIT",
  "BOT_STAGNANT", "BOT_NO_ACTIVITY",
  "READY_FOR_LIVE",
  "STRATEGY_LAB_RESEARCH", "STRATEGY_LAB_CYCLE", "STRATEGY_LAB_CANDIDATE_CREATED",
  "LAB_FAILURE_DETECTED", "LAB_FEEDBACK_TRIGGERED",
  "LAB_RESEARCH_CYCLE", "LAB_RESEARCH_FAILED",
  "GROK_RESEARCH_COMPLETED", "GROK_CYCLE_COMPLETED",
  "PERPLEXITY_CYCLE_COMPLETED",
  "RESEARCH_ORCHESTRATOR_TOGGLE", "RESEARCH_ORCHESTRATOR_STARTED", "RESEARCH_JOB_COMPLETED",
  "SYSTEM_AUDIT",
  "ALERT", "CONFIG_CHANGED", "RISK_OVERRIDE", "RISK_OVERRIDE_REVOKED",
  "BEST_EXECUTION_REPORT", "RISK_LIMIT_BREACH", "PRE_TRADE_BLOCKED",
  "GOVERNANCE_REQUEST", "GOVERNANCE_DECISION", "GOVERNANCE_EXPIRED",
  "MODEL_VALIDATION_REQUESTED", "MODEL_VALIDATION_COMPLETED"
]);

export const activitySeverityEnum = pgEnum("activity_severity", ["INFO", "WARN", "ERROR", "CRITICAL", "SUCCESS"]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
  userId: uuid("user_id").references(() => users.id),
  botId: uuid("bot_id").references(() => bots.id),
  eventType: activityEventTypeEnum("event_type").notNull(),
  severity: activitySeverityEnum("severity").default("INFO"),
  stage: text("stage"),
  symbol: text("symbol"),
  accountId: uuid("account_id").references(() => accounts.id),
  provider: text("provider"),
  traceId: text("trace_id"),
  title: text("title").notNull(),
  summary: text("summary"),
  payload: jsonb("payload").default({}),
  dedupeKey: text("dedupe_key"),
});

// AI injections - tracking AI-generated candidates and bot creation (originally grok_injections, now provider-agnostic)
export const grokInjections = pgTable("grok_injections", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").references(() => strategyCandidates.id),
  botId: uuid("bot_id").references(() => bots.id),
  userId: uuid("user_id").references(() => users.id),
  strategyName: text("strategy_name").notNull(),
  archetypeName: text("archetype_name"),
  aiProvider: text("ai_provider").default("GROK"), // GROK, PERPLEXITY, ANTHROPIC, GEMINI, etc.
  researchDepth: text("research_depth"), // CONTRARIAN_SCAN, SENTIMENT_BURST, DEEP_REASONING, SCHEDULED_RESEARCH
  source: text("source").default("GROK_AUTONOMOUS"), // GROK_AUTONOMOUS, PERPLEXITY_SCHEDULED, LAB_FEEDBACK, MANUAL_INJECT
  disposition: text("disposition"), // AUTO_CREATE_BOT, QUEUE_FOR_REVIEW, REJECTED
  confidenceScore: real("confidence_score"),
  noveltyScore: real("novelty_score"),
  hypothesis: text("hypothesis"),
  rulesHash: text("rules_hash"),
  // Lifecycle tracking
  injectedAt: timestamp("injected_at").defaultNow(),
  botCreatedAt: timestamp("bot_created_at"),
  promotedAt: timestamp("promoted_at"),
  promotedToStage: text("promoted_to_stage"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
  // Evolution tracking
  parentInjectionId: uuid("parent_injection_id").references((): any => grokInjections.id),
  evolutionGeneration: integer("evolution_generation").default(0),
  mutationDetails: jsonb("mutation_details"),
  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Grok Performance Feedback - autonomous learning loop tracking
export const grokFeedbackEventTypeEnum = pgEnum("grok_feedback_event_type", [
  "PROMOTION",           // Bot promoted to higher stage
  "DEMOTION",            // Bot demoted to lower stage
  "GATE_PASSED",         // Bot passed a gate check
  "GATE_FAILED",         // Bot failed a gate check
  "MILESTONE",           // Bot hit a performance milestone
  "EVOLUTION_TRIGGERED", // Auto-evolution was triggered
  "STRATEGY_RETIRED",    // Strategy was retired
  "LIVE_PERFORMANCE"     // Regular live performance snapshot
]);

export const grokFeedback = pgTable("grok_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  injectionId: uuid("injection_id").notNull().references(() => grokInjections.id),
  botId: uuid("bot_id").references(() => bots.id),
  eventType: grokFeedbackEventTypeEnum("event_type").notNull(),
  // Stage tracking
  previousStage: text("previous_stage"),
  currentStage: text("current_stage"),
  // Performance snapshot at time of event
  sharpe: real("sharpe"),
  winRate: real("win_rate"),
  maxDrawdownPct: real("max_drawdown_pct"),
  profitFactor: real("profit_factor"),
  tradeCount: integer("trade_count"),
  netPnl: real("net_pnl"),
  // Gate details (if applicable)
  gateName: text("gate_name"),
  gateThreshold: real("gate_threshold"),
  gateActualValue: real("gate_actual_value"),
  gatePassed: boolean("gate_passed"),
  // Learning context
  failureReason: text("failure_reason"),
  successPatterns: jsonb("success_patterns"), // What worked
  improvementSuggestions: jsonb("improvement_suggestions"), // What to fix
  // Evolution tracking
  evolvedCandidateId: uuid("evolved_candidate_id").references(() => strategyCandidates.id),
  evolutionPromptUsed: text("evolution_prompt_used"),
  // Metadata
  createdAt: timestamp("created_at").defaultNow(),
});

export type GrokFeedback = typeof grokFeedback.$inferSelect;
export type InsertGrokFeedback = typeof grokFeedback.$inferInsert;

// Matrix runs - multi-timeframe strategy optimization batches
export const matrixRunStatusEnum = pgEnum("matrix_run_status", ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

export const matrixRuns = pgTable("matrix_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  status: matrixRunStatusEnum("status").default("QUEUED"),
  // Configuration
  symbol: text("symbol").notNull(),
  timeframes: text("timeframes").array().notNull(), // ["1m", "5m", "15m", "1h"]
  horizons: text("horizons").array().notNull(), // ["30d", "90d", "180d", "365d"]
  totalCells: integer("total_cells").default(0),
  completedCells: integer("completed_cells").default(0),
  failedCells: integer("failed_cells").default(0),
  currentTimeframe: text("current_timeframe"), // Currently testing timeframe (e.g., "5m")
  // Aggregate metrics (computed after all cells complete)
  medianProfitFactor: real("median_profit_factor"),
  worstProfitFactor: real("worst_profit_factor"),
  bestProfitFactor: real("best_profit_factor"),
  medianMaxDrawdownPct: real("median_max_drawdown_pct"),
  worstMaxDrawdownPct: real("worst_max_drawdown_pct"),
  tradeCountTotal: integer("trade_count_total").default(0),
  consistencyScore: real("consistency_score"), // % of cells profitable
  stabilityScore: real("stability_score"), // variance across cells
  // Best/worst cell references
  bestCellId: uuid("best_cell_id"),
  worstCellId: uuid("worst_cell_id"),
  // Timestamps
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Matrix cells - individual timeframe x horizon backtest results
export const matrixCells = pgTable("matrix_cells", {
  id: uuid("id").primaryKey().defaultRandom(),
  matrixRunId: uuid("matrix_run_id").notNull().references(() => matrixRuns.id),
  backtestSessionId: uuid("backtest_session_id").references(() => backtestSessions.id),
  // Cell coordinates
  timeframe: text("timeframe").notNull(), // "1m", "5m", "15m", etc.
  horizon: text("horizon").notNull(), // "30d", "90d", "180d", "365d"
  foldIndex: integer("fold_index").default(0), // For walk-forward folds
  // Status
  status: text("status").default("pending"), // pending, running, completed, failed
  errorMessage: text("error_message"),
  // Performance metrics
  netPnl: real("net_pnl"),
  profitFactor: real("profit_factor"),
  winRate: real("win_rate"),
  totalTrades: integer("total_trades").default(0),
  maxDrawdown: real("max_drawdown"),
  maxDrawdownPct: real("max_drawdown_pct"),
  sharpeRatio: real("sharpe_ratio"),
  expectancy: real("expectancy"),
  avgWin: real("avg_win"),
  avgLoss: real("avg_loss"),
  // Ranking within matrix
  rankByPf: integer("rank_by_pf"),
  rankByDrawdown: integer("rank_by_drawdown"),
  rankByConsistency: integer("rank_by_consistency"),
  // Timestamps
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Historical bar cache metadata (for 5-year tiered storage)
export const barCacheMetadata = pgTable("bar_cache_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(), // "1m", "5m", "15m", "1h", "1d"
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  barCount: integer("bar_count").default(0),
  storageTier: text("storage_tier").default("memory"), // "memory", "disk"
  filePath: text("file_path"), // For disk-backed storage
  lastRefreshAt: timestamp("last_refresh_at"),
  isStale: boolean("is_stale").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// LLM provider enum for cost tracking
export const llmProviderEnum = pgEnum("llm_provider", [
  "groq", "openai", "anthropic", "gemini", "xai", "openrouter", "perplexity"
]);

// Cost category enum
export const costCategoryEnum = pgEnum("cost_category", [
  "llm", "data_market", "data_options", "data_macro", "data_news", "compute"
]);

// Bot cost events - tracks every cost-incurring action per bot (or system-level costs)
export const botCostEvents = pgTable("bot_cost_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id"), // Nullable for system-level costs (Strategy Lab research, etc.)
  userId: uuid("user_id").notNull().references(() => users.id),
  category: costCategoryEnum("category").notNull(),
  provider: text("provider").notNull(), // e.g., "groq", "databento", "unusual_whales"
  eventType: text("event_type").notNull(), // e.g., "evolution", "backtest_data", "signal_fetch"
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: real("cost_usd").notNull().default(0),
  metadata: jsonb("metadata").default({}), // Additional context (model used, reason, etc.)
  traceId: text("trace_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// LLM budget configuration per provider
export const llmBudgets = pgTable("llm_budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: llmProviderEnum("provider").notNull(),
  monthlyLimitUsd: real("monthly_limit_usd").default(10),
  currentMonthSpendUsd: real("current_month_spend_usd").default(0),
  isEnabled: boolean("is_enabled").default(true),
  isPaused: boolean("is_paused").default(false), // User manually paused
  isAutoThrottled: boolean("is_auto_throttled").default(false), // Budget exceeded
  priority: integer("priority").default(1), // Lower = try first (1-6)
  lastResetAt: timestamp("last_reset_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Degradation reason enum for institutional audit trail
export const degradationReasonEnum = pgEnum("degradation_reason", [
  "EDGE_DECAY",           // Performance degrading vs baseline
  "DRAWDOWN_BREACH",      // Max drawdown exceeded threshold
  "WIN_RATE_COLLAPSE",    // Win rate dropped below minimum
  "PROFIT_FACTOR_BREACH", // Profit factor dropped below 1.0
  "VOLATILITY_SPIKE",     // Market volatility exceeded safe range
  "SIGNAL_INSTABILITY",   // Signal sources producing inconsistent data
  "DATA_QUALITY_ISSUE",   // Data source degradation
  "MANUAL_DEMOTION"       // Operator-initiated demotion
]);

// Bot degradation events - institutional audit trail for performance issues
export const botDegradationEvents = pgTable("bot_degradation_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  accountAttemptId: uuid("account_attempt_id").references(() => accountAttempts.id),
  // Degradation context
  reason: degradationReasonEnum("reason").notNull(),
  severity: text("severity").default("WARN"), // WARN, ERROR, CRITICAL
  stage: text("stage").notNull(), // Stage at time of detection
  previousStage: text("previous_stage"), // If demotion occurred
  // Metrics snapshot at time of degradation
  metricsSnapshot: jsonb("metrics_snapshot").notNull().default({}), // { pnl, winRate, profitFactor, maxDrawdown, trades }
  baselineMetrics: jsonb("baseline_metrics").default({}), // Baseline comparison if available
  // Threshold breach details
  thresholdBreached: text("threshold_breached"), // e.g., "maxDrawdown > 10%"
  thresholdValue: real("threshold_value"), // The threshold that was breached
  actualValue: real("actual_value"), // The actual value that triggered the breach
  // Action taken
  actionTaken: text("action_taken"), // e.g., "DEMOTION_TO_LAB", "PAUSE", "ALERT_ONLY"
  recoveryPlan: text("recovery_plan"), // Suggested steps to recover
  // Resolution tracking
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"), // "AUTO_RECOVERY", "OPERATOR", "EVOLUTION"
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  traceId: text("trace_id"),
});

// Adaptive signal weight history - tracks autonomous weight adjustments
export const signalWeightHistory = pgTable("signal_weight_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").references(() => bots.id), // null for global weights
  weights: jsonb("weights").notNull(), // { options_flow, macro_indicators, news_sentiment, economic_calendar }
  adjustments: jsonb("adjustments").default([]), // Array of weight adjustment reasons
  regime: text("regime").notNull(), // TRENDING, RANGING, VOLATILE, MANUAL_OVERRIDE
  confidence: real("confidence").default(50),
  reason: text("reason"),
  expiresAt: timestamp("expires_at"), // For manual overrides with expiry
  createdAt: timestamp("created_at").defaultNow(),
});

// Generation metrics history - tracks performance per generation for trend analysis and auto-revert
export const generationMetricsHistory = pgTable("generation_metrics_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationNumber: integer("generation_number").notNull(),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  backtestSessionId: uuid("backtest_session_id").references(() => backtestSessions.id),
  // Core performance metrics
  sharpeRatio: real("sharpe_ratio"),
  profitFactor: real("profit_factor"),
  winRate: real("win_rate"),
  maxDrawdownPct: real("max_drawdown_pct"),
  totalTrades: integer("total_trades").default(0),
  netPnl: real("net_pnl"),
  expectancy: real("expectancy"),
  // Trend tracking
  peakSharpe: real("peak_sharpe"), // Best Sharpe seen in this bot's history
  peakGeneration: integer("peak_generation"), // Generation that achieved peak
  trendDirection: text("trend_direction"), // IMPROVING, DECLINING, STABLE, INSUFFICIENT_DATA
  trendConfidence: real("trend_confidence"), // 0-100, based on trade count and consistency
  declineFromPeakPct: real("decline_from_peak_pct"), // How much worse than peak (for regression detection)
  // Auto-revert tracking
  isRevertCandidate: boolean("is_revert_candidate").default(false), // Flagged for potential revert
  wasReverted: boolean("was_reverted").default(false), // This gen was reverted from
  revertedToGeneration: integer("reverted_to_generation"), // If reverted, which gen we went back to
  revertReason: text("revert_reason"), // SHARPE_DECLINE, PF_DECLINE, COMBINED, MANUAL
  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
});

// Paper trade execution mode enum
export const paperTradeStatusEnum = pgEnum("paper_trade_status", ["OPEN", "CLOSED", "CANCELLED"]);
export const paperPositionStatusEnum = pgEnum("paper_position_status", ["FLAT", "LONG", "SHORT"]);

// Paper trades - real-time paper trade executions (distinct from backtest trade_logs)
export const paperTrades = pgTable("paper_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  botInstanceId: uuid("bot_instance_id").references(() => botInstances.id),
  accountId: uuid("account_id").references(() => accounts.id),
  accountAttemptId: uuid("account_attempt_id").references(() => accountAttempts.id),
  // Trade details
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  // Execution timestamps
  entryTime: timestamp("entry_time").notNull(),
  exitTime: timestamp("exit_time"),
  // P&L (calculated at close)
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  fees: real("fees").default(0),
  slippage: real("slippage").default(0),
  // Status and tracking
  status: paperTradeStatusEnum("status").default("OPEN").notNull(),
  entryReasonCode: text("entry_reason_code"), // ENTRY_GAP_FADE, ENTRY_TREND_FOLLOW, etc.
  exitReasonCode: text("exit_reason_code"), // EXIT_TP, EXIT_SL, EXIT_TIME, EXIT_SIGNAL
  entryBarTime: timestamp("entry_bar_time"), // Bar time that triggered entry
  exitBarTime: timestamp("exit_bar_time"), // Bar time that triggered exit
  // Signal fusion context (what signals led to this trade)
  signalContext: jsonb("signal_context").default({}),
  // Trace ID for correlation
  traceId: uuid("trace_id").defaultRandom(),
  // Integrity checksum for corruption detection (SHA-256 = 64 hex chars)
  checksum: varchar("checksum", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Paper positions - current open positions for paper trading
export const paperPositions = pgTable("paper_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  botInstanceId: uuid("bot_instance_id").references(() => botInstances.id),
  accountId: uuid("account_id").references(() => accounts.id),
  accountAttemptId: uuid("account_attempt_id").references(() => accountAttempts.id),
  // Position details
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  averageEntryPrice: real("average_entry_price").notNull(),
  currentPrice: real("current_price"),
  // P&L tracking
  unrealizedPnl: real("unrealized_pnl").default(0),
  realizedPnl: real("realized_pnl").default(0),
  // Risk levels
  stopPrice: real("stop_price"),
  targetPrice: real("target_price"),
  // Status
  status: paperPositionStatusEnum("status").default("FLAT").notNull(),
  // Trade reference (link to opening trade)
  openingTradeId: uuid("opening_trade_id").references(() => paperTrades.id),
  // Timestamps
  openedAt: timestamp("opened_at").notNull(),
  closedAt: timestamp("closed_at"),
  lastPriceUpdateAt: timestamp("last_price_update_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Paper trading session aggregates - daily/session-level stats
export const paperTradingSessions = pgTable("paper_trading_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  accountId: uuid("account_id").references(() => accounts.id),
  accountAttemptId: uuid("account_attempt_id").references(() => accountAttempts.id),
  // Session window
  sessionDate: timestamp("session_date").notNull(),
  sessionStart: timestamp("session_start").notNull(),
  sessionEnd: timestamp("session_end"),
  // Aggregated metrics
  totalTrades: integer("total_trades").default(0),
  winningTrades: integer("winning_trades").default(0),
  losingTrades: integer("losing_trades").default(0),
  grossPnl: real("gross_pnl").default(0),
  netPnl: real("net_pnl").default(0),
  totalFees: real("total_fees").default(0),
  maxDrawdown: real("max_drawdown").default(0),
  peakEquity: real("peak_equity"),
  // Session state
  isActive: boolean("is_active").default(true),
  closedReason: text("closed_reason"), // SESSION_END, MARKET_CLOSE, DAILY_LOSS_LIMIT, MANUAL
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Bot-Account P&L tracking - aggregated realized P&L per bot per account
export const botAccountPnl = pgTable("bot_account_pnl", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  accountAttemptId: uuid("account_attempt_id").references(() => accountAttempts.id),
  // Aggregated P&L from closed trades
  realizedPnl: real("realized_pnl").default(0).notNull(),
  totalFees: real("total_fees").default(0).notNull(),
  netPnl: real("net_pnl").default(0).notNull(), // realizedPnl - totalFees
  // Trade counts
  totalTrades: integer("total_trades").default(0).notNull(),
  winningTrades: integer("winning_trades").default(0).notNull(),
  losingTrades: integer("losing_trades").default(0).notNull(),
  // Drawdown tracking
  peakEquity: real("peak_equity"),
  maxDrawdown: real("max_drawdown").default(0),
  maxDrawdownPercent: real("max_drawdown_percent").default(0),
  // Timestamps
  lastTradeClosedAt: timestamp("last_trade_closed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// INSTITUTIONAL GOVERNANCE & COMPLIANCE TABLES
// ============================================================================

// MAKER-CHECKER GOVERNANCE: Human approval workflow for LIVE deployments
export const governanceApprovalStatusEnum = pgEnum("governance_approval_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "WITHDRAWN"
]);

export const governanceApprovals = pgTable("governance_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  requestedAction: text("requested_action").notNull(), // PROMOTE_TO_CANARY, PROMOTE_TO_LIVE, ARM_LIVE
  fromStage: text("from_stage").notNull(),
  toStage: text("to_stage").notNull(),
  
  // Maker (requester) info
  requestedBy: uuid("requested_by").references(() => users.id),
  requestedAt: timestamp("requested_at").defaultNow(),
  requestReason: text("request_reason"),
  
  // Checker (approver) info
  status: governanceApprovalStatusEnum("status").default("PENDING"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  
  // Gate metrics at request time
  metricsSnapshot: jsonb("metrics_snapshot").default({}),
  gatesSnapshot: jsonb("gates_snapshot").default({}),
  riskAssessment: jsonb("risk_assessment").default({}),
  
  // Expiry
  expiresAt: timestamp("expires_at"),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// MODEL VALIDATION: Required sign-offs before LIVE deployment
export const modelValidationStatusEnum = pgEnum("model_validation_status", [
  "PENDING",
  "VALIDATED",
  "REJECTED",
  "NEEDS_REVISION"
]);

export const modelValidations = pgTable("model_validations", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  generationId: uuid("generation_id").references(() => botGenerations.id),
  
  // Validation request
  validationType: text("validation_type").notNull(), // INITIAL, PARAMETER_CHANGE, REVALIDATION
  status: modelValidationStatusEnum("status").default("PENDING"),
  
  // Validator info
  requestedBy: uuid("requested_by").references(() => users.id),
  validatedBy: uuid("validated_by").references(() => users.id),
  validatedAt: timestamp("validated_at"),
  
  // Validation criteria
  backtestPeriods: jsonb("backtest_periods").default([]), // Periods tested
  walkForwardResults: jsonb("walk_forward_results").default({}),
  stressTestResults: jsonb("stress_test_results").default({}),
  outOfSampleMetrics: jsonb("out_of_sample_metrics").default({}),
  
  // Findings
  validationNotes: text("validation_notes"),
  riskConcerns: text("risk_concerns").array(),
  requiredChanges: text("required_changes").array(),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// IMMUTABLE AUDIT LOG: Tamper-evident audit trail with hash chain
export const immutableAuditLog = pgTable("immutable_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
  
  // Event details
  eventType: text("event_type").notNull(), // TRADE, PROMOTION, CONFIG_CHANGE, APPROVAL, RISK_OVERRIDE
  entityType: text("entity_type").notNull(), // BOT, ACCOUNT, USER, SYSTEM
  entityId: text("entity_id").notNull(),
  
  // Actor info
  actorType: text("actor_type").notNull(), // USER, SYSTEM, SCHEDULER, API
  actorId: text("actor_id"),
  actorIp: text("actor_ip"),
  
  // Payload
  eventPayload: jsonb("event_payload").notNull(),
  previousState: jsonb("previous_state"),
  newState: jsonb("new_state"),
  
  // Hash chain for tamper evidence
  payloadHash: text("payload_hash").notNull(), // SHA-256 of event_payload
  previousHash: text("previous_hash"), // Hash of previous record
  chainHash: text("chain_hash").notNull(), // Hash(sequenceNumber + payloadHash + previousHash)
  
  // Metadata
  traceId: uuid("trace_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// INSTITUTIONAL RISK MANAGEMENT TABLES
// ============================================================================

// REAL-TIME RISK AGGREGATION: Portfolio-level exposure tracking
export const riskSnapshots = pgTable("risk_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotTime: timestamp("snapshot_time").notNull().defaultNow(),
  
  // Portfolio exposure
  totalGrossExposure: real("total_gross_exposure").default(0), // Sum of all position notional values
  totalNetExposure: real("total_net_exposure").default(0), // Long - Short
  totalContractsLong: integer("total_contracts_long").default(0),
  totalContractsShort: integer("total_contracts_short").default(0),
  
  // Concentration limits
  maxSingleBotExposure: real("max_single_bot_exposure").default(0),
  maxSingleSymbolExposure: real("max_single_symbol_exposure").default(0),
  concentrationBySymbol: jsonb("concentration_by_symbol").default({}), // { MES: 45%, MNQ: 55% }
  concentrationByBot: jsonb("concentration_by_bot").default({}),
  
  // Cross-bot correlation risk
  correlationMatrix: jsonb("correlation_matrix").default({}),
  diversificationScore: real("diversification_score"), // 0-100
  
  // VaR metrics
  var95Daily: real("var_95_daily"), // 95% VaR
  var99Daily: real("var_99_daily"), // 99% VaR
  cvar95Daily: real("cvar_95_daily"), // Conditional VaR (Expected Shortfall)
  varMethod: text("var_method").default("HISTORICAL"), // HISTORICAL, PARAMETRIC, MONTE_CARLO
  
  // Drawdown tracking
  portfolioDrawdown: real("portfolio_drawdown").default(0),
  portfolioDrawdownPct: real("portfolio_drawdown_pct").default(0),
  portfolioPeakEquity: real("portfolio_peak_equity"),
  
  // Limit breaches
  limitBreaches: jsonb("limit_breaches").default([]), // Array of { limit, actual, severity }
  breachCount: integer("breach_count").default(0),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// STRESS TEST SCENARIOS: Pre-defined market scenarios for risk assessment
export const stressScenarios = pgTable("stress_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  
  // Scenario parameters
  scenarioType: text("scenario_type").notNull(), // HISTORICAL, HYPOTHETICAL, REGULATORY
  marketShocks: jsonb("market_shocks").default({}), // { MES: -5%, MNQ: -7%, volatility: +50% }
  correlationShock: real("correlation_shock"), // Correlation increase assumption
  liquidityShock: real("liquidity_shock"), // Spread widening factor
  
  // Historical reference
  historicalPeriod: text("historical_period"), // e.g., "2020-03 COVID", "2008-09 GFC"
  historicalStartDate: timestamp("historical_start_date"),
  historicalEndDate: timestamp("historical_end_date"),
  
  // Regulatory
  isRegulatoryRequired: boolean("is_regulatory_required").default(false),
  regulatoryFramework: text("regulatory_framework"), // SEC, CFTC, etc.
  
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// PRE-TRADE RISK CHECKS: Real-time order validation
export const preTradeChecks = pgTable("pre_trade_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Order info
  botId: uuid("bot_id").notNull().references(() => bots.id),
  instanceId: uuid("instance_id").references(() => botInstances.id),
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: integer("quantity").notNull(),
  orderType: text("order_type").notNull(),
  limitPrice: real("limit_price"),
  
  // Check results
  checksPassed: boolean("checks_passed").notNull(),
  checksRun: jsonb("checks_run").default([]), // Array of check results
  blockedBy: text("blocked_by").array(), // Names of failed checks
  
  // Individual checks
  positionLimitCheck: boolean("position_limit_check"),
  exposureLimitCheck: boolean("exposure_limit_check"),
  concentrationCheck: boolean("concentration_check"),
  drawdownCheck: boolean("drawdown_check"),
  marginCheck: boolean("margin_check"),
  circuitBreakerCheck: boolean("circuit_breaker_check"),
  killSwitchCheck: boolean("kill_switch_check"),
  
  // Margin info (if available from broker)
  requiredMargin: real("required_margin"),
  availableMargin: real("available_margin"),
  marginUtilization: real("margin_utilization"),
  
  latencyMs: integer("latency_ms"),
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// TRANSACTION COST ANALYSIS (TCA) & BEST EXECUTION
// ============================================================================

// TCA RECORDS: Per-trade execution quality analysis
export const tcaRecords = pgTable("tca_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Trade reference
  tradeId: uuid("trade_id"), // Reference to paper_trades or live trades
  botId: uuid("bot_id").notNull().references(() => bots.id),
  instanceId: uuid("instance_id").references(() => botInstances.id),
  
  // Order details
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  quantity: integer("quantity").notNull(),
  orderType: text("order_type").notNull(),
  
  // Pricing
  limitPrice: real("limit_price"),
  filledPrice: real("filled_price").notNull(),
  arrivalPrice: real("arrival_price").notNull(), // Price when order sent
  decisionPrice: real("decision_price"), // Price when signal generated
  closePrice: real("close_price"), // Day close for VWAP comparison
  twapPrice: real("twap_price"), // TWAP during execution window
  vwapPrice: real("vwap_price"), // VWAP during execution window
  
  // Slippage analysis
  slippageBps: real("slippage_bps").notNull(), // Basis points
  slippageDollars: real("slippage_dollars").notNull(),
  implSlippage: real("impl_slippage"), // Implementation shortfall
  
  // Market impact
  spreadAtOrder: real("spread_at_order"), // Bid-ask spread when ordered
  spreadAtFill: real("spread_at_fill"), // Bid-ask spread at fill
  marketImpactBps: real("market_impact_bps"),
  
  // Timing
  orderTimestamp: timestamp("order_timestamp").notNull(),
  fillTimestamp: timestamp("fill_timestamp"),
  executionLatencyMs: integer("execution_latency_ms"),
  
  // Quality scores
  executionQualityScore: real("execution_quality_score"), // 0-100
  benchmarkVsVwap: real("benchmark_vs_vwap"), // Performance vs VWAP
  benchmarkVsTwap: real("benchmark_vs_twap"), // Performance vs TWAP
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// BEST EXECUTION REPORTS: Aggregated execution quality reports
export const bestExecutionReports = pgTable("best_execution_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Report period
  reportType: text("report_type").notNull(), // DAILY, WEEKLY, MONTHLY, QUARTERLY
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Scope
  botId: uuid("bot_id").references(() => bots.id), // NULL for portfolio-level
  symbol: text("symbol"), // NULL for all symbols
  
  // Aggregate metrics
  totalTrades: integer("total_trades").notNull(),
  totalVolume: integer("total_volume").notNull(),
  totalNotional: real("total_notional").notNull(),
  
  // Slippage summary
  avgSlippageBps: real("avg_slippage_bps").notNull(),
  totalSlippageDollars: real("total_slippage_dollars").notNull(),
  worstSlippageBps: real("worst_slippage_bps"),
  slippageStdDev: real("slippage_std_dev"),
  
  // VWAP performance
  avgVwapPerformance: real("avg_vwap_performance"),
  tradesBeatingVwap: integer("trades_beating_vwap"),
  tradesBehindVwap: integer("trades_behind_vwap"),
  
  // Execution timing
  avgExecutionLatencyMs: real("avg_execution_latency_ms"),
  maxExecutionLatencyMs: integer("max_execution_latency_ms"),
  
  // Fill quality
  avgFillRate: real("avg_fill_rate"), // For limit orders
  cancelRate: real("cancel_rate"),
  rejectRate: real("reject_rate"),
  
  // Quality scores
  overallExecutionScore: real("overall_execution_score"), // 0-100
  recommendations: jsonb("recommendations").default([]),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// TRADE SURVEILLANCE & COMPLIANCE
// ============================================================================

// TRADE SURVEILLANCE: Anomaly detection and pattern monitoring
export const tradeSurveillanceAlerts = pgTable("trade_surveillance_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Alert details
  alertType: text("alert_type").notNull(), // WASH_TRADE, SPOOFING, LAYERING, UNUSUAL_VOLUME, TIMING_ANOMALY
  severity: alertSeverityEnum("severity").notNull(),
  
  // Affected entities
  botId: uuid("bot_id").references(() => bots.id),
  accountId: uuid("account_id").references(() => accounts.id),
  tradeIds: uuid("trade_ids").array(),
  
  // Detection details
  detectionReason: text("detection_reason").notNull(),
  detectionScore: real("detection_score"), // Confidence 0-100
  patternDetails: jsonb("pattern_details").default({}),
  
  // Time window
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  
  // Status
  status: alertStatusEnum("status").default("OPEN"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"),
  disposition: text("disposition"), // FALSE_POSITIVE, INVESTIGATED, ESCALATED, REMEDIATED
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// CAT-STYLE REGULATORY RECORDS: Consolidated audit trail for regulatory reporting
export const regulatoryTradeRecords = pgTable("regulatory_trade_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Unique identifiers
  catReportableEventId: text("cat_reportable_event_id").unique(), // Simulated CAT ID
  firmOrderId: text("firm_order_id").notNull(),
  
  // Event type
  eventType: text("event_type").notNull(), // NEW_ORDER, MODIFY, CANCEL, FILL, REJECT
  eventTimestamp: timestamp("event_timestamp", { precision: 6 }).notNull(), // Microsecond precision
  
  // Order details
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  orderType: text("order_type").notNull(),
  quantity: integer("quantity").notNull(),
  price: real("price"),
  
  // Execution details (for fills)
  fillQuantity: integer("fill_quantity"),
  fillPrice: real("fill_price"),
  executionVenue: text("execution_venue"), // Exchange or venue
  
  // Account info
  accountId: uuid("account_id").references(() => accounts.id),
  botId: uuid("bot_id").references(() => bots.id),
  
  // Timestamps (CAT requires multiple)
  orderReceivedTimestamp: timestamp("order_received_timestamp", { precision: 6 }),
  orderRoutedTimestamp: timestamp("order_routed_timestamp", { precision: 6 }),
  orderExecutedTimestamp: timestamp("order_executed_timestamp", { precision: 6 }),
  
  // Regulatory flags
  representativeIndicator: text("representative_indicator"),
  handlingInstructions: text("handling_instructions"),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// DATA LINEAGE & INTEGRITY
// ============================================================================

// MARKET DATA LINEAGE: Track data transformations and sources
export const marketDataLineage = pgTable("market_data_lineage", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Data identification
  symbol: text("symbol").notNull(),
  dataType: text("data_type").notNull(), // BARS, TICKS, QUOTES, TRADES
  timeframe: text("timeframe"),
  
  // Source info
  sourceProvider: text("source_provider").notNull(), // DATABENTO, POLYGON, etc.
  sourceDataset: text("source_dataset"),
  sourceSchema: text("source_schema"),
  
  // Time range
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Data hash for integrity verification
  recordCount: integer("record_count").notNull(),
  rawDataHash: text("raw_data_hash").notNull(), // SHA-256 of raw data
  transformedDataHash: text("transformed_data_hash"), // Hash after transformations
  
  // Transformations applied
  transformations: jsonb("transformations").default([]), // Array of { name, params, timestamp }
  
  // Quality metrics
  missingBars: integer("missing_bars").default(0),
  gapCount: integer("gap_count").default(0),
  qualityScore: real("quality_score"), // 0-100
  
  // Verification
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: text("verified_by"), // SYSTEM, USER, DUAL_PROVIDER
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// DUAL-PROVIDER RECONCILIATION: Cross-check market data between providers
export const dataReconciliationRuns = pgTable("data_reconciliation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Scope
  symbol: text("symbol").notNull(),
  dataType: text("data_type").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Providers compared
  primaryProvider: text("primary_provider").notNull(),
  secondaryProvider: text("secondary_provider").notNull(),
  
  // Results
  status: text("status").notNull(), // PASSED, FAILED, WARNING
  primaryRecordCount: integer("primary_record_count").notNull(),
  secondaryRecordCount: integer("secondary_record_count").notNull(),
  matchedRecords: integer("matched_records").notNull(),
  mismatchedRecords: integer("mismatched_records").default(0),
  
  // Discrepancy details
  discrepancies: jsonb("discrepancies").default([]), // Array of { timestamp, field, primary, secondary }
  maxPriceVariance: real("max_price_variance"), // Max price difference
  avgPriceVariance: real("avg_price_variance"),
  
  // Actions taken
  autoResolved: boolean("auto_resolved").default(false),
  resolutionMethod: text("resolution_method"), // PRIMARY_WINS, SECONDARY_WINS, MANUAL
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ============================================================================
// DISASTER RECOVERY & BACKUP TRACKING
// ============================================================================

// BACKUP RECORDS: Track all backup operations
export const backupRecords = pgTable("backup_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Backup details
  backupType: text("backup_type").notNull(), // FULL, INCREMENTAL, POINT_IN_TIME
  backupTarget: text("backup_target").notNull(), // DATABASE, CONFIG, SECRETS
  
  // Location
  storageLocation: text("storage_location").notNull(), // S3 bucket, GCS, local path
  storageRegion: text("storage_region"),
  isOffsite: boolean("is_offsite").default(false),
  isEncrypted: boolean("is_encrypted").default(true),
  encryptionKeyId: text("encryption_key_id"),
  
  // Timing
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  
  // Size and verification
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  checksum: text("checksum"), // SHA-256 of backup
  isVerified: boolean("is_verified").default(false),
  verifiedAt: timestamp("verified_at"),
  
  // Status
  status: text("status").notNull(), // IN_PROGRESS, COMPLETED, FAILED, VERIFIED
  errorMessage: text("error_message"),
  
  // Retention
  retentionDays: integer("retention_days").default(30),
  expiresAt: timestamp("expires_at"),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// RECOVERY TESTS: Track disaster recovery test runs
export const recoveryTests = pgTable("recovery_tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  
  // Test details
  testType: text("test_type").notNull(), // FULL_RESTORE, PARTIAL_RESTORE, FAILOVER
  testScope: text("test_scope").notNull(), // DATABASE, FULL_SYSTEM, SPECIFIC_TABLES
  
  // Source backup
  backupRecordId: uuid("backup_record_id").references(() => backupRecords.id),
  
  // Timing
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  
  // Results
  status: text("status").notNull(), // PASSED, FAILED, PARTIAL
  rpoAchievedSeconds: integer("rpo_achieved_seconds"), // Actual Recovery Point
  rtoAchievedSeconds: integer("rto_achieved_seconds"), // Actual Recovery Time
  
  // Target metrics
  rpoTargetSeconds: integer("rpo_target_seconds"), // Target Recovery Point
  rtoTargetSeconds: integer("rto_target_seconds"), // Target Recovery Time
  meetsRpoTarget: boolean("meets_rpo_target"),
  meetsRtoTarget: boolean("meets_rto_target"),
  
  // Findings
  findings: jsonb("findings").default([]),
  errorMessage: text("error_message"),
  
  // Sign-off
  testedBy: uuid("tested_by").references(() => users.id),
  signedOffBy: uuid("signed_off_by").references(() => users.id),
  signedOffAt: timestamp("signed_off_at"),
  
  traceId: uuid("trace_id").defaultRandom(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas and types for new tables
export const insertGovernanceApprovalSchema = createInsertSchema(governanceApprovals).omit({ id: true, createdAt: true, traceId: true });
export type GovernanceApproval = typeof governanceApprovals.$inferSelect;
export type InsertGovernanceApproval = typeof governanceApprovals.$inferInsert;

export const insertModelValidationSchema = createInsertSchema(modelValidations).omit({ id: true, createdAt: true, traceId: true });
export type ModelValidation = typeof modelValidations.$inferSelect;
export type InsertModelValidation = typeof modelValidations.$inferInsert;

export const insertImmutableAuditLogSchema = createInsertSchema(immutableAuditLog).omit({ id: true, createdAt: true });
export type ImmutableAuditLogEntry = typeof immutableAuditLog.$inferSelect;
export type InsertImmutableAuditLogEntry = typeof immutableAuditLog.$inferInsert;

export const insertRiskSnapshotSchema = createInsertSchema(riskSnapshots).omit({ id: true, createdAt: true, traceId: true });
export type RiskSnapshot = typeof riskSnapshots.$inferSelect;
export type InsertRiskSnapshot = typeof riskSnapshots.$inferInsert;

export const insertStressScenarioSchema = createInsertSchema(stressScenarios).omit({ id: true, createdAt: true });
export type StressScenario = typeof stressScenarios.$inferSelect;
export type InsertStressScenario = typeof stressScenarios.$inferInsert;

export const insertPreTradeCheckSchema = createInsertSchema(preTradeChecks).omit({ id: true, createdAt: true, traceId: true });
export type PreTradeCheck = typeof preTradeChecks.$inferSelect;
export type InsertPreTradeCheck = typeof preTradeChecks.$inferInsert;

export const insertTcaRecordSchema = createInsertSchema(tcaRecords).omit({ id: true, createdAt: true, traceId: true });
export type TcaRecord = typeof tcaRecords.$inferSelect;
export type InsertTcaRecord = typeof tcaRecords.$inferInsert;

export const insertBestExecutionReportSchema = createInsertSchema(bestExecutionReports).omit({ id: true, createdAt: true });
export type BestExecutionReport = typeof bestExecutionReports.$inferSelect;
export type InsertBestExecutionReport = typeof bestExecutionReports.$inferInsert;

export const insertTradeSurveillanceAlertSchema = createInsertSchema(tradeSurveillanceAlerts).omit({ id: true, createdAt: true, traceId: true });
export type TradeSurveillanceAlert = typeof tradeSurveillanceAlerts.$inferSelect;
export type InsertTradeSurveillanceAlert = typeof tradeSurveillanceAlerts.$inferInsert;

export const insertRegulatoryTradeRecordSchema = createInsertSchema(regulatoryTradeRecords).omit({ id: true, createdAt: true, traceId: true });
export type RegulatoryTradeRecord = typeof regulatoryTradeRecords.$inferSelect;
export type InsertRegulatoryTradeRecord = typeof regulatoryTradeRecords.$inferInsert;

export const insertMarketDataLineageSchema = createInsertSchema(marketDataLineage).omit({ id: true, createdAt: true, traceId: true });
export type MarketDataLineage = typeof marketDataLineage.$inferSelect;
export type InsertMarketDataLineage = typeof marketDataLineage.$inferInsert;

export const insertDataReconciliationRunSchema = createInsertSchema(dataReconciliationRuns).omit({ id: true, createdAt: true, traceId: true });
export type DataReconciliationRun = typeof dataReconciliationRuns.$inferSelect;
export type InsertDataReconciliationRun = typeof dataReconciliationRuns.$inferInsert;

export const insertBackupRecordSchema = createInsertSchema(backupRecords).omit({ id: true, createdAt: true, traceId: true });
export type BackupRecord = typeof backupRecords.$inferSelect;
export type InsertBackupRecord = typeof backupRecords.$inferInsert;

export const insertRecoveryTestSchema = createInsertSchema(recoveryTests).omit({ id: true, createdAt: true, traceId: true });
export type RecoveryTest = typeof recoveryTests.$inferSelect;
export type InsertRecoveryTest = typeof recoveryTests.$inferInsert;

export const usersRelations = relations(users, ({ many, one }) => ({
  bots: many(bots),
  accounts: many(accounts),
  alerts: many(alerts),
  integrations: many(integrations),
  settings: one(appSettings),
}));

export const botsRelations = relations(bots, ({ one, many }) => ({
  user: one(users, { fields: [bots.userId], references: [users.id] }),
  generations: many(botGenerations),
  backtestSessions: many(backtestSessions),
  instances: many(botInstances),
  jobs: many(botJobs),
  tradeLogs: many(tradeLogs),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountSchema = createInsertSchema(accounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertAccountAttemptSchema = createInsertSchema(accountAttempts).omit({ id: true, createdAt: true });
export const insertBotAccountSchema = createInsertSchema(botAccounts).omit({ id: true, createdAt: true });
export const insertBotSchema = createInsertSchema(bots).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBotGenerationSchema = createInsertSchema(botGenerations).omit({ id: true, createdAt: true });
export const insertBacktestSessionSchema = createInsertSchema(backtestSessions).omit({ id: true, createdAt: true });
export const insertBotJobSchema = createInsertSchema(botJobs).omit({ id: true, createdAt: true, traceId: true });
export const insertJobRunEventSchema = createInsertSchema(jobRunEvents).omit({ id: true, createdAt: true });
export const insertBotInstanceSchema = createInsertSchema(botInstances).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTradeLogSchema = createInsertSchema(tradeLogs).omit({ id: true, createdAt: true });
export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertIntegrationSchema = createInsertSchema(integrations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertKillEventSchema = createInsertSchema(killEvents).omit({ id: true, createdAt: true, traceId: true });
export const insertInstrumentSchema = createInsertSchema(instruments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBrokerAccountEventSchema = createInsertSchema(brokerAccountEvents).omit({ id: true, createdAt: true, traceId: true });
export const insertEvaluationRunSchema = createInsertSchema(evaluationRuns).omit({ id: true, createdAt: true });
export const insertBotStageChangeSchema = createInsertSchema(botStageChanges).omit({ id: true, createdAt: true });
export const insertSchedulerStateSchema = createInsertSchema(schedulerState).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSecuritySchema = createInsertSchema(userSecurity).omit({ createdAt: true, updatedAt: true });
export const insertReadinessRunSchema = createInsertSchema(readinessRuns).omit({ id: true, createdAt: true });
export const insertIntegrationUsageEventSchema = createInsertSchema(integrationUsageEvents).omit({ id: true, createdAt: true, traceId: true });
export const insertLlmUsageSchema = createInsertSchema(llmUsage).omit({ id: true, createdAt: true });
export const insertDecisionTraceSchema = createInsertSchema(decisionTraces).omit({ id: true, createdAt: true, traceId: true });
export const insertNoTradeTraceSchema = createInsertSchema(noTradeTraces).omit({ id: true, createdAt: true, traceId: true });
export const insertAutonomyScoreSchema = createInsertSchema(autonomyScores).omit({ id: true, createdAt: true });
export const insertProfitVariableSchema = createInsertSchema(profitVariables).omit({ id: true, createdAt: true });
export const insertActivityEventSchema = createInsertSchema(activityEvents).omit({ id: true, createdAt: true });
export const insertAutonomyPlannerRunSchema = createInsertSchema(autonomyPlannerRuns).omit({ id: true, createdAt: true });
export const insertAutonomyBotDecisionSchema = createInsertSchema(autonomyBotDecisions).omit({ id: true, createdAt: true });
export const insertBotStageEventSchema = createInsertSchema(botStageEvents).omit({ id: true, createdAt: true });
export const insertMatrixRunSchema = createInsertSchema(matrixRuns).omit({ id: true, createdAt: true });
export const insertMatrixCellSchema = createInsertSchema(matrixCells).omit({ id: true, createdAt: true });
export const insertBarCacheMetadataSchema = createInsertSchema(barCacheMetadata).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBotCostEventSchema = createInsertSchema(botCostEvents).omit({ id: true, createdAt: true });
export const insertLlmBudgetSchema = createInsertSchema(llmBudgets).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBotDegradationEventSchema = createInsertSchema(botDegradationEvents).omit({ id: true, createdAt: true });
export const insertSignalWeightHistorySchema = createInsertSchema(signalWeightHistory).omit({ id: true, createdAt: true });
export const insertGenerationMetricsHistorySchema = createInsertSchema(generationMetricsHistory).omit({ id: true, createdAt: true });
export const insertWalkForwardRunSchema = createInsertSchema(walkForwardRuns).omit({ id: true, createdAt: true });
export const insertStressTestPresetSchema = createInsertSchema(stressTestPresets).omit({ id: true, createdAt: true });
export const insertStressTestResultSchema = createInsertSchema(stressTestResults).omit({ id: true, createdAt: true });
export const insertPaperTradeSchema = createInsertSchema(paperTrades).omit({ id: true, createdAt: true, updatedAt: true, traceId: true });
export const insertPaperPositionSchema = createInsertSchema(paperPositions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaperTradingSessionSchema = createInsertSchema(paperTradingSessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBotAccountPnlSchema = createInsertSchema(botAccountPnl).omit({ id: true, createdAt: true, updatedAt: true });

// Research Orchestrator - Full Spectrum concurrent mode
export const researchJobStatusEnum = pgEnum("research_job_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "DEFERRED",
  "CANCELLED"
]);

export const researchCostClassEnum = pgEnum("research_cost_class", [
  "LOW",      // SENTIMENT_BURST - fast, cheap
  "MEDIUM",   // CONTRARIAN_SCAN - moderate cost
  "HIGH"      // DEEP_REASONING - expensive, thorough
]);

export const researchModeEnum = pgEnum("research_mode", [
  "CONTRARIAN_SCAN",
  "SENTIMENT_BURST", 
  "DEEP_REASONING",
  "FULL_SPECTRUM"
]);

export const researchJobs = pgTable("research_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: researchModeEnum("mode").notNull(),
  status: researchJobStatusEnum("status").default("QUEUED"),
  costClass: researchCostClassEnum("cost_class").notNull(),
  priority: integer("priority").default(50),
  
  scheduledFor: timestamp("scheduled_for"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  
  contextJson: jsonb("context_json"),
  resultJson: jsonb("result_json"),
  candidatesCreated: integer("candidates_created").default(0),
  
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(3),
  
  fingerprintHash: text("fingerprint_hash"),
  deferredReason: text("deferred_reason"),
  
  costUsd: real("cost_usd"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  
  traceId: text("trace_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertResearchJobSchema = createInsertSchema(researchJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertResearchJob = z.infer<typeof insertResearchJobSchema>;
export type ResearchJob = typeof researchJobs.$inferSelect;

// Strategy candidate fingerprints for deduplication
export const candidateFingerprints = pgTable("candidate_fingerprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  fingerprintHash: text("fingerprint_hash").notNull().unique(),
  candidateId: uuid("candidate_id").references(() => strategyCandidates.id),
  
  rulesHash: text("rules_hash"),
  hypothesisVector: text("hypothesis_vector"),
  archetypeName: text("archetype_name"),
  regimeContext: text("regime_context"),
  
  hitCount: integer("hit_count").default(1),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCandidateFingerprintSchema = createInsertSchema(candidateFingerprints).omit({
  id: true,
  createdAt: true,
});

export type InsertCandidateFingerprint = z.infer<typeof insertCandidateFingerprintSchema>;
export type CandidateFingerprint = typeof candidateFingerprints.$inferSelect;

// Orchestrator state tracking
export const researchOrchestratorState = pgTable("research_orchestrator_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  isFullSpectrumEnabled: boolean("is_full_spectrum_enabled").default(false),
  
  lastContrarianAt: timestamp("last_contrarian_at"),
  lastSentimentAt: timestamp("last_sentiment_at"),
  lastDeepReasoningAt: timestamp("last_deep_reasoning_at"),
  
  contrarianBackpressure: integer("contrarian_backpressure").default(0),
  sentimentBackpressure: integer("sentiment_backpressure").default(0),
  deepReasoningBackpressure: integer("deep_reasoning_backpressure").default(0),
  
  totalJobsToday: integer("total_jobs_today").default(0),
  totalCostToday: real("total_cost_today").default(0),
  
  providerQuotaJson: jsonb("provider_quota_json"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ResearchOrchestratorState = typeof researchOrchestratorState.$inferSelect;

// Google Drive OAuth tokens for production cloud backup
export const userGoogleDriveTokens = pgTable("user_google_drive_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id).unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  tokenType: text("token_type").default("Bearer"),
  scope: text("scope"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserGoogleDriveTokenSchema = createInsertSchema(userGoogleDriveTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertUserGoogleDriveToken = z.infer<typeof insertUserGoogleDriveTokenSchema>;
export type UserGoogleDriveToken = typeof userGoogleDriveTokens.$inferSelect;

// Evolution Tournament System - Bot competition and selection
export const tournamentStatusEnum = pgEnum("tournament_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
]);

export const tournamentCadenceEnum = pgEnum("tournament_cadence", [
  "INCREMENTAL",
  "DAILY_MAJOR"
]);

export const tournamentActionEnum = pgEnum("tournament_action", [
  "WINNER",
  "BREED",
  "MUTATE",
  "KEEP",
  "ROLLBACK",
  "PAUSE",
  "RETIRE",
  "NONE"
]);

export const evolutionTournaments = pgTable("evolution_tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  cadenceType: tournamentCadenceEnum("cadence_type").notNull(),
  status: tournamentStatusEnum("status").default("QUEUED"),
  triggeredBy: text("triggered_by").default("scheduler"),
  dryRun: boolean("dry_run").default(false),
  
  entrantsCount: integer("entrants_count").default(0),
  winnerId: uuid("winner_id"),
  winnerFitness: real("winner_fitness"),
  
  summaryJson: jsonb("summary_json").default({}),
  actionsJson: jsonb("actions_json").default({}),
  
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  
  traceId: text("trace_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tournamentEntries = pgTable("tournament_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => evolutionTournaments.id),
  botId: uuid("bot_id").notNull().references(() => bots.id),
  
  rank: integer("rank"),
  lane: text("lane"),
  symbol: text("symbol"),
  stage: text("stage"),
  
  fitnessV2: real("fitness_v2"),
  sharpeRatio: real("sharpe_ratio"),
  profitFactor: real("profit_factor"),
  winRate: real("win_rate"),
  maxDrawdownPct: real("max_drawdown_pct"),
  consistencyScore: real("consistency_score"),
  candidateScore: real("candidate_score"),
  
  actionTaken: tournamentActionEnum("action_taken").default("NONE"),
  actionReason: text("action_reason"),
  
  passedThreshold: boolean("passed_threshold").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const evolutionTournamentsRelations = relations(evolutionTournaments, ({ one, many }) => ({
  user: one(users, { fields: [evolutionTournaments.userId], references: [users.id] }),
  entries: many(tournamentEntries),
}));

export const tournamentEntriesRelations = relations(tournamentEntries, ({ one }) => ({
  tournament: one(evolutionTournaments, { fields: [tournamentEntries.tournamentId], references: [evolutionTournaments.id] }),
  bot: one(bots, { fields: [tournamentEntries.botId], references: [bots.id] }),
}));

export const insertEvolutionTournamentSchema = createInsertSchema(evolutionTournaments).omit({
  id: true,
  createdAt: true,
});

export const insertTournamentEntrySchema = createInsertSchema(tournamentEntries).omit({
  id: true,
  createdAt: true,
});

export type InsertEvolutionTournament = z.infer<typeof insertEvolutionTournamentSchema>;
export type EvolutionTournament = typeof evolutionTournaments.$inferSelect;
export type InsertTournamentEntry = z.infer<typeof insertTournamentEntrySchema>;
export type TournamentEntry = typeof tournamentEntries.$inferSelect;

// Live Eligibility Tracking - Track bots with consistent CANDIDATE passes
export const liveEligibilityTracking = pgTable("live_eligibility_tracking", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id").notNull().references(() => bots.id).unique(),
  userId: uuid("user_id").notNull().references(() => users.id),
  
  candidatePassStreak: integer("candidate_pass_streak").default(0),
  totalPasses: integer("total_passes").default(0),
  totalFails: integer("total_fails").default(0),
  
  liveEligibilityScore: real("live_eligibility_score").default(0),
  lastTournamentId: uuid("last_tournament_id"),
  lastTournamentAt: timestamp("last_tournament_at"),
  
  eligibleForLive: boolean("eligible_for_live").default(false),
  promotedToLiveAt: timestamp("promoted_to_live_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const liveEligibilityTrackingRelations = relations(liveEligibilityTracking, ({ one }) => ({
  bot: one(bots, { fields: [liveEligibilityTracking.botId], references: [bots.id] }),
  user: one(users, { fields: [liveEligibilityTracking.userId], references: [users.id] }),
}));

export const insertLiveEligibilityTrackingSchema = createInsertSchema(liveEligibilityTracking).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertLiveEligibilityTracking = z.infer<typeof insertLiveEligibilityTrackingSchema>;
export type LiveEligibilityTracking = typeof liveEligibilityTracking.$inferSelect;

// Dead Letter Queue - Industry-standard failed job handling
export const dlqStatusEnum = pgEnum("dlq_status", ["PENDING_REVIEW", "RETRY_SCHEDULED", "DISCARDED", "RESOLVED"]);

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalJobId: uuid("original_job_id").notNull().unique(),
  jobType: text("job_type").notNull(),
  botId: uuid("bot_id").references(() => bots.id),
  payload: jsonb("payload").default({}),
  failureReason: text("failure_reason").notNull(),
  failureCount: integer("failure_count").default(1),
  firstFailureAt: timestamp("first_failure_at").defaultNow(),
  lastFailureAt: timestamp("last_failure_at").defaultNow(),
  status: dlqStatusEnum("status").default("PENDING_REVIEW"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDeadLetterQueueSchema = createInsertSchema(deadLetterQueue).omit({
  id: true,
  createdAt: true,
});

export type DeadLetterQueueEntry = typeof deadLetterQueue.$inferSelect;
export type InsertDeadLetterQueueEntry = z.infer<typeof insertDeadLetterQueueSchema>;

// Cryptographic Audit Chain - Tamper-evident audit trail
export const auditChain = pgTable("audit_chain", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequenceNumber: integer("sequence_number").notNull().unique(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor"),
  payload: jsonb("payload").default({}),
  previousHash: varchar("previous_hash", { length: 64 }).notNull(),
  currentHash: varchar("current_hash", { length: 64 }).notNull(),
});

export const insertAuditChainSchema = createInsertSchema(auditChain).omit({
  id: true,
});

export type AuditChainRecord = typeof auditChain.$inferSelect;
export type InsertAuditChainRecord = z.infer<typeof insertAuditChainSchema>;

// Consistency Sweep Results - Track scheduled integrity checks
export const consistencySweepStatusEnum = pgEnum("consistency_sweep_status", ["RUNNING", "COMPLETED", "FAILED"]);

export const consistencySweeps = pgTable("consistency_sweeps", {
  id: uuid("id").primaryKey().defaultRandom(),
  traceId: text("trace_id").notNull(),
  status: consistencySweepStatusEnum("status").default("RUNNING"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  totalChecked: integer("total_checked").default(0),
  issuesFound: integer("issues_found").default(0),
  autoHealed: integer("auto_healed").default(0),
  criticalCount: integer("critical_count").default(0),
  warningCount: integer("warning_count").default(0),
  report: jsonb("report").default({}),
});

export const insertConsistencySweepSchema = createInsertSchema(consistencySweeps).omit({
  id: true,
});

export type ConsistencySweep = typeof consistencySweeps.$inferSelect;
export type InsertConsistencySweep = z.infer<typeof insertConsistencySweepSchema>;

// System Settings - Versioned configuration persistence (prevents dev/prod drift)
export const systemSettings = pgTable("system_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(), // e.g., "strategy_lab", "research_orchestrator", "risk"
  key: text("key").notNull(), // e.g., "min_confidence_threshold", "uniqueness_cutoff"
  value: jsonb("value").notNull(), // JSON value for flexibility
  description: text("description"), // Human-readable description
  defaultValue: jsonb("default_value"), // Code default for reconciliation
  version: integer("version").default(1), // Version for audit trail
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
  lastUpdatedBy: text("last_updated_by"), // "system" or user identifier
});

export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  lastUpdatedAt: true,
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type AccountAttempt = typeof accountAttempts.$inferSelect;
export type InsertAccountAttempt = z.infer<typeof insertAccountAttemptSchema>;
export interface EnrichedAccount extends Account {
  computedBalance: number;
  totalBotPnl: number;
  botsPnlCount: number;
}
export type BotAccount = typeof botAccounts.$inferSelect;
export type InsertBotAccount = z.infer<typeof insertBotAccountSchema>;
export type Bot = typeof bots.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type BotGeneration = typeof botGenerations.$inferSelect;
export type InsertBotGeneration = z.infer<typeof insertBotGenerationSchema>;
export type BacktestSession = typeof backtestSessions.$inferSelect;
export type InsertBacktestSession = z.infer<typeof insertBacktestSessionSchema>;
export type BotJob = typeof botJobs.$inferSelect;
export type InsertBotJob = z.infer<typeof insertBotJobSchema>;
export type JobRunEvent = typeof jobRunEvents.$inferSelect;
export type InsertJobRunEvent = z.infer<typeof insertJobRunEventSchema>;
export type BotInstance = typeof botInstances.$inferSelect;
export type InsertBotInstance = z.infer<typeof insertBotInstanceSchema>;
export type TradeLog = typeof tradeLogs.$inferSelect;
export type InsertTradeLog = z.infer<typeof insertTradeLogSchema>;
export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type StrategyArchetype = typeof strategyArchetypes.$inferSelect;
export type SystemEvent = typeof systemEvents.$inferSelect;
export type AuditReport = typeof auditReports.$inferSelect;
export type EconomicEvent = typeof economicEvents.$inferSelect;
export type InsertEconomicEvent = typeof economicEvents.$inferInsert;
export type AutonomyLoop = typeof autonomyLoops.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type KillEvent = typeof killEvents.$inferSelect;
export type InsertKillEvent = z.infer<typeof insertKillEventSchema>;
export type Instrument = typeof instruments.$inferSelect;
export type InsertInstrument = z.infer<typeof insertInstrumentSchema>;
export type BrokerAccountEvent = typeof brokerAccountEvents.$inferSelect;
export type InsertBrokerAccountEvent = z.infer<typeof insertBrokerAccountEventSchema>;
export type EvaluationRun = typeof evaluationRuns.$inferSelect;
export type InsertEvaluationRun = z.infer<typeof insertEvaluationRunSchema>;
export type BotStageChange = typeof botStageChanges.$inferSelect;
export type InsertBotStageChange = z.infer<typeof insertBotStageChangeSchema>;
export type SchedulerState = typeof schedulerState.$inferSelect;
export type InsertSchedulerState = z.infer<typeof insertSchedulerStateSchema>;
export type UserSecurity = typeof userSecurity.$inferSelect;
export type InsertUserSecurity = z.infer<typeof insertUserSecuritySchema>;
export type ReadinessRun = typeof readinessRuns.$inferSelect;
export type InsertReadinessRun = z.infer<typeof insertReadinessRunSchema>;
export type IntegrationUsageEvent = typeof integrationUsageEvents.$inferSelect;
export type InsertIntegrationUsageEvent = z.infer<typeof insertIntegrationUsageEventSchema>;
export type LlmUsage = typeof llmUsage.$inferSelect;
export type InsertLlmUsage = z.infer<typeof insertLlmUsageSchema>;
export type DecisionTrace = typeof decisionTraces.$inferSelect;
export type InsertDecisionTrace = z.infer<typeof insertDecisionTraceSchema>;
export type NoTradeTrace = typeof noTradeTraces.$inferSelect;
export type InsertNoTradeTrace = z.infer<typeof insertNoTradeTraceSchema>;
export type AutonomyScore = typeof autonomyScores.$inferSelect;
export type InsertAutonomyScore = z.infer<typeof insertAutonomyScoreSchema>;
export type ProfitVariable = typeof profitVariables.$inferSelect;
export type InsertProfitVariable = z.infer<typeof insertProfitVariableSchema>;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type AutonomyPlannerRun = typeof autonomyPlannerRuns.$inferSelect;
export type InsertAutonomyPlannerRun = z.infer<typeof insertAutonomyPlannerRunSchema>;
export type AutonomyBotDecision = typeof autonomyBotDecisions.$inferSelect;
export type InsertAutonomyBotDecision = z.infer<typeof insertAutonomyBotDecisionSchema>;
export type BotStageEvent = typeof botStageEvents.$inferSelect;
export type InsertBotStageEvent = z.infer<typeof insertBotStageEventSchema>;
export type MatrixRun = typeof matrixRuns.$inferSelect;
export type InsertMatrixRun = z.infer<typeof insertMatrixRunSchema>;
export type MatrixCell = typeof matrixCells.$inferSelect;
export type InsertMatrixCell = z.infer<typeof insertMatrixCellSchema>;
export type BarCacheMetadata = typeof barCacheMetadata.$inferSelect;
export type InsertBarCacheMetadata = z.infer<typeof insertBarCacheMetadataSchema>;
export type BotCostEvent = typeof botCostEvents.$inferSelect;
export type InsertBotCostEvent = z.infer<typeof insertBotCostEventSchema>;
export type LlmBudget = typeof llmBudgets.$inferSelect;
export type InsertLlmBudget = z.infer<typeof insertLlmBudgetSchema>;
export type BotDegradationEvent = typeof botDegradationEvents.$inferSelect;
export type InsertBotDegradationEvent = z.infer<typeof insertBotDegradationEventSchema>;
export type GenerationMetricsHistory = typeof generationMetricsHistory.$inferSelect;
export type InsertGenerationMetricsHistory = z.infer<typeof insertGenerationMetricsHistorySchema>;
export type WalkForwardRun = typeof walkForwardRuns.$inferSelect;
export type InsertWalkForwardRun = z.infer<typeof insertWalkForwardRunSchema>;
export type StressTestPreset = typeof stressTestPresets.$inferSelect;
export type InsertStressTestPreset = z.infer<typeof insertStressTestPresetSchema>;
export type StressTestResult = typeof stressTestResults.$inferSelect;
export type InsertStressTestResult = z.infer<typeof insertStressTestResultSchema>;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type PaperPosition = typeof paperPositions.$inferSelect;
export type InsertPaperPosition = z.infer<typeof insertPaperPositionSchema>;
export type PaperTradingSession = typeof paperTradingSessions.$inferSelect;
export type InsertPaperTradingSession = z.infer<typeof insertPaperTradingSessionSchema>;
export type BotAccountPnl = typeof botAccountPnl.$inferSelect;
export type InsertBotAccountPnl = z.infer<typeof insertBotAccountPnlSchema>;

export interface AccountWithBotsPnl extends Account {
  computedBalance: number;
  totalBotPnl: number;
  botsPnl: BotAccountPnl[];
}
