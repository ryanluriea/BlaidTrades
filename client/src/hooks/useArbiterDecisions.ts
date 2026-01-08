/**
 * Arbiter decisions hook
 * MIGRATED: Supabase → Express API
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface ArbiterDecision {
  id: string;
  createdAt: string;
  botId: string;
  botInstanceId: string | null;
  accountId: string | null;
  symbol: string;
  decision: "EXECUTED" | "BLOCKED" | "DELAYED";
  reasonCodes: string[];
  priorityScore: number;
  candidateScore: number;
  competingBotsJson: Array<{
    botId: string;
    botName?: string;
    score: number;
    won?: boolean;
    blocked?: boolean;
    blockReason?: string;
  }>;
  riskSnapshotJson: {
    dailyHeadroom?: number;
    maxContracts?: number;
    exposureUsed?: number;
    accountBalance?: number;
    [key: string]: any;
  };
  signalSnapshotJson: {
    confidence?: number;
    regime?: string;
    indicators?: Record<string, any>;
    [key: string]: any;
  };
  orderId: string | null;
  executionRoute: string | null;
  contractsAllocated: number | null;
  userId: string;
}

export interface CreateArbiterDecisionInput {
  botId: string;
  botInstanceId?: string;
  accountId?: string;
  symbol: string;
  decision: "EXECUTED" | "BLOCKED" | "DELAYED";
  reasonCodes: string[];
  priorityScore: number;
  candidateScore: number;
  competingBotsJson?: ArbiterDecision["competingBotsJson"];
  riskSnapshotJson?: ArbiterDecision["riskSnapshotJson"];
  signalSnapshotJson?: ArbiterDecision["signalSnapshotJson"];
  orderId?: string;
  executionRoute?: string;
  contractsAllocated?: number;
}

async function fetchWithAuth(url: string): Promise<Response> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response;
}

/**
 * Fetch arbiter decisions for a specific bot
 */
export function useArbiterDecisions(botId: string | undefined, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["arbiter_decisions", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      const response = await fetchWithAuth(`/api/bots/${botId}/arbiter-decisions?limit=${limit}`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch arbiter decisions');
      }

      return (data.data || []) as ArbiterDecision[];
    },
    enabled: !!user && !!botId,
  });
}

/**
 * Fetch recent arbiter decisions across all bots (for Runs & Logs view)
 */
export function useRecentArbiterDecisions(filters?: {
  decision?: string;
  limit?: number;
}) {
  const { user } = useAuth();
  const limit = filters?.limit ?? 50;

  return useQuery({
    queryKey: ["arbiter_decisions_recent", filters],
    queryFn: async () => {
      let url = `/api/arbiter-decisions?limit=${limit}`;
      if (filters?.decision) {
        url += `&decision=${filters.decision}`;
      }

      const response = await fetchWithAuth(url);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch arbiter decisions');
      }

      return (data.data || []) as Array<ArbiterDecision & {
        bots: { name: string } | null;
        accounts: { name: string } | null;
      }>;
    },
    enabled: !!user,
  });
}

/**
 * Create a new arbiter decision record
 */
export function useCreateArbiterDecision() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateArbiterDecisionInput) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch('/api/arbiter-decisions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          competingBotsJson: input.competingBotsJson ?? [],
          riskSnapshotJson: input.riskSnapshotJson ?? {},
          signalSnapshotJson: input.signalSnapshotJson ?? {},
          userId: user.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create arbiter decision');
      }

      const data = await response.json();
      return data.data as ArbiterDecision;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["arbiter_decisions", data.botId] });
      queryClient.invalidateQueries({ queryKey: ["arbiter_decisions_recent"] });
    },
  });
}

/**
 * Arbiter decision statistics for a bot
 */
export function useArbiterStats(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["arbiter_stats", botId],
    queryFn: async () => {
      if (!botId) return null;

      const response = await fetchWithAuth(`/api/bots/${botId}/arbiter-decisions`);
      const data = await response.json();

      if (!data.success) {
        return null;
      }

      const decisions = (data.data || []) as ArbiterDecision[];
      
      return {
        total: decisions.length,
        executed: decisions.filter(d => d.decision === "EXECUTED").length,
        blocked: decisions.filter(d => d.decision === "BLOCKED").length,
        delayed: decisions.filter(d => d.decision === "DELAYED").length,
        executionRate: decisions.length > 0 
          ? (decisions.filter(d => d.decision === "EXECUTED").length / decisions.length) * 100
          : 0,
      };
    },
    enabled: !!user && !!botId,
  });
}
