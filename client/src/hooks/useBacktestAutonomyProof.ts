import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ProofCheck {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
}

export interface BacktestAutonomyProof {
  now_utc: string;
  now_et: string;
  market_session: string;
  is_market_open: boolean;
  bot_state_counts: Record<string, number>;
  job_queue_stats: {
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    oldest_queued_age_minutes: number | null;
    stuck_running: number;
  };
  worker_status: {
    online_count: number;
    last_heartbeat_age_seconds: number | null;
    workers: Array<{
      worker_id: string;
      status: string;
      last_heartbeat_at: string;
      jobs_processed: number;
    }>;
  };
  backtest_stats_24h: {
    total: number;
    by_status: Record<string, number>;
    median_bars_loaded: number | null;
    median_total_trades: number | null;
    top_errors: string[];
  };
  backtest_stats_7d: {
    total: number;
    by_status: Record<string, number>;
    completed: number;
    failed: number;
  };
  bot_backtest_schedule: Array<{
    bot_id: string;
    bot_name: string;
    last_backtest_at: string | null;
    next_backtest_at: string | null;
    has_pending_job: boolean;
  }>;
  stall_reasons: Record<string, number>;
  blockers_found: string[];
  overall_status: "PASS" | "FAIL" | "DEGRADED";
  checks: ProofCheck[];
}

export function useBacktestAutonomyProof() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<BacktestAutonomyProof> => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/backtest-autonomy-proof?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate proof');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["backtest-autonomy-proof"] });
      toast({
        title: `Proof: ${data.overall_status}`,
        description: `${data.checks.filter(c => c.status === "PASS").length}/${data.checks.length} checks passed`,
        variant: data.overall_status === "FAIL" ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Proof failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useLatestProof() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["backtest-autonomy-proof", "latest"],
    queryFn: async () => {
      if (!user) return null;

      const response = await fetch(`/api/backtest-autonomy-proof?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch latest proof');
      }

      return response.json();
    },
    enabled: !!user,
  });
}

export function useTriggerScheduler() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/backtest-scheduler?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to run scheduler');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bot-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({
        title: "Scheduler triggered",
        description: `Scheduled ${data.scheduled} backtests, skipped ${data.skipped}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Scheduler failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useBotEvolutionEvents(botId?: string, limit = 50) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-evolution-events", botId, limit],
    queryFn: async () => {
      if (!user) return [];

      const params = new URLSearchParams();
      params.set('user_id', user.id);
      params.set('limit', limit.toString());
      if (botId) params.set('bot_id', botId);

      const response = await fetch(`/api/bot-generations?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}

export function useBotMutationsTracking(botId?: string, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-mutations-tracking", botId, limit],
    queryFn: async () => {
      if (!user) return [];

      const params = new URLSearchParams();
      params.set('user_id', user.id);
      params.set('limit', limit.toString());
      if (botId) params.set('bot_id', botId);

      const response = await fetch(`/api/bot-generations?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}
