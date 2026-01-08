import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { EvaluationRun as SchemaEvaluationRun, BotStageChange, BotGeneration, StrategyArchetype } from "@shared/schema";

export interface EvaluationRun {
  id: string;
  status: string;
  triggered_by: string;
  started_at: string | null;
  finished_at: string | null;
  bots_evaluated: number | null;
  bots_promoted: number | null;
  bots_demoted: number | null;
  error_message: string | null;
  results_json: any;
  created_at: string;
}

export interface StageChange {
  id: string;
  bot_id: string;
  from_stage: string;
  to_stage: string;
  decision: string;
  reasons_json: any;
  triggered_by: string;
  created_at: string;
}

export function useEvaluationRuns(limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["evaluation_runs", limit],
    queryFn: async (): Promise<EvaluationRun[]> => {
      const response = await fetch(`/api/evaluation-runs?limit=${limit}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch evaluation runs");
      const json = await response.json();
      return (json.data || []).map((r: SchemaEvaluationRun) => ({
        id: r.id,
        status: r.status,
        triggered_by: r.triggeredBy,
        started_at: r.startedAt,
        finished_at: r.finishedAt,
        bots_evaluated: r.botsEvaluated,
        bots_promoted: r.botsPromoted,
        bots_demoted: r.botsDemoted,
        error_message: r.errorMessage,
        results_json: r.resultsJson,
        created_at: r.createdAt,
      }));
    },
    enabled: !!user,
  });
}

export function useBotStageChanges(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_stage_changes", botId],
    queryFn: async (): Promise<StageChange[]> => {
      if (!botId) return [];
      const response = await fetch(`/api/bot-stage-changes/${botId}`, {
        credentials: "include",
      });
      if (!response.ok) return [];
      const json = await response.json();
      return (json.data || []).map((c: BotStageChange) => ({
        id: c.id,
        bot_id: c.botId,
        from_stage: c.fromStage,
        to_stage: c.toStage,
        decision: c.decision,
        reasons_json: c.reasonsJson,
        triggered_by: c.triggeredBy,
        created_at: c.createdAt,
      }));
    },
    enabled: !!user && !!botId,
  });
}

export function usePromoteBot() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botId, targetMode, force }: { botId: string; targetMode: 'SIM_LIVE' | 'SHADOW' | 'LIVE'; force?: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch(`/api/bots/${botId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ target_mode: targetMode, force }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to promote bot");
      }
      return response.json().then(r => r.data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bot_stage_changes"] });
      if (data.promoted) {
        toast({ title: "Bot promoted successfully!" });
      } else if (data.requires_approval) {
        toast({ title: "Promotion requires approval", description: "LIVE promotion requires manual approval." });
      } else {
        toast({ title: "Promotion blocked", description: data.reasons?.join(", "), variant: "destructive" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Promotion failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useGraduationEvaluate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (botId?: string) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch("/api/graduation-evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: botId }),
      });

      if (!response.ok) {
        return { evaluated: 0, summary: { promote: 0, keep: 0, demote: 0 } };
      }
      return response.json().then(r => r.data || { evaluated: 0, summary: { promote: 0, keep: 0, demote: 0 } });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["evaluation_runs"] });
      queryClient.invalidateQueries({ queryKey: ["bot_stage_changes"] });
      toast({ 
        title: "Graduation complete", 
        description: `Evaluated ${data.evaluated || 0} bots: ${data.summary?.promote || 0} promote, ${data.summary?.keep || 0} keep` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Evaluation failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useEvolutionEngine() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ botId, numVariations, mutationStrength }: { botId: string; numVariations?: number; mutationStrength?: number }) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch("/api/evolution-engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_id: botId, num_variations: numVariations, mutation_strength: mutationStrength }),
      });

      if (!response.ok) {
        return { variations: [], bot_name: "Unknown" };
      }
      return response.json().then(r => r.data || { variations: [], bot_name: "Unknown" });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ predicate: (query) => 
        typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/bot-generations/')
      });
      toast({ 
        title: "Evolution complete", 
        description: `Created ${data.variations?.length || 0} new variations for ${data.bot_name || 'bot'}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Evolution failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useRebalancePortfolio() {
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ maxPerBot, maxPerAccount, autoApply }: { maxPerBot?: number; maxPerAccount?: number; autoApply?: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      
      const response = await fetch("/api/rebalance-portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ max_allocation_per_bot: maxPerBot, max_allocation_per_account: maxPerAccount, auto_apply: autoApply }),
      });

      if (!response.ok) {
        return { recommendations: [], applied: false };
      }
      return response.json().then(r => r.data || { recommendations: [], applied: false });
    },
    onSuccess: (data) => {
      toast({ 
        title: "Rebalance analysis complete", 
        description: `${data.recommendations?.length || 0} recommendations${data.applied ? ' applied' : ''}` 
      });
    },
    onError: (error: Error) => {
      toast({ title: "Rebalance failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useBotGenerations(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [`/api/bot-generations/${botId}`],
    queryFn: async (): Promise<BotGeneration[]> => {
      if (!botId) return [];
      const response = await fetch(`/api/bot-generations/${botId}`, {
        credentials: "include",
      });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!botId,
  });
}

export function useStrategyArchetypes() {
  return useQuery({
    queryKey: ["strategy-archetypes"],
    queryFn: async (): Promise<StrategyArchetype[]> => {
      const response = await fetch("/api/strategy-archetypes", {
        credentials: "include",
      });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
  });
}

export function usePromotionLogs(entityId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["promotion-logs", entityId],
    queryFn: async () => {
      const url = entityId 
        ? `/api/promotion-logs?entity_id=${entityId}&limit=50`
        : "/api/promotion-logs?limit=50";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

export function useGenerateAIBriefing() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (briefingType: 'morning' | 'night') => {
      if (!user?.id) throw new Error("Not authenticated");
      
      const response = await fetch("/api/ai-briefing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ user_id: user.id, briefing_type: briefingType }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate briefing");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-briefings"] });
      toast({ title: "Briefing generated successfully!" });
    },
    onError: (error: Error) => {
      toast({ title: "Briefing failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useBotAllocations(accountId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_allocations", accountId],
    queryFn: async () => {
      const url = accountId 
        ? `/api/bot-allocations?account_id=${accountId}`
        : "/api/bot-allocations";
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

export function useTradeDecisions(botId?: string, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade_decisions", botId, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: limit.toString() });
      if (botId) params.append("bot_id", botId);
      const response = await fetch(`/api/trade-decisions?${params}`, {
        credentials: "include",
      });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

// =========== INSTITUTIONAL: Strategy Rules Hook ===========
export interface StrategyRulesData {
  version: string;
  archetype: string;
  name: string;
  lastModifiedAt: string | null;
  changeReason: string | null;
  entry: {
    condition: Record<string, any>;
    confirmations: Array<{ type: string; [key: string]: any }>;
    invalidations: Array<{ type: string; [key: string]: any }>;
  };
  exit: {
    takeProfit: Array<{ type: string; [key: string]: any }>;
    stopLoss: Array<{ type: string; [key: string]: any }>;
    trailingStop: { activationTicks?: number; trailDistance?: number; stepSize?: number } | null;
    timeStop: { maxBarsInTrade?: number } | null;
  };
  risk: {
    riskPerTrade: number;
    maxDailyLoss: number;
    maxPositionSize: number;
  };
  session: {
    rthStart: string;
    rthEnd: string;
    noTradeWindows: Array<{ reason: string; start: string; end: string }>;
  };
}

export function useStrategyRules(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery<StrategyRulesData | null>({
    queryKey: ["strategy_rules", botId],
    queryFn: async () => {
      if (!botId) return null;
      const response = await fetch(`/api/bots/${botId}/strategy-rules`, {
        credentials: "include",
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!botId,
  });
}

// =========== INSTITUTIONAL: Evolution History Hook ===========
export interface EvolutionHistoryEntry {
  generationNumber: number;
  createdAt: string;
  mutationReasonCode: string | null;
  summaryTitle: string | null;
  summaryDiff: {
    changes?: Array<{ field: string; oldValue: any; newValue: any }>;
    performanceMetrics?: Record<string, number>;
    reason?: string;
  } | null;
  mutationsSummary: {
    direction?: string;
    changeCount?: number;
    fields?: string[];
  } | null;
  fitnessScore: number | null;
  isCurrent: boolean;
  parentGenerationNumber: number | null;
  strategyConfig: Record<string, any>;
}

export interface EvolutionHistoryData {
  currentGeneration: number;
  totalGenerations: number;
  history: EvolutionHistoryEntry[];
}

export function useEvolutionHistory(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery<EvolutionHistoryData | null>({
    queryKey: ["evolution_history", botId],
    queryFn: async () => {
      if (!botId) return null;
      const response = await fetch(`/api/bots/${botId}/evolution-history`, {
        credentials: "include",
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!botId,
  });
}
