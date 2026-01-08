import { useQuery } from "@tanstack/react-query";
import type { WalkForwardRun } from "@shared/schema";

async function fetchWalkForwardRuns(botId: string): Promise<WalkForwardRun[]> {
  const response = await fetch(`/api/bots/${botId}/walk-forward`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch walk-forward runs");
  }
  const data = await response.json();
  return data.data || [];
}

async function fetchLatestWalkForward(botId: string): Promise<WalkForwardRun | null> {
  const response = await fetch(`/api/bots/${botId}/walk-forward/latest`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch latest walk-forward run");
  }
  const data = await response.json();
  return data.data || null;
}

export function useWalkForwardRuns(botId: string | undefined) {
  return useQuery({
    queryKey: ["/api/bots", botId, "walk-forward"],
    queryFn: () => fetchWalkForwardRuns(botId!),
    enabled: !!botId,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useLatestWalkForward(botId: string | undefined) {
  return useQuery({
    queryKey: ["/api/bots", botId, "walk-forward", "latest"],
    queryFn: () => fetchLatestWalkForward(botId!),
    enabled: !!botId,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}
