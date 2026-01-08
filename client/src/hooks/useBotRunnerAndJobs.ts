import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";

export interface RunnerInstance {
  id: string;
  mode: string;
  activityState: string;
  accountId: string | null;
  accountName?: string;
  lastHeartbeat: string | null;
  startedAt: string | null;
  status: string;
}

export interface JobsSummary {
  backtestsRunning: number;
  backtestsQueued: number;
  evaluating: boolean;
  training: boolean;
  evolvingRunning: number;
  evolvingQueued: number;
  improvingRunning: number;
  improvingQueued: number;
  // Running job timestamps for elapsed time display
  backtestStartedAt: string | null;
  evolveStartedAt: string | null;
  improveStartedAt: string | null;
}

export interface BotRunnerAndJobs {
  botId: string;
  runner: RunnerInstance | null;
  jobs: JobsSummary;
}

export function useBotRunnerAndJobs(botIds: string[]) {
  const { user } = useAuth();
  const restOnline = useRestOnline();

  return useQuery({
    queryKey: ["bot-runner-jobs", botIds],
    queryFn: async (): Promise<Record<string, BotRunnerAndJobs>> => {
      if (!user || botIds.length === 0 || !restOnline) return {};

      const response = await fetch("/api/bot-runner-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_ids: botIds }),
      });
      if (!response.ok) throw new Error("Failed to fetch bot runner jobs");
      const json = await response.json();
      return json.data || {};
    },
    enabled: !!user && restOnline && botIds.length > 0,
    staleTime: 5_000,
    refetchInterval: restOnline ? 8_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function useSingleBotRunnerAndJobs(botId: string | undefined) {
  const result = useBotRunnerAndJobs(botId ? [botId] : []);
  
  return {
    ...result,
    data: botId && result.data ? result.data[botId] : null,
  };
}
