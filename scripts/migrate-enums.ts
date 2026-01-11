#!/usr/bin/env tsx
/**
 * Enum Migration Script - Industry Standard Pre-Deploy Migration
 * 
 * This script safely adds any missing enum values to the production database.
 * It's designed to be idempotent - safe to run multiple times.
 * 
 * Usage: npm run db:migrate-enums
 * 
 * Should be configured as Render's Pre-Deploy Command to run before each deployment.
 * 
 * IMPORTANT: Keep this file in sync with shared/schema.ts
 * When adding new enum values to shared/schema.ts, add them here too.
 */

import pg from "pg";

const { Pool } = pg;

// All enum definitions from shared/schema.ts
// MUST be kept in sync with schema changes
const ENUM_DEFINITIONS: Record<string, string[]> = {
  // Core enums (lines 7-35)
  account_provider: ["INTERNAL", "IRONBEAM", "TRADOVATE", "OTHER"],
  account_type: ["SIM", "LIVE", "VIRTUAL"],
  alert_category: [
    "PROMOTION_READY", "LIVE_PROMOTION_RECOMMENDED", "BOT_DEGRADED", "BOT_STALLED",
    "DATA_HEALTH", "EXECUTION_RISK", "ACCOUNT_RISK_BREACH", "ARBITER_DECISION_ANOMALY"
  ],
  alert_entity_type: ["BOT", "ACCOUNT", "SYSTEM", "TRADE"],
  alert_severity: ["INFO", "WARN", "CRITICAL"],
  alert_source: ["promotion_engine", "risk_engine", "arbiter", "data_hub", "system"],
  alert_status: ["OPEN", "ACKED", "SNOOZED", "DISMISSED", "RESOLVED"],
  app_role: ["admin", "user"],
  bias_type: ["bullish", "bearish", "neutral", "mixed"],
  bot_mode: ["BACKTEST_ONLY", "SIM_LIVE", "SHADOW", "LIVE"],
  bot_status: ["idle", "running", "paused", "error", "stopped"],
  data_feed_mode: ["HISTORICAL_DATA", "LIVE_DATA"],
  event_severity: ["info", "warning", "error", "critical"],
  evolution_mode: ["auto", "locked", "paused"],
  evolution_status: ["untested", "backtesting", "sim_ready", "sim_live", "shadow", "live", "retired"],
  order_side: ["BUY", "SELL"],
  order_status: ["pending", "submitted", "filled", "partial", "cancelled", "rejected"],
  order_type: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT"],
  provider_status: ["connected", "degraded", "disconnected", "error"],
  provider_type: ["data", "broker"],
  risk_tier: ["conservative", "moderate", "aggressive"],
  signal_type: ["entry", "exit", "scale_in", "scale_out", "stop_adjustment"],
  session_mode: ["FULL_24x5", "RTH_US", "ETH", "CUSTOM"],
  rules_profile: ["PRODUCTION", "LAB_RELAXED", "TRIALS_RELAXED"],
  
  // AI Provider enum (line 38)
  ai_provider: ["PERPLEXITY", "GROK", "OPENAI", "ANTHROPIC", "GEMINI", "OPENROUTER", "OTHER"],
  
  // Walk-forward & backtesting enums (lines 49-71)
  segment_type: ["TRAINING", "TESTING", "VALIDATION", "STRESS_TEST", "FULL_RANGE"],
  market_regime: ["BULL", "BEAR", "SIDEWAYS", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNKNOWN"],
  walk_forward_status: ["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"],
  
  // Health and account attempt enums (lines 148-156)
  health_state: ["OK", "WARN", "DEGRADED"],
  account_attempt_status: ["ACTIVE", "BLOWN", "RETIRED", "GRADUATED"],
  
  // Job status enum (line 471)
  job_status: ["CREATED", "QUEUED", "RUNNING", "DEGRADED", "BLOCKED", "COMPLETED", "FAILED", "CANCELED", "TIMEOUT"],
  
  // Activity and job type enums (lines 515-516)
  activity_state: ["IDLE", "SCANNING", "IN_TRADE", "EXITING", "STOPPED", "ERROR", "MAINTENANCE", "MARKET_CLOSED"],
  job_type: ["RUNNER", "BACKTESTER", "EVOLVER", "RECONCILER"],
  
  // Strategy Lab enums (lines 624-693)
  candidate_disposition: [
    "PENDING_REVIEW", "QUEUED_FOR_QC", "SENT_TO_LAB", "QUEUED", 
    "READY", "REJECTED", "MERGED", "EXPIRED", "RECYCLED"
  ],
  rejection_reason: [
    "TOO_RISKY", "UNCLEAR_EDGE", "POOR_TIMING", "DUPLICATE_STRATEGY",
    "LOW_CONFIDENCE", "NOT_NOVEL", "BAD_MARKET_FIT", "OTHER"
  ],
  novelty_tier: ["LOW", "MODERATE", "HIGH", "BREAKTHROUGH"],
  candidate_source: [
    "SCHEDULED_RESEARCH", "BURST_RESEARCH", "LAB_FEEDBACK", 
    "REGIME_SHIFT", "MANUAL", "EXTERNAL_AI", "GROK_RESEARCH"
  ],
  source_tier: ["PRIMARY", "SECONDARY", "TERTIARY"],
  regime_trigger: [
    "VOLATILITY_SPIKE", "VOLATILITY_COMPRESSION", "TRENDING_STRONG",
    "RANGE_BOUND", "LIQUIDITY_THIN", "NEWS_SHOCK", "MACRO_EVENT_CLUSTER", "NONE"
  ],
  research_depth: ["QUICK", "BALANCED", "DEEP"],
  search_recency: ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"],
  
  // QuantConnect enums (lines 696-709)
  qc_run_status: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"],
  qc_badge_state: ["VERIFIED", "DIVERGENT", "INCONCLUSIVE", "FAILED", "QC_BYPASSED"],
  
  // Lab feedback state enum (line 789)
  lab_feedback_state: [
    "IDLE", "FAILURE_DETECTED", "RESEARCHING_REPLACEMENT", "RESEARCHING_REPAIR",
    "CANDIDATE_FOUND", "CANDIDATE_TESTING", "RESOLVED", "ABANDONED"
  ],
  
  // Kill event type enum (line 899)
  kill_event_type: ["KILL", "RESURRECT"],
  
  // Broker account event type enum (line 929)
  broker_account_event_type: ["LINK", "UNLINK", "UPDATE", "VERIFY"],
  
  // Temp token purpose enum (line 1085)
  temp_token_purpose: ["2FA_LOGIN", "PASSWORD_RESET", "EMAIL_VERIFY"],
  
  // Usage event status enum (line 1117)
  usage_event_status: ["OK", "ERROR", "BLOCKED", "TIMEOUT"],
  
  // Suppression enums (lines 1232-1233)
  suppression_type: ["RISK", "AI", "DATA", "RULE", "AUTONOMY_GATE", "EXECUTION"],
  suppression_decision: ["BLOCKED", "DEFERRED"],
  
  // Autonomy tier enum (line 1249)
  autonomy_tier: ["LOCKED", "SUPERVISED", "SEMI_AUTONOMOUS", "FULL_AUTONOMY"],
  
  // Variable state enum (line 1266)
  variable_state: ["ACTIVE", "STALE", "BLOCKED"],
  
  // Promotion decision enum (line 1270)
  promotion_decision: ["PROMOTE", "DEMOTE", "HOLD", "BLOCKED"],
  
  // Activity event type enum (lines 1481-1507)
  activity_event_type: [
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
  ],
  
  // Activity severity enum (line 1509)
  activity_severity: ["INFO", "WARN", "ERROR", "CRITICAL", "SUCCESS"],
  
  // Grok feedback event type enum (lines 1562-1571)
  grok_feedback_event_type: [
    "PROMOTION", "DEMOTION", "GATE_PASSED", "GATE_FAILED",
    "MILESTONE", "EVOLUTION_TRIGGERED", "STRATEGY_RETIRED", "LIVE_PERFORMANCE"
  ],
  
  // Matrix run status enum (line 1608)
  matrix_run_status: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  
  // LLM provider enum (lines 1691-1693)
  llm_provider: ["groq", "openai", "anthropic", "gemini", "xai", "openrouter", "perplexity"],
  
  // Cost category enum (lines 1696-1698)
  cost_category: ["llm", "data_market", "data_options", "data_macro", "data_news", "compute"],
  
  // Degradation reason enum (lines 1733-1742)
  degradation_reason: [
    "EDGE_DECAY", "DRAWDOWN_BREACH", "WIN_RATE_COLLAPSE", "PROFIT_FACTOR_BREACH",
    "VOLATILITY_SPIKE", "SIGNAL_INSTABILITY", "DATA_QUALITY_ISSUE", "MANUAL_DEMOTION"
  ],
  
  // Paper trade enums (lines 1817-1818)
  paper_trade_status: ["OPEN", "CLOSED", "CANCELLED"],
  paper_position_status: ["FLAT", "LONG", "SHORT"],
  
  // Governance approval status enum (lines 1945-1951)
  governance_approval_status: ["PENDING", "APPROVED", "REJECTED", "EXPIRED", "WITHDRAWN"],
  
  // Model validation status enum (lines 1984-1989)
  model_validation_status: ["PENDING", "VALIDATED", "REJECTED", "NEEDS_REVISION"],
  
  // Research orchestrator enums (lines 2613-2633)
  research_job_status: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "DEFERRED", "CANCELLED"],
  research_cost_class: ["LOW", "MEDIUM", "HIGH"],
  research_mode: ["CONTRARIAN_SCAN", "SENTIMENT_BURST", "DEEP_REASONING", "FULL_SPECTRUM"],
  
  // Tournament enums (lines 2748-2770)
  tournament_status: ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"],
  tournament_cadence: ["INCREMENTAL", "DAILY_MAJOR"],
  tournament_action: ["WINNER", "BREED", "MUTATE", "KEEP", "ROLLBACK", "PAUSE", "RETIRE", "NONE"],
  
  // Dead letter queue status enum (line 2881)
  dlq_status: ["PENDING_REVIEW", "RETRY_SCHEDULED", "DISCARDED", "RESOLVED"],
  
  // Consistency sweep status enum (line 2931)
  consistency_sweep_status: ["RUNNING", "COMPLETED", "FAILED"],
};

async function getPostgresVersion(pool: pg.Pool): Promise<number> {
  const result = await pool.query("SHOW server_version_num");
  return parseInt(result.rows[0].server_version_num, 10);
}

async function getExistingEnumValues(pool: pg.Pool, enumName: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT enumlabel FROM pg_enum 
     WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = $1)
     ORDER BY enumsortorder`,
    [enumName]
  );
  return result.rows.map(row => row.enumlabel);
}

async function enumExists(pool: pg.Pool, enumName: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM pg_type WHERE typname = $1`,
    [enumName]
  );
  return result.rows.length > 0;
}

async function addEnumValue(pool: pg.Pool, enumName: string, value: string, pgVersion: number): Promise<boolean> {
  try {
    if (pgVersion >= 150000) {
      // Postgres 15+ supports IF NOT EXISTS
      await pool.query(`ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS '${value}'`);
    } else {
      // For older versions, check if value exists first
      const existing = await getExistingEnumValues(pool, enumName);
      if (!existing.includes(value)) {
        await pool.query(`ALTER TYPE ${enumName} ADD VALUE '${value}'`);
      }
    }
    return true;
  } catch (error: any) {
    // Value already exists (for Postgres < 15)
    if (error.code === '42710') {
      return false; // Already exists, not an error
    }
    throw error;
  }
}

async function migrateEnums(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error("[MIGRATE-ENUMS] ERROR: DATABASE_URL not set");
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: databaseUrl,
    max: 1, // Single connection for migration
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  console.log("[MIGRATE-ENUMS] Starting enum migration...");
  console.log(`[MIGRATE-ENUMS] Total enum types to check: ${Object.keys(ENUM_DEFINITIONS).length}`);
  
  try {
    const pgVersion = await getPostgresVersion(pool);
    console.log(`[MIGRATE-ENUMS] PostgreSQL version: ${pgVersion} (supports IF NOT EXISTS: ${pgVersion >= 150000})`);
    
    let totalAdded = 0;
    let totalSkipped = 0;
    let enumsProcessed = 0;
    let enumsNotInDb = 0;

    for (const [enumName, expectedValues] of Object.entries(ENUM_DEFINITIONS)) {
      // Check if enum exists
      const exists = await enumExists(pool, enumName);
      if (!exists) {
        console.log(`[MIGRATE-ENUMS] SKIP: Enum '${enumName}' does not exist in database (will be created by Drizzle)`);
        enumsNotInDb++;
        continue;
      }

      const existingValues = await getExistingEnumValues(pool, enumName);
      const missingValues = expectedValues.filter(v => !existingValues.includes(v));

      if (missingValues.length === 0) {
        totalSkipped++;
        continue;
      }

      console.log(`[MIGRATE-ENUMS] Enum '${enumName}': Adding ${missingValues.length} missing values: ${missingValues.join(", ")}`);
      
      for (const value of missingValues) {
        const added = await addEnumValue(pool, enumName, value, pgVersion);
        if (added) {
          console.log(`[MIGRATE-ENUMS]   + Added '${value}' to ${enumName}`);
          totalAdded++;
        }
      }
      
      enumsProcessed++;
    }

    console.log(`[MIGRATE-ENUMS] Migration complete:`);
    console.log(`[MIGRATE-ENUMS]   - Enums updated: ${enumsProcessed}`);
    console.log(`[MIGRATE-ENUMS]   - Values added: ${totalAdded}`);
    console.log(`[MIGRATE-ENUMS]   - Enums unchanged: ${totalSkipped}`);
    console.log(`[MIGRATE-ENUMS]   - Enums not in DB yet: ${enumsNotInDb}`);
    
  } catch (error) {
    console.error("[MIGRATE-ENUMS] Migration failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
migrateEnums()
  .then(() => {
    console.log("[MIGRATE-ENUMS] Success - enum migration completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[MIGRATE-ENUMS] Fatal error:", error);
    process.exit(1);
  });
