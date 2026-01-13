import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

export interface StrategyLabSession {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'DRAFT';
  session_mode: 'STANDARD' | 'GENETICS';
  genetics_config: GeneticsConfig | null;
  current_generation: number;
  best_fitness_ever: number | null;
  genetic_diversity_score: number | null;
  convergence_warning: boolean;
  research_topic: string | null;
  target_archetype: string | null;
  symbol: string;
  timeframe: string;
  research_mode: 'CLOSED' | 'OPEN' | 'HYBRID';
  run_mode: 'INTERACTIVE' | 'AUTONOMOUS' | 'AUTOPILOT';
  autopilot_enabled: boolean;
  next_step_at: string | null;
  last_step_at: string | null;
  current_step_index: number;
  current_step: string | null;
  quality_gates_passed: boolean;
  total_ai_cost_usd: number;
  discovery_enabled: boolean;
  universe: string;
  constraints: {
    min_trades_month?: number;
    max_drawdown_pct?: number;
    holding_time?: string;
    session_hours?: string;
  };
  contract_preference: 'MICROS_ONLY' | 'MINIS_ONLY' | 'BOTH_PREFER_MICROS' | 'BOTH_PREFER_MINIS';
  auto_map_equivalents: boolean;
  last_activity_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneticsConfig {
  pool_size: number;
  selection_pressure: number;
  recombination_rate: number;
  mutation_rate: number;
  elite_count: number;
  immigration_rate: number;
  species_target: number;
  termination: {
    max_generations?: number;
    fitness_threshold?: number;
    time_budget_minutes?: number;
  };
}

export interface StrategyLabTask {
  id: string;
  session_id: string;
  user_id: string;
  task_type: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

export interface StrategyLabStep {
  id: string;
  session_id: string;
  step_type: string;
  step_index: number;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
}

export interface StrategyLabSource {
  id: string;
  session_id: string;
  source_type: 'WEB' | 'PAPER' | 'GITHUB' | 'BLOG' | 'VIDEO' | 'OTHER';
  title: string;
  url: string | null;
  fetched_at: string | null;
  excerpt_json: Record<string, unknown>;
  reliability_score: number;
  tags: string[];
  citation_key: string | null;
  created_at: string;
}

export interface StrategyLabCostEvent {
  id: string;
  session_id: string;
  step_id: string | null;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  created_at: string;
}

export interface QualityGate {
  id: string;
  session_id: string;
  gate_type: string;
  passed: boolean;
  evidence_json: Record<string, unknown>;
  checked_at: string;
}

export interface StrategyLabCandidate {
  id: string;
  session_id: string;
  user_id?: string;
  name?: string;
  description?: string;
  symbol_family?: string;
  instruments?: unknown;
  timeframe_set?: unknown;
  ruleset?: unknown;
  risk_model?: unknown;
  regime_profile?: unknown;
  genome_json?: Record<string, unknown>;
  progenitor_a_id?: string | null;
  progenitor_b_id?: string | null;
  generation_number?: number;
  species_id?: string;
  fitness_vector?: Record<string, number>;
  pareto_rank?: number;
  scalar_fitness?: number;
  archetype_failures?: Record<string, unknown>;
  genetic_traits?: {
    inheritedFromProgenitorA?: string[];
    inheritedFromProgenitorB?: string[];
    conflictsResolved?: string[];
    recombinationType?: string;
  };
  compatibility_score?: number;
  retired_at?: string | null;
  retired_reason?: string | null;
  is_elite?: boolean;
  is_immigrant?: boolean;
  blueprint: {
    name?: string;
    archetype?: string;
    symbol_candidates?: string[];
    timeframe_candidates?: string[];
    entry_rules?: string;
    exit_rules?: string;
    expected_win_rate?: number;
    expected_trades_month?: number;
    failure_modes?: string[];
  };
  status: 'DRAFT' | 'SCREENED' | 'REJECTED' | 'FINALIST' | 'EXPORTED' | 'VALIDATING' | 'PASSED' | 'FAILED' | 'PENDING';
  scores: {
    viability_score?: number;
    estimated_pf?: number;
    estimated_win_rate?: number;
    estimated_max_dd?: number;
    estimated_trades_month?: number;
    aggregate?: {
      profit_factor?: number;
      win_rate?: number;
      max_drawdown_pct?: number;
    };
    robustness_score?: number;
  };
  score?: number;
  score_components?: unknown;
  rank: number | null;
  rejection_reason: string | null;
  exported_bot_id: string | null;
  created_at: string;
}

export function useStrategyLabSessions() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["strategy-lab-sessions"],
    queryFn: async (): Promise<StrategyLabSession[]> => {
      const response = await fetch('/api/strategy-lab/sessions', {
        credentials: 'include',
      });
      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user,
  });
}

export function useStrategyLabSession(sessionId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["strategy-lab-session", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      
      const response = await fetch(`/api/strategy-lab/sessions/${sessionId}`, {
        credentials: 'include',
      });
      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!sessionId,
    refetchInterval: 10000, // THROTTLED: 10s (was 3s)
    staleTime: 5000,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      title: string;
      symbol?: string;
      timeframe?: string;
      research_mode?: 'CLOSED' | 'OPEN' | 'HYBRID';
      run_mode?: 'INTERACTIVE' | 'AUTOPILOT';
      discovery_enabled?: boolean;
      universe?: string;
      constraints?: Record<string, unknown>;
      contract_preference?: string;
      auto_map_equivalents?: boolean;
      start_auto?: boolean;
    }) => {
      const response = await fetch('/api/strategy-lab/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: "CREATE", ...params }),
      });
      if (!response.ok) throw new Error('Failed to create session');
      const json = await response.json();
      return json.data as StrategyLabSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-sessions"] });
      toast({ title: "Session created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create session", description: error.message, variant: "destructive" });
    },
  });
}

export function useSessionControl() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      session_id: string;
      action: 'PLAY' | 'PAUSE' | 'STOP' | 'UPDATE' | 'RUN_STEP';
      research_mode?: 'CLOSED' | 'OPEN' | 'HYBRID';
      run_mode?: 'INTERACTIVE' | 'AUTOPILOT';
      autopilot_enabled?: boolean;
    }) => {
      const response = await fetch(`/api/strategy-lab/sessions/${params.session_id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error('Control failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-sessions"] });
    },
    onError: (error) => {
      toast({ title: "Control failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useRunStep() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/strategy-lab/sessions/${sessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Step failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", sessionId] });
      if (data?.step) {
        toast({ title: `Step completed: ${data.step}` });
      }
    },
    onError: (error) => {
      toast({ title: "Step failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useExportCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { session_id: string; candidate_id: string }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id: params.session_id }),
      });
      if (!response.ok) throw new Error('Export failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["bots"] });
      queryClient.invalidateQueries({ queryKey: ["bots-overview"] });
      toast({ title: "Exported", description: data?.bot_id ? "Bot created from strategy" : "Strategy exported" });
    },
    onError: (error) => {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useEvaluateCandidateGates() {
  return useMutation({
    mutationFn: async (candidateId: string) => {
      const response = await fetch(`/api/strategy-lab/candidates/${candidateId}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Evaluation failed');
      const json = await response.json();
      return json.data as {
        candidate_id: string;
        can_promote: boolean;
        gates: Array<{
          name: string;
          passed: boolean;
          value: number | string | boolean | null;
          threshold: number | string | boolean | null;
          reason: string;
        }>;
        reason_codes: string[];
        evidence_hash: string;
      };
    },
  });
}

export function usePromoteCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      candidate_id: string;
      session_id?: string;
      user_id?: string;
      force?: boolean;
    }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });
      
      const json = await response.json();
      
      if (!response.ok) {
        throw new Error(json.error || 'Promotion failed');
      }
      
      if (json.data?.can_force && !json.data?.success) {
        return { ...json.data, needs_confirmation: true };
      }
      return json.data;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      
      queryClient.setQueriesData<RawStrategyCandidatesResponse>(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old) => old ? {
          ...old,
          data: old.data.map(c => 
            c.id === variables.candidate_id 
              ? { ...c, disposition: "SENT_TO_LAB" }
              : c
          ),
        } : old
      );
      
      return { previousData };
    },
    onSuccess: (data, variables) => {
      if (!data?.needs_confirmation) {
        if (variables.session_id) {
          queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
        queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
        queryClient.invalidateQueries({ queryKey: ["bots"] });
        queryClient.invalidateQueries({ queryKey: ["bots-overview"] });
        toast({ 
          title: "Strategy sent to LAB", 
          description: data?.botName 
            ? `Bot "${data.botName}" created successfully` 
            : `Strategy promoted to LAB stage`
        });
      }
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Promotion failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useRejectCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { candidate_id: string; session_id: string; reason?: string; notes?: string }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: params.reason, notes: params.notes }),
      });
      if (!response.ok) throw new Error('Rejection failed');
      return { success: true };
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      
      queryClient.setQueriesData<RawStrategyCandidatesResponse>(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old) => old ? {
          ...old,
          data: old.data.map(c => 
            c.id === variables.candidate_id 
              ? { ...c, disposition: "REJECTED" }
              : c
          ),
        } : old
      );
      
      return { previousData };
    },
    onSuccess: (_, variables) => {
      if (variables.session_id) {
        queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({ title: "Candidate rejected" });
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to reject", description: error.message, variant: "destructive" });
    },
  });
}

export function useRestoreCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { candidate_id: string }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Restore failed');
      return { success: true };
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      
      queryClient.setQueriesData<RawStrategyCandidatesResponse>(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old) => old ? {
          ...old,
          data: old.data.map(c => 
            c.id === variables.candidate_id 
              ? { ...c, disposition: "PENDING_REVIEW" }
              : c
          ),
        } : old
      );
      
      return { previousData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({ title: "Candidate restored to review" });
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to restore", description: error.message, variant: "destructive" });
    },
  });
}

export function useRecycleCandidate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { candidate_id: string }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/recycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Recycle failed');
      const data = await response.json();
      return data;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      
      queryClient.setQueriesData<RawStrategyCandidatesResponse>(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old) => old ? {
          ...old,
          data: old.data.filter(c => c.id !== variables.candidate_id),
        } : old
      );
      
      return { previousData };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({ title: "Strategy recycled", description: "Rejection context saved for future research improvements." });
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to recycle", description: error.message, variant: "destructive" });
    },
  });
}

export function useBulkDeleteCandidates() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { candidate_ids: string[] }) => {
      const response = await fetch('/api/strategy-lab/candidates/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ candidate_ids: params.candidate_ids }),
      });
      if (!response.ok) throw new Error('Bulk delete failed');
      return { success: true };
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      const idsToDelete = new Set(variables.candidate_ids);
      
      queryClient.setQueriesData<RawStrategyCandidatesResponse>(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old) => old ? {
          ...old,
          data: old.data.filter(c => !idsToDelete.has(c.id)),
        } : old
      );
      
      return { previousData };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({ title: `Deleted ${variables.candidate_ids.length} candidate(s)` });
    },
    onError: (error, _, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });
}

export function useSaveAsArchetype() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { candidate_id: string; name: string; category?: string; description?: string }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${params.candidate_id}/save-as-archetype`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          name: params.name, 
          category: params.category,
          description: params.description,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Save as archetype failed');
      }
      return await response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archetypes"] });
      toast({ title: "Archetype saved", description: data.message || "Strategy saved as archetype" });
    },
    onError: (error) => {
      toast({ title: "Failed to save archetype", description: error.message, variant: "destructive" });
    },
  });
}

export function computeCostStats(costs: StrategyLabCostEvent[] | undefined) {
  if (!costs || costs.length === 0) {
    return { totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, byProvider: {} as Record<string, { cost: number; calls: number }> };
  }

  const byProvider: Record<string, { cost: number; calls: number }> = {};
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (const c of costs) {
    totalCost += c.cost_usd || 0;
    totalTokensIn += c.tokens_in || 0;
    totalTokensOut += c.tokens_out || 0;
    
    if (!byProvider[c.provider]) {
      byProvider[c.provider] = { cost: 0, calls: 0 };
    }
    byProvider[c.provider].cost += c.cost_usd || 0;
    byProvider[c.provider].calls++;
  }

  return { totalCost, totalTokensIn, totalTokensOut, byProvider };
}

export { useStrategyLabSessions as useStrategyLabSessionsLegacy };

export interface StrategyLabArtifact {
  id: string;
  session_id: string;
  artifact_type: string;
  content_json: {
    prompt?: string;
    response?: string;
    routing?: {
      provider: string;
      model: string;
      reason: string;
      fallback_used: boolean;
      fallback_reason?: string;
    };
    usage?: {
      input_tokens: number;
      output_tokens: number;
      latency_ms: number;
      estimated_cost_usd: number;
    };
  };
  ai_model_used: string | null;
  created_at: string;
}

export interface StrategyLabUsage {
  id: string;
  session_id: string;
  task_type: string;
  provider: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  fallback_used: boolean;
  fallback_reason: string | null;
  created_at: string;
}

export function useCreateSessionLegacy() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      research_topic?: string;
      target_archetype?: string;
    }) => {
      const response = await fetch('/api/strategy-lab/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: "create_session", ...params }),
      });
      if (!response.ok) throw new Error('Failed to create session');
      const json = await response.json();
      return json.data as StrategyLabSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-sessions"] });
      toast({ title: "Session created", description: "New strategy lab session started" });
    },
    onError: (error) => {
      toast({ title: "Failed to create session", description: error.message, variant: "destructive" });
    },
  });
}

export function useRunPhase() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      session_id: string;
      phase: "RESEARCH" | "SYNTHESIS" | "CRITIQUE" | "MUTATION";
      user_prompt: string;
      previous_context?: string;
    }) => {
      const response = await fetch(`/api/strategy-lab/sessions/${params.session_id}/phase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(params),
      });
      if (!response.ok) throw new Error('Phase failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", variables.session_id] });
      toast({ title: `${variables.phase} complete`, description: "AI analysis finished" });
    },
    onError: (error) => {
      toast({ title: "Phase failed", description: error.message, variant: "destructive" });
    },
  });
}

export function useCheckGates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch(`/api/strategy-lab/sessions/${sessionId}/gates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Gate check failed');
      const json = await response.json();
      return json.data;
    },
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["strategy-lab-session", sessionId] });
    },
  });
}

export function computeProviderStats(usage: StrategyLabUsage[] | undefined) {
  if (!usage || usage.length === 0) return { providers: [], totalCost: 0, totalCalls: 0 };

  const providerMap = new Map<string, { calls: number; cost: number; tasks: Set<string> }>();

  for (const u of usage) {
    const existing = providerMap.get(u.provider) || { calls: 0, cost: 0, tasks: new Set() };
    existing.calls++;
    existing.cost += u.cost_usd || 0;
    existing.tasks.add(u.task_type);
    providerMap.set(u.provider, existing);
  }

  const totalCalls = usage.length;
  const totalCost = usage.reduce((sum, u) => sum + (u.cost_usd || 0), 0);

  const providers = Array.from(providerMap.entries()).map(([name, stats]) => ({
    name,
    calls: stats.calls,
    cost: stats.cost,
    percentage: Math.round((stats.calls / totalCalls) * 100),
    tasks: Array.from(stats.tasks),
  }));

  return { providers, totalCost, totalCalls };
}

export type AdaptiveMode = "SCANNING" | "BALANCED" | "DEEP_RESEARCH";

export interface ResearchActivity {
  isActive: boolean;
  phase: "IDLE" | "INITIALIZING" | "RESEARCHING" | "SYNTHESIZING" | "EVALUATING" | "COMPLETE";
  provider: string | null;
  startedAt: string | null;
  message: string;
  candidatesFound: number;
  traceId: string | null;
}

export type AutoPromoteTier = "A" | "B" | "C" | "ANY";

export type PerplexityModel = "QUICK" | "BALANCED" | "DEEP";

export type SearchRecency = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface StrategyLabAutonomousState {
  isPlaying: boolean;
  currentDepth: "CONTINUOUS_SCAN" | "FOCUSED_BURST" | "FRONTIER_RESEARCH";
  adaptiveMode: AdaptiveMode;
  adaptiveIntervalMs: number;
  adaptiveReason: string;
  lastStateChange: string;
  pauseReason?: string;
  recentCandidatesCount: number;
  lastResearchCycleTime: number;
  triggeredResearch?: boolean;
  requireManualApproval?: boolean;
  autoPromoteThreshold?: number;
  autoPromoteTier?: AutoPromoteTier;
  researchActivity?: ResearchActivity;
  perplexityModel?: PerplexityModel;
  searchRecency?: SearchRecency;
  customFocus?: string;
  costEfficiencyMode?: boolean;
  // QC Verification settings
  qcDailyLimit?: number;
  qcWeeklyLimit?: number;
  qcAutoTriggerEnabled?: boolean;
  qcAutoTriggerThreshold?: number;
  qcAutoTriggerTier?: "A" | "B" | "AB";
  // Fast Track settings (skip TRIALS → PAPER if QC exceeds thresholds)
  fastTrackEnabled?: boolean;
  fastTrackMinTrades?: number;
  fastTrackMinSharpe?: number;
  fastTrackMinWinRate?: number;
  fastTrackMaxDrawdown?: number;
  // Trials auto-promotion settings (TRIALS → PAPER)
  trialsAutoPromoteEnabled?: boolean;
  trialsMinTrades?: number;
  trialsMinSharpe?: number;
  trialsMinWinRate?: number;
  trialsMaxDrawdown?: number;
  // Research interval override (0=adaptive, 15/30/60 fixed minutes)
  researchIntervalOverrideMinutes?: number;
  // Fleet Governor settings (automated fleet size management)
  fleetGovernorEnabled?: boolean;
  fleetGovernorGlobalCap?: number;
  fleetGovernorTrialsCap?: number;
  fleetGovernorPaperCap?: number;
  fleetGovernorLiveCap?: number;
  fleetGovernorGracePeriodHours?: number;
  fleetGovernorMinObservationTrades?: number;
  fleetGovernorDemotionPolicy?: "ARCHIVE" | "RECYCLE";
}

export interface LinkedBotData {
  id: string;
  name: string;
  stage: string;
  status: string;
  symbol?: string;
  healthScore?: number;
  metrics?: {
    totalTrades?: number;
    winRate?: number;
    sharpeRatio?: number;
    maxDrawdownPct?: number;
    netPnl?: number;
  } | null;
  stageMetrics?: {
    trades?: number;
    winRate?: number;
    netPnl?: number;
    sharpeRatio?: number;
    maxDrawdownPct?: number;
  } | null;
  createdAt?: string;
}

export interface StrategyCandidate {
  id: string;
  strategyName: string;
  archetypeName: string | null;
  hypothesis: string;
  confidenceScore: number;
  noveltyScore: number | null;
  confidenceBreakdownJson: Record<string, number> | null;
  disposition: "PENDING_REVIEW" | "QUEUED_FOR_QC" | "SENT_TO_LAB" | "QUEUED" | "REJECTED" | "MERGED" | "ARCHIVED";
  regimeTrigger: string | null;
  source?: "PERPLEXITY" | "LAB_FEEDBACK" | "MANUAL" | string;
  sourceLabBotId?: string | null;
  createdBotId?: string | null;
  lineageChain?: string[];
  recycledFromId?: string | null;
  rulesJson: {
    entry?: string;
    exit?: string;
    riskModel?: string;
  };
  explainersJson: {
    why?: string;
    differentiators?: string[];
    expectedBehavior?: {
      winRate?: string;
      tradeFrequency?: string;
      drawdownProfile?: string;
    };
    targetedInefficiency?: string;
    researchMemo?: string;
    regimeFit?: string;
    falsificationConditions?: string[];
  } | null;
  plainLanguageSummaryJson?: {
    what?: string;
    how?: string;
    when?: string;
  } | null;
  linkedBot?: LinkedBotData | null;
  sessionId?: string;
  createdAt: string;
  researchDepth?: "QUICK" | "BALANCED" | "DEEP";
  searchRecency?: "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";
  customFocusUsed?: string | null;
  isFavorite?: boolean;
  aiProvider?: string | null;
  createdByAi?: string | null;
  aiProviderBadge?: boolean | null;
  regimeAdjustment?: {
    originalScore: number;
    adjustedScore: number;
    regimeBonus: number;
    regimeMatch: "OPTIMAL" | "FAVORABLE" | "NEUTRAL" | "UNFAVORABLE";
    reason: string;
    currentRegime: string;
  } | null;
  qcVerification?: {
    status: string;
    badgeState: string | null;
    qcScore: number | null;
    finishedAt: string | null;
  } | null;
}

interface StrategyLabStateResponse {
  success: boolean;
  data: StrategyLabAutonomousState;
}

interface StrategyCandidatesResponse {
  success: boolean;
  data: StrategyCandidate[];
  count: number;
}

// Unified overview response for fast page load
export interface StrategyLabOverviewData extends StrategyLabAutonomousState {
  candidateCounts: {
    pendingReview: number;
    sentToLab: number;
    queued: number;
    rejected: number;
    total: number;
  };
  trialsBotsCount: number;
  researchStats: ResearchCycleStats[];
}

interface StrategyLabOverviewResponse {
  success: boolean;
  data: StrategyLabOverviewData;
}

interface ResearchCycleStats {
  cycleId: string;
  startedAt: string;
  completedAt?: string;
  candidatesGenerated: number;
  candidatesQueued: number;
  candidatesAutoPromoted: number;
  trigger: string;
  researchDepth: string;
}

// UNIFIED OVERVIEW HOOK - Single request for Strategy Lab page
// Replaces multiple separate calls for status, state, and counts
export function useStrategyLabOverview() {
  const { user } = useAuth();
  
  return useQuery<StrategyLabOverviewResponse, Error, StrategyLabOverviewData>({
    queryKey: ["/api/strategy-lab/overview", user?.id],
    queryFn: async (): Promise<StrategyLabOverviewResponse> => {
      // INSTITUTIONAL: Use session auth only - no user_id in query params
      const response = await fetch("/api/strategy-lab/overview", {
        credentials: "include",
      });
      if (!response.ok) {
        return { 
          success: false, 
          data: { 
            isPlaying: true, 
            recentCandidatesCount: 0, 
            currentDepth: "CONTINUOUS_SCAN", 
            adaptiveMode: "BALANCED",
            adaptiveIntervalMs: 2 * 60 * 60 * 1000,
            adaptiveReason: "Default balanced mode",
            lastStateChange: new Date().toISOString(),
            lastResearchCycleTime: 0,
            candidateCounts: { pendingReview: 0, sentToLab: 0, queued: 0, rejected: 0, total: 0 },
            trialsBotsCount: 0,
            researchStats: [],
          } 
        };
      }
      return response.json();
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      if (data?.researchActivity?.isActive) {
        return 1500;
      }
      return 10000;
    },
    select: (response) => response.data,
  });
}

export function useStrategyLabAutonomousState() {
  const { user } = useAuth();
  
  return useQuery<StrategyLabStateResponse, Error, StrategyLabAutonomousState>({
    queryKey: ["/api/strategy-lab/state", user?.id],
    queryFn: async (): Promise<StrategyLabStateResponse> => {
      // INSTITUTIONAL: Use session auth only - no user_id in query params
      const response = await fetch("/api/strategy-lab/state", {
        credentials: "include",
      });
      if (!response.ok) {
        return { 
          success: false, 
          data: { 
            isPlaying: true, 
            recentCandidatesCount: 0, 
            currentDepth: "CONTINUOUS_SCAN", 
            adaptiveMode: "BALANCED",
            adaptiveIntervalMs: 2 * 60 * 60 * 1000,
            adaptiveReason: "Default balanced mode",
            lastStateChange: new Date().toISOString(),
            lastResearchCycleTime: 0,
          } 
        };
      }
      return response.json();
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data?.data;
      if (data?.researchActivity?.isActive) {
        return 1500;
      }
      return 10000;
    },
    select: (response) => response.data,
  });
}

interface RawStrategyCandidate {
  id: string;
  strategy_name: string;
  archetype_name: string | null;
  hypothesis: string;
  confidence_score: number;
  novelty_score: number | null;
  confidence_breakdown_json: Record<string, number> | null;
  rules_json?: { entry?: string; exit?: string; riskModel?: string } | null;
  explainers_json?: {
    why?: string;
    differentiators?: string[];
    expectedBehavior?: { winRate?: string; tradeFrequency?: string; drawdownProfile?: string };
    targetedInefficiency?: string;
    researchMemo?: string;
    regimeFit?: string;
    falsificationConditions?: string[];
  } | null;
  evidence_json?: Record<string, unknown> | null;
  disposition: string;
  source?: string;
  regime_trigger: string | null;
  source_lab_bot_id?: string | null;
  created_bot_id?: string | null;
  lineage_chain?: string[] | null;
  recycled_from_id?: string | null;
  created_at: string;
  updated_at?: string;
  linkedBot?: {
    id: string;
    name: string;
    stage: string;
    status: string;
    symbol?: string;
    health_score?: number;
    metrics?: {
      total_trades?: number;
      win_rate?: number;
      sharpe_ratio?: number;
      max_drawdown_pct?: number;
      net_pnl?: number;
    } | null;
  } | null;
  research_depth?: string | null;
  search_recency?: string | null;
  custom_focus_used?: string | null;
  is_favorite?: boolean;
  regime_adjustment?: {
    original_score: number;
    adjusted_score: number;
    regime_bonus: number;
    regime_match: "OPTIMAL" | "FAVORABLE" | "NEUTRAL" | "UNFAVORABLE";
    reason: string;
    current_regime: string;
  } | null;
  ai_provider?: string | null;
  created_by_ai?: string | null;
  ai_provider_badge?: boolean | null;
  qcVerification?: {
    status: string;
    badgeState: string | null;
    qcScore: number | null;
    finishedAt: string | null;
  } | null;
}

function mapRawToCandidate(raw: RawStrategyCandidate): StrategyCandidate {
  const rulesJson = raw.rules_json || {};
  const explainersJson = raw.explainers_json || null;
  
  let linkedBot: LinkedBotData | null = null;
  if (raw.linkedBot) {
    const lb = raw.linkedBot as any;
    linkedBot = {
      id: lb.id,
      name: lb.name,
      stage: lb.stage,
      status: lb.status,
      symbol: lb.symbol,
      healthScore: lb.healthScore ?? lb.health_score,
      metrics: lb.metrics ? {
        totalTrades: lb.metrics.total_trades ?? lb.metrics.trades,
        winRate: lb.metrics.win_rate ?? lb.metrics.winRate,
        sharpeRatio: lb.metrics.sharpe_ratio ?? lb.metrics.sharpeRatio,
        maxDrawdownPct: lb.metrics.max_drawdown_pct ?? lb.metrics.maxDrawdownPct,
        netPnl: lb.metrics.net_pnl ?? lb.metrics.netPnl,
      } : null,
      stageMetrics: lb.stageMetrics ? {
        trades: lb.stageMetrics.trades,
        winRate: lb.stageMetrics.winRate,
        netPnl: lb.stageMetrics.netPnl,
        sharpeRatio: lb.stageMetrics.sharpeRatio,
        maxDrawdownPct: lb.stageMetrics.maxDrawdownPct,
      } : null,
      createdAt: lb.createdAt ?? lb.created_at,
    };
  }
  
  return {
    id: raw.id,
    strategyName: raw.strategy_name,
    archetypeName: raw.archetype_name,
    hypothesis: raw.hypothesis,
    confidenceScore: raw.confidence_score ?? 0,
    noveltyScore: raw.novelty_score ?? null,
    confidenceBreakdownJson: raw.confidence_breakdown_json,
    disposition: (raw.disposition as StrategyCandidate["disposition"]) || "PENDING_REVIEW",
    regimeTrigger: raw.regime_trigger,
    source: raw.source as StrategyCandidate["source"],
    sourceLabBotId: raw.source_lab_bot_id,
    createdBotId: raw.created_bot_id,
    lineageChain: raw.lineage_chain || undefined,
    recycledFromId: raw.recycled_from_id || null,
    rulesJson: {
      entry: rulesJson.entry,
      exit: rulesJson.exit,
      riskModel: rulesJson.riskModel,
    },
    explainersJson: explainersJson ? {
      why: explainersJson.why,
      differentiators: explainersJson.differentiators,
      expectedBehavior: explainersJson.expectedBehavior,
      targetedInefficiency: explainersJson.targetedInefficiency,
      researchMemo: explainersJson.researchMemo,
      regimeFit: explainersJson.regimeFit,
      falsificationConditions: explainersJson.falsificationConditions,
    } : null,
    linkedBot,
    sessionId: undefined,
    createdAt: raw.created_at,
    researchDepth: (raw.research_depth as StrategyCandidate["researchDepth"]) || undefined,
    searchRecency: (raw.search_recency as StrategyCandidate["searchRecency"]) || undefined,
    customFocusUsed: raw.custom_focus_used || null,
    isFavorite: raw.is_favorite ?? false,
    regimeAdjustment: raw.regime_adjustment ? {
      originalScore: raw.regime_adjustment.original_score,
      adjustedScore: raw.regime_adjustment.adjusted_score,
      regimeBonus: raw.regime_adjustment.regime_bonus,
      regimeMatch: raw.regime_adjustment.regime_match,
      reason: raw.regime_adjustment.reason,
      currentRegime: raw.regime_adjustment.current_regime,
    } : null,
    aiProvider: raw.ai_provider || null,
    createdByAi: raw.created_by_ai || null,
    aiProviderBadge: raw.ai_provider_badge ?? null,
    qcVerification: raw.qcVerification ? {
      status: raw.qcVerification.status,
      badgeState: raw.qcVerification.badgeState,
      qcScore: raw.qcVerification.qcScore,
      finishedAt: raw.qcVerification.finishedAt,
    } : null,
  };
}

interface RawStrategyCandidatesResponse {
  success: boolean;
  data: RawStrategyCandidate[];
  count: number;
  trialsBotsCount?: number;
}

export function useTrialsBotsCount() {
  return useQuery<{ count: number }>({
    queryKey: ["/api/bots/trials-count"],
    queryFn: async () => {
      const response = await fetch("/api/strategy-lab/candidates?disposition=SENT_TO_LAB&limit=1", {
        credentials: "include",
      });
      if (!response.ok) return { count: 0 };
      const data = await response.json();
      return { count: data.trialsBotsCount ?? 0 };
    },
    refetchInterval: 30000,
  });
}

export function useStrategyCandidates(limit: number = 20) {
  return useQuery<RawStrategyCandidatesResponse, Error, StrategyCandidate[]>({
    queryKey: ["/api/strategy-lab/candidates", limit],
    queryFn: async (): Promise<RawStrategyCandidatesResponse> => {
      const response = await fetch(`/api/strategy-lab/candidates?limit=${limit}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return { success: false, data: [], count: 0 };
      }
      return response.json();
    },
    refetchInterval: 30000,
    select: (response) => response.data.map(mapRawToCandidate),
  });
}

export type CandidateDisposition = "PENDING_REVIEW" | "SENT_TO_LAB" | "QUEUED" | "QUEUED_FOR_QC" | "REJECTED" | "MERGED" | "EXPIRED";

export function useStrategyCandidatesByDisposition(
  disposition: CandidateDisposition,
  options?: { limit?: number; includeBots?: boolean }
) {
  const limit = options?.limit ?? 20;
  const includeBots = options?.includeBots ?? false;
  
  return useQuery<RawStrategyCandidatesResponse, Error, StrategyCandidate[]>({
    queryKey: ["/api/strategy-lab/candidates", disposition, limit, includeBots],
    queryFn: async (): Promise<RawStrategyCandidatesResponse> => {
      const params = new URLSearchParams({
        disposition,
        limit: String(limit),
      });
      if (includeBots) {
        params.set("include_bots", "true");
      }
      
      const response = await fetch(`/api/strategy-lab/candidates?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        return { success: false, data: [], count: 0 };
      }
      return response.json();
    },
    refetchInterval: disposition === "SENT_TO_LAB" ? 15000 : 30000,
    select: (response) => response.data.map(mapRawToCandidate),
  });
}

export type ResearchDepth = "CONTINUOUS_SCAN" | "FOCUSED_BURST" | "FRONTIER_RESEARCH";

interface StrategyLabStateUpdate {
  isPlaying?: boolean;
  pauseReason?: string;
  depth?: ResearchDepth;
  requireManualApproval?: boolean;
  autoPromoteThreshold?: number;
  autoPromoteTier?: AutoPromoteTier;
  perplexityModel?: PerplexityModel;
  searchRecency?: SearchRecency;
  customFocus?: string;
  costEfficiencyMode?: boolean;
  // QC Verification settings
  qcDailyLimit?: number;
  qcWeeklyLimit?: number;
  qcAutoTriggerEnabled?: boolean;
  qcAutoTriggerThreshold?: number;
  qcAutoTriggerTier?: "A" | "B" | "AB";
  // Fast Track settings (skip TRIALS → PAPER if QC exceeds thresholds)
  fastTrackEnabled?: boolean;
  fastTrackMinTrades?: number;
  fastTrackMinSharpe?: number;
  fastTrackMinWinRate?: number;
  fastTrackMaxDrawdown?: number;
  // Trials auto-promotion settings (TRIALS → PAPER)
  trialsAutoPromoteEnabled?: boolean;
  trialsMinTrades?: number;
  trialsMinSharpe?: number;
  trialsMinWinRate?: number;
  trialsMaxDrawdown?: number;
}

export function useToggleStrategyLabState() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const getDefaultState = () => ({
    success: true,
    data: {
      isPlaying: false,
      requireManualApproval: true,
      lastResearchAt: null,
      grokEnabled: false,
    },
  });

  return useMutation({
    mutationFn: async (update: boolean | StrategyLabStateUpdate) => {
      const baseBody = typeof update === "boolean" ? { isPlaying: update } : update;
      const body = { ...baseBody, user_id: user?.id };
      const response = await fetch("/api/strategy-lab/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("Failed to update state");
      const json = await response.json();
      return json.data;
    },
    onMutate: async (update) => {
      const userId = user?.id;
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/state", userId] });
      const previousState = queryClient.getQueryData(["/api/strategy-lab/state", userId]);
      
      const updateObj = typeof update === "boolean" ? { isPlaying: update } : update;
      const currentState = previousState as { success: boolean; data: Record<string, unknown> } | undefined;
      const baseState = currentState ? JSON.parse(JSON.stringify(currentState)) : getDefaultState();
      
      queryClient.setQueryData(["/api/strategy-lab/state", userId], {
        success: true,
        data: { ...baseState.data, ...updateObj },
      });
      
      return { previousState, userId };
    },
    onSuccess: (data, variables, context) => {
      const userId = context?.userId || user?.id;
      queryClient.setQueryData(["/api/strategy-lab/state", userId], { success: true, data });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qc/budget"] });
      const isPlayingUpdate = typeof variables === "boolean" || (typeof variables === "object" && "isPlaying" in variables);
      if (isPlayingUpdate) {
        toast({
          title: data.isPlaying ? "Strategy Lab Running" : "Strategy Lab Paused",
          description: data.isPlaying 
            ? data.triggeredResearch ? "Research cycle started" : "Autonomous research is active" 
            : "Background research paused",
          duration: 3000,
        });
      }
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previousState !== undefined && context?.userId) {
        queryClient.setQueryData(["/api/strategy-lab/state", context.userId], context.previousState);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/state"] });
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useSetResearchDepth() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const depthLabels: Record<ResearchDepth, string> = {
    CONTINUOUS_SCAN: "Continuous Scan",
    FOCUSED_BURST: "Focused Burst", 
    FRONTIER_RESEARCH: "Frontier Research",
  };

  return useMutation({
    mutationFn: async (depth: ResearchDepth) => {
      const response = await fetch("/api/strategy-lab/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ depth, user_id: user?.id }),
      });
      if (!response.ok) throw new Error("Failed to change depth");
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({
        title: "Research Depth Changed",
        description: `Now using ${depthLabels[data.currentDepth as ResearchDepth] || data.currentDepth}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useToggleManualApproval() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (requireManualApproval: boolean) => {
      const response = await fetch("/api/strategy-lab/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ requireManualApproval, user_id: user?.id }),
      });
      if (!response.ok) throw new Error("Failed to toggle manual approval");
      const json = await response.json();
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/overview"] });
      toast({
        title: data.requireManualApproval ? "Manual Approval Required" : "Auto-Approval Enabled",
        description: data.requireManualApproval 
          ? "All candidates will require manual review before LAB promotion" 
          : "High-confidence candidates will auto-promote to LAB",
        duration: 3000,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

export function useFavoriteCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ candidateId, isFavorite }: { candidateId: string; isFavorite: boolean }) => {
      const response = await fetch(`/api/strategy-lab/candidates/${candidateId}/favorite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isFavorite }),
      });
      if (!response.ok) throw new Error("Failed to toggle favorite");
      return response.json();
    },
    onMutate: async ({ candidateId, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/strategy-lab/candidates"] });
      
      const previousData = queryClient.getQueriesData({ queryKey: ["/api/strategy-lab/candidates"] });
      
      queryClient.setQueriesData(
        { queryKey: ["/api/strategy-lab/candidates"] },
        (old: any) => {
          if (!old?.data) return old;
          return {
            ...old,
            data: old.data.map((c: any) => 
              c.id === candidateId ? { ...c, is_favorite: isFavorite } : c
            ),
          };
        }
      );
      
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
    },
  });
}
