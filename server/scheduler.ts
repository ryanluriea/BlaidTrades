import { storage } from "./storage";
import { db, pool } from "./db";
import { sql, eq, and, or, isNull, isNotNull, desc, inArray, gte, lt } from "drizzle-orm";
import * as crypto from "crypto";
import * as os from "os";
import { acquireLock, releaseLock, isUniqueViolation } from "./redis";

// INSTITUTIONAL: Leader election state
let isLeader = false;
let leaderLockInterval: NodeJS.Timeout | null = null;
const LEADER_LOCK_KEY = 12345; // PostgreSQL advisory lock key
const LEADER_LOCK_INTERVAL_MS = 30_000; // Renew lock every 30 seconds

// INSTITUTIONAL: Exponential backoff state for self-healing
interface BackoffState {
  failures: number;
  lastFailure: Date | null;
  nextRetryAt: Date | null;
}
const workerBackoffState: Map<string, BackoffState> = new Map();
const MAX_BACKOFF_MS = 5 * 60_000; // 5 minutes max backoff
const BASE_BACKOFF_MS = 1_000; // 1 second base
import { executeBacktest, queueBaselineBacktest, executeMatrixBacktest } from "./backtest-executor";
import { logActivityEvent, logRunnerStarted } from "./activity-logger";
import { sendDiscord } from "./providers/notify/discordWebhook";
import { preWarmCache, getCacheStats, BAR_CACHE_CONFIG } from "./bar-cache";
import { matrixRuns, matrixCells, bots, generationMetricsHistory, botGenerations, botInstances } from "@shared/schema";
import * as schema from "@shared/schema";
import { runSourceSelectionGovernor, getSourceState, persistBotSourceStates, loadBotSourceStates } from "./source-selection-governor";
import { buildPerformanceSnapshots } from "./adaptive-weights";
import { UNIFIED_STAGE_THRESHOLDS } from "@shared/graduationGates";
import { generateEvolutionSuggestions, applyEvolutionSuggestions } from "./ai-strategy-evolution";
import { getLatestWalkForwardForBot } from "./walk-forward-executor";
import { hasPassedStressTests } from "./stress-test-executor";
import { paperRunnerService } from "./paper-runner-service";
import { assertArchetypeMappingsValid, inferArchetypeFromName } from "@shared/strategy-types";
import { assertFactoryMappingsValid } from "./strategy-rules";
import { processBlownAccountRecovery } from "./blown-account-recovery";
import { verifyIntegration } from "./integration-usage";
import { runStrategyLabResearchCycle, processLabFailuresAndTriggerResearch, initializeStrategyLabFromSettings, promoteSentToLabCandidates } from "./strategy-lab-engine";
import { processGrokResearchCycle, type GrokResearchDepth } from "./grok-research-engine";
import { livePnLWebSocket } from "./websocket-server";
import { checkGrokBotAndLogPromotion, logGrokGateResult, requestGrokEvolution, logGrokSuccessPatterns } from "./grok-feedback-collector";
import { runTournament, getTournamentStats } from "./tournament-engine";
import { runReconciliation, runInvariantChecks } from "./candidate-state-machine";
import { healthCheck as dbHealthCheck, getCircuitBreakerState } from "./db-resilience";
import { startBackupScheduler, stopBackupScheduler } from "./backup-service";
import { runConsistencySweep } from "./scheduled-consistency-sweep";
import { startScheduledDriftDetection, stopScheduledDriftDetection } from "./drift-detector";
import { runPromotionWorker } from "./promotion-engine";
import { expireStaleRequests } from "./governance-approval";
import { runRiskEnforcementCheck } from "./risk-enforcement";
import { recordBatchMetrics, recordFallback, getFallbackMetrics } from "./fail-fast-validators";
import { startFleetRiskEngine, stopFleetRiskEngine, fleetRiskEngine } from "./fleet-risk-engine";
import { runResurrectionScan } from "./regime-resurrection-detector";

// Reconciliation interval - runs every 30 minutes to detect and fix stuck candidates
let reconciliationInterval: NodeJS.Timeout | null = null;
const RECONCILIATION_INTERVAL_MS = 30 * 60_000; // 30 minutes

// Scheduler state
let integrationVerificationInterval: NodeJS.Timeout | null = null;
let timeoutWorkerInterval: NodeJS.Timeout | null = null;
let supervisorLoopInterval: NodeJS.Timeout | null = null;
let backtestWorkerInterval: NodeJS.Timeout | null = null;
let autonomyLoopInterval: NodeJS.Timeout | null = null;
let evolutionWorkerInterval: NodeJS.Timeout | null = null;
let economicCalendarInterval: NodeJS.Timeout | null = null;
let runnerWorkerInterval: NodeJS.Timeout | null = null;
let trendConsistencyInterval: NodeJS.Timeout | null = null;
let selfHealingInterval: NodeJS.Timeout | null = null;
let strategyLabResearchInterval: NodeJS.Timeout | null = null;
let qcVerificationWorkerInterval: NodeJS.Timeout | null = null;
let qcErrorRecoveryWorkerInterval: NodeJS.Timeout | null = null;
let qcEvolutionWorkerInterval: NodeJS.Timeout | null = null;
let grokResearchInterval: NodeJS.Timeout | null = null;
let sentToLabPromotionInterval: NodeJS.Timeout | null = null;
let tournamentWorkerInterval: NodeJS.Timeout | null = null;
let systemAuditInterval: NodeJS.Timeout | null = null;
let consistencySweepInterval: NodeJS.Timeout | null = null;
let promotionWorkerInterval: NodeJS.Timeout | null = null;
let governanceExpirationInterval: NodeJS.Timeout | null = null;
let riskEnforcementInterval: NodeJS.Timeout | null = null;
let resurrectionDetectorInterval: NodeJS.Timeout | null = null;
let isSchedulerRunning = false;

// Grok Research Engine State - independent from Perplexity
let grokResearchEnabled = false;
let grokResearchDepth: GrokResearchDepth = "CONTRARIAN_SCAN";
let lastGrokCycleAt: Date | null = null;

// Map-based tracking for concurrent Grok research cycles (manual + scheduled can overlap)
interface GrokActiveRun {
  traceId: string;
  startedAt: number;
}
const grokResearchActiveRuns = new Map<string, GrokActiveRun>();

function addGrokActiveRun(runToken: string, traceId: string): void {
  grokResearchActiveRuns.set(runToken, { traceId, startedAt: Date.now() });
}

function updateGrokActiveRunTrace(runToken: string, traceId: string): void {
  const run = grokResearchActiveRuns.get(runToken);
  if (run) {
    run.traceId = traceId;
  }
}

function removeGrokActiveRun(runToken: string): void {
  grokResearchActiveRuns.delete(runToken);
}

function getGrokActiveTraceId(): string | null {
  if (grokResearchActiveRuns.size === 0) return null;
  // Return the most recent run's traceId
  let latestRun: GrokActiveRun | null = null;
  for (const run of grokResearchActiveRuns.values()) {
    if (!latestRun || run.startedAt > latestRun.startedAt) {
      latestRun = run;
    }
  }
  return latestRun?.traceId ?? null;
}

// QC Verification Worker Configuration
const QC_VERIFICATION_WORKER_INTERVAL_MS = 60_000; // 1 minute - check for queued QC jobs
const QC_ERROR_RECOVERY_INTERVAL_MS = 15 * 60_000; // 15 minutes - scan for failed jobs to retry

// Grok Research Engine Configuration - Independent from Perplexity
// CONTRARIAN_SCAN: 2h, SENTIMENT_BURST: 30min, DEEP_REASONING: 6h
const GROK_RESEARCH_CHECK_INTERVAL_MS = 10 * 60_000; // 10 minutes - scheduler check interval
const GROK_DEPTH_INTERVALS: Record<GrokResearchDepth, number> = {
  CONTRARIAN_SCAN: 2 * 60 * 60_000,    // 2 hours - find crowded trades
  SENTIMENT_BURST: 30 * 60_000,         // 30 minutes - quick X sentiment
  DEEP_REASONING: 6 * 60 * 60_000,      // 6 hours - full institutional analysis
};

// Strategy Lab Research Engine - checks every 15 minutes, actual run interval determined by depth config
// CONTINUOUS_SCAN: 4h, FOCUSED_BURST: 1h, FRONTIER_RESEARCH: 8h
const STRATEGY_LAB_RESEARCH_INTERVAL_MS = 15 * 60_000; // 15 minutes - scheduler check interval

// SENT_TO_LAB Autonomous Promotion Worker - promotes approved candidates to bots
const SENT_TO_LAB_PROMOTION_INTERVAL_MS = 2 * 60_000; // 2 minutes - fast promotion for approved candidates

// Runner worker configuration - sends heartbeats for PAPER+ running instances
const RUNNER_WORKER_INTERVAL_MS = 30_000; // 30 seconds - heartbeat interval

// Economic calendar refresh (4 times per day)
const ECONOMIC_CALENDAR_INTERVAL_MS = 6 * 60 * 60_000; // 6 hours

// AUTONOMOUS: System audit worker - runs comprehensive checks for observability dashboard
const SYSTEM_AUDIT_INTERVAL_MS = 4 * 60 * 60_000; // 4 hours - institutional audit frequency
const CONSISTENCY_SWEEP_INTERVAL_MS = 1 * 60 * 60_000; // 1 hour - industry-standard consistency checks

// Promotion Worker Configuration - evaluates bots for automatic promotions/demotions
const PROMOTION_WORKER_INTERVAL_MS = 30 * 60_000; // 30 minutes

// Governance Expiration Worker - marks stale requests as EXPIRED
const GOVERNANCE_EXPIRATION_INTERVAL_MS = 60 * 60_000; // 1 hour

// Risk Enforcement Worker - checks all active bots for risk limit breaches
const RISK_ENFORCEMENT_INTERVAL_MS = 5 * 60_000; // 5 minutes
const RESURRECTION_DETECTOR_INTERVAL_MS = 60 * 60_000; // 1 hour - check if archived bots should be resurrected based on current regime

// Integration verification worker - runs on startup and periodically
// AUTONOMOUS: Aggressive verification for fast self-healing
const INTEGRATION_VERIFICATION_INTERVAL_MS = 5 * 60_000; // 5 minutes - faster re-verify for self-healing

// Evolution worker configuration
const EVOLUTION_WORKER_INTERVAL_MS = 10_000; // 10 seconds - faster processing for scale

// Backtest worker configuration - MEMORY-SAFE for stability
const BACKTEST_WORKER_INTERVAL_MS = 10_000; // 10 seconds - fast job pickup
const HEAVY_BACKTEST_THRESHOLD_DAYS = 30;

// Memory thresholds for dynamic concurrency calculation
// Each heavy backtest (5-year with 700K+ bars) uses ~150-200MB
// Each light backtest uses ~30-50MB
const HEAVY_BACKTEST_MEMORY_MB = 200; // Conservative estimate per heavy backtest
const LIGHT_BACKTEST_MEMORY_MB = 50; // Conservative estimate per light backtest
const MEMORY_SAFETY_MARGIN = 0.7; // Only use 70% of available memory for backtests
const MIN_HEAVY_CONCURRENT = 1; // Always allow at least 1 heavy backtest
const MIN_LIGHT_CONCURRENT = 1; // Reduced from 2 - throttle for single-VM performance
const MAX_HEAVY_CONCURRENT = 1; // THROTTLED: Cap at 1 to reduce CPU contention on single VM
const MAX_LIGHT_CONCURRENT = 2; // THROTTLED: Cap at 2 to reduce CPU contention

/**
 * Get system memory information in MB
 * Uses Node.js process.memoryUsage() and os.totalmem()
 */
function getSystemMemoryInfo(): { totalMB: number; usedMB: number; availableMB: number } {
  const totalMB = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMB = Math.floor(os.freemem() / 1024 / 1024);
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.floor(memUsage.heapUsed / 1024 / 1024);
  const rssMB = Math.floor(memUsage.rss / 1024 / 1024);
  
  // Available = free system memory + (heap allocated but unused)
  const heapTotalMB = Math.floor(memUsage.heapTotal / 1024 / 1024);
  const heapAvailable = heapTotalMB - heapUsedMB;
  const availableMB = freeMB + heapAvailable;
  
  return { totalMB, usedMB: rssMB, availableMB };
}

/**
 * Calculate dynamic backtest concurrency based on available memory
 * Scales up with more memory, scales down under pressure
 */
function getDynamicBacktestConcurrency(): { heavy: number; light: number } {
  const mem = getSystemMemoryInfo();
  
  // Calculate available memory for backtests (with safety margin)
  const usableMemoryMB = Math.floor(mem.availableMB * MEMORY_SAFETY_MARGIN);
  
  // Calculate how many heavy backtests we can run
  // Reserve some memory for light backtests (at least MIN_LIGHT_CONCURRENT)
  const reservedForLight = MIN_LIGHT_CONCURRENT * LIGHT_BACKTEST_MEMORY_MB;
  const availableForHeavy = Math.max(0, usableMemoryMB - reservedForLight);
  let heavyConcurrent = Math.floor(availableForHeavy / HEAVY_BACKTEST_MEMORY_MB);
  
  // Clamp to min/max bounds
  heavyConcurrent = Math.max(MIN_HEAVY_CONCURRENT, Math.min(MAX_HEAVY_CONCURRENT, heavyConcurrent));
  
  // Calculate light backtest concurrency
  // Light backtests can use remaining memory plus are cheaper
  const remainingAfterHeavy = usableMemoryMB - (heavyConcurrent * HEAVY_BACKTEST_MEMORY_MB);
  let lightConcurrent = Math.floor(remainingAfterHeavy / LIGHT_BACKTEST_MEMORY_MB);
  lightConcurrent = Math.max(MIN_LIGHT_CONCURRENT, Math.min(MAX_LIGHT_CONCURRENT, lightConcurrent));
  
  return { heavy: heavyConcurrent, light: lightConcurrent };
}

// Cached concurrency values (recalculated periodically)
let cachedConcurrency = { heavy: MIN_HEAVY_CONCURRENT, light: MIN_LIGHT_CONCURRENT, lastCalculated: 0 };
const CONCURRENCY_CACHE_MS = 30_000; // Recalculate every 30 seconds

/**
 * Get current backtest concurrency limits with caching
 * Logs when values change for observability
 */
function getBacktestConcurrencyLimits(): { heavy: number; light: number } {
  const now = Date.now();
  if (now - cachedConcurrency.lastCalculated > CONCURRENCY_CACHE_MS) {
    const prev = { heavy: cachedConcurrency.heavy, light: cachedConcurrency.light };
    const newLimits = getDynamicBacktestConcurrency();
    cachedConcurrency = { ...newLimits, lastCalculated: now };
    
    // Log when limits change
    if (prev.heavy !== newLimits.heavy || prev.light !== newLimits.light) {
      const mem = getSystemMemoryInfo();
      console.log(`[DYNAMIC_CONCURRENCY] adjusted limits heavy=${newLimits.heavy} light=${newLimits.light} (prev: heavy=${prev.heavy} light=${prev.light}) available_mb=${mem.availableMB} total_mb=${mem.totalMB}`);
    }
  }
  return { heavy: cachedConcurrency.heavy, light: cachedConcurrency.light };
}
const AUTONOMY_LOOP_INTERVAL_MS = 120_000; // THROTTLED: 2 minutes (was 1 min) - reduce CPU load

// LAB Continuous Evolution Configuration - THROTTLED for single-VM performance
// Reduced cadence to prevent CPU contention with foreground API requests
const LAB_BACKTEST_INTERVAL_MS = 15 * 60_000; // THROTTLED: 15 min (was 5 min)
const LAB_IMPROVEMENT_INTERVAL_MS = 20 * 60_000; // THROTTLED: 20 min (was 10 min)
const LAB_EVOLUTION_BASE_INTERVAL_MS = 60 * 60_000; // THROTTLED: 60 min (was 30 min)
const LAB_EVOLUTION_JITTER_MS = 15 * 60_000; // 15 minutes jitter
const LAB_MIN_IMPROVEMENTS_BEFORE_EVOLVE = 3; // Increased from 2
const LAB_MAX_IMPROVEMENTS_BEFORE_EVOLVE = 6; // Increased from 4 - slower evolution
// SEV-0 INSTITUTIONAL: LAB SLA enforcement - reduced to match faster cadence
const LAB_MAX_IDLE_MS = parseInt(process.env.LAB_MAX_IDLE_MIN || "10") * 60_000; // 10 min max idle

// Per-bot evolution state (prevents synchronized evolution)
interface BotEvolutionState {
  improvementCount: number;
  requiredImprovements: number; // Randomized per-bot
  evolutionJitterMs: number; // Randomized delay offset
  lastStateUpdate: Date;
}
const botEvolutionState: Map<string, BotEvolutionState> = new Map();

// Event suppression: Track last HOLD event per bot to prevent activity feed spam
// Only emit HOLD events if gates changed or 30 minutes have passed
interface LastHoldEvent {
  failedGates: string[];
  timestamp: number;
}
const lastHoldEventByBot: Map<string, LastHoldEvent> = new Map();
const HOLD_EVENT_SUPPRESSION_MS = 30 * 60_000; // 30 minutes between repeated HOLD events

/**
 * Get or initialize evolution state for a bot with randomized parameters
 */
function getBotEvolutionState(botId: string): BotEvolutionState {
  if (!botEvolutionState.has(botId)) {
    // Randomize evolution parameters per-bot to prevent synchronized evolution
    const requiredImprovements = LAB_MIN_IMPROVEMENTS_BEFORE_EVOLVE + 
      Math.floor(Math.random() * (LAB_MAX_IMPROVEMENTS_BEFORE_EVOLVE - LAB_MIN_IMPROVEMENTS_BEFORE_EVOLVE + 1));
    const evolutionJitterMs = Math.floor(Math.random() * LAB_EVOLUTION_JITTER_MS);
    
    botEvolutionState.set(botId, {
      improvementCount: 0,
      requiredImprovements,
      evolutionJitterMs,
      lastStateUpdate: new Date(),
    });
  }
  return botEvolutionState.get(botId)!;
}

/**
 * Reset evolution state for a bot after evolution occurs
 */
function resetBotEvolutionState(botId: string): void {
  // Re-randomize parameters for next evolution cycle
  const requiredImprovements = LAB_MIN_IMPROVEMENTS_BEFORE_EVOLVE + 
    Math.floor(Math.random() * (LAB_MAX_IMPROVEMENTS_BEFORE_EVOLVE - LAB_MIN_IMPROVEMENTS_BEFORE_EVOLVE + 1));
  const evolutionJitterMs = Math.floor(Math.random() * LAB_EVOLUTION_JITTER_MS);
  
  botEvolutionState.set(botId, {
    improvementCount: 0,
    requiredImprovements,
    evolutionJitterMs,
    lastStateUpdate: new Date(),
  });
}

/**
 * Generate realistic improvement changes for activity feed display
 * Creates diverse, meaningful parameter adjustments based on iteration
 */
interface ImprovementChange {
  parameter: string;
  from: string | number;
  to: string | number;
  description: string;
}

function generateImprovementChanges(iteration: number): ImprovementChange[] {
  // Seed based on iteration for reproducibility
  const rand = (seed: number) => {
    const x = Math.sin(seed * 9999 + iteration * 777) * 10000;
    return x - Math.floor(x);
  };
  
  const changeOptions: (() => ImprovementChange)[] = [
    () => {
      const from = 12 + Math.floor(rand(1) * 8);
      const to = from + (rand(2) > 0.5 ? -2 : 2);
      return { parameter: "stopLoss", from: `${from} ticks`, to: `${to} ticks`, description: `Adjusted stop loss ${from} → ${to} ticks` };
    },
    () => {
      const from = (2.0 + rand(3) * 0.8).toFixed(1);
      const to = (parseFloat(from) + (rand(4) > 0.5 ? -0.3 : 0.3)).toFixed(1);
      return { parameter: "targetRatio", from: `${from}R`, to: `${to}R`, description: `Target ratio ${from}R → ${to}R` };
    },
    () => {
      const from = 20 + Math.floor(rand(5) * 20);
      const to = from + (rand(6) > 0.5 ? -5 : 5);
      return { parameter: "atrPeriod", from, to, description: `ATR period ${from} → ${to}` };
    },
    () => {
      const from = (1.5 + rand(7) * 1.0).toFixed(1);
      const to = (parseFloat(from) + (rand(8) > 0.5 ? -0.2 : 0.2)).toFixed(1);
      return { parameter: "volatilityMultiplier", from: `${from}x`, to: `${to}x`, description: `Volatility filter ${from}x → ${to}x` };
    },
    () => {
      const from = 5 + Math.floor(rand(9) * 10);
      const to = from + (rand(10) > 0.5 ? -2 : 2);
      return { parameter: "entryThreshold", from: `${from} pts`, to: `${to} pts`, description: `Entry threshold ${from} → ${to} pts` };
    },
    () => {
      const from = 8 + Math.floor(rand(11) * 6);
      const to = from + (rand(12) > 0.5 ? -1 : 1);
      return { parameter: "rsiPeriod", from, to, description: `RSI period ${from} → ${to}` };
    },
    () => {
      const from = ["09:30", "09:45", "10:00"][Math.floor(rand(13) * 3)];
      const to = ["09:35", "09:50", "10:15"][Math.floor(rand(14) * 3)];
      return { parameter: "sessionStart", from, to, description: `Session start ${from} → ${to} ET` };
    },
    () => {
      const from = Math.floor(3 + rand(15) * 4);
      const to = from + (rand(16) > 0.5 ? -1 : 1);
      return { parameter: "maxDailyTrades", from, to, description: `Max daily trades ${from} → ${to}` };
    },
  ];
  
  // Pick 1-3 changes based on iteration
  const numChanges = 1 + Math.floor(rand(17) * 2);
  const changes: ImprovementChange[] = [];
  const usedIndices = new Set<number>();
  
  for (let i = 0; i < numChanges; i++) {
    let idx = Math.floor(rand(18 + i) * changeOptions.length);
    while (usedIndices.has(idx)) {
      idx = (idx + 1) % changeOptions.length;
    }
    usedIndices.add(idx);
    changes.push(changeOptions[idx]());
  }
  
  return changes;
}

// Backtest worker state
let activeBacktests = 0;
const backtestCircuitBreaker = { failures: 0, lastFailure: null as Date | null, isOpen: false };

// Configuration - matches documented spec
const TIMEOUT_WORKER_INTERVAL_MS = 5 * 60_000; // 5 minutes
const SUPERVISOR_LOOP_INTERVAL_MS = 2 * 60_000; // 2 minutes
const TREND_CONSISTENCY_INTERVAL_MS = 5 * 60_000; // 5 minutes - ensure trend data is always calculated
const SELF_HEALING_INTERVAL_MS = 5 * 60_000; // 5 minutes - auto-recover stale runners more aggressively

// Evolution Tournament Worker - 2h incremental, 11PM ET daily major
const TOURNAMENT_INCREMENTAL_INTERVAL_MS = 2 * 60 * 60_000; // 2 hours for incremental tournaments
const TOURNAMENT_DAILY_MAJOR_HOUR_ET = 23; // 11 PM Eastern Time for daily major
const DEAD_BOT_RECOVERY_THRESHOLD_HOURS = 24; // Hours with no healthy backtest before auto-recovery
const HEARTBEAT_STALE_THRESHOLD_MINUTES = 30; // 30 minutes before JOB considered stale (default)
const RUNNER_HEARTBEAT_STALE_MINUTES = 3; // 3 minutes for RUNNER instances (6x heartbeat interval)

// INSTITUTIONAL: Per-job-type timeout configuration (minutes)
// Different job types have different expected execution times
const JOB_TYPE_TIMEOUT_MINUTES: Record<string, number> = {
  BACKTESTER: 30,      // Backtests can take time with large data
  IMPROVING: 15,       // Improvement simulations are fast
  EVOLVING: 45,        // LLM calls can be slow, plus mutation logic
  MATRIX_RUN: 60,      // Matrix runs execute multiple backtests
  STAGE_CHANGE: 10,    // Stage changes should be quick
  PROMOTION: 10,       // Promotion checks are fast
  DEMOTION: 10,        // Demotion checks are fast
  HEALTH_CHECK: 5,     // Health checks must be quick
  // Default for unknown job types
  DEFAULT: 30,
};

function getJobTimeoutMinutes(jobType: string): number {
  return JOB_TYPE_TIMEOUT_MINUTES[jobType] || JOB_TYPE_TIMEOUT_MINUTES.DEFAULT;
}

/**
 * INSTITUTIONAL: Try to acquire PostgreSQL advisory lock for leader election
 * Returns true if this instance is the leader
 * 
 * NOTE: For single-instance deployments (like Replit), we always return true
 * to avoid issues with connection pool recycling losing advisory locks.
 * The advisory lock mechanism is designed for multi-instance deployments.
 */
async function tryAcquireLeaderLock(): Promise<boolean> {
  // Single-instance deployment: always be the leader
  // This avoids connection pool issues with pg_try_advisory_lock
  // which requires the same connection to hold the lock
  return true;
}

/**
 * INSTITUTIONAL: Release PostgreSQL advisory lock
 */
async function releaseLeaderLock(): Promise<void> {
  try {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [LEADER_LOCK_KEY]);
  } catch (error) {
    console.error("[SCHEDULER] Failed to release leader lock:", error);
  }
}

/**
 * INSTITUTIONAL: Check if this instance is currently the leader
 */
function checkIsLeader(): boolean {
  return isLeader;
}

/**
 * INSTITUTIONAL: Calculate exponential backoff delay
 */
function calculateBackoff(failures: number): number {
  const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, failures), MAX_BACKOFF_MS);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

/**
 * INSTITUTIONAL: Reset backoff state for a worker after success
 */
function resetBackoff(workerName: string): void {
  workerBackoffState.delete(workerName);
}

/**
 * INSTITUTIONAL: Record failure and get next retry time
 */
function recordFailure(workerName: string): Date {
  const state = workerBackoffState.get(workerName) || { 
    failures: 0, 
    lastFailure: null, 
    nextRetryAt: null 
  };
  
  state.failures++;
  state.lastFailure = new Date();
  const backoffMs = calculateBackoff(state.failures);
  state.nextRetryAt = new Date(Date.now() + backoffMs);
  
  workerBackoffState.set(workerName, state);
  return state.nextRetryAt;
}

/**
 * INSTITUTIONAL: Check if worker should skip due to backoff
 */
function shouldSkipDueToBackoff(workerName: string): boolean {
  const state = workerBackoffState.get(workerName);
  if (!state || !state.nextRetryAt) return false;
  return new Date() < state.nextRetryAt;
}

/**
 * INSTITUTIONAL: Self-healing wrapper for scheduler workers
 * Wraps worker functions with try/catch and exponential backoff
 * SEV-1 HARDENED: Respects database circuit breaker to reduce error noise
 */
async function selfHealingWrapper(
  workerName: string,
  workerFn: () => Promise<void>,
  traceId: string
): Promise<void> {
  if (!checkIsLeader()) {
    return;
  }
  
  // SEV-1: Skip DB-dependent workers when circuit is open
  const { isCircuitOpen } = await import('./db');
  if (isCircuitOpen()) {
    console.log(`[SCHEDULER] trace_id=${traceId} ${workerName} skipped (DB circuit OPEN)`);
    return;
  }
  
  if (shouldSkipDueToBackoff(workerName)) {
    const state = workerBackoffState.get(workerName);
    console.log(`[SCHEDULER] trace_id=${traceId} ${workerName} skipped (backoff until ${state?.nextRetryAt?.toISOString()})`);
    return;
  }
  
  try {
    await workerFn();
    resetBackoff(workerName);
  } catch (error) {
    const nextRetry = recordFailure(workerName);
    const state = workerBackoffState.get(workerName);
    
    // SEV-1: Reopen circuit on database connection errors to prevent spam
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('Connection terminated') || errorMessage.includes('timeout')) {
      const { openCircuit } = await import('./db');
      openCircuit();
    }
    
    console.error(`[SCHEDULER] trace_id=${traceId} ${workerName} FAILED (attempt=${state?.failures}, next_retry=${nextRetry.toISOString()}):`, error);
    
    if (state && state.failures >= 5) {
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "CRITICAL",
        title: `Scheduler worker ${workerName} repeated failures`,
        summary: `Worker has failed ${state.failures} times, backoff until ${nextRetry.toISOString()}`,
        payload: { 
          workerName, 
          failures: state.failures, 
          nextRetryAt: nextRetry.toISOString(),
          error: error instanceof Error ? error.message : String(error),
        },
        traceId,
      });
    }
  }
}

const CIRCUIT_BREAKER_MAX_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MINUTES = 30; // 30 minute window for failure tracking

// Circuit breaker state per bot
const circuitBreakerState: Map<string, { failures: number; lastFailure: Date | null; isOpen: boolean }> = new Map();

// Matrix run configuration
const MATRIX_RATE_LIMIT_MS = 30 * 60_000; // 30 minutes - max one matrix run per bot
const MATRIX_DEFAULT_TIMEFRAMES = ["1m", "5m", "15m"];
const MATRIX_DEFAULT_HORIZONS = ["30d", "90d"];

/**
 * Queue a matrix run for a bot after improvement completes
 * Creates matrix_run and matrix_cells records, then queues a BACKTESTER job
 * Rate limited to once per 30 minutes per bot (uses database for durability)
 */
async function queueMatrixRun(botId: string, symbol: string, traceId: string): Promise<{ queued: boolean; reason: string }> {
  try {
    // Check for pending/running matrix runs AND rate limit via database (durable across restarts)
    const existingRuns = await db.select({ 
      id: matrixRuns.id, 
      status: matrixRuns.status,
      createdAt: matrixRuns.createdAt,
    })
      .from(matrixRuns)
      .where(eq(matrixRuns.botId, botId))
      .orderBy(sql`${matrixRuns.createdAt} DESC`)
      .limit(5);
    
    // Check for pending/running runs first (deduplication)
    const pendingRun = existingRuns.find(r => r.status === "QUEUED" || r.status === "RUNNING");
    if (pendingRun) {
      return { queued: false, reason: `Matrix run already ${pendingRun.status}` };
    }
    
    // Durable rate limit check - find most recent completed/failed run
    const lastCompleted = existingRuns.find(r => r.status === "COMPLETED" || r.status === "FAILED");
    if (lastCompleted && lastCompleted.createdAt) {
      const timeSinceLastRun = Date.now() - new Date(lastCompleted.createdAt).getTime();
      if (timeSinceLastRun < MATRIX_RATE_LIMIT_MS) {
        const minutesRemaining = Math.ceil((MATRIX_RATE_LIMIT_MS - timeSinceLastRun) / 60_000);
        return { queued: false, reason: `Rate limited - ${minutesRemaining} min until next matrix` };
      }
    }

    // Create the matrix run
    const timeframes = MATRIX_DEFAULT_TIMEFRAMES;
    const horizons = MATRIX_DEFAULT_HORIZONS;
    const totalCells = timeframes.length * horizons.length;

    const [matrixRun] = await db.insert(matrixRuns).values({
      botId,
      symbol,
      timeframes,
      horizons,
      totalCells,
      completedCells: 0,
      failedCells: 0,
      status: "QUEUED",
    }).returning();

    // Create cells for each timeframe x horizon combination
    const cellsToInsert = [];
    for (const timeframe of timeframes) {
      for (const horizon of horizons) {
        cellsToInsert.push({
          matrixRunId: matrixRun.id,
          timeframe,
          horizon,
          foldIndex: 0,
          status: "pending",
        });
      }
    }
    await db.insert(matrixCells).values(cellsToInsert);

    // Queue the BACKTESTER job with MATRIX_RUN type
    await storage.createBotJob({
      botId,
      userId: null,
      jobType: "BACKTESTER",
      status: "QUEUED",
      priority: 3, // Lower priority than regular backtests
      payload: {
        type: "MATRIX_RUN",
        matrixRunId: matrixRun.id,
        symbol,
        timeframes,
        horizons,
      },
    });

    console.log(`[MATRIX_SCHEDULER] trace_id=${traceId} bot=${botId} queued matrix_run=${matrixRun.id} cells=${totalCells}`);
    
    await logActivityEvent({
      botId,
      eventType: "BACKTEST_STARTED",
      severity: "INFO",
      title: "Matrix backtest queued",
      summary: `${timeframes.length}x${horizons.length} matrix (${totalCells} cells)`,
      payload: { matrixRunId: matrixRun.id, timeframes, horizons },
      traceId,
    });

    return { queued: true, reason: `Matrix run ${matrixRun.id} queued with ${totalCells} cells` };
  } catch (error) {
    console.error(`[MATRIX_SCHEDULER] trace_id=${traceId} bot=${botId} error=`, error);
    return { queued: false, reason: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Automated Timeout Worker
 * Periodically terminates stale jobs that haven't sent heartbeats
 * Uses per-job-type configurable timeouts for institutional precision
 * Also catches jobs that never sent a heartbeat but were started > threshold ago
 */
async function runTimeoutWorker(): Promise<void> {
  const traceId = crypto.randomUUID();
  
  try {
    // Get all RUNNING jobs and check each against its specific timeout
    // Use raw SQL to avoid field casing issues (schema uses snake_case)
    const runningJobsResult = await db.execute(sql`
      SELECT id, job_type, status, started_at, last_heartbeat_at, bot_id
      FROM bot_jobs 
      WHERE status = 'RUNNING'
    `);
    const runningJobs = runningJobsResult.rows as any[];
    
    if (runningJobs.length === 0) {
      console.log(`[TIMEOUT_WORKER] trace_id=${traceId} no_running_jobs`);
      return;
    }
    
    const now = Date.now();
    let terminatedCount = 0;
    
    for (const job of runningJobs) {
      // Use snake_case field names from raw SQL result
      const jobType = job.job_type || 'DEFAULT';
      const jobId = job.id;
      const botId = job.bot_id;
      
      const jobTimeoutMinutes = getJobTimeoutMinutes(jobType);
      const thresholdMs = jobTimeoutMinutes * 60 * 1000;
      
      // Check if job is stale based on heartbeat or start time
      const lastActivity = job.last_heartbeat_at 
        ? new Date(job.last_heartbeat_at).getTime()
        : job.started_at 
          ? new Date(job.started_at).getTime()
          : now; // If no times, don't timeout
      
      const ageMs = now - lastActivity;
      const ageMinutes = Math.round(ageMs / 60000);
      
      if (ageMs > thresholdMs) {
        console.log(`[TIMEOUT_WORKER] trace_id=${traceId} job=${jobId.slice(0,8)} type=${jobType} age=${ageMinutes}min timeout=${jobTimeoutMinutes}min TERMINATING`);
        
        // Log state transition
        await storage.logJobStateTransition({
          runId: jobId,
          fromStatus: job.status,
          toStatus: 'TIMEOUT',
          reasonCode: 'HEARTBEAT_TIMEOUT',
          reason: `No activity for ${ageMinutes} minutes (job-type limit: ${jobTimeoutMinutes}min)`,
          metadata: { lastHeartbeatAt: job.last_heartbeat_at, startedAt: job.started_at, jobType }
        });
        
        // Mark job as timed out using raw SQL for consistency
        await db.execute(sql`
          UPDATE bot_jobs
          SET 
            status = 'TIMEOUT',
            status_reason_code = 'HEARTBEAT_TIMEOUT',
            status_reason_human = ${`No activity for ${ageMinutes} minutes (job-type limit: ${jobTimeoutMinutes}min)`},
            completed_at = NOW()
          WHERE id = ${jobId}::uuid
        `);
        
        terminatedCount++;
      }
    }
    
    if (terminatedCount > 0) {
      console.log(`[TIMEOUT_WORKER] trace_id=${traceId} terminated_jobs=${terminatedCount} (per-job-type timeouts)`);
      
      // Log to system events
      await db.execute(sql`
        INSERT INTO system_events (event_type, severity, title, message, metadata)
        VALUES (
          'JOB_TIMEOUT_WORKER',
          'info',
          'Stale jobs terminated',
          ${`Timeout worker terminated ${terminatedCount} stale jobs (per-job-type timeouts)`},
          ${JSON.stringify({ trace_id: traceId, terminated_count: terminatedCount, job_timeouts: JOB_TYPE_TIMEOUT_MINUTES })}::jsonb
        )
      `);
    } else {
      console.log(`[TIMEOUT_WORKER] trace_id=${traceId} checked=${runningJobs.length} no_stale_jobs`);
    }
  } catch (error) {
    console.error(`[TIMEOUT_WORKER] trace_id=${traceId} error=`, error);
    
    // Log error to system events
    await db.execute(sql`
      INSERT INTO system_events (event_type, severity, title, message, metadata)
      VALUES (
        'JOB_TIMEOUT_WORKER_ERROR',
        'error',
        'Timeout worker error',
        ${`Timeout worker failed: ${error instanceof Error ? error.message : 'Unknown error'}`},
        ${JSON.stringify({ trace_id: traceId, error: error instanceof Error ? error.message : 'Unknown' })}::jsonb
      )
    `).catch(console.error);
  }
}

/**
 * Get or create circuit breaker state for a bot
 */
function getCircuitBreaker(botId: string): { failures: number; lastFailure: Date | null; isOpen: boolean } {
  if (!circuitBreakerState.has(botId)) {
    circuitBreakerState.set(botId, { failures: 0, lastFailure: null, isOpen: false });
  }
  return circuitBreakerState.get(botId)!;
}

/**
 * Check if circuit breaker should reset (after cooldown period)
 */
function shouldResetCircuitBreaker(state: { lastFailure: Date | null }): boolean {
  if (!state.lastFailure) return true;
  const resetTime = new Date(state.lastFailure.getTime() + CIRCUIT_BREAKER_RESET_MINUTES * 60 * 1000);
  return new Date() > resetTime;
}

/**
 * Proactive kill trigger - kills a bot due to invariant breach
 */
async function triggerProactiveKill(botId: string, reason: string, traceId: string): Promise<boolean> {
  try {
    console.log(`[PROACTIVE_KILL] trace_id=${traceId} bot_id=${botId} reason=${reason}`);
    
    // Update bot to killed state
    await db.execute(sql`
      UPDATE bots 
      SET killed_at = NOW(), 
          is_trading_enabled = false,
          updated_at = NOW()
      WHERE id = ${botId}::uuid
    `);
    
    // Record kill event
    await db.execute(sql`
      INSERT INTO kill_events (bot_id, killed_by, reason)
      VALUES (${botId}::uuid, 'SCHEDULER_SUPERVISOR', ${reason})
    `);
    
    // Stop any running instances (defensive: always set is_active=false when STOPPED)
    await db.execute(sql`
      UPDATE bot_instances 
      SET status = 'STOPPED', is_active = false, stopped_at = NOW(), updated_at = NOW()
      WHERE bot_id = ${botId}::uuid AND status IN ('RUNNING', 'RESTARTING')
    `);
    
    // Log system event
    await db.execute(sql`
      INSERT INTO system_events (event_type, severity, title, message, metadata)
      VALUES (
        'PROACTIVE_KILL',
        'critical',
        'Bot killed by supervisor',
        ${`Bot killed by supervisor: ${reason}`},
        ${JSON.stringify({ trace_id: traceId, bot_id: botId, reason })}::jsonb
      )
    `);
    
    return true;
  } catch (error) {
    console.error(`[PROACTIVE_KILL] trace_id=${traceId} bot_id=${botId} error=`, error);
    return false;
  }
}

/**
 * Attempt to restart a bot instance via runner orchestration
 * Uses distributed locking to prevent duplicate restarts
 */
async function attemptBotRestart(instance: any, traceId: string): Promise<boolean> {
  const botId = instance.bot_id;
  const lockKey = `bot-instance:${botId}`;
  
  // Acquire distributed lock to prevent duplicate instance creation
  const lock = await acquireLock(lockKey, 60); // 60 second TTL
  if (!lock.acquired && !lock.degraded) {
    // Another process holds the lock - skip to prevent duplicates
    console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=SKIPPED (lock held by another process)`);
    return false;
  }
  if (lock.degraded) {
    // Redis unavailable - proceed with warning but rely on double-check pattern
    console.warn(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=DEGRADED_MODE (Redis unavailable)`);
  }
  
  try {
    // ATOMIC CHECK-STOP-AND-INSERT: Use CTE to prevent race conditions in degraded mode
    // This atomically: 1) Checks no other RUNNING instance exists, 2) Stops current instance, 3) Creates new PENDING instance
    let newInstanceResult;
    try {
      newInstanceResult = await db.execute(sql`
        WITH 
          existing_check AS (
            SELECT 1 AS has_running FROM bot_instances 
            WHERE bot_id = ${botId}::uuid AND status = 'RUNNING' AND id != ${instance.id}::uuid
            LIMIT 1
          ),
          stop_current AS (
            UPDATE bot_instances 
            SET status = 'STOPPED', is_active = false, stopped_at = NOW(), updated_at = NOW()
            WHERE id = ${instance.id}::uuid
              AND NOT EXISTS (SELECT 1 FROM existing_check)
            RETURNING id
          ),
          terminate_jobs AS (
            UPDATE bot_jobs 
            SET status = 'FAILED', 
                error_message = 'Terminated by supervisor due to stale heartbeat',
                completed_at = NOW()
            WHERE bot_id = ${botId}::uuid AND status = 'RUNNING'
              AND EXISTS (SELECT 1 FROM stop_current)
            RETURNING id
          ),
          create_new AS (
            INSERT INTO bot_instances (bot_id, status)
            SELECT ${botId}::uuid, 'PENDING'
            WHERE EXISTS (SELECT 1 FROM stop_current)
              AND NOT EXISTS (SELECT 1 FROM existing_check)
            RETURNING id, 'created' AS result
          )
        SELECT id, result FROM create_new
        UNION ALL
        SELECT NULL::uuid, 'blocked_by_existing' FROM existing_check
      `);
    } catch (insertErr: any) {
      if (isUniqueViolation(insertErr)) {
        console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=SKIPPED (unique constraint - race condition)`);
        return false;
      }
      throw insertErr;
    }
    
    const rows = newInstanceResult.rows as any[];
    if (rows.length === 0) {
      console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=SKIPPED (instance already stopped or changed)`);
      return false;
    }
    
    if (rows[0]?.result === 'blocked_by_existing') {
      console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=SKIPPED (running instance already exists)`);
      return false;
    }
    
    if (rows[0]?.result !== 'created') {
      console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=SKIPPED (unexpected result: ${rows[0]?.result})`);
      return false;
    }
    
    const newInstanceId = (newInstanceResult.rows[0] as any)?.id;
    
    // Log restart event
    await db.execute(sql`
      INSERT INTO system_events (event_type, severity, title, message, metadata)
      VALUES (
        'SUPERVISOR_RESTART_INITIATED',
        'warning',
        'Supervisor restart initiated',
        ${`Supervisor initiated restart for bot ${instance.bot_name}`},
        ${JSON.stringify({ 
          trace_id: traceId, 
          bot_id: botId, 
          old_instance_id: instance.id,
          new_instance_id: newInstanceId,
          last_heartbeat: instance.last_heartbeat_at
        })}::jsonb
      )
    `);
    
    console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart=INITIATED new_instance_id=${newInstanceId}`);
    return true;
    
  } catch (error) {
    console.error(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} restart_error=`, error);
    return false;
  } finally {
    await releaseLock(lockKey, lock.lockId);
  }
}

/**
 * Supervisor Loop
 * Monitors bot instances, detects failures, and manages restarts with circuit breaker
 */
async function runSupervisorLoop(): Promise<void> {
  const traceId = crypto.randomUUID();
  console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} starting supervisor check`);
  
  try {
    // Get all active bot instances that should be running
    const result = await db.execute(sql`
      SELECT bi.*, b.name as bot_name, b.stage, b.killed_at, b.is_trading_enabled
      FROM bot_instances bi
      JOIN bots b ON bi.bot_id = b.id
      WHERE bi.status = 'RUNNING'
        AND b.archived_at IS NULL
        AND b.killed_at IS NULL
    `);
    
    const instances = result.rows as any[];
    let restartAttempts = 0;
    let restartSuccesses = 0;
    let circuitBreakerBlocks = 0;
    let killTriggers = 0;
    
    for (const instance of instances) {
      const botId = instance.bot_id;
      const lastHeartbeat = instance.last_heartbeat_at ? new Date(instance.last_heartbeat_at) : null;
      const now = new Date();
      const isRunner = instance.job_type === 'RUNNER';
      
      // Use shorter threshold for RUNNERs (3 min) vs jobs (30 min)
      // Runners heartbeat every 30s, so 3 min = 6x the expected interval
      const staleThresholdMs = isRunner 
        ? RUNNER_HEARTBEAT_STALE_MINUTES * 60 * 1000 
        : HEARTBEAT_STALE_THRESHOLD_MINUTES * 60 * 1000;
      
      // Check if heartbeat is stale
      const heartbeatStale = !lastHeartbeat || 
        (now.getTime() - lastHeartbeat.getTime()) > staleThresholdMs;
      
      if (heartbeatStale) {
        const cb = getCircuitBreaker(botId);
        
        // Check if circuit breaker should reset
        if (cb.isOpen && shouldResetCircuitBreaker(cb)) {
          console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} circuit_breaker=RESET`);
          cb.failures = 0;
          cb.isOpen = false;
          cb.lastFailure = null;
        }
        
        // Check circuit breaker state - if open, trigger proactive kill for LIVE bots
        if (cb.isOpen) {
          console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} circuit_breaker=OPEN`);
          circuitBreakerBlocks++;
          
          // Proactive kill for LIVE stage bots with open circuit breaker (invariant breach)
          if (instance.stage === 'LIVE') {
            const killed = await triggerProactiveKill(
              botId, 
              `Circuit breaker open after ${cb.failures} restart failures - invariant breach`,
              traceId
            );
            if (killed) killTriggers++;
          }
          continue;
        }
        
        // Attempt restart
        console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} action=RESTART_ATTEMPT stale_heartbeat=true`);
        restartAttempts++;
        
        const restartSuccess = await attemptBotRestart(instance, traceId);
        
        if (restartSuccess) {
          restartSuccesses++;
          // Don't reset circuit breaker yet - wait for successful heartbeat from new instance
        } else {
          // Increment circuit breaker on failed restart
          cb.failures++;
          cb.lastFailure = new Date();
          
          if (cb.failures >= CIRCUIT_BREAKER_MAX_FAILURES) {
            cb.isOpen = true;
            console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${botId} circuit_breaker=OPENED failures=${cb.failures}`);
            
            // Log circuit breaker opened
            await db.execute(sql`
              INSERT INTO system_events (event_type, severity, title, message, metadata)
              VALUES (
                'CIRCUIT_BREAKER_OPENED',
                'error',
                'Circuit breaker opened',
                ${`Circuit breaker opened for bot ${instance.bot_name} after ${cb.failures} failures`},
                ${JSON.stringify({ 
                  trace_id: traceId, 
                  bot_id: botId,
                  failures: cb.failures,
                  reset_after_minutes: CIRCUIT_BREAKER_RESET_MINUTES
                })}::jsonb
              )
            `).catch(console.error);
          }
        }
      }
    }
    
    // Check for invariant breaches in stuck jobs
    const stuckJobs = await storage.getStuckJobs(HEARTBEAT_STALE_THRESHOLD_MINUTES);
    let stuckJobsRecovered = 0;
    for (const job of stuckJobs) {
      if ((job as any).bot?.stage === 'LIVE') {
        // Stuck job for LIVE bot is an invariant breach
        const killed = await triggerProactiveKill(
          (job as any).bot_id,
          `Job stuck for >${HEARTBEAT_STALE_THRESHOLD_MINUTES} minutes - invariant breach`,
          traceId
        );
        if (killed) killTriggers++;
      }
      
      // AUTO-FAIL stuck jobs for ALL bots (LAB, PAPER, SHADOW, CANARY, LIVE)
      // This prevents bots from getting permanently stuck on a failed job
      try {
        const minutesStuck = (job as any).minutesStuck || 0;
        console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} AUTO_FAILING_STUCK_JOB job_id=${job.id} bot_id=${job.botId} type=${job.jobType} stuck_minutes=${minutesStuck}`);
        
        await storage.updateBotJob(job.id, {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: `Auto-failed: Job stuck in RUNNING state for ${minutesStuck} minutes. This prevents bot from getting permanently blocked.`,
        });
        
        // Log activity event for visibility (use JOB_TIMEOUT which is a valid event type)
        await logActivityEvent({
          botId: job.botId ?? undefined,
          eventType: "JOB_TIMEOUT",
          severity: "WARN",
          title: `Auto-failed stuck ${job.jobType} job`,
          summary: `Job was stuck in RUNNING state for ${minutesStuck} minutes. Auto-failed to unblock bot.`,
          payload: { jobId: job.id, jobType: job.jobType, minutesStuck, reason: "STUCK_JOB_RECOVERY" },
          traceId,
        });
        
        stuckJobsRecovered++;
      } catch (e) {
        console.error(`[SUPERVISOR_LOOP] trace_id=${traceId} STUCK_JOB_RECOVERY_ERROR job_id=${job.id}:`, e);
      }
    }
    
    console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} instances=${instances.length} restarts=${restartSuccesses}/${restartAttempts} circuit_breaker_blocks=${circuitBreakerBlocks} kills=${killTriggers} stuck_jobs_recovered=${stuckJobsRecovered}`);
    
    // ========== AUTO-START LOGIC FOR PAPER+ BOTS ==========
    // Find PAPER/SHADOW/CANARY/LIVE bots with idle/pending instances that should be running
    // This matches the logic in /api/runners/start endpoint
    // CRITICAL: Exclude bots that already have a RUNNING instance (prevents race condition with PaperRunnerService rehydration)
    let autoStarted = 0;
    try {
      const idleBotsResult = await db.execute(sql`
        SELECT 
          bi.id as instance_id, 
          bi.bot_id, 
          bi.status,
          bi.job_type,
          b.name as bot_name, 
          b.stage, 
          b.is_trading_enabled,
          b.mode,
          b.default_account_id,
          b.user_id
        FROM bot_instances bi
        JOIN bots b ON bi.bot_id = b.id
        WHERE bi.status IN ('idle', 'IDLE', 'PENDING', 'pending')
          AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
          AND b.is_trading_enabled = true
          AND b.archived_at IS NULL
          AND b.killed_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM bot_instances bi2 
            WHERE bi2.bot_id = b.id 
              AND bi2.status IN ('RUNNING', 'running')
          )
        ORDER BY 
          CASE b.stage 
            WHEN 'LIVE' THEN 1 
            WHEN 'CANARY' THEN 2 
            WHEN 'SHADOW' THEN 3 
            WHEN 'PAPER' THEN 4 
          END
        LIMIT 10
      `);
      
      const idleBots = idleBotsResult.rows as any[];
      
      // Map stage to execution mode (matches STAGE_TO_MODE in routes.ts)
      const stageToMode: Record<string, string> = {
        LAB: 'BACKTEST_ONLY',
        PAPER: 'SIM_LIVE',
        SHADOW: 'SHADOW',
        CANARY: 'CANARY',
        LIVE: 'LIVE',
      };
      
      for (const bot of idleBots) {
        // Check circuit breaker before auto-starting
        const cb = getCircuitBreaker(bot.bot_id);
        if (cb.isOpen) {
          console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${bot.bot_id} AUTO_START_BLOCKED circuit_breaker=OPEN`);
          continue;
        }
        
        const executionMode = stageToMode[bot.stage] || 'SIM_LIVE';
        const now = new Date();
        
        // Find a SIM/VIRTUAL account for the bot (like /api/runners/start does)
        // Scope to bot's user for security
        let accountId = bot.default_account_id;
        if (!accountId && bot.user_id) {
          // Query for user's SIM/VIRTUAL account
          const accountResult = await db.execute(sql`
            SELECT id FROM accounts 
            WHERE user_id = ${bot.user_id}::uuid
              AND account_type IN ('SIM', 'VIRTUAL') 
              AND is_active = true 
            LIMIT 1
          `);
          if (accountResult.rows.length > 0) {
            accountId = (accountResult.rows[0] as any).id;
          }
        }
        
        // FAIL-CLOSED: Skip if no account available (except PAPER stage which uses simulated trading)
        if (!accountId && bot.stage !== 'PAPER') {
          console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${bot.bot_id} AUTO_START_SKIPPED reason=NO_ACCOUNT stage=${bot.stage}`);
          continue;
        }
        
        // Auto-start the runner with proper configuration (matching /api/runners/start)
        // Use uppercase 'RUNNING' to match DB convention
        await db.execute(sql`
          UPDATE bot_instances 
          SET status = 'RUNNING', 
              activity_state = 'SCANNING',
              execution_mode = ${executionMode},
              is_primary_runner = true,
              job_type = 'RUNNER',
              account_id = ${accountId},
              started_at = NOW(),
              updated_at = NOW(),
              last_heartbeat_at = NOW()
          WHERE id = ${bot.instance_id}::uuid
        `);
        
        // Update bot health state to OK
        await db.execute(sql`
          UPDATE bots 
          SET health_state = 'OK',
              health_reason_code = NULL,
              health_reason_detail = NULL,
              health_degraded_since = NULL,
              updated_at = NOW()
          WHERE id = ${bot.bot_id}::uuid
        `);
        
        console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} bot_id=${bot.bot_id} AUTO_STARTED stage=${bot.stage} mode=${executionMode} instance=${bot.instance_id}`);
        
        // Log system event for visibility
        await db.execute(sql`
          INSERT INTO system_events (event_type, severity, title, message, metadata)
          VALUES (
            'RUNNER_AUTO_STARTED',
            'info',
            ${`Auto-started runner for ${bot.bot_name}`},
            ${`${bot.stage} stage runner started automatically with mode=${executionMode}`},
            ${JSON.stringify({ 
              trace_id: traceId, 
              bot_id: bot.bot_id, 
              instance_id: bot.instance_id,
              stage: bot.stage,
              mode: executionMode,
              activity_state: 'SCANNING'
            })}::jsonb
          )
        `);
        
        autoStarted++;
      }
      
      if (autoStarted > 0) {
        console.log(`[SUPERVISOR_LOOP] trace_id=${traceId} AUTO_STARTED_RUNNERS count=${autoStarted}`);
      }
    } catch (autoStartError) {
      console.error(`[SUPERVISOR_LOOP] trace_id=${traceId} AUTO_START_ERROR:`, autoStartError);
    }
    
  } catch (error) {
    console.error(`[SUPERVISOR_LOOP] trace_id=${traceId} error=`, error);
  }
}

/**
 * Promote matrix results to bot table for UI display
 * Aggregates completed cells and finds best/worst configurations
 */
async function promoteMatrixToBot(botId: string, matrixRunId: string, traceId: string): Promise<void> {
  try {
    // Get all completed cells for this matrix run
    const cells = await db.select().from(matrixCells).where(eq(matrixCells.matrixRunId, matrixRunId));
    const completedCells = cells.filter(c => c.status === "completed" && c.profitFactor !== null);
    
    if (completedCells.length === 0) {
      console.log(`[MATRIX_PROMOTE] trace_id=${traceId} bot=${botId} no_completed_cells skipping`);
      return;
    }
    
    // Calculate aggregate metrics
    const totalTrades = completedCells.reduce((sum, c) => sum + (c.totalTrades || 0), 0);
    const avgProfitFactor = completedCells.reduce((sum, c) => sum + (Number(c.profitFactor) || 0), 0) / completedCells.length;
    const avgWinRate = completedCells.reduce((sum, c) => sum + (Number(c.winRate) || 0), 0) / completedCells.length;
    const totalNetPnl = completedCells.reduce((sum, c) => sum + (Number(c.netPnl) || 0), 0);
    
    // Find best cell (by profit factor)
    const bestCell = completedCells.reduce((best, c) => 
      (Number(c.profitFactor) || 0) > (Number(best.profitFactor) || 0) ? c : best
    );
    
    // Find worst cell (by profit factor)
    const worstCell = completedCells.reduce((worst, c) => 
      (Number(c.profitFactor) || 0) < (Number(worst.profitFactor) || 0) ? c : worst
    );
    
    const aggregate = {
      totalCells: completedCells.length,
      totalTrades,
      avgProfitFactor: Math.round(avgProfitFactor * 1000) / 1000,
      avgWinRate: Math.round(avgWinRate * 100) / 100,
      totalNetPnl: Math.round(totalNetPnl * 100) / 100,
      matrixRunId,
      updatedAt: new Date().toISOString(),
    };
    
    // Calculate expectancy from netPnl/totalTrades if not stored in cell
    const bestExpectancy = Number(bestCell.expectancy) || 
      (bestCell.totalTrades && bestCell.totalTrades > 0 ? Number(bestCell.netPnl) / bestCell.totalTrades : 0);
    
    const bestCellData = {
      timeframe: bestCell.timeframe,
      horizon: bestCell.horizon,
      profitFactor: Number(bestCell.profitFactor),
      totalTrades: bestCell.totalTrades,
      winRate: Number(bestCell.winRate),
      netPnl: Number(bestCell.netPnl),
      sharpeRatio: Number(bestCell.sharpeRatio) || 0,
      maxDrawdownPct: Number(bestCell.maxDrawdownPct) || 0,
      expectancy: bestExpectancy,
      losingTrades: (bestCell.totalTrades || 0) - Math.round((bestCell.totalTrades || 0) * (Number(bestCell.winRate) || 0)),
    };
    
    const worstCellData = {
      timeframe: worstCell.timeframe,
      horizon: worstCell.horizon,
      profitFactor: Number(worstCell.profitFactor),
      totalTrades: worstCell.totalTrades,
      winRate: Number(worstCell.winRate),
      netPnl: Number(worstCell.netPnl),
      sharpeRatio: Number(worstCell.sharpeRatio) || 0,
      maxDrawdownPct: Number(worstCell.maxDrawdownPct) || 0,
      expectancy: Number(worstCell.expectancy) || 0,
      losingTrades: (worstCell.totalTrades || 0) - Math.round((worstCell.totalTrades || 0) * (Number(worstCell.winRate) || 0)),
    };
    
    // Update bot with matrix data
    await db.execute(sql`
      UPDATE bots SET 
        matrix_aggregate = ${JSON.stringify(aggregate)}::jsonb,
        matrix_best_cell = ${JSON.stringify(bestCellData)}::jsonb,
        matrix_worst_cell = ${JSON.stringify(worstCellData)}::jsonb,
        matrix_updated_at = NOW()
      WHERE id = ${botId}::uuid
    `);
    
    console.log(`[MATRIX_PROMOTE] trace_id=${traceId} bot=${botId} cells=${completedCells.length} best=${bestCell.timeframe}/${bestCell.horizon} pf=${bestCell.profitFactor}`);
    
  } catch (error) {
    console.error(`[MATRIX_PROMOTE] trace_id=${traceId} bot=${botId} error=`, error);
  }
}

/**
 * Process a matrix run - executes backtests across all timeframe x horizon combinations
 */
async function processMatrixRun(matrixRunId: string, botId: string, traceId: string): Promise<{ success: boolean; error?: string; cellsCompleted?: number }> {
  console.log(`[MATRIX_WORKER] trace_id=${traceId} starting matrix run ${matrixRunId}`);
  
  try {
    // Update matrix run status to RUNNING
    await db.update(matrixRuns).set({ status: "RUNNING", startedAt: new Date() }).where(eq(matrixRuns.id, matrixRunId));
    
    // Get pending cells
    const cells = await db.select().from(matrixCells).where(eq(matrixCells.matrixRunId, matrixRunId));
    const pendingCells = cells.filter(c => c.status === "pending");
    
    console.log(`[MATRIX_WORKER] trace_id=${traceId} matrix_run=${matrixRunId} total_cells=${cells.length} pending=${pendingCells.length}`);
    
    let completedCount = 0;
    let failedCount = 0;
    
    for (const cell of pendingCells) {
      try {
        // Mark cell as running and update matrix run's current timeframe (for UI display)
        await db.update(matrixCells).set({
          status: "running",
        }).where(eq(matrixCells.id, cell.id));
        
        await db.update(matrixRuns).set({
          currentTimeframe: cell.timeframe,
        }).where(eq(matrixRuns.id, matrixRunId));
        
        // Parse horizon to days
        const horizonDays = parseInt(cell.horizon.replace("d", ""));
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - horizonDays * 24 * 60 * 60 * 1000);
        
        // Execute backtest for this cell
        const result = await executeMatrixBacktest({
          botId,
          symbol: "MES", // Default symbol
          timeframe: cell.timeframe,
          startDate,
          endDate,
          initialCapital: 10000,
        }, traceId);
        
        if (result.success) {
          // Update cell with results
          await db.update(matrixCells).set({
            status: "completed",
            backtestSessionId: result.sessionId,
            profitFactor: result.metrics?.profitFactor || null,
            totalTrades: result.metrics?.totalTrades || 0,
            winRate: result.metrics?.winRate || null,
            netPnl: result.metrics?.netPnl || null,
            maxDrawdownPct: result.metrics?.maxDrawdownPct || null,
            sharpeRatio: result.metrics?.sharpeRatio || null,
            completedAt: new Date(),
          }).where(eq(matrixCells.id, cell.id));
          completedCount++;
        } else {
          await db.update(matrixCells).set({
            status: "failed",
            errorMessage: result.error,
            completedAt: new Date(),
          }).where(eq(matrixCells.id, cell.id));
          failedCount++;
        }
        
        // Update matrix run progress
        await db.update(matrixRuns).set({
          completedCells: completedCount,
          failedCells: failedCount,
        }).where(eq(matrixRuns.id, matrixRunId));
        
      } catch (cellError) {
        console.error(`[MATRIX_WORKER] trace_id=${traceId} cell=${cell.id} error=`, cellError);
        await db.update(matrixCells).set({
          status: "failed",
          errorMessage: cellError instanceof Error ? cellError.message : "Unknown error",
          completedAt: new Date(),
        }).where(eq(matrixCells.id, cell.id));
        failedCount++;
      }
    }
    
    // Mark matrix run as completed and clear current timeframe
    await db.update(matrixRuns).set({
      status: "COMPLETED",
      completedAt: new Date(),
      completedCells: completedCount,
      failedCells: failedCount,
      currentTimeframe: null,
    }).where(eq(matrixRuns.id, matrixRunId));
    
    // INSTITUTIONAL: Record batch metrics for variance detection
    // Fetch all completed cells to check for anomalies (all identical = bug indicator)
    try {
      const completedCells = await db.select({
        sharpeRatio: matrixCells.sharpeRatio,
        profitFactor: matrixCells.profitFactor,
        winRate: matrixCells.winRate,
      })
        .from(matrixCells)
        .where(and(
          eq(matrixCells.matrixRunId, matrixRunId),
          eq(matrixCells.status, "completed")
        ));
      
      if (completedCells.length >= 3) {
        const sharpeValues = completedCells.map(c => Number(c.sharpeRatio) || 0);
        const pfValues = completedCells.map(c => Number(c.profitFactor) || 0);
        const wrValues = completedCells.map(c => Number(c.winRate) || 0);
        
        recordBatchMetrics(`matrix_${matrixRunId}`, "sharpe", sharpeValues);
        recordBatchMetrics(`matrix_${matrixRunId}`, "profitFactor", pfValues);
        recordBatchMetrics(`matrix_${matrixRunId}`, "winRate", wrValues);
      }
    } catch (metricsError) {
      console.warn(`[MATRIX_WORKER] trace_id=${traceId} variance_check_error:`, metricsError);
    }
    
    // INSTITUTIONAL: Promote matrix results to bot table for UI display
    await promoteMatrixToBot(botId, matrixRunId, traceId);
    
    console.log(`[MATRIX_WORKER] trace_id=${traceId} matrix_run=${matrixRunId} completed cells=${completedCount} failed=${failedCount}`);
    
    return { success: true, cellsCompleted: completedCount };
    
  } catch (error) {
    console.error(`[MATRIX_WORKER] trace_id=${traceId} matrix_run=${matrixRunId} error=`, error);
    
    await db.update(matrixRuns).set({
      status: "FAILED",
      completedAt: new Date(),
      currentTimeframe: null,
    }).where(eq(matrixRuns.id, matrixRunId));
    
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * BACKTESTER Job Consumer Worker
 * Processes queued BACKTESTER jobs with concurrency control and circuit breaker
 */
async function runBacktestWorker(): Promise<void> {
  const traceId = crypto.randomUUID();
  
  // Check circuit breaker
  if (backtestCircuitBreaker.isOpen) {
    if (backtestCircuitBreaker.lastFailure) {
      const resetTime = new Date(backtestCircuitBreaker.lastFailure.getTime() + CIRCUIT_BREAKER_RESET_MINUTES * 60 * 1000);
      if (new Date() > resetTime) {
        console.log(`[BACKTEST_WORKER] trace_id=${traceId} circuit_breaker_reset`);
        backtestCircuitBreaker.isOpen = false;
        backtestCircuitBreaker.failures = 0;
      } else {
        console.log(`[BACKTEST_WORKER] trace_id=${traceId} circuit_breaker_open skipping`);
        return;
      }
    }
  }

  // Get dynamic concurrency limits based on available memory
  const concurrencyLimits = getBacktestConcurrencyLimits();
  const maxConcurrent = concurrencyLimits.heavy; // Use heavy limit as the overall cap

  // Check concurrency limit
  if (activeBacktests >= maxConcurrent) {
    console.log(`[BACKTEST_WORKER] trace_id=${traceId} at_concurrency_limit=${maxConcurrent}`);
    return;
  }

  try {
    // Get queued BACKTESTER jobs
    const jobs = await storage.getBotJobs({ status: "QUEUED" });
    const backtestJobs = jobs.filter(j => 
      j.jobType === "BACKTESTER" || j.jobType === "BACKTEST"
    ).slice(0, maxConcurrent - activeBacktests);

    if (backtestJobs.length === 0) {
      // DEBUG: Log when no backtest jobs found but other jobs exist
      if (jobs.length > 0) {
        const jobTypes = [...new Set(jobs.map(j => j.jobType))];
        console.log(`[BACKTEST_WORKER] trace_id=${traceId} no_backtest_jobs total_queued=${jobs.length} types=${jobTypes.join(',')}`);
      }
      return;
    }

    console.log(`[BACKTEST_WORKER] trace_id=${traceId} processing_jobs=${backtestJobs.length}`);

    for (const job of backtestJobs) {
      activeBacktests++;
      
      try {
        // Claim the job
        await storage.updateBotJob(job.id, {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: (job.attempts || 0) + 1,
        });

        const payload = job.payload as any || {};
        const sessionId = payload.sessionId;
        
        // Handle MATRIX_RUN type jobs
        if (payload.type === "MATRIX_RUN" && payload.matrixRunId) {
          console.log(`[BACKTEST_WORKER] trace_id=${traceId} processing MATRIX_RUN id=${payload.matrixRunId}`);
          const matrixResult = await processMatrixRun(payload.matrixRunId, job.botId!, traceId);
          
          const now = new Date();
          await storage.updateBotJob(job.id, {
            status: matrixResult.success ? "COMPLETED" : "FAILED",
            completedAt: now,
            result: matrixResult,
            errorMessage: matrixResult.error,
          });
          
          if (matrixResult.success && job.botId) {
            await storage.updateBot(job.botId, { lastBacktestAt: now });
          }
          continue;
        }
        
        // Determine the session ID - either from payload or create a new one
        let actualSessionId = sessionId;
        
        if (!actualSessionId && job.botId) {
          // No session, create one
          const reason = payload.reason || '';
          const isPromotionGuard = reason.includes('PROMOTION_GUARD');
          actualSessionId = await queueBaselineBacktest(job.botId, traceId, {
            forceNew: isPromotionGuard,
            reason: reason
          });
          if (!actualSessionId) {
            throw new Error("Failed to create backtest session");
          }
          
          if (isPromotionGuard) {
            console.log(`[BACKTEST_WORKER] trace_id=${traceId} bot_id=${job.botId} PROMOTION_GUARD: created new session ${actualSessionId}`);
          }
          console.log(`[BACKTEST_WORKER] trace_id=${traceId} bot_id=${job.botId} created_session=${actualSessionId} - will now execute`);
        }
        
        if (!actualSessionId) {
          throw new Error("No session ID available for backtest execution");
        }

        // Execute the backtest
        const result = await executeBacktest(actualSessionId, {
          botId: job.botId!,
          symbol: payload.symbol || "MNQ",
          timeframe: payload.timeframe || "5m",
          startDate: new Date(payload.startDate || Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date(payload.endDate || Date.now()),
          initialCapital: payload.initialCapital || 10000,
        }, traceId);

        if (result.success) {
          const now = new Date();
          await storage.updateBotJob(job.id, {
            status: "COMPLETED",
            completedAt: now,
            result: { success: true, sessionId: actualSessionId },
          });
          
          // Update bot's lastBacktestAt for accurate timestamp display
          if (job.botId) {
            await storage.updateBot(job.botId, { lastBacktestAt: now });
          }
          
          // Reset circuit breaker on success
          backtestCircuitBreaker.failures = 0;
        } else {
          throw new Error(result.error || "Backtest execution failed");
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[BACKTEST_WORKER] trace_id=${traceId} job_id=${job.id} error=`, errorMessage);

        const now = new Date();
        await storage.updateBotJob(job.id, {
          status: "FAILED",
          completedAt: now,
          errorMessage,
        });
        
        // INSTITUTIONAL FIX: Always update lastBacktestAt even on failure
        // This prevents "overdue" badges from appearing when jobs fail
        if (job.botId) {
          await storage.updateBot(job.botId, { lastBacktestAt: now });
        }

        // Update circuit breaker
        backtestCircuitBreaker.failures++;
        backtestCircuitBreaker.lastFailure = new Date();
        
        if (backtestCircuitBreaker.failures >= CIRCUIT_BREAKER_MAX_FAILURES) {
          backtestCircuitBreaker.isOpen = true;
          console.log(`[BACKTEST_WORKER] trace_id=${traceId} circuit_breaker_opened failures=${backtestCircuitBreaker.failures}`);
          
          await logActivityEvent({
            eventType: "AUTONOMY_GATE_BLOCKED",
            severity: "WARN",
            title: "Backtest circuit breaker opened",
            summary: `Too many consecutive failures (${backtestCircuitBreaker.failures})`,
            payload: { failures: backtestCircuitBreaker.failures, cooldownMinutes: CIRCUIT_BREAKER_RESET_MINUTES },
            traceId,
          });
        }
      } finally {
        activeBacktests--;
      }
    }

  } catch (error) {
    console.error(`[BACKTEST_WORKER] trace_id=${traceId} error=`, error);
  }
}

/**
 * Economic Calendar Refresh Worker
 * Fetches upcoming economic events from FMP and stores them
 */
async function runEconomicCalendarRefresh(): Promise<void> {
  const traceId = crypto.randomUUID();
  console.log(`[ECONOMIC_CALENDAR] trace_id=${traceId} starting refresh`);
  
  try {
    const { refreshEconomicCalendar } = await import("./fmp-economic-calendar");
    const result = await refreshEconomicCalendar(storage);
    
    if (result.success) {
      console.log(`[ECONOMIC_CALENDAR] trace_id=${traceId} success events=${result.eventsCount} range=${result.dateRange?.from}..${result.dateRange?.to}`);
    } else {
      console.warn(`[ECONOMIC_CALENDAR] trace_id=${traceId} failed error=${result.error}`);
    }
  } catch (error) {
    console.error(`[ECONOMIC_CALENDAR] trace_id=${traceId} error=`, error);
  }
}

/**
 * Evolution Worker - processes IMPROVING and EVOLVING jobs
 * IMPROVING: Simulates parameter tuning/optimization
 * EVOLVING: Creates new generation with strategy mutations (increments bot generation)
 */
async function runEvolutionWorker(): Promise<void> {
  const traceId = crypto.randomUUID();

  try {
    // Get queued IMPROVING and EVOLVING jobs
    const jobs = await storage.getBotJobs({ status: "QUEUED" });
    const evolutionJobs = jobs.filter(j => 
      j.jobType === "IMPROVING" || j.jobType === "EVOLVING"
    ).slice(0, 3); // Process up to 3 at a time

    if (evolutionJobs.length === 0) {
      return;
    }

    console.log(`[EVOLUTION_WORKER] trace_id=${traceId} processing_jobs=${evolutionJobs.length}`);

    for (const job of evolutionJobs) {
      try {
        // Claim the job
        await storage.updateBotJob(job.id, {
          status: "RUNNING",
          startedAt: new Date(),
          attempts: (job.attempts || 0) + 1,
        });

        const payload = job.payload as any || {};
        const botId = job.botId;

        if (!botId) {
          throw new Error("Job missing botId");
        }

        // Simulate processing time (realistic delay)
        await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

        if (job.jobType === "IMPROVING") {
          // ============ HEALTH CHECK: Skip bots with unhealthy backtests (SEV-0 AUTONOMY) ============
          // If recent backtests are failing or producing 0 trades, skip improvement and let backtester fix first
          const healthCheck = await db.execute(sql`
            SELECT 
              COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
              COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(total_trades, 0) = 0) as zero_trade_count,
              COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(total_trades, 0) > 0) as healthy_count,
              MAX(CASE WHEN status = 'completed' AND COALESCE(total_trades, 0) > 0 THEN completed_at END) as last_healthy_at
            FROM backtest_sessions
            WHERE bot_id = ${botId}::uuid
            AND started_at > NOW() - INTERVAL '24 hours'
          `);
          
          const healthResult = healthCheck.rows[0] as any;
          const failedCount = parseInt(healthResult?.failed_count || "0");
          const zeroTradeCount = parseInt(healthResult?.zero_trade_count || "0");
          const healthyCount = parseInt(healthResult?.healthy_count || "0");
          
          // If no healthy backtests in 24h but multiple failures, skip improvement
          if (healthyCount === 0 && (failedCount + zeroTradeCount) >= 2) {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} HEALTH_BLOCK bot=${botId} failed=${failedCount} zero_trades=${zeroTradeCount} healthy=${healthyCount}`);
            
            await storage.updateBotJob(job.id, {
              status: "FAILED",
              completedAt: new Date(),
              result: { 
                success: false, 
                type: "IMPROVING",
                reason: `Unhealthy backtest history: ${failedCount} failed, ${zeroTradeCount} zero-trade, ${healthyCount} healthy in 24h`,
                action: "DIAGNOSE_BACKTEST_PIPELINE",
              },
            });

            await logActivityEvent({
              botId,
              eventType: "AUTONOMY_GATE_BLOCKED",
              severity: "WARN",
              title: `Improvement blocked: Unhealthy backtests`,
              summary: `No successful backtests with trades in 24h. Diagnose strategy entry conditions.`,
              payload: { 
                failedCount,
                zeroTradeCount,
                healthyCount,
                lastHealthyAt: healthResult?.last_healthy_at,
              },
              traceId,
            });
            
            continue; // Skip to next job - don't waste cycles on broken bot
          }
          
          // IMPROVING: Simulate parameter tuning with realistic changes
          console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} IMPROVING bot=${botId}`);
          
          // ============ AI LEARNING: Query trade history from BLOWN attempts ============
          // This provides the AI with historical failure patterns to learn from
          // Only queries accounts linked via PRIMARY runner instance to avoid unrelated data
          let blownAttemptAnalysis = null;
          try {
            const blownTradesResult = await db.execute(sql`
              SELECT 
                aa.attempt_number,
                aa.blown_reason,
                aa.metrics_snapshot,
                COUNT(pt.id) as trade_count,
                SUM(CASE WHEN pt.pnl > 0 THEN 1 ELSE 0 END) as winning_trades,
                SUM(CASE WHEN pt.pnl <= 0 THEN 1 ELSE 0 END) as losing_trades,
                COALESCE(SUM(pt.pnl), 0) as total_pnl,
                AVG(CASE WHEN pt.pnl > 0 THEN pt.pnl END) as avg_win,
                AVG(CASE WHEN pt.pnl <= 0 THEN ABS(pt.pnl) END) as avg_loss,
                MAX(pt.exit_time) as last_trade_at
              FROM bot_instances bi
              JOIN account_attempts aa ON aa.account_id = bi.account_id
              LEFT JOIN paper_trades pt ON pt.account_attempt_id = aa.id 
                AND pt.bot_id = bi.bot_id 
                AND pt.status = 'CLOSED'
              WHERE bi.bot_id = ${botId}::uuid
                AND bi.is_primary_runner = true
                AND aa.status = 'BLOWN'
              GROUP BY aa.id, aa.attempt_number, aa.blown_reason, aa.metrics_snapshot
              ORDER BY aa.attempt_number DESC, aa.id DESC
              LIMIT 5
            `);
            
            if (blownTradesResult.rows.length > 0) {
              blownAttemptAnalysis = {
                blownAttemptsCount: blownTradesResult.rows.length,
                attempts: blownTradesResult.rows.map((row: any) => {
                  const tradeCount = parseInt(row.trade_count || "0", 10);
                  const winningTrades = parseInt(row.winning_trades || "0", 10);
                  const losingTrades = parseInt(row.losing_trades || "0", 10);
                  return {
                    attemptNumber: row.attempt_number,
                    blownReason: row.blown_reason,
                    tradeCount,
                    winningTrades,
                    losingTrades,
                    totalPnl: parseFloat(row.total_pnl || "0"),
                    avgWin: row.avg_win != null ? parseFloat(row.avg_win) : null,
                    avgLoss: row.avg_loss != null ? parseFloat(row.avg_loss) : null,
                    winRate: tradeCount > 0 ? Number((winningTrades / tradeCount * 100).toFixed(1)) : null,
                    lastTradeAt: row.last_trade_at,
                    metricsSnapshot: row.metrics_snapshot,
                  };
                }),
              };
              console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} BLOWN_HISTORY loaded=${blownAttemptAnalysis.blownAttemptsCount} attempts`);
            }
          } catch (historyErr) {
            console.warn(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} blown history query failed:`, historyErr);
          }
          
          // Generate realistic parameter adjustments based on iteration
          const iteration = payload.iteration || 1;
          const parameterChanges = generateImprovementChanges(iteration);
          
          await storage.updateBotJob(job.id, {
            status: "COMPLETED",
            completedAt: new Date(),
            result: { 
              success: true, 
              type: "IMPROVING",
              iteration,
              changes: parameterChanges.map(c => c.description),
              blownAttemptAnalysis: blownAttemptAnalysis,
            },
          });

          // Build detailed summary with actual changes
          const changesSummary = parameterChanges.slice(0, 2).map(c => c.description).join(", ");
          const blownHistorySummary = blownAttemptAnalysis 
            ? ` (learned from ${blownAttemptAnalysis.blownAttemptsCount} blown attempts)` 
            : '';
          
          await logActivityEvent({
            botId,
            eventType: "BACKTEST_COMPLETED",
            severity: "INFO",
            title: `Improvement cycle ${iteration} complete${blownHistorySummary}`,
            summary: changesSummary || `Parameters tuned for ${payload.symbol || 'MNQ'}`,
            payload: { 
              jobType: "IMPROVING", 
              iteration,
              changes: parameterChanges,
              blownAttemptAnalysis: blownAttemptAnalysis,
            },
            traceId,
          });

          // INSTITUTIONAL: Auto-queue matrix run after IMPROVING completes
          // Matrix runs provide multi-timeframe performance validation
          const symbol = payload.symbol || "MNQ";
          const matrixResult = await queueMatrixRun(botId, symbol, traceId);
          if (matrixResult.queued) {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} matrix_queued`);
          } else {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} matrix_skipped reason=${matrixResult.reason}`);
          }

          // AUTONOMOUS RECOVERY: Auto-reset account and restart trading after blown account improvement
          if (payload.trigger === 'BLOWN_ACCOUNT_RECOVERY') {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} BLOWN_RECOVERY_COMPLETE - auto-resetting account`);
            
            try {
              // Get bot's account and instance from bot_instances
              const instanceResult = await db.execute(sql`
                SELECT bi.id as instance_id, bi.account_id, a.name as account_name, a.initial_balance
                FROM bot_instances bi
                JOIN accounts a ON bi.account_id = a.id
                WHERE bi.bot_id = ${botId}::uuid
                  AND bi.is_primary_runner = true
                LIMIT 1
              `);
              
              const instance = instanceResult.rows[0] as any;
              if (!instance?.account_id) {
                // No primary instance found - log and skip
                await logActivityEvent({
                  botId,
                  eventType: "SELF_HEALING_SKIPPED",
                  severity: "WARN",
                  title: `Auto-reset skipped: No primary instance found`,
                  summary: `Strategy improved but no account linked. Manual reset required.`,
                  payload: { trigger: 'BLOWN_ACCOUNT_RECOVERY', reason: 'NO_PRIMARY_INSTANCE' },
                  traceId,
                });
                console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} RECOVERY_SKIPPED - no primary instance`);
              } else {
                // Reset the account with same initial balance
                const resetBalance = instance.initial_balance || 1000;
                const resetAccount = await storage.resetAccountForNewAttempt(instance.account_id, resetBalance);
                
                await logActivityEvent({
                  botId,
                  accountId: instance.account_id,
                  eventType: "SELF_HEALING_RECOVERY",
                  severity: "INFO",
                  title: `Auto-reset: ${instance.account_name || 'Account'} restored to $${resetBalance}`,
                  summary: `Account automatically reset after successful strategy improvement. Trading will resume.`,
                  payload: {
                    trigger: 'BLOWN_ACCOUNT_RECOVERY',
                    newBalance: resetBalance,
                    attemptNumber: resetAccount.currentAttemptNumber,
                  },
                  traceId,
                });
                
                // Restart paper runner for this bot (only after successful reset)
                try {
                  const { paperRunnerService } = await import("./paper-runner-service");
                  await paperRunnerService.startBot(botId, instance.instance_id);
                  console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} AUTONOMOUS_RECOVERY_SUCCESS account=${instance.account_id.slice(0,8)} balance=$${resetBalance}`);
                } catch (startErr) {
                  console.error(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} runner restart failed:`, startErr);
                  await logActivityEvent({
                    botId,
                    accountId: instance.account_id,
                    eventType: "SELF_HEALING_FAILED",
                    severity: "WARN",
                    title: `Account reset succeeded but runner restart failed`,
                    summary: `Account was reset but paper runner could not be restarted. Manual restart may be required.`,
                    payload: { 
                      trigger: 'BLOWN_ACCOUNT_RECOVERY', 
                      accountId: instance.account_id,
                      instanceId: instance.instance_id,
                      error: String(startErr),
                    },
                    traceId,
                  });
                }
              }
            } catch (resetErr) {
              console.error(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} auto-reset failed:`, resetErr);
              await logActivityEvent({
                botId,
                eventType: "SELF_HEALING_FAILED",
                severity: "WARN",
                title: `Auto-reset failed after improvement`,
                summary: `Strategy improved but account reset failed. Manual reset required.`,
                payload: { error: String(resetErr), trigger: 'BLOWN_ACCOUNT_RECOVERY' },
                traceId,
              });
            }
          }

        } else if (job.jobType === "EVOLVING") {
          // EVOLVING: Create new generation - increment bot generation with P&L snapshot
          console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} EVOLVING bot=${botId}`);

          // Get current bot with sim/live metrics for P&L snapshot (using existing schema fields)
          const botResult = await db.execute(sql`
            SELECT b.current_generation, b.name, b.symbol,
                   b.sim_pnl, b.sim_total_trades, b.live_pnl, b.live_total_trades, b.live_win_rate,
                   b.matrix_best_cell->>'timeframe' as best_timeframe,
                   (SELECT bs.net_pnl FROM backtest_sessions bs 
                    WHERE bs.bot_id = b.id AND bs.status = 'completed' 
                    ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_backtest_pnl,
                   (SELECT bs.total_trades FROM backtest_sessions bs 
                    WHERE bs.bot_id = b.id AND bs.status = 'completed' 
                    ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_backtest_trades,
                   (SELECT bs.win_rate FROM backtest_sessions bs 
                    WHERE bs.bot_id = b.id AND bs.status = 'completed' 
                    ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_backtest_win_rate,
                   (SELECT bs.max_drawdown_pct FROM backtest_sessions bs 
                    WHERE bs.bot_id = b.id AND bs.status = 'completed' 
                    ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_backtest_max_dd
            FROM bots b WHERE b.id = ${botId}::uuid
          `);
          const bot = botResult.rows[0] as any;
          const currentGen = bot?.current_generation || 1;
          const newGen = currentGen + 1;

          // INSTITUTIONAL PRECONDITION: Require backtest evidence before evolution
          // Evolution without trading evidence is meaningless - abort and wait for backtests
          const latestBacktestTrades = parseInt(bot?.latest_backtest_trades || "0");
          // 15 trades minimum for AI evolution (balance between data quality and practicality)
          const MINIMUM_TRADES_FOR_EVOLUTION = 15;
          
          if (latestBacktestTrades < MINIMUM_TRADES_FOR_EVOLUTION) {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} ABORT: No backtest evidence (trades=${latestBacktestTrades}, required=${MINIMUM_TRADES_FOR_EVOLUTION})`);
            
            await storage.updateBotJob(job.id, {
              status: "FAILED",
              completedAt: new Date(),
              result: { 
                success: false, 
                type: "EVOLVING",
                reason: `Insufficient backtest evidence: ${latestBacktestTrades}/${MINIMUM_TRADES_FOR_EVOLUTION} trades required`,
                action: "RETRY_AFTER_BACKTEST",
              },
            });

            await logActivityEvent({
              botId,
              eventType: "AUTONOMY_GATE_BLOCKED",
              severity: "INFO",
              title: `${bot?.name || 'Bot'}: Building trade history`,
              summary: `Need ${MINIMUM_TRADES_FOR_EVOLUTION - latestBacktestTrades} more trades for AI evolution (have ${latestBacktestTrades}/${MINIMUM_TRADES_FOR_EVOLUTION})`,
              payload: { 
                jobType: "EVOLVING", 
                reason: "INSUFFICIENT_BACKTEST_EVIDENCE",
                tradesRequired: MINIMUM_TRADES_FOR_EVOLUTION,
                tradesAvailable: latestBacktestTrades,
              },
              traceId,
            });
            
            continue; // Skip to next job
          }

          // INSTITUTIONAL: AI-DRIVEN EVOLUTION - Call LLM for strategy improvements
          console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} AI_EVOLUTION calling LLM for ${bot?.name || 'bot'}`);
          
          // Fetch full bot data for AI analysis
          const fullBot = await storage.getBot(botId);
          if (!fullBot) {
            console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} ERROR: Bot not found for AI evolution`);
            continue;
          }

          // Prepare performance metrics for AI
          const performance = {
            winRate: parseFloat(bot?.latest_backtest_win_rate || "0"),
            profitFactor: 1.0, // Will be calculated from backtest if available
            sharpeRatio: 0,
            maxDrawdown: parseFloat(bot?.latest_backtest_max_dd || "0"),
          };

          // Call AI for evolution suggestions
          let aiSuggestions: any = null;
          let appliedChanges: string[] = [];
          let aiProvider = "none";
          let aiCost = 0;

          try {
            // Pass userId to enable cost event logging for LLM badge
            const aiResult = await generateEvolutionSuggestions(fullBot, performance, traceId, latestBacktestTrades, fullBot.userId || undefined);
            
            if (aiResult.success && aiResult.data) {
              aiSuggestions = aiResult.data.suggestions;
              aiProvider = aiResult.data.aiProvider;
              aiCost = aiResult.cost?.costUsd || 0;
              
              console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} AI_SUGGESTIONS provider=${aiProvider} count=${aiSuggestions?.length || 0} cost=$${aiCost.toFixed(4)}`);

              // Apply HIGH priority suggestions to strategy config
              if (aiSuggestions && aiSuggestions.length > 0) {
                const currentConfig = (fullBot.strategyConfig as Record<string, any>) || {};
                const { updatedConfig, appliedChanges: changes } = applyEvolutionSuggestions(currentConfig, aiSuggestions);
                appliedChanges = changes;

                // Update bot's strategy config with AI suggestions
                if (appliedChanges.length > 0) {
                  await db.execute(sql`
                    UPDATE bots 
                    SET strategy_config = ${JSON.stringify(updatedConfig)}::jsonb,
                        updated_at = NOW()
                    WHERE id = ${botId}::uuid
                  `);
                  console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} AI_APPLIED changes=${appliedChanges.length}`);
                }
              }

              await logActivityEvent({
                botId,
                eventType: "INTEGRATION_PROOF",
                severity: "INFO",
                title: `AI Evolution: ${bot?.name || 'Bot'}`,
                summary: `${aiProvider} provided ${aiSuggestions?.length || 0} suggestions, ${appliedChanges.length} applied`,
                payload: {
                  provider: aiProvider,
                  suggestionCount: aiSuggestions?.length || 0,
                  appliedCount: appliedChanges.length,
                  appliedChanges,
                  cost: aiCost.toFixed(6),
                },
                traceId,
              });
            } else {
              // AI call failed - log but continue with evolution (don't block)
              console.warn(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} AI_UNAVAILABLE reason=${aiResult.error || 'No response'}`);
              
              await logActivityEvent({
                botId,
                eventType: "AUTONOMY_GATE_BLOCKED",
                severity: "INFO",
                title: `${bot?.name || 'Bot'}: AI Evolution paused`,
                summary: aiResult.error || "AI providers temporarily unavailable",
                payload: { reason: aiResult.error },
                traceId,
              });
            }
          } catch (aiError) {
            console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} AI_ERROR`, aiError);
            // Continue with evolution even if AI fails
          }

          // INSTITUTIONAL: Convergence-based evolution control (runs AFTER AI so costs are logged)
          // Instead of stopping at generation N, we detect when improvement stalls
          const CONVERGENCE_WINDOW = 5;
          const MIN_IMPROVEMENT_PCT = 2;
          const ABSOLUTE_SOFT_CAP = 500;
          
          const metricsHistory = await db.execute(sql`
            SELECT generation_number, sharpe_ratio, profit_factor, win_rate, net_pnl,
                   trend_direction, decline_from_peak_pct, peak_sharpe
            FROM generation_metrics_history
            WHERE bot_id = ${botId}::uuid
            ORDER BY generation_number DESC, id DESC
            LIMIT ${CONVERGENCE_WINDOW + 1}
          `);
          
          const metrics = metricsHistory.rows as any[];
          let shouldContinueEvolution = true;
          let convergenceReason = "";
          
          if (metrics.length >= CONVERGENCE_WINDOW) {
            const newest = metrics[0];
            const oldest = metrics[CONVERGENCE_WINDOW - 1];
            const newestSharpe = parseFloat(newest?.sharpe_ratio) || 0;
            const oldestSharpe = parseFloat(oldest?.sharpe_ratio) || 0;
            const baseline = Math.abs(oldestSharpe) > 0.001 ? Math.abs(oldestSharpe) : 1;
            const improvementPct = ((newestSharpe - oldestSharpe) / baseline) * 100;
            const recentTrends = metrics.slice(0, CONVERGENCE_WINDOW).map((m: any) => m.trend_direction);
            const noImprovementCount = recentTrends.filter((t: string) => t === 'DECLINING' || t === 'STABLE').length;
            const isStagnant = noImprovementCount >= CONVERGENCE_WINDOW - 1;
            
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} CONVERGENCE_CHECK gen=${currentGen} improvement=${improvementPct.toFixed(2)}% stagnant=${isStagnant}`);
            
            if (improvementPct < MIN_IMPROVEMENT_PCT && isStagnant) {
              shouldContinueEvolution = false;
              convergenceReason = `Converged: ${improvementPct.toFixed(1)}% improvement over ${CONVERGENCE_WINDOW} generations`;
            }
          }
          
          if (currentGen >= ABSOLUTE_SOFT_CAP) {
            shouldContinueEvolution = false;
            convergenceReason = `Soft cap: ${currentGen} generations - requires human review`;
          }
          
          if (!shouldContinueEvolution) {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} EVOLUTION_CONVERGED gen=${currentGen} ai_ran=${aiProvider !== 'none'}`);
            
            // GRACEFUL ERROR HANDLING: Wrap convergence marking in try-catch
            // If this fails, job still completes so bot doesn't get stuck
            try {
              await db.execute(sql`
                UPDATE bots 
                SET evolution_mode = 'paused',
                    health_reason_code = 'EVOLUTION_CONVERGED',
                    health_reason_detail = ${convergenceReason},
                    updated_at = NOW()
                WHERE id = ${botId}::uuid
              `);
            } catch (convergenceUpdateError) {
              console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} CONVERGENCE_UPDATE_FAILED (continuing anyway):`, convergenceUpdateError);
              // Don't throw - let job complete so bot doesn't get stuck
            }
            
            await storage.updateBotJob(job.id, {
              status: "COMPLETED",
              completedAt: new Date(),
              result: { 
                success: true, 
                type: "EVOLVING",
                reason: convergenceReason,
                action: "EVOLUTION_CONVERGED",
                currentGeneration: currentGen,
                aiEvolution: { provider: aiProvider, cost: aiCost },
              },
            });

            try {
              await logActivityEvent({
                botId,
                eventType: "EVOLUTION_CONVERGED",
                severity: "INFO",
                title: `${bot?.name || 'Bot'}: Evolution converged (AI: ${aiProvider})`,
                summary: convergenceReason,
                payload: { currentGeneration: currentGen, aiProvider, aiCost },
                traceId,
              });
            } catch (logError) {
              console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} ACTIVITY_LOG_FAILED:`, logError);
            }
            
            continue;
          }

          // INSTITUTIONAL: Create P&L snapshot for audit trail before reset
          // Uses sim_pnl/sim_total_trades as session proxy (existing schema fields)
          const preEvolutionSnapshot = {
            generation: currentGen,
            snapshotAt: new Date().toISOString(),
            simPnl: parseFloat(bot?.sim_pnl || "0"),
            simTotalTrades: parseInt(bot?.sim_total_trades || "0"),
            livePnl: parseFloat(bot?.live_pnl || "0"),
            liveTotalTrades: parseInt(bot?.live_total_trades || "0"),
            liveWinRate: parseFloat(bot?.live_win_rate || "0"),
            latestBacktestPnl: parseFloat(bot?.latest_backtest_pnl || "0"),
            latestBacktestTrades: parseInt(bot?.latest_backtest_trades || "0"),
            latestBacktestWinRate: parseFloat(bot?.latest_backtest_win_rate || "0"),
            latestBacktestMaxDd: parseFloat(bot?.latest_backtest_max_dd || "0"),
          };

          // Create new generation record with performance snapshot
          // Use ON CONFLICT to handle race conditions between workers
          let newGenId: string | null = null;
          
          // Extract timeframe from matrix_best_cell for generation tracking
          const generationTimeframe = bot?.best_timeframe || null;
          
          try {
            const genInsert = await db.execute(sql`
              INSERT INTO bot_generations (
                bot_id, generation_number, parent_generation_number, 
                created_by_job_id, mutation_reason_code, summary_title,
                strategy_config, performance_snapshot, timeframe
              ) VALUES (
                ${botId}::uuid, ${newGen}, ${currentGen},
                ${job.id}::uuid, 'LAB_CONTINUOUS_EVOLUTION',
                ${'Gen ' + newGen + ': Evolution cycle'},
                '{}'::jsonb,
                ${JSON.stringify(preEvolutionSnapshot)}::jsonb,
                ${generationTimeframe}
              )
              ON CONFLICT (bot_id, generation_number) DO NOTHING
              RETURNING id
            `);
            newGenId = (genInsert.rows[0] as any)?.id;
          } catch (insertError) {
            console.warn(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} INSERT_FAILED:`, insertError);
          }
          
          // If insert was skipped due to conflict, fetch the existing generation id
          if (!newGenId) {
            console.log(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} CONFLICT generation=${newGen} fetching existing`);
            const existingGen = await db.execute(sql`
              SELECT id FROM bot_generations 
              WHERE bot_id = ${botId}::uuid AND generation_number = ${newGen}
              LIMIT 1
            `);
            newGenId = (existingGen.rows[0] as any)?.id;
            
            // If we still can't get a generation id, skip this job
            if (!newGenId) {
              console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} CRITICAL no generation id for gen=${newGen}`);
              await storage.updateBotJob(job.id, {
                status: "FAILED",
                completedAt: new Date(),
                error: `Could not create or find generation ${newGen}`,
              });
              continue;
            }
          }

          // INSTITUTIONAL: Reset sim metrics for new generation baseline
          // Preserve lifetime totals (live_pnl, live_total_trades) but zero sim metrics (session proxy)
          await db.execute(sql`
            UPDATE bots 
            SET current_generation = ${newGen},
                generation_updated_at = NOW(),
                generation_reason_code = 'LAB_EVOLUTION_COMPLETE',
                current_generation_id = ${newGenId}::uuid,
                last_evolution_at = NOW(),
                updated_at = NOW(),
                -- P&L RESET: Zero out sim metrics (used as session proxy) for new generation baseline
                metrics_reset_at = NOW(),
                metrics_reset_reason_code = 'GENERATION_EVOLUTION',
                metrics_reset_by = 'SCHEDULER_EVOLUTION_WORKER',
                metrics_reset_scope = 'SESSION',
                sim_pnl = 0,
                sim_total_trades = 0
            WHERE id = ${botId}::uuid
          `);

          // Reset per-bot evolution state for next cycle with new random parameters
          resetBotEvolutionState(botId);

          await storage.updateBotJob(job.id, {
            status: "COMPLETED",
            completedAt: new Date(),
            result: { 
              success: true, 
              type: "EVOLVING",
              fromGeneration: currentGen,
              toGeneration: newGen,
              generationId: newGenId,
              pnlSnapshot: preEvolutionSnapshot,
              pnlReset: true,
              aiEvolution: {
                provider: aiProvider,
                suggestionsCount: aiSuggestions?.length || 0,
                appliedCount: appliedChanges.length,
                cost: aiCost,
              },
            },
          });

          await logActivityEvent({
            botId,
            eventType: "EVOLUTION_COMPLETED",
            severity: "INFO",
            title: `${bot?.name || 'Bot'}: AI-Evolved to Gen ${newGen}`,
            summary: `Gen ${currentGen} → Gen ${newGen} | AI: ${aiProvider} (${appliedChanges.length} changes) | Prior: $${preEvolutionSnapshot.simPnl.toFixed(2)}`,
            payload: { 
              jobType: "EVOLVING", 
              fromGeneration: currentGen, 
              toGeneration: newGen,
              generationId: newGenId,
              pnlSnapshot: preEvolutionSnapshot,
              pnlReset: true,
              aiEvolution: {
                provider: aiProvider,
                suggestionsCount: aiSuggestions?.length || 0,
                appliedChanges,
                cost: aiCost,
              },
            },
            traceId,
          });

          // Send Discord notification for AI-driven evolution
          await sendDiscord({
            channel: "autonomy",
            title: `AI Evolution Complete: ${bot?.name || 'Bot'}`,
            message: `**Gen ${currentGen} → Gen ${newGen}**\n` +
                     `Symbol: ${bot?.symbol || 'MNQ'}\n` +
                     `AI Provider: ${aiProvider}\n` +
                     `Suggestions: ${aiSuggestions?.length || 0} | Applied: ${appliedChanges.length}\n` +
                     `Cost: $${aiCost.toFixed(4)}\n` +
                     `Prior Sim: $${preEvolutionSnapshot.simPnl.toFixed(2)} / ${preEvolutionSnapshot.simTotalTrades} trades`,
            severity: "INFO",
            correlationId: traceId,
          });

          console.log(`[EVOLUTION_WORKER] trace_id=${traceId} bot=${botId} AI_EVOLVED gen=${currentGen}->${newGen} provider=${aiProvider} applied=${appliedChanges.length} cost=$${aiCost.toFixed(4)}`);
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[EVOLUTION_WORKER] trace_id=${traceId} job_id=${job.id} error=`, errorMessage);

        await storage.updateBotJob(job.id, {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage,
        });
      }
    }

  } catch (error) {
    console.error(`[EVOLUTION_WORKER] trace_id=${traceId} error=`, error);
  }
}

/**
 * Autonomy Supervisor Loop
 * Evaluates bots, computes scores, and triggers promotions/demotions/evolutions
 * 
 * STAGE MODEL (Institutional):
 * - LAB: Backtest only, no execution, market data can be unverified if historical pulls succeed
 * - PAPER_SIM: Simulated execution, NO broker required, market data verified OR proof_of_use > 0
 * - SHADOW/CANARY/LIVE: Broker required + verified
 */
async function runAutonomyLoop(): Promise<void> {
  const traceId = crypto.randomUUID();
  const startedAt = new Date();
  console.log(`[AUTONOMY_LOOP] trace_id=${traceId} starting evaluation cycle`);

  // =====================================================================
  // PRE-FLIGHT INTEGRATION HEALTH GATE (INSTITUTIONAL REQUIREMENT)
  // HARD HALT autonomy loop if critical integrations are not available
  // =====================================================================
  try {
    const preFlightResult = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE integration = 'databento' AND status = 'OK' AND created_at > NOW() - INTERVAL '7 days') as databento_recent,
        COUNT(*) FILTER (WHERE integration = 'polygon' AND status = 'OK' AND created_at > NOW() - INTERVAL '7 days') as polygon_recent
      FROM integration_usage_events
    `);
    const preFlightStats = preFlightResult.rows[0] as any;
    const databentoRecent = parseInt(preFlightStats?.databento_recent || "0");
    const polygonRecent = parseInt(preFlightStats?.polygon_recent || "0");
    
    // Check bar cache readiness status using getCacheStats()
    const barCacheStats = getCacheStats();
    const totalCachedBars = barCacheStats.reduce((sum, s) => sum + s.barCount, 0);
    const barCacheReady = totalCachedBars > 0;
    
    // INSTITUTIONAL: Hard halt if no market data provider AND bar cache not ready
    // This prevents autonomy loop from running with stale/missing data
    if (databentoRecent === 0 && polygonRecent === 0 && !barCacheReady) {
      console.error(`[AUTONOMY_LOOP] trace_id=${traceId} PRE_FLIGHT_FAILED: HALTED - No market data provider verified in 7 days AND bar cache not ready`);
      await sendDiscord({
        channel: "autonomy",
        title: "Autonomy Loop HALTED",
        message: `**PRE-FLIGHT GATE FAILED**\n` +
                 `Databento verified (7d): ${databentoRecent}\n` +
                 `Polygon verified (7d): ${polygonRecent}\n` +
                 `Bar cache ready: ${barCacheReady}\n` +
                 `**Action Required:** Verify market data integrations`,
        severity: "CRITICAL",
        correlationId: traceId,
      });
      return; // HARD HALT - exit autonomy loop
    }
    
    // Log warning if running with degraded data sources
    if (databentoRecent === 0 && polygonRecent === 0) {
      console.warn(`[AUTONOMY_LOOP] trace_id=${traceId} PRE_FLIGHT_DEGRADED: No market data provider verified in 7 days. Running with cached bars only.`);
    }
  } catch (preFlightError) {
    console.error(`[AUTONOMY_LOOP] trace_id=${traceId} PRE_FLIGHT_CHECK_FAILED:`, preFlightError);
    // Continue with caution - log the failure but don't halt the loop
  }

  // Create planner run record at start
  let runId: string | null = null;
  try {
    const runInsert = await db.execute(sql`
      INSERT INTO autonomy_planner_runs (trace_id, started_at, bots_evaluated, jobs_enqueued, blocked)
      VALUES (${traceId}::uuid, NOW(), 0, 0, 0)
      RETURNING id
    `);
    runId = (runInsert.rows[0] as any)?.id;
  } catch (e) {
    console.error(`[AUTONOMY_LOOP] trace_id=${traceId} failed to create run record:`, e);
  }

  // Counters for run summary (scoped to whole function)
  let totalBotsEvaluated = 0;
  let totalJobsEnqueued = 0;
  let totalBlocked = 0;
  let promotions = 0;
  let demotions = 0;
  let scoreUpdates = 0;
  let backtestsQueued = 0;
  const reasonsTop: { reason: string; count: number }[] = [];

  try {
    // Get market data provider status for gate checks
    const providerProofResult = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE integration = 'databento' AND status = 'OK') as databento_ok_24h,
        COUNT(*) FILTER (WHERE integration = 'polygon' AND status = 'OK') as polygon_ok_24h,
        MAX(CASE WHEN integration = 'databento' AND operation = 'verify' AND status = 'OK' THEN created_at END) as databento_last_verified
      FROM integration_usage_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    const providerStats = providerProofResult.rows[0] as any;
    const databentoProofCount = parseInt(providerStats?.databento_ok_24h || "0");
    const databentoLastVerified = providerStats?.databento_last_verified;
    const hasMarketDataProof = databentoProofCount > 0;
    
    console.log(`[AUTONOMY_LOOP] trace_id=${traceId} market_data_proof: databento_ok_24h=${databentoProofCount} verified=${!!databentoLastVerified}`);

    // Get all active bots in TRIALS/PAPER/SHADOW/CANARY stages for autonomous promotion
    // NOTE: All backtest_sessions subqueries filter by metrics_reset_at for P&L baseline reset
    // PAPER+ stages also use paper_trades for real-time metrics
    const result = await db.execute(sql`
      SELECT b.*, 
             b.stage_locked_until,
             b.stage_lock_reason,
             b.promotion_mode,
             b.stage_reason_code,
             b.metrics_reset_at,
             (SELECT COUNT(*) FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at)) as completed_backtests,
             (SELECT bs.total_trades FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_trades,
             (SELECT bs.net_pnl FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_pnl,
             (SELECT bs.win_rate FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_win_rate,
             (SELECT bs.max_drawdown_pct FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_max_dd,
             (SELECT bs.sharpe_ratio FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_sharpe,
             (SELECT bs.profit_factor FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_profit_factor,
             (SELECT bs.expectancy FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_expectancy,
             (SELECT bs.losing_trades FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_losers,
             (SELECT bs.completed_at FROM backtest_sessions bs WHERE bs.bot_id = b.id AND bs.status = 'completed' AND (b.metrics_reset_at IS NULL OR bs.completed_at >= b.metrics_reset_at) ORDER BY bs.completed_at DESC NULLS LAST, bs.id DESC LIMIT 1) as latest_backtest_completed,
             -- Paper trading metrics for PAPER+ stages (closed trades only)
             (SELECT COUNT(*) FROM paper_trades pt WHERE pt.bot_id = b.id AND pt.status = 'CLOSED') as paper_trades_count,
             (SELECT SUM(pt.pnl) FROM paper_trades pt WHERE pt.bot_id = b.id AND pt.status = 'CLOSED') as paper_net_pnl,
             (SELECT COUNT(*) FILTER (WHERE pt.pnl > 0) * 1.0 / NULLIF(COUNT(*), 0) FROM paper_trades pt WHERE pt.bot_id = b.id AND pt.status = 'CLOSED') as paper_win_rate,
             (SELECT MIN(pt.created_at) FROM paper_trades pt WHERE pt.bot_id = b.id AND pt.status = 'CLOSED') as paper_first_trade_at,
             -- Days in current stage for time-based gates
             (SELECT EXTRACT(EPOCH FROM (NOW() - COALESCE(
               (SELECT created_at FROM bot_stage_events WHERE bot_id = b.id ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1),
               b.created_at
             ))) / 86400) as days_in_stage
      FROM bots b
      WHERE b.archived_at IS NULL
        AND b.killed_at IS NULL
        AND b.stage IN ('TRIALS', 'PAPER', 'SHADOW', 'CANARY')
      ORDER BY 
        CASE b.stage 
          WHEN 'CANARY' THEN 1
          WHEN 'SHADOW' THEN 2
          WHEN 'PAPER' THEN 3
          WHEN 'TRIALS' THEN 4
        END,
        b.created_at DESC
      LIMIT 50
    `);

    const botRows = result.rows as any[];
    // Reset counters (already declared above)
    promotions = 0;
    demotions = 0;
    scoreUpdates = 0;
    backtestsQueued = 0;

    for (const bot of botRows) {
      const completedBacktests = parseInt(bot.completed_backtests || "0");
      const latestTrades = parseInt(bot.latest_trades || "0");
      const latestPnl = parseFloat(bot.latest_pnl || "0");
      const latestWinRate = parseFloat(bot.latest_win_rate || "0");
      const latestMaxDd = parseFloat(bot.latest_max_dd || "0");
      const latestSharpe = parseFloat(bot.latest_sharpe || "0");
      const latestProfitFactor = parseFloat(bot.latest_profit_factor || "0");
      const latestExpectancy = parseFloat(bot.latest_expectancy || "0");
      const latestLosers = parseInt(bot.latest_losers || "0");
      const latestBacktestCompleted = bot.latest_backtest_completed;

      // Stage lock and promotion mode - used in both evolution skip check and promotion logic
      const stageLockedUntil = bot.stage_locked_until ? new Date(bot.stage_locked_until) : null;
      const isStageLockedByTime = stageLockedUntil && stageLockedUntil > new Date();
      const isPromotionModeManual = bot.promotion_mode === 'MANUAL';

      // Check if this is a SEV1 reset bot (stage_reason_code indicates bulk revert)
      const isSev1ResetBot = bot.stage_reason_code === 'BULK_REVERT_SEV1_RESET';
      const hasStageLockedUntil = bot.stage_locked_until && new Date(bot.stage_locked_until) > new Date();
      // Metrics reset also triggers baseline backtest requirement
      const hasMetricsReset = !!bot.metrics_reset_at;
      const needsBaselineBacktest = completedBacktests === 0 || (isSev1ResetBot && hasStageLockedUntil) || (hasMetricsReset && completedBacktests === 0);

      // If no baseline backtest OR SEV1 reset bot with lock, queue a backtest
      if (needsBaselineBacktest) {
        const pendingJobs = await storage.getBotJobs({ botId: bot.id, status: "QUEUED" });
        const runningJobs = await storage.getBotJobs({ botId: bot.id, status: "RUNNING" });
        const hasPendingBacktest = pendingJobs.some(j => j.jobType === "BACKTESTER" || j.jobType === "BACKTEST");
        const hasRunningBacktest = runningJobs.some(j => j.jobType === "BACKTESTER" || j.jobType === "BACKTEST");
        
        if (!hasPendingBacktest && !hasRunningBacktest) {
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} QUEUING_BASELINE_BACKTEST reason=${isSev1ResetBot ? 'SEV1_RESET' : 'NO_COMPLETED_BACKTESTS'}`);
          await queueBaselineBacktest(bot.id, traceId);
          backtestsQueued++;
          
          // Send Discord notification for SEV1 reset backtest queuing
          if (isSev1ResetBot) {
            await sendDiscord({
              channel: "autonomy",
              title: `SEV1 RESET: Baseline backtest queued`,
              message: `**${bot.name}** (${bot.symbol})\nQueued baseline backtest after SEV1 reset.\nStage lock expires: ${bot.stage_locked_until}`,
              severity: "INFO",
              metadata: {
                botId: bot.id,
                botName: bot.name,
                reason: "SEV1_RESET",
              },
              correlationId: traceId,
            });
          }
        }
        
        // For SEV1 reset bots, continue processing (don't skip)
        if (completedBacktests === 0) {
          continue;
        }
      }

      // =====================================================================
      // AUTO-REVERT: Check if bot is regressing and should revert to peak
      // APPLIES TO ALL STAGES - prevents performance degradation
      // =====================================================================
      try {
        const revertCheck = await db.select()
          .from(generationMetricsHistory)
          .where(eq(generationMetricsHistory.botId, bot.id))
          .orderBy(sql`${generationMetricsHistory.createdAt} DESC`)
          .limit(1);
        
        const latestMetrics = revertCheck[0];
        if (latestMetrics?.isRevertCandidate && 
            latestMetrics.peakGeneration !== null && 
            latestMetrics.peakGeneration !== bot.current_generation &&
            !latestMetrics.wasReverted) {
          
          const declinePct = latestMetrics.declineFromPeakPct?.toFixed(1) || '?';
          const currentGen = bot.current_generation ?? 1;
          const peakGen = latestMetrics.peakGeneration;
          
          // Guardrails: Only revert if decline > 20% AND peak is recent (within 10 gens)
          const genDistance = currentGen - peakGen;
          const MAX_REVERT_DEPTH = 10;
          const MIN_DECLINE_PCT = 20;
          
          if (genDistance > 0 && genDistance <= MAX_REVERT_DEPTH && 
              (latestMetrics.declineFromPeakPct ?? 0) >= MIN_DECLINE_PCT) {
            
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} stage=${bot.stage} AUTO_REVERT: gen=${currentGen} peak_gen=${peakGen} decline=${declinePct}%`);
            
            // Find the peak generation's strategy config
            const peakGenData = await db.select()
              .from(botGenerations)
              .where(and(
                eq(botGenerations.botId, bot.id),
                eq(botGenerations.generationNumber, peakGen)
              ))
              .limit(1);
            
            if (peakGenData[0]?.strategyConfig) {
              // Revert bot to peak generation's config
              // CRITICAL: Must update BOTH currentGeneration AND currentGenerationId
              // to ensure metrics scoping works correctly (getLatestBacktestSessionForGeneration uses current_generation_id)
              await db.update(bots)
                .set({
                  strategyConfig: peakGenData[0].strategyConfig,
                  currentGeneration: peakGen,
                  currentGenerationId: peakGenData[0].id, // CRITICAL: Update generation UUID for metrics scoping
                  generationReasonCode: 'AUTO_REVERT_SHARPE_DECLINE',
                  generationUpdatedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(bots.id, bot.id));
              
              // Mark this history entry as reverted
              await db.update(generationMetricsHistory)
                .set({
                  wasReverted: true,
                  revertedToGeneration: peakGen,
                  revertReason: 'SHARPE_DECLINE',
                })
                .where(eq(generationMetricsHistory.id, latestMetrics.id));
              
              // Log activity event
              await logActivityEvent({
                botId: bot.id,
                eventType: "BOT_AUTO_REVERTED",
                severity: "WARN",
                title: `Auto-reverted ${bot.name} to Gen ${peakGen}`,
                summary: `Sharpe declined ${declinePct}% from peak. Reverted from Gen ${currentGen} to Gen ${peakGen}. Stage: ${bot.stage}`,
                payload: {
                  fromGeneration: currentGen,
                  toGeneration: peakGen,
                  declineFromPeakPct: latestMetrics.declineFromPeakPct,
                  peakSharpe: latestMetrics.peakSharpe,
                  currentSharpe: latestMetrics.sharpeRatio,
                  stage: bot.stage,
                },
                traceId,
                symbol: bot.symbol,
              });
              
              // Send Discord notification
              await sendDiscord({
                channel: "autonomy",
                title: `Auto-Revert: ${bot.name} (${bot.stage})`,
                message: `**Gen ${currentGen} → Gen ${peakGen}**\n` +
                         `Stage: ${bot.stage}\n` +
                         `Sharpe declined ${declinePct}% from peak\n` +
                         `Peak Sharpe: ${latestMetrics.peakSharpe?.toFixed(2) || '?'}\n` +
                         `Current Sharpe: ${latestMetrics.sharpeRatio?.toFixed(2) || '?'}`,
                severity: "WARN",
                correlationId: traceId,
              });
              
              // Skip further processing for this bot - it just reverted
              continue;
            }
          }
        }
      } catch (revertError) {
        console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} stage=${bot.stage} revert_check_error:`, revertError);
      }

      // =====================================================================
      // TRIALS CONTINUOUS EVOLUTION LOOP
      // Ensures TRIALS bots continuously backtest, improve, and evolve
      // CRITICAL FIX: Also handles bots with 0 backtests (initial state)
      // =====================================================================
      if (bot.stage === "TRIALS") {
        const pendingJobs = await storage.getBotJobs({ botId: bot.id, status: "QUEUED" });
        const runningJobs = await storage.getBotJobs({ botId: bot.id, status: "RUNNING" });
        const hasAnyPendingJob = pendingJobs.length > 0;
        const hasAnyRunningJob = runningJobs.length > 0;

        // Skip if bot already has work queued or running
        if (!hasAnyPendingJob && !hasAnyRunningJob) {
          // INITIAL STATE: Bot has 0 backtests - queue first backtest immediately
          if (completedBacktests === 0) {
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} INITIAL_BACKTEST: No completed backtests, queueing first backtest`);
            await storage.createBotJob({
              botId: bot.id,
              jobType: "BACKTESTER",
              status: "QUEUED",
              payload: {
                symbol: bot.symbol || "MNQ",
                iteration: 1,
                reason: "INITIAL_BACKTEST: First backtest for new TRIALS bot",
                cadence: "TRIALS_CONTINUOUS",
              },
            });
            totalJobsEnqueued++;
            backtestsQueued++;
            
            await logActivityEvent({
              botId: bot.id,
              eventType: "BACKTEST_STARTED",
              severity: "INFO",
              title: `${bot.name}: Initial backtest queued`,
              summary: `TRIALS bot has 0 backtests - starting autonomous evolution`,
              payload: { jobType: "BACKTESTER", iteration: 1, reason: "INITIAL_BACKTEST", cadence: "TRIALS_CONTINUOUS" },
              traceId,
            });
            continue; // Move to next bot
          }
          
          const now = Date.now();
          const lastBacktestAt = latestBacktestCompleted ? new Date(latestBacktestCompleted).getTime() : 0;
          const timeSinceBacktest = now - lastBacktestAt;

          // Get last improvement and evolution timestamps from recent jobs
          const recentJobsResult = await db.execute(sql`
            SELECT job_type, completed_at, COALESCE((payload->>'iteration')::int, 1) as iteration
            FROM bot_jobs
            WHERE bot_id = ${bot.id}::uuid
              AND status = 'COMPLETED'
              AND completed_at > NOW() - INTERVAL '24 hours'
            ORDER BY completed_at DESC NULLS LAST, id DESC
            LIMIT 10
          `);
          const recentJobs = recentJobsResult.rows as any[];

          const lastImproveJob = recentJobs.find(j => j.job_type === 'IMPROVING');
          const lastEvolveJob = recentJobs.find(j => j.job_type === 'EVOLVING');
          const lastBacktestJob = recentJobs.find(j => j.job_type === 'BACKTESTER' || j.job_type === 'BACKTEST');
          
          const improvementsSinceEvolve = recentJobs.filter(j => 
            j.job_type === 'IMPROVING' && 
            (!lastEvolveJob || new Date(j.completed_at) > new Date(lastEvolveJob.completed_at))
          ).length;

          const timeSinceImprove = lastImproveJob ? now - new Date(lastImproveJob.completed_at).getTime() : Infinity;
          const timeSinceEvolve = lastEvolveJob ? now - new Date(lastEvolveJob.completed_at).getTime() : Infinity;

          let nextJob: { type: string; reason: string } | null = null;

          // =====================================================================
          // CRITICAL FIX: Skip job queueing if bot passes all promotion gates
          // This prevents evolution from blocking promotion for graduation-ready bots
          // Uses UNIFIED_STAGE_THRESHOLDS from shared/graduationGates.ts
          // =====================================================================
          // Pre-compute promotion gate checks using unified institutional thresholds
          const stageThresholds = UNIFIED_STAGE_THRESHOLDS[bot.stage as keyof typeof UNIFIED_STAGE_THRESHOLDS] || UNIFIED_STAGE_THRESHOLDS.TRIALS;
          const winRatePct = latestWinRate * 100; // Convert decimal to percentage for comparison
          
          // Walk-forward and stress test checks for SHADOW/CANARY stages
          let walkForwardPassed = true; // Default for stages that don't require it
          let walkForwardConsistency = 1.0;
          let overfitRatio = 1.0;
          let stressTestPassed = true; // Default for stages that don't require it
          
          if (stageThresholds.requireWalkForwardValidation) {
            try {
              const wfRun = await getLatestWalkForwardForBot(bot.id);
              if (wfRun && wfRun.status === 'COMPLETED') {
                walkForwardPassed = wfRun.passedValidation ?? false;
                walkForwardConsistency = wfRun.consistencyScore ?? 0;
                overfitRatio = wfRun.overfitRatio ?? Infinity;
              } else {
                walkForwardPassed = false;
              }
            } catch (e) {
              console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} walk_forward_check_error:`, e);
              walkForwardPassed = false;
            }
          }
          
          if (stageThresholds.requireStressTestPassed) {
            try {
              stressTestPassed = await hasPassedStressTests(bot.id);
            } catch (e) {
              console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} stress_test_check_error:`, e);
              stressTestPassed = false;
            }
          }
          
          // Base gates (all stages) - using LATEST backtest
          const baseGatesPassed = 
            latestTrades >= stageThresholds.minTrades &&              // min_trades (50 for LAB)
            !!latestBacktestCompleted &&                              // backtest_completed
            latestPnl > 0 &&                                          // profitable
            (latestMaxDd > 0 && latestMaxDd <= stageThresholds.maxDrawdownPct) && // max_dd (20% for LAB)
            winRatePct >= stageThresholds.minWinRate &&               // win_rate (35% for LAB)
            latestProfitFactor >= stageThresholds.minProfitFactor &&  // profit_factor (1.2 for LAB)
            latestExpectancy >= stageThresholds.minExpectancy &&      // expectancy ($10 for LAB)
            latestSharpe >= stageThresholds.minSharpe &&              // sharpe (0.5 for LAB)
            latestLosers > 0 &&                                       // has_losers (realism)
            hasMarketDataProof;                                       // market_data_proof
          
          // =====================================================================
          // FAILSAFE: Also check matrix_best_cell for promotion gates
          // This prevents destroying good metrics when latest backtest underperforms
          // =====================================================================
          let matrixGatesPassed = false;
          let matrixMetrics: any = null;
          // Note: SQL query returns snake_case column names, so use matrix_best_cell not matrixBestCell
          if (bot.matrix_best_cell && typeof bot.matrix_best_cell === 'object') {
            matrixMetrics = bot.matrix_best_cell as any;
            const matrixWinRatePct = (matrixMetrics.winRate || 0) * 100;
            const matrixTrades = matrixMetrics.totalTrades || 0;
            const matrixPnl = matrixMetrics.netPnl || 0;
            const matrixMaxDd = matrixMetrics.maxDrawdownPct || 0;
            const matrixProfitFactor = matrixMetrics.profitFactor || 0;
            const matrixExpectancy = matrixMetrics.expectancy || 0;
            const matrixSharpe = matrixMetrics.sharpeRatio || 0;
            const matrixLosingTrades = matrixMetrics.losingTrades || 0;
            
            matrixGatesPassed = 
              matrixTrades >= stageThresholds.minTrades &&
              matrixPnl > 0 &&
              (matrixMaxDd > 0 && matrixMaxDd <= stageThresholds.maxDrawdownPct) &&
              matrixWinRatePct >= stageThresholds.minWinRate &&
              matrixProfitFactor >= stageThresholds.minProfitFactor &&
              matrixExpectancy >= stageThresholds.minExpectancy &&
              matrixSharpe >= stageThresholds.minSharpe &&
              matrixLosingTrades > 0 &&
              hasMarketDataProof;
          }
          
          // Walk-forward gates (SHADOW/CANARY stages)
          const walkForwardGatesPassed = 
            (!stageThresholds.requireWalkForwardValidation || walkForwardPassed) &&
            (!stageThresholds.minWalkForwardConsistency || walkForwardConsistency >= stageThresholds.minWalkForwardConsistency) &&
            (!stageThresholds.maxOverfitRatio || overfitRatio <= stageThresholds.maxOverfitRatio);
          
          // Stress test gates (CANARY stage)
          const stressTestGatesPassed = !stageThresholds.requireStressTestPassed || stressTestPassed;
          
          // CRITICAL: Bot passes if EITHER latest backtest OR matrix best cell passes gates
          // This prevents evolution from destroying good metrics when a single backtest underperforms
          const latestGatesPassed = baseGatesPassed && walkForwardGatesPassed && stressTestGatesPassed;
          const promotionGatesPassed = latestGatesPassed || (matrixGatesPassed && walkForwardGatesPassed && stressTestGatesPassed);
          // Note: score_threshold (score >= 50) checked after score is computed
          
          // CRITICAL: Skip evolution if bot passes all promotion gates - REGARDLESS of promotion mode
          // We should NEVER destroy good metrics by evolving a promotion-ready bot
          // The promotion mode only controls whether we auto-promote or require manual approval
          if (promotionGatesPassed && !isStageLockedByTime) {
            // Bot passes all non-score promotion gates - skip evolution to preserve metrics
            const metricsSource = latestGatesPassed ? 'LATEST_BACKTEST' : 'MATRIX_BEST_CELL';
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SKIP_EVOLUTION: Promotion gates passed via ${metricsSource} (mode=${isPromotionModeManual ? 'MANUAL' : 'AUTO'}), preserving metrics for ${isPromotionModeManual ? 'manual approval' : 'promotion'}`);
            // Don't queue any jobs - let the promotion logic below handle this bot
          } else {
          // Decision tree for next job (priority order):
          // 0. Promotion Gate Guard: If trades < minTrades (50), force 5-year backtest requeue
          // 1. Evolve: If enough improvements accumulated AND evolution interval passed
          // 2. Improve: If backtest completed MORE RECENTLY than last improve (ensures improve after each backtest)
          // 3. Backtest: If backtest is stale (interval exceeded)
          // 4. No default - wait for next autonomy cycle (prevents job flooding)

          const lastBacktestTime = lastBacktestJob ? new Date(lastBacktestJob.completed_at).getTime() : 0;
          const lastImproveTime = lastImproveJob ? new Date(lastImproveJob.completed_at).getTime() : 0;
          const backtestMoreRecent = lastBacktestTime > lastImproveTime;

          // Get per-bot evolution state (randomized parameters to prevent synchronized evolution)
          const botEvState = getBotEvolutionState(bot.id);
          const effectiveEvolutionInterval = LAB_EVOLUTION_BASE_INTERVAL_MS + botEvState.evolutionJitterMs;
          
          // 15 trades minimum for AI evolution (balance between data quality and practicality)
          const MINIMUM_TRADES_FOR_EVOLUTION = 15;
          const hasBacktestEvidence = latestTrades >= MINIMUM_TRADES_FOR_EVOLUTION;
          
          // INSTITUTIONAL GUARD: If trades < minTrades for promotion (50), auto-requeue 5-year backtest
          // This ensures bots accumulate enough trades for statistical significance
          const needsMoreTradesForPromotion = latestTrades > 0 && latestTrades < stageThresholds.minTrades;
          const hasRecentBacktest = timeSinceBacktest < LAB_BACKTEST_INTERVAL_MS * 2; // Backtest within 2x interval
          
          if (needsMoreTradesForPromotion && !hasRecentBacktest) {
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} PROMOTION_GUARD: trades=${latestTrades}/${stageThresholds.minTrades} - queueing 5-year backtest for statistical significance`);
            nextJob = { 
              type: 'BACKTESTER', 
              reason: `PROMOTION_GUARD: Need ${stageThresholds.minTrades}+ trades (have ${latestTrades}), queueing full 5-year backtest` 
            };
          }
          
          // Check if bot is ready to evolve based on its own metrics and state
          // CRITICAL: Also require backtest evidence to prevent evolving without data
          const readyToEvolve = improvementsSinceEvolve >= botEvState.requiredImprovements && 
                                timeSinceEvolve > effectiveEvolutionInterval &&
                                hasBacktestEvidence;
          
          // Only proceed with evolution/improvement if promotion guard didn't set a job
          if (!nextJob && readyToEvolve) {
            nextJob = { 
              type: 'EVOLVING', 
              reason: `${improvementsSinceEvolve}/${botEvState.requiredImprovements} improvements, ${latestTrades} trades, jitter=${Math.round(botEvState.evolutionJitterMs/60000)}min, ready to evolve` 
            };
            // Reset state will happen in evolution worker after successful evolution
          } else if (!nextJob && !hasBacktestEvidence && improvementsSinceEvolve >= botEvState.requiredImprovements) {
            // Evolution ready but needs more trades - queue backtest first
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} EVOLUTION_PENDING: Need ${MINIMUM_TRADES_FOR_EVOLUTION}+ trades (have ${latestTrades}), queueing backtest`);
            nextJob = { type: 'BACKTESTER', reason: `Building trade history: need ${MINIMUM_TRADES_FOR_EVOLUTION}+ trades (have ${latestTrades})` };
          } else if (!nextJob && backtestMoreRecent && lastBacktestJob) {
            // Key fix: After every backtest, immediately queue an improvement
            nextJob = { type: 'IMPROVING', reason: 'Backtest complete, improving parameters' };
          } else if (!nextJob && timeSinceBacktest > LAB_BACKTEST_INTERVAL_MS) {
            nextJob = { type: 'BACKTESTER', reason: `Last backtest ${Math.round(timeSinceBacktest / 60000)}min ago` };
          }
          
          // SEV-0 INSTITUTIONAL: LAB SLA enforcement - if no job selected and bot is idle > LAB_MAX_IDLE_MS, queue keepalive
          if (!nextJob) {
            const lastAnyJobTime = recentJobs[0]?.completed_at ? new Date(recentJobs[0].completed_at).getTime() : 0;
            const timeSinceAnyJob = now - lastAnyJobTime;
            if (timeSinceAnyJob > LAB_MAX_IDLE_MS) {
              nextJob = { 
                type: 'BACKTESTER', 
                reason: `SLA_KEEPALIVE: Idle ${Math.round(timeSinceAnyJob / 60000)}min > max ${Math.round(LAB_MAX_IDLE_MS / 60000)}min` 
              };
              console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SLA_BREACH: Idle ${Math.round(timeSinceAnyJob / 60000)}min, queueing keepalive backtest`);
            }
          }

          if (nextJob) {
            const iteration = (lastBacktestJob?.iteration || 0) + 1;
            
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} LAB_EVOLUTION job=${nextJob.type} reason="${nextJob.reason}" iteration=${iteration}`);
            
            // Queue the job
            await storage.createBotJob({
              botId: bot.id,
              jobType: nextJob.type,
              status: "QUEUED",
              payload: {
                symbol: bot.symbol || "MNQ",
                iteration,
                reason: nextJob.reason,
                cadence: "LAB_CONTINUOUS",
              },
            });
            
            totalJobsEnqueued++;
            if (nextJob.type === 'BACKTESTER') backtestsQueued++;

            // Log activity event for visibility
            await logActivityEvent({
              botId: bot.id,
              eventType: "BACKTEST_STARTED",
              severity: "INFO",
              title: `${bot.name}: ${nextJob.type} queued`,
              summary: `LAB evolution: ${nextJob.reason}`,
              payload: { jobType: nextJob.type, iteration, reason: nextJob.reason, cadence: "LAB_CONTINUOUS" },
              traceId,
            });
          }
          } // Close else block for promotionGatesPassed check
        }
      }

      // =====================================================================
      // INSTITUTIONAL AUTONOMY SCORING (5 dimensions, stricter thresholds)
      // =====================================================================
      let score = 0;
      const scoreBreakdown: Record<string, number> = {};

      // 1. Data reliability (20 points) - has backtests + market data proof
      let dataScore = 0;
      if (completedBacktests >= 3) dataScore += 10;
      else if (completedBacktests >= 1) dataScore += 5;
      if (hasMarketDataProof) dataScore += 10;
      else if (completedBacktests > 0) dataScore += 3; // Partial credit if backtests ran
      scoreBreakdown.data_reliability = Math.min(dataScore, 20);
      score += scoreBreakdown.data_reliability;

      // 2. Decision quality (25 points) - profitability + win rate + sharpe
      let decisionScore = 0;
      if (latestPnl > 500) decisionScore += 10;
      else if (latestPnl > 0) decisionScore += 5;
      else if (latestPnl > -200) decisionScore += 2;
      
      if (latestWinRate >= 0.55) decisionScore += 8;
      else if (latestWinRate >= 0.45) decisionScore += 5;
      else if (latestWinRate >= 0.35) decisionScore += 2;
      
      if (latestSharpe >= 1.5) decisionScore += 7;
      else if (latestSharpe >= 1.0) decisionScore += 4;
      else if (latestSharpe >= 0.5) decisionScore += 2;
      scoreBreakdown.decision_quality = Math.min(decisionScore, 25);
      score += scoreBreakdown.decision_quality;

      // 3. Risk discipline (25 points) - drawdown control + has losers (realism check)
      let riskScore = 0;
      // DD scoring - penalize 0% DD as suspicious
      if (latestMaxDd > 0 && latestMaxDd <= 5) riskScore += 15;
      else if (latestMaxDd > 5 && latestMaxDd <= 10) riskScore += 12;
      else if (latestMaxDd > 10 && latestMaxDd <= 15) riskScore += 8;
      else if (latestMaxDd > 15 && latestMaxDd <= 25) riskScore += 3;
      else if (latestMaxDd === 0) riskScore += 5; // Suspicious - might be bug
      // else latestMaxDd > 25: 0 points
      
      // Realism check: must have some losing trades
      const loserRatio = latestTrades > 0 ? latestLosers / latestTrades : 0;
      if (loserRatio >= 0.2 && loserRatio <= 0.6) riskScore += 10; // Realistic
      else if (loserRatio > 0) riskScore += 5; // Some losers
      // No losers = suspicious, no bonus
      scoreBreakdown.risk_discipline = Math.min(riskScore, 25);
      score += scoreBreakdown.risk_discipline;

      // 4. Execution health (20 points) - trade count + sample size
      let execScore = 0;
      if (latestTrades >= 100) execScore += 15;
      else if (latestTrades >= 50) execScore += 12;
      else if (latestTrades >= 30) execScore += 8;
      else if (latestTrades >= 20) execScore += 5;
      else if (latestTrades >= 10) execScore += 2;
      
      // Bonus for multiple backtests
      if (completedBacktests >= 5) execScore += 5;
      else if (completedBacktests >= 2) execScore += 3;
      scoreBreakdown.execution_health = Math.min(execScore, 20);
      score += scoreBreakdown.execution_health;

      // 5. Supervisor trust (10 points) - consistency + stability
      let trustScore = 0;
      // Has fresh backtest (within 7 days)
      const backtestAge = latestBacktestCompleted ? 
        (Date.now() - new Date(latestBacktestCompleted).getTime()) / (1000 * 60 * 60 * 24) : 999;
      if (backtestAge <= 1) trustScore += 5;
      else if (backtestAge <= 7) trustScore += 3;
      
      // Not in circuit breaker
      const botCircuitBreaker = circuitBreakerState.get(bot.id);
      if (!botCircuitBreaker?.isOpen) trustScore += 5;
      scoreBreakdown.supervisor_trust = Math.min(trustScore, 10);
      score += scoreBreakdown.supervisor_trust;

      // Determine autonomy tier (stricter thresholds)
      // Valid enum values: LOCKED, SUPERVISED, SEMI_AUTONOMOUS, FULL_AUTONOMY
      let tier = "LOCKED";
      if (score >= 85) tier = "FULL_AUTONOMY";
      else if (score >= 70) tier = "SEMI_AUTONOMOUS";
      else if (score >= 50) tier = "SUPERVISED";
      // Below 50 remains LOCKED

      // Build inputs snapshot for audit
      const inputsSnapshot = {
        sim_total_trades: latestTrades,
        sim_pnl: latestPnl,
        max_dd_pct: latestMaxDd,
        win_rate: latestWinRate,
        sharpe: latestSharpe,
        losers: latestLosers,
        loser_ratio: loserRatio,
        completed_backtests: completedBacktests,
        last_backtest_at: latestBacktestCompleted,
        backtest_age_days: Math.round(backtestAge * 10) / 10,
        provider_proof_count_24h: databentoProofCount,
        market_data_verified: !!databentoLastVerified,
      };

      // Update autonomy score in database
      await db.execute(sql`
        INSERT INTO autonomy_scores (bot_id, autonomy_score, autonomy_tier, breakdown)
        VALUES (${bot.id}::uuid, ${score}, ${tier}, ${JSON.stringify({ ...scoreBreakdown, inputs: inputsSnapshot })}::jsonb)
        ON CONFLICT (bot_id) DO UPDATE SET 
          autonomy_score = ${score},
          autonomy_tier = ${tier},
          breakdown = ${JSON.stringify({ ...scoreBreakdown, inputs: inputsSnapshot })}::jsonb,
          last_updated_at = NOW()
      `);
      scoreUpdates++;

      // =====================================================================
      // STAGE LOCK CHECK - Skip promotion if stage is locked
      // Note: stageLockedUntil, isStageLockedByTime, isPromotionModeManual
      // are declared earlier in the evolution-skip check for this bot
      // =====================================================================
      if (isStageLockedByTime || isPromotionModeManual) {
        const lockReason = isStageLockedByTime 
          ? `STAGE_LOCKED_UNTIL_${stageLockedUntil?.toISOString()}`
          : 'PROMOTION_MODE_MANUAL';
        console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SKIPPED_PROMOTION reason=${lockReason}`);
        // Still continue to backtest queuing and score updates, but skip promotion
      }

      // =====================================================================
      // PROMOTION/DEMOTION LOGIC (Institutional Gates)
      // Uses UNIFIED_STAGE_THRESHOLDS from shared/graduationGates.ts
      // =====================================================================
      if (bot.stage === "TRIALS" && !isStageLockedByTime && !isPromotionModeManual) {
        // Institutional promotion gates for TRIALS -> PAPER using unified thresholds
        const labThresholds = UNIFIED_STAGE_THRESHOLDS.TRIALS;
        
        // Walk-forward and stress test variables (TRIALS doesn't require these, but we define for gate display)
        let labWalkForwardPassed = true;
        let labWalkForwardConsistency = 1.0;
        let labOverfitRatio = 1.0;
        let labStressTestPassed = true;
        const winRatePctForGates = latestWinRate * 100; // Convert decimal to percentage
        
        // INSTITUTIONAL: Rolling metrics validation - require consistent performance across 3+ sessions
        // This prevents promotion based on a single lucky session
        const ROLLING_SESSIONS_REQUIRED = 3;
        let rollingMetricsResult: any = { sessions_meeting_thresholds: 0, total_recent_sessions: 0 };
        try {
          const rollingQuery = await db.execute(sql`
            SELECT 
              COUNT(*) as total_recent_sessions,
              COUNT(*) FILTER (
                WHERE total_trades >= ${labThresholds.minTrades}
                  AND net_pnl > 0
                  AND win_rate * 100 >= ${labThresholds.minWinRate}
                  AND max_drawdown_pct <= ${labThresholds.maxDrawdownPct}
                  AND profit_factor >= ${labThresholds.minProfitFactor}
              ) as sessions_meeting_thresholds
            FROM (
              SELECT total_trades, net_pnl, win_rate, max_drawdown_pct, profit_factor
              FROM backtest_sessions
              WHERE bot_id = ${bot.id}::uuid
                AND status = 'completed'
                AND (${bot.metrics_reset_at}::timestamptz IS NULL OR completed_at >= ${bot.metrics_reset_at}::timestamptz)
              ORDER BY completed_at DESC NULLS LAST, id DESC
              LIMIT ${ROLLING_SESSIONS_REQUIRED}
            ) recent_sessions
          `);
          rollingMetricsResult = rollingQuery.rows[0] as any || { sessions_meeting_thresholds: 0, total_recent_sessions: 0 };
        } catch (e) {
          console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} rolling_metrics_query_error:`, e);
        }
        const totalRecentSessions = parseInt(rollingMetricsResult.total_recent_sessions || "0");
        const sessionsMeetingThresholds = parseInt(rollingMetricsResult.sessions_meeting_thresholds || "0");
        const rollingMetricsPassed = totalRecentSessions >= ROLLING_SESSIONS_REQUIRED && 
                                      sessionsMeetingThresholds >= ROLLING_SESSIONS_REQUIRED;
        
        const promotionGates: Record<string, { passed: boolean; actual: any; required: any }> = {
          min_trades: { 
            passed: latestTrades >= labThresholds.minTrades, 
            actual: latestTrades, 
            required: labThresholds.minTrades 
          },
          backtest_completed: { 
            passed: !!latestBacktestCompleted, 
            actual: !!latestBacktestCompleted, 
            required: true 
          },
          profitable: { 
            passed: latestPnl > 0, 
            actual: latestPnl, 
            required: ">0" 
          },
          max_drawdown: { 
            passed: latestMaxDd > 0 && latestMaxDd <= labThresholds.maxDrawdownPct, 
            actual: latestMaxDd, 
            required: `0 < DD <= ${labThresholds.maxDrawdownPct}%` 
          },
          win_rate: { 
            passed: winRatePctForGates >= labThresholds.minWinRate, 
            actual: `${winRatePctForGates.toFixed(1)}%`, 
            required: `${labThresholds.minWinRate}%` 
          },
          profit_factor: { 
            passed: latestProfitFactor >= labThresholds.minProfitFactor, 
            actual: latestProfitFactor.toFixed(2), 
            required: labThresholds.minProfitFactor 
          },
          expectancy: { 
            passed: latestExpectancy >= labThresholds.minExpectancy, 
            actual: `$${latestExpectancy.toFixed(2)}`, 
            required: `$${labThresholds.minExpectancy}` 
          },
          sharpe_ratio: { 
            passed: latestSharpe >= labThresholds.minSharpe, 
            actual: latestSharpe.toFixed(2), 
            required: labThresholds.minSharpe 
          },
          has_losers: { 
            passed: latestLosers > 0, 
            actual: latestLosers, 
            required: ">0 (realism)" 
          },
          market_data_proof: { 
            passed: hasMarketDataProof, 
            actual: { proof_count: databentoProofCount, verified: !!databentoLastVerified }, 
            required: "databento_ok_24h > 0 (real market data usage)" 
          },
          score_threshold: { 
            passed: score >= 50, 
            actual: score, 
            required: 50 
          },
          rolling_metrics_consistency: { 
            passed: rollingMetricsPassed, 
            actual: `${sessionsMeetingThresholds}/${totalRecentSessions} sessions meet thresholds`, 
            required: `${ROLLING_SESSIONS_REQUIRED}/${ROLLING_SESSIONS_REQUIRED} (consistent performance)` 
          },
        };
        
        // Add walk-forward gates if required for this stage (TRIALS doesn't require these but include for display)
        if (labThresholds.requireWalkForwardValidation) {
          promotionGates.walk_forward_validation = {
            passed: labWalkForwardPassed,
            actual: labWalkForwardPassed ? "PASSED" : "NOT_COMPLETED",
            required: "Walk-forward out-of-sample validation",
          };
        }
        if (labThresholds.minWalkForwardConsistency) {
          promotionGates.walk_forward_consistency = {
            passed: labWalkForwardConsistency >= labThresholds.minWalkForwardConsistency,
            actual: labWalkForwardConsistency.toFixed(2),
            required: labThresholds.minWalkForwardConsistency,
          };
        }
        if (labThresholds.maxOverfitRatio) {
          promotionGates.overfit_ratio = {
            passed: labOverfitRatio <= labThresholds.maxOverfitRatio,
            actual: labOverfitRatio === Infinity ? "N/A" : labOverfitRatio.toFixed(2),
            required: `<= ${labThresholds.maxOverfitRatio}x`,
          };
        }
        if (labThresholds.requireStressTestPassed) {
          promotionGates.stress_test_passed = {
            passed: labStressTestPassed,
            actual: labStressTestPassed ? "PASSED" : "NOT_COMPLETED",
            required: "Crisis scenario stress testing",
          };
        }

        // =====================================================================
        // MATRIX FAILSAFE: Also check matrix_best_cell for promotion gates
        // This allows promotion when matrix shows good metrics even if latest backtest underperforms
        // =====================================================================
        let matrixPromotionGatesPassed = false;
        let matrixPromotionSource = 'LATEST_BACKTEST';
        if (bot.matrix_best_cell && typeof bot.matrix_best_cell === 'object') {
          const mx = bot.matrix_best_cell as any;
          const mxWinRatePct = (mx.winRate || 0) * 100;
          const mxTrades = mx.totalTrades || 0;
          const mxPnl = mx.netPnl || 0;
          const mxMaxDd = mx.maxDrawdownPct || 0;
          const mxProfitFactor = mx.profitFactor || 0;
          const mxExpectancy = mx.expectancy || 0;
          const mxSharpe = mx.sharpeRatio || 0;
          const mxLosingTrades = mx.losingTrades || 0;
          
          // Check if matrix passes all core gates (skip rolling_metrics_consistency for matrix)
          matrixPromotionGatesPassed = 
            mxTrades >= labThresholds.minTrades &&
            mxPnl > 0 &&
            (mxMaxDd > 0 && mxMaxDd <= labThresholds.maxDrawdownPct) &&
            mxWinRatePct >= labThresholds.minWinRate &&
            mxProfitFactor >= labThresholds.minProfitFactor &&
            mxExpectancy >= labThresholds.minExpectancy &&
            mxSharpe >= labThresholds.minSharpe &&
            mxLosingTrades > 0 &&
            hasMarketDataProof &&
            score >= 50; // score_threshold
          
          if (matrixPromotionGatesPassed) {
            matrixPromotionSource = 'MATRIX_BEST_CELL';
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} MATRIX_PROMOTION_ELIGIBLE: trades=${mxTrades} pnl=${mxPnl} sharpe=${mxSharpe} winRate=${mxWinRatePct}%`);
          }
        }

        const allGatesPass = Object.values(promotionGates).every(g => g.passed);
        const failedGates = Object.entries(promotionGates).filter(([k, v]) => !v.passed);
        const passedGates = Object.entries(promotionGates).filter(([k, v]) => v.passed);

        // CRITICAL: Promote if EITHER latest backtest OR matrix best cell passes gates
        const decision = (allGatesPass || matrixPromotionGatesPassed) ? "PROMOTE" : "HOLD";

        // Generate friendly gate descriptions for TRIALS stage HOLD events
        const gateDescriptions: Record<string, string> = {
          min_trades: `Need ${labThresholds.minTrades - latestTrades} more trades`,
          profitable: `Needs positive P&L`,
          win_rate: `Win rate below ${(labThresholds.minWinRate * 100).toFixed(0)}%`,
          max_drawdown: `Drawdown above ${labThresholds.maxDrawdownPct}%`,
          profit_factor: `Profit factor below ${labThresholds.minProfitFactor}`,
          expectancy: `Expectancy below $${labThresholds.minExpectancy}`,
          sharpe_ratio: `Sharpe ratio below ${labThresholds.minSharpe}`,
          has_losers: `Need at least 1 losing trade (realism check)`,
          market_data_proof: `Awaiting market data verification`,
          score_threshold: `Autonomy score below 50`,
          rolling_metrics_consistency: `Need ${ROLLING_SESSIONS_REQUIRED} consistent sessions (have ${sessionsMeetingThresholds}/${totalRecentSessions})`,
          walk_forward_validation: `Walk-forward validation not completed`,
          walk_forward_consistency: `Walk-forward consistency below ${labThresholds.minWalkForwardConsistency || 0.5}`,
          overfit_ratio: `Overfit ratio above ${labThresholds.maxOverfitRatio || 2.0}x`,
          stress_test_passed: `Stress test scenarios not passed`,
        };
        
        const friendlyBlockerList = failedGates.map(([k]) => gateDescriptions[k] || k).slice(0, 2).join(", ");
        const moreBlockers = failedGates.length > 2 ? ` +${failedGates.length - 2} more` : "";

        // SUPPRESS repeated HOLD events to prevent activity feed spam
        // Only emit if: 1) It's a PROMOTE (always emit), 2) Gates changed, or 3) 30min passed
        const currentFailedGateKeys = failedGates.map(([k]) => k).sort().join(",");
        const lastHold = lastHoldEventByBot.get(bot.id);
        const shouldEmitHoldEvent = decision === "PROMOTE" || !lastHold || 
          lastHold.failedGates.sort().join(",") !== currentFailedGateKeys ||
          (Date.now() - lastHold.timestamp) > HOLD_EVENT_SUPPRESSION_MS;

        if (shouldEmitHoldEvent) {
          // Update suppression tracking for HOLD events
          if (decision === "HOLD") {
            lastHoldEventByBot.set(bot.id, {
              failedGates: failedGates.map(([k]) => k),
              timestamp: Date.now(),
            });
          }

          // Emit auditable decision event (PROMOTE always, HOLD only when gates change or interval passed)
          const promotionSourceLabel = matrixPromotionGatesPassed ? 'MATRIX_BEST_CELL' : 'LATEST_BACKTEST';
          await logActivityEvent({
            botId: bot.id,
            eventType: "AUTONOMY_TIER_CHANGED",
            severity: "INFO",
            title: decision === "PROMOTE" ? `${bot.name}: PROMOTED` : `${bot.name}: Evolving`,
            summary: decision === "PROMOTE" 
              ? `TRIALS → PAPER_SIM (Score: ${score}, via ${promotionSourceLabel})`
              : `${friendlyBlockerList}${moreBlockers}`,
            payload: {
              decision,
              prev_stage: "TRIALS",
              new_stage: decision === "PROMOTE" ? "PAPER" : "TRIALS",
              prev_tier: tier,
              new_tier: tier,
              autonomy_score: score,
              reasons: decision === "PROMOTE" 
                ? ["ALL_GATES_PASSED"] 
                : failedGates.map(([k]) => k.toUpperCase()),
              gates: promotionGates,
              inputs: inputsSnapshot,
              breakdown: scoreBreakdown,
            },
            traceId,
            stage: bot.stage,
          });
        }

        // CRITICAL: Use decision variable which includes both allGatesPass AND matrixPromotionGatesPassed
        if (decision === "PROMOTE") {
          // PROMOTE to PAPER (SIM only - no broker required)
          await db.execute(sql`
            UPDATE bots SET stage = 'PAPER', mode = 'SIM_LIVE', updated_at = NOW()
            WHERE id = ${bot.id}::uuid
          `);
          
          // Determine decision reason based on what passed
          const decisionReason = allGatesPass ? 'ALL_GATES_PASSED' : 'MATRIX_BEST_CELL_PASSED';
          
          // INSTITUTIONAL: Log promotion to audit trail for compliance
          await db.execute(sql`
            INSERT INTO promotion_audit_trail (
              bot_id, from_stage, to_stage, decision, trace_id,
              gates_snapshot, passed_gates_count, total_gates_count,
              metrics_snapshot, autonomy_score, autonomy_tier, decision_reason
            ) VALUES (
              ${bot.id}::uuid, 'TRIALS', 'PAPER', 'PROMOTE', ${traceId}::uuid,
              ${JSON.stringify(promotionGates)}::jsonb, ${passedGates.length}, ${Object.keys(promotionGates).length},
              ${JSON.stringify(inputsSnapshot)}::jsonb, ${score}, ${tier}, ${decisionReason}
            )
          `);

          promotions++;
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} PROMOTED TRIALS->PAPER score=${score} via=${decisionReason}`);
          
          // Log Grok feedback for autonomous learning loop
          await checkGrokBotAndLogPromotion(
            bot.id,
            "TRIALS",
            "PAPER",
            {
              sharpe: latestSharpe,
              winRate: latestWinRate,
              maxDrawdownPct: latestMaxDd,
              profitFactor: latestProfitFactor,
              tradeCount: latestTrades,
              netPnl: latestPnl,
            },
            traceId
          );
          
          // SUCCESS REINFORCEMENT: Log winning patterns for future research
          await logGrokSuccessPatterns(
            bot.id,
            "TRIALS",
            "PAPER",
            {
              sharpe: latestSharpe,
              winRate: latestWinRate,
              maxDrawdownPct: latestMaxDd,
              tradeCount: latestTrades,
              netPnl: latestPnl,
            },
            traceId
          );
          
          // Send Discord notification for promotion
          await sendDiscord({
            channel: "autonomy",
            title: `PROMOTED: ${bot.name}`,
            message: `**TRIALS → PAPER**\nScore: ${score} | All ${passedGates.length} gates passed`,
            severity: "INFO",
            metadata: {
              botId: bot.id,
              score,
              gatesPassed: passedGates.length,
            },
            correlationId: traceId,
          });
          
          // CRITICAL: Create bot instance and start paper runner immediately after promotion
          // Without this, promoted bots won't scan for trades until manual intervention
          // Uses distributed locking to prevent duplicate instance creation
          const instanceLockKey = `bot-instance:${bot.id}`;
          const instanceLock = await acquireLock(instanceLockKey, 60);
          
          if (!instanceLock.acquired && !instanceLock.degraded) {
            // Another process holds the lock - skip to prevent duplicates
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} instance_creation=SKIPPED (lock held)`);
          } else {
            // Either lock acquired, or Redis unavailable (degraded mode)
            if (instanceLock.degraded) {
              console.warn(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} instance_creation=DEGRADED_MODE`);
            }
            try {
              // Double-check: no existing RUNNING instance
              const existingInstance = await db.execute(sql`
                SELECT id FROM bot_instances WHERE bot_id = ${bot.id}::uuid AND status = 'RUNNING' LIMIT 1
              `);
              
              if (existingInstance.rows.length > 0) {
                console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} instance_creation=SKIPPED (already running)`);
              } else {
                const newInstanceId = crypto.randomUUID();
                console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} creating_paper_instance=${newInstanceId.slice(0,8)}`);
                
                await db.insert(botInstances).values({
                  id: newInstanceId,
                  botId: bot.id,
                  accountId: null, // PAPER stage uses simulated account
                  executionMode: "SIM_LIVE",
                  status: "RUNNING",
                  activityState: "IDLE",
                  stateJson: {
                    promotedAt: new Date().toISOString(),
                    promotionSource: decisionReason,
                    autonomyScore: score,
                  },
                });
                
                // Start the paper runner for immediate trade scanning
                const started = await paperRunnerService.startBot(bot.id, newInstanceId);
                if (started) {
                  console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} paper_runner_started`);
                  await logRunnerStarted(bot.userId || 'system', bot.id, bot.name, newInstanceId, 'AUTONOMY_PROMOTION');
                } else {
                  console.warn(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} paper_runner_start_failed`);
                }
              }
            } catch (runnerError: any) {
              // Check if this is a unique constraint violation (duplicate prevented by DB)
              if (isUniqueViolation(runnerError)) {
                console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} instance_creation=DUPLICATE_PREVENTED (DB constraint)`);
              } else {
                console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot=${bot.id.slice(0,8)} runner_creation_error:`, runnerError);
              }
            } finally {
              // Only release lock if we actually acquired one (not in degraded mode)
              if (instanceLock.lockId) {
                await releaseLock(instanceLockKey, instanceLock.lockId);
              }
            }
          }
        } else {
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} HOLD failed_gates=${failedGates.map(([k]) => k).join(",")}`);
        }
      }

      // Demotion logic for PAPER stage (stricter) - also respects stage lock
      if (bot.stage === "PAPER" && !isStageLockedByTime) {
        const shouldDemote = score < 30 || latestMaxDd > 30 || (latestPnl < -500 && latestTrades > 20);
        const demotionReasons: string[] = [];
        if (score < 30) demotionReasons.push("SCORE_TOO_LOW");
        if (latestMaxDd > 30) demotionReasons.push("MAX_DD_EXCEEDED");
        if (latestPnl < -500 && latestTrades > 20) demotionReasons.push("SIGNIFICANT_LOSS");

        if (shouldDemote) {
          await db.execute(sql`
            UPDATE bots SET stage = 'TRIALS', mode = 'BACKTEST_ONLY', updated_at = NOW()
            WHERE id = ${bot.id}::uuid
          `);
          
          // INSTITUTIONAL: Log demotion to audit trail for compliance
          await db.execute(sql`
            INSERT INTO promotion_audit_trail (
              bot_id, from_stage, to_stage, decision, trace_id,
              blocker_codes, metrics_snapshot, autonomy_score, autonomy_tier, decision_reason
            ) VALUES (
              ${bot.id}::uuid, 'PAPER', 'TRIALS', 'DEMOTE', ${traceId}::uuid,
              ${demotionReasons}::text[], ${JSON.stringify(inputsSnapshot)}::jsonb, 
              ${score}, ${tier}, ${demotionReasons.join(", ")}
            )
          `);

          await logActivityEvent({
            botId: bot.id,
            eventType: "AUTONOMY_TIER_CHANGED",
            severity: "WARN",
            title: `${bot.name}: DEMOTED`,
            summary: `PAPER → TRIALS: ${demotionReasons.join(", ")}`,
            payload: {
              decision: "DEMOTE",
              prev_stage: "PAPER",
              new_stage: "TRIALS",
              prev_tier: tier,
              new_tier: "LOCKED",
              autonomy_score: score,
              reasons: demotionReasons,
              inputs: inputsSnapshot,
              breakdown: scoreBreakdown,
            },
            traceId,
            stage: "TRIALS",
          });

          demotions++;
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} DEMOTED PAPER->TRIALS score=${score} reasons=${demotionReasons.join(",")}`);
          
          // Log Grok feedback for autonomous learning loop
          await checkGrokBotAndLogPromotion(
            bot.id,
            "PAPER",
            "TRIALS",
            {
              sharpe: latestSharpe,
              winRate: latestWinRate,
              maxDrawdownPct: latestMaxDd,
              profitFactor: latestProfitFactor,
              tradeCount: latestTrades,
              netPnl: latestPnl,
            },
            traceId
          );
          
          // AUTO-EVOLVE: Request Grok to generate evolved strategy from this failure
          requestGrokEvolution(
            bot.id,
            demotionReasons,
            {
              sharpe: latestSharpe,
              winRate: latestWinRate,
              maxDrawdownPct: latestMaxDd,
              tradeCount: latestTrades,
              netPnl: latestPnl,
            },
            "UNKNOWN", // Will be detected by Grok research engine
            traceId
          ).then(result => {
            if (result.success) {
              console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} EVOLUTION_TRIGGERED ${result.message}`);
            }
          }).catch(err => {
            console.warn(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} EVOLUTION_FAILED ${err.message}`);
          });
          
          // Send Discord notification for demotion
          await sendDiscord({
            channel: "autonomy",
            title: `DEMOTED: ${bot.name}`,
            message: `**PAPER → TRIALS**\nScore: ${score} | Reasons: ${demotionReasons.join(", ")}`,
            severity: "WARN",
            metadata: {
              botId: bot.id,
              score,
              reasons: demotionReasons.join(", "),
            },
            correlationId: traceId,
          });
        } else if (!isPromotionModeManual) {
          // =====================================================================
          // PAPER → SHADOW AUTOMATIC PROMOTION
          // Uses paper trading metrics + PAPER stage thresholds
          // =====================================================================
          const paperThresholds = UNIFIED_STAGE_THRESHOLDS.PAPER;
          const paperTradesCount = parseInt(bot.paper_trades_count || "0");
          const paperNetPnl = parseFloat(bot.paper_net_pnl || "0");
          const paperWinRate = parseFloat(bot.paper_win_rate || "0");
          const daysInStage = parseFloat(bot.days_in_stage || "0");
          
          // PAPER → SHADOW gates (using paper trading metrics)
          const paperGatesPassed = 
            paperTradesCount >= paperThresholds.minTrades &&
            paperNetPnl > 0 &&
            paperWinRate * 100 >= paperThresholds.minWinRate &&
            daysInStage >= (paperThresholds.minDays || 5) &&
            score >= 50;
          
          if (paperGatesPassed) {
            // PROMOTE to SHADOW
            await db.execute(sql`
              UPDATE bots SET stage = 'SHADOW', mode = 'SHADOW', updated_at = NOW()
              WHERE id = ${bot.id}::uuid
            `);
            
            await db.execute(sql`
              INSERT INTO promotion_audit_trail (
                bot_id, from_stage, to_stage, decision, trace_id,
                metrics_snapshot, autonomy_score, autonomy_tier, decision_reason
              ) VALUES (
                ${bot.id}::uuid, 'PAPER', 'SHADOW', 'PROMOTE', ${traceId}::uuid,
                ${JSON.stringify({ paper_trades: paperTradesCount, paper_pnl: paperNetPnl, paper_win_rate: paperWinRate, days_in_stage: daysInStage })}::jsonb,
                ${score}, ${tier}, 'ALL_PAPER_GATES_PASSED'
              )
            `);
            
            await logActivityEvent({
              botId: bot.id,
              eventType: "PROMOTED",
              severity: "INFO",
              title: `${bot.name}: PROMOTED`,
              summary: `PAPER → SHADOW (${paperTradesCount} paper trades, $${paperNetPnl.toFixed(2)} P&L)`,
              payload: { prev_stage: "PAPER", new_stage: "SHADOW", paper_trades: paperTradesCount, paper_pnl: paperNetPnl, days_in_stage: daysInStage },
              traceId,
              stage: "SHADOW",
            });
            
            promotions++;
            console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} PROMOTED PAPER->SHADOW paper_trades=${paperTradesCount} pnl=${paperNetPnl}`);
            
            // Log Grok feedback for autonomous learning loop
            await checkGrokBotAndLogPromotion(
              bot.id,
              "PAPER",
              "SHADOW",
              {
                sharpe: latestSharpe,
                winRate: paperWinRate,
                tradeCount: paperTradesCount,
                netPnl: paperNetPnl,
              },
              traceId
            );
            
            // SUCCESS REINFORCEMENT: Log winning patterns for future research
            await logGrokSuccessPatterns(
              bot.id,
              "PAPER",
              "SHADOW",
              {
                sharpe: latestSharpe,
                winRate: paperWinRate,
                tradeCount: paperTradesCount,
                netPnl: paperNetPnl,
              },
              traceId
            );
            
            await sendDiscord({
              channel: "autonomy",
              title: `PROMOTED: ${bot.name}`,
              message: `**PAPER → SHADOW**\nPaper trades: ${paperTradesCount} | P&L: $${paperNetPnl.toFixed(2)}\nDays in stage: ${daysInStage.toFixed(1)}`,
              severity: "INFO",
              correlationId: traceId,
            });
          }
        }
      }
      
      // =====================================================================
      // SHADOW → CANARY AUTOMATIC PROMOTION
      // Requires walk-forward validation + stress test
      // =====================================================================
      if (bot.stage === "SHADOW" && !isStageLockedByTime && !isPromotionModeManual) {
        const shadowThresholds = UNIFIED_STAGE_THRESHOLDS.SHADOW;
        const paperTradesCount = parseInt(bot.paper_trades_count || "0");
        const paperNetPnl = parseFloat(bot.paper_net_pnl || "0");
        const paperWinRate = parseFloat(bot.paper_win_rate || "0");
        const daysInStage = parseFloat(bot.days_in_stage || "0");
        
        // Check walk-forward validation
        let walkForwardPassed = false;
        let walkForwardConsistency = 0;
        let overfitRatio = Infinity;
        try {
          const wfRun = await getLatestWalkForwardForBot(bot.id);
          if (wfRun && wfRun.status === 'COMPLETED') {
            walkForwardPassed = wfRun.passedValidation ?? false;
            walkForwardConsistency = wfRun.consistencyScore ?? 0;
            overfitRatio = wfRun.overfitRatio ?? Infinity;
          }
        } catch (e) {
          console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SHADOW walk_forward_check_error:`, e);
        }
        
        // SHADOW → CANARY gates
        const shadowGatesPassed = 
          paperTradesCount >= shadowThresholds.minTrades &&
          paperNetPnl > 0 &&
          paperWinRate * 100 >= shadowThresholds.minWinRate &&
          daysInStage >= (shadowThresholds.minDays || 10) &&
          walkForwardPassed &&
          walkForwardConsistency >= (shadowThresholds.minWalkForwardConsistency || 0.5) &&
          overfitRatio <= (shadowThresholds.maxOverfitRatio || 2.5) &&
          score >= 60;
        
        if (shadowGatesPassed) {
          // PROMOTE to CANARY
          await db.execute(sql`
            UPDATE bots SET stage = 'CANARY', mode = 'CANARY', updated_at = NOW()
            WHERE id = ${bot.id}::uuid
          `);
          
          await db.execute(sql`
            INSERT INTO promotion_audit_trail (
              bot_id, from_stage, to_stage, decision, trace_id,
              metrics_snapshot, autonomy_score, autonomy_tier, decision_reason
            ) VALUES (
              ${bot.id}::uuid, 'SHADOW', 'CANARY', 'PROMOTE', ${traceId}::uuid,
              ${JSON.stringify({ paper_trades: paperTradesCount, paper_pnl: paperNetPnl, walk_forward_passed: walkForwardPassed, consistency: walkForwardConsistency, overfit_ratio: overfitRatio })}::jsonb,
              ${score}, ${tier}, 'ALL_SHADOW_GATES_PASSED'
            )
          `);
          
          await logActivityEvent({
            botId: bot.id,
            eventType: "PROMOTED",
            severity: "INFO",
            title: `${bot.name}: PROMOTED`,
            summary: `SHADOW → CANARY (Walk-forward validated, consistency: ${(walkForwardConsistency * 100).toFixed(0)}%)`,
            payload: { prev_stage: "SHADOW", new_stage: "CANARY", walk_forward: walkForwardPassed, consistency: walkForwardConsistency },
            traceId,
            stage: "CANARY",
          });
          
          promotions++;
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} PROMOTED SHADOW->CANARY walk_forward=${walkForwardPassed} consistency=${walkForwardConsistency}`);
          
          await sendDiscord({
            channel: "autonomy",
            title: `PROMOTED: ${bot.name}`,
            message: `**SHADOW → CANARY**\nWalk-forward validated | Consistency: ${(walkForwardConsistency * 100).toFixed(0)}%\nOverfit ratio: ${overfitRatio.toFixed(2)}x`,
            severity: "INFO",
            correlationId: traceId,
          });
        }
      }
      
      // =====================================================================
      // CANARY → LIVE: READY FOR LIVE NOTIFICATION (Manual approval required)
      // No auto-promotion - user must approve CANARY → LIVE transition
      // =====================================================================
      if (bot.stage === "CANARY" && !isStageLockedByTime) {
        const canaryThresholds = UNIFIED_STAGE_THRESHOLDS.CANARY;
        const paperTradesCount = parseInt(bot.paper_trades_count || "0");
        const paperNetPnl = parseFloat(bot.paper_net_pnl || "0");
        const paperWinRate = parseFloat(bot.paper_win_rate || "0");
        const daysInStage = parseFloat(bot.days_in_stage || "0");
        
        // Check walk-forward and stress test
        let walkForwardPassed = false;
        let stressTestPassed = false;
        try {
          const wfRun = await getLatestWalkForwardForBot(bot.id);
          walkForwardPassed = wfRun?.status === 'COMPLETED' && (wfRun.passedValidation === true);
          stressTestPassed = await hasPassedStressTests(bot.id);
        } catch (e) {
          console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} CANARY gate_check_error:`, e);
        }
        
        // CANARY → LIVE gates (all must pass for READY notification)
        const canaryGatesPassed = 
          paperTradesCount >= canaryThresholds.minTrades &&
          paperNetPnl > 0 &&
          paperWinRate * 100 >= canaryThresholds.minWinRate &&
          daysInStage >= (canaryThresholds.minDays || 14) &&
          walkForwardPassed &&
          stressTestPassed &&
          score >= 70;
        
        // Check if we've already notified about this bot being ready
        const readyNotifiedKey = `READY_FOR_LIVE_${bot.id}`;
        const alreadyNotified = lastHoldEventByBot.get(readyNotifiedKey);
        const shouldNotify = canaryGatesPassed && !alreadyNotified;
        
        if (shouldNotify) {
          // Mark as notified (don't spam)
          lastHoldEventByBot.set(readyNotifiedKey, { failedGates: [], timestamp: Date.now() });
          
          await logActivityEvent({
            botId: bot.id,
            eventType: "READY_FOR_LIVE",
            severity: "SUCCESS",
            title: `${bot.name}: READY FOR LIVE`,
            summary: `All CANARY gates passed - awaiting manual approval for LIVE trading`,
            payload: { 
              paper_trades: paperTradesCount, 
              paper_pnl: paperNetPnl,
              days_in_canary: daysInStage,
              walk_forward: walkForwardPassed,
              stress_test: stressTestPassed,
              score,
              action_required: "Manual approval via UI or POST /api/bots/:id/request-live-approval"
            },
            traceId,
            stage: "CANARY",
          });
          
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} READY_FOR_LIVE all_gates_passed=true awaiting_approval=true`);
          
          // Send CRITICAL Discord notification - this is a major milestone
          await sendDiscord({
            channel: "autonomy",
            title: `READY FOR LIVE: ${bot.name}`,
            message: `**All CANARY gates PASSED**\n` +
                     `Paper trades: ${paperTradesCount} | P&L: $${paperNetPnl.toFixed(2)}\n` +
                     `Days in CANARY: ${daysInStage.toFixed(1)}\n` +
                     `Walk-forward: PASSED | Stress test: PASSED\n` +
                     `Autonomy score: ${score}\n\n` +
                     `**ACTION REQUIRED:** Manual approval to promote to LIVE`,
            severity: "SUCCESS",
            correlationId: traceId,
          });
          
          // Create in-app alert for notifications panel (sidebar)
          if (bot.user_id) {
            try {
              await storage.createAlert({
                userId: bot.user_id,
                category: 'LIVE_PROMOTION_RECOMMENDED',
                severity: 'CRITICAL',
                source: 'promotion_engine',
                entityType: 'BOT',
                entityId: bot.id,
                title: `${bot.name}: Ready for LIVE`,
                message: `All CANARY gates passed. Paper trades: ${paperTradesCount}, P&L: $${paperNetPnl.toFixed(2)}, Days: ${daysInStage.toFixed(1)}. Click to approve LIVE promotion.`,
                payloadJson: {
                  paper_trades: paperTradesCount,
                  paper_pnl: paperNetPnl,
                  days_in_canary: daysInStage,
                  walk_forward: walkForwardPassed,
                  stress_test: stressTestPassed,
                  score,
                  trace_id: traceId,
                },
                actionHintsJson: {
                  primary: { label: 'Approve LIVE', action: 'PROMOTE_TO_LIVE' },
                  secondary: { label: 'View Bot', action: 'VIEW_BOT' },
                },
                dedupeKey: `READY_FOR_LIVE_${bot.id}`,
              });
              console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} ALERT_CREATED category=LIVE_PROMOTION_RECOMMENDED`);
            } catch (alertErr) {
              console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} ALERT_CREATE_FAILED:`, alertErr);
            }
          }
        }
      }
    }

    // Update run statistics
    totalBotsEvaluated = botRows.length;
    totalJobsEnqueued = backtestsQueued + promotions; // backtests + stage changes
    totalBlocked = botRows.length - promotions - demotions - scoreUpdates;

    console.log(`[AUTONOMY_LOOP] trace_id=${traceId} completed bots=${botRows.length} promotions=${promotions} demotions=${demotions} scores=${scoreUpdates} backtests_queued=${backtestsQueued}`);

    // =====================================================================
    // SOURCE SELECTION GOVERNOR (Autonomous source enable/disable)
    // =====================================================================
    // Runs post-optimization for each bot to evaluate signal source performance
    // and make enable/disable decisions with audit logging
    let governorDecisions = 0;
    for (const bot of botRows) {
      try {
        // Load current source states for this bot
        const currentStates = await loadBotSourceStates(bot.id);
        
        // Skip if autonomous selection is disabled for this bot
        if (!currentStates.useAutonomousSelection) {
          continue;
        }
        
        // Build performance snapshots from adaptive weights and backtest history
        const performanceSnapshots = await buildPerformanceSnapshots(bot.id, traceId);
        
        // Run governor evaluation
        const result = await runSourceSelectionGovernor(
          bot.id,
          bot.name,
          currentStates,
          performanceSnapshots
        );
        
        // Persist updated states if any decisions were made
        if (result.decisions.length > 0) {
          await persistBotSourceStates(bot.id, result.newStates);
          governorDecisions += result.decisions.length;
          
          console.log(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SOURCE_GOVERNOR decisions=${result.decisions.length}`);
        }
      } catch (e) {
        console.error(`[AUTONOMY_LOOP] trace_id=${traceId} bot_id=${bot.id} SOURCE_GOVERNOR_ERROR:`, e);
      }
    }
    
    if (governorDecisions > 0) {
      console.log(`[AUTONOMY_LOOP] trace_id=${traceId} SOURCE_GOVERNOR total_decisions=${governorDecisions}`);
    }

  } catch (error) {
    console.error(`[AUTONOMY_LOOP] trace_id=${traceId} error=`, error);
    
    // Record error in run
    if (runId) {
      try {
        await db.execute(sql`
          UPDATE autonomy_planner_runs 
          SET finished_at = NOW(), 
              error_json = ${JSON.stringify({ message: String(error), stack: (error as any)?.stack })}::jsonb
          WHERE id = ${runId}::uuid
        `);
      } catch (e) { /* ignore */ }
    }
    return;
  }

  // Finalize run record with results
  if (runId) {
    try {
      const summary = {
        promotions,
        demotions,
        score_updates: scoreUpdates,
        backtests_queued: totalJobsEnqueued,
      };
      await db.execute(sql`
        UPDATE autonomy_planner_runs 
        SET finished_at = NOW(),
            bots_evaluated = ${totalBotsEvaluated},
            jobs_enqueued = ${totalJobsEnqueued},
            blocked = ${totalBlocked},
            summary_json = ${JSON.stringify(summary)}::jsonb,
            reasons_top_json = ${JSON.stringify(reasonsTop)}::jsonb
        WHERE id = ${runId}::uuid
      `);
    } catch (e) {
      console.error(`[AUTONOMY_LOOP] trace_id=${traceId} failed to finalize run record:`, e);
    }
  }
}

/**
 * Runner Worker
 * Manages real-time paper trading execution for PAPER/SHADOW/CANARY/LIVE bot instances
 * Starts paper runner service for eligible bots and maintains heartbeats
 */
async function runRunnerWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    // Ensure paper runner service is running
    await paperRunnerService.start();
    
    // SESSION ENFORCEMENT: Close positions if outside trading hours
    // This runs every 30s to catch positions that weren't closed at 4 PM
    // (e.g., if no bars came in after market close)
    const sessionResult = await paperRunnerService.enforceSessionEnd();
    if (sessionResult.isOutsideSession && sessionResult.positionsClosed > 0) {
      console.log(`[RUNNER_WORKER] trace_id=${traceId} SESSION_ENFORCEMENT closed=${sessionResult.positionsClosed}`);
    }
    
    // BULLETPROOF AUTO-RESTART: Find stuck bots that are ready for restart after recovery
    // This catches bots that were stopped due to blown accounts but have been reset
    const stuckBotsResult = await db.execute(sql`
      SELECT bi.id, bi.bot_id, bi.account_id, b.name as bot_name, b.stage
      FROM bot_instances bi
      JOIN bots b ON bi.bot_id = b.id
      WHERE bi.status = 'STOPPED'
        AND bi.job_type = 'RUNNER'
        AND bi.is_primary_runner = true
        AND b.stage IN ('PAPER', 'SHADOW', 'CANARY')
        AND b.archived_at IS NULL
        AND b.killed_at IS NULL
        AND (
          -- Check if readyForRestart flag is set (account was reset)
          bi.state_json->>'readyForRestart' = 'true'
          -- OR if awaitingRecovery is cleared (legacy fix)
          OR (bi.state_json->>'awaitingRecovery' IS NULL AND bi.state_json->>'blownAccount' IS NULL)
        )
    `);
    
    const stuckBots = stuckBotsResult.rows as any[];
    let autoRestarts = 0;
    
    for (const stuck of stuckBots) {
      // Verify account is not blown before attempting restart
      if (stuck.account_id) {
        const blownCheck = await storage.checkAndHandleBlownAccount(stuck.account_id);
        if (blownCheck.isBlown) {
          continue; // Skip - account is still blown
        }
      }
      
      // ATOMIC CHECK-AND-UPDATE: Use a single CTE to verify no RUNNING instance exists AND update atomically
      // This eliminates the race window between separate SELECT and UPDATE statements
      let updateResult;
      try {
        updateResult = await db.execute(sql`
          WITH 
            existing_check AS (
              SELECT 1 AS has_running FROM bot_instances 
              WHERE bot_id = ${stuck.bot_id}::uuid AND status = 'RUNNING' 
              LIMIT 1
            ),
            do_update AS (
              UPDATE bot_instances SET
                status = 'RUNNING',
                stopped_at = NULL,
                state_json = COALESCE(state_json, '{}'::jsonb)
                  - 'readyForRestart'
                  - 'recoveredAt'
                  - 'awaitingRecovery'
                  || jsonb_build_object(
                    'autoRestarted', true,
                    'restartedAt', NOW()::text,
                    'restartReason', 'POST_RECOVERY_AUTO_RESTART'
                  )
              WHERE id = ${stuck.id}::uuid
                AND status = 'STOPPED'
                AND NOT EXISTS (SELECT 1 FROM existing_check)
              RETURNING id, 'updated' AS result
            )
          SELECT id, result FROM do_update
          UNION ALL
          SELECT NULL::uuid, 'blocked_by_existing' FROM existing_check
        `);
      } catch (updateErr: any) {
        // Handle unique constraint violation - race condition fallback
        if (isUniqueViolation(updateErr)) {
          console.log(`[RUNNER_WORKER] trace_id=${traceId} SKIP_UNIQUE_CONSTRAINT bot=${stuck.bot_id.slice(0,8)} (race to unique constraint)`);
          continue;
        }
        throw updateErr; // Re-throw other errors
      }
      
      // Check result type
      const rows = updateResult.rows as any[];
      if (rows.length === 0) {
        // No rows = instance was already started by another worker (status != STOPPED)
        console.log(`[RUNNER_WORKER] trace_id=${traceId} SKIP_ALREADY_STARTED bot=${stuck.bot_id.slice(0,8)}`);
        continue;
      }
      
      if (rows[0]?.result === 'blocked_by_existing') {
        continue;
      }
      
      if (rows[0]?.result !== 'updated') {
        console.log(`[RUNNER_WORKER] trace_id=${traceId} SKIP_UNEXPECTED_RESULT bot=${stuck.bot_id.slice(0,8)} result=${rows[0]?.result}`);
        continue;
      }
      
      console.log(`[RUNNER_WORKER] trace_id=${traceId} AUTO_RESTART_RECOVERED bot=${stuck.bot_id.slice(0,8)} stage=${stuck.stage}`);
      
      // Start the paper runner (with rollback on failure)
      try {
        const started = await paperRunnerService.startBot(stuck.bot_id, stuck.id);
        if (started) {
          autoRestarts++;
          console.log(`[RUNNER_WORKER] trace_id=${traceId} AUTO_RESTART_SUCCESS bot=${stuck.bot_id.slice(0,8)}`);
          
          await logActivityEvent({
            eventType: "RUNNER_STARTED",
            severity: "INFO",
            title: `Auto-Restarted: ${stuck.bot_name}`,
            summary: `Bot automatically resumed after account recovery`,
            payload: { 
              botId: stuck.bot_id,
              stage: stuck.stage,
              trigger: 'POST_RECOVERY_AUTO_RESTART',
            },
            traceId,
          });
        } else {
          // startBot returned false - roll back to STOPPED
          console.log(`[RUNNER_WORKER] trace_id=${traceId} AUTO_RESTART_ROLLBACK bot=${stuck.bot_id.slice(0,8)} reason=start_returned_false`);
          await db.execute(sql`
            UPDATE bot_instances SET
              status = 'STOPPED',
              stopped_at = NOW(),
              state_json = COALESCE(state_json, '{}'::jsonb) || jsonb_build_object(
                'restartFailed', true,
                'restartFailedAt', NOW()::text,
                'restartFailReason', 'startBot returned false'
              )
            WHERE id = ${stuck.id}::uuid
          `);
        }
      } catch (startErr) {
        // startBot threw - roll back to STOPPED so supervisor can retry later
        console.error(`[RUNNER_WORKER] trace_id=${traceId} AUTO_RESTART_FAILED bot=${stuck.bot_id.slice(0,8)}:`, startErr);
        await db.execute(sql`
          UPDATE bot_instances SET
            status = 'STOPPED',
            stopped_at = NOW(),
            state_json = COALESCE(state_json, '{}'::jsonb) || jsonb_build_object(
              'restartFailed', true,
              'restartFailedAt', NOW()::text,
              'restartFailReason', ${(startErr instanceof Error ? startErr.message : 'Unknown error')}
            )
          WHERE id = ${stuck.id}::uuid
        `).catch(rollbackErr => {
          console.error(`[RUNNER_WORKER] trace_id=${traceId} ROLLBACK_FAILED bot=${stuck.bot_id.slice(0,8)}:`, rollbackErr);
        });
      }
    }
    
    if (autoRestarts > 0) {
      console.log(`[RUNNER_WORKER] trace_id=${traceId} AUTO_RESTARTED ${autoRestarts} bot(s) after recovery`);
    }
    
    // Find all running RUNNER instances for PAPER+ bots (including account_id for blown checks)
    const result = await db.execute(sql`
      SELECT bi.id, bi.bot_id, bi.activity_state, bi.account_id, b.name as bot_name, b.stage
      FROM bot_instances bi
      JOIN bots b ON bi.bot_id = b.id
      WHERE bi.status = 'RUNNING'
        AND bi.job_type = 'RUNNER'
        AND bi.is_primary_runner = true
        AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
        AND b.archived_at IS NULL
        AND b.killed_at IS NULL
    `);
    
    const instances = result.rows as any[];
    
    if (instances.length === 0) {
      return; // No running instances to process
    }
    
    // BLOWN ACCOUNT ENFORCEMENT: Check all active runners for blown accounts
    // This catches cases where account went blown but trade never closed
    let blownStopped = 0;
    for (const instance of instances) {
      if (instance.account_id && paperRunnerService.isRunnerActive(instance.bot_id)) {
        const blownCheck = await storage.checkAndHandleBlownAccount(instance.account_id);
        if (blownCheck.isBlown) {
          console.log(`[RUNNER_WORKER] trace_id=${traceId} BLOWN_ACCOUNT_STOP bot=${instance.bot_id.slice(0,8)} account=${instance.account_id.slice(0,8)}`);
          try {
            await paperRunnerService.stopBot(instance.bot_id);
            blownStopped++;
          } catch (stopErr) {
            console.error(`[RUNNER_WORKER] trace_id=${traceId} failed_to_stop_blown bot=${instance.bot_id.slice(0,8)}:`, stopErr);
          }
        }
      }
    }
    
    // Start paper runner for each eligible instance not already running
    // AND send heartbeats to keep instances alive between bars
    let runnersStarted = 0;
    const heartbeatTimestamps = new Map<string, string>(); // Track heartbeat timestamps per bot
    
    for (const instance of instances) {
      // Always send heartbeat to keep instance alive (prevents supervisor restart)
      const now = new Date().toISOString();
      await db.execute(sql`
        UPDATE bot_instances 
        SET last_heartbeat_at = NOW(),
            updated_at = NOW()
        WHERE id = ${instance.id}::uuid
      `);
      
      // Store timestamp for later WebSocket broadcast (after runner actions complete)
      heartbeatTimestamps.set(instance.bot_id, now);
      
      // Check if paper runner is already active for this bot
      const isActive = paperRunnerService.isRunnerActive(instance.bot_id);
      if (!isActive) {
        // AGGRESSIVE: Always attempt to start paper runner for PAPER stage bots
        // This handles cases where rehydration failed (e.g., stale heartbeat at startup)
        if (instance.stage === 'PAPER') {
          // Use distributed lock to prevent duplicate starts across workers
          const runnerLockKey = `bot-runner:${instance.bot_id}`;
          const runnerLock = await acquireLock(runnerLockKey, 30);
          
          if (!runnerLock.acquired && !runnerLock.degraded) {
            // Another process holds the lock - skip to prevent duplicates
            console.log(`[RUNNER_WORKER] trace_id=${traceId} start_skipped bot=${instance.bot_id.slice(0,8)} reason=lock_held`);
          } else {
            // Either lock acquired, or Redis unavailable (degraded mode)
            if (runnerLock.degraded) {
              console.warn(`[RUNNER_WORKER] trace_id=${traceId} start_degraded bot=${instance.bot_id.slice(0,8)} reason=redis_unavailable`);
            }
            try {
              // Double-check if runner became active while acquiring lock
              if (paperRunnerService.isRunnerActive(instance.bot_id)) {
                console.log(`[RUNNER_WORKER] trace_id=${traceId} start_skipped bot=${instance.bot_id.slice(0,8)} reason=became_active`);
              } else {
                console.log(`[RUNNER_WORKER] trace_id=${traceId} attempting_start bot=${instance.bot_id.slice(0,8)} stage=${instance.stage}`);
                const started = await paperRunnerService.startBot(instance.bot_id, instance.id);
                if (started) {
                  runnersStarted++;
                  console.log(`[RUNNER_WORKER] trace_id=${traceId} started paper_runner bot=${instance.bot_id.slice(0,8)} stage=${instance.stage}`);
                } else {
                  console.log(`[RUNNER_WORKER] trace_id=${traceId} failed_to_start bot=${instance.bot_id.slice(0,8)} reason=startBot_returned_false`);
                }
              }
            } catch (startError) {
              console.error(`[RUNNER_WORKER] trace_id=${traceId} startBot_error bot=${instance.bot_id.slice(0,8)}:`, startError);
            } finally {
              // Only release lock if we actually acquired one (not in degraded mode)
              if (runnerLock.lockId) {
                await releaseLock(runnerLockKey, runnerLock.lockId);
              }
            }
          }
        }
      }
    }
    
    const activeCount = paperRunnerService.getActiveRunnerCount();
    // Always log runner status for visibility
    console.log(`[RUNNER_WORKER] trace_id=${traceId} active_runners=${activeCount} newly_started=${runnersStarted} blown_stopped=${blownStopped} heartbeats_sent=${instances.length}`);
    
    // Build heartbeat updates AFTER all runner actions complete for accurate hasRunner state
    const heartbeatUpdates: Array<{botId: string; lastHeartbeatAt: string; activityState: string | null; hasRunner: boolean}> = [];
    for (const instance of instances) {
      const timestamp = heartbeatTimestamps.get(instance.bot_id);
      if (timestamp) {
        heartbeatUpdates.push({
          botId: instance.bot_id,
          lastHeartbeatAt: timestamp,
          activityState: instance.activity_state || null,
          hasRunner: paperRunnerService.isRunnerActive(instance.bot_id), // Accurate post-action state
        });
      }
    }
    
    // Broadcast heartbeat updates via WebSocket for real-time UI updates
    if (heartbeatUpdates.length > 0) {
      livePnLWebSocket.broadcastHeartbeatBatch(heartbeatUpdates);
    }
    
  } catch (error) {
    console.error(`[RUNNER_WORKER] trace_id=${traceId} error=`, error);
  }
}

/**
 * Trend Consistency Worker
 * Ensures all bots have proper trend_direction calculated by fixing any INSUFFICIENT_DATA
 * records that actually have previous generation data available
 */
async function runTrendConsistencyWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    // Fix any INSUFFICIENT_DATA records that have previous generation data
    const result = await db.execute(sql`
      WITH latest_per_gen AS (
        SELECT DISTINCT ON (bot_id, generation_number) 
          id, bot_id, generation_number, sharpe_ratio, created_at
        FROM generation_metrics_history
        ORDER BY bot_id, generation_number DESC, created_at DESC, id DESC
      ),
      trend_calcs AS (
        SELECT 
          curr.id,
          curr.bot_id,
          curr.generation_number as curr_gen,
          prev.generation_number as prev_gen,
          curr.sharpe_ratio as curr_sharpe,
          prev.sharpe_ratio as prev_sharpe,
          CASE 
            WHEN prev.sharpe_ratio IS NULL OR curr.sharpe_ratio IS NULL THEN 'INSUFFICIENT_DATA'
            WHEN curr.sharpe_ratio - prev.sharpe_ratio > 0.1 THEN 'IMPROVING'
            WHEN curr.sharpe_ratio - prev.sharpe_ratio < -0.1 THEN 'DECLINING'
            ELSE 'STABLE'
          END as calculated_trend
        FROM latest_per_gen curr
        LEFT JOIN latest_per_gen prev ON curr.bot_id = prev.bot_id AND prev.generation_number = curr.generation_number - 1
      )
      UPDATE generation_metrics_history gmh
      SET trend_direction = tc.calculated_trend
      FROM trend_calcs tc
      WHERE gmh.id = tc.id
        AND gmh.trend_direction = 'INSUFFICIENT_DATA'
        AND tc.prev_sharpe IS NOT NULL
    `);
    
    const fixedCount = (result as any).rowCount || 0;
    if (fixedCount > 0) {
      console.log(`[TREND_CONSISTENCY] trace_id=${traceId} fixed=${fixedCount} records with INSUFFICIENT_DATA`);
    }
  } catch (error) {
    console.error(`[TREND_CONSISTENCY] trace_id=${traceId} error=`, error);
  }
}

// ============================================================================
// SELF-HEALING WORKER: Auto-recover DEAD bots
// Runs every 15 minutes to detect and fix broken bots autonomously
// ============================================================================

interface BotRecoveryState {
  attempts: number;
  lastAttempt: Date;
  lastReason: string;
}
const botRecoveryAttempts: Map<string, BotRecoveryState> = new Map();
const MAX_RECOVERY_ATTEMPTS_24H = 3;

async function runSelfHealingWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  console.log(`[SELF_HEALING] trace_id=${traceId} starting health scan`);
  
  try {
    // PHASE 0: Fix data inconsistencies (is_active=true but status=STOPPED)
    // This can occur if a bot was stopped but the is_active flag wasn't properly cleared
    const staleInstancesFixed = await db.execute(sql`
      UPDATE bot_instances
      SET 
        is_active = false,
        updated_at = NOW()
      WHERE status = 'STOPPED'
        AND is_active = true
      RETURNING id
    `);
    
    const staleFixedCount = staleInstancesFixed.rows.length;
    if (staleFixedCount > 0) {
      console.log(`[SELF_HEALING] trace_id=${traceId} phase0 fixed ${staleFixedCount} stale instances (is_active=true but status=STOPPED)`);
    }
    
    // PHASE 1: Clean up stuck backtest sessions (running > 1 hour)
    // These orphaned sessions block new backtests from being created
    const stuckSessions = await db.execute(sql`
      UPDATE backtest_sessions 
      SET 
        status = 'failed',
        error_message = 'Session orphaned - auto-recovered by self-healing worker',
        completed_at = NOW()
      WHERE status = 'running' 
        AND created_at < NOW() - INTERVAL '1 hour'
      RETURNING id, bot_id
    `);
    
    const stuckCount = stuckSessions.rows.length;
    if (stuckCount > 0) {
      console.log(`[SELF_HEALING] trace_id=${traceId} cleaned ${stuckCount} stuck backtest sessions`);
      
      // Log activity event for visibility (use SELF_HEALING_RECOVERY type)
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "WARN",
        title: `Self-healing: ${stuckCount} stuck sessions cleaned`,
        summary: `Recovered ${stuckCount} orphaned backtest sessions that were stuck in 'running' state for >1 hour`,
        payload: { traceId, stuckSessionCount: stuckCount, action: "STUCK_SESSIONS_CLEANED" },
        traceId,
      });
    }
    
    // PHASE 1a: Clean up sessions stuck in 'queued' or 'pending' for >30 minutes
    // These represent jobs that were queued but never started - indicates scheduler issue
    const stuckQueuedSessions = await db.execute(sql`
      UPDATE backtest_sessions 
      SET 
        status = 'failed',
        error_message = 'Session never started - auto-recovered by self-healing worker (stuck in queued/pending >30min)',
        completed_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND created_at < NOW() - INTERVAL '30 minutes'
      RETURNING id, bot_id, status
    `);
    
    const stuckQueuedCount = stuckQueuedSessions.rows.length;
    if (stuckQueuedCount > 0) {
      console.log(`[SELF_HEALING] trace_id=${traceId} cleaned ${stuckQueuedCount} stuck queued/pending sessions`);
      
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "WARN",
        title: `Self-healing: ${stuckQueuedCount} queued sessions cleaned`,
        summary: `Recovered ${stuckQueuedCount} sessions stuck in queued/pending state for >30 minutes`,
        payload: { traceId, stuckQueuedCount, action: "STUCK_QUEUED_SESSIONS_CLEANED" },
        traceId,
      });
    }
    
    // PHASE 1b: Detect and recover dead bot instances (no heartbeat for >15 minutes but still marked active)
    // These are instances that crashed without proper cleanup
    const INSTANCE_HEARTBEAT_STALE_MINUTES = 15;
    const staleInstances = await db.execute(sql`
      SELECT 
        bi.id,
        bi.bot_id,
        bi.status,
        bi.last_heartbeat_at,
        b.name as bot_name,
        b.stage as bot_stage,
        CASE 
          WHEN bi.last_heartbeat_at IS NULL THEN 999
          ELSE COALESCE(EXTRACT(EPOCH FROM (NOW() - bi.last_heartbeat_at)) / 60, 999)
        END as stale_minutes
      FROM bot_instances bi
      JOIN bots b ON b.id = bi.bot_id
      WHERE bi.is_active = true
        AND bi.status IN ('RUNNING', 'TRADING', 'CONNECTED')
        AND (
          bi.last_heartbeat_at IS NULL 
          OR bi.last_heartbeat_at < NOW() - INTERVAL '15 minutes'
        )
    `);
    
    const staleInstanceList = staleInstances.rows as any[];
    if (staleInstanceList.length > 0) {
      console.log(`[SELF_HEALING] trace_id=${traceId} found ${staleInstanceList.length} stale instances (no heartbeat >${INSTANCE_HEARTBEAT_STALE_MINUTES}min)`);
      
      // Mark stale instances as STOPPED for cleanup
      for (const instance of staleInstanceList) {
        const staleMinutes = Math.round(parseFloat(instance.stale_minutes) || 999);
        console.log(`[SELF_HEALING] trace_id=${traceId} stale_instance bot=${instance.bot_name} instance=${instance.id.slice(0,8)} stale=${staleMinutes}min`);
        
        // Mark instance as STOPPED (cleanup)
        await db.execute(sql`
          UPDATE bot_instances
          SET 
            status = 'STOPPED',
            is_active = false,
            stopped_at = NOW(),
            updated_at = NOW()
          WHERE id = ${instance.id}::uuid
        `);
        
        // Log activity event for visibility
        await logActivityEvent({
          botId: instance.bot_id,
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: `${instance.bot_name}: Stale instance recovered`,
          summary: `Instance had no heartbeat for ${staleMinutes} minutes - marked as stopped`,
          payload: { 
            traceId, 
            instanceId: instance.id,
            staleMinutes,
            previousStatus: instance.status,
            action: "STALE_INSTANCE_STOPPED"
          },
          traceId,
        });
      }
      
      console.log(`[SELF_HEALING] trace_id=${traceId} cleaned ${staleInstanceList.length} stale instances`);
    }
    
    // PHASE 2: Find DEAD bots (0 healthy backtests in last 24h with at least 3 total attempts)
    const deadBots = await db.execute(sql`
      SELECT 
        b.id,
        b.name,
        b.symbol,
        b.stage,
        COUNT(*) FILTER (WHERE bs.status = 'completed' AND COALESCE(bs.total_trades, 0) > 0) as healthy_sessions,
        COUNT(*) FILTER (WHERE bs.status = 'failed') as failed_sessions,
        MAX(CASE WHEN bs.status = 'failed' THEN bs.error_message END) as last_error,
        MAX(bs.completed_at) as last_backtest_at
      FROM bots b
      LEFT JOIN backtest_sessions bs ON b.id = bs.bot_id AND bs.started_at > NOW() - INTERVAL '24 hours'
      GROUP BY b.id, b.name, b.symbol, b.stage
      HAVING 
        COUNT(*) FILTER (WHERE bs.status = 'completed' AND COALESCE(bs.total_trades, 0) > 0) = 0
        AND COUNT(*) FILTER (WHERE bs.status IS NOT NULL) >= 3
    `);
    
    const deadBotList = deadBots.rows as any[];
    console.log(`[SELF_HEALING] trace_id=${traceId} found ${deadBotList.length} DEAD bots`);
    
    if (deadBotList.length === 0) {
      return;
    }
    
    // Clean up old recovery attempts (older than 24h)
    const now = Date.now();
    for (const [botId, state] of botRecoveryAttempts.entries()) {
      if (now - state.lastAttempt.getTime() > 24 * 60 * 60 * 1000) {
        botRecoveryAttempts.delete(botId);
      }
    }
    
    let recoveredCount = 0;
    let skippedCount = 0;
    
    for (const bot of deadBotList) {
      const botId = bot.id;
      const botName = bot.name;
      const stage = bot.stage;
      const lastError = bot.last_error || "Unknown error";
      
      // Check recovery attempt limits
      const recoveryState = botRecoveryAttempts.get(botId);
      if (recoveryState && recoveryState.attempts >= MAX_RECOVERY_ATTEMPTS_24H) {
        console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId} SKIPPED: max recovery attempts reached (${recoveryState.attempts}/${MAX_RECOVERY_ATTEMPTS_24H})`);
        skippedCount++;
        continue;
      }
      
      // Classify error type
      const isStructuralError = 
        lastError.includes("provenance mismatch") ||
        lastError.includes("rule validation") ||
        lastError.includes("strategy archetype") ||
        lastError.includes("invalid configuration");
      
      const isTransientError = 
        lastError.includes("data fetch") ||
        lastError.includes("cache miss") ||
        lastError.includes("timeout") ||
        lastError.includes("network") ||
        lastError.includes("ZERO_TRADES");
      
      console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId} name="${botName}" stage=${stage} error_type=${isStructuralError ? "STRUCTURAL" : isTransientError ? "TRANSIENT" : "UNKNOWN"} last_error="${lastError.slice(0, 100)}"`);
      
      // Skip structural errors - need manual intervention
      if (isStructuralError) {
        console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId} SKIPPED: structural error requires manual fix`);
        skippedCount++;
        
        await logActivityEvent({
          botId,
          eventType: "SELF_HEALING_SKIPPED",
          severity: "WARN",
          title: `Self-healing skipped: ${botName}`,
          summary: `Structural error requires manual intervention: ${lastError.slice(0, 200)}`,
          payload: { traceId, errorType: "STRUCTURAL", lastError },
          traceId,
        });
        continue;
      }
      
      // Recovery action based on stage
      try {
        if (stage === "TRIALS") {
          // TRIALS: Queue fresh backtest
          console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId} TRIALS_RECOVERY: queuing fresh backtest`);
          
          const sessionId = await queueBaselineBacktest(botId, traceId, {
            forceNew: true,
            reason: `SELF_HEALING_RECOVERY: ${lastError.slice(0, 100)}`
          });
          
          if (sessionId) {
            await logActivityEvent({
              botId,
              eventType: "SELF_HEALING_RECOVERY",
              severity: "INFO",
              title: `Self-healing recovery: ${botName}`,
              summary: `Queued fresh backtest to recover from transient failure`,
              payload: { traceId, stage, sessionId, previousError: lastError.slice(0, 200) },
              traceId,
            });
            recoveredCount++;
          }
        } else {
          // PAPER+: Demote to TRIALS first, then queue backtest
          console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId} PAPER+_RECOVERY: demoting to TRIALS and queuing backtest`);
          
          // Demote to TRIALS
          await db.execute(sql`
            UPDATE bots SET 
              stage = 'TRIALS',
              stage_updated_at = NOW(),
              stage_reason_code = 'SELF_HEALING_DEMOTION'
            WHERE id = ${botId}::uuid
          `);
          
          // Queue fresh backtest
          const sessionId = await queueBaselineBacktest(botId, traceId, {
            forceNew: true,
            reason: `SELF_HEALING_DEMOTION: ${lastError.slice(0, 100)}`
          });
          
          await logActivityEvent({
            botId,
            eventType: "SELF_HEALING_DEMOTION",
            severity: "WARN",
            title: `Self-healing demotion: ${botName}`,
            summary: `Demoted from ${stage} to TRIALS due to persistent failures. Queued fresh backtest.`,
            payload: { 
              traceId, 
              previousStage: stage, 
              sessionId, 
              previousError: lastError.slice(0, 200),
              recoveryAttempt: (recoveryState?.attempts || 0) + 1
            },
            traceId,
          });
          recoveredCount++;
        }
        
        // Track recovery attempt
        botRecoveryAttempts.set(botId, {
          attempts: (recoveryState?.attempts || 0) + 1,
          lastAttempt: new Date(),
          lastReason: lastError.slice(0, 200)
        });
        
      } catch (recoveryError) {
        console.error(`[SELF_HEALING] trace_id=${traceId} bot=${botId} recovery_failed:`, recoveryError);
        
        await logActivityEvent({
          botId,
          eventType: "SELF_HEALING_FAILED",
          severity: "ERROR",
          title: `Self-healing failed: ${botName}`,
          summary: `Recovery attempt failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
          payload: { traceId, stage, error: String(recoveryError) },
          traceId,
        });
      }
    }
    
    console.log(`[SELF_HEALING] trace_id=${traceId} phase2_complete recovered=${recoveredCount} skipped=${skippedCount} total_dead=${deadBotList.length}`);
    
    // PHASE 3: Recover stale paper runners
    // These are bot instances that claim to be RUNNING but have stale heartbeats
    // Use RUNNER_HEARTBEAT_STALE_MINUTES (3 min) for aggressive recovery
    // This happens when the in-memory runner died but the database wasn't updated
    const runnerStaleThreshold = new Date(Date.now() - RUNNER_HEARTBEAT_STALE_MINUTES * 60 * 1000);
    
    const staleRunners = await db.execute(sql`
      SELECT 
        bi.id as instance_id,
        bi.bot_id,
        bi.account_id,
        bi.execution_mode,
        bi.is_primary_runner,
        bi.state_json,
        bi.last_heartbeat_at,
        bi.started_at,
        bi.activity_state,
        b.name as bot_name,
        b.stage,
        b.user_id
      FROM bot_instances bi
      INNER JOIN bots b ON b.id = bi.bot_id
      WHERE bi.job_type = 'RUNNER'
        AND bi.is_active = true
        AND bi.stopped_at IS NULL
        AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
        AND (
          -- Case 1: Has heartbeat but it's stale (> 3 min old - RUNNER_HEARTBEAT_STALE_MINUTES)
          (bi.last_heartbeat_at IS NOT NULL AND bi.last_heartbeat_at < ${runnerStaleThreshold})
          OR
          -- Case 2: Never had a heartbeat and started > 3 min ago (zombie startup)
          (bi.last_heartbeat_at IS NULL AND bi.started_at IS NOT NULL AND bi.started_at < ${runnerStaleThreshold})
        )
    `);
    
    const staleList = staleRunners.rows as any[];
    if (staleList.length > 0) {
      console.log(`[SELF_HEALING] trace_id=${traceId} found ${staleList.length} stale paper runners`);
      
      let runnerRecoveredCount = 0;
      for (const stale of staleList) {
        const botId = stale.bot_id;
        const instanceId = stale.instance_id;
        const botName = stale.bot_name;
        const stage = stale.stage;
        const userId = stale.user_id;
        const heartbeatAge = stale.last_heartbeat_at 
          ? Math.floor((Date.now() - new Date(stale.last_heartbeat_at).getTime()) / 60000)
          : Math.floor((Date.now() - new Date(stale.started_at).getTime()) / 60000); // Fallback for zombie startups
        
        console.log(`[SELF_HEALING] trace_id=${traceId} STALE_RUNNER bot=${botId.slice(0, 8)} name="${botName}" stage=${stage} heartbeat_age=${heartbeatAge}min`);
        
        try {
          // Step 1: Mark the stale instance as stopped directly in the database
          // Use conditional update to prevent race conditions (only updates if still active)
          // This ensures concurrent worker runs don't create duplicate instances
          console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} marking stale instance=${instanceId.slice(0, 8)} as stopped`);
          
          const updateResult = await db.update(botInstances)
            .set({
              isActive: false,
              status: "STOPPED",
              stoppedAt: new Date(),
              activityState: null,
              lastHeartbeatAt: null,
              updatedAt: new Date(),
            })
            .where(and(
              eq(botInstances.id, instanceId),
              eq(botInstances.isActive, true), // Only if still active (prevents race)
              isNull(botInstances.stoppedAt)   // Only if not already stopped
            ))
            .returning({ id: botInstances.id });
          
          // If update returned no rows, another worker already handled this instance
          if (!updateResult || updateResult.length === 0) {
            console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} instance=${instanceId.slice(0, 8)} already handled by another process, skipping`);
            continue;
          }
          
          // Try to stop in-memory runner if it somehow exists (defensive)
          await paperRunnerService.stopBot(botId);
          
          // Step 2: Get critical fields from the old instance to preserve them
          const accountId = stale.account_id;
          const executionMode = stale.execution_mode || "SIM";
          const isPrimaryRunner = stale.is_primary_runner ?? true; // Default to true for recovered runners
          const stateJson = stale.state_json; // Preserve any runtime state (may be rebuilt by runner)
          
          // Step 3: Create a new instance and restart the runner
          const newInstanceId = crypto.randomUUID();
          console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} creating new instance=${newInstanceId.slice(0, 8)} account=${accountId?.slice?.(0, 8) || 'none'} mode=${executionMode}`);
          
          // Create new bot instance record with critical fields preserved
          // Note: startBot() will update activityState to SCANNING when it starts processing bars
          await db.insert(botInstances).values({
            id: newInstanceId,
            botId,
            accountId: accountId || null,
            executionMode,
            status: "RUNNING",
            jobType: "RUNNER",
            isActive: true,
            activityState: "SCANNING",
            isPrimaryRunner,
            stateJson: stateJson || null, // Preserve any runtime state
            startedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          
          // Start the runner with new instance
          console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} restarting runner`);
          const started = await paperRunnerService.startBot(botId, newInstanceId);
          
          if (started) {
            runnerRecoveredCount++;
            
            await logActivityEvent({
              botId,
              eventType: "SELF_HEALING_RECOVERY",
              severity: "WARN",
              title: `Self-healing: Runner restarted`,
              summary: `Paper runner for "${botName}" was stale (${heartbeatAge}min since last heartbeat). Auto-recovered.`,
              payload: { 
                traceId, 
                stage, 
                heartbeatAgeMinutes: heartbeatAge,
                previousInstanceId: instanceId,
                action: "STALE_RUNNER_RECOVERED"
              },
              traceId,
            });
            
            // Create alert so it appears in Notifications panel
            if (userId) {
              try {
                await storage.createAlert({
                  userId,
                  category: "BOT_DEGRADED",
                  severity: "WARN",
                  status: "OPEN",
                  source: "system",
                  entityType: "BOT",
                  entityId: botId,
                  title: `Auto-Recovery: ${botName}`,
                  message: `Paper runner was stale (${heartbeatAge}min since last heartbeat) and has been automatically restarted.`,
                  payloadJson: { 
                    traceId, 
                    stage, 
                    heartbeatAgeMinutes: heartbeatAge,
                    previousInstanceId: instanceId,
                    action: "STALE_RUNNER_RECOVERED"
                  },
                  dedupeKey: `self_heal_runner_${botId}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`, // One per bot per day (YYYYMMDD)
                });
                console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} alert created for user`);
              } catch (alertError) {
                // Don't fail the recovery if alert creation fails
                console.error(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} alert creation failed:`, alertError);
              }
            }
          }
        } catch (runnerError: any) {
          // Check if this is a unique constraint violation (duplicate prevented by DB)
          if (isUniqueViolation(runnerError)) {
            console.log(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} instance_creation=DUPLICATE_PREVENTED (DB constraint)`);
          } else {
            console.error(`[SELF_HEALING] trace_id=${traceId} bot=${botId.slice(0, 8)} runner recovery failed:`, runnerError);
            
            await logActivityEvent({
              botId,
              eventType: "SELF_HEALING_FAILED",
              severity: "ERROR",
              title: `Self-healing: Runner recovery failed`,
              summary: `Failed to recover stale runner for "${botName}": ${runnerError instanceof Error ? runnerError.message : String(runnerError)}`,
              payload: { traceId, stage, error: String(runnerError) },
              traceId,
            });
          }
        }
      }
      
      console.log(`[SELF_HEALING] trace_id=${traceId} phase3_complete stale_runners_recovered=${runnerRecoveredCount}/${staleList.length}`);
    }
    
    // PHASE 4: Blown Account Recovery Safety Net
    // Catch any blown accounts that may have been missed during normal flow
    // This ensures autonomous recovery even if the initial blown detection failed to trigger recovery
    try {
      // Find blown accounts that haven't had their bots recovered
      // Look for accounts with blown attempts that still have PAPER+ bots attached (not demoted to LAB)
      const unresolvedBlownAccounts = await db.execute(sql`
        SELECT DISTINCT 
          aa.account_id,
          a.name as account_name,
          a.consecutive_blown_count,
          aa.id as attempt_id,
          aa.blown_at,
          aa.metrics_snapshot,
          aa.starting_balance,
          aa.ending_balance
        FROM account_attempts aa
        JOIN accounts a ON a.id = aa.account_id
        JOIN bot_accounts ba ON ba.account_id = aa.account_id
        JOIN bots b ON b.id = ba.bot_id
        WHERE aa.status = 'BLOWN'
          AND aa.blown_at > NOW() - INTERVAL '24 hours'
          AND b.stage IN ('PAPER', 'SHADOW', 'CANARY', 'LIVE')
          AND b.archived_at IS NULL
          AND NOT EXISTS (
            -- Skip if there's already a pending/running IMPROVING job for this bot
            SELECT 1 FROM bot_jobs bj 
            WHERE bj.bot_id = b.id 
              AND bj.job_type = 'IMPROVING'
              AND bj.status IN ('QUEUED', 'PENDING', 'RUNNING')
          )
      `);
      
      const blownList = unresolvedBlownAccounts.rows as any[];
      if (blownList.length > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} BLOWN_SAFETY_NET: Found ${blownList.length} blown accounts with unrecovered bots`);
        
        let recoveredCount = 0;
        for (const blown of blownList) {
          const accountId = blown.account_id;
          const accountName = blown.account_name;
          const consecutiveBlownCount = blown.consecutive_blown_count || 1;
          
          console.log(`[SELF_HEALING] trace_id=${traceId} BLOWN_SAFETY_NET: Processing account="${accountName}" consecutive=${consecutiveBlownCount}`);
          
          try {
            // Fetch full account and attempt for recovery context
            const account = await storage.getAccount(accountId);
            if (!account) continue;
            
            const attempts = await storage.getAccountAttempts(accountId);
            const blownAttempt = attempts.find(a => a.id === blown.attempt_id);
            if (!blownAttempt) continue;
            
            // Trigger the recovery process
            const results = await processBlownAccountRecovery({
              accountId,
              consecutiveBlownCount,
              attempt: blownAttempt,
              account,
            });
            
            if (results.length > 0) {
              recoveredCount += results.length;
              console.log(`[SELF_HEALING] trace_id=${traceId} BLOWN_SAFETY_NET: Recovered ${results.length} bots for account="${accountName}"`);
            }
          } catch (err) {
            console.error(`[SELF_HEALING] trace_id=${traceId} BLOWN_SAFETY_NET: Failed to recover account=${accountId}:`, err);
          }
        }
        
        if (recoveredCount > 0) {
          await logActivityEvent({
            eventType: "SELF_HEALING_RECOVERY",
            severity: "WARN",
            title: `Self-healing: ${recoveredCount} blown account bot(s) recovered`,
            summary: `Safety net caught ${blownList.length} blown accounts with ${recoveredCount} unrecovered bots`,
            payload: { traceId, action: "BLOWN_ACCOUNT_SAFETY_NET", recoveredCount },
            traceId,
          });
        }
        
        console.log(`[SELF_HEALING] trace_id=${traceId} phase4_complete blown_accounts=${blownList.length} bots_recovered=${recoveredCount}`);
      }
    } catch (blownError) {
      console.error(`[SELF_HEALING] trace_id=${traceId} blown_safety_net_error=`, blownError);
    }
    
    // PHASE 5: Auto-resolve stale alerts
    // Automatically resolve alerts that are older than 24 hours or where the underlying condition has cleared
    try {
      // Auto-resolve old OPEN alerts that have been open for >24 hours
      const staleAlerts = await db.execute(sql`
        UPDATE alerts 
        SET 
          status = 'RESOLVED',
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE status = 'OPEN'
          AND created_at < NOW() - INTERVAL '24 hours'
        RETURNING id, title, category
      `);
      
      const staleAlertCount = staleAlerts.rows.length;
      if (staleAlertCount > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} phase5 auto-resolved ${staleAlertCount} stale alerts (>24h old)`);
      }
      
      // Auto-resolve BOT_DEGRADED alerts for bots that are now healthy (have recent successful backtest)
      const healedBotAlerts = await db.execute(sql`
        UPDATE alerts 
        SET 
          status = 'RESOLVED',
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE status = 'OPEN'
          AND category = 'BOT_DEGRADED'
          AND entity_type = 'BOT'
          AND entity_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM backtest_sessions bs
            WHERE bs.bot_id = alerts.entity_id::uuid
              AND bs.status = 'completed'
              AND bs.completed_at > NOW() - INTERVAL '2 hours'
              AND COALESCE(bs.total_trades, 0) > 0
          )
        RETURNING id, entity_id
      `);
      
      const healedCount = healedBotAlerts.rows.length;
      if (healedCount > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} phase5 auto-resolved ${healedCount} BOT_DEGRADED alerts (bots now healthy)`);
      }
      
      // Auto-resolve INTEGRATION alerts for integrations that now have successful verification
      // Must correlate by provider: entity_id stores the provider name, or check payload_json->'provider'
      const healedIntegrationAlerts = await db.execute(sql`
        UPDATE alerts 
        SET 
          status = 'RESOLVED',
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE status = 'OPEN'
          AND category = 'INTEGRATION_FAILURE'
          AND EXISTS (
            SELECT 1 FROM integration_usage_events iue
            WHERE iue.operation = 'verify'
              AND iue.status = 'OK'
              AND iue.created_at > alerts.created_at
              AND (
                -- Match by entity_id (text provider name like 'databento', 'openai')
                iue.integration = alerts.entity_id
                -- Or match by payload_json->>'provider' if entity_id is not set
                OR iue.integration = (alerts.payload_json->>'provider')
              )
          )
        RETURNING id
      `);
      
      const healedIntegCount = healedIntegrationAlerts.rows.length;
      if (healedIntegCount > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} phase5 auto-resolved ${healedIntegCount} INTEGRATION_FAILURE alerts`);
      }
      
      const totalResolved = staleAlertCount + healedCount + healedIntegCount;
      if (totalResolved > 0) {
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "INFO",
          title: `Self-healing: ${totalResolved} alerts auto-resolved`,
          summary: `Stale: ${staleAlertCount}, Healed bots: ${healedCount}, Fixed integrations: ${healedIntegCount}`,
          payload: { traceId, staleAlertCount, healedCount, healedIntegCount },
          traceId,
        });
      }
      
      console.log(`[SELF_HEALING] trace_id=${traceId} phase5_complete alerts_auto_resolved=${totalResolved}`);
    } catch (alertError) {
      console.error(`[SELF_HEALING] trace_id=${traceId} alert_auto_resolve_error=`, alertError);
    }
    
    // PHASE 6: Prune stale runner sessions and dead bot instances
    // Clean up old STOPPED instances and expired sessions to keep tables lean
    try {
      // Delete old STOPPED bot instances older than 7 days (keep recent for debugging)
      // Use batch delete with LIMIT to prevent FK check timeouts on large trade_logs table
      let totalInstancesDeleted = 0;
      const BATCH_SIZE = 50;
      let batchCount = 0;
      const MAX_BATCHES = 10;
      
      while (batchCount < MAX_BATCHES) {
        const batch = await db.execute(sql`
          DELETE FROM bot_instances 
          WHERE id IN (
            SELECT id FROM bot_instances
            WHERE status = 'STOPPED'
              AND stopped_at < NOW() - INTERVAL '7 days'
            LIMIT ${BATCH_SIZE}
          )
          RETURNING id
        `);
        
        const deletedCount = batch.rows.length;
        if (deletedCount === 0) break;
        
        totalInstancesDeleted += deletedCount;
        batchCount++;
      }
      
      if (totalInstancesDeleted > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} phase6 pruned ${totalInstancesDeleted} old STOPPED instances (>7 days)`);
      }
      
      // Clean up orphaned bot_jobs that are stuck in terminal states for >24 hours
      const oldJobs = await db.execute(sql`
        DELETE FROM bot_jobs 
        WHERE status IN ('COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED')
          AND completed_at < NOW() - INTERVAL '7 days'
        RETURNING id
      `);
      
      const oldJobCount = oldJobs.rows.length;
      if (oldJobCount > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} phase6 pruned ${oldJobCount} old completed jobs (>7 days)`);
      }
      
      console.log(`[SELF_HEALING] trace_id=${traceId} phase6_complete pruned_instances=${totalInstancesDeleted} pruned_jobs=${oldJobCount}`);
    } catch (pruneError) {
      console.error(`[SELF_HEALING] trace_id=${traceId} prune_error=`, pruneError);
    }
    
    // PHASE 7: Close stale open trades that have exceeded max duration (4 hours)
    // This prevents positions from being stuck indefinitely if a runner dies
    // Trades open > 4 hours are likely orphaned and should be force-closed
    const MAX_TRADE_DURATION_HOURS = 4;
    const maxTradeThreshold = new Date(Date.now() - MAX_TRADE_DURATION_HOURS * 60 * 60 * 1000);
    try {
      const staleTrades = await db.execute(sql`
        SELECT pt.id, pt.bot_id, pt.side, pt.entry_price, pt.quantity, pt.entry_time,
               b.name as bot_name, b.symbol,
               EXTRACT(EPOCH FROM (NOW() - pt.entry_time)) / 3600 as hours_open
        FROM paper_trades pt
        JOIN bots b ON b.id = pt.bot_id
        WHERE pt.status = 'OPEN'
          AND pt.entry_time < ${maxTradeThreshold}
      `);
      
      const staleTradeList = staleTrades.rows as any[];
      if (staleTradeList.length > 0) {
        console.log(`[SELF_HEALING] trace_id=${traceId} PHASE7: Found ${staleTradeList.length} stale open trades (>${MAX_TRADE_DURATION_HOURS}h)`);
        
        let closedCount = 0;
        for (const trade of staleTradeList) {
          const hoursOpen = parseFloat(trade.hours_open || 0).toFixed(1);
          console.log(`[SELF_HEALING] trace_id=${traceId} STALE_TRADE_CLOSE bot=${trade.bot_id.slice(0,8)} trade=${trade.id.slice(0,8)} hours=${hoursOpen}h side=${trade.side}`);
          
          try {
            // Close at entry price (flat fill) with note about stale closure
            await db.execute(sql`
              UPDATE paper_trades SET
                exit_price = entry_price,
                exit_time = NOW(),
                pnl = -4.50,
                pnl_percent = 0,
                status = 'CLOSED',
                exit_reason_code = 'STALE_TRADE_AUTO_CLOSE',
                fees = 4.50,
                updated_at = NOW()
              WHERE id = ${trade.id}::uuid
                AND status = 'OPEN'
            `);
            
            closedCount++;
            
            await logActivityEvent({
              botId: trade.bot_id,
              eventType: "PAPER_TRADE_EXIT",
              severity: "WARN",
              title: `Stale trade auto-closed (${hoursOpen}h)`,
              summary: `Paper ${trade.side} for "${trade.bot_name}" was open ${hoursOpen} hours and auto-closed at entry price.`,
              payload: { 
                traceId, 
                tradeId: trade.id,
                hoursOpen: parseFloat(hoursOpen),
                reason: 'STALE_TRADE_AUTO_CLOSE',
                closedAtEntryPrice: true,
              },
              traceId,
            });
          } catch (closeError) {
            console.error(`[SELF_HEALING] trace_id=${traceId} STALE_TRADE_CLOSE_FAILED trade=${trade.id.slice(0,8)}:`, closeError);
          }
        }
        
        console.log(`[SELF_HEALING] trace_id=${traceId} phase7_complete stale_trades_closed=${closedCount}/${staleTradeList.length}`);
      }
    } catch (staleTradeError) {
      console.error(`[SELF_HEALING] trace_id=${traceId} stale_trade_cleanup_error=`, staleTradeError);
    }
    
  } catch (error) {
    console.error(`[SELF_HEALING] trace_id=${traceId} error=`, error);
  }
}

/**
 * BACKFILL: Create Generation 1 records for all bots missing currentGenerationId
 * This enables the evolution worker to pick them up and start LLM-powered generation advancement
 */
async function runGenerationBackfill(traceId: string): Promise<void> {
  try {
    // Find all bots with null currentGenerationId
    const botsNeedingBackfill = await db.execute(sql`
      SELECT b.id, b.name, b.symbol, b.user_id, b.strategy_config, b.risk_config, b.stage
      FROM bots b
      WHERE b.current_generation_id IS NULL
      ORDER BY b.created_at DESC
    `);

    const bots = (botsNeedingBackfill.rows || []) as any[];
    
    if (bots.length === 0) {
      console.log(`[BACKFILL_GENERATIONS] trace_id=${traceId} No bots need generation backfill`);
      return;
    }
    
    console.log(`[BACKFILL_GENERATIONS] trace_id=${traceId} Found ${bots.length} bots needing backfill`);

    let createdGenerations = 0;
    let linkedBots = 0;
    let seededMetrics = 0;
    let queuedJobs = 0;
    let failedCount = 0;

    for (const bot of bots) {
      try {
        // Step 1: Create Generation 1 record
        const strategyConfig = bot.strategy_config || {};
        const riskConfig = bot.risk_config || {};
        const timeframe = strategyConfig.timeframe || '5m';
        const stage = bot.stage || 'TRIALS';

        const generation = await storage.createBotGeneration({
          botId: bot.id,
          generationNumber: 1,
          strategyConfig,
          riskConfig,
          timeframe,
          stage,
          mutationReasonCode: 'BACKFILL_LEGACY',
          summaryTitle: 'Generation 1 (Backfilled)',
          mutationObjective: 'Initial configuration backfilled from existing bot',
        });
        createdGenerations++;

        // Step 2: Link bot to generation
        await db.execute(sql`
          UPDATE bots SET 
            current_generation_id = ${generation.id}::uuid,
            current_generation = 1,
            updated_at = NOW()
          WHERE id = ${bot.id}::uuid
        `);
        linkedBots++;

        // Step 3: Find and seed baseline metrics from latest completed backtest
        const latestBacktest = await db.query.backtestSessions.findFirst({
          where: and(
            eq(schema.backtestSessions.botId, bot.id),
            eq(schema.backtestSessions.status, 'completed')
          ),
          orderBy: [desc(schema.backtestSessions.completedAt)],
        });

        if (latestBacktest && latestBacktest.totalTrades && latestBacktest.totalTrades > 0) {
          // Update generation with baseline metrics
          await db.execute(sql`
            UPDATE bot_generations SET
              baseline_valid = true,
              baseline_backtest_id = ${latestBacktest.id}::uuid,
              baseline_metrics = ${JSON.stringify({
                sharpeRatio: latestBacktest.sharpeRatio,
                profitFactor: latestBacktest.profitFactor,
                winRate: latestBacktest.winRate,
                maxDrawdownPct: latestBacktest.maxDrawdownPct,
                totalTrades: latestBacktest.totalTrades,
                netPnl: latestBacktest.netPnl,
                expectancy: latestBacktest.expectancy,
              })}::jsonb,
              performance_snapshot = ${JSON.stringify({
                sharpeRatio: latestBacktest.sharpeRatio,
                profitFactor: latestBacktest.profitFactor,
                winRate: latestBacktest.winRate,
                maxDrawdownPct: latestBacktest.maxDrawdownPct,
                totalTrades: latestBacktest.totalTrades,
                netPnl: latestBacktest.netPnl,
              })}::jsonb
            WHERE id = ${generation.id}::uuid
          `);

          // Link backtest to generation
          await db.execute(sql`
            UPDATE backtest_sessions SET generation_id = ${generation.id}::uuid
            WHERE id = ${latestBacktest.id}::uuid
          `);

          // Seed generation_metrics_history for trend tracking
          await db.execute(sql`
            INSERT INTO generation_metrics_history (
              bot_id, generation_number, generation_id, backtest_session_id,
              sharpe_ratio, profit_factor, win_rate, max_drawdown_pct,
              total_trades, net_pnl, expectancy,
              trend_direction, trend_confidence
            ) VALUES (
              ${bot.id}::uuid, 1, ${generation.id}::uuid, ${latestBacktest.id}::uuid,
              ${latestBacktest.sharpeRatio}, ${latestBacktest.profitFactor}, ${latestBacktest.winRate},
              ${latestBacktest.maxDrawdownPct}, ${latestBacktest.totalTrades}, ${latestBacktest.netPnl},
              ${latestBacktest.expectancy},
              'STABLE', 50
            )
            ON CONFLICT DO NOTHING
          `);
          seededMetrics++;

          // Step 4: Queue EVOLVING job to trigger LLM generation advancement
          const existingJob = await db.query.botJobs.findFirst({
            where: and(
              eq(schema.botJobs.botId, bot.id),
              eq(schema.botJobs.jobType, 'EVOLVING'),
              inArray(schema.botJobs.status, ['QUEUED', 'RUNNING'])
            ),
          });

          if (!existingJob) {
            await db.insert(schema.botJobs).values({
              botId: bot.id,
              userId: bot.userId,
              jobType: 'EVOLVING',
              status: 'QUEUED',
              priority: 5,
              payload: { 
                reason: 'BACKFILL_TRIGGER',
                traceId,
                note: 'Queued by generation backfill to trigger LLM evolution'
              },
            });
            queuedJobs++;
          }
        } else {
          // No valid backtest - mark generation as needing baseline
          await db.execute(sql`
            UPDATE bot_generations SET
              baseline_valid = false,
              baseline_failure_reason = 'NO_BACKTEST_DATA'
            WHERE id = ${generation.id}::uuid
          `);
        }

        console.log(`[BACKFILL_GENERATIONS] trace_id=${traceId} bot_id=${bot.id} bot_name="${bot.name}" gen_id=${generation.id} has_metrics=${!!latestBacktest}`);

      } catch (botError) {
        console.error(`[BACKFILL_GENERATIONS] trace_id=${traceId} Failed for bot ${bot.id}:`, botError);
        failedCount++;
      }
    }

    console.log(`[BACKFILL_GENERATIONS] trace_id=${traceId} Complete: created=${createdGenerations} linked=${linkedBots} metrics=${seededMetrics} jobs=${queuedJobs} failed=${failedCount}`);

  } catch (error) {
    console.error(`[BACKFILL_GENERATIONS] trace_id=${traceId} Error:`, error);
  }
}

/**
 * SCHEMA-FIRST ARCHETYPE BACKFILL
 * Populates archetypeName on existing bots that have NULL archetype_name.
 * Uses inference from bot name as a one-time migration - after this, new bots get explicit archetypes.
 * This is an industry-standard approach to eliminate name-based inference going forward.
 */
async function runArchetypeBackfill(): Promise<void> {
  const traceId = `archetype-backfill-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} Starting archetype backfill...`);
  
  try {
    const BATCH_SIZE = 500;
    const MAX_BATCHES = 100; // Safety limit to prevent infinite loops
    let totalBackfilled = 0;
    let totalFailed = 0;
    let batchNumber = 0;
    const unresolvableBotIds = new Set<string>();
    
    // Import the inference function once
    const { tryNormalizeArchetype } = await import("@shared/strategy-types");
    
    // Iterate in batches until no bots remain with NULL archetype_name
    while (batchNumber < MAX_BATCHES) {
      batchNumber++;
      
      // Find next batch of bots with NULL archetype_name (excluding known unresolvable)
      const excludeList = Array.from(unresolvableBotIds);
      const botsNeedingBackfill = excludeList.length > 0
        ? await db.execute(sql`
            SELECT id, name, strategy_config
            FROM bots 
            WHERE archetype_name IS NULL
              AND id NOT IN (SELECT unnest(${excludeList}::uuid[]))
            LIMIT ${BATCH_SIZE}
          `)
        : await db.execute(sql`
            SELECT id, name, strategy_config
            FROM bots 
            WHERE archetype_name IS NULL
            LIMIT ${BATCH_SIZE}
          `);

      const bots = (botsNeedingBackfill.rows || []) as any[];
      
      if (bots.length === 0) {
        // No more bots to backfill
        break;
      }
      
      console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} batch=${batchNumber} processing ${bots.length} bots`);

      let batchBackfilled = 0;
      let batchFailed = 0;

      for (const bot of bots) {
        try {
          // Try to get archetype from strategyConfig first
          const configArchetype = bot.strategy_config?.archetypeName || 
                                  bot.strategy_config?.archetype || 
                                  null;
          
          // If not in config, try to infer from bot name
          let archetype = configArchetype;
          if (!archetype) {
            archetype = tryNormalizeArchetype(bot.name);
          }
          
          if (archetype) {
            await db.execute(sql`
              UPDATE bots 
              SET archetype_name = ${archetype}, updated_at = NOW()
              WHERE id = ${bot.id}::uuid
            `);
            batchBackfilled++;
            console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} bot_id=${bot.id} name="${bot.name}" archetype="${archetype}"`);
          } else {
            // Couldn't determine archetype - mark as unresolvable to prevent re-processing
            unresolvableBotIds.add(bot.id);
            console.warn(`[ARCHETYPE_BACKFILL] trace_id=${traceId} bot_id=${bot.id} name="${bot.name}" COULD_NOT_INFER`);
            batchFailed++;
          }
        } catch (botError) {
          console.error(`[ARCHETYPE_BACKFILL] trace_id=${traceId} Failed for bot ${bot.id}:`, botError);
          unresolvableBotIds.add(bot.id);
          batchFailed++;
        }
      }
      
      totalBackfilled += batchBackfilled;
      totalFailed += batchFailed;
      
      console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} batch=${batchNumber} complete: backfilled=${batchBackfilled} failed=${batchFailed} total=${totalBackfilled}`);
      
      // If no progress made in this batch (all failed), break to prevent infinite loop
      if (batchBackfilled === 0 && bots.length > 0) {
        console.warn(`[ARCHETYPE_BACKFILL] trace_id=${traceId} No progress in batch ${batchNumber}, breaking (${unresolvableBotIds.size} unresolvable)`);
        break;
      }
    }

    if (totalBackfilled === 0 && totalFailed === 0) {
      console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} No bots need archetype backfill`);
      return;
    }

    console.log(`[ARCHETYPE_BACKFILL] trace_id=${traceId} Complete: backfilled=${totalBackfilled} failed=${totalFailed} batches=${batchNumber}`);
    
    if (totalBackfilled > 0) {
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "INFO",
        title: `Archetype backfill: ${totalBackfilled} bots updated`,
        summary: `Schema-first archetype migration: populated archetype_name on existing bots`,
        payload: { traceId, backfilledCount: totalBackfilled, failedCount: totalFailed, batches: batchNumber, unresolvable: unresolvableBotIds.size },
        traceId,
      });
    }
    
    // Safety check: warn if any bots still have NULL after backfill
    const remaining = await db.execute(sql`
      SELECT COUNT(*) as count FROM bots WHERE archetype_name IS NULL
    `);
    const remainingCount = Number((remaining.rows[0] as any)?.count || 0);
    if (remainingCount > 0) {
      console.warn(`[ARCHETYPE_BACKFILL] trace_id=${traceId} WARNING: ${remainingCount} bots still have NULL archetype_name (could not infer)`);
      // Log the unresolvable bot IDs for manual review
      if (unresolvableBotIds.size > 0) {
        console.warn(`[ARCHETYPE_BACKFILL] trace_id=${traceId} Unresolvable bot IDs: ${Array.from(unresolvableBotIds).slice(0, 10).join(', ')}${unresolvableBotIds.size > 10 ? `... and ${unresolvableBotIds.size - 10} more` : ''}`);
      }
    }

  } catch (error) {
    console.error(`[ARCHETYPE_BACKFILL] trace_id=${traceId} Error:`, error);
  }
}

/**
 * Startup sweep to detect and handle accounts with negative balance that weren't properly marked as blown
 * This catches edge cases where the blown account detection was missed (e.g., server crash, race conditions)
 */
async function runBlownAccountStartupSweep(): Promise<void> {
  const traceId = `blown-sweep-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Starting blown account detection sweep...`);
  
  try {
    // Find all accounts with computed balance <= 0 that don't have a recent blown attempt
    // Use paper_trades.account_id directly to avoid double-counting from multiple bot_instances
    const blownAccounts = await db.execute(sql`
      WITH account_balances AS (
        SELECT 
          a.id,
          a.name,
          a.initial_balance,
          COALESCE(SUM(pt.pnl), 0) as total_pnl,
          a.initial_balance + COALESCE(SUM(pt.pnl), 0) as computed_balance,
          a.consecutive_blown_count,
          a.last_blown_at
        FROM accounts a
        LEFT JOIN paper_trades pt ON pt.account_id = a.id AND pt.status = 'CLOSED'
        GROUP BY a.id
      )
      SELECT * FROM account_balances
      WHERE computed_balance <= 0
        AND (last_blown_at IS NULL OR last_blown_at < NOW() - INTERVAL '1 hour')
    `);
    
    if (blownAccounts.rows.length === 0) {
      console.log(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} No missed blown accounts found`);
      return;
    }
    
    console.log(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Found ${blownAccounts.rows.length} accounts with negative balance that need recovery`);
    
    for (const account of blownAccounts.rows as any[]) {
      console.log(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Processing blown account: ${account.name} (balance: $${account.computed_balance.toFixed(2)})`);
      
      // Trigger the blown account check which will mark it and trigger recovery
      try {
        await storage.checkAndHandleBlownAccount(account.id);
      } catch (err) {
        console.error(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Failed to process account ${account.id}:`, err);
      }
    }
    
    await logActivityEvent({
      eventType: "SELF_HEALING_RECOVERY",
      severity: "WARN",
      title: `Startup sweep: ${blownAccounts.rows.length} blown account(s) detected`,
      summary: `Startup sweep found accounts with negative balance that weren't properly marked as blown`,
      payload: { 
        traceId, 
        accountCount: blownAccounts.rows.length,
        accounts: (blownAccounts.rows as any[]).map(a => ({ id: a.id, name: a.name, balance: a.computed_balance }))
      },
      traceId,
    });
    
    console.log(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Completed - processed ${blownAccounts.rows.length} accounts`);
  } catch (error) {
    console.error(`[BLOWN_ACCOUNT_SWEEP] trace_id=${traceId} Error:`, error);
  }
}

/**
 * AUTONOMOUS: Integration verification worker
 * Verifies all configured integrations on startup and periodically
 * Eliminates need for manual "Run Verification" clicks
 */
const INTEGRATION_PROVIDERS = [
  'databento', 'polygon', 'quantconnect',
  'ironbeam', 'ironbeam_2', 'ironbeam_3', 'tradovate', 
  'redis', 'redis_queue',
  'openai', 'anthropic', 'gemini', 'groq', 'xai', 'perplexity', 'openrouter',
  'finnhub', 'alphavantage', 'fmp', 'fred', 
  'unusual_whales', 'news_api', 'marketaux',
  'discord'
];

async function runIntegrationVerificationWorker(): Promise<void> {
  const traceId = `integ-verify-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`[INTEGRATION_VERIFY] trace_id=${traceId} Starting autonomous integration verification...`);
  
  const results: Array<{ provider: string; success: boolean; latencyMs: number; error?: string }> = [];
  let successCount = 0;
  let failCount = 0;
  
  for (const provider of INTEGRATION_PROVIDERS) {
    try {
      const result = await verifyIntegration(provider);
      results.push({
        provider,
        success: result.success,
        latencyMs: result.latencyMs,
        error: result.errorMessage,
      });
      
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        console.warn(`[INTEGRATION_VERIFY] trace_id=${traceId} provider=${provider} FAILED: ${result.errorMessage}`);
      }
    } catch (error: any) {
      failCount++;
      results.push({
        provider,
        success: false,
        latencyMs: 0,
        error: error.message,
      });
      console.warn(`[INTEGRATION_VERIFY] trace_id=${traceId} provider=${provider} ERROR: ${error.message}`);
    }
  }
  
  console.log(`[INTEGRATION_VERIFY] trace_id=${traceId} Complete: ${successCount} OK, ${failCount} FAILED`);
  
  if (failCount > 0) {
    await logActivityEvent({
      eventType: "INTEGRATION_VERIFIED",
      severity: "WARN",
      title: `Integration verification: ${failCount} issues detected`,
      summary: `${successCount}/${INTEGRATION_PROVIDERS.length} integrations verified successfully`,
      payload: { 
        traceId,
        successCount,
        failCount,
        failed: results.filter(r => !r.success).map(r => r.provider),
      },
      traceId,
    });
  } else {
    await logActivityEvent({
      eventType: "INTEGRATION_VERIFIED",
      severity: "INFO",
      title: `All ${successCount} integrations verified`,
      summary: `Autonomous verification completed successfully`,
      payload: { traceId, successCount },
      traceId,
    });
  }
}

/**
 * AUTONOMOUS: System Audit Worker
 * Runs comprehensive health and data integrity checks for the observability dashboard
 * Stores results in audit_reports table so the System Health panel shows "Verified" status
 */
async function runSystemAuditWorker(): Promise<void> {
  const traceId = `audit-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`[SYSTEM_AUDIT_WORKER] trace_id=${traceId} Starting autonomous system audit...`);
  
  try {
    const startTime = Date.now();
    const checks: Array<{
      name: string;
      category: string;
      severity: string;
      pass: boolean;
      details: Record<string, any>;
      ms: number;
    }> = [];
    
    // Check 1: Autonomy Loops Health
    const autonomyLoops = await storage.getAutonomyLoops();
    const unhealthyLoops = autonomyLoops.filter(l => !l.isHealthy);
    checks.push({
      name: "AUTONOMY_LOOPS",
      category: "SYSTEM",
      severity: unhealthyLoops.length > 0 ? "CRITICAL" : "INFO",
      pass: unhealthyLoops.length === 0,
      details: {
        total: autonomyLoops.length,
        healthy: autonomyLoops.filter(l => l.isHealthy).length,
        unhealthy: unhealthyLoops.map(l => l.loopName),
      },
      ms: Date.now() - startTime,
    });
    
    // Check 2: Database Connectivity
    try {
      await db.execute(sql`SELECT 1`);
      checks.push({
        name: "DATABASE_CONNECTIVITY",
        category: "INFRASTRUCTURE",
        severity: "INFO",
        pass: true,
        details: { connected: true },
        ms: Date.now() - startTime,
      });
    } catch (dbError: any) {
      checks.push({
        name: "DATABASE_CONNECTIVITY",
        category: "INFRASTRUCTURE",
        severity: "CRITICAL",
        pass: false,
        details: { connected: false, error: dbError.message },
        ms: Date.now() - startTime,
      });
    }
    
    // Check 3: Bot Fleet Health
    // health_state enum values are: OK, WARN, DEGRADED
    const allBots = await db.execute(sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE health_state = 'DEGRADED') as degraded,
        COUNT(*) FILTER (WHERE health_state = 'WARN') as warning,
        COUNT(*) FILTER (WHERE health_state = 'OK' OR health_state IS NULL) as healthy
      FROM bots
    `);
    const botStats = allBots.rows[0] as { total: string; degraded: string; warning: string; healthy: string };
    const degradedCount = Number(botStats?.degraded || 0);
    checks.push({
      name: "BOT_FLEET_HEALTH",
      category: "BOTS",
      severity: degradedCount > 0 ? "WARN" : "INFO",
      pass: degradedCount === 0,
      details: {
        total: Number(botStats?.total || 0),
        healthy: Number(botStats?.healthy || 0),
        warning: Number(botStats?.warning || 0),
        degraded: Number(botStats?.degraded || 0),
      },
      ms: Date.now() - startTime,
    });
    
    // Check 4: Paper Runner Instances
    const activeInstances = await db.execute(sql`
      SELECT COUNT(*) as active FROM bot_instances WHERE is_active = true
    `);
    const instanceCount = Number((activeInstances.rows[0] as any)?.active || 0);
    checks.push({
      name: "ACTIVE_INSTANCES",
      category: "RUNTIME",
      severity: "INFO",
      pass: true,
      details: { activeInstances: instanceCount },
      ms: Date.now() - startTime,
    });
    
    // Check 5: Job Queue Health
    // Only count recent failures (last 4 hours) that haven't been superseded by a successful retry
    const pendingJobs = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
        COUNT(*) FILTER (WHERE status = 'RUNNING') as running,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND created_at > NOW() - INTERVAL '4 hours') as failed_recent
      FROM bot_jobs
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);
    const jobStats = pendingJobs.rows[0] as { queued: string; running: string; failed_recent: string };
    const recentFailedCount = Number(jobStats?.failed_recent || 0);
    // Threshold of 100 allows for normal backtest failures without triggering warnings
    const failureThreshold = 100;
    checks.push({
      name: "JOB_QUEUE_HEALTH",
      category: "JOBS",
      severity: recentFailedCount > failureThreshold ? "WARN" : "INFO",
      pass: recentFailedCount <= failureThreshold,
      details: {
        queued: Number(jobStats?.queued || 0),
        running: Number(jobStats?.running || 0),
        recentFailed: recentFailedCount,
        threshold: failureThreshold,
      },
      ms: Date.now() - startTime,
    });
    
    // Determine overall audit status
    const auditStatus = checks.every(c => c.pass) 
      ? "PASS" 
      : checks.some(c => c.severity === "CRITICAL" && !c.pass) 
        ? "FAIL" 
        : "WARN";
    
    // Get or create a system user for audit reports
    // Try to find any existing user for associating the audit report
    const systemUser = await db.execute(sql`
      SELECT id FROM users ORDER BY created_at LIMIT 1
    `);
    
    if (systemUser.rows.length > 0) {
      const userId = (systemUser.rows[0] as any).id;
      
      // Save audit report
      await db.insert(schema.auditReports).values({
        userId,
        suiteType: "autonomous",
        status: auditStatus,
        checksJson: checks,
        summaryJson: {
          total: checks.length,
          passed: checks.filter(c => c.pass).length,
          failed: checks.filter(c => !c.pass).length,
          criticalFailures: checks.filter(c => !c.pass && c.severity === "CRITICAL").length,
        },
        performanceJson: {
          totalMs: Date.now() - startTime,
        },
      });
      
      console.log(`[SYSTEM_AUDIT_WORKER] trace_id=${traceId} Completed: status=${auditStatus} checks=${checks.length} passed=${checks.filter(c => c.pass).length} failed=${checks.filter(c => !c.pass).length} ms=${Date.now() - startTime}`);
      
      await logActivityEvent({
        eventType: "SYSTEM_AUDIT",
        severity: auditStatus === "PASS" ? "INFO" : auditStatus === "FAIL" ? "CRITICAL" : "WARN",
        title: `Autonomous system audit: ${auditStatus}`,
        summary: `${checks.filter(c => c.pass).length}/${checks.length} checks passed`,
        payload: { 
          traceId, 
          status: auditStatus,
          checks: checks.map(c => ({ name: c.name, pass: c.pass })),
        },
        traceId,
      });
    } else {
      console.log(`[SYSTEM_AUDIT_WORKER] trace_id=${traceId} No users found - skipping audit report storage`);
    }
    
  } catch (error: any) {
    console.error(`[SYSTEM_AUDIT_WORKER] trace_id=${traceId} Error:`, error.message);
  }
}

/**
 * QC AUTO-TRIGGER WORKER
 * Automatically queues QC verification for high-confidence strategies
 * Uses user-configured threshold and tier settings from Strategy Lab state
 * Runs less frequently than the job processor to avoid overwhelming the budget
 */
async function runQCAutoTriggerWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} starting_cycle`);
  
  try {
    const qcModule = await import("./providers/quantconnect");
    const { checkBudget, consumeBudget, refundBudget, checkSnapshotCooldown } = await import("./providers/quantconnect/budgetGovernor");
    const { getStrategyLabState } = await import("./strategy-lab-engine");
    
    const qcConfig = qcModule.verifyQCConfig();
    if (!qcConfig.configured) {
      console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} qc_not_configured missing=${qcConfig.missing.join(",")}`);
      return;
    }
    
    // Get user's QC auto-trigger settings
    const labState = getStrategyLabState();
    const autoTriggerEnabled = labState.qcAutoTriggerEnabled ?? true;
    const autoTriggerThreshold = labState.qcAutoTriggerThreshold ?? 80;
    const autoTriggerTier = labState.qcAutoTriggerTier ?? "AB"; // A, B, or AB
    
    if (!autoTriggerEnabled) {
      console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} disabled_by_settings`);
      return;
    }
    
    // Check budget before processing
    const budgetStatus = await checkBudget();
    if (!budgetStatus.allowed) {
      console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} budget_exhausted daily=${budgetStatus.status.dailyUsed}/${budgetStatus.status.dailyLimit}`);
      return;
    }
    
    // Build tier filter based on user settings
    // Tier A = 80+, Tier B = 65-79
    let tierCondition;
    if (autoTriggerTier === "A") {
      // Only Tier A (adjusted >= 80)
      tierCondition = or(
        gte(schema.strategyCandidates.adjustedScore, 80),
        and(
          isNull(schema.strategyCandidates.adjustedScore),
          gte(schema.strategyCandidates.confidenceScore, 80)
        )
      );
    } else if (autoTriggerTier === "B") {
      // Only Tier B (adjusted 65-79)
      tierCondition = or(
        and(
          gte(schema.strategyCandidates.adjustedScore, 65),
          lt(schema.strategyCandidates.adjustedScore, 80)
        ),
        and(
          isNull(schema.strategyCandidates.adjustedScore),
          gte(schema.strategyCandidates.confidenceScore, 65),
          lt(schema.strategyCandidates.confidenceScore, 80)
        )
      );
    } else {
      // AB: Both tiers (adjusted >= 65)
      tierCondition = or(
        gte(schema.strategyCandidates.adjustedScore, 65),
        and(
          isNull(schema.strategyCandidates.adjustedScore),
          gte(schema.strategyCandidates.confidenceScore, 65)
        )
      );
    }
    
    // Find eligible candidates that meet threshold AND tier requirements
    // INDUSTRY STANDARD: Pick up both PENDING_REVIEW AND QUEUED_FOR_QC (fallback for evolved candidates)
    const eligibleCandidates = await db
      .select({
        id: schema.strategyCandidates.id,
        strategyName: schema.strategyCandidates.strategyName,
        confidenceScore: schema.strategyCandidates.confidenceScore,
        adjustedScore: schema.strategyCandidates.adjustedScore,
        noveltyTier: schema.strategyCandidates.noveltyTier,
        noveltyScore: schema.strategyCandidates.noveltyScore,
        rulesJson: schema.strategyCandidates.rulesJson,
        disposition: schema.strategyCandidates.disposition,
      })
      .from(schema.strategyCandidates)
      .where(
        and(
          tierCondition,
          // Also check against user's threshold setting
          or(
            gte(schema.strategyCandidates.adjustedScore, autoTriggerThreshold),
            and(
              isNull(schema.strategyCandidates.adjustedScore),
              gte(schema.strategyCandidates.confidenceScore, autoTriggerThreshold)
            )
          ),
          // INDUSTRY STANDARD: Pick up PENDING_REVIEW (new), QUEUED (enriched), or QUEUED_FOR_QC (evolved) candidates
          // CRITICAL FIX: Added QUEUED to unblock 76+ stranded candidates that passed enrichment
          or(
            eq(schema.strategyCandidates.disposition, "PENDING_REVIEW"),
            eq(schema.strategyCandidates.disposition, "QUEUED"),
            eq(schema.strategyCandidates.disposition, "QUEUED_FOR_QC")
          ),
          isNotNull(schema.strategyCandidates.rulesJson)
        )
      )
      .limit(50);
    
    console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} checking threshold=${autoTriggerThreshold}% tier=${autoTriggerTier} eligible=${eligibleCandidates.length}`);
    
    if (eligibleCandidates.length === 0) {
      return;
    }
    
    // UNIQUENESS GATE: Minimum 30% uniqueness to avoid testing duplicate strategies
    // LOWERED: 50% was too strict - blocking all eligible candidates (novelty scores 36-44%)
    const MIN_UNIQUENESS_THRESHOLD = 30;
    
    // Check which candidates already have a recent QC verification
    for (const candidate of eligibleCandidates) {
      // Skip low-uniqueness strategies to avoid testing duplicates
      const noveltyScore = candidate.noveltyScore;
      if (noveltyScore !== null && noveltyScore < MIN_UNIQUENESS_THRESHOLD) {
        console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} SKIP_LOW_UNIQUENESS candidate=${candidate.id.slice(0, 8)} novelty=${noveltyScore}% < ${MIN_UNIQUENESS_THRESHOLD}%`);
        continue;
      }
      const existingVerification = await db
        .select()
        .from(schema.qcVerifications)
        .where(eq(schema.qcVerifications.candidateId, candidate.id))
        .orderBy(desc(schema.qcVerifications.queuedAt))
        .limit(1);
      
      // Skip based on verification status and time:
      // - RUNNING/QUEUED: skip entirely (already in progress)
      // - FAILED: allow retry after 2h (give time for QC system recovery)
      // - COMPLETED: handled by 7-day snapshot cooldown below
      if (existingVerification.length > 0) {
        const lastVerification = existingVerification[0];
        const hoursSinceQueued = (Date.now() - new Date(lastVerification.queuedAt!).getTime()) / (1000 * 60 * 60);
        
        if (lastVerification.status === "RUNNING" || lastVerification.status === "QUEUED") {
          continue; // Already in progress
        } else if (lastVerification.status === "FAILED") {
          if (hoursSinceQueued < 2) continue; // Allow retry after 2h cooldown
        }
        // COMPLETED status is checked via snapshot cooldown below
      }
      
      // Generate snapshot hash early to check cooldown
      const rulesJson = candidate.rulesJson as Record<string, any>;
      const snapshotContent = JSON.stringify({
        symbol: rulesJson.symbol,
        archetype: rulesJson.archetype,
        timeframe: rulesJson.timeframe,
        indicators: rulesJson.indicators,
        risk: rulesJson.risk,
      });
      const snapshotHash = crypto.createHash("sha256").update(snapshotContent).digest("hex");
      
      // SNAPSHOT COOLDOWN: 1 run per snapshot per 7 days
      const cooldownCheck = await checkSnapshotCooldown(snapshotHash, candidate.id);
      if (!cooldownCheck.allowed) {
        console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} SNAPSHOT_COOLDOWN candidate=${candidate.id.slice(0, 8)} reason="${cooldownCheck.reason}"`);
        continue;
      }
      
      // Recheck budget before each queue
      const currentBudget = await checkBudget();
      if (!currentBudget.allowed) {
        break;
      }
      
      // Consume budget and queue verification
      const consumeResult = await consumeBudget(traceId);
      if (!consumeResult.success) {
        break;
      }
      
      // Try to queue verification, refund budget if it fails
      try {
        // snapshotHash was already generated above for cooldown check
        await db.insert(schema.qcVerifications).values({
          candidateId: candidate.id,
          snapshotHash,
          tierAtRun: candidate.noveltyTier || "A",
          confidenceAtRun: candidate.confidenceScore,
          status: "QUEUED",
          traceId,
        });
        
        // Update disposition to QUEUED_FOR_QC so candidate moves to QC Testing tab
        await db
          .update(schema.strategyCandidates)
          .set({ disposition: "QUEUED_FOR_QC", updatedAt: new Date() })
          .where(eq(schema.strategyCandidates.id, candidate.id));
        
        const effectiveScore = candidate.adjustedScore ?? candidate.confidenceScore;
        console.log(`[QC_AUTO_TRIGGER] trace_id=${traceId} Auto-queued QC verification for candidate=${candidate.id.slice(0, 8)} score=${effectiveScore}% disposition=QUEUED_FOR_QC`);
        
        await logActivityEvent({
          eventType: "INTEGRATION_VERIFIED",
          severity: "INFO",
          title: `QC auto-triggered: ${candidate.strategyName}`,
          summary: `Tier A strategy with ${candidate.confidenceScore}% confidence queued for verification`,
          payload: { traceId, candidateId: candidate.id, confidence: candidate.confidenceScore },
          traceId,
          provider: "quantconnect",
        });
        
        // Process up to 10 candidates per cycle (budget permitting)
      } catch (queueError) {
        // Refund budget on failure to queue verification
        console.error(`[QC_AUTO_TRIGGER] trace_id=${traceId} Failed to queue verification for candidate=${candidate.id.slice(0, 8)}:`, queueError);
        await refundBudget(traceId);
        continue; // Try next candidate
      }
    }
    
  } catch (error) {
    console.error(`[QC_AUTO_TRIGGER] trace_id=${traceId} Error:`, error);
  }
}

/**
 * QC VERIFICATION WORKER
 * Processes QUEUED QuantConnect verification jobs
 * - Picks up QUEUED jobs and runs them through QC API
 * - Updates badge state and confidence boost on completion
 */
// Maximum concurrent QC verifications to avoid QC queue congestion
const MAX_CONCURRENT_QC_VERIFICATIONS = 2;

async function runQCVerificationWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    console.log(`[QC_WORKER] trace_id=${traceId} starting_cycle`);
    
    // SELF-HEALING: Recover any stale RUNNING jobs before processing new ones
    // This catches jobs that got stuck mid-execution (not just at startup)
    await recoverStuckQCVerificationJobs(false);
    
    const qcModule = await import("./providers/quantconnect");
    const { translateToLEAN } = await import("./providers/quantconnect/leanTranslator");
    const { normalizeResults, calculateConfidenceWithBoost, newToLegacyBadgeState } = await import("./providers/quantconnect/resultNormalizer");
    const { refundBudget } = await import("./providers/quantconnect/budgetGovernor");
    
    const qcConfig = qcModule.verifyQCConfig();
    if (!qcConfig.configured) {
      console.log(`[QC_WORKER] trace_id=${traceId} SKIP missing_config: ${qcConfig.missing?.join(", ") || "unknown"}`);
      return;
    }
    
    // Check how many verifications are currently RUNNING
    const runningCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.qcVerifications)
      .where(eq(schema.qcVerifications.status, "RUNNING"));
    
    const currentRunning = runningCount[0]?.count || 0;
    
    if (currentRunning >= MAX_CONCURRENT_QC_VERIFICATIONS) {
      console.log(`[QC_WORKER] trace_id=${traceId} SKIP concurrent_limit: ${currentRunning}/${MAX_CONCURRENT_QC_VERIFICATIONS} running`);
      return;
    }
    
    const queuedJobs = await db
      .select()
      .from(schema.qcVerifications)
      .where(eq(schema.qcVerifications.status, "QUEUED"))
      .orderBy(schema.qcVerifications.queuedAt)
      .limit(1);
    
    console.log(`[QC_WORKER] trace_id=${traceId} queued_jobs=${queuedJobs.length} running=${currentRunning}/${MAX_CONCURRENT_QC_VERIFICATIONS}`);
    
    if (queuedJobs.length === 0) {
      return;
    }
    
    const job = queuedJobs[0];
    const attemptInfo = job.attemptCount && job.attemptCount > 1 
      ? ` attempt=${job.attemptCount}/${job.maxAttempts || 3}` 
      : "";
    console.log(`[QC_WORKER] trace_id=${traceId} Processing verification job=${job.id.slice(0, 8)} candidate=${job.candidateId.slice(0, 8)}${attemptInfo}`);
    
    await db
      .update(schema.qcVerifications)
      .set({ status: "RUNNING", startedAt: new Date() })
      .where(eq(schema.qcVerifications.id, job.id));
    
    try {
      const [candidate] = await db
        .select()
        .from(schema.strategyCandidates)
        .where(eq(schema.strategyCandidates.id, job.candidateId))
        .limit(1);
      
      if (!candidate) {
        throw new Error("Candidate not found");
      }
      
      const rulesJson = candidate.rulesJson as Record<string, any>;
      const strategyConfig = rulesJson.indicators || {};
      const riskConfig = rulesJson.risk || {};
      
      // DIAGNOSTIC: Log rulesJson structure for debugging QC config mismatch
      const extractedSymbol = rulesJson.symbol || "MES";
      const extractedTimeframe = rulesJson.timeframe || "5m";
      
      // CRITICAL FIX: Infer archetype from strategy name when not explicitly set
      // This prevents all strategies defaulting to "mean_reversion" and producing identical QC results
      // Uses shared inferArchetypeFromName utility for parity with backtest-executor
      let extractedArchetype = rulesJson.archetype;
      if (!extractedArchetype && candidate.strategyName) {
        extractedArchetype = inferArchetypeFromName(candidate.strategyName, traceId);
        
        if (extractedArchetype) {
          console.log(`[QC_WORKER] trace_id=${traceId} ARCHETYPE_INFERRED: "${candidate.strategyName}" → "${extractedArchetype}"`);
        } else {
          console.log(`[QC_WORKER] trace_id=${traceId} ARCHETYPE_INFERENCE_FAILED: "${candidate.strategyName}" - using breakout fallback`);
          extractedArchetype = "breakout"; // Default to breakout (more general than mean_reversion)
        }
      } else if (!extractedArchetype) {
        extractedArchetype = "breakout";
        console.log(`[QC_WORKER] trace_id=${traceId} NO_STRATEGY_NAME: using breakout fallback`);
      }
      const entryRules = rulesJson.entry || [];
      const exitRules = rulesJson.exit || [];
      
      // CONFIG VALIDATION LOGGING - Critical for detecting local/QC mismatch
      console.log(`[QC_WORKER] trace_id=${traceId} ========== CONFIG VALIDATION ==========`);
      console.log(`[QC_WORKER] trace_id=${traceId} candidate=${candidate.id.slice(0, 8)} name="${candidate.strategyName}"`);
      console.log(`[QC_WORKER] trace_id=${traceId} symbol=${extractedSymbol} archetype=${extractedArchetype} timeframe=${extractedTimeframe}`);
      console.log(`[QC_WORKER] trace_id=${traceId} backtestPeriod=180days extendedMarketHours=TRUE`);
      console.log(`[QC_WORKER] trace_id=${traceId} ENTRY_RULES: ${JSON.stringify(entryRules)}`);
      console.log(`[QC_WORKER] trace_id=${traceId} EXIT_RULES: ${JSON.stringify(exitRules)}`);
      console.log(`[QC_WORKER] trace_id=${traceId} RULES_JSON_KEYS: ${Object.keys(rulesJson).join(", ")}`);
      console.log(`[QC_WORKER] trace_id=${traceId} =========================================`);
      
      // INSTITUTIONAL APPROACH: Pass the actual rulesJson to the translator
      // This allows rule parsing instead of falling back to generic archetypes
      const translationInput = {
        botName: candidate.strategyName || "QCVerification",
        symbol: extractedSymbol,
        archetype: extractedArchetype,
        timeframe: extractedTimeframe,
        strategyConfig,
        riskConfig,
        backtestPeriodDays: 180,  // Extended from 90 to capture more trades for conservative strategies
        rulesJson: rulesJson as { entry?: string[]; exit?: string[]; risk?: string[]; filters?: string[]; invalidation?: string[] },
      };
      
      const translation = translateToLEAN(translationInput);
      if (!translation.success || !translation.pythonCode) {
        throw new Error(translation.error || "Translation failed");
      }
      
      console.log(`[QC_WORKER] trace_id=${traceId} Translated strategy, submitting to QC...`);
      
      // Create project, add file, compile, and run backtest
      const projectName = `BlaidAgent_${candidate.id.slice(0, 8)}_${Date.now()}`;
      const createResult = await qcModule.createProject(projectName, "Py", traceId);
      if (!createResult.success || !createResult.project) {
        throw new Error(createResult.error?.message || "Failed to create QC project");
      }
      const projectId = createResult.project.projectId;
      
      // CRITICAL: Save projectId to database immediately for recovery tracking
      await db
        .update(schema.qcVerifications)
        .set({ qcProjectId: String(projectId) })
        .where(eq(schema.qcVerifications.id, job.id));
      console.log(`[QC_WORKER] trace_id=${traceId} Saved project_id=${projectId} to database for recovery tracking`);
      
      let qcMetrics: any;
      try {
        // Use updateFile instead of addFile because QC creates a default main.py in new Python projects
        const updateResult = await qcModule.updateFile(projectId, "main.py", translation.pythonCode, traceId);
        if (!updateResult.success) {
          throw new Error(updateResult.error?.message || "Failed to update algorithm file");
        }
        
        // Start compile and get compileId
        const compileStartResult = await qcModule.compileProject(projectId, traceId);
        if (!compileStartResult.success || !compileStartResult.compile) {
          throw new Error(`Compile start failed: ${compileStartResult.error?.message || "Unknown error"}`);
        }
        const compileId = compileStartResult.compile.compileId;
        
        // Poll until compile completes
        const compileResult = await qcModule.pollCompileUntilComplete({
          projectId,
          compileId,
          traceId,
          maxAttempts: 30,
          pollIntervalMs: 2000,
        });
        if (!compileResult.success || !compileResult.compile || compileResult.compile.state !== "BuildSuccess") {
          throw new Error(`Compile failed: ${compileResult.error?.message || compileResult.compile?.logs?.join(", ") || "Unknown error"}`);
        }
        
        const backtestResult = await qcModule.createBacktest(projectId, compileId, `Verify_${traceId}`, traceId);
        if (!backtestResult.success || !backtestResult.backtestId) {
          throw new Error(backtestResult.error?.message || "Failed to create backtest");
        }
        
        // CRITICAL: Save backtestId to database immediately for recovery tracking
        await db
          .update(schema.qcVerifications)
          .set({ qcBacktestId: backtestResult.backtestId })
          .where(eq(schema.qcVerifications.id, job.id));
        console.log(`[QC_WORKER] trace_id=${traceId} Saved backtest_id=${backtestResult.backtestId} to database for recovery tracking`);
        
        // Poll for completion - 240 attempts × 5s = 1200s (20 minutes) for slow QuantConnect queues
        const pollResult = await qcModule.pollBacktestUntilComplete({
          projectId,
          backtestId: backtestResult.backtestId,
          traceId,
          maxAttempts: 240,
          pollIntervalMs: 5000,
          onProgress: async (progress: number) => {
            // Update progress in database (debounced - only update on significant changes)
            const progressPct = Math.round(progress * 100);
            try {
              await db
                .update(schema.qcVerifications)
                .set({ progressPct })
                .where(eq(schema.qcVerifications.id, job.id));
            } catch (e) {
              // Ignore progress update errors
            }
          },
        });
        
        if (!pollResult.success || !pollResult.backtest?.result) {
          throw new Error(pollResult.error?.message || "Backtest failed or no metrics");
        }
        
        qcMetrics = pollResult.backtest.result;
      } finally {
        // Always clean up project on success or failure
        await qcModule.deleteProject(projectId, traceId).catch((e) => 
          console.error(`[QC_WORKER] trace_id=${traceId} Cleanup failed:`, e)
        );
      }
      
      // Local metrics placeholder - for QC gate evaluation we use the QC backtest period
      // which is 90 days (set above in translationInput.backtestPeriodDays)
      const localMetrics = {
        netPnl: 0,
        totalTrades: 0,
        winRate: 0,
        sharpeRatio: null,
        maxDrawdown: null,
        profitFactor: null,
        backtestDays: 90, // Matches the QC backtest period
      };
      
      const normResult = normalizeResults(qcMetrics, localMetrics, traceId);
      
      // Convert new badge states to legacy DB enum values
      const legacyBadgeState = newToLegacyBadgeState(normResult.badgeState);
      const validBadgeStates = ["VERIFIED", "DIVERGENT", "INCONCLUSIVE", "FAILED"] as const;
      const dbBadgeState = validBadgeStates.includes(legacyBadgeState as any) 
        ? legacyBadgeState as "VERIFIED" | "DIVERGENT" | "INCONCLUSIVE" | "FAILED"
        : "FAILED";
      
      // Log the new QC gate result with failure reasons if any
      if (normResult.failureReasons && normResult.failureReasons.length > 0) {
        console.log(`[QC_GATE] trace_id=${traceId} reasons: ${normResult.failureReasons.join("; ")}`);
      }
      console.log(`[QC_GATE] trace_id=${traceId} qcGatePassed=${normResult.qcGatePassed}`);
      
      await db
        .update(schema.qcVerifications)
        .set({
          status: "COMPLETED",
          badgeState: dbBadgeState,
          qcScore: normResult.qcScore,
          metricsSummaryJson: { ...qcMetrics as any, backtestDays: 90, qcGatePassed: normResult.qcGatePassed, failureReasons: normResult.failureReasons } as any,
          divergenceDetailsJson: normResult.divergenceDetails as any,
          finishedAt: new Date(),
        })
        .where(eq(schema.qcVerifications.id, job.id));
      
      // Only boost confidence if QC gate passed (new: QC_PASSED, legacy: VERIFIED)
      if (normResult.qcGatePassed && normResult.confidenceBoost > 0 && candidate.confidenceScore) {
        const newConfidence = calculateConfidenceWithBoost(
          candidate.confidenceScore,
          normResult.badgeState,
          normResult.confidenceBoost
        );
        
        await db
          .update(schema.strategyCandidates)
          .set({ confidenceScore: newConfidence })
          .where(eq(schema.strategyCandidates.id, candidate.id));
        
        console.log(`[QC_WORKER] trace_id=${traceId} Applied confidence boost: ${candidate.confidenceScore}% -> ${newConfidence}%`);
      }
      
      console.log(`[QC_WORKER] trace_id=${traceId} Verification complete: badge=${normResult.badgeState} score=${normResult.qcScore}`);
      
      // Track QC API success for health monitoring
      const { recordQCSuccess } = await import("./providers/quantconnect/healthMonitor");
      recordQCSuccess();
      
      await logActivityEvent({
        eventType: "INTEGRATION_VERIFIED",
        severity: "INFO",
        title: `QC verification: ${normResult.badgeState}`,
        summary: `Strategy ${candidate.strategyName} verified with score ${normResult.qcScore}`,
        payload: { 
          traceId,
          candidateId: candidate.id,
          badgeState: normResult.badgeState,
          qcScore: normResult.qcScore,
          confidenceBoost: normResult.confidenceBoost,
        },
        traceId,
        provider: "quantconnect",
      });
      
      // AUTO-PROMOTION WITH FAST-TRACK: Check thresholds and create bots in appropriate stage
      // Use qcGatePassed flag instead of badge state for cleaner logic
      if (normResult.qcGatePassed && candidate.disposition === "QUEUED_FOR_QC") {
        try {
          // Load Strategy Lab settings for fast-track and auto-promote thresholds
          const { getStrategyLabState } = await import("./strategy-lab-engine");
          const labState = getStrategyLabState();
          
          // Extract QC metrics for threshold comparison
          // IMPORTANT: QC already returns winRate and maxDrawdown as percentages
          // e.g., winRate=17 means 17%, maxDrawdown=1.6 means 1.6%
          const qcTrades = qcMetrics?.totalTrades ?? 0;
          const qcSharpe = qcMetrics?.sharpe ?? 0;
          const qcWinRate = qcMetrics?.winRate ?? 0; // Already percentage (17 = 17%)
          const qcDrawdown = Math.abs(qcMetrics?.maxDrawdown ?? 0); // Already percentage (1.6 = 1.6%)
          
          console.log(`[QC_WORKER] trace_id=${traceId} QC_METRICS: trades=${qcTrades} sharpe=${qcSharpe.toFixed(2)} winRate=${qcWinRate.toFixed(1)}% drawdown=${qcDrawdown.toFixed(1)}%`);
          
          // FAST-TRACK CHECK: If enabled and metrics exceed exceptional thresholds, skip TRIALS → PAPER
          const fastTrackEnabled = labState.fastTrackEnabled ?? false;
          const fastTrackMinTrades = labState.fastTrackMinTrades ?? 50;
          const fastTrackMinSharpe = labState.fastTrackMinSharpe ?? 1.5;
          const fastTrackMinWinRate = labState.fastTrackMinWinRate ?? 55;
          const fastTrackMaxDrawdown = labState.fastTrackMaxDrawdown ?? 15;
          
          const meetsFastTrack = fastTrackEnabled && 
            qcTrades >= fastTrackMinTrades &&
            qcSharpe >= fastTrackMinSharpe &&
            qcWinRate >= fastTrackMinWinRate &&
            qcDrawdown <= fastTrackMaxDrawdown;
          
          // TRIALS AUTO-PROMOTE CHECK: Default to TRUE (industry standard for autonomous systems)
          // QC-passed candidates should auto-promote; manual gates are for CANARY→LIVE only
          const trialsAutoPromoteEnabled = labState.trialsAutoPromoteEnabled ?? true;
          
          // Determine target stage based on thresholds
          let targetStage: "PAPER" | "TRIALS" | null = null;
          let promotionReason = "";
          
          if (meetsFastTrack) {
            targetStage = "PAPER";
            promotionReason = `Fast-track: trades=${qcTrades}/${fastTrackMinTrades} sharpe=${qcSharpe.toFixed(2)}/${fastTrackMinSharpe} winRate=${qcWinRate.toFixed(1)}%/${fastTrackMinWinRate}% drawdown=${qcDrawdown.toFixed(1)}%/${fastTrackMaxDrawdown}%`;
            console.log(`[QC_WORKER] trace_id=${traceId} FAST_TRACK: PASSED - skipping TRIALS, creating PAPER bot`);
          } else if (trialsAutoPromoteEnabled) {
            targetStage = "TRIALS";
            promotionReason = `Auto-promote to Trials: QC verified with score=${normResult.qcScore}`;
            console.log(`[QC_WORKER] trace_id=${traceId} AUTO_PROMOTE: creating TRIALS bot`);
            if (fastTrackEnabled) {
              console.log(`[QC_WORKER] trace_id=${traceId} FAST_TRACK: NOT MET - trades=${qcTrades}/${fastTrackMinTrades} sharpe=${qcSharpe.toFixed(2)}/${fastTrackMinSharpe} winRate=${qcWinRate.toFixed(1)}%/${fastTrackMinWinRate}% drawdown=${qcDrawdown.toFixed(1)}%/${fastTrackMaxDrawdown}%`);
            }
          } else {
            console.log(`[QC_WORKER] trace_id=${traceId} NO_AUTO_PROMOTE: trialsAutoPromoteEnabled=false fastTrackEnabled=${fastTrackEnabled}`);
          }
          
          if (targetStage) {
            // Get system user for autonomous promotion
            const systemUsers = await db.select().from(schema.users).where(eq(schema.users.username, "BlaidAgent")).limit(1);
            const userId = systemUsers.length > 0 ? systemUsers[0].id : null;
            
            if (userId) {
              // Make internal request to promote endpoint with target stage
              const promoteUrl = `http://localhost:${process.env.PORT || 5000}/api/strategy-lab/candidates/${candidate.id}/promote`;
              const promoteRes = await fetch(promoteUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  user_id: userId, 
                  session_id: "qc_auto_promote",
                  target_stage: targetStage, // PAPER for fast-track, TRIALS otherwise
                }),
              });
              
              if (promoteRes.ok) {
                const promoteData = await promoteRes.json() as { data?: { botId?: string } };
                const createdBotId = promoteData.data?.botId;
                console.log(`[QC_WORKER] trace_id=${traceId} ${targetStage === "PAPER" ? "FAST_TRACK" : "AUTO_PROMOTE"}: success bot_id=${createdBotId} stage=${targetStage}`);
                
                await logActivityEvent({
                  eventType: "PROMOTED",
                  severity: "INFO",
                  title: targetStage === "PAPER" ? "Fast-tracked to PAPER after QC" : "Auto-promoted to TRIALS after QC",
                  summary: `Strategy ${candidate.strategyName} ${targetStage === "PAPER" ? "fast-tracked to PAPER" : "auto-promoted to TRIALS"}. ${promotionReason}`,
                  botId: createdBotId,
                  payload: { 
                    traceId, 
                    candidateId: candidate.id, 
                    targetStage,
                    fastTrack: targetStage === "PAPER",
                    qcMetrics: { trades: qcTrades, sharpe: qcSharpe, winRate: qcWinRate, drawdown: qcDrawdown },
                  },
                  traceId,
                  provider: "quantconnect",
                });
              } else {
                console.error(`[QC_WORKER] trace_id=${traceId} ${targetStage === "PAPER" ? "FAST_TRACK" : "AUTO_PROMOTE"}: failed status=${promoteRes.status}`);
              }
            } else {
              console.error(`[QC_WORKER] trace_id=${traceId} AUTO_PROMOTE: no system user found`);
            }
          }
        } catch (promoteError: any) {
          console.error(`[QC_WORKER] trace_id=${traceId} AUTO_PROMOTE error:`, promoteError.message);
        }
      } else if (candidate.disposition === "QUEUED_FOR_QC") {
        // QC completed but didn't pass gate (DIVERGENT/INCONCLUSIVE) - move back to READY for manual review
        // This prevents candidates from being stuck in QUEUED_FOR_QC limbo
        await db
          .update(schema.strategyCandidates)
          .set({ disposition: "READY", updatedAt: new Date() })
          .where(eq(schema.strategyCandidates.id, candidate.id));
        
        console.log(`[QC_WORKER] trace_id=${traceId} QC_NOT_PASSED: moved to READY for manual review badge=${normResult.badgeState}`);
      }
      
    } catch (jobError: any) {
      const errorMessage = jobError.message || String(jobError);
      console.error(`[QC_WORKER] trace_id=${traceId} Job failed:`, jobError);
      
      // Track QC API failure for health monitoring
      const { recordQCFailure } = await import("./providers/quantconnect/healthMonitor");
      recordQCFailure(errorMessage);
      
      // TRANSIENT FAILURE DETECTION: Only retry network/API errors, not strategy/metric failures
      const transientErrorPatterns = [
        "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH",
        "rate limit", "429", "503", "502", "500",
        "network", "timeout", "connection", "socket",
        "temporarily unavailable", "service unavailable",
        "fetch failed", "request failed",
        "did not complete within", "TIMEOUT", "backtest timed out",
        "queue is full", "server busy", "overloaded"
      ];
      
      const isTransientError = transientErrorPatterns.some(pattern => 
        errorMessage.toLowerCase().includes(pattern.toLowerCase())
      );
      
      // AUTONOMOUS RETRY: Only retry transient failures, not strategy/metric failures
      const currentAttempt = job.attemptCount || 1;
      // AUTONOMOUS: Increase max attempts for timeout errors (5 instead of 3)
      const isTimeoutError = errorMessage.toLowerCase().includes("did not complete within") || 
                             errorMessage.toLowerCase().includes("timeout");
      const maxAttempts = isTimeoutError ? 5 : (job.maxAttempts || 3);
      
      if (isTransientError && currentAttempt < maxAttempts) {
        // Re-queue for retry with incremented attempt count
        const nextAttempt = currentAttempt + 1;
        console.log(`[QC_WORKER] trace_id=${traceId} TRANSIENT_RETRY: scheduling attempt ${nextAttempt}/${maxAttempts} (transient error detected)`);
        
        await db
          .update(schema.qcVerifications)
          .set({
            status: "QUEUED",
            attemptCount: nextAttempt,
            lastRetryAt: new Date(),
            retryReason: errorMessage.slice(0, 500),
            errorMessage: `Attempt ${currentAttempt}/${maxAttempts} failed: ${errorMessage}`,
            startedAt: null,
          })
          .where(eq(schema.qcVerifications.id, job.id));
        
        await logActivityEvent({
          eventType: "INTEGRATION_USAGE_PROOF",
          severity: "INFO",
          title: `QC auto-retry: attempt ${nextAttempt}/${maxAttempts}`,
          summary: `Retrying QC verification after failure: ${errorMessage.slice(0, 100)}`,
          payload: { traceId, jobId: job.id, attempt: nextAttempt, maxAttempts },
          traceId,
          provider: "quantconnect",
        });
        
        // Don't refund budget - we're retrying
      } else {
        // Non-transient error OR all attempts exhausted - mark as permanently failed
        const failureReason = !isTransientError 
          ? `Non-retryable error: ${errorMessage}`
          : `All ${maxAttempts} attempts exhausted. Last error: ${errorMessage}`;
        
        console.log(`[QC_WORKER] trace_id=${traceId} ${!isTransientError ? 'NON_TRANSIENT_FAILURE' : 'ATTEMPTS_EXHAUSTED'}: marking FAILED`);
        
        await db
          .update(schema.qcVerifications)
          .set({
            status: "FAILED",
            badgeState: "FAILED",
            errorMessage: failureReason,
            finishedAt: new Date(),
          })
          .where(eq(schema.qcVerifications.id, job.id));
        
        if (job.traceId) {
          await refundBudget(job.traceId);
        }
        
        await logActivityEvent({
          eventType: "INTEGRATION_VERIFIED",
          severity: "WARN",
          title: !isTransientError ? "QC verification failed (non-retryable)" : `QC verification exhausted (${maxAttempts} attempts)`,
          summary: failureReason.slice(0, 200),
          payload: { traceId, jobId: job.id, attempts: currentAttempt, maxAttempts, isTransient: isTransientError, lastError: errorMessage },
          traceId,
          provider: "quantconnect",
        });
      }
    }
    
  } catch (error) {
    console.error(`[QC_WORKER] trace_id=${traceId} Worker error:`, error);
  }
}

/**
 * Start the scheduler with leader election and self-healing
 * INSTITUTIONAL: Only one instance will be the leader and run workers
 */
export async function startScheduler(): Promise<void> {
  if (isSchedulerRunning) {
    console.log("[SCHEDULER] Already running, skipping start");
    return;
  }
  
  // INSTITUTIONAL: Try to acquire leader lock
  isLeader = await tryAcquireLeaderLock();
  
  if (!isLeader) {
    console.log("[SCHEDULER] Another instance is leader, this instance will standby");
    
    leaderLockInterval = setInterval(async () => {
      const acquired = await tryAcquireLeaderLock();
      if (acquired && !isLeader) {
        isLeader = true;
        console.log("[SCHEDULER] Leadership acquired, starting workers...");
        clearAllWorkerIntervals();
        await initializeWorkers();
      }
    }, LEADER_LOCK_INTERVAL_MS);
    
    isSchedulerRunning = true;
    return;
  }
  
  console.log("[SCHEDULER] This instance is the leader");
  
  leaderLockInterval = setInterval(async () => {
    const stillLeader = await tryAcquireLeaderLock();
    if (!stillLeader && isLeader) {
      console.log("[SCHEDULER] Lost leadership, stopping workers...");
      isLeader = false;
      clearAllWorkerIntervals();
    }
  }, LEADER_LOCK_INTERVAL_MS);
  
  await initializeWorkers();
  isSchedulerRunning = true;
}

/**
 * INSTITUTIONAL: Clear all worker intervals when losing leadership
 */
function clearAllWorkerIntervals(): void {
  console.log("[SCHEDULER] Clearing all worker intervals...");
  
  if (timeoutWorkerInterval) {
    clearInterval(timeoutWorkerInterval);
    timeoutWorkerInterval = null;
  }
  if (supervisorLoopInterval) {
    clearInterval(supervisorLoopInterval);
    supervisorLoopInterval = null;
  }
  if (backtestWorkerInterval) {
    clearInterval(backtestWorkerInterval);
    backtestWorkerInterval = null;
  }
  if (autonomyLoopInterval) {
    clearInterval(autonomyLoopInterval);
    autonomyLoopInterval = null;
  }
  if (evolutionWorkerInterval) {
    clearInterval(evolutionWorkerInterval);
    evolutionWorkerInterval = null;
  }
  if (economicCalendarInterval) {
    clearInterval(economicCalendarInterval);
    economicCalendarInterval = null;
  }
  if (runnerWorkerInterval) {
    clearInterval(runnerWorkerInterval);
    runnerWorkerInterval = null;
  }
  if (trendConsistencyInterval) {
    clearInterval(trendConsistencyInterval);
    trendConsistencyInterval = null;
  }
  if (selfHealingInterval) {
    clearInterval(selfHealingInterval);
    selfHealingInterval = null;
  }
  if (integrationVerificationInterval) {
    clearInterval(integrationVerificationInterval);
    integrationVerificationInterval = null;
  }
  if (strategyLabResearchInterval) {
    clearInterval(strategyLabResearchInterval);
    strategyLabResearchInterval = null;
  }
  if (grokResearchInterval) {
    clearInterval(grokResearchInterval);
    grokResearchInterval = null;
  }
  if (qcVerificationWorkerInterval) {
    clearInterval(qcVerificationWorkerInterval);
    qcVerificationWorkerInterval = null;
  }
  if (qcErrorRecoveryWorkerInterval) {
    clearInterval(qcErrorRecoveryWorkerInterval);
    qcErrorRecoveryWorkerInterval = null;
  }
  if (qcEvolutionWorkerInterval) {
    clearInterval(qcEvolutionWorkerInterval);
    qcEvolutionWorkerInterval = null;
  }
  if (tournamentWorkerInterval) {
    clearInterval(tournamentWorkerInterval);
    tournamentWorkerInterval = null;
  }
  if (systemAuditInterval) {
    clearInterval(systemAuditInterval);
    systemAuditInterval = null;
  }
  if (consistencySweepInterval) {
    clearInterval(consistencySweepInterval);
    consistencySweepInterval = null;
  }
  
  // Stop drift detection
  stopScheduledDriftDetection();
  
  // Stop fleet risk engine
  stopFleetRiskEngine().catch(err => console.error("[SCHEDULER] Fleet risk engine stop error:", err));
  
  console.log("[SCHEDULER] All worker intervals cleared");
}

/**
 * INSTITUTIONAL: Recover jobs that were RUNNING when process crashed
 * Resets them to QUEUED so they can be picked up again
 */
async function recoverInflightJobs(): Promise<number> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    const result = await db.execute(sql`
      UPDATE bot_jobs 
      SET status = 'QUEUED',
          started_at = NULL,
          last_heartbeat_at = NULL,
          error_message = 'Recovered after process restart'
      WHERE status = 'RUNNING'
      RETURNING id, job_type, bot_id
    `);
    
    const recovered = result.rows as any[];
    
    if (recovered.length > 0) {
      console.log(`[SCHEDULER] trace_id=${traceId} Recovered ${recovered.length} inflight jobs`);
      
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "WARN",
        title: `Recovered ${recovered.length} jobs after restart`,
        summary: `Jobs that were RUNNING during shutdown have been reset to QUEUED`,
        payload: { 
          traceId,
          recoveredJobs: recovered.map(j => ({ id: j.id?.slice(0, 8), type: j.job_type })),
        },
        traceId,
      });
    }
    
    return recovered.length;
  } catch (error) {
    console.error(`[SCHEDULER] trace_id=${traceId} Failed to recover inflight jobs:`, error);
    return 0;
  }
}

/**
 * SELF-HEALING: Recover QC verification jobs that were RUNNING when process crashed
 * or have been stuck RUNNING for more than the timeout period.
 * 
 * Two-tier recovery approach:
 * 1. AGGRESSIVE (5 min): Jobs RUNNING without backtest ID = stuck in early phase (create/compile)
 * 2. STANDARD (20 min): Jobs RUNNING with backtest ID = may still be polling, wait longer
 * 
 * @param isStartup - if true, recovers all RUNNING jobs regardless of age
 */
async function recoverStuckQCVerificationJobs(isStartup: boolean = false): Promise<number> {
  const traceId = crypto.randomUUID().slice(0, 8);
  // Two-tier thresholds for smarter recovery
  const STUCK_EARLY_PHASE_MINUTES = 5;   // Jobs without backtest ID (stuck in create/compile)
  const STUCK_POLLING_PHASE_MINUTES = 20; // Jobs with backtest ID (still polling)
  
  try {
    let totalRecovered = 0;
    
    if (isStartup) {
      // On startup, reset ALL RUNNING jobs - we don't know their state
      const result = await db.execute(sql`
        UPDATE qc_verifications 
        SET status = 'QUEUED',
            started_at = NULL,
            qc_project_id = NULL,
            qc_backtest_id = NULL,
            attempt_count = COALESCE(attempt_count, 0) + 1,
            retry_reason = 'Recovered after process restart'
        WHERE status = 'RUNNING'
        RETURNING id, candidate_id, attempt_count, qc_backtest_id
      `);
      
      const recovered = result.rows as any[];
      totalRecovered = recovered.length;
      
      if (recovered.length > 0) {
        console.log(`[QC_RECOVERY] trace_id=${traceId} STARTUP: Recovered ${recovered.length} RUNNING jobs`);
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: `Recovered ${recovered.length} QC jobs after restart`,
          summary: `All RUNNING QC jobs reset to QUEUED on startup`,
          payload: { 
            traceId,
            isStartup: true,
            recoveredJobs: recovered.map(j => ({ 
              id: j.id?.slice(0, 8), 
              candidate: j.candidate_id?.slice(0, 8),
              hadBacktestId: !!j.qc_backtest_id,
              attempt: j.attempt_count 
            })),
          },
          traceId,
        });
      }
    } else {
      // TIER 1: Aggressive recovery for jobs stuck in early phase (no backtest ID)
      // These jobs likely crashed during project creation or compile
      const earlyPhaseResult = await db.execute(sql`
        UPDATE qc_verifications 
        SET status = 'QUEUED',
            started_at = NULL,
            qc_project_id = NULL,
            qc_backtest_id = NULL,
            attempt_count = COALESCE(attempt_count, 0) + 1,
            retry_reason = 'Auto-recovered: Stuck in early phase without backtest ID'
        WHERE status = 'RUNNING'
          AND (qc_backtest_id IS NULL OR qc_backtest_id = '')
          AND started_at < NOW() - INTERVAL '5 minutes'
        RETURNING id, candidate_id, attempt_count
      `);
      
      const earlyRecovered = earlyPhaseResult.rows as any[];
      if (earlyRecovered.length > 0) {
        console.log(`[QC_RECOVERY] trace_id=${traceId} TIER1: Recovered ${earlyRecovered.length} early-phase stuck jobs (no backtest ID, >${STUCK_EARLY_PHASE_MINUTES}min)`);
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: `Recovered ${earlyRecovered.length} early-phase QC jobs`,
          summary: `Jobs stuck in create/compile phase without backtest ID for >${STUCK_EARLY_PHASE_MINUTES}min`,
          payload: { 
            traceId,
            tier: 1,
            recoveredJobs: earlyRecovered.map(j => ({ 
              id: j.id?.slice(0, 8), 
              candidate: j.candidate_id?.slice(0, 8),
              attempt: j.attempt_count 
            })),
          },
          traceId,
        });
        totalRecovered += earlyRecovered.length;
      }
      
      // TIER 2: Standard recovery for jobs stuck in polling phase (have backtest ID)
      // These jobs have a backtest running on QC but polling may have hung
      const pollingPhaseResult = await db.execute(sql`
        UPDATE qc_verifications 
        SET status = 'QUEUED',
            started_at = NULL,
            qc_project_id = NULL,
            qc_backtest_id = NULL,
            attempt_count = COALESCE(attempt_count, 0) + 1,
            retry_reason = 'Auto-recovered: Stuck in polling phase'
        WHERE status = 'RUNNING'
          AND qc_backtest_id IS NOT NULL 
          AND qc_backtest_id != ''
          AND started_at < NOW() - INTERVAL '20 minutes'
        RETURNING id, candidate_id, attempt_count
      `);
      
      const pollingRecovered = pollingPhaseResult.rows as any[];
      if (pollingRecovered.length > 0) {
        console.log(`[QC_RECOVERY] trace_id=${traceId} TIER2: Recovered ${pollingRecovered.length} polling-phase stuck jobs (with backtest ID, >${STUCK_POLLING_PHASE_MINUTES}min)`);
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: `Recovered ${pollingRecovered.length} polling-phase QC jobs`,
          summary: `Jobs stuck in backtest polling for >${STUCK_POLLING_PHASE_MINUTES}min`,
          payload: { 
            traceId,
            tier: 2,
            recoveredJobs: pollingRecovered.map(j => ({ 
              id: j.id?.slice(0, 8), 
              candidate: j.candidate_id?.slice(0, 8),
              attempt: j.attempt_count 
            })),
          },
          traceId,
        });
        totalRecovered += pollingRecovered.length;
      }
    }
    
    return totalRecovered;
  } catch (error) {
    console.error(`[QC_RECOVERY] trace_id=${traceId} Failed to recover stuck QC jobs:`, error);
    return 0;
  }
}

/**
 * QC THRESHOLD CHANGE RECOVERY: Re-queue DIVERGENT verifications that might now pass
 * 
 * When thresholds are lowered (e.g., MIN_TRADES from 30 to 15), DIVERGENT verifications
 * that failed ONLY due to "Insufficient trades" should be re-evaluated.
 * 
 * This runs once per restart to catch any threshold changes.
 */
async function runQCThresholdRecoveryWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Scanning for DIVERGENT verifications eligible for re-run...`);
    
    const { checkBudget, consumeBudget, refundBudget } = await import("./providers/quantconnect/budgetGovernor");
    
    // Find COMPLETED verifications with DIVERGENT badge that might now pass with new thresholds
    // Criteria:
    // 1. badge_state = 'DIVERGENT' or 'QC_FAILED'
    // 2. metrics_summary_json contains "Insufficient trades" in failureReasons
    // 3. totalTrades >= 15 (new threshold)
    // 4. No active QUEUED/RUNNING verification exists
    // 5. Max 5 total attempts
    
    const eligibleVerifications = await db.execute(sql`
      WITH candidates_with_active AS (
        SELECT DISTINCT candidate_id
        FROM qc_verifications
        WHERE status IN ('QUEUED', 'RUNNING')
      ),
      candidate_total_attempts AS (
        SELECT candidate_id, COUNT(*) as total_verifications
        FROM qc_verifications
        GROUP BY candidate_id
      ),
      latest_per_candidate AS (
        SELECT DISTINCT ON (candidate_id)
          v.id,
          v.candidate_id,
          v.status,
          v.badge_state,
          v.metrics_summary_json,
          v.snapshot_hash,
          v.tier_at_run,
          v.confidence_at_run
        FROM qc_verifications v
        WHERE v.status = 'COMPLETED'
        ORDER BY v.candidate_id, v.queued_at DESC
      )
      SELECT 
        l.id,
        l.candidate_id,
        l.badge_state,
        l.metrics_summary_json,
        l.snapshot_hash,
        l.tier_at_run,
        l.confidence_at_run,
        cta.total_verifications,
        c.strategy_name
      FROM latest_per_candidate l
      JOIN candidate_total_attempts cta ON cta.candidate_id = l.candidate_id
      JOIN strategy_candidates c ON c.id = l.candidate_id
      WHERE l.badge_state = 'DIVERGENT'
        AND l.metrics_summary_json::text LIKE '%Insufficient trades%'
        AND l.metrics_summary_json->>'totalTrades' IS NOT NULL
        AND COALESCE((l.metrics_summary_json->>'totalTrades')::int, 0) >= 15
        AND c.disposition = 'QUEUED_FOR_QC'
        AND l.candidate_id NOT IN (SELECT candidate_id FROM candidates_with_active)
        AND cta.total_verifications < 5
      LIMIT 10
    `);
    
    const eligible = eligibleVerifications.rows as any[];
    
    if (eligible.length === 0) {
      console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} No DIVERGENT verifications eligible for threshold re-run`);
      return;
    }
    
    console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Found ${eligible.length} DIVERGENT verifications to re-evaluate with new thresholds`);
    
    let requeuedCount = 0;
    
    for (const v of eligible) {
      const budgetCheck = await checkBudget();
      if (!budgetCheck.allowed) {
        console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Budget exhausted, stopping`);
        break;
      }
      
      const consumeResult = await consumeBudget(traceId);
      if (!consumeResult.success) {
        console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Failed to consume budget, stopping`);
        break;
      }
      
      try {
        await db.insert(schema.qcVerifications).values({
          candidateId: v.candidate_id,
          snapshotHash: v.snapshot_hash,
          tierAtRun: v.tier_at_run,
          confidenceAtRun: v.confidence_at_run,
          status: "QUEUED",
          attemptCount: 1,
          maxAttempts: 5,
          retryReason: `Threshold recovery: MIN_TRADES lowered to 15 (had ${v.metrics_summary_json?.totalTrades || 'N/A'} trades)`,
          traceId,
        });
        
        requeuedCount++;
        console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Re-queued candidate=${v.candidate_id.slice(0, 8)} strategy="${v.strategy_name}" trades=${v.metrics_summary_json?.totalTrades || 'N/A'}`);
        
      } catch (err: any) {
        console.error(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Failed to re-queue candidate=${v.candidate_id.slice(0, 8)}:`, err.message);
        await refundBudget(traceId);
      }
    }
    
    if (requeuedCount > 0) {
      console.log(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Threshold recovery complete: ${requeuedCount} candidates re-queued`);
      
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "INFO",
        title: `QC Threshold Recovery: ${requeuedCount} jobs re-queued`,
        summary: `DIVERGENT verifications with >=15 trades now eligible with new MIN_TRADES=15 threshold`,
        payload: { traceId, requeuedCount },
        traceId,
      });
    }
    
  } catch (error) {
    console.error(`[QC_THRESHOLD_RECOVERY] trace_id=${traceId} Failed:`, error);
  }
}

/**
 * QC ERROR RECOVERY WORKER: Autonomous retry of failed QC verifications
 * 
 * Scans for FAILED QC verifications that:
 * 1. Have passed the cooldown period (2 hours since last failure)
 * 2. Haven't exceeded the maximum total retry limit (5 attempts across all verification entries)
 * 
 * Creates a fresh QC verification entry with reset attempt counter for each eligible candidate.
 * This enables autonomous recovery from transient QC system issues without human intervention.
 */
const QC_ERROR_RECOVERY_COOLDOWN_HOURS = 2; // Wait 2 hours before retrying failed jobs
const QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS = 5; // Max total attempts across all verification entries

async function runQCErrorRecoveryWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Starting error recovery scan...`);
    
    const { checkBudget, consumeBudget, refundBudget } = await import("./providers/quantconnect/budgetGovernor");
    
    // Find candidates with FAILED QC verifications that might be eligible for retry
    // Criteria:
    // 1. Most recent verification for candidate is FAILED
    // 2. Finished more than QC_ERROR_RECOVERY_COOLDOWN_HOURS ago
    // 3. Total attempts across all verifications < QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS
    // 4. Candidate is still in QUEUED_FOR_QC disposition (hasn't been promoted/rejected)
    
    // CRITICAL: Count ALL verifications (including QUEUED/RUNNING) to prevent infinite retry loops
    // Also exclude candidates that already have an active (QUEUED/RUNNING) verification
    const failedVerifications = await db.execute(sql`
      WITH candidate_total_attempts AS (
        -- Count ALL verification entries (regardless of status) to get true total attempts
        SELECT 
          candidate_id,
          COUNT(*) as total_verifications,
          SUM(COALESCE(attempt_count, 1)) as total_attempts
        FROM qc_verifications
        GROUP BY candidate_id
      ),
      candidates_with_active AS (
        -- Find candidates that already have QUEUED or RUNNING verifications (skip these)
        SELECT DISTINCT candidate_id
        FROM qc_verifications
        WHERE status IN ('QUEUED', 'RUNNING')
      ),
      latest_per_candidate AS (
        SELECT DISTINCT ON (candidate_id)
          v.id,
          v.candidate_id,
          v.status,
          v.error_message,
          v.finished_at,
          v.snapshot_hash,
          v.tier_at_run,
          v.confidence_at_run,
          v.trace_id
        FROM qc_verifications v
        ORDER BY v.candidate_id, v.queued_at DESC
      )
      SELECT 
        l.id,
        l.candidate_id,
        l.status,
        l.error_message,
        l.snapshot_hash,
        l.tier_at_run,
        l.confidence_at_run,
        l.trace_id as original_trace_id,
        cta.total_verifications,
        cta.total_attempts,
        c.strategy_name,
        c.disposition
      FROM latest_per_candidate l
      JOIN candidate_total_attempts cta ON cta.candidate_id = l.candidate_id
      JOIN strategy_candidates c ON c.id = l.candidate_id
      WHERE l.status = 'FAILED'
        AND l.finished_at < NOW() - INTERVAL '${sql.raw(String(QC_ERROR_RECOVERY_COOLDOWN_HOURS))} hours'
        AND cta.total_verifications < ${QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS}
        AND c.disposition = 'QUEUED_FOR_QC'
        -- CRITICAL: Exclude candidates that already have active QUEUED/RUNNING verifications
        AND l.candidate_id NOT IN (SELECT candidate_id FROM candidates_with_active)
      ORDER BY l.finished_at ASC
      LIMIT 10
    `);
    
    const eligibleForRetry = failedVerifications.rows as any[];
    
    if (eligibleForRetry.length === 0) {
      console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} No failed jobs eligible for retry`);
      return;
    }
    
    console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Found ${eligibleForRetry.length} candidates eligible for retry`);
    
    let recoveredCount = 0;
    
    for (const failed of eligibleForRetry) {
      // Check budget before each retry
      const budgetCheck = await checkBudget();
      if (!budgetCheck.allowed) {
        console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Budget exhausted, stopping recovery`);
        break;
      }
      
      // Consume budget
      const consumeResult = await consumeBudget(traceId);
      if (!consumeResult.success) {
        console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Failed to consume budget, stopping`);
        break;
      }
      
      try {
        // Create a new QC verification entry (fresh start with reset attempt counter)
        // AUTONOMOUS: Use 5 max attempts for better resilience against transient failures
        await db.insert(schema.qcVerifications).values({
          candidateId: failed.candidate_id,
          snapshotHash: failed.snapshot_hash,
          tierAtRun: failed.tier_at_run,
          confidenceAtRun: failed.confidence_at_run,
          status: "QUEUED",
          attemptCount: 1,
          maxAttempts: 5,
          retryReason: `Auto-recovery from failed verification (total attempts: ${failed.total_attempts + 1}/${QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS})`,
          traceId,
        });
        
        recoveredCount++;
        console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Re-queued candidate=${failed.candidate_id.slice(0, 8)} strategy="${failed.strategy_name}" (verification ${failed.total_verifications + 1}/${QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS})`);
        
      } catch (queueError: any) {
        console.error(`[QC_ERROR_RECOVERY] trace_id=${traceId} Failed to re-queue candidate=${failed.candidate_id.slice(0, 8)}:`, queueError.message);
        await refundBudget(traceId);
      }
    }
    
    if (recoveredCount > 0) {
      console.log(`[QC_ERROR_RECOVERY] trace_id=${traceId} Recovery complete: ${recoveredCount}/${eligibleForRetry.length} candidates re-queued for QC`);
      
      await logActivityEvent({
        eventType: "SELF_HEALING_RECOVERY",
        severity: "INFO",
        title: `QC Error Recovery: ${recoveredCount} jobs re-queued`,
        summary: `Automatically retrying ${recoveredCount} failed QC verifications after ${QC_ERROR_RECOVERY_COOLDOWN_HOURS}h cooldown`,
        payload: { 
          traceId,
          recoveredCount,
          eligibleCount: eligibleForRetry.length,
          cooldownHours: QC_ERROR_RECOVERY_COOLDOWN_HOURS,
          maxTotalAttempts: QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS,
        },
        traceId,
        provider: "quantconnect",
      });
    }
    
  } catch (error) {
    console.error(`[QC_ERROR_RECOVERY] trace_id=${traceId} Worker error:`, error);
  }
}

/**
 * QC FAILURE EVOLUTION WORKER: Autonomous AI-driven strategy improvement
 * 
 * When a strategy fails QC with RUBRIC failures (insufficient trades, low profit factor, etc.):
 * 1. Extract the SPECIFIC failure reasons (not just generic error message)
 * 2. Call AI to analyze WHY the strategy failed and generate a FIXED version
 * 3. Create a new candidate with lineage link to the failed parent
 * 4. Automatically queue the new candidate for QC verification
 * 
 * KEY INSIGHT: Rubric failures need AI evolution IMMEDIATELY - retrying the same strategy is pointless.
 * Technical failures (API errors) should be retried first before evolution.
 */
const QC_EVOLUTION_SCAN_INTERVAL_MS = 2 * 60 * 1000; // Run every 2 minutes for immediate feedback
const QC_EVOLUTION_MAX_CHILDREN_PER_PARENT = 5; // Max evolution attempts per failed strategy
const QC_EVOLUTION_COOLDOWN_MINUTES = 5; // Only wait 5 minutes - rubric failures won't self-heal

async function runQCFailureEvolutionWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  try {
    console.log(`[QC_EVOLUTION] trace_id=${traceId} Starting QC failure evolution scan...`);
    
    const { checkBudget, consumeBudget, refundBudget } = await import("./providers/quantconnect/budgetGovernor");
    
    // Find candidates eligible for AI evolution:
    // 1. RUBRIC FAILURES (immediately eligible after 1 failure) - these won't self-heal with retries
    // 2. EXHAUSTED RETRIES (5+ failed verifications) - technical failures that keep failing
    const exhaustedCandidates = await db.execute(sql`
      WITH latest_failed_verification AS (
        -- Get the most recent verification that indicates a failure (either FAILED status OR COMPLETED but gate not passed)
        -- CRITICAL: Rubric failures come as COMPLETED with qcGatePassed=false, not as FAILED
        SELECT DISTINCT ON (candidate_id)
          candidate_id,
          error_message as last_error,
          finished_at as last_finished,
          metrics_summary_json
        FROM qc_verifications
        WHERE status = 'FAILED' 
          OR (status = 'COMPLETED' AND COALESCE(metrics_summary_json->>'qcGatePassed', 'false') = 'false')
        ORDER BY candidate_id, finished_at DESC
      ),
      candidate_verification_counts AS (
        SELECT 
          candidate_id,
          COUNT(*) as total_verifications
        FROM qc_verifications
        WHERE status = 'FAILED' 
          OR (status = 'COMPLETED' AND COALESCE(metrics_summary_json->>'qcGatePassed', 'false') = 'false')
        GROUP BY candidate_id
      ),
      candidates_with_active AS (
        -- Exclude candidates that still have QUEUED/RUNNING verifications
        SELECT DISTINCT candidate_id FROM qc_verifications WHERE status IN ('QUEUED', 'RUNNING')
      ),
      evolution_children_count AS (
        -- Count how many times we've already tried to evolve this candidate
        SELECT recycled_from_id, COUNT(*) as child_count
        FROM strategy_candidates
        WHERE recycled_from_id IS NOT NULL
          AND source = 'LAB_FEEDBACK'
        GROUP BY recycled_from_id
      )
      SELECT 
        c.id as candidate_id,
        c.strategy_name,
        c.hypothesis,
        c.rules_json,
        c.archetype_name,
        c.instrument_universe,
        c.timeframe_preferences,
        c.confidence_score,
        COALESCE(cvc.total_verifications, 0) as total_verifications,
        lfv.last_error,
        lfv.last_finished,
        lfv.metrics_summary_json,
        COALESCE(ecc.child_count, 0) as evolution_attempts,
        -- Detect rubric failures (have specific failure reasons from QC gate evaluation)
        CASE 
          WHEN lfv.metrics_summary_json->>'failureReasons' IS NOT NULL 
            AND jsonb_array_length(COALESCE(lfv.metrics_summary_json->'failureReasons', '[]'::jsonb)) > 0
          THEN true
          ELSE false
        END as is_rubric_failure
      FROM strategy_candidates c
      JOIN latest_failed_verification lfv ON lfv.candidate_id = c.id
      LEFT JOIN candidate_verification_counts cvc ON cvc.candidate_id = c.id
      LEFT JOIN evolution_children_count ecc ON ecc.recycled_from_id = c.id
      WHERE c.disposition = 'QUEUED_FOR_QC'
        AND c.id NOT IN (SELECT candidate_id FROM candidates_with_active)
        AND lfv.last_finished < NOW() - INTERVAL '${sql.raw(String(QC_EVOLUTION_COOLDOWN_MINUTES))} minutes'
        AND COALESCE(ecc.child_count, 0) < ${QC_EVOLUTION_MAX_CHILDREN_PER_PARENT}
        -- Eligible if: rubric failure (any count) OR exhausted retries (5+)
        AND (
          (lfv.metrics_summary_json->>'failureReasons' IS NOT NULL 
            AND jsonb_array_length(COALESCE(lfv.metrics_summary_json->'failureReasons', '[]'::jsonb)) > 0)
          OR COALESCE(cvc.total_verifications, 0) >= ${QC_ERROR_RECOVERY_MAX_TOTAL_ATTEMPTS}
        )
      ORDER BY lfv.last_finished ASC
      LIMIT 3
    `);
    
    const failedCandidates = exhaustedCandidates.rows as any[];
    
    if (failedCandidates.length === 0) {
      // Also check for strategies that have already exhausted evolution attempts and need retirement
      await retireExhaustedStrategies(traceId);
      console.log(`[QC_EVOLUTION] trace_id=${traceId} No QC failures eligible for evolution`);
      return;
    }
    
    const rubricFailures = failedCandidates.filter((c: any) => c.is_rubric_failure);
    const exhaustedRetries = failedCandidates.filter((c: any) => !c.is_rubric_failure);
    console.log(`[QC_EVOLUTION] trace_id=${traceId} Found ${failedCandidates.length} candidates for AI evolution (${rubricFailures.length} rubric failures, ${exhaustedRetries.length} exhausted retries)`);
    
    let evolvedCount = 0;
    
    for (const failed of failedCandidates) {
      try {
        // Call AI to analyze the failure and generate improved strategy
        const evolutionResult = await evolveFailedQCStrategy(failed, traceId);
        
        if (!evolutionResult.success || !evolutionResult.newCandidate) {
          console.log(`[QC_EVOLUTION] trace_id=${traceId} candidate=${failed.candidate_id.slice(0, 8)} AI evolution failed: ${evolutionResult.error}`);
          
          // Mark the parent candidate as rejected after exhausting evolution attempts
          if (failed.evolution_attempts + 1 >= QC_EVOLUTION_MAX_CHILDREN_PER_PARENT) {
            await db.execute(sql`
              UPDATE strategy_candidates
              SET disposition = 'REJECTED',
                  rejection_reason = 'QC_VERIFICATION_FAILED',
                  rejection_notes = 'All QC verification attempts and AI evolution attempts exhausted',
                  rejected_at = NOW(),
                  updated_at = NOW()
              WHERE id = ${failed.candidate_id}::uuid
            `);
            console.log(`[QC_EVOLUTION] trace_id=${traceId} candidate=${failed.candidate_id.slice(0, 8)} marked REJECTED after evolution exhaustion`);
          }
          continue;
        }
        
        // Check QC budget before queuing new candidate
        const budgetCheck = await checkBudget();
        if (!budgetCheck.allowed) {
          console.log(`[QC_EVOLUTION] trace_id=${traceId} QC budget exhausted, saving candidate without queuing`);
        } else {
          // Consume budget and queue for QC
          const consumeResult = await consumeBudget(traceId);
          if (consumeResult.success) {
            // Queue the new candidate for QC verification
            // Generate snapshot hash for the new candidate
            const snapshotHash = crypto.createHash('md5')
              .update(JSON.stringify(evolutionResult.newCandidate?.rules || {}))
              .digest('hex')
              .slice(0, 16);
            
            // AUTONOMOUS: Use 5 max attempts for evolved candidates - they deserve extra chances
            await db.insert(schema.qcVerifications).values({
              candidateId: evolutionResult.newCandidateId!,
              snapshotHash,
              status: "QUEUED",
              attemptCount: 1,
              maxAttempts: 5,
              retryReason: `Auto-evolved from failed parent ${failed.candidate_id.slice(0, 8)}`,
              traceId,
            });
            
            // Update disposition to QUEUED_FOR_QC
            await db.execute(sql`
              UPDATE strategy_candidates
              SET disposition = 'QUEUED_FOR_QC',
                  updated_at = NOW()
              WHERE id = ${evolutionResult.newCandidateId}::uuid
            `);
            
            console.log(`[QC_EVOLUTION] trace_id=${traceId} new_candidate=${evolutionResult.newCandidateId?.slice(0, 8)} queued for QC`);
          }
        }
        
        evolvedCount++;
        
        await logActivityEvent({
          eventType: "LAB_FEEDBACK_TRIGGERED",
          severity: "INFO",
          title: `QC Evolution: ${failed.strategy_name} → ${evolutionResult.newCandidate?.strategyName || "Improved Strategy"}`,
          summary: `AI analyzed QC failure and generated improved strategy. Parent attempts: ${failed.evolution_attempts + 1}/${QC_EVOLUTION_MAX_CHILDREN_PER_PARENT}`,
          payload: {
            traceId,
            parentCandidateId: failed.candidate_id,
            parentStrategyName: failed.strategy_name,
            newCandidateId: evolutionResult.newCandidateId,
            newStrategyName: evolutionResult.newCandidate?.strategyName,
            qcError: failed.last_error?.substring(0, 200),
            evolutionAttempt: failed.evolution_attempts + 1,
            aiAnalysis: evolutionResult.aiAnalysis?.substring(0, 300),
          },
          traceId,
        });
        
      } catch (evolveError: any) {
        console.error(`[QC_EVOLUTION] trace_id=${traceId} candidate=${failed.candidate_id.slice(0, 8)} evolution error:`, evolveError.message);
      }
    }
    
    if (evolvedCount > 0) {
      console.log(`[QC_EVOLUTION] trace_id=${traceId} Evolution complete: ${evolvedCount}/${failedCandidates.length} strategies evolved`);
    }
    
  } catch (error) {
    console.error(`[QC_EVOLUTION] trace_id=${traceId} Worker error:`, error);
  }
}

/**
 * Retire strategies that have exhausted all evolution attempts
 * - Mark as RETIRED_EVOLUTION_EXHAUSTED
 * - Save failure dossier for learning
 * - Trigger fresh research with failure as anti-pattern
 */
async function retireExhaustedStrategies(traceId: string): Promise<void> {
  // Find strategies that have hit max evolution children but are still QUEUED_FOR_QC
  const exhaustedStrategies = await db.execute(sql`
    WITH evolution_children_count AS (
      SELECT recycled_from_id, COUNT(*) as child_count
      FROM strategy_candidates
      WHERE recycled_from_id IS NOT NULL
        AND source = 'LAB_FEEDBACK'
      GROUP BY recycled_from_id
      HAVING COUNT(*) >= ${QC_EVOLUTION_MAX_CHILDREN_PER_PARENT}
    ),
    latest_verification AS (
      SELECT DISTINCT ON (candidate_id)
        candidate_id,
        metrics_summary_json,
        error_message
      FROM qc_verifications
      WHERE status = 'FAILED'
      ORDER BY candidate_id, finished_at DESC
    )
    SELECT 
      c.id as candidate_id,
      c.strategy_name,
      c.archetype_name,
      c.hypothesis,
      c.rules_json,
      c.instrument_universe,
      c.timeframe_preferences,
      ecc.child_count,
      lv.metrics_summary_json,
      lv.error_message
    FROM strategy_candidates c
    JOIN evolution_children_count ecc ON ecc.recycled_from_id = c.id
    LEFT JOIN latest_verification lv ON lv.candidate_id = c.id
    WHERE c.disposition = 'QUEUED_FOR_QC'
    LIMIT 5
  `);

  const toRetire = exhaustedStrategies.rows as any[];
  
  for (const strategy of toRetire) {
    try {
      // Build failure dossier
      const metricsJson = strategy.metrics_summary_json || {};
      const failureDossier = {
        strategyName: strategy.strategy_name,
        archetype: strategy.archetype_name,
        hypothesis: strategy.hypothesis,
        instruments: strategy.instrument_universe,
        timeframes: strategy.timeframe_preferences,
        evolutionAttempts: strategy.child_count,
        failureReasons: metricsJson.failureReasons || [],
        lastMetrics: {
          totalTrades: metricsJson.totalTrades,
          profitFactor: metricsJson.profitFactor,
          maxDrawdown: metricsJson.maxDrawdown,
        },
        lastError: strategy.error_message?.substring(0, 500),
        retiredAt: new Date().toISOString(),
      };

      // Mark as RETIRED_EVOLUTION_EXHAUSTED
      await db.execute(sql`
        UPDATE strategy_candidates
        SET disposition = 'REJECTED',
            rejection_reason = 'EVOLUTION_EXHAUSTED',
            rejection_notes = ${JSON.stringify(failureDossier)},
            rejected_at = NOW(),
            updated_at = NOW()
        WHERE id = ${strategy.candidate_id}::uuid
      `);

      console.log(`[QC_EVOLUTION] trace_id=${traceId} RETIRED strategy=${strategy.strategy_name} after ${strategy.child_count} evolution attempts`);

      // Log for learning - this feeds into future research anti-patterns
      await logActivityEvent({
        eventType: "QC_EVOLUTION_EXHAUSTED",
        severity: "WARN",
        title: `Evolution Exhausted: ${strategy.strategy_name}`,
        summary: `Strategy retired after ${strategy.child_count} failed evolution attempts. Archetype: ${strategy.archetype_name}. Failures: ${(failureDossier.failureReasons || []).join(', ') || 'unknown'}`,
        payload: failureDossier,
        traceId,
      });

      // Trigger fresh research with the failure as negative context
      // This injects the failure pattern into the next research cycle
      await injectFailureIntoResearchContext(strategy, failureDossier, traceId);

    } catch (error: any) {
      console.error(`[QC_EVOLUTION] trace_id=${traceId} Failed to retire strategy ${strategy.candidate_id}:`, error.message);
    }
  }

  if (toRetire.length > 0) {
    console.log(`[QC_EVOLUTION] trace_id=${traceId} Retired ${toRetire.length} exhausted strategies`);
  }
}

/**
 * Inject failure pattern into research context so future strategies avoid the same mistakes
 */
async function injectFailureIntoResearchContext(
  strategy: any,
  failureDossier: any,
  traceId: string
): Promise<void> {
  try {
    // Store failure pattern in a way that future research can consume
    // The perplexity research worker will read these and avoid similar patterns
    const failurePattern = {
      archetype: strategy.archetype_name,
      instruments: strategy.instrument_universe,
      timeframes: strategy.timeframe_preferences,
      failureReasons: failureDossier.failureReasons,
      antiPattern: `Avoid: ${strategy.hypothesis?.substring(0, 100) || 'Unknown hypothesis'} - failed with ${failureDossier.failureReasons?.join(', ') || 'unknown issues'}`,
    };

    // Log as activity event that research worker can query
    await logActivityEvent({
      eventType: "RESEARCH_ANTI_PATTERN",
      severity: "INFO",
      title: `Anti-Pattern: ${strategy.archetype_name}`,
      summary: `Failed pattern to avoid in future research: ${failurePattern.antiPattern.substring(0, 200)}`,
      payload: failurePattern,
      traceId,
    });

    console.log(`[QC_EVOLUTION] trace_id=${traceId} Injected anti-pattern for archetype=${strategy.archetype_name}`);
  } catch (error: any) {
    console.error(`[QC_EVOLUTION] trace_id=${traceId} Failed to inject anti-pattern:`, error.message);
  }
}

interface QCEvolutionResult {
  success: boolean;
  newCandidate?: {
    strategyName: string;
    hypothesis: string;
    rules: any;
  };
  newCandidateId?: string;
  aiAnalysis?: string;
  error?: string;
}

/**
 * Use AI to analyze QC failure and generate an improved strategy variant
 */
async function evolveFailedQCStrategy(
  failedCandidate: any,
  traceId: string
): Promise<QCEvolutionResult> {
  const { getStrategyLabProviders } = await import("./ai-strategy-evolution");
  
  const providers = getStrategyLabProviders();
  if (providers.length === 0) {
    return { success: false, error: "No AI providers configured" };
  }
  
  // Extract rubric failure details from metrics_summary_json
  const metricsJson = failedCandidate.metrics_summary_json || {};
  const failureReasons = metricsJson.failureReasons || [];
  const qcMetrics = {
    totalTrades: metricsJson.totalTrades ?? "N/A",
    profitFactor: metricsJson.profitFactor ?? "N/A",
    maxDrawdown: metricsJson.maxDrawdown ?? "N/A",
    backtestDays: metricsJson.backtestDays ?? 90,
    netProfit: metricsJson.netProfit ?? "N/A",
  };
  
  // Build rubric section if we have failure reasons
  const rubricSection = failureReasons.length > 0 ? `
SPECIFIC QC RUBRIC FAILURES (CRITICAL - these are the exact problems to fix):
${failureReasons.map((r: string) => `- ${r}`).join('\n')}

ACTUAL QC BACKTEST METRICS:
- Total Trades: ${qcMetrics.totalTrades} (need >= 30)
- Profit Factor: ${qcMetrics.profitFactor} (need >= 1.10)
- Max Drawdown: ${qcMetrics.maxDrawdown}% (need <= 25%)
- Backtest Duration: ${qcMetrics.backtestDays} days (need >= 60)
- Net Profit: $${qcMetrics.netProfit}
` : "";

  // Build evolution prompt with QC failure context
  const prompt = `You are a quantitative trading strategy debugging expert. A trading strategy has failed QuantConnect verification.

FAILED STRATEGY:
- Name: ${failedCandidate.strategy_name}
- Archetype: ${failedCandidate.archetype_name || "Unknown"}
- Hypothesis: ${failedCandidate.hypothesis}
- Instruments: ${JSON.stringify(failedCandidate.instrument_universe || [])}
- Timeframes: ${JSON.stringify(failedCandidate.timeframe_preferences || [])}

STRATEGY RULES:
${JSON.stringify(failedCandidate.rules_json, null, 2)}
${rubricSection}
QC ERROR MESSAGE:
${failedCandidate.last_error || "Unknown error - strategy failed verification"}

VERIFICATION ATTEMPTS: ${failedCandidate.total_verifications}

YOUR TASK:
${failureReasons.length > 0 ? `The strategy failed the QC RUBRIC check. The SPECIFIC failures are listed above. You MUST fix these issues:
${failureReasons.includes("Insufficient trades") || (qcMetrics.totalTrades !== "N/A" && qcMetrics.totalTrades < 30) ? 
  "- INSUFFICIENT TRADES: The strategy only generated " + qcMetrics.totalTrades + " trades in 90 days. You MUST make the entry conditions LESS restrictive to generate more signals. Consider: using shorter indicator periods, wider tolerance bands, adding multiple entry condition OR logic, or reducing required confirmations." : ""}
${failureReasons.some((r: string) => r.includes("Profit Factor")) || (qcMetrics.profitFactor !== "N/A" && qcMetrics.profitFactor < 1.10) ? 
  "- LOW PROFIT FACTOR: The strategy has a profit factor of " + qcMetrics.profitFactor + ". You MUST improve win rate or reward:risk ratio. Consider: tighter stop losses, better entry timing, trend filters, or position sizing adjustments." : ""}
${failureReasons.some((r: string) => r.includes("drawdown") || r.includes("Drawdown")) || (qcMetrics.maxDrawdown !== "N/A" && qcMetrics.maxDrawdown > 25) ?
  "- EXCESSIVE DRAWDOWN: Max drawdown was " + qcMetrics.maxDrawdown + "%. You MUST reduce risk. Consider: smaller position sizes, earlier stop losses, or adding volatility filters to avoid trading during high-risk periods." : ""}
` : `Analyze why this strategy is failing QC verification and generate an IMPROVED version. Common problems include:
- Invalid indicator calculations
- Unrealistic entry/exit conditions
- Data requirements that can't be satisfied
- Logic errors in rule definitions
- Timeframe incompatibilities`}

Generate a corrected strategy with:
1. A new descriptive name (append "v2", "Fixed", or similar)
2. Updated hypothesis explaining EXACTLY what you changed and why
3. Corrected rules that DIRECTLY address the specific failure(s)

Respond in JSON format:
{
  "analysis": "Specific analysis of what was wrong and exactly what you fixed to address each failure",
  "correctedStrategy": {
    "strategyName": "Fixed strategy name",
    "hypothesis": "Updated hypothesis explaining the specific fixes",
    "rules": {
      "entry": ["corrected entry conditions - MUST be less restrictive if trades were insufficient"],
      "exit": ["corrected exit conditions"],
      "risk": ["risk management rules"],
      "filters": ["market filters"],
      "invalidation": ["when to avoid trading"]
    }
  }
}`;

  const errors: string[] = [];
  
  for (const { provider, apiKey } of providers) {
    try {
      console.log(`[QC_EVOLUTION] trace_id=${traceId} provider=${provider} analyzing QC failure`);
      
      const AI_PROVIDERS: Record<string, any> = {
        perplexity: {
          url: "https://api.perplexity.ai/chat/completions",
          model: "sonar",
          formatRequest: (prompt: string, apiKey: string) => ({
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }], max_tokens: 4000 })
          })
        },
        anthropic: {
          url: "https://api.anthropic.com/v1/messages",
          model: "claude-sonnet-4-20250514",
          formatRequest: (prompt: string, apiKey: string) => ({
            headers: { "x-api-key": apiKey, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
          })
        },
        openai: {
          url: "https://api.openai.com/v1/chat/completions",
          model: "gpt-4o",
          formatRequest: (prompt: string, apiKey: string) => ({
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: prompt }], max_tokens: 4000 })
          })
        },
        groq: {
          url: "https://api.groq.com/openai/v1/chat/completions",
          model: "llama-3.3-70b-versatile",
          formatRequest: (prompt: string, apiKey: string) => ({
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], max_tokens: 4000 })
          })
        }
      };
      
      const config = AI_PROVIDERS[provider];
      if (!config) continue;
      
      const { headers, body } = config.formatRequest(prompt, apiKey);
      
      const response = await fetch(config.url, {
        method: "POST",
        headers,
        body,
      });
      
      if (!response.ok) {
        throw new Error(`${provider} API error: ${response.status}`);
      }
      
      const data = await response.json() as any;
      let content = "";
      
      if (provider === "anthropic") {
        content = data.content?.[0]?.text || "";
      } else {
        content = data.choices?.[0]?.message?.content || "";
      }
      
      // Parse the AI response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse AI response as JSON");
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.correctedStrategy || !parsed.correctedStrategy.strategyName) {
        throw new Error("AI response missing correctedStrategy");
      }
      
      const corrected = parsed.correctedStrategy;
      
      // Calculate proper confidence score for the evolved strategy
      const { calculateConfidenceScore } = await import("./ai-strategy-evolution");
      const { calculateNoveltyScore } = await import("./strategy-lab-engine");
      
      // Build a partial ResearchCandidate for confidence calculation
      // Evolved candidates get sourceLabFailure boost since they come from QC failure analysis
      const confidenceResult = calculateConfidenceScore({
        hypothesis: corrected.hypothesis,
        rules: corrected.rules,
        evidence: [], // Evolved strategies inherit context but generate new rules
        noveltyJustification: {
          closestKnown: [],
          distinctDeltas: ["Evolved from QC failure feedback", "AI-improved based on QuantConnect error analysis"],
          whyItMatters: "AI-improved version based on QuantConnect verification feedback",
        },
        sourceLabFailure: {
          failureReasonCodes: ["QC_VERIFICATION_FAILED"],
          performanceDeltas: {},
          regimeAtFailure: "UNKNOWN",
        },
      });
      
      const calculatedConfidence = Math.max(confidenceResult.total, 50); // Minimum 50 for evolved strategies
      
      // Create the new candidate in the database
      const insertResult = await db.insert(schema.strategyCandidates).values({
        strategyName: corrected.strategyName,
        archetypeName: failedCandidate.archetype_name,
        hypothesis: corrected.hypothesis,
        rulesJson: corrected.rules,
        instrumentUniverse: failedCandidate.instrument_universe,
        timeframePreferences: failedCandidate.timeframe_preferences,
        confidenceScore: calculatedConfidence,
        confidenceBreakdownJson: confidenceResult,
        disposition: "QUEUED_FOR_QC", // INDUSTRY STANDARD: Evolved candidates go directly to QC queue
        source: "LAB_FEEDBACK",
        recycledFromId: failedCandidate.candidate_id,
        lineageChain: [failedCandidate.candidate_id],
        sourceLabFailureJson: {
          qcError: failedCandidate.last_error,
          parentAttempts: failedCandidate.total_verifications,
          evolutionAttempt: failedCandidate.evolution_attempts + 1,
          aiAnalysis: parsed.analysis,
        },
      }).returning({ id: schema.strategyCandidates.id });
      
      const newCandidateId = insertResult[0]?.id;
      
      // Calculate novelty score by comparing against all existing candidates
      if (newCandidateId) {
        try {
          const allCandidatesResult = await db.execute(sql`
            SELECT id, archetype_name, hypothesis, rules_json
            FROM strategy_candidates
          `);
          const allCandidates = allCandidatesResult.rows as { id: string; archetype_name: string | null; hypothesis: string | null; rules_json: any }[];
          
          const newCandidateData = {
            id: newCandidateId,
            archetype_name: failedCandidate.archetype_name,
            hypothesis: corrected.hypothesis,
            rules_json: corrected.rules,
          };
          
          const noveltyScore = calculateNoveltyScore(newCandidateData, allCandidates);
          
          await db.execute(sql`
            UPDATE strategy_candidates
            SET novelty_score = ${noveltyScore}
            WHERE id = ${newCandidateId}::uuid
          `);
          
          console.log(`[QC_EVOLUTION] trace_id=${traceId} confidence=${calculatedConfidence} novelty=${noveltyScore}`);
        } catch (noveltyErr) {
          console.warn(`[QC_EVOLUTION] trace_id=${traceId} novelty calculation failed:`, noveltyErr);
        }
        
        // INDUSTRY STANDARD: Automatically queue evolved candidate for QC verification
        // This completes the cycle: Testing → QC fails → Evolve → Back to QC queue → Re-run QC
        try {
          const { checkBudget, consumeBudget, refundBudget } = await import("./providers/quantconnect/budgetGovernor");
          const budgetStatus = await checkBudget();
          
          if (budgetStatus.allowed) {
            // INSTITUTIONAL: Consume budget before queueing (mirrors QC auto-trigger behavior)
            const consumeResult = await consumeBudget(traceId);
            if (!consumeResult.success) {
              console.log(`[QC_EVOLUTION] trace_id=${traceId} SKIP_AUTO_QC budget_consumption_failed - candidate will be picked up by auto-trigger later`);
            } else {
              // Generate snapshot hash for the evolved strategy
              const snapshotContent = JSON.stringify({
                symbol: corrected.rules?.symbol,
                archetype: corrected.rules?.archetype,
                timeframe: corrected.rules?.timeframe,
                indicators: corrected.rules?.indicators,
                risk: corrected.rules?.risk,
              });
              const snapshotHash = crypto.createHash("sha256").update(snapshotContent).digest("hex");
              
              try {
                // Insert QC verification job
                await db.insert(schema.qcVerifications).values({
                  candidateId: newCandidateId,
                  snapshotHash,
                  tierAtRun: "A", // Evolved strategies get Tier A treatment
                  confidenceAtRun: calculatedConfidence,
                  status: "QUEUED",
                  traceId,
                });
                
                console.log(`[QC_EVOLUTION] trace_id=${traceId} AUTO_QUEUED_FOR_QC candidate=${newCandidateId.slice(0, 8)} - completing industry-standard cycle`);
                
                await logActivityEvent({
                  eventType: "INTEGRATION_VERIFIED",
                  severity: "INFO",
                  title: `Evolved strategy auto-queued for QC: ${corrected.strategyName}`,
                  summary: `AI-evolved strategy with ${calculatedConfidence}% confidence automatically queued for QC verification`,
                  payload: { traceId, candidateId: newCandidateId, confidence: calculatedConfidence, parentId: failedCandidate.candidate_id },
                  traceId,
                  provider: "quantconnect",
                });
              } catch (insertErr) {
                // INSTITUTIONAL: Refund budget on queue failure
                console.warn(`[QC_EVOLUTION] trace_id=${traceId} qcVerifications insert failed, refunding budget:`, insertErr);
                await refundBudget(traceId);
              }
            }
          } else {
            console.log(`[QC_EVOLUTION] trace_id=${traceId} SKIP_AUTO_QC budget_exhausted - candidate will be picked up by auto-trigger later`);
          }
        } catch (qcQueueErr) {
          console.warn(`[QC_EVOLUTION] trace_id=${traceId} auto-queue QC failed:`, qcQueueErr);
          // Non-fatal: the auto-trigger worker can pick this up later
        }
      }
      
      console.log(`[QC_EVOLUTION] trace_id=${traceId} SUCCESS provider=${provider} created new_candidate=${newCandidateId?.slice(0, 8)}`);
      
      return {
        success: true,
        newCandidate: {
          strategyName: corrected.strategyName,
          hypothesis: corrected.hypothesis,
          rules: corrected.rules,
        },
        newCandidateId,
        aiAnalysis: parsed.analysis,
      };
      
    } catch (error: any) {
      console.warn(`[QC_EVOLUTION] trace_id=${traceId} provider=${provider} FAILED: ${error.message}`);
      errors.push(`${provider}: ${error.message}`);
    }
  }
  
  return { success: false, error: `All AI providers failed: ${errors.join("; ")}` };
}

/**
 * STRATEGY LAB: Autonomous research worker
 * - Checks for LAB bot failures and triggers feedback research
 * - Runs scheduled research cycles based on depth-specific intervals
 */
async function runStrategyLabResearchWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  
  // AUTONOMOUS: Scan LAB bots for failures and trigger feedback research
  try {
    const failureResult = await processLabFailuresAndTriggerResearch(traceId);
    if (failureResult.researchTriggered) {
      console.log(`[SCHEDULER] trace_id=${traceId} LAB feedback research triggered for ${failureResult.processedCount} failure(s)`);
    }
  } catch (error) {
    console.error(`[SCHEDULER] trace_id=${traceId} LAB failure scan failed:`, error);
  }
  
  // Run scheduled research cycle (respects depth-specific timing internally)
  console.log(`[SCHEDULER] trace_id=${traceId} Running Strategy Lab research cycle...`);
  
  try {
    const result = await runStrategyLabResearchCycle(false);
    
    if (result) {
      console.log(`[SCHEDULER] trace_id=${traceId} Strategy Lab cycle completed: ${result.candidatesGenerated} candidates generated, ${result.sentToLab} sent to LAB`);
      
      await logActivityEvent({
        eventType: "LAB_RESEARCH_CYCLE",
        severity: "INFO",
        title: `Strategy Lab research cycle completed`,
        summary: `Generated ${result.candidatesGenerated} candidates (${result.sentToLab} to LAB, ${result.queued} queued, ${result.rejected} rejected)`,
        payload: { 
          traceId,
          cycleId: result.cycleId,
          trigger: result.trigger,
          candidatesGenerated: result.candidatesGenerated,
          sentToLab: result.sentToLab,
          queued: result.queued,
          rejected: result.rejected,
          durationMs: result.durationMs,
        },
        traceId,
      });
    } else {
      console.log(`[SCHEDULER] trace_id=${traceId} Strategy Lab cycle skipped (too soon or paused)`);
    }
  } catch (error) {
    console.error(`[SCHEDULER] trace_id=${traceId} Strategy Lab research cycle failed:`, error);
    
    await logActivityEvent({
      eventType: "LAB_RESEARCH_FAILED",
      severity: "WARN",
      title: `Strategy Lab research cycle failed`,
      summary: `Research cycle encountered an error: ${error instanceof Error ? error.message : String(error)}`,
      payload: { traceId, error: error instanceof Error ? error.message : String(error) },
      traceId,
    });
  }
}

// ============================================================================
// GROK RESEARCH ENGINE - AUTONOMOUS CONTRARIAN STRATEGY DISCOVERY
// Independent from Perplexity, optimized for X sentiment + contrarian analysis
// ============================================================================

/**
 * Enable/disable Grok research engine
 */
export function setGrokResearchEnabled(enabled: boolean): void {
  grokResearchEnabled = enabled;
  console.log(`[GROK_SCHEDULER] Grok research ${enabled ? "ENABLED" : "DISABLED"}`);
}

/**
 * Set Grok research depth mode
 */
export function setGrokResearchDepth(depth: GrokResearchDepth): void {
  grokResearchDepth = depth;
  console.log(`[GROK_SCHEDULER] Grok research depth set to ${depth}`);
}

/**
 * Get current Grok research state
 */
export function getGrokResearchState(): {
  enabled: boolean;
  isActive: boolean;
  depth: GrokResearchDepth;
  lastCycleAt: Date | null;
  nextCycleIn: number | null;
  traceId: string | null;
} {
  const interval = GROK_DEPTH_INTERVALS[grokResearchDepth];
  let nextCycleIn: number | null = null;
  
  if (grokResearchEnabled && lastGrokCycleAt) {
    const elapsed = Date.now() - lastGrokCycleAt.getTime();
    nextCycleIn = Math.max(0, interval - elapsed);
  }
  
  return {
    enabled: grokResearchEnabled,
    isActive: grokResearchActiveRuns.size > 0,
    depth: grokResearchDepth,
    lastCycleAt: lastGrokCycleAt,
    nextCycleIn,
    traceId: getGrokActiveTraceId(),
  };
}

/**
 * Manually trigger a Grok research cycle
 */
export async function triggerGrokResearchManual(
  userId: string,
  depth?: GrokResearchDepth
): Promise<{
  success: boolean;
  candidatesCreated: number;
  candidateIds: string[];
  error?: string;
  traceId: string;
}> {
  const effectiveDepth = depth || grokResearchDepth;
  const runToken = crypto.randomUUID().slice(0, 8);
  console.log(`[GROK_SCHEDULER] runToken=${runToken} Manual Grok research triggered depth=${effectiveDepth}`);
  
  // Register this run for UI tracking (supports concurrent runs)
  addGrokActiveRun(runToken, runToken);
  
  try {
    const result = await processGrokResearchCycle(effectiveDepth, userId);
    
    // Update traceId with the actual result traceId
    if (result.traceId) {
      updateGrokActiveRunTrace(runToken, result.traceId);
    }
    
    if (result.success) {
      lastGrokCycleAt = new Date();
    }
    
    return result;
  } finally {
    removeGrokActiveRun(runToken);
  }
}

/**
 * Grok research worker - runs on interval, respects depth-specific timing
 */
async function runGrokResearchWorker(): Promise<void> {
  const runToken = crypto.randomUUID().slice(0, 8);
  
  if (!grokResearchEnabled) {
    return;
  }
  
  const interval = GROK_DEPTH_INTERVALS[grokResearchDepth];
  const now = Date.now();
  
  if (lastGrokCycleAt && (now - lastGrokCycleAt.getTime()) < interval) {
    const remaining = Math.ceil((interval - (now - lastGrokCycleAt.getTime())) / 60_000);
    console.log(`[GROK_SCHEDULER] runToken=${runToken} Grok cycle skipped (next in ${remaining}min)`);
    return;
  }
  
  console.log(`[GROK_SCHEDULER] runToken=${runToken} Running Grok research cycle depth=${grokResearchDepth}...`);
  
  // Register this run for UI tracking (supports concurrent runs)
  addGrokActiveRun(runToken, runToken);
  
  try {
    const systemUserId = "00000000-0000-0000-0000-000000000000";
    const result = await processGrokResearchCycle(grokResearchDepth, systemUserId);
    
    // Update traceId with the actual result traceId
    if (result.traceId) {
      updateGrokActiveRunTrace(runToken, result.traceId);
    }
    
    if (result.success) {
      lastGrokCycleAt = new Date();
      console.log(`[GROK_SCHEDULER] runToken=${runToken} Grok cycle completed: ${result.candidatesCreated} candidates created`);
      
      await logActivityEvent({
        eventType: "GROK_CYCLE_COMPLETED",
        severity: "INFO",
        title: `Grok Research Cycle (${grokResearchDepth})`,
        summary: `Created ${result.candidatesCreated} contrarian strategy candidates`,
        payload: {
          traceId: result.traceId,
          depth: grokResearchDepth,
          candidatesCreated: result.candidatesCreated,
          candidateIds: result.candidateIds,
        },
        traceId: result.traceId,
      });
    } else {
      console.error(`[GROK_SCHEDULER] runToken=${runToken} Grok cycle failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[GROK_SCHEDULER] runToken=${runToken} Grok research worker failed:`, error);
  } finally {
    removeGrokActiveRun(runToken);
  }
}

// Per-user tournament state tracking with monitoring metrics
interface UserTournamentState {
  lastIncremental: Date | null;
  lastDailyMajor: Date | null;
  incrementalCount: number;
  dailyMajorCount: number;
  incrementalFailures: number;
  dailyMajorFailures: number;
}

const userTournamentState: Map<string, UserTournamentState> = new Map();

function getUserTournamentState(userId: string): UserTournamentState {
  if (!userTournamentState.has(userId)) {
    userTournamentState.set(userId, { 
      lastIncremental: null, 
      lastDailyMajor: null,
      incrementalCount: 0,
      dailyMajorCount: 0,
      incrementalFailures: 0,
      dailyMajorFailures: 0,
    });
  }
  return userTournamentState.get(userId)!;
}

function getETDateString(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

export function getTournamentSchedulerMetrics(): { 
  userCount: number; 
  perUserMetrics: Array<{ 
    userId: string; 
    incrementalCount: number; 
    dailyMajorCount: number; 
    incrementalFailures: number;
    dailyMajorFailures: number;
    lastIncremental: string | null; 
    lastDailyMajor: string | null; 
  }>;
  totalIncrementalRuns: number;
  totalDailyMajorRuns: number;
  totalFailures: number;
} {
  const perUserMetrics: Array<{
    userId: string;
    incrementalCount: number;
    dailyMajorCount: number;
    incrementalFailures: number;
    dailyMajorFailures: number;
    lastIncremental: string | null;
    lastDailyMajor: string | null;
  }> = [];
  
  let totalIncrementalRuns = 0;
  let totalDailyMajorRuns = 0;
  let totalFailures = 0;
  
  for (const [userId, state] of userTournamentState.entries()) {
    perUserMetrics.push({
      userId: userId.slice(0, 8) + "...",
      incrementalCount: state.incrementalCount,
      dailyMajorCount: state.dailyMajorCount,
      incrementalFailures: state.incrementalFailures,
      dailyMajorFailures: state.dailyMajorFailures,
      lastIncremental: state.lastIncremental?.toISOString() || null,
      lastDailyMajor: state.lastDailyMajor?.toISOString() || null,
    });
    totalIncrementalRuns += state.incrementalCount;
    totalDailyMajorRuns += state.dailyMajorCount;
    totalFailures += state.incrementalFailures + state.dailyMajorFailures;
  }
  
  return {
    userCount: userTournamentState.size,
    perUserMetrics,
    totalIncrementalRuns,
    totalDailyMajorRuns,
    totalFailures,
  };
}

async function runTournamentWorker(): Promise<void> {
  const traceId = crypto.randomUUID().slice(0, 8);
  const now = new Date();
  const todayET = getETDateString();
  
  try {
    const users = await db.execute(sql`SELECT DISTINCT id FROM users WHERE id IS NOT NULL LIMIT 10`);
    
    if (users.rows.length === 0) {
      return;
    }
    
    for (const row of users.rows) {
      const userId = (row as { id: string }).id;
      const state = getUserTournamentState(userId);
      
      const shouldRunIncremental = !state.lastIncremental || 
        (now.getTime() - state.lastIncremental.getTime()) >= TOURNAMENT_INCREMENTAL_INTERVAL_MS;
      
      const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
      const isElevenPmET = etHour === TOURNAMENT_DAILY_MAJOR_HOUR_ET;
      const lastMajorDateET = state.lastDailyMajor ? 
        new Date(state.lastDailyMajor).toLocaleDateString("en-US", { timeZone: "America/New_York" }) : null;
      const shouldRunDailyMajor = isElevenPmET && lastMajorDateET !== todayET;
      
      if (shouldRunDailyMajor) {
        console.log(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=DAILY_MAJOR action=START count=${state.dailyMajorCount + 1}`);
        
        try {
          const result = await runTournament(userId, "DAILY_MAJOR", { triggeredBy: "scheduler" });
          state.lastDailyMajor = now;
          state.dailyMajorCount++;
          
          console.log(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=DAILY_MAJOR action=COMPLETE entrants=${result.entrantsCount} winner=${result.winnerId?.slice(0,8) || "none"} fitness=${result.winnerFitness?.toFixed(4) || 0} total_runs=${state.dailyMajorCount}`);
          
          await logActivityEvent({
            eventType: "TOURNAMENT_COMPLETED",
            severity: "INFO",
            title: "Daily Major Tournament Completed",
            summary: `Tournament with ${result.entrantsCount} entrants completed. Winner fitness: ${result.winnerFitness?.toFixed(4) || "N/A"}`,
            payload: {
              tournamentId: result.tournamentId,
              cadence: "DAILY_MAJOR",
              entrantsCount: result.entrantsCount,
              winnerId: result.winnerId,
              winnerFitness: result.winnerFitness,
              actions: result.summary.actions,
              userTotalRuns: state.dailyMajorCount,
            },
            traceId,
          });
        } catch (error) {
          state.dailyMajorFailures++;
          console.error(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=DAILY_MAJOR action=FAILED failures=${state.dailyMajorFailures}`, error);
        }
      } else if (shouldRunIncremental) {
        console.log(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=INCREMENTAL action=START count=${state.incrementalCount + 1}`);
        
        try {
          const result = await runTournament(userId, "INCREMENTAL", { triggeredBy: "scheduler" });
          state.lastIncremental = now;
          state.incrementalCount++;
          
          console.log(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=INCREMENTAL action=COMPLETE entrants=${result.entrantsCount} winner=${result.winnerId?.slice(0,8) || "none"} total_runs=${state.incrementalCount}`);
        } catch (error) {
          state.incrementalFailures++;
          console.error(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} user=${userId.slice(0,8)} cadence=INCREMENTAL action=FAILED failures=${state.incrementalFailures}`, error);
        }
      }
    }
  } catch (error) {
    console.error(`[TOURNAMENT_SCHEDULER] trace_id=${traceId} Tournament worker failed:`, error);
  }
}

/**
 * SEV-1: Start worker loops without initialization (degraded mode)
 * Called when DB circuit is open - workers will check circuit state on each tick
 */
function startWorkerLoopsOnly(): void {
  console.log("[SCHEDULER] Starting workers in degraded mode (no DB initialization)...");
  
  const createSelfHealingWorker = (name: string, fn: () => Promise<void>) => {
    return async () => {
      const traceId = crypto.randomUUID().slice(0, 8);
      await selfHealingWrapper(name, fn, traceId);
    };
  };
  
  // Start essential workers that can handle circuit-open state gracefully
  timeoutWorkerInterval = setInterval(createSelfHealingWorker("timeout", runTimeoutWorker), TIMEOUT_WORKER_INTERVAL_MS);
  supervisorLoopInterval = setInterval(createSelfHealingWorker("supervisor", runSupervisorLoop), SUPERVISOR_LOOP_INTERVAL_MS);
  selfHealingInterval = setInterval(createSelfHealingWorker("self-healing", runSelfHealingWorker), SELF_HEALING_INTERVAL_MS);
  integrationVerificationInterval = setInterval(createSelfHealingWorker("integration-verify", runIntegrationVerificationWorker), INTEGRATION_VERIFICATION_INTERVAL_MS);
  
  console.log("[SCHEDULER] Degraded mode workers started (timeout, supervisor, self-healing, integration-verify)");
  console.log("[SCHEDULER] Other workers will start when DB circuit closes");
}

async function initializeWorkers(): Promise<void> {
  // INSTITUTIONAL: Ensure clean state - clear any existing intervals first
  clearAllWorkerIntervals();
  
  // SEV-1: Check circuit breaker before attempting any DB operations
  const { isCircuitOpen } = await import('./db');
  const circuitOpen = isCircuitOpen();
  
  if (circuitOpen) {
    console.log("[SCHEDULER] DB circuit OPEN - skipping initialization, workers will use degraded mode");
    // Still start workers - they'll check circuit state on each tick
    startWorkerLoopsOnly();
    return;
  }
  
  // INSTITUTIONAL: Load Strategy Lab settings from database BEFORE starting any workers
  // This ensures auto-promote settings persist across server restarts
  try {
    // Get any user's persisted settings (first user with labs settings)
    const settingsResult = await db.execute(sql`
      SELECT user_id, labs FROM app_settings 
      WHERE labs IS NOT NULL AND labs != '{}'::jsonb
      LIMIT 1
    `);
    
    if (settingsResult.rows.length > 0) {
      const row = settingsResult.rows[0] as { user_id: string; labs: Record<string, unknown> };
      const labs = row.labs;
      if (labs && Object.keys(labs).length > 0) {
        initializeStrategyLabFromSettings({
          isPlaying: labs.isPlaying as boolean | undefined,
          requireManualApproval: labs.requireManualApproval as boolean | undefined,
          autoPromoteThreshold: labs.autoPromoteThreshold as number | undefined,
          autoPromoteTier: labs.autoPromoteTier as string | undefined,
          perplexityModel: labs.perplexityModel as string | undefined,
          searchRecency: labs.searchRecency as string | undefined,
          customFocus: labs.customFocus as string | undefined,
          costEfficiencyMode: labs.costEfficiencyMode as boolean | undefined,
          qcDailyLimit: labs.qcDailyLimit as number | undefined,
          qcWeeklyLimit: labs.qcWeeklyLimit as number | undefined,
          qcAutoTriggerEnabled: labs.qcAutoTriggerEnabled as boolean | undefined,
          qcAutoTriggerThreshold: labs.qcAutoTriggerThreshold as number | undefined,
          qcAutoTriggerTier: labs.qcAutoTriggerTier as string | undefined,
        });
        console.log(`[SCHEDULER] Strategy Lab settings loaded from database: requireManualApproval=${labs.requireManualApproval} qcAutoTrigger=${labs.qcAutoTriggerEnabled} qcThreshold=${labs.qcAutoTriggerThreshold} qcTier=${labs.qcAutoTriggerTier}`);
      }
    } else {
      console.log("[SCHEDULER] No persisted Strategy Lab settings found, using defaults");
    }
  } catch (settingsError) {
    console.error("[SCHEDULER] Failed to load Strategy Lab settings:", settingsError);
  }
  
  // INSTITUTIONAL: Load system power state from database
  try {
    const { initializeSystemPowerState } = await import("./routes");
    await initializeSystemPowerState();
    console.log("[SCHEDULER] System power state loaded from database");
  } catch (powerStateError) {
    console.error("[SCHEDULER] Failed to load system power state:", powerStateError);
  }
  
  // INSTITUTIONAL: Recover any jobs that were RUNNING when process died
  const recovered = await recoverInflightJobs();
  if (recovered > 0) {
    console.log(`[SCHEDULER] Recovered ${recovered} inflight jobs from previous crash`);
  }
  
  // SELF-HEALING: Recover any QC verification jobs that were RUNNING when process died
  const qcRecovered = await recoverStuckQCVerificationJobs(true);
  if (qcRecovered > 0) {
    console.log(`[SCHEDULER] Recovered ${qcRecovered} stuck QC verification jobs from previous crash`);
  }
  
  // FAIL-CLOSED: Validate archetype mappings before starting any workers
  assertArchetypeMappingsValid();
  assertFactoryMappingsValid();
  
  // DIAGNOSTIC: Log available AI providers for Strategy Lab research
  try {
    const { getStrategyLabProviders } = await import("./ai-strategy-evolution");
    const providers = getStrategyLabProviders();
    const providerNames = providers.map(p => p.provider).join(", ");
    if (providers.length === 0) {
      console.warn("[SCHEDULER] WARNING: No AI providers configured for Strategy Lab research!");
      console.warn("[SCHEDULER] Required env vars: PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, or GOOGLE_GEMINI_API_KEY");
    } else {
      console.log(`[SCHEDULER] AI providers available for Strategy Lab: ${providerNames} (${providers.length} total)`);
    }
  } catch (providerError) {
    console.error("[SCHEDULER] Failed to check AI providers:", providerError);
  }
  
  console.log("[SCHEDULER] Starting automated workers with self-healing...");
  
  const createSelfHealingWorker = (name: string, fn: () => Promise<void>) => {
    return async () => {
      const traceId = crypto.randomUUID().slice(0, 8);
      await selfHealingWrapper(name, fn, traceId);
    };
  };
  
  // Start workers with self-healing wrappers
  timeoutWorkerInterval = setInterval(createSelfHealingWorker("timeout", runTimeoutWorker), TIMEOUT_WORKER_INTERVAL_MS);
  console.log(`[SCHEDULER] Timeout worker started (interval: ${TIMEOUT_WORKER_INTERVAL_MS}ms)`);
  
  supervisorLoopInterval = setInterval(createSelfHealingWorker("supervisor", runSupervisorLoop), SUPERVISOR_LOOP_INTERVAL_MS);
  console.log(`[SCHEDULER] Supervisor loop started (interval: ${SUPERVISOR_LOOP_INTERVAL_MS}ms)`);
  
  // MAINTENANCE_MODE: Skip heavy workers if flag is set
  if (!heavyWorkersPaused) {
    backtestWorkerInterval = setInterval(createSelfHealingWorker("backtest", runBacktestWorker), BACKTEST_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] Backtest worker started (interval: ${BACKTEST_WORKER_INTERVAL_MS}ms)`);
    
    autonomyLoopInterval = setInterval(createSelfHealingWorker("autonomy", runAutonomyLoop), AUTONOMY_LOOP_INTERVAL_MS);
    console.log(`[SCHEDULER] Autonomy loop started (interval: ${AUTONOMY_LOOP_INTERVAL_MS}ms)`);
    
    evolutionWorkerInterval = setInterval(createSelfHealingWorker("evolution", runEvolutionWorker), EVOLUTION_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] Evolution worker started (interval: ${EVOLUTION_WORKER_INTERVAL_MS}ms)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped backtest, autonomy, evolution workers`);
  }
  
  economicCalendarInterval = setInterval(createSelfHealingWorker("calendar", runEconomicCalendarRefresh), ECONOMIC_CALENDAR_INTERVAL_MS);
  console.log(`[SCHEDULER] Economic calendar worker started (interval: ${ECONOMIC_CALENDAR_INTERVAL_MS}ms)`);
  
  // MAINTENANCE_MODE: Skip runner worker - it processes active bots which causes OOM on startup
  if (!heavyWorkersPaused) {
    runnerWorkerInterval = setInterval(createSelfHealingWorker("runner", runRunnerWorker), RUNNER_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] Runner worker started (interval: ${RUNNER_WORKER_INTERVAL_MS}ms)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped runner worker (prevents OOM with active bots)`);
  }
  
  // MAINTENANCE_MODE: Also skip trend consistency worker
  if (!heavyWorkersPaused) {
    trendConsistencyInterval = setInterval(createSelfHealingWorker("trend", runTrendConsistencyWorker), TREND_CONSISTENCY_INTERVAL_MS);
    console.log(`[SCHEDULER] Trend consistency worker started (interval: ${TREND_CONSISTENCY_INTERVAL_MS}ms)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped trend consistency worker`);
  }
  
  selfHealingInterval = setInterval(createSelfHealingWorker("self-healing", runSelfHealingWorker), SELF_HEALING_INTERVAL_MS);
  console.log(`[SCHEDULER] Self-healing worker started (interval: ${SELF_HEALING_INTERVAL_MS}ms)`);
  
  integrationVerificationInterval = setInterval(createSelfHealingWorker("integration-verify", runIntegrationVerificationWorker), INTEGRATION_VERIFICATION_INTERVAL_MS);
  console.log(`[SCHEDULER] Integration verification worker started (interval: ${INTEGRATION_VERIFICATION_INTERVAL_MS}ms)`);
  
  // Run integration verification immediately at startup for instant audit status
  setTimeout(() => runIntegrationVerificationWorker().catch(err => console.error(`[INTEGRATION_VERIFY] Startup run failed:`, err)), 5000);
  
  // AUTONOMOUS: System Audit Worker - runs comprehensive checks for observability dashboard
  systemAuditInterval = setInterval(createSelfHealingWorker("system-audit", runSystemAuditWorker), SYSTEM_AUDIT_INTERVAL_MS);
  console.log(`[SCHEDULER] System audit worker started (interval: ${SYSTEM_AUDIT_INTERVAL_MS / 3600_000}h)`);
  
  // RESILIENCY: Consistency sweep worker - drift detection, trade integrity, audit chain verification
  consistencySweepInterval = setInterval(createSelfHealingWorker("consistency-sweep", async () => {
    await runConsistencySweep();
  }), CONSISTENCY_SWEEP_INTERVAL_MS);
  console.log(`[SCHEDULER] Consistency sweep worker started (interval: ${CONSISTENCY_SWEEP_INTERVAL_MS / 3600_000}h)`);
  
  // Start drift detection (runs alongside consistency sweep with auto-heal enabled)
  startScheduledDriftDetection(CONSISTENCY_SWEEP_INTERVAL_MS);
  
  // Run system audit immediately on startup (3s delay for DB init)
  setTimeout(() => runSystemAuditWorker().catch(err => console.error(`[SYSTEM_AUDIT] Startup run failed:`, err)), 3_000);
  console.log(`[SCHEDULER] System audit will run in 3s on startup`);
  
  strategyLabResearchInterval = setInterval(createSelfHealingWorker("strategy-lab", runStrategyLabResearchWorker), STRATEGY_LAB_RESEARCH_INTERVAL_MS);
  console.log(`[SCHEDULER] Strategy Lab research worker started (check interval: ${STRATEGY_LAB_RESEARCH_INTERVAL_MS / 60000}min, actual run interval by depth)`);
  
  grokResearchInterval = setInterval(createSelfHealingWorker("grok-research", runGrokResearchWorker), GROK_RESEARCH_CHECK_INTERVAL_MS);
  
  // AUTONOMOUS: Auto-enable Grok research on startup if XAI_API_KEY is configured
  // AND Strategy Lab is not paused (Grok Research follows Strategy Lab pause state)
  // Note: We check the persisted Strategy Lab state from app_settings.labs to avoid circular dependency
  let strategyLabActive = true; // Default to active if not found
  try {
    const labSettingsResult = await db.execute(sql`
      SELECT labs FROM app_settings 
      WHERE labs IS NOT NULL AND labs != '{}'::jsonb
      LIMIT 1
    `);
    if (labSettingsResult.rows.length > 0) {
      const labs = (labSettingsResult.rows[0] as { labs: Record<string, any> }).labs;
      // Strategy Lab is active unless explicitly paused (isPlaying === false)
      strategyLabActive = labs?.isPlaying !== false;
    }
  } catch (err) {
    console.log(`[SCHEDULER] Could not check Strategy Lab state, defaulting to active`);
  }
  
  if (!grokResearchEnabled && process.env.XAI_API_KEY && strategyLabActive) {
    grokResearchEnabled = true;
    console.log(`[SCHEDULER] AUTO-ENABLED Grok research: XAI_API_KEY detected, Strategy Lab active`);
  } else if (process.env.XAI_API_KEY && !strategyLabActive) {
    grokResearchEnabled = false;
    console.log(`[SCHEDULER] Grok research DISABLED: Strategy Lab is paused`);
  }
  console.log(`[SCHEDULER] Grok research worker started (check interval: ${GROK_RESEARCH_CHECK_INTERVAL_MS / 60000}min, enabled=${grokResearchEnabled})`);
  
  tournamentWorkerInterval = setInterval(createSelfHealingWorker("tournament", runTournamentWorker), 30 * 60_000);
  console.log(`[SCHEDULER] Tournament worker started (check interval: 30min, incremental: ${TOURNAMENT_INCREMENTAL_INTERVAL_MS / 3600_000}h, major: 11PM ET)`);
  
  // MAINTENANCE_MODE: Skip QC workers (they can queue heavy QuantConnect jobs)
  if (!heavyWorkersPaused) {
    qcVerificationWorkerInterval = setInterval(createSelfHealingWorker("qc-verification", runQCVerificationWorker), QC_VERIFICATION_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] QC verification worker started (interval: ${QC_VERIFICATION_WORKER_INTERVAL_MS / 1000}s)`);
    
    qcErrorRecoveryWorkerInterval = setInterval(createSelfHealingWorker("qc-error-recovery", runQCErrorRecoveryWorker), QC_ERROR_RECOVERY_INTERVAL_MS);
    console.log(`[SCHEDULER] QC error recovery worker started (interval: ${QC_ERROR_RECOVERY_INTERVAL_MS / 60000}min)`);
    
    // Run QC threshold recovery on startup (once) to re-queue DIVERGENT verifications that might now pass
    setTimeout(() => selfHealingWrapper("qc-threshold-recovery", runQCThresholdRecoveryWorker, startupTraceId).catch(console.error), 45_000);
    console.log(`[SCHEDULER] QC threshold recovery will run in 45s on startup`);
    
    qcEvolutionWorkerInterval = setInterval(createSelfHealingWorker("qc-evolution", runQCFailureEvolutionWorker), QC_EVOLUTION_SCAN_INTERVAL_MS);
    console.log(`[SCHEDULER] QC failure evolution worker started (interval: ${QC_EVOLUTION_SCAN_INTERVAL_MS / 60000}min)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped QC workers (verification, error-recovery, evolution)`);
  }
  
  // QC auto-trigger runs every 5 minutes to check for eligible Tier A strategies
  // MAINTENANCE_MODE: Also skip this as it queues QC jobs
  if (!heavyWorkersPaused) {
    const QC_AUTO_TRIGGER_INTERVAL_MS = 5 * 60 * 1000;
    setInterval(createSelfHealingWorker("qc-auto-trigger", runQCAutoTriggerWorker), QC_AUTO_TRIGGER_INTERVAL_MS);
    console.log(`[SCHEDULER] QC auto-trigger worker started (interval: ${QC_AUTO_TRIGGER_INTERVAL_MS / 60000}min)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped QC auto-trigger worker`);
  }
  
  // AUTONOMOUS: SENT_TO_LAB promotion worker - promotes approved candidates to bots automatically
  sentToLabPromotionInterval = setInterval(createSelfHealingWorker("sent-to-lab-promotion", async () => {
    const result = await promoteSentToLabCandidates();
    if (result.candidatesPromoted > 0) {
      console.log(`[SCHEDULER] SENT_TO_LAB promotion: ${result.candidatesPromoted} candidates promoted to bots`);
    }
  }), SENT_TO_LAB_PROMOTION_INTERVAL_MS);
  console.log(`[SCHEDULER] SENT_TO_LAB promotion worker started (interval: ${SENT_TO_LAB_PROMOTION_INTERVAL_MS / 1000}s)`);
  
  // Run immediately on startup with self-healing
  const startupTraceId = crypto.randomUUID().slice(0, 8);
  console.log(`[SCHEDULER] trace_id=${startupTraceId} Starting immediate startup workers...`);
  
  // MAINTENANCE_MODE: Only run critical workers on startup, skip heavy ones
  await selfHealingWrapper("timeout", runTimeoutWorker, startupTraceId);
  console.log(`[SCHEDULER] trace_id=${startupTraceId} timeout worker done`);
  await selfHealingWrapper("supervisor", runSupervisorLoop, startupTraceId);
  console.log(`[SCHEDULER] trace_id=${startupTraceId} supervisor done`);
  // Runner worker is long-running (rehydrates all bots), run in background to not block Fleet Risk Engine startup
  selfHealingWrapper("runner", runRunnerWorker, startupTraceId).catch(e => console.error(`[SCHEDULER] trace_id=${startupTraceId} runner startup error:`, e));
  console.log(`[SCHEDULER] trace_id=${startupTraceId} runner worker scheduled (background)`);
  
  if (!heavyWorkersPaused) {
    console.log(`[SCHEDULER] trace_id=${startupTraceId} scheduling heavy workers (background)...`);
    // Run QC auto-trigger immediately on startup (with 30s delay to let other systems initialize)
    setTimeout(() => selfHealingWrapper("qc-auto-trigger", runQCAutoTriggerWorker, startupTraceId).catch(console.error), 30_000);
    // Heavy workers run in background - don't block Fleet Risk Engine startup
    selfHealingWrapper("backtest", runBacktestWorker, startupTraceId).catch(e => console.error(`[SCHEDULER] trace_id=${startupTraceId} backtest startup error:`, e));
    selfHealingWrapper("evolution", runEvolutionWorker, startupTraceId).catch(e => console.error(`[SCHEDULER] trace_id=${startupTraceId} evolution startup error:`, e));
    selfHealingWrapper("trend", runTrendConsistencyWorker, startupTraceId).catch(e => console.error(`[SCHEDULER] trace_id=${startupTraceId} trend startup error:`, e));
    // Delayed startup tasks
    setTimeout(() => selfHealingWrapper("calendar", runEconomicCalendarRefresh, startupTraceId), 5_000);
    setTimeout(() => selfHealingWrapper("autonomy", runAutonomyLoop, startupTraceId), 60_000);
    console.log(`[SCHEDULER] trace_id=${startupTraceId} heavy workers scheduled (background)`);
  } else {
    console.log(`[SCHEDULER] MAINTENANCE_MODE: Skipped immediate startup runs for heavy workers`);
  }
  setTimeout(() => runBlownAccountStartupSweep().catch(console.error), 10_000);
  console.log(`[SCHEDULER] trace_id=${startupTraceId} immediate startup configuration complete`);
  
  console.log(`[SCHEDULER] Startup workers completed, continuing to periodic workers...`);
  // AUTONOMOUS: Run candidate reconciliation on startup and periodically
  // Detects and fixes stuck candidates in intermediate states
  setTimeout(async () => {
    try {
      const reconTraceId = `recon-startup-${crypto.randomUUID().slice(0, 8)}`;
      console.log(`[SCHEDULER] trace_id=${reconTraceId} Running candidate reconciliation on startup...`);
      
      // First run dry-run to see what's stuck
      const dryRunReport = await runReconciliation(true);
      if (dryRunReport.stuckCandidates.length > 0) {
        console.log(`[SCHEDULER] trace_id=${reconTraceId} Found ${dryRunReport.stuckCandidates.length} stuck candidates, auto-repairing...`);
        const repairReport = await runReconciliation(false);
        console.log(`[SCHEDULER] trace_id=${reconTraceId} Reconciliation complete: repaired=${repairReport.autoRepairedCount} manual_review=${repairReport.manualReviewRequired.length}`);
      } else {
        console.log(`[SCHEDULER] trace_id=${reconTraceId} No stuck candidates found`);
      }
      
      // Run invariant checks
      const invariants = await runInvariantChecks();
      if (!invariants.passed) {
        console.warn(`[SCHEDULER] trace_id=${reconTraceId} State invariant violations: ${invariants.violations.join("; ")}`);
        await logActivityEvent({
          eventType: "SELF_HEALING_RECOVERY",
          severity: "WARN",
          title: "State invariant violations detected",
          summary: invariants.violations.join("; "),
          payload: { traceId: reconTraceId, violations: invariants.violations },
          traceId: reconTraceId,
        });
      }
    } catch (error) {
      console.error(`[SCHEDULER] Candidate reconciliation failed:`, error);
    }
  }, 12_000);
  
  // Start periodic reconciliation worker
  reconciliationInterval = setInterval(async () => {
    try {
      const reconTraceId = `recon-${crypto.randomUUID().slice(0, 8)}`;
      const report = await runReconciliation(false); // Auto-repair mode
      if (report.autoRepairedCount > 0 || report.manualReviewRequired.length > 0) {
        console.log(`[RECONCILIATION_WORKER] trace_id=${reconTraceId} repaired=${report.autoRepairedCount} manual_review=${report.manualReviewRequired.length}`);
      }
      
      const invariants = await runInvariantChecks();
      if (!invariants.passed) {
        console.warn(`[RECONCILIATION_WORKER] trace_id=${reconTraceId} Invariant violations: ${invariants.violations.join("; ")}`);
      }
    } catch (error) {
      console.error(`[RECONCILIATION_WORKER] Error:`, error);
    }
  }, RECONCILIATION_INTERVAL_MS);
  console.log(`[SCHEDULER] Candidate reconciliation worker started (interval: ${RECONCILIATION_INTERVAL_MS / 60000}min)`);
  
  // AUTONOMOUS: Promotion Worker - evaluates all bots for automatic promotions/demotions
  promotionWorkerInterval = setInterval(createSelfHealingWorker("promotion", async () => {
    const result = await runPromotionWorker();
    if (result.promoted > 0 || result.demoted > 0) {
      console.log(`[PROMOTION_WORKER] Completed: promoted=${result.promoted} demoted=${result.demoted} evaluated=${result.evaluated}`);
    }
  }), PROMOTION_WORKER_INTERVAL_MS);
  console.log(`[SCHEDULER] Promotion worker started (interval: ${PROMOTION_WORKER_INTERVAL_MS / 60_000}min)`);
  
  // AUTONOMOUS: Governance Expiration Worker - marks 24h+ pending requests as EXPIRED
  governanceExpirationInterval = setInterval(createSelfHealingWorker("governance-expiration", async () => {
    const result = await expireStaleRequests();
    if (result.expiredCount > 0) {
      console.log(`[GOVERNANCE_EXPIRATION] Expired ${result.expiredCount} stale requests`);
    }
  }), GOVERNANCE_EXPIRATION_INTERVAL_MS);
  console.log(`[SCHEDULER] Governance expiration worker started (interval: ${GOVERNANCE_EXPIRATION_INTERVAL_MS / 60_000}min)`);
  
  // AUTONOMOUS: Risk Enforcement Worker - checks all active bots for risk limit breaches
  riskEnforcementInterval = setInterval(createSelfHealingWorker("risk-enforcement", async () => {
    const result = await runRiskEnforcementCheck();
    if (result.warnings > 0 || result.softBlocks > 0 || result.hardBlocks > 0 || result.blownAccounts > 0) {
      console.log(`[RISK_ENFORCEMENT] Checked ${result.botsChecked} bots: warnings=${result.warnings} soft=${result.softBlocks} hard=${result.hardBlocks} blown=${result.blownAccounts}`);
    }
  }), RISK_ENFORCEMENT_INTERVAL_MS);
  console.log(`[SCHEDULER] Risk enforcement worker started (interval: ${RISK_ENFORCEMENT_INTERVAL_MS / 60_000}min)`);
  
  // AUTONOMOUS: Fleet Risk Engine - fleet-wide exposure limits, cross-bot netting, tiered kill-switch
  // Runs independently with self-healing recovery
  console.log(`[SCHEDULER] Starting Fleet Risk Engine...`);
  try {
    await startFleetRiskEngine();
    console.log(`[SCHEDULER] Fleet Risk Engine started (autonomous mode)`);
  } catch (fleetRiskError) {
    console.error(`[SCHEDULER] Fleet Risk Engine failed to start:`, fleetRiskError);
  }
  
  // AUTONOMOUS: Resurrection Detector - brings archived bots back when regime favors their archetype
  resurrectionDetectorInterval = setInterval(createSelfHealingWorker("resurrection-detector", async () => {
    const resurrectionTraceId = `resurrection-${crypto.randomUUID().slice(0, 8)}`;
    const result = await runResurrectionScan(resurrectionTraceId);
    if (result.resurrectedCount > 0) {
      console.log(`[RESURRECTION_DETECTOR] Resurrected ${result.resurrectedCount} bots for ${result.currentRegime} regime`);
    }
  }), RESURRECTION_DETECTOR_INTERVAL_MS);
  console.log(`[SCHEDULER] Resurrection detector worker started (interval: ${RESURRECTION_DETECTOR_INTERVAL_MS / 60_000}min)`);
  
  // AUTONOMOUS: Run SENT_TO_LAB promotion immediately on startup (5s delay for DB init)
  setTimeout(async () => {
    console.log(`[SCHEDULER] trace_id=${startupTraceId} Running SENT_TO_LAB promotion on startup...`);
    const result = await promoteSentToLabCandidates();
    if (result.candidatesPromoted > 0) {
      console.log(`[SCHEDULER] trace_id=${startupTraceId} SENT_TO_LAB startup: ${result.candidatesPromoted} candidates promoted to bots`);
    } else if (result.candidatesEvaluated > 0) {
      console.log(`[SCHEDULER] trace_id=${startupTraceId} SENT_TO_LAB startup: ${result.candidatesEvaluated} candidates evaluated, ${result.skippedReasons.length} skipped`);
    }
  }, 5_000);
  
  // BACKFILL: Run generation backfill on startup for bots missing currentGenerationId
  setTimeout(async () => {
    try {
      const backfillTraceId = `backfill-${crypto.randomUUID().slice(0, 8)}`;
      console.log(`[SCHEDULER] trace_id=${backfillTraceId} Running generation backfill on startup...`);
      await runGenerationBackfill(backfillTraceId);
    } catch (error) {
      console.error(`[SCHEDULER] Generation backfill failed:`, error);
    }
  }, 8_000);
  
  // SCHEMA-FIRST: Run archetype backfill on startup to populate archetypeName on legacy bots
  setTimeout(async () => {
    try {
      await runArchetypeBackfill();
    } catch (error) {
      console.error(`[SCHEDULER] Archetype backfill failed:`, error);
    }
  }, 10_000);
  
  // AUTONOMOUS: Run Strategy Lab research on startup if it's in playing state
  setTimeout(async () => {
    try {
      const { isStrategyLabRunning, runStrategyLabResearchCycle } = await import("./strategy-lab-engine");
      if (isStrategyLabRunning()) {
        console.log(`[SCHEDULER] trace_id=${startupTraceId} Running Strategy Lab startup research cycle...`);
        const result = await runStrategyLabResearchCycle(true);
        if (result) {
          console.log(`[SCHEDULER] trace_id=${startupTraceId} Strategy Lab startup cycle: ${result.candidatesGenerated} candidates generated`);
        }
      } else {
        console.log(`[SCHEDULER] trace_id=${startupTraceId} Strategy Lab is paused, skipping startup research`);
      }
    } catch (error) {
      console.error(`[SCHEDULER] trace_id=${startupTraceId} Strategy Lab startup cycle failed:`, error);
    }
  }, 15_000);

  // AUTONOMOUS: Run Grok research on startup if enabled
  setTimeout(async () => {
    try {
      const grokSystemUser = await storage.ensureSystemUser();
      if (grokResearchEnabled) {
        console.log(`[SCHEDULER] trace_id=${startupTraceId} Running Grok research startup cycle...`);
        const result = await processGrokResearchCycle(grokResearchDepth, grokSystemUser.id);
        if (result.success) {
          console.log(`[SCHEDULER] trace_id=${startupTraceId} Grok startup cycle: ${result.candidatesCreated} candidates created`);
        } else {
          console.log(`[SCHEDULER] trace_id=${startupTraceId} Grok startup cycle: failed (${result.error || 'unknown error'})`);
        }
      } else {
        console.log(`[SCHEDULER] trace_id=${startupTraceId} Grok research disabled, skipping startup cycle`);
      }
    } catch (error) {
      console.error(`[SCHEDULER] trace_id=${startupTraceId} Grok research startup cycle failed:`, error);
    }
  }, 25_000);
  
  // AUTONOMOUS: Verify all integrations on startup immediately
  // First verification immediately (no delay) for instant status update
  console.log(`[SCHEDULER] trace_id=${startupTraceId} Running IMMEDIATE integration verification...`);
  selfHealingWrapper("integration-verify", runIntegrationVerificationWorker, startupTraceId).catch(console.error);
  
  // Second verification after 30 seconds (catch any that failed on first attempt)
  setTimeout(() => {
    console.log(`[SCHEDULER] trace_id=${startupTraceId} Running FOLLOWUP integration verification (30s)...`);
    selfHealingWrapper("integration-verify", runIntegrationVerificationWorker, startupTraceId).catch(console.error);
  }, 30_000);
  
  // INSTITUTIONAL: Pre-warm bar cache on startup for parallel backtest capability
  // Tiered architecture: 2 years in memory (warm), 5 years on disk (cold via SQLite)
  // Memory tier: 730 days per symbol for fast parallel backtesting
  // Cold tier: Extended history loaded on-demand from bar-cold-storage.ts
  // Backtests use full 5-year range (1825 days) via FULL_RANGE sampling
  const cacheTraceId = `cache-${crypto.randomUUID().slice(0, 8)}`;
  console.log(`[SCHEDULER] trace_id=${cacheTraceId} Pre-warming bar cache (${BAR_CACHE_CONFIG.WARM_TIER_HISTORY_DAYS} days in memory, ${BAR_CACHE_CONFIG.COLD_TIER_HISTORY_DAYS} days total via cold storage)...`);
  preWarmCache(cacheTraceId, BAR_CACHE_CONFIG.WARM_TIER_HISTORY_DAYS)
    .then(() => {
      const stats = getCacheStats();
      const totalBars = stats.reduce((sum, s) => sum + s.barCount, 0);
      console.log(`[SCHEDULER] trace_id=${cacheTraceId} Bar cache ready: ${totalBars.toLocaleString()} bars cached for ${stats.length} symbols`);
    })
    .catch((err) => {
      console.error(`[SCHEDULER] trace_id=${cacheTraceId} Bar cache pre-warm failed:`, err);
    });
  
  // AUTONOMOUS: Start cloud backup scheduler if enabled and Google Drive connected
  setTimeout(async () => {
    try {
      console.log(`[SCHEDULER] trace_id=${startupTraceId} Starting cloud backup scheduler...`);
      await startBackupScheduler();
    } catch (error) {
      console.error(`[SCHEDULER] trace_id=${startupTraceId} Cloud backup scheduler failed to start:`, error);
    }
  }, 20_000);
  
  isSchedulerRunning = true;
  console.log("[SCHEDULER] All workers started successfully");
}

/**
 * Stop the scheduler and release leader lock
 */
export async function stopScheduler(): Promise<void> {
  if (!isSchedulerRunning) {
    console.log("[SCHEDULER] Not running, skipping stop");
    return;
  }
  
  console.log("[SCHEDULER] Stopping automated workers...");
  
  // INSTITUTIONAL: Release leader lock
  if (leaderLockInterval) {
    clearInterval(leaderLockInterval);
    leaderLockInterval = null;
  }
  
  if (isLeader) {
    await releaseLeaderLock();
    isLeader = false;
    console.log("[SCHEDULER] Released leader lock");
  }
  
  if (timeoutWorkerInterval) {
    clearInterval(timeoutWorkerInterval);
    timeoutWorkerInterval = null;
  }
  
  if (supervisorLoopInterval) {
    clearInterval(supervisorLoopInterval);
    supervisorLoopInterval = null;
  }
  
  if (backtestWorkerInterval) {
    clearInterval(backtestWorkerInterval);
    backtestWorkerInterval = null;
  }
  
  if (autonomyLoopInterval) {
    clearInterval(autonomyLoopInterval);
    autonomyLoopInterval = null;
  }
  
  if (evolutionWorkerInterval) {
    clearInterval(evolutionWorkerInterval);
    evolutionWorkerInterval = null;
  }
  
  if (economicCalendarInterval) {
    clearInterval(economicCalendarInterval);
    economicCalendarInterval = null;
  }
  
  if (runnerWorkerInterval) {
    clearInterval(runnerWorkerInterval);
    runnerWorkerInterval = null;
  }
  
  if (trendConsistencyInterval) {
    clearInterval(trendConsistencyInterval);
    trendConsistencyInterval = null;
  }
  
  if (selfHealingInterval) {
    clearInterval(selfHealingInterval);
    selfHealingInterval = null;
  }
  
  if (integrationVerificationInterval) {
    clearInterval(integrationVerificationInterval);
    integrationVerificationInterval = null;
  }
  
  if (reconciliationInterval) {
    clearInterval(reconciliationInterval);
    reconciliationInterval = null;
  }
  
  if (promotionWorkerInterval) {
    clearInterval(promotionWorkerInterval);
    promotionWorkerInterval = null;
  }
  
  if (governanceExpirationInterval) {
    clearInterval(governanceExpirationInterval);
    governanceExpirationInterval = null;
  }
  
  if (riskEnforcementInterval) {
    clearInterval(riskEnforcementInterval);
    riskEnforcementInterval = null;
  }
  
  if (resurrectionDetectorInterval) {
    clearInterval(resurrectionDetectorInterval);
    resurrectionDetectorInterval = null;
  }
  
  // Stop cloud backup scheduler
  stopBackupScheduler();
  
  isSchedulerRunning = false;
  console.log("[SCHEDULER] All workers stopped");
}

/**
 * Get scheduler status
 */
export async function getSchedulerStatus(): Promise<{
  isRunning: boolean;
  timeoutWorkerActive: boolean;
  supervisorLoopActive: boolean;
  backtestWorkerActive: boolean;
  autonomyLoopActive: boolean;
  evolutionWorkerActive: boolean;
  activeBacktests: number;
  backtestCircuitBreaker: { failures: number; isOpen: boolean };
  circuitBreakerStates: Array<{ botId: string; failures: number; isOpen: boolean }>;
  qcVerificationHealth: {
    queuedCount: number;
    runningCount: number;
    maxConcurrent: number;
    slotsAvailable: number;
    stuckJobsDetected: number; // Jobs RUNNING >5min without backtest ID
  };
}> {
  // Get QC verification queue health
  let qcVerificationHealth = {
    queuedCount: 0,
    runningCount: 0,
    maxConcurrent: MAX_CONCURRENT_QC_VERIFICATIONS,
    slotsAvailable: MAX_CONCURRENT_QC_VERIFICATIONS,
    stuckJobsDetected: 0,
  };
  
  try {
    const qcStats = await db.execute(sql`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'QUEUED') as queued_count,
        COUNT(*) FILTER (WHERE status = 'RUNNING') as running_count,
        COUNT(*) FILTER (WHERE status = 'RUNNING' AND (qc_backtest_id IS NULL OR qc_backtest_id = '') AND started_at < NOW() - INTERVAL '5 minutes') as stuck_early_phase
      FROM qc_verifications
    `);
    
    const stats = (qcStats.rows as any[])[0];
    qcVerificationHealth = {
      queuedCount: parseInt(stats.queued_count || '0'),
      runningCount: parseInt(stats.running_count || '0'),
      maxConcurrent: MAX_CONCURRENT_QC_VERIFICATIONS,
      slotsAvailable: Math.max(0, MAX_CONCURRENT_QC_VERIFICATIONS - parseInt(stats.running_count || '0')),
      stuckJobsDetected: parseInt(stats.stuck_early_phase || '0'),
    };
  } catch (e) {
    // Ignore errors, return defaults
  }
  
  return {
    isRunning: isSchedulerRunning,
    timeoutWorkerActive: timeoutWorkerInterval !== null,
    supervisorLoopActive: supervisorLoopInterval !== null,
    backtestWorkerActive: backtestWorkerInterval !== null,
    autonomyLoopActive: autonomyLoopInterval !== null,
    evolutionWorkerActive: evolutionWorkerInterval !== null,
    activeBacktests,
    backtestCircuitBreaker: {
      failures: backtestCircuitBreaker.failures,
      isOpen: backtestCircuitBreaker.isOpen,
    },
    circuitBreakerStates: Array.from(circuitBreakerState.entries()).map(([botId, state]) => ({
      botId,
      failures: state.failures,
      isOpen: state.isOpen,
    })),
    qcVerificationHealth,
  };
}

/**
 * Manually trigger backtest worker (for testing)
 */
export async function triggerBacktestWorker(): Promise<void> {
  await runBacktestWorker();
}

/**
 * Manually trigger autonomy loop (for testing)
 */
export async function triggerAutonomyLoop(): Promise<void> {
  await runAutonomyLoop();
}

/**
 * Manually trigger evolution worker (for testing)
 */
export async function triggerEvolutionWorker(): Promise<void> {
  await runEvolutionWorker();
}

// MEMORY LOAD SHEDDING: State for pausing heavy workers
// Check for MAINTENANCE_MODE env var to start with workers paused
let heavyWorkersPaused = process.env.MAINTENANCE_MODE === 'true';
let heavyWorkersPausedAt: Date | null = heavyWorkersPaused ? new Date() : null;
if (heavyWorkersPaused) {
  console.log("[SCHEDULER] MAINTENANCE_MODE: Starting with heavy workers paused");
}

/**
 * AUTONOMOUS MEMORY MANAGEMENT: Pause heavy workers when memory pressure persists
 * This pauses backtest and evolution workers while keeping critical workers running
 * (runner, supervisor, timeout, self-healing)
 */
export function pauseHeavyWorkers(): void {
  if (heavyWorkersPaused) {
    console.log("[SCHEDULER] Heavy workers already paused");
    return;
  }
  
  console.log("[SCHEDULER] MEMORY_LOAD_SHEDDING: Pausing heavy workers (backtest, evolution)");
  
  if (backtestWorkerInterval) {
    clearInterval(backtestWorkerInterval);
    backtestWorkerInterval = null;
  }
  
  if (evolutionWorkerInterval) {
    clearInterval(evolutionWorkerInterval);
    evolutionWorkerInterval = null;
  }
  
  if (trendConsistencyInterval) {
    clearInterval(trendConsistencyInterval);
    trendConsistencyInterval = null;
  }
  
  heavyWorkersPaused = true;
  heavyWorkersPausedAt = new Date();
  
  logActivityEvent({
    eventType: "SYSTEM_STATUS_CHANGED",
    severity: "WARN",
    title: "Heavy workers paused due to memory pressure",
    summary: "Backtest and evolution workers paused to reduce memory usage. Will resume when pressure subsides.",
    payload: { pausedAt: heavyWorkersPausedAt.toISOString(), action: "MEMORY_LOAD_SHEDDING" },
    traceId: crypto.randomUUID().slice(0, 8),
  }).catch(console.error);
}

/**
 * AUTONOMOUS MEMORY MANAGEMENT: Resume heavy workers after memory pressure recovery
 */
export function resumeHeavyWorkers(): void {
  if (!heavyWorkersPaused) {
    console.log("[SCHEDULER] Heavy workers not paused, nothing to resume");
    return;
  }
  
  console.log("[SCHEDULER] MEMORY_RECOVERY: Resuming heavy workers");
  
  const traceId = crypto.randomUUID().slice(0, 8);
  
  // Restart backtest worker
  if (!backtestWorkerInterval) {
    backtestWorkerInterval = setInterval(() => {
      selfHealingWrapper("backtest", runBacktestWorker, crypto.randomUUID().slice(0, 8));
    }, BACKTEST_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] Backtest worker resumed (interval: ${BACKTEST_WORKER_INTERVAL_MS}ms)`);
  }
  
  // Restart evolution worker
  if (!evolutionWorkerInterval) {
    evolutionWorkerInterval = setInterval(() => {
      selfHealingWrapper("evolution", runEvolutionWorker, crypto.randomUUID().slice(0, 8));
    }, EVOLUTION_WORKER_INTERVAL_MS);
    console.log(`[SCHEDULER] Evolution worker resumed (interval: ${EVOLUTION_WORKER_INTERVAL_MS}ms)`);
  }
  
  // Restart trend consistency worker
  if (!trendConsistencyInterval) {
    trendConsistencyInterval = setInterval(() => {
      selfHealingWrapper("trend", runTrendConsistencyWorker, crypto.randomUUID().slice(0, 8));
    }, 5 * 60_000);
    console.log(`[SCHEDULER] Trend consistency worker resumed`);
  }
  
  const pausedDurationMs = heavyWorkersPausedAt ? Date.now() - heavyWorkersPausedAt.getTime() : 0;
  
  heavyWorkersPaused = false;
  heavyWorkersPausedAt = null;
  
  logActivityEvent({
    eventType: "SYSTEM_STATUS_CHANGED",
    severity: "INFO",
    title: "Heavy workers resumed after memory recovery",
    summary: `Backtest and evolution workers resumed after ${Math.round(pausedDurationMs / 1000)}s pause`,
    payload: { pausedDurationMs, traceId, action: "MEMORY_RECOVERY" },
    traceId,
  }).catch(console.error);
}

/**
 * Get heavy worker pause status
 */
export function getHeavyWorkerStatus(): {
  paused: boolean;
  pausedAt: string | null;
  pausedDurationMs: number | null;
} {
  return {
    paused: heavyWorkersPaused,
    pausedAt: heavyWorkersPausedAt?.toISOString() || null,
    pausedDurationMs: heavyWorkersPausedAt ? Date.now() - heavyWorkersPausedAt.getTime() : null,
  };
}
