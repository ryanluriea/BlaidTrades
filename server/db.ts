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
  const isLegacyHelium = hostInfo === 'helium';
  const hasReader = !!DATABASE_READER_URL;
  console.log(`[DB_CONFIG] host=${hostInfo} port=${dbUrl.port || 5432} pooler=${isPooler} legacy=${isLegacyHelium} reader=${hasReader}`);
  if (isLegacyHelium) {
    console.warn('[DB_CONFIG] WARNING: Using legacy helium database host - may have connectivity issues');
  }
} catch (e) {
  console.log('[DB_CONFIG] Could not parse DATABASE_URL for telemetry');
}

// INDUSTRY-STANDARD: Dual-pool architecture for mixed workloads
// - poolWeb: High-priority pool for user-facing requests (auth, API)
// - pool: Worker pool for background jobs (backtests, runners)
// This prevents background workers from starving user requests

const STATEMENT_TIMEOUT_MS = 5000;
const STATEMENT_TIMEOUT_WORKERS_MS = 15000; // Workers get longer timeout
const CONNECTION_TIMEOUT_MS = 5000; // Fast fail for web requests
const CONNECTION_TIMEOUT_WORKERS_MS = 10000;

// HIGH-PRIORITY: Web/Auth pool - reserved for user-facing requests
// Smaller pool with faster timeouts ensures auth never waits for workers
export const poolWeb = new Pool({ 
  connectionString: DATABASE_URL,
  max: 4, // Reserved slots for web requests
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  allowExitOnIdle: true,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
});

// WORKER POOL: Background jobs (backtests, runners, evolution)
// Uses reader endpoint if available for read-heavy workloads
export const pool = new Pool({ 
  connectionString: DATABASE_READER_URL || DATABASE_URL,
  max: 8, // Reduced from 10 to leave room for web pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_WORKERS_MS,
  allowExitOnIdle: true,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_WORKERS_MS}`,
});

// Writer pool for worker mutations (when using reader for reads)
export const poolWriter = DATABASE_READER_URL ? new Pool({ 
  connectionString: DATABASE_URL,
  max: 4, // Dedicated writer connections
  idleTimeoutMillis: 30000,
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
 */
export async function warmupDatabase(): Promise<boolean> {
  const MAX_RETRIES = 3; // Fail fast - 3 attempts with 10s timeout each = 30s max
  const INITIAL_DELAY_MS = 2000; // Start with 2s delay
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[DB_WARMUP] Attempt ${attempt}/${MAX_RETRIES} - connecting to database...`);
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log(`[DB_WARMUP] Database connection established successfully`);
      _dbWarmedUp = true;
      closeCircuit();
      return true;
    } catch (error) {
      // Delays: 3s, 6s, 12s, 24s, 48s, 96s, 192s, 384s (caps at 60s due to timeout)
      const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), 60000);
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
    ]
  };
  
  try {
    // Get all columns for each table
    const result = await db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_name IN ('paper_trades', 'account_attempts', 'bot_instances', 'bots', 'bot_generations', 'backtest_sessions')
      ORDER BY table_name, ordinal_position
    `) as { rows: { table_name: string; column_name: string }[] };
    
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
    
    if (errors.length === 0) {
      console.log('[SCHEMA_VALIDATION] All critical tables and columns validated successfully');
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
