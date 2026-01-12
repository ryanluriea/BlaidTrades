/**
 * useBotsOverview - Single hook for /bots page data
 * 
 * INSTITUTIONAL: ONE request, ONE source of truth, ZERO per-bot queries.
 * 
 * SOURCE-OF-TRUTH:
 * - TRIALS: session_* fields from LATEST COMPLETED backtest_session
 * - PAPER/LIVE: live_* fields from trade_logs
 * - Generation: generation field (from MAX bot_generations.generation_number)
 * - Backtest count: backtests_completed field (COUNT of completed sessions)
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useServerClock } from "@/contexts/ServerClockContext";

export type BacktestStatus = 'fresh' | 'stale' | 'running' | 'queued' | 'failing';

export interface BotOverview {
  id: string;
  name: string;
  description: string | null;
  stage: string;
  symbol: string | null;
  strategy_type: string | null;
  strategy_config: Record<string, unknown> | null;
  config_hash: string | null;
  mode: string;
  status: string;
  is_trading_enabled: boolean;
  evolution_mode: string | null;
  created_at: string;
  updated_at: string;
  
  generation: number;
  version_major: number;
  version_minor: number;
  
  session_trades: number;
  session_pnl_usd: number | null;
  session_win_rate_pct: number | null;
  session_sharpe: number | null;
  session_max_dd_pct: number | null;
  session_max_dd_usd: number | null;
  session_profit_factor: number | null;
  
  backtests_completed: number;
  
  session_completed_at: string | null;
  session_age_seconds: number | null;
  session_is_stale: boolean;
  last_failed_at: string | null;
  last_failed_reason: string | null;
  failed_since_last_success: number;
  backtest_status: BacktestStatus;
  
  live_total_trades: number;
  live_pnl: number | null;
  live_win_rate: number | null;
  // Real-time paper trading data from active runner
  live_unrealized_pnl: number | null;
  // Total P&L (realized + unrealized) for display purposes
  live_total_pnl: number | null;
  has_open_position: boolean;
  // Open trades count for Activity Grid display
  live_open_trades: number;
  // Paper trading metrics computed from paper_trades table
  live_max_drawdown_pct: number | null;
  live_sharpe: number | null;
  live_profit_factor: number | null;
  
  health_state: string | null;
  bqs_latest: number | null;
  priority_score: number | null;
  priority_bucket: string | null;
  
  backtest_total_trades: number;
  backtest_win_rate: number | null;
  backtest_profit_factor: number | null;
  backtest_max_drawdown: number | null;
  backtest_pnl: number | null;
  generation_number: number;
  latest_generation: number;
  latest_version_major: number;
  latest_version_minor: number;
  /** Last backtest data source: 'DATABENTO_REAL' | 'SIMULATED_FALLBACK' | null */
  last_data_source: string | null;
  
  /** Metrics availability status from backend: 'AVAILABLE' | 'AWAITING_EVIDENCE' | 'NEW_GENERATION_PENDING' | 'PRIOR_GENERATION' */
  metrics_status: 'AVAILABLE' | 'AWAITING_EVIDENCE' | 'NEW_GENERATION_PENDING' | 'PRIOR_GENERATION';
  
  // Trend data from generation_metrics_history (backend truth)
  trend_direction: TrendDirection;
  peak_generation: number | null;
  peak_sharpe: number | null;
  decline_from_peak_pct: number | null;
  is_revert_candidate: boolean;
  
  // Matrix aggregate data (from latest completed matrix run)
  matrix_aggregate: {
    median_pf: number | null;
    worst_pf: number | null;
    best_pf: number | null;
    median_max_dd_pct: number | null;
    worst_max_dd_pct: number | null;
    trade_count_total: number;
    consistency_score: number;
    stability_score: number;
    cells_with_data: number;
    total_cells: number;
  } | null;
  matrix_best_cell: {
    timeframe: string;
    horizon: string;
    profit_factor: number | null;
    win_rate: number | null;
    fold_index: number;
  } | null;
  matrix_worst_cell: {
    timeframe: string;
    horizon: string;
    profit_factor: number | null;
    fold_index: number;
  } | null;
  last_matrix_completed_at: string | null;
  
  // Canonical bot state from server (passthrough - not business logic)
  botNow?: {
    state: string;
    reasonCode?: string | null;
    stageGate?: { allowed: boolean; blockers: Array<{ code: string; severity: string; fix: string }> };
    lastBacktest?: { id: string; status: string; completedAt: string | null; trades: number; netPnl: number | null };
    generation?: { current: number; updatedAt?: string; reasonCode?: string };
    activeJob?: { id: string; type: string; status: string; createdAt: string; startedAt?: string; attempt: number; iteration: number; elapsedSeconds?: number };
    recentJob?: { id: string; type: string; status: string; completedAt: string; attempt: number; iteration: number };
    runner?: { status: string; lastHeartbeatAt?: string; stale: boolean };
  } | null;
  
  // Activity Grid: Walk-forward (Matrix) status, timeframes, and alert count
  latest_walk_forward_status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  latest_walk_forward_progress: number;
  latest_walk_forward_timeframes: string[];
  latest_walk_forward_completed_cells: number;
  latest_walk_forward_total_cells: number;
  latest_walk_forward_current_timeframe: string | null;
  alert_count: number;
  
  // Last trade timestamp for recency display in ActivityGrid
  last_trade_at: string | null;
  
  // Bot's configured timeframe (from bot settings)
  timeframe: string | null;
  
  // Generation's locked timeframe (SOURCE OF TRUTH for current generation's timeframe)
  // This is the timeframe recorded when the generation was created - immutable after backtests run
  generation_timeframe: string | null;
  
  // Idle reason visibility
  idleReason: string | null;
  queuedJobType: string | null;
  hasRunningJob: boolean;
  // Running job timestamps for elapsed time display
  backtestStartedAt: string | null;
  evolveStartedAt: string | null;
  improveStartedAt: string | null;
  // AI Provider fields for InlineAiProviderBadge
  aiProvider: string | null;
  createdByAi: string | null;
  aiProviderBadge: boolean | null;
  aiResearchSources: unknown | null;
  aiReasoning: string | null;
  aiResearchDepth: string | null;
}

export interface PerBotData {
  instanceStatus: {
    id: string | null;
    status: string | null;
    activityState: string | null;
    lastHeartbeatAt: string | null;
    mode: string | null;
    accountId: string | null;
    accountName: string | null;
    accountType: string | null;
    accountTotalBlownCount: number;
    accountConsecutiveBlownCount: number;
  };
  lastJob: {
    status: string | null;
    type: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
  };
  healthScore: {
    score: number | null;
    asOf: string | null;
  };
  improvementState: {
    status: string | null;
    consecutiveFailures: number;
    whyNotPromoted: Record<string, unknown> | null;
    nextAction: string | null;
    nextRetryAt: string | null;
    attemptsUsed: number;
    lastImprovementAt: string | null;
  };
  jobs: {
    backtestRunning: number;
    backtestQueued: number;
    evolveRunning: number;
    evolveQueued: number;
    improveRunning: number;
    improveQueued: number;
    backtestStartedAt: string | null;
    evolveStartedAt: string | null;
    improveStartedAt: string | null;
  };
}

// INSTITUTIONAL FRESHNESS CONTRACT: Data validity tracking
// ZERO TOLERANCE: Frontend must not display P&L unless displayAllowed === true
export interface FreshnessContract {
  maxStaleSeconds: number;
  dataSource: 'live' | 'cache' | 'none';
  dataFreshness: 'FRESH' | 'STALE';
  markTimestamp: string | null; // Only present when displayAllowed === true
  autonomyAllowed?: boolean; // If false, trading is halted
  displayAllowed?: boolean; // CRITICAL: If false, do NOT render P&L values
}

export interface BotsOverviewData {
  bots: BotOverview[];
  perBot: Record<string, PerBotData>;
  alertsCount: number;
  integrationsSummary: {
    brokersConnected: number;
    dataSourcesConnected: number;
    aiProvidersConnected: number;
  };
  generatedAt: string;
  source: "cache" | "db" | "stale";
  // FRESHNESS CONTRACT: Frontend must validate data age before display
  freshnessContract?: FreshnessContract;
}

const EMPTY_DATA: BotsOverviewData = {
  bots: [],
  perBot: {},
  alertsCount: 0,
  integrationsSummary: { brokersConnected: 0, dataSourcesConnected: 0, aiProvidersConnected: 0 },
  generatedAt: new Date().toISOString(),
  source: "db",
};

/**
 * Extract job startedAt timestamp from botNow.activeJob based on job type
 * Returns ISO string or null
 * 
 * Handles variant job type names:
 * - BACKTESTER / BACKTEST
 * - EVOLVING / EVOLVE  
 * - IMPROVING / IMPROVE
 */
function extractJobStartedAt(raw: any, jobType: 'BACKTESTER' | 'EVOLVING' | 'IMPROVING'): string | null {
  const activeJob = raw.botNow?.activeJob;
  if (!activeJob) return null;
  
  // Normalize and match job type (tolerant of variant names)
  const activeType = activeJob.type?.toUpperCase() || '';
  const typeMatches = 
    (jobType === 'BACKTESTER' && (activeType === 'BACKTESTER' || activeType === 'BACKTEST')) ||
    (jobType === 'EVOLVING' && (activeType === 'EVOLVING' || activeType === 'EVOLVE')) ||
    (jobType === 'IMPROVING' && (activeType === 'IMPROVING' || activeType === 'IMPROVE'));
  
  if (!typeMatches) return null;
  
  // Only return startedAt for RUNNING jobs
  if (activeJob.status !== 'RUNNING') return null;
  
  const startedAt = activeJob.startedAt || activeJob.createdAt;
  return startedAt ? new Date(startedAt).toISOString() : null;
}

function transformBotFromApi(raw: any): BotOverview {
  // Prefer most recent activity timestamp for "updated_at":
  // 1. recentJob.completedAt ONLY if it's a meaningful job (not IMPROVING which runs constantly)
  // 2. generation.updatedAt (if generation changed)
  // 3. lastBacktestAt (actual backtest completion)
  // 4. metricsAsof (from latest backtest completion or bot.updatedAt)
  // 5. createdAt (fallback)
  const recentJob = raw.botNow?.recentJob;
  // IMPROVING jobs run every 15 seconds - exclude them from "updated" timestamp
  // Only count BACKTESTER, EVALUATOR, EVOLVING as meaningful activity
  const meaningfulJobTypes = ['BACKTESTER', 'EVALUATOR', 'EVOLVING'];
  const recentMeaningfulJobAt = recentJob && meaningfulJobTypes.includes(recentJob.type)
    ? recentJob.completedAt
    : null;
  
  const updatedAt = recentMeaningfulJobAt
    || raw.botNow?.generation?.updatedAt 
    || raw.lastBacktestAt
    || raw.metricsAsof 
    || raw.createdAt;
  
  return {
    id: raw.id,
    name: raw.name,
    description: null,
    stage: raw.stage || 'TRIALS',
    symbol: raw.symbol,
    strategy_type: null,
    strategy_config: raw.strategyConfig || null,
    config_hash: null,
    mode: raw.mode || 'BACKTEST_ONLY',
    status: raw.status || 'idle',
    is_trading_enabled: raw.status === 'running',
    evolution_mode: raw.evolutionMode,
    created_at: raw.createdAt,
    updated_at: updatedAt,
    generation: raw.generation || 1,
    version_major: 1,
    version_minor: 0,
    // CRITICAL: Use ONLY backend-computed session fields (already filtered by current generation)
    // DO NOT fallback to botNow.lastBacktest - that shows data from ANY generation, causing leakage
    session_trades: raw.sessionTrades ?? 0,
    session_pnl_usd: raw.sessionPnlUsd ?? null,
    session_win_rate_pct: raw.sessionWinRatePct ?? null,
    session_sharpe: raw.sessionSharpe ?? null,
    session_max_dd_pct: raw.sessionMaxDdPct ?? null,
    session_max_dd_usd: raw.sessionMaxDdUsd ?? null,
    session_profit_factor: raw.sessionProfitFactor ?? null,
    backtests_completed: raw.backtestsCompleted || 0,
    session_completed_at: raw.lastBacktestAt,
    session_age_seconds: null,
    session_is_stale: false,
    last_failed_at: null,
    last_failed_reason: null,
    failed_since_last_success: 0,
    backtest_status: 'fresh',
    // CRITICAL: ONLY use live_pnl from API (computed from paper_trades table with ACTIVE attempt filter)
    // Do NOT fallback to cached bot columns (liveTotalTrades, livePnl, liveWinRate) - they may be stale
    live_total_trades: raw.live_pnl?.closed_trades ?? 0,
    live_pnl: raw.live_pnl?.realized ?? 0,
    live_win_rate: raw.live_pnl?.win_rate ?? null,
    // Real-time paper trading data from active runner
    live_unrealized_pnl: raw.live_pnl?.unrealized ?? null,
    // Total P&L (realized + unrealized) for display purposes
    live_total_pnl: raw.live_pnl?.total ?? null,
    has_open_position: raw.live_pnl?.has_open_position ?? false,
    // Open trades count (for display in Activity Grid)
    live_open_trades: raw.live_pnl?.open_trades ?? 0,
    // Paper trading metrics computed from paper_trades table (database-level)
    // CRITICAL: No fallback to cached columns - only use live_pnl from API
    live_max_drawdown_pct: raw.live_pnl?.max_drawdown_pct ?? null,
    live_sharpe: raw.live_pnl?.sharpe ?? null,
    live_profit_factor: raw.live_pnl?.profit_factor ?? null,
    health_state: raw.healthScore >= 80 ? 'healthy' : raw.healthScore >= 50 ? 'degraded' : 'critical',
    bqs_latest: raw.healthScore,
    priority_score: raw.priorityScore,
    priority_bucket: null,
    // CRITICAL: Use ONLY backend-computed values - NO botNow.lastBacktest fallbacks
    backtest_total_trades: raw.sessionTrades ?? 0,
    backtest_win_rate: raw.sessionWinRatePct ?? null,
    backtest_profit_factor: raw.sessionProfitFactor ?? null,
    backtest_max_drawdown: raw.sessionMaxDdPct ?? null,
    backtest_pnl: raw.sessionPnlUsd ?? null,
    generation_number: raw.generation || 1,
    latest_generation: raw.latest_generation ?? raw.generation ?? 1,
    latest_version_major: 1,
    latest_version_minor: 0,
    last_data_source: raw.lastDataSource || null,
    // Metrics status from backend - indicates if current generation has sufficient evidence
    metrics_status: raw.metricsStatus || 'AWAITING_EVIDENCE',
    // Matrix aggregate data (from API response)
    matrix_aggregate: raw.matrix_aggregate || null,
    matrix_best_cell: raw.matrix_best_cell || null,
    matrix_worst_cell: raw.matrix_worst_cell || null,
    last_matrix_completed_at: raw.last_matrix_completed_at || null,
    // Trend data from generation_metrics_history (backend truth)
    trend_direction: raw.trend_direction || null,
    peak_generation: raw.peakGeneration ?? raw.peak_generation ?? null,
    peak_sharpe: raw.peakSharpe ?? raw.peak_sharpe ?? null,
    decline_from_peak_pct: raw.declineFromPeakPct ?? raw.decline_from_peak_pct ?? null,
    is_revert_candidate: raw.isRevertCandidate ?? raw.is_revert_candidate ?? false,
    // Activity Grid: Walk-forward (Matrix) status, timeframes, and alert count
    latest_walk_forward_status: raw.latest_walk_forward_status || null,
    latest_walk_forward_progress: raw.latest_walk_forward_progress ?? 0,
    latest_walk_forward_timeframes: raw.latest_walk_forward_timeframes ?? [],
    latest_walk_forward_completed_cells: raw.latest_walk_forward_completed_cells ?? 0,
    latest_walk_forward_total_cells: raw.latest_walk_forward_total_cells ?? 0,
    latest_walk_forward_current_timeframe: raw.latest_walk_forward_current_timeframe ?? null,
    alert_count: raw.alert_count ?? 0,
    // Last trade timestamp for recency display (backend returns camelCase lastTradeAt)
    last_trade_at: raw.lastTradeAt ? new Date(raw.lastTradeAt).toISOString() : null,
    // Bot's configured timeframe (from bot settings)
    timeframe: raw.timeframe || null,
    // Generation's locked timeframe (SOURCE OF TRUTH for current generation)
    generation_timeframe: raw.generationTimeframe || null,
    // Idle reason visibility
    idleReason: raw.idleReason || null,
    queuedJobType: raw.queuedJobType || null,
    hasRunningJob: raw.hasRunningJob ?? false,
    // Running job timestamps for elapsed time display (extract from botNow.activeJob)
    backtestStartedAt: extractJobStartedAt(raw, 'BACKTESTER'),
    evolveStartedAt: extractJobStartedAt(raw, 'EVOLVING'),
    improveStartedAt: extractJobStartedAt(raw, 'IMPROVING'),
    // Passthrough canonical state from server (critical for stage gate evaluation)
    botNow: raw.botNow || null,
    // AI Provider fields for InlineAiProviderBadge
    aiProvider: raw.aiProvider || null,
    createdByAi: raw.createdByAi || null,
    aiProviderBadge: raw.aiProviderBadge ?? null,
    aiResearchSources: raw.aiResearchSources || null,
    aiReasoning: raw.aiReasoning || null,
    aiResearchDepth: raw.aiResearchDepth || null,
  };
}

export function useBotsOverview() {
  const { user } = useAuth();
  const { updateFromServerTime } = useServerClock();

  return useQuery({
    queryKey: ["bots-overview", user?.id],
    // THROTTLED polling: 60s interval with persistence for instant page loads
    // Reduced from 30s to ease CPU load on single-VM deployment
    refetchInterval: 60000, // THROTTLED: 60s (was 30s)
    refetchOnWindowFocus: false,
    staleTime: 45000, // THROTTLED: 45s (was 30s)
    queryFn: async (): Promise<BotsOverviewData> => {
      if (!user?.id) return EMPTY_DATA;

      const response = await fetch(`/api/bots-overview?user_id=${user.id}`, {
        credentials: "include",
      });

      // Handle 503 Service Unavailable (request timeout / database overload)
      if (response.status === 503) {
        const errorBody = await response.json().catch(() => ({}));
        const retryAfterMs = errorBody.retryAfterMs ?? 5000;
        console.warn(`[useBotsOverview] 503 degraded response, will retry in ${retryAfterMs}ms`);
        // Return empty data with degraded flag instead of throwing
        // React Query will automatically retry based on its retry settings
        throw new Error(errorBody.error || "Server overloaded - retrying shortly");
      }

      if (!response.ok) {
        throw new Error("Failed to fetch bots overview");
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || "Failed to fetch bots overview");
      }

      // Update server clock offset if serverTime is provided
      if (result.serverTime) {
        updateFromServerTime(result.serverTime);
      }

      const rawBots = result.data || [];
      const bots = rawBots.map(transformBotFromApi);
      
      // Build a map of raw API data for account info (since BotOverview doesn't include these fields)
      // Backend returns camelCase (accountId, accountName, accountType, accountTotalBlownCount, accountConsecutiveBlownCount)
      const rawDataMap = new Map<string, { accountId: string | null; accountName: string | null; accountType: string | null; accountTotalBlownCount: number; accountConsecutiveBlownCount: number }>();
      for (const raw of rawBots) {
        rawDataMap.set(raw.id, {
          accountId: raw.accountId ?? raw.account_id ?? null,
          accountName: raw.accountName ?? raw.account_name ?? null,
          accountType: raw.accountType ?? raw.account_type ?? null,
          accountTotalBlownCount: raw.accountTotalBlownCount ?? raw.account_total_blown_count ?? 0,
          accountConsecutiveBlownCount: raw.accountConsecutiveBlownCount ?? raw.account_consecutive_blown_count ?? 0,
        });
      }
      
      const perBot: Record<string, PerBotData> = {};
      for (const bot of bots) {
        const rawData = rawDataMap.get(bot.id);
        perBot[bot.id] = {
          instanceStatus: {
            id: null,
            status: bot.status,
            activityState: bot.status === 'running' ? 'ACTIVE' : 'IDLE',
            lastHeartbeatAt: null,
            mode: bot.mode,
            accountId: rawData?.accountId ?? null,
            accountName: rawData?.accountName ?? null,
            accountType: rawData?.accountType ?? null,
            accountTotalBlownCount: rawData?.accountTotalBlownCount ?? 0,
            accountConsecutiveBlownCount: rawData?.accountConsecutiveBlownCount ?? 0,
          },
          lastJob: {
            status: null,
            type: null,
            startedAt: null,
            finishedAt: null,
            error: null,
          },
          healthScore: {
            score: bot.bqs_latest,
            asOf: bot.updated_at,
          },
          improvementState: {
            status: null,
            consecutiveFailures: 0,
            whyNotPromoted: null,
            nextAction: null,
            nextRetryAt: null,
            attemptsUsed: 0,
            lastImprovementAt: null,
          },
          jobs: {
            backtestRunning: bot.hasRunningJob && bot.queuedJobType === null ? 1 : 0,
            backtestQueued: bot.queuedJobType === 'BACKTESTER' ? 1 : 0,
            evolveRunning: 0,
            evolveQueued: bot.queuedJobType === 'EVOLVING' ? 1 : 0,
            improveRunning: 0,
            improveQueued: bot.queuedJobType === 'IMPROVING' ? 1 : 0,
            backtestStartedAt: bot.backtestStartedAt ?? null,
            evolveStartedAt: bot.evolveStartedAt ?? null,
            improveStartedAt: bot.improveStartedAt ?? null,
          },
        };
      }

      // FRESHNESS CONTRACT: Use backend-provided values, not local timestamps
      const freshness: FreshnessContract = result.freshnessContract || {
        maxStaleSeconds: 30,
        dataSource: 'none',
        dataFreshness: 'STALE',
        markTimestamp: null,
      };
      
      return {
        bots,
        perBot,
        alertsCount: 0,
        integrationsSummary: { brokersConnected: 0, dataSourcesConnected: 0, aiProvidersConnected: 0 },
        // CRITICAL: Use server-provided timestamp, not local time (prevents clock skew issues)
        generatedAt: result.generatedAt || new Date().toISOString(),
        source: "db",
        freshnessContract: freshness,
      };
    },
    enabled: !!user?.id,
    gcTime: 5 * 60_000,
    refetchOnReconnect: true,
    // Retry on 503 (server timeout) - 3 retries with exponential backoff
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

export function toBot(bot: BotOverview): {
  id: string;
  name: string;
  description: string | null;
  stage: string;
  mode: string;
  status: string;
  is_trading_enabled: boolean;
  evolution_mode: string | null;
  strategy_config: { instrument?: string; fullName?: string; [key: string]: unknown };
  created_at: string;
  updated_at: string;
  bqs_latest: number | null;
  health_state: string | null;
  kill_state?: string | null;
  kill_reason_code?: string | null;
  botNow?: BotOverview['botNow'];
  aiProvider: string | null;
  createdByAi: string | null;
  aiProviderBadge: boolean | null;
  aiResearchSources: unknown | null;
  aiReasoning: string | null;
  aiResearchDepth: string | null;
} {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description,
    stage: bot.stage,
    mode: bot.mode,
    status: bot.status,
    is_trading_enabled: bot.is_trading_enabled,
    evolution_mode: bot.evolution_mode,
    strategy_config: {
      ...(bot.strategy_config || {}),
      instrument: bot.symbol || undefined,
    },
    created_at: bot.created_at,
    updated_at: bot.updated_at,
    bqs_latest: bot.bqs_latest,
    health_state: bot.health_state,
    botNow: bot.botNow,
    aiProvider: bot.aiProvider,
    createdByAi: bot.createdByAi,
    aiProviderBadge: bot.aiProviderBadge,
    aiResearchSources: bot.aiResearchSources,
    aiReasoning: bot.aiReasoning,
    aiResearchDepth: bot.aiResearchDepth,
  };
}

const MIN_SHARPE_TRADES = 20;
const SHARPE_MIN_BOUND = -5;
const SHARPE_MAX_BOUND = 5;

function validateSharpe(sharpe: number | null, tradeCount: number): number | null {
  if (sharpe === null || !isFinite(sharpe)) return null;
  if (tradeCount < MIN_SHARPE_TRADES) return null;
  if (sharpe < SHARPE_MIN_BOUND || sharpe > SHARPE_MAX_BOUND) return null;
  return sharpe;
}

export function toMetrics(bot: BotOverview): {
  botId: string;
  pnl: number;
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  lastTradeAt: string | null;
  sharpeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  statisticallySignificant: boolean;
  backtestTrades: number;
  backtestWinRate: number | null;
  backtestPF: number | null;
  backtestMaxDD: number | null;
  backtestExpectancy: number | null;
  backtestSharpe: number | null;
  backtestSortino: number | null;
  backtestLastAt: string | null;
  backtestSharpeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | null;
  statsSource: 'BACKTEST' | 'PAPER' | 'NONE';
  backtestTimeframe: string | null;
  backtestHorizon: string | null;
  stageMetrics: {
    trades: number;
    winRate: number | null;
    sharpe: number | null;
    maxDrawdownPct: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    pnl: number;
    source: 'BACKTEST' | 'LIVE' | 'NONE';
    metricsStatus: 'AVAILABLE' | 'AWAITING_EVIDENCE' | 'NEW_GENERATION_PENDING' | 'PRIOR_GENERATION';
  };
} {
  const isTrials = bot.stage === 'TRIALS';
  const isLab = bot.stage === 'LAB' || bot.stage === 'TRIALS';
  const hasBacktest = bot.session_trades > 0 || bot.backtests_completed > 0;

  const statsSource: 'BACKTEST' | 'PAPER' | 'NONE' = isTrials
    ? (hasBacktest ? 'BACKTEST' : 'NONE')
    : 'PAPER';
  
  const backtestSharpeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | null = 
    bot.session_trades >= 100 ? 'HIGH' :
    bot.session_trades >= 50 ? 'MEDIUM' :
    bot.session_trades >= 20 ? 'LOW' : 'INSUFFICIENT';

  const validatedSharpe = validateSharpe(bot.session_sharpe, bot.session_trades);

  // Compute stageMetrics based on stage (LAB uses backtest, PAPER+ uses live)
  // metricsStatus comes from backend - indicates if current generation has sufficient evidence
  const metricsStatus = bot.metrics_status || 'AWAITING_EVIDENCE';
  
  // CRITICAL: For PAPER+ stages, ONLY show paper trade metrics from current ACTIVE attempt
  // Do NOT fallback to backtest metrics - this causes confusion and data leakage
  // If no paper trades exist for the current attempt, show zeros/blanks with AWAITING_EVIDENCE status
  const hasPaperTrades = (bot.live_total_trades ?? 0) > 0;
  const shouldUsePaperMetrics = !isLab && hasPaperTrades;
  
  let stageMetrics;
  
  if (isLab) {
    // LAB stage: Always use backtest metrics
    stageMetrics = {
      trades: bot.session_trades ?? 0,
      winRate: bot.session_win_rate_pct ?? null,
      sharpe: validatedSharpe,
      maxDrawdownPct: bot.session_max_dd_pct ?? null,
      profitFactor: bot.session_profit_factor ?? null,
      expectancy: bot.session_pnl_usd && bot.session_trades ? bot.session_pnl_usd / bot.session_trades : null,
      pnl: bot.session_pnl_usd ?? 0,
      source: hasBacktest ? 'BACKTEST' as const : 'NONE' as const,
      metricsStatus,
    };
  } else if (shouldUsePaperMetrics) {
    // PAPER+ with paper trades: Use database-computed paper trade metrics from ACTIVE attempt only
    stageMetrics = {
      trades: bot.live_total_trades ?? 0,
      winRate: bot.live_win_rate ?? null,
      sharpe: bot.live_sharpe ?? null,
      maxDrawdownPct: bot.live_max_drawdown_pct ?? null,
      profitFactor: bot.live_profit_factor ?? null,
      expectancy: bot.live_pnl && bot.live_total_trades ? bot.live_pnl / bot.live_total_trades : null,
      pnl: bot.live_pnl ?? 0,
      source: 'LIVE' as const,
      metricsStatus,
    };
  } else {
    // PAPER+ without paper trades in current attempt: Show zeros with AWAITING_EVIDENCE
    // Do NOT fallback to backtest - that's confusing and shows wrong data after account reset
    stageMetrics = {
      trades: 0,
      winRate: null,
      sharpe: null,
      maxDrawdownPct: null,
      profitFactor: null,
      expectancy: null,
      pnl: 0,
      source: 'NONE' as const,
      metricsStatus: 'AWAITING_EVIDENCE' as const,
    };
  }

  return {
    botId: bot.id,
    pnl: isLab ? (bot.session_pnl_usd ?? 0) : (bot.live_pnl ?? 0),
    trades: isLab ? bot.session_trades : bot.live_total_trades,
    winRate: isLab ? bot.session_win_rate_pct : bot.live_win_rate,
    sharpe: isLab ? validatedSharpe : bot.live_sharpe,
    sortino: null,
    maxDrawdown: isLab ? bot.session_max_dd_usd : null,
    maxDrawdownPct: isLab ? bot.session_max_dd_pct : bot.live_max_drawdown_pct,
    expectancy: null,
    profitFactor: isLab ? bot.session_profit_factor : (bot.live_profit_factor ?? null),
    lastTradeAt: bot.last_trade_at ?? null,
    sharpeConfidence: isLab ? (backtestSharpeConfidence ?? 'INSUFFICIENT') : 'INSUFFICIENT',
    statisticallySignificant: isLab ? bot.session_trades >= 60 : false,
    backtestTrades: bot.session_trades,
    backtestWinRate: bot.session_win_rate_pct,
    backtestPF: bot.session_profit_factor,
    backtestMaxDD: bot.session_max_dd_pct,
    backtestExpectancy: bot.session_pnl_usd && bot.session_trades ? bot.session_pnl_usd / bot.session_trades : null,
    backtestSharpe: validatedSharpe,
    backtestSortino: null,
    backtestLastAt: null,
    backtestSharpeConfidence,
    statsSource,
    // INSTITUTIONAL: Generation's locked timeframe is the SOLE source of truth
    // No fallbacks after full reset - all new bots MUST have generation_timeframe
    backtestTimeframe: bot.generation_timeframe,
    backtestHorizon: bot.matrix_best_cell?.horizon ?? null,
    stageMetrics,
  };
}

export type TrendDirection = "IMPROVING" | "DECLINING" | "STABLE" | "REVERTED" | "INSUFFICIENT_DATA" | null;

function calculateTrend(bot: BotOverview, perBot?: PerBotData): TrendDirection {
  const improvementStatus = perBot?.improvementState?.status;
  const evolutionMode = bot.evolution_mode;
  const genReasonCode = bot.botNow?.generation?.reasonCode;
  const generation = bot.generation ?? 1;
  const backtestsCompleted = bot.backtests_completed ?? 0;
  
  // If actively improving/evolving, show IMPROVING
  if (improvementStatus === 'IMPROVING' || improvementStatus === 'EVOLVING') {
    return 'IMPROVING';
  }
  
  // Check generation reason code for more specific status
  if (genReasonCode === 'REVERTED' || genReasonCode === 'ROLLBACK') {
    return 'REVERTED';
  }
  
  // Evolution paused due to convergence = STABLE
  if (evolutionMode === 'PAUSED') {
    return 'STABLE';
  }
  
  // Check improvement state for failures
  const failures = perBot?.improvementState?.consecutiveFailures ?? 0;
  if (failures >= 3) {
    return 'DECLINING';
  }
  
  // For AUTO mode bots that have evolved at least once, show IMPROVING
  if (evolutionMode === 'AUTO' && generation > 1) {
    return 'IMPROVING';
  }
  
  // For bots with completed backtests, show STABLE (actively working)
  if (backtestsCompleted > 0) {
    return 'STABLE';
  }
  
  // Default to null for new/inactive bots
  return null;
}

export function toEnriched(bot: BotOverview, perBot?: PerBotData): {
  botId: string;
  mode: string | null;
  generationNumber: number | null;
  latestGeneration: number | null;
  versionMajor: number;
  versionMinor: number;
  latestVersionMajor: number | null;
  latestVersionMinor: number | null;
  accountName: string | null;
  accountType: string | null;
  accountId: string | null;
  activityState: string | null;
  lastHeartbeat: string | null;
  healthScore: number | null;
  healthStatus: "OK" | "WARN" | "DEGRADED";
  healthReason: string | null;
  exposure: number;
  backtestCount: number;
  trend: TrendDirection;
  peakGeneration: number | null;
  declineFromPeakPct: number | null;
  latestWalkForwardStatus: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  latestWalkForwardProgress: number;
  latestWalkForwardTimeframes: string[];
  latestWalkForwardCompletedCells: number;
  latestWalkForwardTotalCells: number;
  latestWalkForwardCurrentTimeframe: string | null;
  alertCount: number;
  matrixAggregate: {
    median_pf?: number;
    worst_pf?: number;
    best_pf?: number;
    worst_max_dd_pct?: number;
    trade_count_total?: number;
    consistency_score?: number;
    cells_with_data?: number;
    total_cells?: number;
  } | null;
  accountTotalBlownCount: number;
  accountConsecutiveBlownCount: number;
} {
  const score = perBot?.healthScore.score ?? bot.bqs_latest ?? 100;
  const healthStatus: "OK" | "WARN" | "DEGRADED" =
    score >= 80 ? "OK" : score >= 50 ? "WARN" : "DEGRADED";

  // Use bot.generation (authoritative from bots table), fallback to botNow.generation.current
  const genCurrent = bot.generation ?? bot.botNow?.generation?.current ?? 1;
  // Latest generation from bot_generations table (may be higher if evolution was rejected)
  const genLatest = bot.latest_generation ?? genCurrent;
  
  // Use backend trend data as source of truth (from generation_metrics_history)
  // Fallback to calculated trend only if backend doesn't have data yet
  const trend = bot.trend_direction ?? calculateTrend(bot, perBot);
  
  // Map walk-forward status to Matrix indicator status format
  const wfStatus = bot.latest_walk_forward_status;
  const matrixStatus = wfStatus === 'PENDING' ? 'QUEUED' 
    : wfStatus === 'RUNNING' ? 'RUNNING'
    : wfStatus === 'COMPLETED' ? 'COMPLETED'
    : wfStatus === 'FAILED' ? 'FAILED'
    : null;
  
  return {
    botId: bot.id,
    mode: perBot?.instanceStatus.mode ?? bot.mode,
    generationNumber: genCurrent,
    latestGeneration: genLatest,
    versionMajor: bot.version_major,
    versionMinor: bot.version_minor,
    latestVersionMajor: bot.version_major,
    latestVersionMinor: bot.version_minor,
    accountName: perBot?.instanceStatus.accountName ?? null,
    accountType: perBot?.instanceStatus.accountType ?? null,
    accountId: perBot?.instanceStatus.accountId ?? null,
    activityState: perBot?.instanceStatus.activityState ?? null,
    lastHeartbeat: perBot?.instanceStatus.lastHeartbeatAt ?? null,
    healthScore: score,
    healthStatus,
    healthReason: null,
    exposure: 0,
    backtestCount: bot.backtests_completed,
    trend,
    peakGeneration: bot.peak_generation ?? null,
    declineFromPeakPct: bot.decline_from_peak_pct ?? null,
    latestWalkForwardStatus: matrixStatus as any,
    latestWalkForwardProgress: bot.latest_walk_forward_progress ?? 0,
    latestWalkForwardTimeframes: bot.latest_walk_forward_timeframes ?? [],
    latestWalkForwardCompletedCells: bot.latest_walk_forward_completed_cells ?? 0,
    latestWalkForwardTotalCells: bot.latest_walk_forward_total_cells ?? 0,
    latestWalkForwardCurrentTimeframe: bot.latest_walk_forward_current_timeframe ?? null,
    alertCount: bot.alert_count ?? 0,
    matrixAggregate: bot.matrix_aggregate ?? null,
    accountTotalBlownCount: perBot?.instanceStatus.accountTotalBlownCount ?? 0,
    accountConsecutiveBlownCount: perBot?.instanceStatus.accountConsecutiveBlownCount ?? 0,
  };
}

export function toRunner(perBot?: PerBotData): {
  id: string;
  mode: string;
  activityState: string;
  accountId: string | null;
  accountName: string | null;
  lastHeartbeat: string | null;
  startedAt: string | null;
  status: string;
} | null {
  if (!perBot?.instanceStatus.id) return null;

  return {
    id: perBot.instanceStatus.id,
    mode: perBot.instanceStatus.mode || "BACKTEST_ONLY",
    activityState: perBot.instanceStatus.activityState || "IDLE",
    accountId: perBot.instanceStatus.accountId,
    accountName: perBot.instanceStatus.accountName,
    lastHeartbeat: perBot.instanceStatus.lastHeartbeatAt,
    startedAt: (perBot.instanceStatus as any).startedAt || null,
    status: perBot.instanceStatus.status || "stopped",
  };
}

export function toJobs(perBot?: PerBotData): {
  backtestsRunning: number;
  backtestsQueued: number;
  evaluating: boolean;
  training: boolean;
  evolvingRunning: number;
  evolvingQueued: number;
  improvingRunning: number;
  improvingQueued: number;
  backtestStartedAt: string | null;
  evolveStartedAt: string | null;
  improveStartedAt: string | null;
} {
  if (!perBot) {
    return {
      backtestsRunning: 0,
      backtestsQueued: 0,
      evaluating: false,
      training: false,
      evolvingRunning: 0,
      evolvingQueued: 0,
      improvingRunning: 0,
      improvingQueued: 0,
      backtestStartedAt: null,
      evolveStartedAt: null,
      improveStartedAt: null,
    };
  }

  return {
    backtestsRunning: perBot.jobs.backtestRunning,
    backtestsQueued: perBot.jobs.backtestQueued,
    evaluating: false,
    training: false,
    evolvingRunning: perBot.jobs.evolveRunning,
    evolvingQueued: perBot.jobs.evolveQueued,
    improvingRunning: perBot.jobs.improveRunning ?? 0,
    improvingQueued: perBot.jobs.improveQueued ?? 0,
    backtestStartedAt: perBot.jobs.backtestStartedAt ?? null,
    evolveStartedAt: perBot.jobs.evolveStartedAt ?? null,
    improveStartedAt: perBot.jobs.improveStartedAt ?? null,
  };
}

export function toImprovement(perBot?: PerBotData): {
  botId: string;
  userId: string;
  status: 'IDLE' | 'IMPROVING' | 'PAUSED' | 'GRADUATED_READY';
  lastFailureCategory: string | null;
  attemptsUsed: number;
  attemptsLimit: number;
  lastImprovementAt: string | null;
  nextAction: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  consecutiveFailures: number;
  nextRetryAt: string | null;
  lastMutationsTried: string[];
  bestSharpeAchieved: number | null;
  bestPfAchieved: number | null;
  whyNotPromoted: Record<string, any> | null;
  lastGateCheckAt: string | null;
  gateCheckCount: number | null;
} | null {
  if (!perBot?.improvementState.status) return null;

  return {
    botId: "",
    userId: "",
    status: perBot.improvementState.status as 'IDLE' | 'IMPROVING' | 'PAUSED' | 'GRADUATED_READY',
    lastFailureCategory: null,
    attemptsUsed: perBot.improvementState.attemptsUsed ?? 0,
    attemptsLimit: 100,
    lastImprovementAt: perBot.improvementState.lastImprovementAt ?? null,
    nextAction: perBot.improvementState.nextAction,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    consecutiveFailures: perBot.improvementState.consecutiveFailures,
    nextRetryAt: perBot.improvementState.nextRetryAt,
    lastMutationsTried: [],
    bestSharpeAchieved: null,
    bestPfAchieved: null,
    whyNotPromoted: perBot.improvementState.whyNotPromoted,
    lastGateCheckAt: null,
    gateCheckCount: null,
  };
}
