import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface ProductionScorecard {
  id: string;
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    autonomous_bots_pct: number;
    jobs_within_sla_pct: number;
    runner_uptime_pct: number;
    cache_hit_rate_pct: number;
    manual_interventions: number;
    circuit_breakers_open: number;
    frozen_bots_count: number;
    invalid_pause_count: number;
  };
  details: {
    total_bots: number;
    autonomous_bots: number;
    paused_bots: number;
    frozen_bots: number;
    total_jobs_24h: number;
    jobs_within_sla: number;
    jobs_exceeded_sla: number;
    runner_instances: number;
    healthy_runners: number;
    stalled_runners: number;
    backtests_24h: number;
    cache_hits: number;
  };
  recommendations: string[];
  created_at: string;
}

interface PaperReadinessReport {
  go_paper: boolean;
  active_runners: {
    count_paper_bots: number;
    count_with_runner: number;
    heartbeat_fresh_pct: number;
    missing_runners: string[];
  };
  market_data: {
    bars_ingested: number;
    max_gap_seconds: number;
    provider: string;
  };
  order_lifecycle: {
    decisions_count: number;
    orders_submitted: number;
    fills_count: number;
    trades_closed: number;
    orphan_orders: number;
    orphan_fills: number;
  };
  pnl_reconciliation: {
    from_trades: number;
    from_fills: number;
    from_ledger: number;
    delta_tolerance_ok: boolean;
  };
  evidence: Record<string, any>;
}

interface ChaosTestResult {
  resilience_score: number;
  tests_passed: number;
  tests_total: number;
  avg_recovery_time_ms: number;
  verdict: 'RESILIENT' | 'ACCEPTABLE' | 'FRAGILE';
  results: Array<{
    test_name: string;
    category: string;
    passed: boolean;
    recovery_time_ms?: number;
    details: string;
    evidence?: Record<string, any>;
  }>;
}

interface TradeTrace {
  trade_id: string;
  bot_id: string;
  symbol: string;
  direction: string;
  entry_time: string;
  exit_time?: string;
  pnl?: number;
  chain: {
    decision?: Record<string, any>;
    orders: Array<Record<string, any>>;
    fills: Array<Record<string, any>>;
    position?: Record<string, any>;
  };
  provenance: {
    timeframe?: string;
    horizon?: string;
    regime?: string;
    signal_sources?: string[];
  };
}

export function useLatestScorecard() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["production-scorecard", "latest"],
    queryFn: async (): Promise<ProductionScorecard | null> => {
      if (!user) return null;

      const response = await fetch(`/api/health-summary?user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch scorecard');
      }

      const result = await response.json();
      const data = result.data;
      
      if (!data) return null;

      const score = Math.round(
        (data.healthyBots / Math.max(data.totalBots, 1)) * 40 +
        (data.runningInstances / Math.max(data.totalInstances, 1)) * 30 +
        (1 - data.failedJobsLast24h / Math.max(data.totalJobsLast24h, 1)) * 30
      );

      const grade = score >= 95 ? 'A+' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

      return {
        id: `scorecard_${Date.now()}`,
        score,
        grade,
        components: {
          autonomous_bots_pct: data.healthyBots / Math.max(data.totalBots, 1) * 100,
          jobs_within_sla_pct: (1 - data.failedJobsLast24h / Math.max(data.totalJobsLast24h, 1)) * 100,
          runner_uptime_pct: data.runningInstances / Math.max(data.totalInstances, 1) * 100,
          cache_hit_rate_pct: 0,
          manual_interventions: 0,
          circuit_breakers_open: 0,
          frozen_bots_count: 0,
          invalid_pause_count: 0,
        },
        details: {
          total_bots: data.totalBots,
          autonomous_bots: data.healthyBots,
          paused_bots: data.pausedBots,
          frozen_bots: 0,
          total_jobs_24h: data.totalJobsLast24h,
          jobs_within_sla: data.totalJobsLast24h - data.failedJobsLast24h,
          jobs_exceeded_sla: data.failedJobsLast24h,
          runner_instances: data.totalInstances,
          healthy_runners: data.runningInstances,
          stalled_runners: data.stoppedInstances,
          backtests_24h: 0,
          cache_hits: 0,
        },
        recommendations: [],
        created_at: new Date().toISOString(),
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useScorecardHistory(limit = 7) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["production-scorecards", "history", limit],
    queryFn: async (): Promise<ProductionScorecard[]> => {
      return [];
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
}

export function useGenerateScorecard() {
  const { user } = useAuth();
  
  return async (): Promise<ProductionScorecard> => {
    if (!user) throw new Error("Not authenticated");

    const response = await fetch(`/api/health-summary?user_id=${user.id}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to generate scorecard');
    }

    const result = await response.json();
    const data = result.data;
    
    const score = Math.round(
      (data.healthyBots / Math.max(data.totalBots, 1)) * 40 +
      (data.runningInstances / Math.max(data.totalInstances, 1)) * 30 +
      (1 - data.failedJobsLast24h / Math.max(data.totalJobsLast24h, 1)) * 30
    );

    const grade = score >= 95 ? 'A+' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

    return {
      id: `scorecard_${Date.now()}`,
      score,
      grade,
      components: {
        autonomous_bots_pct: data.healthyBots / Math.max(data.totalBots, 1) * 100,
        jobs_within_sla_pct: (1 - data.failedJobsLast24h / Math.max(data.totalJobsLast24h, 1)) * 100,
        runner_uptime_pct: data.runningInstances / Math.max(data.totalInstances, 1) * 100,
        cache_hit_rate_pct: 0,
        manual_interventions: 0,
        circuit_breakers_open: 0,
        frozen_bots_count: 0,
        invalid_pause_count: 0,
      },
      details: {
        total_bots: data.totalBots,
        autonomous_bots: data.healthyBots,
        paused_bots: data.pausedBots,
        frozen_bots: 0,
        total_jobs_24h: data.totalJobsLast24h,
        jobs_within_sla: data.totalJobsLast24h - data.failedJobsLast24h,
        jobs_exceeded_sla: data.failedJobsLast24h,
        runner_instances: data.totalInstances,
        healthy_runners: data.runningInstances,
        stalled_runners: data.stoppedInstances,
        backtests_24h: 0,
        cache_hits: 0,
      },
      recommendations: [],
      created_at: new Date().toISOString(),
    };
  };
}

export function usePaperReadinessAudit(window: string = '24h') {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['paper-readiness-audit', window],
    queryFn: async (): Promise<PaperReadinessReport> => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/audits/paper-readiness?user_id=${user.id}&window=${window}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch paper readiness audit');
      }

      return response.json();
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useGraduationSuite(dryRun: boolean = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['graduation-suite', dryRun],
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/audits/graduation-suite?user_id=${user.id}&dry_run=${dryRun}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch graduation suite');
      }

      return response.json();
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
}

export function useChaosTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (testType: string = 'all'): Promise<ChaosTestResult> => {
      const response = await fetch('/api/chaos-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'run_all' }),
      });

      if (!response.ok) {
        throw new Error('Failed to run chaos test');
      }

      const data = await response.json();
      
      return {
        resilience_score: data?.summary?.passed ? Math.round((data.summary.passed / data.summary.total) * 100) : 0,
        tests_passed: data?.summary?.passed || 0,
        tests_total: data?.summary?.total || 0,
        avg_recovery_time_ms: 0,
        verdict: data?.summary?.passed === data?.summary?.total ? 'RESILIENT' : 
                 data?.summary?.passed > data?.summary?.total / 2 ? 'ACCEPTABLE' : 'FRAGILE',
        results: (data?.results || []).map((r: any) => ({
          test_name: r.test_name,
          category: 'execution',
          passed: r.status === 'PASS',
          recovery_time_ms: r.recovery_time_ms,
          details: r.actual || r.expected,
          evidence: {},
        })),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chaos-test-results'] });
    },
  });
}

export function useChaosTestResults() {
  return useQuery({
    queryKey: ['chaos-test-results'],
    queryFn: async (): Promise<ChaosTestResult | null> => {
      return null;
    },
    staleTime: 60 * 1000,
  });
}

export function useTradeTrace(botId: string, tradeId?: string) {
  const { user } = useAuth();
  
  return useQuery({
    queryKey: ['trade-trace', botId, tradeId, user?.id],
    queryFn: async (): Promise<TradeTrace[]> => {
      if (!user?.id) return [];
      
      const params = new URLSearchParams();
      params.set('user_id', user.id);
      if (tradeId) params.set('trade_id', tradeId);
      params.set('limit', '20');

      const response = await fetch(`/api/trades/${botId}/trace?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch trade traces');
      }

      const data = await response.json();
      return data?.traces || [];
    },
    enabled: !!botId && !!user,
    staleTime: 30 * 1000,
  });
}

export function useAutonomyLoopStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['autonomy-loop-status'],
    queryFn: async () => {
      if (!user) return [];

      // Fetch autonomy loops from dedicated endpoint
      const loopsResponse = await fetch(`/api/autonomy-loops`, {
        credentials: 'include',
      });

      if (loopsResponse.ok) {
        const result = await loopsResponse.json();
        const loops = result.data || [];
        
        if (loops.length > 0) {
          return loops.map((loop: any) => ({
            id: loop.id,
            loop_name: loop.loopName || loop.loop_name,
            mechanism: 'interval',
            schedule: '30s',
            run_count: loop.runCount ?? loop.run_count ?? 0,
            error_count: loop.errorCount ?? loop.error_count ?? 0,
            is_enabled: loop.isHealthy !== false,
            last_success_at: loop.lastSuccessAt || loop.last_success_at,
            last_error_at: loop.lastErrorAt || loop.last_error_at,
            is_healthy: loop.isHealthy ?? true,
          }));
        }
      }

      // No fallback - if autonomy_loops table is empty, return empty array
      // This prevents phantom "Bot Runner" entries from appearing
      return [];
    },
    enabled: !!user,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  });
}

export function usePerformanceTimings() {
  return useQuery({
    queryKey: ['performance-timings'],
    queryFn: async () => {
      return [];
    },
    staleTime: 60 * 1000,
  });
}

export function useGoNoGoStatus() {
  const paperReadiness = usePaperReadinessAudit();
  const graduationSuite = useGraduationSuite();
  const chaosResults = useChaosTestResults();
  const autonomyStatus = useAutonomyLoopStatus();

  const isLoading = paperReadiness.isLoading || graduationSuite.isLoading || autonomyStatus.isLoading;

  const goPaper = paperReadiness.data?.go_paper ?? false;
  
  const goShadow = goPaper && 
    (graduationSuite.data?.results?.some((r: any) => r.gates?.paper_to_shadow?.pass) ?? false);
  
  const goCanary = goShadow && 
    (graduationSuite.data?.results?.some((r: any) => r.gates?.shadow_to_canary?.pass) ?? false) &&
    (chaosResults.data?.resilience_score ?? 0) >= 60;
  
  const goLive = goCanary && 
    (graduationSuite.data?.results?.some((r: any) => r.gates?.canary_to_live?.pass) ?? false) &&
    (chaosResults.data?.resilience_score ?? 0) >= 80;

  const blockers: string[] = [];
  
  if (!paperReadiness.data?.go_paper) {
    if (paperReadiness.data?.active_runners.missing_runners?.length) {
      blockers.push(`Missing runners: ${paperReadiness.data.active_runners.missing_runners.length}`);
    }
    if (!paperReadiness.data?.pnl_reconciliation.delta_tolerance_ok) {
      blockers.push('PnL reconciliation mismatch');
    }
  }
  
  if (chaosResults.data && chaosResults.data.resilience_score < 60) {
    blockers.push(`Low resilience score: ${chaosResults.data.resilience_score}%`);
  }

  const loopsStale = autonomyStatus.data?.filter((l: any) => {
    if (!l.last_success_at) return true;
    const age = Date.now() - new Date(l.last_success_at).getTime();
    return age > 10 * 60 * 1000;
  });

  if (loopsStale && loopsStale.length > 0) {
    if (loopsStale.length <= 3) {
      blockers.push(`Stale autonomy loops: ${loopsStale.map((l: any) => l.loop_name).join(', ')}`);
    } else {
      blockers.push(`Stale autonomy loops: ${loopsStale.length} loops need attention`);
    }
  }

  return {
    isLoading,
    goPaper,
    goShadow,
    goCanary,
    goLive,
    blockers,
    paperReadiness: paperReadiness.data,
    graduationSuite: graduationSuite.data,
    chaosResults: chaosResults.data,
    autonomyStatus: autonomyStatus.data,
  };
}
