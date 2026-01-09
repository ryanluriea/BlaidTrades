import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

export interface TournamentEntry {
  id: string;
  tournamentId: string;
  botId: string;
  lane: string | null;
  symbol: string | null;
  tradesN: number | null;
  fitnessV2: number | null;
  candidateScore: number | null;
  rank: number | null;
  actionTaken: string | null;
  penaltiesJson: string[] | null;
  metricsSnapshot: Record<string, number> | null;
  createdAt: string;
  bots?: { name: string } | null;
}

export interface Tournament {
  id: string;
  user_id: string;
  status: string;
  cadence_type: string | null;
  lane: string | null;
  symbol_bucket: string | null;
  entrants_count: number | null;
  scope_json: Record<string, unknown> | null;
  scoring_json: Record<string, unknown> | null;
  selection_json: Record<string, unknown> | null;
  summary_json: Record<string, unknown> | null;
  actions_json: Record<string, unknown> | null;
  error: string | null;
  triggered_by: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
}

export function useEvolutionTournaments() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["evolution-tournaments"],
    queryFn: async (): Promise<Tournament[]> => {
      const response = await fetch('/api/evolution-tournaments', {
        credentials: 'include',
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

export function useTournamentEntries(tournamentId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tournament-entries", tournamentId],
    queryFn: async () => {
      if (!tournamentId) return [];
      
      const response = await fetch(`/api/evolution-tournaments/${tournamentId}/entries`, {
        credentials: 'include',
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!tournamentId,
  });
}

export function useRunTournament() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      cadence_type?: 'INCREMENTAL' | 'DAILY_MAJOR';
      dry_run?: boolean;
      scope?: Record<string, unknown>;
      selection?: Record<string, unknown>;
    }) => {
      const response = await fetch('/api/evolution-tournaments/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });

      if (!response.ok) throw new Error('Tournament failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["evolution-tournaments"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({
        title: data?.dry_run ? "Dry Run Complete" : "Tournament Complete",
        description: `${data?.summary?.entrants || 0} bots evaluated, ${data?.summary?.winners?.length || 0} winners`,
      });
    },
    onError: (error) => {
      toast({
        title: "Tournament Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useLiveEligibleBots() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["live-eligible-bots"],
    queryFn: async () => {
      const response = await fetch('/api/bots/live-eligible', {
        credentials: 'include',
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

export function usePromoteToLive() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`/api/bots/${botId}/promote-live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Promotion failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["live-eligible-bots"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Promoted to LIVE", description: "Bot is now in LIVE stage" });
    },
    onError: (error) => {
      toast({
        title: "Promotion Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useRetireBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`/api/bots/${botId}/retire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Retirement failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Bot Retired", description: "Bot has been retired from tournaments" });
    },
    onError: (error) => {
      toast({
        title: "Retirement Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export function useUnretireBot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (botId: string) => {
      const response = await fetch(`/api/bots/${botId}/unretire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Unretirement failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      toast({ title: "Bot Unretired", description: "Bot is back in TRAINEE stage" });
    },
    onError: (error) => {
      toast({
        title: "Unretirement Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
}

export interface TournamentSchedulerStatus {
  eligibleBotsCount: number;
  eligibilityIssues: string[];
  canRunTournament: boolean;
  schedule: {
    incremental: {
      intervalHours: number;
      lastRun: string | null;
      nextRun: string;
      runCount: number;
    };
    dailyMajor: {
      scheduledHourET: number;
      lastRun: string | null;
      nextRun: string;
      runCount: number;
    };
  };
  workerCheckIntervalMinutes: number;
}

export function useTournamentSchedulerStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tournament-scheduler-status"],
    queryFn: async (): Promise<TournamentSchedulerStatus | null> => {
      const response = await fetch('/api/evolution-tournaments/scheduler-status', {
        credentials: 'include',
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });
}
