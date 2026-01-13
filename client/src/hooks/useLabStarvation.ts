import { useQuery } from "@tanstack/react-query";

interface LabBotStarvation {
  id: string;
  name: string;
  symbol: string;
  generation: number;
  has_valid_baseline: boolean;
  last_backtest_at: string | null;
  last_improve_at: string | null;
  last_evolve_at: string | null;
  last_any_job_at: string | null;
  minutes_since_backtest: number | null;
  minutes_since_improve: number | null;
  minutes_since_evolve: number | null;
  minutes_since_any_job: number | null;
  queued_jobs: number;
  running_jobs: number;
  next_due_type: string;
  next_due_minutes: number;
  idle_reason_code: string;
  sla_breached: boolean;
}

interface LabStarvationResponse {
  proof_type: string;
  timestamp: string;
  config: {
    LAB_MAX_IDLE_MIN: number;
    LAB_BACKTEST_INTERVAL_MIN: number;
    LAB_IMPROVE_INTERVAL_MIN: number;
    LAB_EVOLVE_INTERVAL_MIN: number;
  };
  summary: {
    total_lab_bots: number;
    sla_breached_count: number;
    needs_baseline_count: number;
    bots_with_work: number;
  };
  bots: LabBotStarvation[];
}

export function useLabStarvation(enabled: boolean = true) {
  return useQuery<LabStarvationResponse>({
    queryKey: ["/api/_proof/lab-starvation"],
    queryFn: async () => {
      const res = await fetch("/api/_proof/lab-starvation");
      if (!res.ok) throw new Error("Failed to fetch LAB starvation data");
      return res.json();
    },
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    staleTime: 15_000,
  });
}

// Helper to get idle info for a specific bot
// Note: Parameter order is (data, botId) to match usage in Bots.tsx
export function getLabIdleInfo(
  data: LabStarvationResponse | undefined,
  botId: string
): {
  idleReasonCode: string | null;
  nextRunMinutes: number | null;
  lastJobAt: string | null;
} | null {
  if (!data?.bots) return null;
  const bot = data.bots.find(b => b.id === botId);
  if (!bot) return null;
  
  return {
    idleReasonCode: bot.idle_reason_code,
    nextRunMinutes: bot.next_due_minutes,
    lastJobAt: bot.last_any_job_at,
  };
}
