import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { sql } from "drizzle-orm";

const { Pool } = pg;

// Build DATABASE_URL from individual components (AWS ECS style) or use existing
function buildDatabaseUrl(): string {
  // If DATABASE_URL is already set, use it (Replit / local dev)
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // AWS ECS style: Build URL from individual environment variables
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  
  if (host && name && user && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
  }
  
  throw new Error(
    "Database configuration missing. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD.",
  );
}

function buildReaderDatabaseUrl(): string | undefined {
  // If DATABASE_READER_URL is set, use it
  if (process.env.DATABASE_READER_URL) {
    return process.env.DATABASE_READER_URL;
  }
  
  // AWS ECS style: Build from individual reader host
  const readerHost = process.env.DB_READER_HOST;
  if (!readerHost) return undefined;
  
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  
  if (name && user && password) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${readerHost}:${port}/${name}`;
  }
  
  return undefined;
}

const DATABASE_URL = buildDatabaseUrl();
const DATABASE_READER_URL = buildReaderDatabaseUrl();

// SEV-1: Log DATABASE_URL host telemetry at startup (for debugging connection issues)
try {
  const dbUrl = new URL(DATABASE_URL);
  const hostInfo = dbUrl.hostname || dbUrl.host;
  const isPooler = hostInfo.includes('-pooler');
  const isReplitInternal = hostInfo === 'helium' || hostInfo.includes('replit');
  const hasReader = !!DATABASE_READER_URL;
  console.log(`[DB_CONFIG] host=${hostInfo} port=${dbUrl.port || 5432} pooler=${isPooler} replit_managed=${isReplitInternal} reader=${hasReader}`);
} catch (e) {
  console.log('[DB_CONFIG] Could not parse DATABASE_URL for telemetry');
}

// INDUSTRY-STANDARD: Dual-pool architecture for mixed workloads
// - poolWeb: High-priority pool for user-facing requests (auth, API)
// - pool: Worker pool for background jobs (backtests, runners)
// This prevents background workers from starving user requests

// All pool settings configurable via environment variables for production tuning
// RENDER FIX: Reduced pool sizes to prevent connection saturation
// Render Standard databases typically only allow ~20 connections
// Previous: web=12, worker=8, writer=4 (24 total) caused timeouts
// New: web=5, worker=4, writer=2 (11 total) leaves headroom
const STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_WEB_MS || "5000", 10);
const STATEMENT_TIMEOUT_WORKERS_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_WORKER_MS || "15000", 10);
// COLD START FIX: Increase connection timeout to 30s for Replit/Render cold starts
// Database can take 20+ seconds to wake up from idle state
const CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_WEB_MS || "30000", 10);
const CONNECTION_TIMEOUT_WORKERS_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_WORKER_MS || "30000", 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS || "20000", 10);
const POOL_WEB_MAX = parseInt(process.env.DB_POOL_WEB_MAX || "5", 10);
const POOL_WORKER_MAX = parseInt(process.env.DB_POOL_WORKER_MAX || "4", 10);
const POOL_WRITER_MAX = parseInt(process.env.DB_POOL_WRITER_MAX || "2", 10);

console.log(`[DB_POOL] Config: web_max=${POOL_WEB_MAX} worker_max=${POOL_WORKER_MAX} idle_timeout=${IDLE_TIMEOUT_MS}ms`);

// HIGH-PRIORITY: Web/Auth pool - reserved for user-facing requests
// Increased to handle concurrent API load without starvation
export const poolWeb = new Pool({ 
  connectionString: DATABASE_URL,
  max: POOL_WEB_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: true,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
});

// WORKER POOL: Background jobs (backtests, runners, evolution)
// Uses reader endpoint if available for read-heavy workloads
// Increased to prevent connection starvation during heavy workloads
export const pool = new Pool({ 
  connectionString: DATABASE_READER_URL || DATABASE_URL,
  max: POOL_WORKER_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_WORKERS_MS,
  allowExitOnIdle: true,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_WORKERS_MS}`,
});

// Writer pool for worker mutations (when using reader for reads)
export const poolWriter = DATABASE_READER_URL ? new Pool({ 
  connectionString: DATABASE_URL,
  max: POOL_WRITER_MAX,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_WORKERS_MS,
  allowExitOnIdle: true,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_WORKERS_MS}`,
}) : pool;

poolWeb.on('error', (err) => {
  console.error('[DB_POOL_WEB] Unexpected pool error:', err.message);
});

pool.on('error', (err) => {
  console.error('[DB_POOL] Unexpected pool error:', err.message);
  openCircuit();
});

let queryMetricsRecorder: ((metric: { queryType: string; durationMs: number; timestamp: number; success: boolean; errorCode?: string }) => void) | null = null;

export function registerQueryMetricsRecorder(recorder: typeof queryMetricsRecorder): void {
  queryMetricsRecorder = recorder;
}

function instrumentPool(targetPool: typeof pool, poolName: string): typeof pool {
  const originalQuery = targetPool.query.bind(targetPool);
  
  (targetPool as any).query = async (...args: any[]) => {
    const startTime = Date.now();
    try {
      const result = await originalQuery(...args);
      const durationMs = Date.now() - startTime;
      
      if (queryMetricsRecorder) {
        queryMetricsRecorder({
          queryType: poolName,
          durationMs,
          timestamp: Date.now(),
          success: true,
        });
      }
      
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      if (queryMetricsRecorder) {
        queryMetricsRecorder({
          queryType: poolName,
          durationMs,
          timestamp: Date.now(),
          success: false,
          errorCode: (error as any)?.code || 'UNKNOWN',
        });
      }
      
      throw error;
    }
  };
  
  return targetPool;
}

instrumentPool(pool, 'worker');
instrumentPool(poolWeb, 'web');
if (DATABASE_READER_URL && poolWriter !== pool) {
  instrumentPool(poolWriter, 'writer');
}

// Drizzle instances for each pool
export const dbWeb = drizzle(poolWeb, { schema }); // For auth/web requests
export const db = drizzle(pool, { schema }); // For workers

export { STATEMENT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS };

/**
 * Get live pool statistics for monitoring connection usage
 * Critical for diagnosing connection saturation on Render
 */
export function getPoolStats(): {
  web: { total: number; idle: number; waiting: number };
  worker: { total: number; idle: number; waiting: number };
  writer: { total: number; idle: number; waiting: number };
  config: { webMax: number; workerMax: number; writerMax: number; connectionTimeout: number };
} {
  return {
    web: {
      total: poolWeb.totalCount,
      idle: poolWeb.idleCount,
      waiting: poolWeb.waitingCount,
    },
    worker: {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    },
    writer: {
      total: poolWriter.totalCount,
      idle: poolWriter.idleCount,
      waiting: poolWriter.waitingCount,
    },
    config: {
      webMax: POOL_WEB_MAX,
      workerMax: POOL_WORKER_MAX,
      writerMax: POOL_WRITER_MAX,
      connectionTimeout: CONNECTION_TIMEOUT_WORKERS_MS,
    },
  };
}

// Database connection state tracking with circuit breaker pattern
let _dbWarmedUp = false;
let _circuitOpen = false;
let _lastFailureTime = 0;
const CIRCUIT_RESET_MS = 30000; // Try again after 30s when circuit is open

/**
 * Industry-standard circuit breaker pattern for database connections
 * Prevents cascading failures when database is unavailable
 */
export function isCircuitOpen(): boolean {
  if (!_circuitOpen) return false;
  // Auto-reset circuit after CIRCUIT_RESET_MS
  if (Date.now() - _lastFailureTime > CIRCUIT_RESET_MS) {
    console.log('[DB_CIRCUIT] Circuit auto-reset - allowing retry');
    _circuitOpen = false;
    return false;
  }
  return true;
}

export function openCircuit(): void {
  _circuitOpen = true;
  _lastFailureTime = Date.now();
  console.log('[DB_CIRCUIT] Circuit OPENED - database operations will be skipped');
}

export function closeCircuit(): void {
  _circuitOpen = false;
  console.log('[DB_CIRCUIT] Circuit CLOSED - database operations resumed');
}

/**
 * Warm up the database connection with exponential backoff retry
 * Industry-standard implementation with circuit breaker integration
 * Uses web pool (higher priority) for faster initial connection
 */
export async function warmupDatabase(): Promise<boolean> {
  const MAX_RETRIES = 5; // 5 attempts with increasing delays
  const INITIAL_DELAY_MS = 3000; // Start with 3s delay
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[DB_WARMUP] Attempt ${attempt}/${MAX_RETRIES} - connecting to database...`);
      // Use web pool (higher priority) for warmup to avoid worker queue contention
      const client = await poolWeb.connect();
      await client.query('SELECT 1');
      client.release();
      console.log(`[DB_WARMUP] Database connection established successfully`);
      _dbWarmedUp = true;
      closeCircuit();
      return true;
    } catch (error) {
      // Delays: 3s, 6s, 12s, 24s, 48s (caps at 30s)
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), 30000);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[DB_WARMUP] Attempt ${attempt}/${MAX_RETRIES} failed: ${errorMessage}`);
      
      if (attempt < MAX_RETRIES) {
        console.log(`[DB_WARMUP] Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error('[DB_WARMUP] Failed to establish database connection after all retries');
  openCircuit();
  return false;
}

/**
 * Check if the database has been warmed up
 */
export function isDatabaseWarmedUp(): boolean {
  return _dbWarmedUp;
}

// Type for the transaction context
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * INSTITUTIONAL: Transaction wrapper for multi-step operations
 * Ensures atomic execution with automatic rollback on failure
 * 
 * NOTE: Errors thrown inside fn will automatically rollback and propagate
 * Callers should use try/catch to handle transaction failures
 * 
 * Usage:
 * try {
 *   const result = await withTransaction(async (tx) => {
 *     await tx.update(table).set({ ... }).where(...);
 *     await tx.insert(other).values({ ... });
 *     return { success: true };
 *   });
 * } catch (error) {
 *   // Transaction rolled back
 * }
 */
export async function withTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
  options?: {
    isolationLevel?: 'read committed' | 'read uncommitted' | 'repeatable read' | 'serializable';
    accessMode?: 'read write' | 'read only';
  }
): Promise<T> {
  return db.transaction(fn, options);
}

/**
 * Transaction wrapper with logging for critical operations
 * Logs start/success/failure with trace ID for audit trail
 * 
 * NOTE: This wrapper catches and re-throws errors for proper propagation
 * The logged trace allows debugging failed transactions
 */
export async function withTracedTransaction<T>(
  traceId: string,
  operationName: string,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  console.log(`[TX:${traceId}] ${operationName} START`);
  
  try {
    const result = await db.transaction(fn);
    console.log(`[TX:${traceId}] ${operationName} COMMITTED`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[TX:${traceId}] ${operationName} ROLLBACK: ${errorMessage}`);
    throw error; // Re-throw for caller to handle
  }
}

/**
 * INSTITUTIONAL: Schema validation at startup
 * Validates that critical tables have expected columns to catch schema drift early
 * This prevents runtime SQL errors like "column X does not exist"
 * Includes retry logic to handle Neon serverless cold starts
 */
export async function validateSchemaAtStartup(): Promise<{ valid: boolean; errors: string[] }> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 5000; // 5 seconds between retries
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptSchemaValidation();
    if (result.valid || attempt === MAX_RETRIES) {
      return result;
    }
    console.log(`[SCHEMA_VALIDATION] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
  }
  
  return { valid: false, errors: ['[SCHEMA_VALIDATION] All retry attempts exhausted'] };
}

async function attemptSchemaValidation(): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  // Define expected columns for critical tables used in raw SQL queries
  const expectedSchema: Record<string, string[]> = {
    paper_trades: [
      'id', 'bot_id', 'bot_instance_id', 'account_id', 'symbol', 'side',
      'quantity', 'entry_price', 'exit_price', 'stop_price', 'target_price',
      'entry_time', 'exit_time', 'pnl', 'pnl_percent', 'fees', 'slippage',
      'status', 'entry_reason_code', 'exit_reason_code', 'entry_bar_time',
      'exit_bar_time', 'signal_context', 'trace_id', 'created_at', 'updated_at',
      'account_attempt_id'
    ],
    account_attempts: [
      'id', 'account_id', 'attempt_number', 'status', 'starting_balance',
      'ending_balance', 'peak_balance', 'lowest_balance', 'blown_at',
      'blown_reason', 'metrics_snapshot', 'created_at'
    ],
    bot_instances: [
      'id', 'bot_id', 'account_id', 'execution_mode', 'status', 'is_active',
      'last_heartbeat_at', 'state_json', 'created_at', 'updated_at',
      'job_type', 'activity_state', 'is_primary_runner', 'started_at', 'stopped_at'
    ],
    bots: [
      'id', 'user_id', 'name', 'symbol', 'status', 'mode', 'stage',
      'current_generation_id', 'health_score', 'live_pnl', 'live_total_trades',
      'live_win_rate', 'blocker_code', 'created_at', 'updated_at'
    ],
    bot_generations: [
      'id', 'bot_id', 'generation_number', 'strategy_config', 'risk_config',
      'fitness_score', 'created_at', 'timeframe'
    ],
    backtest_sessions: [
      'id', 'bot_id', 'generation_id', 'status', 'symbol', 'net_pnl',
      'total_trades', 'win_rate', 'profit_factor', 'sharpe_ratio',
      'max_drawdown', 'max_drawdown_pct', 'completed_at', 'created_at'
    ],
    activity_events: [
      'id', 'created_at', 'user_id', 'bot_id', 'event_type', 'severity',
      'stage', 'symbol', 'account_id', 'provider', 'trace_id', 'title', 
      'summary', 'payload', 'dedupe_key'
    ],
    strategy_candidates: [
      'id', 'strategy_name', 'archetype_name', 'hypothesis', 'rules_json', 'disposition',
      'confidence_score', 'novelty_score', 'ai_provider', 'created_at'
    ],
    ai_requests: [
      'id', 'provider', 'model', 'success', 'tokens_in', 'tokens_out',
      'latency_ms', 'error_message', 'purpose', 'created_at'
    ]
  };
  
  // Define expected enum values for critical enums (prevents dev/prod drift)
  const expectedEnums: Record<string, string[]> = {
    activity_event_type: [
      "TRADE_EXECUTED", "TRADE_EXITED", "ORDER_BLOCKED_RISK",
      "PROMOTED", "DEMOTED", "GRADUATED",
      "BACKTEST_STARTED", "BACKTEST_COMPLETED", "BACKTEST_FAILED",
      "RUNNER_STARTED", "RUNNER_RESTARTED", "RUNNER_STOPPED",
      "JOB_TIMEOUT", "KILL_TRIGGERED", "KILL_SWITCH",
      "AUTONOMY_TIER_CHANGED", "AUTONOMY_GATE_BLOCKED",
      "INTEGRATION_VERIFIED", "INTEGRATION_USAGE_PROOF",
      "INTEGRATION_ERROR", "INTEGRATION_PROOF",
      "NOTIFY_DISCORD_SENT", "NOTIFY_DISCORD_FAILED",
      "SYSTEM_STATUS_CHANGED", "BOT_CREATED", "BOT_ARCHIVED", "BOT_AUTO_REVERTED",
      "EVOLUTION_COMPLETED", "EVOLUTION_CONVERGED", "EVOLUTION_RESUMED", "STRATEGY_MUTATED",
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
      "RESEARCH_ORCHESTRATOR_TOGGLE", "RESEARCH_ORCHESTRATOR_STARTED",
      "SYSTEM_AUDIT", "RESEARCH_JOB_COMPLETED"
    ],
    candidate_disposition: [
      "PENDING_REVIEW", "SENT_TO_LAB", "QUEUED", "REJECTED", "MERGED",
      "EXPIRED", "RECYCLED", "QUEUED_FOR_QC", "READY"
    ]
  };
  
  try {
    // Get all columns for each table - query each table separately to avoid SQL injection
    const allColumns: { table_name: string; column_name: string }[] = [];
    const tableNames = Object.keys(expectedSchema);
    
    for (const tableName of tableNames) {
      try {
        const tableResult = await db.execute(sql`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_name = ${tableName}
          ORDER BY ordinal_position
        `) as { rows: { table_name: string; column_name: string }[] };
        allColumns.push(...tableResult.rows);
      } catch (tableError) {
        errors.push(`[SCHEMA_VALIDATION] Failed to query columns for table '${tableName}': ${tableError instanceof Error ? tableError.message : 'Unknown error'}`);
      }
    }
    
    const result = { rows: allColumns };
    
    // Build map of existing columns per table
    const existingColumns = new Map<string, Set<string>>();
    for (const row of result.rows) {
      if (!existingColumns.has(row.table_name)) {
        existingColumns.set(row.table_name, new Set());
      }
      existingColumns.get(row.table_name)!.add(row.column_name);
    }
    
    // Validate each table has expected columns
    for (const [table, columns] of Object.entries(expectedSchema)) {
      const existing = existingColumns.get(table);
      if (!existing) {
        errors.push(`[SCHEMA_VALIDATION] Table '${table}' does not exist`);
        continue;
      }
      
      for (const col of columns) {
        if (!existing.has(col)) {
          errors.push(`[SCHEMA_VALIDATION] Column '${table}.${col}' does not exist`);
        }
      }
    }
    
    // Validate enum values exist in database
    for (const [enumName, expectedValues] of Object.entries(expectedEnums)) {
      try {
        const enumResult = await db.execute(sql`
          SELECT e.enumlabel
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = ${enumName}
          ORDER BY e.enumsortorder
        `) as { rows: { enumlabel: string }[] };
        
        const existingValues = new Set(enumResult.rows.map(r => r.enumlabel));
        
        if (existingValues.size === 0) {
          errors.push(`[SCHEMA_VALIDATION] Enum '${enumName}' does not exist in database`);
          continue;
        }
        
        for (const value of expectedValues) {
          if (!existingValues.has(value)) {
            errors.push(`[SCHEMA_VALIDATION] Enum '${enumName}' missing value '${value}'`);
          }
        }
      } catch (enumError) {
        errors.push(`[SCHEMA_VALIDATION] Failed to validate enum '${enumName}': ${enumError instanceof Error ? enumError.message : 'Unknown error'}`);
      }
    }
    
    if (errors.length === 0) {
      console.log('[SCHEMA_VALIDATION] All critical tables, columns, and enums validated successfully');
    } else {
      console.error('[SCHEMA_VALIDATION] Schema validation FAILED:');
      errors.forEach(e => console.error(`  ${e}`));
    }
    
    return { valid: errors.length === 0, errors };
  } catch (e) {
    const errorMsg = `[SCHEMA_VALIDATION] Failed to validate schema: ${e instanceof Error ? e.message : 'Unknown error'}`;
    console.error(errorMsg);
    return { valid: false, errors: [errorMsg] };
  }
}

/**
 * STARTUP MIGRATION: Ensure archetype_name column exists on bots table
 * Uses ADD COLUMN IF NOT EXISTS to be idempotent - safe for concurrent Render instances
 * MUST run BEFORE any code that touches the bots table (storage, scheduler, backfill)
 */
export async function ensureArchetypeColumn(): Promise<void> {
  console.log('[STARTUP_MIGRATION] Ensuring archetype_name column exists...');
  
  try {
    await poolWeb.query(`
      ALTER TABLE bots ADD COLUMN IF NOT EXISTS archetype_name text
    `);
    console.log('[STARTUP_MIGRATION] archetype_name column ensured (created or already exists)');
  } catch (error) {
    // Log but don't fail startup - the column might already exist
    const errMsg = error instanceof Error ? error.message : 'unknown';
    console.error(`[STARTUP_MIGRATION] Failed to ensure archetype_name column: ${errMsg}`);
    // Re-throw only if it's not a "column already exists" error
    if (!errMsg.includes('already exists')) {
      throw error;
    }
  }
}

/**
 * STARTUP MIGRATION: Ensure tick ingestion tables exist
 * Creates trade_ticks, quote_ticks, order_book_snapshots, tick_sequence_gaps, tick_ingestion_metrics
 * Uses CREATE TABLE IF NOT EXISTS to be idempotent
 */
export async function ensureTickTablesExist(): Promise<void> {
  console.log('[STARTUP_MIGRATION] Checking tick ingestion tables...');
  
  const tables = [
    {
      name: 'tick_type enum',
      sql: `DO $$ BEGIN CREATE TYPE tick_type AS ENUM ('TRADE', 'QUOTE'); EXCEPTION WHEN duplicate_object THEN null; END $$;`
    },
    {
      name: 'trade_ticks',
      sql: `CREATE TABLE IF NOT EXISTS trade_ticks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'XCME',
        timestamp_ns BIGINT NOT NULL,
        received_at_ns BIGINT,
        sequence_id BIGINT,
        price REAL NOT NULL,
        size INTEGER NOT NULL,
        side TEXT,
        trade_condition TEXT,
        trading_day TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    },
    {
      name: 'quote_ticks',
      sql: `CREATE TABLE IF NOT EXISTS quote_ticks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'XCME',
        timestamp_ns BIGINT NOT NULL,
        received_at_ns BIGINT,
        sequence_id BIGINT,
        bid_price REAL NOT NULL,
        bid_size INTEGER NOT NULL,
        ask_price REAL NOT NULL,
        ask_size INTEGER NOT NULL,
        mid_price REAL,
        spread_ticks REAL,
        trading_day TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    },
    {
      name: 'order_book_snapshots',
      sql: `CREATE TABLE IF NOT EXISTS order_book_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'XCME',
        timestamp_ns BIGINT NOT NULL,
        snapshot_interval TEXT NOT NULL DEFAULT '1s',
        bids JSONB NOT NULL DEFAULT '[]',
        asks JSONB NOT NULL DEFAULT '[]',
        best_bid REAL NOT NULL,
        best_ask REAL NOT NULL,
        mid_price REAL NOT NULL,
        spread_ticks REAL NOT NULL,
        spread_bps REAL,
        bid_depth_5 INTEGER,
        ask_depth_5 INTEGER,
        imbalance REAL,
        liquidity_score REAL,
        trading_day TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    },
    {
      name: 'tick_sequence_gaps',
      sql: `CREATE TABLE IF NOT EXISTS tick_sequence_gaps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'XCME',
        tick_type tick_type NOT NULL,
        expected_sequence BIGINT NOT NULL,
        received_sequence BIGINT NOT NULL,
        gap_size INTEGER NOT NULL,
        resolved BOOLEAN DEFAULT false,
        resolved_at TIMESTAMP,
        resolution_method TEXT,
        detected_at TIMESTAMP DEFAULT NOW(),
        trading_day TIMESTAMP NOT NULL DEFAULT NOW()
      );`
    },
    {
      name: 'drop_tick_ingestion_metrics',
      sql: `DROP TABLE IF EXISTS tick_ingestion_metrics;`
    },
    {
      name: 'tick_ingestion_metrics',
      sql: `CREATE TABLE IF NOT EXISTS tick_ingestion_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        window_start TIMESTAMP NOT NULL,
        window_end TIMESTAMP NOT NULL,
        window_duration_ms INTEGER NOT NULL,
        trade_tick_count INTEGER DEFAULT 0,
        quote_tick_count INTEGER DEFAULT 0,
        order_book_snapshots INTEGER DEFAULT 0,
        avg_latency_us REAL,
        p50_latency_us REAL,
        p90_latency_us REAL,
        p99_latency_us REAL,
        max_latency_us REAL,
        gaps_detected INTEGER DEFAULT 0,
        gaps_resolved INTEGER DEFAULT 0,
        stale_tick_count INTEGER DEFAULT 0,
        out_of_order_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    }
  ];
  
  const indexes = [
    { name: 'idx_trade_ticks_symbol_day', sql: 'CREATE INDEX IF NOT EXISTS idx_trade_ticks_symbol_day ON trade_ticks(symbol, trading_day);' },
    { name: 'idx_quote_ticks_symbol_day', sql: 'CREATE INDEX IF NOT EXISTS idx_quote_ticks_symbol_day ON quote_ticks(symbol, trading_day);' },
    { name: 'idx_order_book_symbol_day', sql: 'CREATE INDEX IF NOT EXISTS idx_order_book_symbol_day ON order_book_snapshots(symbol, trading_day);' },
    { name: 'idx_tick_gaps_symbol', sql: 'CREATE INDEX IF NOT EXISTS idx_tick_gaps_symbol ON tick_sequence_gaps(symbol, detected_at);' },
    { name: 'idx_tick_metrics_symbol', sql: 'CREATE INDEX IF NOT EXISTS idx_tick_metrics_symbol ON tick_ingestion_metrics(symbol, window_start);' }
  ];
  
  let created = 0;
  let failed = 0;
  
  // Create tables individually to handle partial failures
  for (const table of tables) {
    try {
      await poolWeb.query(table.sql);
      created++;
    } catch (error) {
      console.error(`[STARTUP_MIGRATION] Failed to create ${table.name}: ${error instanceof Error ? error.message : 'unknown'}`);
      failed++;
    }
  }
  
  // Create indexes individually
  for (const index of indexes) {
    try {
      await poolWeb.query(index.sql);
    } catch (error) {
      // Indexes can fail if table doesn't exist - that's OK
      console.debug(`[STARTUP_MIGRATION] Index ${index.name} skipped: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
  
  if (failed === 0) {
    console.log(`[STARTUP_MIGRATION] Tick ingestion tables verified/created successfully (${created} items)`);
  } else {
    console.log(`[STARTUP_MIGRATION] Tick tables partially created: ${created} succeeded, ${failed} failed`);
  }
}

/**
 * PRODUCTION FIX: Consolidate all data to a single canonical user
 * 
 * This runs on every startup to ensure:
 * 1. The canonical user (blaidtrades@gmail.com) exists
 * 2. ALL data across ALL tables is owned by that user
 * 3. All other users are deleted
 * 
 * This fixes the empty bots page issue where bots belong to a different user_id
 * than the logged-in user.
 */
export async function ensureCanonicalUserConsolidation(): Promise<void> {
  // CRITICAL: Log immediately at function entry to confirm code execution on Render
  console.log(`[USER_CONSOLIDATION] ========== FUNCTION ENTRY ==========`);
  console.log(`[USER_CONSOLIDATION] Timestamp: ${new Date().toISOString()}`);
  
  const CANONICAL_EMAIL = 'blaidtrades@gmail.com';
  
  console.log(`[USER_CONSOLIDATION] Starting canonical user consolidation for ${CANONICAL_EMAIL}...`);
  
  try {
    // Step 1: Find or create the canonical user
    const findUserResult = await poolWeb.query(
      `SELECT id, email, username FROM users WHERE email = $1`,
      [CANONICAL_EMAIL]
    );
    
    let canonicalUserId: string;
    
    if (findUserResult.rows.length > 0) {
      canonicalUserId = findUserResult.rows[0].id;
      console.log(`[USER_CONSOLIDATION] Found canonical user: ${canonicalUserId}`);
    } else {
      // Create the canonical user if it doesn't exist
      // SECURITY: Require ADMIN_PASSWORD env var - no default password
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) {
        console.error(`[USER_CONSOLIDATION] ERROR: ADMIN_PASSWORD env var required to create canonical user`);
        return;
      }
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      const insertResult = await poolWeb.query(
        `INSERT INTO users (id, email, username, password, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         RETURNING id`,
        [CANONICAL_EMAIL, 'blaidtrades', hashedPassword]
      );
      canonicalUserId = insertResult.rows[0].id;
      console.log(`[USER_CONSOLIDATION] Created canonical user: ${canonicalUserId}`);
    }
    
    // Step 2: Get all other user IDs that need to be migrated FROM
    const otherUsersResult = await poolWeb.query(
      `SELECT id FROM users WHERE id != $1`,
      [canonicalUserId]
    );
    const otherUserIds = otherUsersResult.rows.map((r: { id: string }) => r.id);
    
    // Step 2b: CRITICAL - Fix orphaned bots (user_id doesn't match ANY user)
    // This catches bots created with a user_id that no longer exists
    try {
      await poolWeb.query(`SET statement_timeout = '60s'`);
      const orphanedResult = await poolWeb.query(
        `UPDATE bots SET user_id = $1 WHERE user_id != $1 AND user_id NOT IN (SELECT id FROM users)`,
        [canonicalUserId]
      );
      await poolWeb.query(`SET statement_timeout = '5s'`);
      if (orphanedResult.rowCount && orphanedResult.rowCount > 0) {
        console.log(`[USER_CONSOLIDATION] Fixed ${orphanedResult.rowCount} orphaned bots (user_id didn't match any user)`);
      }
    } catch (err) {
      console.log(`[USER_CONSOLIDATION] Orphan check: ${err instanceof Error ? err.message : 'unknown'}`);
      try { await poolWeb.query(`SET statement_timeout = '5s'`); } catch {}
    }
    
    // Step 2c: CRITICAL - Fix bots owned by wrong user (even if only canonical user exists)
    try {
      await poolWeb.query(`SET statement_timeout = '60s'`);
      const wrongOwnerResult = await poolWeb.query(
        `UPDATE bots SET user_id = $1 WHERE user_id != $1`,
        [canonicalUserId]
      );
      await poolWeb.query(`SET statement_timeout = '5s'`);
      if (wrongOwnerResult.rowCount && wrongOwnerResult.rowCount > 0) {
        console.log(`[USER_CONSOLIDATION] Reassigned ${wrongOwnerResult.rowCount} bots to canonical user`);
      }
    } catch (err) {
      console.log(`[USER_CONSOLIDATION] Reassignment: ${err instanceof Error ? err.message : 'unknown'}`);
      try { await poolWeb.query(`SET statement_timeout = '5s'`); } catch {}
    }
    
    if (otherUserIds.length === 0) {
      console.log(`[USER_CONSOLIDATION] No other users to migrate - checking bot ownership`);
      // Verify final state
      const botCountResult = await poolWeb.query(
        `SELECT COUNT(*) as count FROM bots WHERE user_id = $1`,
        [canonicalUserId]
      );
      const totalBotsResult = await poolWeb.query(`SELECT COUNT(*) as count FROM bots`);
      console.log(`[USER_CONSOLIDATION] COMPLETE: 1 user, ${botCountResult.rows[0].count}/${totalBotsResult.rows[0].count} bots owned by canonical user`);
      return;
    }
    
    console.log(`[USER_CONSOLIDATION] Found ${otherUserIds.length} other users to migrate from`);
    
    // Step 3: Dynamically find ALL columns referencing users table via FK
    // This ensures we don't miss any references
    const fkQuery = await poolWeb.query(`
      SELECT 
        kcu.table_name,
        kcu.column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc 
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'users'
        AND ccu.column_name = 'id'
        AND kcu.table_schema = 'public'
      ORDER BY kcu.table_name, kcu.column_name
    `);
    
    console.log(`[USER_CONSOLIDATION] Found ${fkQuery.rows.length} FK columns referencing users`);
    
    // Step 4: Update ALL FK references to point to canonical user
    // Use longer timeout for potentially large tables
    let totalMigrated = 0;
    
    for (const row of fkQuery.rows) {
      const { table_name, column_name } = row;
      try {
        // Use a longer statement timeout for large tables
        await poolWeb.query(`SET statement_timeout = '60s'`);
        
        const updateResult = await poolWeb.query(
          `UPDATE ${table_name} SET ${column_name} = $1 WHERE ${column_name} = ANY($2::uuid[])`,
          [canonicalUserId, otherUserIds]
        );
        
        // Reset timeout
        await poolWeb.query(`SET statement_timeout = '5s'`);
        
        const rowsUpdated = updateResult.rowCount || 0;
        if (rowsUpdated > 0) {
          console.log(`[USER_CONSOLIDATION] Migrated ${rowsUpdated} rows in ${table_name}.${column_name}`);
          totalMigrated += rowsUpdated;
        }
      } catch (err) {
        console.log(`[USER_CONSOLIDATION] ${table_name}.${column_name} skipped: ${err instanceof Error ? err.message : 'unknown'}`);
        // Reset timeout even on error
        try { await poolWeb.query(`SET statement_timeout = '5s'`); } catch {}
      }
    }
    
    // Step 5: Also update bots table user_id (may not have FK constraint)
    try {
      await poolWeb.query(`SET statement_timeout = '60s'`);
      const botsResult = await poolWeb.query(
        `UPDATE bots SET user_id = $1 WHERE user_id = ANY($2::uuid[])`,
        [canonicalUserId, otherUserIds]
      );
      await poolWeb.query(`SET statement_timeout = '5s'`);
      if (botsResult.rowCount && botsResult.rowCount > 0) {
        console.log(`[USER_CONSOLIDATION] Migrated ${botsResult.rowCount} bots to canonical user`);
        totalMigrated += botsResult.rowCount;
      }
    } catch (err) {
      console.log(`[USER_CONSOLIDATION] bots migration: ${err instanceof Error ? err.message : 'unknown'}`);
      try { await poolWeb.query(`SET statement_timeout = '5s'`); } catch {}
    }
    
    console.log(`[USER_CONSOLIDATION] Total rows migrated: ${totalMigrated}`);
    
    // Step 6: Delete all other users
    try {
      await poolWeb.query(`SET statement_timeout = '60s'`);
      const deleteResult = await poolWeb.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[])`,
        [otherUserIds]
      );
      await poolWeb.query(`SET statement_timeout = '5s'`);
      console.log(`[USER_CONSOLIDATION] Deleted ${deleteResult.rowCount || 0} other users`);
    } catch (err) {
      console.error(`[USER_CONSOLIDATION] Failed to delete users: ${err instanceof Error ? err.message : 'unknown'}`);
      try { await poolWeb.query(`SET statement_timeout = '5s'`); } catch {}
    }
    
    // Verify final state
    const verifyResult = await poolWeb.query(`SELECT COUNT(*) as count FROM users`);
    const botCountResult = await poolWeb.query(
      `SELECT COUNT(*) as count FROM bots WHERE user_id = $1`,
      [canonicalUserId]
    );
    
    console.log(`[USER_CONSOLIDATION] COMPLETE: ${verifyResult.rows[0].count} user(s) remaining, ${botCountResult.rows[0].count} bots owned by canonical user`);
    
  } catch (error) {
    console.error(`[USER_CONSOLIDATION] ERROR: ${error instanceof Error ? error.message : 'unknown'}`);
    // Don't throw - allow server to continue starting even if consolidation fails
    // This prevents infinite restart loops in production
  }
}
