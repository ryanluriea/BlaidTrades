import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export type TournamentTier = "TOP_10" | "SAFE" | "AT_RISK" | "CYCLE_OUT";

export interface TournamentRanking {
  botId: string;
  botName: string;
  stage: string;
  score: number;
  rank: number;
  tier: TournamentTier;
  metrics: {
    sharpe: number;
    winRate: number;
    profitFactor: number;
    tradeCount: number;
  };
}

export interface TournamentTierCounts {
  TOP_10: number;
  SAFE: number;
  AT_RISK: number;
  CYCLE_OUT: number;
  total: number;
  lastUpdated: string | null;
}

export interface TournamentData {
  standings: TournamentRanking[];
  tierCounts: TournamentTierCounts;
}

export function useTournament() {
  return useQuery<{ success: boolean; data: TournamentData }, Error, TournamentData>({
    queryKey: ["/api/fleet/tournament"],
    select: (response) => response.data,
    staleTime: 60000,
    refetchInterval: 60000,
  });
}

export function useRunTournament() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/fleet/tournament/run");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/tournament"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots-overview"] });
    },
  });
}

export function useCycleFleet() {
  return useMutation({
    mutationFn: async (maxCycleOut: number = 10) => {
      const res = await apiRequest("POST", "/api/fleet/tournament/cycle", { maxCycleOut });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/tournament"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots-overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
    },
  });
}
