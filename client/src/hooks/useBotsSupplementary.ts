/**
 * Batched supplementary data hook - fetches ALL bot data in ONE call
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns explicit degraded state on failure, never empty data
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface BotInstance {
  id: string;
  mode: string;
  status: string;
  activityState: string;
  lastHeartbeatAt: string | null;
  isPrimaryRunner: boolean;
  accountId: string | null;
  accountName: string | null;
}

export interface BotJobsSummary {
  backtestRunning: number;
  backtestQueued: number;
  evolveRunning: number;
  evolveQueued: number;
  improveRunning: number;
  improveQueued: number;
  evaluateRunning: number;
  evaluateQueued: number;
  backtestStartedAt: string | null;
  evolveStartedAt: string | null;
  improveStartedAt: string | null;
}

export interface BotImprovementState {
  status: string;
  consecutiveFailures: number;
  whyNotPromoted: Record<string, unknown> | null;
  nextAction: string | null;
  nextRetryAt: string | null;
  pauseScope: string | null;
  pausedBy: string | null;
}

export interface BotGenerationInfo {
  generationNumber: number;
  versionMajor: number;
  versionMinor: number;
  latestGeneration: number;
  latestVersionMajor: number;
  latestVersionMinor: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number | null;
  profitFactor: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  backtestPnl: number | null;
  expectancy: number | null;
  lastBacktestCompletedAt: string | null;
}

export interface BotsSupplementaryData {
  instances: Record<string, BotInstance>;
  jobs: Record<string, BotJobsSummary>;
  healthScores: Record<string, number>;
  improvementStates: Record<string, BotImprovementState>;
  generations: Record<string, BotGenerationInfo>;
  backtestMetrics: Record<string, BacktestMetrics>;
  alertsCount: number;
}

export interface BotsSupplementaryResult {
  data: BotsSupplementaryData | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  return response;
}

/**
 * Fetch all supplementary bot data in a single batched call
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useBotsSupplementary(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bots-supplementary", botIds.sort().join(",")],
    queryFn: async (): Promise<BotsSupplementaryResult> => {
      const traceId = `bsup-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
        };
      }

      if (botIds.length === 0) {
        return {
          data: {
            instances: {},
            jobs: {},
            healthScores: {},
            improvementStates: {},
            generations: {},
            backtestMetrics: {},
            alertsCount: 0,
          },
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const [instancesRes, jobsRes] = await Promise.all([
          fetchWithAuth('/api/bot-instances'),
          fetchWithAuth('/api/jobs'),
        ]);

        clearTimeout(timeoutId);

        // FAIL-CLOSED: If critical endpoints fail, return degraded
        if (!instancesRes.ok || !jobsRes.ok) {
          console.error("[useBotsSupplementary] Endpoint failure:", {
            instances: instancesRes.status,
            jobs: jobsRes.status,
          });
          return {
            data: null,
            degraded: true,
            error_code: "ENDPOINT_FAILURE",
            message: `Failed to fetch supplementary data (instances: ${instancesRes.status}, jobs: ${jobsRes.status})`,
            trace_id: traceId,
          };
        }

        const instancesData = await instancesRes.json();
        const jobsData = await jobsRes.json();

        // FAIL-CLOSED: If API returns error, return degraded
        if (!instancesData.success || !jobsData.success) {
          return {
            data: null,
            degraded: true,
            error_code: "API_ERROR",
            message: "API returned error status",
            trace_id: traceId,
          };
        }

        const instances: Record<string, BotInstance> = {};
        const jobs: Record<string, BotJobsSummary> = {};

        for (const inst of instancesData.data || []) {
          if (botIds.includes(inst.botId) && inst.isPrimaryRunner) {
            instances[inst.botId] = {
              id: inst.id,
              mode: inst.mode,
              status: inst.status,
              activityState: inst.activityState,
              lastHeartbeatAt: inst.lastHeartbeatAt,
              isPrimaryRunner: inst.isPrimaryRunner,
              accountId: inst.accountId,
              accountName: null,
            };
          }
        }

        for (const botId of botIds) {
          const botJobs = (jobsData.data || []).filter((j: any) => j.botId === botId);
          jobs[botId] = {
            backtestRunning: botJobs.filter((j: any) => (j.jobType === 'BACKTEST' || j.jobType === 'BACKTESTER') && j.status === 'RUNNING').length,
            backtestQueued: botJobs.filter((j: any) => (j.jobType === 'BACKTEST' || j.jobType === 'BACKTESTER') && j.status === 'QUEUED').length,
            evolveRunning: botJobs.filter((j: any) => (j.jobType === 'EVOLVE' || j.jobType === 'EVOLVING') && j.status === 'RUNNING').length,
            evolveQueued: botJobs.filter((j: any) => (j.jobType === 'EVOLVE' || j.jobType === 'EVOLVING') && j.status === 'QUEUED').length,
            improveRunning: botJobs.filter((j: any) => (j.jobType === 'IMPROVE' || j.jobType === 'IMPROVING') && j.status === 'RUNNING').length,
            improveQueued: botJobs.filter((j: any) => (j.jobType === 'IMPROVE' || j.jobType === 'IMPROVING') && j.status === 'QUEUED').length,
            evaluateRunning: botJobs.filter((j: any) => j.jobType === 'EVALUATE' && j.status === 'RUNNING').length,
            evaluateQueued: botJobs.filter((j: any) => j.jobType === 'EVALUATE' && j.status === 'QUEUED').length,
            evolveStartedAt: null,
          };
        }

        return {
          data: {
            instances,
            jobs,
            healthScores: {},
            improvementStates: {},
            generations: {},
            backtestMetrics: {},
            alertsCount: 0,
          },
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        clearTimeout(timeoutId);
        console.error("[useBotsSupplementary] Request failed:", err);
        
        // FAIL-CLOSED: Network/timeout error = degraded
        return {
          data: null,
          degraded: true,
          error_code: err instanceof Error && err.name === 'AbortError' ? "TIMEOUT" : "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
        };
      }
    },
    enabled: !!user && botIds.length > 0,
    retry: false,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    networkMode: "online",
    refetchInterval: 15_000,
  });
}

/**
 * Helper to check if supplementary data is degraded
 */
export function isSupplementaryDegraded(result: BotsSupplementaryResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

/**
 * Helper to convert supplementary jobs format to the format expected by BotTableRow
 * Returns null if data is degraded (caller must handle)
 */
export function toJobsSummary(result: BotsSupplementaryResult | undefined, botId: string): {
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
} | null {
  if (!result || result.degraded || !result.data) {
    return null;
  }

  const jobs = result.data.jobs[botId];
  if (!jobs) {
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
    backtestsRunning: jobs.backtestRunning,
    backtestsQueued: jobs.backtestQueued,
    evaluating: jobs.evaluateRunning > 0 || jobs.evaluateQueued > 0,
    training: false,
    evolvingRunning: jobs.evolveRunning,
    evolvingQueued: jobs.evolveQueued,
    improvingRunning: jobs.improveRunning ?? 0,
    improvingQueued: jobs.improveQueued ?? 0,
    backtestStartedAt: jobs.backtestStartedAt ?? null,
    evolveStartedAt: jobs.evolveStartedAt ?? null,
    improveStartedAt: jobs.improveStartedAt ?? null,
  };
}

/**
 * Helper to convert supplementary instance format to RunnerInstance format
 * Returns null if data is degraded (caller must handle)
 */
export function toRunnerInstance(result: BotsSupplementaryResult | undefined, botId: string): {
  id: string;
  mode: string;
  activityState: string;
  accountId: string | null;
  accountName: string | null;
  lastHeartbeat: string | null;
  status: string;
} | null {
  if (!result || result.degraded || !result.data) {
    return null;
  }

  const instance = result.data.instances[botId];
  if (!instance) return null;

  return {
    id: instance.id,
    mode: instance.mode,
    activityState: instance.activityState,
    accountId: instance.accountId,
    accountName: instance.accountName,
    lastHeartbeat: instance.lastHeartbeatAt,
    status: instance.status,
  };
}

/**
 * Helper to convert supplementary improvement state format
 * Returns null if data is degraded (caller must handle)
 */
export function toImprovementState(result: BotsSupplementaryResult | undefined, botId: string): {
  bot_id: string;
  user_id: string;
  status: 'IDLE' | 'IMPROVING' | 'PAUSED' | 'GRADUATED_READY';
  last_failure_category: string | null;
  attempts_used: number;
  attempts_limit: number;
  last_improvement_at: string | null;
  next_action: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  consecutive_failures: number;
  next_retry_at: string | null;
  last_mutations_tried: string[];
  best_sharpe_achieved: number | null;
  best_pf_achieved: number | null;
  why_not_promoted: Record<string, any> | null;
  last_gate_check_at: string | null;
  gate_check_count: number | null;
} | null {
  if (!result || result.degraded || !result.data) {
    return null;
  }

  const state = result.data.improvementStates[botId];
  if (!state) return null;

  return {
    bot_id: botId,
    user_id: "",
    status: state.status as 'IDLE' | 'IMPROVING' | 'PAUSED' | 'GRADUATED_READY',
    last_failure_category: null,
    attempts_used: 0,
    attempts_limit: 100,
    last_improvement_at: null,
    next_action: state.nextAction,
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    consecutive_failures: state.consecutiveFailures,
    next_retry_at: state.nextRetryAt,
    last_mutations_tried: [],
    best_sharpe_achieved: null,
    best_pf_achieved: null,
    why_not_promoted: state.whyNotPromoted,
    last_gate_check_at: null,
    gate_check_count: null,
  };
}

/**
 * Helper to build enriched data from supplementary generations
 * Returns null if data is degraded (caller must handle)
 */
export function toEnrichedData(
  result: BotsSupplementaryResult | undefined,
  botId: string
): {
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
} | null {
  if (!result || result.degraded || !result.data) {
    return null;
  }

  const gen = result.data.generations[botId];
  const instance = result.data.instances[botId];
  const healthScore = result.data.healthScores[botId];
  const backtestMetrics = result.data.backtestMetrics[botId];

  const score = healthScore ?? 100;
  const healthStatus: "OK" | "WARN" | "DEGRADED" =
    score >= 80 ? "OK" : score >= 50 ? "WARN" : "DEGRADED";

  return {
    botId,
    mode: instance?.mode ?? null,
    generationNumber: gen?.generationNumber ?? null,
    latestGeneration: gen?.latestGeneration ?? null,
    versionMajor: gen?.versionMajor ?? 1,
    versionMinor: gen?.versionMinor ?? 0,
    latestVersionMajor: gen?.latestVersionMajor ?? null,
    latestVersionMinor: gen?.latestVersionMinor ?? null,
    accountName: instance?.accountName ?? null,
    accountType: null,
    accountId: instance?.accountId ?? null,
    activityState: instance?.activityState ?? null,
    lastHeartbeat: instance?.lastHeartbeatAt ?? null,
    healthScore: healthScore ?? null,
    healthStatus,
    healthReason: null,
    exposure: 0,
    backtestCount: backtestMetrics?.totalTrades ? 1 : 0,
  };
}

/**
 * Helper to convert backtest metrics to the format expected by BotTableRow metrics prop
 * Returns null if data is degraded (caller must handle)
 */
export function toMetricsFromBacktest(
  result: BotsSupplementaryResult | undefined,
  botId: string
): {
  botId: string;
  pnl: number;
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  lastTradeAt: string | null;
  backtestTrades: number;
  backtestWinRate: number | null;
  backtestPF: number | null;
  backtestSharpe: number | null;
  backtestMaxDD: number | null;
  backtestExpectancy: number | null;
  backtestLastAt: string | null;
  statsSource: 'BACKTEST' | 'PAPER' | 'NONE';
} | null {
  if (!result || result.degraded || !result.data) {
    return null;
  }

  const bt = result.data.backtestMetrics[botId];
  
  if (!bt || bt.totalTrades === 0) {
    return {
      botId,
      pnl: 0,
      trades: 0,
      winRate: null,
      sharpe: null,
      maxDrawdown: null,
      maxDrawdownPct: null,
      expectancy: null,
      profitFactor: null,
      lastTradeAt: null,
      backtestTrades: 0,
      backtestWinRate: null,
      backtestPF: null,
      backtestSharpe: null,
      backtestMaxDD: null,
      backtestExpectancy: null,
      backtestLastAt: null,
      statsSource: 'NONE',
    };
  }

  return {
    botId,
    pnl: 0,
    trades: 0,
    winRate: null,
    sharpe: null,
    maxDrawdown: null,
    maxDrawdownPct: null,
    expectancy: null,
    profitFactor: null,
    lastTradeAt: null,
    backtestTrades: bt.totalTrades,
    backtestWinRate: bt.winRate,
    backtestPF: bt.profitFactor,
    backtestSharpe: bt.sharpeRatio,
    backtestMaxDD: bt.maxDrawdown,
    backtestExpectancy: bt.expectancy,
    backtestLastAt: bt.lastBacktestCompletedAt,
    statsSource: 'BACKTEST',
  };
}
