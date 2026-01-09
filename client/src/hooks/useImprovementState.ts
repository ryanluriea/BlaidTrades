/**
 * Improvement state hook
 * MIGRATED: Supabase → Express API
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface ImprovementState {
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
  /** Rolling metrics consistency data for TRIALS promotion visibility */
  rollingMetricsConsistency?: {
    metSessions: number;
    requiredSessions: number;
    totalRecentSessions: number;
    passed: boolean;
    status: 'pending' | 'passed' | 'insufficient_data';
  } | null;
}

export interface BacktestFailure {
  id: string;
  userId: string;
  botId: string;
  backtestSessionId: string;
  failureCategory: string;
  evidenceJson: Record<string, any>;
  createdAt: string;
}

export interface MutationEvent {
  id: string;
  userId: string;
  botId: string;
  parentGenerationId: string | null;
  childGenerationId: string | null;
  failureCategory: string;
  mutationPlan: string;
  paramsBeforeJson: Record<string, any>;
  paramsAfterJson: Record<string, any>;
  diffJson: Record<string, any>;
  createdAt: string;
}

export interface Tournament {
  id: string;
  userId: string;
  botId: string;
  parentGenerationId: string;
  candidateGenerations: string[];
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  winnerGenerationId: string | null;
  scoresJson: Record<string, number> | null;
  improvementDelta: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response;
}

export function useBotImprovementState(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-improvement-state", botId],
    queryFn: async () => {
      if (!botId) return null;

      const response = await fetchWithAuth(`/api/bots/${botId}/improvement-state`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch improvement state');
      }

      return data.data as ImprovementState | null;
    },
    enabled: !!user && !!botId,
  });
}

export function useAllImprovementStates() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-improvement-states"],
    queryFn: async () => {
      const botsRes = await fetchWithAuth('/api/bots');
      const botsData = await botsRes.json();
      const bots = botsData.data || [];

      const results = await Promise.all(
        bots.map((bot: any) => 
          fetchWithAuth(`/api/bots/${bot.id}/improvement-state`)
            .then(r => r.json())
            .catch(() => null)
        )
      );

      const stateMap = new Map<string, ImprovementState>();
      results.forEach((result, idx) => {
        if (result?.success && result.data) {
          stateMap.set(bots[idx].id, result.data);
        }
      });
      return stateMap;
    },
    enabled: !!user,
  });
}

export function useBotBacktestFailures(botId: string | undefined, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-backtest-failures", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      const response = await fetchWithAuth(`/api/bots/${botId}/backtest-failures?limit=${limit}`);
      const data = await response.json();

      if (!data.success) {
        return [];
      }

      return (data.data || []) as BacktestFailure[];
    },
    enabled: !!user && !!botId,
  });
}

export function useBotMutationEvents(botId: string | undefined, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-mutation-events", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      const response = await fetchWithAuth(`/api/bots/${botId}/mutation-events?limit=${limit}`);
      const data = await response.json();

      if (!data.success) {
        return [];
      }

      return (data.data || []) as MutationEvent[];
    },
    enabled: !!user && !!botId,
  });
}

export function useBotTournaments(botId: string | undefined, limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot-tournaments", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      const response = await fetchWithAuth(`/api/bots/${botId}/tournaments?limit=${limit}`);
      const data = await response.json();

      if (!data.success) {
        return [];
      }

      return (data.data || []) as Tournament[];
    },
    enabled: !!user && !!botId,
  });
}

export function useToggleImprovement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botId, pause }: { botId: string; pause: boolean }) => {
      if (!user) throw new Error("Not authenticated");

      const newStatus = pause ? 'PAUSED' : 'IMPROVING';

      const response = await fetch(`/api/bots/${botId}/improvement-state`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          updatedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update improvement state');
      }

      return response.json();
    },
    onSuccess: (_, { pause }) => {
      queryClient.invalidateQueries({ queryKey: ["bot-improvement-state"] });
      queryClient.invalidateQueries({ queryKey: ["bot-improvement-states"] });
      toast({
        title: pause ? "Improvements paused" : "Improvements resumed",
        description: pause 
          ? "Bot will no longer auto-evolve on failures" 
          : "Bot will auto-evolve when backtests fail",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });
}

export function useForceEvolve() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botId, failureCategory }: { botId: string; failureCategory?: string }) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/evolve-bot', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botId,
          failureCategory: failureCategory || "MANUAL_TRIGGER",
          force: true,
        }),
      });

      if (!response.ok) {
        if (response.status === 501) {
          const data = await response.json();
          throw new Error(data.message || 'Evolution not implemented');
        }
        throw new Error('Evolution request failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bot-improvement-state"] });
      queryClient.invalidateQueries({ queryKey: ["bot-mutation-events"] });
      queryClient.invalidateQueries({ predicate: (query) => 
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/bot-generations/')
      });
      queryClient.invalidateQueries({ queryKey: ["bot_jobs"] });
      toast({
        title: "Evolution started",
        description: `Created new generation with mutation plan: ${data?.data?.mutationPlan || 'custom'}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Evolution failed", description: error.message, variant: "destructive" });
    },
  });
}
