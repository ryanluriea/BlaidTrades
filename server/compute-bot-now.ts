/**
 * CANONICAL BOT-NOW COMPUTATION - SERVER-SIDE TRUTH
 * 
 * This module computes the SINGLE canonical "state" for bots using batched queries.
 * The UI renders from botNow.state ONLY - no client-side derivation.
 * 
 * PRECEDENCE ORDER (strict):
 * 1. ERROR - bot killed or fatal error
 * 2. BLOCKED_BY_GATES - stageGate.allowed=false
 * 3. BACKTEST_RUNNING/EVOLVING/RUNNER_RUNNING - active job running
 * 4. BACKTEST_QUEUED/RUNNER_STARTING - queued job exists
 * 5. RUNNER_RUNNING/RUNNER_STALE - runner exists
 * 6. NEEDS_BACKTEST - stage requires baseline and none exists
 * 7. FRESH - created recently with no activity
 * 8. IDLE - default
 */

import { db } from "./db";
import { botJobs, botInstances, backtestSessions, integrations } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

// UUID validation for SQL injection prevention
function isValidUuid(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * PRODUCTION-SAFE: Convert UUID array to PostgreSQL array literal string
 * This is passed as a SINGLE parameter (constant query size ~50 bytes)
 * PostgreSQL parses the array literal server-side, avoiding statement size limits
 * 
 * Example: ['uuid1', 'uuid2'] -> '{uuid1,uuid2}' passed as $1::uuid[]
 */
function toUuidArrayLiteral(ids: string[]): string {
  const validatedIds = ids.filter(id => isValidUuid(id));
  if (validatedIds.length === 0) {
    return '{}';
  }
  return `{${validatedIds.join(',')}}`;
}

// =============================================
// CANONICAL BOT STATE (single state)
// =============================================

export type CanonicalState =
  | 'ERROR'
  | 'BLOCKED_BY_GATES'
  | 'BACKTEST_RUNNING'
  | 'IMPROVING_RUNNING'
  | 'EVOLVING'
  | 'RUNNER_RUNNING'
  | 'RUNNER_STARTING'
  | 'BACKTEST_QUEUED'
  | 'IMPROVING_QUEUED'
  | 'EVOLVE_QUEUED'
  | 'RUNNER_STALE'
  | 'RUNNER_REQUIRED'
  | 'NEEDS_BACKTEST'
  | 'FRESH'
  | 'IDLE';

export interface StageGateBlocker {
  code: string;
  severity: 'info' | 'warn' | 'critical';
  fix?: string;
}

export interface StageGate {
  allowed: boolean;
  blockers: StageGateBlocker[];
}

export interface StageInfo {
  stage: string;
  since?: string;
  reasonCode?: string;
  promotionMode: string;
}

export interface BotNow {
  state: CanonicalState;
  reasonCode: string;
  since?: string;
  stageGate: StageGate;
  stageInfo: StageInfo;
  // Generation tracking (backend truth)
  generation: {
    current: number;
    updatedAt?: string;
    reasonCode?: string;
  };
  runner?: {
    status: string;
    lastHeartbeatAt?: string;
    stale: boolean;
  };
  activeJob?: {
    id: string;
    type: string;
    status: string;
    createdAt: string;
    startedAt?: string | null;
    attempt: number;
    iteration: number;
    elapsedSeconds?: number;
  };
  // Jobs completed within last 2 minutes - for badge persistence
  recentJob?: {
    id: string;
    type: string;
    status: string;
    completedAt: string;
    attempt: number;
    iteration: number;
  };
  lastBacktest?: {
    id: string;
    status: string;
    completedAt?: string;
    trades?: number;
    netPnl?: number;
    sharpeRatio?: number;
    profitFactor?: number;
    winRate?: number;
    maxDrawdownPct?: number;
  };
}

// =============================================
// HELPER: Safe date-to-ISO conversion
// =============================================

function toIsoStringOrNull(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

// =============================================
// BATCHED QUERIES (no N+1)
// =============================================

interface LatestJob {
  botId: string;
  id: string;
  jobType: string;
  status: string | null;
  createdAt: Date | null;
  startedAt: Date | null;
  errorMessage: string | null;
  attempts: number | null;
  generationNumber: number | null;
}

interface LatestInstance {
  botId: string;
  id: string;
  status: string | null;
  activityState: string | null;
  lastHeartbeatAt: Date | null;
  isPrimaryRunner: boolean | null;
  jobType: string | null;
}

interface LatestBacktest {
  botId: string;
  id: string;
  status: string | null;
  completedAt: Date | null;
  totalTrades: number | null;
  netPnl: number | null;
  sharpeRatio: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
}

// Jobs completed within the recent window - for badge persistence
interface RecentCompletedJob {
  botId: string;
  id: string;
  jobType: string;
  status: string;
  completedAt: Date;
  attempts: number;
  generationNumber: number;
}

// 10 minute window for badge persistence (per SEV-1 spec requirement)
const RECENT_JOB_WINDOW_MS = 10 * 60 * 1000;

interface IntegrationStatus {
  provider: string;
  category: string | null;
  status: string | null;
  lastProbeAt: Date | null;
  lastProbeStatus: string | null;
}

async function getLatestJobsPerBot(botIds: string[]): Promise<Map<string, LatestJob>> {
  if (botIds.length === 0) return new Map();
  
  const uuidArray = toUuidArrayLiteral(botIds);
  const results = await db.execute(sql`
    SELECT DISTINCT ON (j.bot_id) 
      j.bot_id as "botId",
      j.id,
      j.job_type as "jobType",
      j.status,
      j.created_at as "createdAt",
      j.started_at as "startedAt",
      j.error_message as "errorMessage",
      COALESCE(j.attempts, 1) as "attempts",
      COALESCE(g.generation_number, 1) as "generationNumber"
    FROM bot_jobs j
    LEFT JOIN bots b ON j.bot_id = b.id
    LEFT JOIN bot_generations g ON b.current_generation_id = g.id
    WHERE j.bot_id = ANY(${uuidArray}::uuid[])
    ORDER BY j.bot_id, j.created_at DESC NULLS LAST, j.id DESC
  `);
  
  const map = new Map<string, LatestJob>();
  for (const row of results.rows as any[]) {
    map.set(row.botId, row);
  }
  return map;
}

async function getLatestInstancesPerBot(botIds: string[]): Promise<Map<string, LatestInstance>> {
  if (botIds.length === 0) return new Map();
  
  const uuidArray = toUuidArrayLiteral(botIds);
  const results = await db.execute(sql`
    SELECT DISTINCT ON (bot_id)
      bot_id as "botId",
      id,
      status,
      activity_state as "activityState",
      last_heartbeat_at as "lastHeartbeatAt",
      is_primary_runner as "isPrimaryRunner",
      job_type as "jobType"
    FROM bot_instances
    WHERE bot_id = ANY(${uuidArray}::uuid[])
      AND job_type = 'RUNNER'
      AND is_primary_runner = true
    ORDER BY bot_id, updated_at DESC NULLS LAST, id DESC
  `);
  
  const map = new Map<string, LatestInstance>();
  for (const row of results.rows as any[]) {
    map.set(row.botId, row);
  }
  return map;
}

async function getLatestBacktestsPerBot(botIds: string[]): Promise<Map<string, LatestBacktest>> {
  if (botIds.length === 0) return new Map();
  
  const uuidArray = toUuidArrayLiteral(botIds);
  const results = await db.execute(sql`
    SELECT DISTINCT ON (bot_id)
      bot_id as "botId",
      id,
      status,
      completed_at as "completedAt",
      total_trades as "totalTrades",
      net_pnl as "netPnl",
      sharpe_ratio as "sharpeRatio",
      profit_factor as "profitFactor",
      win_rate as "winRate",
      max_drawdown_pct as "maxDrawdownPct"
    FROM backtest_sessions
    WHERE bot_id = ANY(${uuidArray}::uuid[])
      AND status = 'completed'
    ORDER BY bot_id, completed_at DESC NULLS LAST, id DESC
  `);
  
  const map = new Map<string, LatestBacktest>();
  for (const row of results.rows as any[]) {
    map.set(row.botId, row);
  }
  return map;
}

// Get jobs completed within the recent window (10 minutes) for badge persistence
async function getRecentlyCompletedJobsPerBot(botIds: string[]): Promise<Map<string, RecentCompletedJob>> {
  if (botIds.length === 0) return new Map();
  
  const recentCutoff = new Date(Date.now() - RECENT_JOB_WINDOW_MS);
  const uuidArray = toUuidArrayLiteral(botIds);
  
  // Include COMPLETED and FAILED statuses - both should persist for visibility
  const results = await db.execute(sql`
    SELECT DISTINCT ON (j.bot_id) 
      j.bot_id as "botId",
      j.id,
      UPPER(j.job_type) as "jobType",
      j.status,
      j.completed_at as "completedAt",
      COALESCE(j.attempts, 1) as "attempts",
      COALESCE(g.generation_number, 1) as "generationNumber"
    FROM bot_jobs j
    LEFT JOIN bots b ON j.bot_id = b.id
    LEFT JOIN bot_generations g ON b.current_generation_id = g.id
    WHERE j.bot_id = ANY(${uuidArray}::uuid[])
      AND j.status IN ('COMPLETED', 'FAILED')
      AND j.completed_at >= ${recentCutoff}
    ORDER BY j.bot_id, j.completed_at DESC NULLS LAST, j.id DESC
  `);
  
  const map = new Map<string, RecentCompletedJob>();
  for (const row of results.rows as any[]) {
    map.set(row.botId, row);
  }
  return map;
}

interface JobCounts {
  backtestQueued: number;
  backtestRunning: number;
  improveQueued: number;
  improveRunning: number;
  evolveQueued: number;
  evolveRunning: number;
  runnerQueued: number;
  runnerRunning: number;
}

async function getActiveJobCountsPerBot(botIds: string[]): Promise<Map<string, JobCounts>> {
  if (botIds.length === 0) return new Map();
  
  const uuidArray = toUuidArrayLiteral(botIds);
  const results = await db.execute(sql`
    SELECT 
      bot_id as "botId",
      job_type as "jobType",
      status,
      COUNT(*)::int as count
    FROM bot_jobs
    WHERE bot_id = ANY(${uuidArray}::uuid[])
      AND status IN ('QUEUED', 'RUNNING', 'PENDING')
    GROUP BY bot_id, job_type, status
  `);
  
  const map = new Map<string, JobCounts>();
  
  for (const botId of botIds) {
    map.set(botId, { 
      backtestQueued: 0, backtestRunning: 0,
      improveQueued: 0, improveRunning: 0,
      evolveQueued: 0, evolveRunning: 0,
      runnerQueued: 0, runnerRunning: 0
    });
  }
  
  for (const row of results.rows as any[]) {
    const counts = map.get(row.botId);
    if (!counts) continue;
    
    const jobType = (row.jobType || '').toLowerCase();
    const status = (row.status || '').toUpperCase();
    
    // Match job types: database stores BACKTESTER, IMPROVING, EVOLVING
    if (jobType === 'backtest' || jobType === 'backtester') {
      if (status === 'QUEUED' || status === 'PENDING') counts.backtestQueued += row.count;
      if (status === 'RUNNING') counts.backtestRunning += row.count;
    } else if (jobType === 'improve' || jobType === 'improver' || jobType === 'improving') {
      if (status === 'QUEUED' || status === 'PENDING') counts.improveQueued += row.count;
      if (status === 'RUNNING') counts.improveRunning += row.count;
    } else if (jobType === 'evolution' || jobType === 'evolve' || jobType === 'evolver' || jobType === 'evolving') {
      if (status === 'QUEUED' || status === 'PENDING') counts.evolveQueued += row.count;
      if (status === 'RUNNING') counts.evolveRunning += row.count;
    } else if (jobType === 'runner') {
      if (status === 'QUEUED' || status === 'PENDING') counts.runnerQueued += row.count;
      if (status === 'RUNNING') counts.runnerRunning += row.count;
    }
  }
  
  return map;
}

async function getIntegrationStatuses(userId: string): Promise<IntegrationStatus[]> {
  const results = await db.execute(sql`
    SELECT 
      provider,
      provider_type as "category",
      status,
      last_probe_at as "lastProbeAt",
      last_probe_status as "lastProbeStatus"
    FROM integrations
    WHERE user_id = ${userId}::uuid
      AND is_enabled = true
  `);
  
  return (results.rows as unknown) as IntegrationStatus[];
}

// =============================================
// HISTORY EXISTENCE QUERIES (for FRESH check)
// =============================================

interface HistoryExists {
  hasAnyJobs: boolean;
  hasAnyBacktests: boolean;
  hasAnyInstances: boolean;
}

async function getHistoryExistsPerBot(botIds: string[]): Promise<Map<string, HistoryExists>> {
  if (botIds.length === 0) return new Map();
  
  const uuidArray = toUuidArrayLiteral(botIds);
  
  // Run all three queries in parallel
  const [jobResults, backtestResults, instanceResults] = await Promise.all([
    db.execute(sql`
      SELECT bot_id as "botId", COUNT(*)::int > 0 as "hasAny"
      FROM bot_jobs 
      WHERE bot_id = ANY(${uuidArray}::uuid[])
      GROUP BY bot_id
    `),
    db.execute(sql`
      SELECT bot_id as "botId", COUNT(*)::int > 0 as "hasAny"
      FROM backtest_sessions 
      WHERE bot_id = ANY(${uuidArray}::uuid[])
      GROUP BY bot_id
    `),
    db.execute(sql`
      SELECT bot_id as "botId", COUNT(*)::int > 0 as "hasAny"
      FROM bot_instances 
      WHERE bot_id = ANY(${uuidArray}::uuid[])
      GROUP BY bot_id
    `),
  ]);
  
  const jobsMap = new Map<string, boolean>();
  const backtestsMap = new Map<string, boolean>();
  const instancesMap = new Map<string, boolean>();
  
  for (const row of jobResults.rows as any[]) {
    jobsMap.set(row.botId, row.hasAny === true || row.hasAny === 't');
  }
  for (const row of backtestResults.rows as any[]) {
    backtestsMap.set(row.botId, row.hasAny === true || row.hasAny === 't');
  }
  for (const row of instanceResults.rows as any[]) {
    instancesMap.set(row.botId, row.hasAny === true || row.hasAny === 't');
  }
  
  const result = new Map<string, HistoryExists>();
  for (const botId of botIds) {
    result.set(botId, {
      hasAnyJobs: jobsMap.get(botId) || false,
      hasAnyBacktests: backtestsMap.get(botId) || false,
      hasAnyInstances: instancesMap.get(botId) || false,
    });
  }
  
  return result;
}

// =============================================
// STAGE GATE EVALUATION
// =============================================

const STAGE_REQUIREMENTS: Record<string, { 
  requiresMarketData: boolean; 
  requiresBroker: boolean;
  requiresBacktest: boolean;
}> = {
  LAB: { requiresMarketData: false, requiresBroker: false, requiresBacktest: false },
  PAPER: { requiresMarketData: true, requiresBroker: false, requiresBacktest: true },
  SHADOW: { requiresMarketData: true, requiresBroker: true, requiresBacktest: true },
  CANARY: { requiresMarketData: true, requiresBroker: true, requiresBacktest: true },
  LIVE: { requiresMarketData: true, requiresBroker: true, requiresBacktest: true },
};

const VERIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Industry-standard promotion thresholds for LAB → PAPER
// Based on quantitative trading best practices
const PROMOTION_THRESHOLDS = {
  LAB_TO_PAPER: {
    minTrades: 30,           // Minimum statistical significance
    minSharpe: 0.75,         // Risk-adjusted return threshold
    minProfitFactor: 1.5,    // Gross profit / gross loss
    maxDrawdownPct: 20,      // Maximum acceptable drawdown %
    minWinRate: 35,          // Minimum win rate % (with good R:R can still be profitable)
  },
  PAPER_TO_SHADOW: {
    minTrades: 50,
    minSharpe: 0.80,
    minProfitFactor: 1.6,
    maxDrawdownPct: 18,
    minWinRate: 38,
  },
};

interface BacktestMetrics {
  totalTrades: number | null;
  sharpeRatio: number | null;
  profitFactor: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
}

function evaluateStageGates(
  stage: string,
  integrationStatuses: IntegrationStatus[],
  hasBacktest: boolean,
  isTradingEnabled: boolean | null,
  backtestMetrics?: BacktestMetrics
): StageGate {
  const requirements = STAGE_REQUIREMENTS[stage] || STAGE_REQUIREMENTS.LAB;
  const blockers: StageGateBlocker[] = [];
  
  // Check trading enabled
  if (isTradingEnabled === false) {
    blockers.push({
      code: 'TRADING_DISABLED',
      severity: 'critical',
      fix: 'Enable trading in bot settings',
    });
  }
  
  // Check market data for PAPER+
  if (requirements.requiresMarketData) {
    const dataProviders = integrationStatuses.filter(i => i.category === 'data');
    const verifiedData = dataProviders.find(i => {
      if (i.status !== 'connected' && i.lastProbeStatus !== 'ok') return false;
      if (!i.lastProbeAt) return false;
      const age = Date.now() - new Date(i.lastProbeAt).getTime();
      return age < VERIFICATION_WINDOW_MS;
    });
    
    if (!verifiedData) {
      blockers.push({
        code: 'MARKET_DATA_NOT_VERIFIED',
        severity: 'critical',
        fix: 'Run /api/integrations/verify for databento or polygon',
      });
    }
  }
  
  // Check broker for SHADOW+
  if (requirements.requiresBroker) {
    const brokerProviders = integrationStatuses.filter(i => i.category === 'broker');
    const verifiedBroker = brokerProviders.find(i => {
      if (i.status !== 'connected' && i.lastProbeStatus !== 'ok') return false;
      if (!i.lastProbeAt) return false;
      const age = Date.now() - new Date(i.lastProbeAt).getTime();
      return age < VERIFICATION_WINDOW_MS;
    });
    
    if (!verifiedBroker) {
      blockers.push({
        code: 'BROKER_NOT_VERIFIED',
        severity: 'critical',
        fix: 'Configure IRONBEAM_* secrets and run /api/integrations/verify ironbeam',
      });
    }
  }
  
  // Check baseline backtest for PAPER+
  if (requirements.requiresBacktest && !hasBacktest) {
    blockers.push({
      code: 'NO_BASELINE_BACKTEST',
      severity: 'warn',
      fix: 'Run a backtest before promoting to this stage',
    });
  }
  
  // Quantitative promotion thresholds for LAB → PAPER
  if (stage === 'PAPER' && backtestMetrics) {
    const thresholds = PROMOTION_THRESHOLDS.LAB_TO_PAPER;
    
    // Check minimum trades for statistical significance
    if (backtestMetrics.totalTrades !== null && backtestMetrics.totalTrades < thresholds.minTrades) {
      blockers.push({
        code: 'INSUFFICIENT_TRADES',
        severity: 'critical',
        fix: `Need ${thresholds.minTrades}+ trades for statistical significance (current: ${backtestMetrics.totalTrades})`,
      });
    }
    
    // Check Sharpe ratio
    if (backtestMetrics.sharpeRatio !== null && backtestMetrics.sharpeRatio < thresholds.minSharpe) {
      blockers.push({
        code: 'LOW_SHARPE_RATIO',
        severity: 'critical',
        fix: `Sharpe ratio must be >= ${thresholds.minSharpe} (current: ${backtestMetrics.sharpeRatio.toFixed(2)})`,
      });
    }
    
    // Check profit factor
    if (backtestMetrics.profitFactor !== null && backtestMetrics.profitFactor < thresholds.minProfitFactor) {
      blockers.push({
        code: 'LOW_PROFIT_FACTOR',
        severity: 'critical',
        fix: `Profit factor must be >= ${thresholds.minProfitFactor} (current: ${backtestMetrics.profitFactor.toFixed(2)})`,
      });
    }
    
    // Check max drawdown
    if (backtestMetrics.maxDrawdownPct !== null && backtestMetrics.maxDrawdownPct > thresholds.maxDrawdownPct) {
      blockers.push({
        code: 'EXCESSIVE_DRAWDOWN',
        severity: 'critical',
        fix: `Max drawdown must be <= ${thresholds.maxDrawdownPct}% (current: ${backtestMetrics.maxDrawdownPct.toFixed(1)}%)`,
      });
    }
    
    // Check win rate (warning, not critical - can still be profitable with low win rate)
    if (backtestMetrics.winRate !== null && backtestMetrics.winRate < thresholds.minWinRate) {
      blockers.push({
        code: 'LOW_WIN_RATE',
        severity: 'warn',
        fix: `Win rate is ${backtestMetrics.winRate.toFixed(1)}% (recommended >= ${thresholds.minWinRate}%)`,
      });
    }
  }
  
  return {
    allowed: blockers.filter(b => b.severity === 'critical').length === 0,
    blockers,
  };
}

// =============================================
// HEARTBEAT FRESHNESS
// =============================================

const HEARTBEAT_STALE_THRESHOLD_MS = 60 * 1000;
const FRESH_BOT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isHeartbeatStale(lastHeartbeat: Date | string | null): boolean {
  if (!lastHeartbeat) return true;
  const age = Date.now() - new Date(lastHeartbeat).getTime();
  return age > HEARTBEAT_STALE_THRESHOLD_MS;
}

function isBotFresh(createdAt: Date | string | null): boolean {
  if (!createdAt) return false;
  const age = Date.now() - new Date(createdAt).getTime();
  return age < FRESH_BOT_THRESHOLD_MS;
}

// =============================================
// COMPUTE SINGLE BOT NOW (with precedence)
// =============================================

interface BotInput {
  id: string;
  stage: string | null;
  mode: string | null;
  healthState: string | null;
  healthScore: number | string | null;
  healthReasonCode: string | null;
  healthReasonDetail: string | null;
  killedAt: Date | null;
  killReason: string | null;
  isTradingEnabled: boolean | null;
  evolutionMode: string | null;
  createdAt: Date | null;
  stageUpdatedAt?: Date | null;
  stageReasonCode?: string | null;
  promotionMode?: string | null;
  // Generation tracking (backend truth)
  currentGeneration?: number | null;
  generationUpdatedAt?: Date | null;
  generationReasonCode?: string | null;
}

function computeSingleBotNow(
  bot: BotInput,
  latestJob: LatestJob | undefined,
  instance: LatestInstance | undefined,
  latestBacktest: LatestBacktest | undefined,
  jobCounts: JobCounts,
  stageGate: StageGate,
  historyExists: HistoryExists,
  recentCompletedJob: RecentCompletedJob | undefined
): BotNow {
  const stage = bot.stage || 'TRIALS';
  
  // Build sub-objects first
  const runnerObj = instance ? {
    status: instance.status || 'unknown',
    lastHeartbeatAt: toIsoStringOrNull(instance.lastHeartbeatAt),
    stale: isHeartbeatStale(instance.lastHeartbeatAt),
  } : undefined;
  
  // Calculate elapsed time for running jobs
  const jobStartTime = latestJob?.startedAt || latestJob?.createdAt;
  const elapsedSeconds = jobStartTime && latestJob?.status === 'RUNNING' 
    ? Math.floor((Date.now() - new Date(jobStartTime).getTime()) / 1000)
    : undefined;
    
  const activeJobObj = latestJob && ['QUEUED', 'RUNNING', 'PENDING'].includes(latestJob.status || '') ? {
    id: latestJob.id,
    type: latestJob.jobType,
    status: latestJob.status || 'UNKNOWN',
    createdAt: toIsoStringOrNull(latestJob.createdAt) || new Date().toISOString(),
    startedAt: toIsoStringOrNull(latestJob.startedAt),
    attempt: latestJob.attempts ?? 1,
    iteration: latestJob.generationNumber ?? 1,
    elapsedSeconds,
  } : undefined;
  
  const lastBacktestObj = latestBacktest ? {
    id: latestBacktest.id,
    status: latestBacktest.status || 'unknown',
    completedAt: toIsoStringOrNull(latestBacktest.completedAt),
    trades: latestBacktest.totalTrades ?? undefined,
    netPnl: latestBacktest.netPnl ?? undefined,
    sharpeRatio: latestBacktest.sharpeRatio ?? undefined,
    profitFactor: latestBacktest.profitFactor ?? undefined,
    winRate: latestBacktest.winRate ?? undefined,
    maxDrawdownPct: latestBacktest.maxDrawdownPct ?? undefined,
  } : undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // PRECEDENCE ORDER - compute single canonical state (strict deterministic)
  // ═══════════════════════════════════════════════════════════════════════════
  
  let state: CanonicalState;
  let reasonCode: string | undefined;
  let since: string | undefined;
  
  const instanceStatus = (instance?.status || '').toLowerCase();
  const instanceRunning = instanceStatus === 'running';
  const instanceStarting = instanceStatus === 'starting';
  const instanceStopped = instanceStatus === 'stopped' || instanceStatus === 'idle' || !instance;
  const heartbeatFresh = instance ? !isHeartbeatStale(instance.lastHeartbeatAt) : false;
  
  // Stages that require a runner for execution
  const stageRequiresRunner = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  
  // 1) ERROR - bot killed or fatal error
  if (bot.killedAt) {
    state = 'ERROR';
    reasonCode = bot.killReason || 'BOT_KILLED';
    since = toIsoStringOrNull(bot.killedAt);
  }
  // 2) BLOCKED_BY_GATES - stageGate.allowed=false
  else if (!stageGate.allowed) {
    state = 'BLOCKED_BY_GATES';
    const criticalBlocker = stageGate.blockers.find(b => b.severity === 'critical');
    reasonCode = criticalBlocker?.code || 'GATE_BLOCKED';
  }
  // 3) Active RUNNING jobs (highest precedence for active work)
  else if (jobCounts.backtestRunning > 0) {
    state = 'BACKTEST_RUNNING';
    reasonCode = 'JOB_BACKTEST_RUNNING';
    if (activeJobObj) since = toIsoStringOrNull(latestJob?.startedAt) || activeJobObj.createdAt;
  }
  else if (jobCounts.improveRunning > 0) {
    state = 'IMPROVING_RUNNING';
    reasonCode = 'JOB_IMPROVE_RUNNING';
    if (activeJobObj) since = toIsoStringOrNull(latestJob?.startedAt) || activeJobObj.createdAt;
  }
  else if (jobCounts.evolveRunning > 0) {
    state = 'EVOLVING';
    reasonCode = 'JOB_EVOLUTION_RUNNING';
    if (activeJobObj) since = toIsoStringOrNull(latestJob?.startedAt) || activeJobObj.createdAt;
  }
  // 3c) RUNNER job running - unless runner instance confirms running
  else if (jobCounts.runnerRunning > 0) {
    if (instance && instanceRunning && heartbeatFresh) {
      // Runner instance is confirmed running with fresh heartbeat
      state = 'RUNNER_RUNNING';
      reasonCode = instance.activityState || 'RUNNER_ACTIVE';
      since = toIsoStringOrNull(instance.lastHeartbeatAt);
    } else {
      // Runner job running but instance not confirmed yet
      state = 'RUNNER_STARTING';
      reasonCode = 'RUNNER_JOB_RUNNING';
      if (activeJobObj) since = activeJobObj.createdAt;
    }
  }
  // 4) Queued jobs exist
  else if (jobCounts.backtestQueued > 0) {
    state = 'BACKTEST_QUEUED';
    reasonCode = 'JOB_BACKTEST_QUEUED';
    if (activeJobObj) since = activeJobObj.createdAt;
  }
  else if (jobCounts.improveQueued > 0) {
    state = 'IMPROVING_QUEUED';
    reasonCode = 'JOB_IMPROVE_QUEUED';
    if (activeJobObj) since = activeJobObj.createdAt;
  }
  else if (jobCounts.evolveQueued > 0) {
    state = 'EVOLVE_QUEUED';
    reasonCode = 'JOB_EVOLVE_QUEUED';
    if (activeJobObj) since = activeJobObj.createdAt;
  }
  else if (jobCounts.runnerQueued > 0) {
    state = 'RUNNER_STARTING';
    reasonCode = 'RUNNER_JOB_QUEUED';
    if (activeJobObj) since = activeJobObj.createdAt;
  }
  // 5) Runner instance exists - check status
  else if (instance) {
    if (instanceRunning && heartbeatFresh) {
      state = 'RUNNER_RUNNING';
      reasonCode = instance.activityState || 'RUNNER_ACTIVE';
      since = toIsoStringOrNull(instance.lastHeartbeatAt);
    }
    else if (instanceRunning && !heartbeatFresh) {
      state = 'RUNNER_STALE';
      reasonCode = 'RUNNER_HEARTBEAT_STALE';
      since = toIsoStringOrNull(instance.lastHeartbeatAt);
    }
    else if (instanceStarting) {
      state = 'RUNNER_STARTING';
      reasonCode = 'RUNNER_INSTANCE_STARTING';
    }
    else if (instanceStopped && stageRequiresRunner) {
      state = 'RUNNER_REQUIRED';
      reasonCode = 'RUNNER_STOPPED_STAGE_REQUIRES';
    }
    else {
      // Instance exists but stopped and stage doesn't require runner
      state = 'IDLE';
      reasonCode = 'RUNNER_STOPPED';
    }
  }
  // 6) Stage requires baseline backtest and none exists
  else if (['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage) && !latestBacktest) {
    state = 'NEEDS_BACKTEST';
    reasonCode = 'NO_BASELINE_BACKTEST';
  }
  // 7) Stage requires runner but none exists
  else if (stageRequiresRunner && !instance) {
    state = 'RUNNER_REQUIRED';
    reasonCode = 'NO_RUNNER_FOR_STAGE';
  }
  // 8) Fresh bot - created recently AND truly NO HISTORY EVER (not just no active jobs)
  // This is the critical fix: we check for ANY existence of jobs/backtests/instances, not just latest/active
  else if (
    isBotFresh(bot.createdAt) && 
    !historyExists.hasAnyJobs && 
    !historyExists.hasAnyBacktests && 
    !historyExists.hasAnyInstances
  ) {
    state = 'FRESH';
    reasonCode = 'NEWLY_CREATED';
    since = toIsoStringOrNull(bot.createdAt);
  }
  // 9) Default - IDLE
  else {
    state = 'IDLE';
    if (latestBacktest) {
      reasonCode = 'BACKTEST_COMPLETE';
    } else if (stage === 'TRIALS') {
      reasonCode = 'READY_FOR_BACKTEST';
    } else {
      reasonCode = 'AWAITING_ACTION';
    }
  }

  // Build stageInfo
  const stageInfo: StageInfo = {
    stage,
    since: toIsoStringOrNull(bot.stageUpdatedAt),
    reasonCode: bot.stageReasonCode || undefined,
    promotionMode: bot.promotionMode || 'MANUAL',
  };

  // Build recentJob object for badge persistence
  const recentJobObj = recentCompletedJob ? {
    id: recentCompletedJob.id,
    type: recentCompletedJob.jobType,
    status: recentCompletedJob.status,
    completedAt: toIsoStringOrNull(recentCompletedJob.completedAt) || new Date().toISOString(),
    attempt: recentCompletedJob.attempts,
    iteration: recentCompletedJob.generationNumber,
  } : undefined;

  // Build generation object (backend truth)
  const generationObj = {
    current: bot.currentGeneration || 1,
    updatedAt: toIsoStringOrNull(bot.generationUpdatedAt),
    reasonCode: bot.generationReasonCode || undefined,
  };

  return {
    state,
    reasonCode: reasonCode || 'UNKNOWN',  // Ensure never undefined
    since,
    stageGate,  // Always include - empty blockers means allowed=true
    stageInfo,
    generation: generationObj,  // Generation tracking (backend truth)
    runner: runnerObj,
    activeJob: activeJobObj,
    recentJob: recentJobObj,  // Jobs completed in last 2 minutes for badge persistence
    lastBacktest: lastBacktestObj,
  };
}

// =============================================
// PUBLIC API
// =============================================

export async function computeBotsNow(botList: BotInput[], userId?: string): Promise<Map<string, BotNow>> {
  if (botList.length === 0) return new Map();
  
  const botIds = botList.map(b => b.id);
  
  // Fetch integration statuses for stage gate evaluation
  let integrationStatuses: IntegrationStatus[] = [];
  if (userId) {
    try {
      integrationStatuses = await getIntegrationStatuses(userId);
    } catch (e) {
      console.error('[computeBotsNow] Failed to fetch integration statuses:', e);
    }
  }
  
  // Parameterized uuid[] arrays - query size stays constant regardless of bot count
  const [latestJobs, latestInstances, latestBacktests, activeJobCounts, historyExistsMap, recentCompletedJobs] = await Promise.all([
    getLatestJobsPerBot(botIds),
    getLatestInstancesPerBot(botIds),
    getLatestBacktestsPerBot(botIds),
    getActiveJobCountsPerBot(botIds),
    getHistoryExistsPerBot(botIds),
    getRecentlyCompletedJobsPerBot(botIds),  // Jobs completed within 10 min for badge persistence
  ]);
  
  const result = new Map<string, BotNow>();
  
  for (const bot of botList) {
    const latestBacktest = latestBacktests.get(bot.id);
    const hasCompletedBacktest = latestBacktest && latestBacktest.status === 'completed';
    
    // Extract backtest metrics for quantitative gate evaluation
    // CRITICAL: win_rate in DB is decimal (0.35 = 35%), convert to percentage for threshold comparison
    // max_drawdown_pct in DB is already percentage (8.9 = 8.9%), no conversion needed
    const backtestMetrics: BacktestMetrics | undefined = hasCompletedBacktest && latestBacktest ? {
      totalTrades: latestBacktest.totalTrades,
      sharpeRatio: latestBacktest.sharpeRatio,
      profitFactor: latestBacktest.profitFactor,
      winRate: latestBacktest.winRate !== null ? latestBacktest.winRate * 100 : null,
      maxDrawdownPct: latestBacktest.maxDrawdownPct,
    } : undefined;
    
    // Evaluate stage gates per bot (with quantitative thresholds)
    const stageGate = evaluateStageGates(
      bot.stage || 'TRIALS',
      integrationStatuses,
      !!hasCompletedBacktest,
      bot.isTradingEnabled,
      backtestMetrics
    );
    
    // Get history existence for FRESH check
    const historyExists = historyExistsMap.get(bot.id) || {
      hasAnyJobs: false,
      hasAnyBacktests: false,
      hasAnyInstances: false,
    };
    
    const botNow = computeSingleBotNow(
      bot,
      latestJobs.get(bot.id),
      latestInstances.get(bot.id),
      latestBacktest,
      activeJobCounts.get(bot.id) || { 
        backtestQueued: 0, backtestRunning: 0,
        improveQueued: 0, improveRunning: 0,
        evolveQueued: 0, evolveRunning: 0,
        runnerQueued: 0, runnerRunning: 0
      },
      stageGate,
      historyExists,
      recentCompletedJobs.get(bot.id)  // Jobs completed in last 2 min for badge persistence
    );
    result.set(bot.id, botNow);
  }
  
  return result;
}

export async function computeBotNow(bot: BotInput, userId?: string): Promise<BotNow> {
  const result = await computeBotsNow([bot], userId);
  return result.get(bot.id)!;
}
