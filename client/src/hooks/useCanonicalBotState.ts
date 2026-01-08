/**
 * Hook for fetching canonical bot state from backend
 * SINGLE SOURCE OF TRUTH - UI must render only from this
 * MIGRATED: Supabase → Express API
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { 
  evaluateCanonicalState, 
  type CanonicalBotState, 
  type BotContext, 
  type InstanceContext,
  type JobsSummary as CanonicalJobsSummary,
  type ImprovementContext 
} from "@/lib/canonicalStateEvaluator";

interface BotWithState {
  id: string;
  stage: string;
  mode: string;
  status: string;
  healthState: string | null;
  healthReasonCode: string | null;
  healthReasonDetail: string | null;
  killState: string | null;
  killReasonCode: string | null;
  killUntil: string | null;
}

interface InstanceWithState {
  id: string;
  botId: string;
  status: string;
  activityState: string;
  lastHeartbeatAt: string | null;
  isPrimaryRunner: boolean;
  runnerSignature: string | null;
  restartCount: number | null;
  restartCountHour: number | null;
  nextRestartAllowedAt: string | null;
  circuitBreakerOpen: boolean | null;
  circuitBreakerUntil: string | null;
  jobType: string;
}

interface JobData {
  botId: string;
  jobType: string;
  status: string;
}

interface ImprovementData {
  status: string;
  whyNotPromoted: Record<string, string> | null;
  consecutiveFailures: number | null;
  nextAction: string | null;
  pauseScope: 'EVOLUTION_ONLY' | 'ALL' | null;
  pausedBy: 'AUTO' | 'USER' | null;
  nextRetryAt: string | null;
}

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response;
}

export function useCanonicalBotState(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['canonical-bot-state', botId],
    queryFn: async (): Promise<CanonicalBotState | null> => {
      if (!user || !botId) return null;

      const [botRes, instancesRes, jobsRes, improvementRes] = await Promise.all([
        fetchWithAuth(`/api/bots/${botId}`),
        fetchWithAuth(`/api/bot-instances?bot_id=${botId}`),
        fetchWithAuth(`/api/jobs?bot_id=${botId}`),
        fetchWithAuth(`/api/bots/${botId}/improvement-state`).catch(() => null),
      ]);

      const botData = await botRes.json();
      const instancesData = await instancesRes.json();
      const jobsData = await jobsRes.json();
      const improvementData = improvementRes ? await improvementRes.json() : null;

      if (!botData.success || !botData.data) {
        throw new Error('Failed to fetch bot data');
      }

      const bot = botData.data as BotWithState;
      const instances = (instancesData.data || []) as InstanceWithState[];
      const jobs = (jobsData.data || []) as JobData[];
      const improvement = improvementData?.data as ImprovementData | null;

      const instance = instances.find(i => i.isPrimaryRunner && i.jobType === 'RUNNER') || null;
      const activeJobs = jobs.filter(j => ['QUEUED', 'RUNNING'].includes(j.status));

      const jobsSummary: CanonicalJobsSummary = {
        backtest_queued: activeJobs.filter(j => j.jobType === 'BACKTEST' && j.status === 'QUEUED').length,
        backtest_running: activeJobs.filter(j => j.jobType === 'BACKTEST' && j.status === 'RUNNING').length,
        evaluate_queued: activeJobs.filter(j => j.jobType === 'EVALUATE' && j.status === 'QUEUED').length,
        evaluate_running: activeJobs.filter(j => j.jobType === 'EVALUATE' && j.status === 'RUNNING').length,
        evolve_queued: activeJobs.filter(j => j.jobType === 'EVOLVE' && j.status === 'QUEUED').length,
        evolve_running: activeJobs.filter(j => j.jobType === 'EVOLVE' && j.status === 'RUNNING').length,
        runner_start_queued: activeJobs.filter(j => j.jobType === 'RUNNER_START' && j.status === 'QUEUED').length,
        runner_restart_queued: activeJobs.filter(j => j.jobType === 'RUNNER_RESTART' && j.status === 'QUEUED').length,
        priority_compute_queued: activeJobs.filter(j => j.jobType === 'PRIORITY_COMPUTE' && j.status === 'QUEUED').length,
        total_queued: activeJobs.filter(j => j.status === 'QUEUED').length,
        total_running: activeJobs.filter(j => j.status === 'RUNNING').length,
      };

      const botContext: BotContext = {
        bot_id: bot.id,
        stage: bot.stage,
        mode: bot.mode,
        is_trading_enabled: bot.status === 'running',
        health_state: bot.healthState ?? undefined,
        health_reason: bot.healthReasonDetail ?? undefined,
        health_score: 100,
        kill_state: bot.killState ?? undefined,
        kill_reason_code: bot.killReasonCode ?? undefined,
        kill_until: bot.killUntil ?? undefined,
      };

      const instanceContext: InstanceContext | null = instance ? {
        id: instance.id,
        status: instance.status,
        activity_state: instance.activityState,
        last_heartbeat_at: instance.lastHeartbeatAt,
        is_primary_runner: instance.isPrimaryRunner,
        runner_signature: instance.runnerSignature,
        restart_count: instance.restartCount ?? 0,
        restart_count_hour: instance.restartCountHour ?? 0,
        next_restart_allowed_at: instance.nextRestartAllowedAt,
        circuit_breaker_open: instance.circuitBreakerOpen ?? false,
        circuit_breaker_until: instance.circuitBreakerUntil,
      } : null;

      const improvementContext: ImprovementContext | undefined = improvement ? {
        status: improvement.status,
        why_not_promoted: improvement.whyNotPromoted ?? undefined,
        consecutive_failures: improvement.consecutiveFailures ?? 0,
        next_action: improvement.nextAction ?? undefined,
        pause_scope: improvement.pauseScope ?? null,
        paused_by: improvement.pausedBy ?? null,
        next_retry_at: improvement.nextRetryAt ?? null,
      } : undefined;

      return evaluateCanonicalState(botContext, instanceContext, jobsSummary, improvementContext);
    },
    enabled: !!user && !!botId,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

/**
 * Hook for fetching canonical states for multiple bots
 */
export function useCanonicalBotStates(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['canonical-bot-states', botIds.sort().join(',')],
    queryFn: async (): Promise<Record<string, CanonicalBotState>> => {
      if (!user || botIds.length === 0) return {};

      const [botsRes, instancesRes, jobsRes, improvementsRes] = await Promise.all([
        fetchWithAuth('/api/bots'),
        fetchWithAuth('/api/bot-instances'),
        fetchWithAuth('/api/jobs'),
        Promise.all(botIds.map(id => 
          fetchWithAuth(`/api/bots/${id}/improvement-state`).catch(() => null)
        )),
      ]);

      const botsData = await botsRes.json();
      const instancesData = await instancesRes.json();
      const jobsData = await jobsRes.json();
      const improvementResults = await Promise.all(
        improvementsRes.map(r => r ? r.json() : null)
      );

      const allBots = (botsData.data || []) as BotWithState[];
      const bots = allBots.filter(b => botIds.includes(b.id));
      const instances = (instancesData.data || []) as InstanceWithState[];
      const jobs = (jobsData.data || []) as JobData[];

      const improvementByBot = new Map<string, ImprovementData>();
      botIds.forEach((id, idx) => {
        const data = improvementResults[idx]?.data;
        if (data) improvementByBot.set(id, data);
      });

      const instanceByBot = new Map<string, InstanceWithState>();
      for (const inst of instances) {
        if (botIds.includes(inst.botId) && inst.isPrimaryRunner && inst.jobType === 'RUNNER') {
          if (!instanceByBot.has(inst.botId)) instanceByBot.set(inst.botId, inst);
        }
      }

      const states: Record<string, CanonicalBotState> = {};

      for (const bot of bots) {
        const instance = instanceByBot.get(bot.id) || null;
        const improvement = improvementByBot.get(bot.id) || null;
        const botJobs = jobs.filter(j => j.botId === bot.id && ['QUEUED', 'RUNNING'].includes(j.status));

        const jobsSummary: CanonicalJobsSummary = {
          backtest_queued: botJobs.filter(j => j.jobType === 'BACKTEST' && j.status === 'QUEUED').length,
          backtest_running: botJobs.filter(j => j.jobType === 'BACKTEST' && j.status === 'RUNNING').length,
          evaluate_queued: botJobs.filter(j => j.jobType === 'EVALUATE' && j.status === 'QUEUED').length,
          evaluate_running: botJobs.filter(j => j.jobType === 'EVALUATE' && j.status === 'RUNNING').length,
          evolve_queued: botJobs.filter(j => j.jobType === 'EVOLVE' && j.status === 'QUEUED').length,
          evolve_running: botJobs.filter(j => j.jobType === 'EVOLVE' && j.status === 'RUNNING').length,
          runner_start_queued: botJobs.filter(j => j.jobType === 'RUNNER_START' && j.status === 'QUEUED').length,
          runner_restart_queued: botJobs.filter(j => j.jobType === 'RUNNER_RESTART' && j.status === 'QUEUED').length,
          priority_compute_queued: botJobs.filter(j => j.jobType === 'PRIORITY_COMPUTE' && j.status === 'QUEUED').length,
          total_queued: botJobs.filter(j => j.status === 'QUEUED').length,
          total_running: botJobs.filter(j => j.status === 'RUNNING').length,
        };

        const botContext: BotContext = {
          bot_id: bot.id,
          stage: bot.stage,
          mode: bot.mode,
          is_trading_enabled: bot.status === 'running',
          health_state: bot.healthState ?? undefined,
          health_reason: bot.healthReasonDetail ?? undefined,
          health_score: 100,
          kill_state: bot.killState ?? undefined,
          kill_reason_code: bot.killReasonCode ?? undefined,
          kill_until: bot.killUntil ?? undefined,
        };

        const instanceContext: InstanceContext | null = instance ? {
          id: instance.id,
          status: instance.status,
          activity_state: instance.activityState,
          last_heartbeat_at: instance.lastHeartbeatAt,
          is_primary_runner: instance.isPrimaryRunner,
          runner_signature: instance.runnerSignature,
          restart_count: instance.restartCount ?? 0,
          restart_count_hour: instance.restartCountHour ?? 0,
          next_restart_allowed_at: instance.nextRestartAllowedAt,
          circuit_breaker_open: instance.circuitBreakerOpen ?? false,
          circuit_breaker_until: instance.circuitBreakerUntil,
        } : null;

        const improvementContext: ImprovementContext | undefined = improvement ? {
          status: improvement.status,
          why_not_promoted: improvement.whyNotPromoted ?? undefined,
          consecutive_failures: improvement.consecutiveFailures ?? 0,
          next_action: improvement.nextAction ?? undefined,
          pause_scope: improvement.pauseScope ?? null,
          paused_by: improvement.pausedBy ?? null,
          next_retry_at: improvement.nextRetryAt ?? null,
        } : undefined;

        states[bot.id] = evaluateCanonicalState(botContext, instanceContext, jobsSummary, improvementContext);
      }

      return states;
    },
    enabled: !!user && botIds.length > 0,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}
