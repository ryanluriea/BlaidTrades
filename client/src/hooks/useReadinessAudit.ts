import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type { ReadinessRun as SchemaReadinessRun } from "@shared/schema";

export interface ReadinessRun {
  id: string;
  score: number;
  runnerScore: number | null;
  jobQueueScore: number | null;
  dataIntegrityScore: number | null;
  evolutionScore: number | null;
  promotionScore: number | null;
  uiConsistencyScore: number | null;
  securityScore: number | null;
  metricsJson: any;
  failuresJson: any[];
  recommendedActions: any[];
  runType: string;
  createdAt: string;
}

export interface ReadinessFailure {
  code: string;
  severity: 'info' | 'warning' | 'error';
  count: number;
  examples?: string[];
}

export interface RecommendedAction {
  action_code: string;
  auto_fix_available: boolean;
  description: string;
}

function mapReadinessRun(r: SchemaReadinessRun): ReadinessRun {
  return {
    id: r.id,
    score: r.score,
    runnerScore: r.runnerScore ?? null,
    jobQueueScore: r.jobQueueScore ?? null,
    dataIntegrityScore: r.dataIntegrityScore ?? null,
    evolutionScore: r.evolutionScore ?? null,
    promotionScore: r.promotionScore ?? null,
    uiConsistencyScore: r.uiConsistencyScore ?? null,
    securityScore: r.securityScore ?? null,
    metricsJson: r.metricsJson,
    failuresJson: (r.failuresJson as any[]) || [],
    recommendedActions: (r.recommendedActions as any[]) || [],
    runType: r.runType || 'manual',
    createdAt: r.createdAt?.toISOString() || new Date().toISOString(),
  };
}

export function useLatestReadinessRun() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['readiness_run_latest', user?.id],
    queryFn: async (): Promise<ReadinessRun | null> => {
      const url = user?.id 
        ? `/api/readiness-runs/latest?user_id=${user.id}`
        : '/api/readiness-runs/latest';
      
      const response = await fetch(url, { credentials: "include" });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data ? mapReadinessRun(json.data) : null;
    },
    enabled: !!user,
  });
}

export function useReadinessHistory(limit = 7) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['readiness_history', user?.id, limit],
    queryFn: async () => {
      const url = user?.id 
        ? `/api/readiness-runs?user_id=${user.id}&limit=${limit}`
        : `/api/readiness-runs?limit=${limit}`;
      
      const response = await fetch(url, { credentials: "include" });

      if (!response.ok) return [];
      const json = await response.json();
      return (json.data || []).map((r: SchemaReadinessRun) => ({
        id: r.id,
        score: r.score,
        createdAt: r.createdAt,
        runType: r.runType,
      }));
    },
    enabled: !!user,
  });
}

export function useRunReadinessAudit() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/readiness-audit/run', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          user_id: user?.id,
          run_type: 'MANUAL' 
        }),
      });

      if (!response.ok) throw new Error("Failed to run readiness audit");
      const json = await response.json();
      return json.data ? mapReadinessRun(json.data) : null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readiness_run_latest'] });
      queryClient.invalidateQueries({ queryKey: ['readiness_history'] });
    },
  });
}

export function useAutoFixAction() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (actionCode: string) => {
      const response = await fetch('/api/readiness-audit/auto-fix', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ 
          user_id: user?.id,
          action_code: actionCode 
        }),
      });

      if (!response.ok) {
        return { success: false, message: "Auto-fix not implemented" };
      }
      return response.json().then(r => r.data || { success: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['readiness_run_latest'] });
    },
  });
}

export function useReadinessScore() {
  const { data: latestRun } = useLatestReadinessRun();
  
  return {
    overallScore: latestRun?.score ?? 0,
    runnerScore: latestRun?.runnerScore ?? 0,
    jobQueueScore: latestRun?.jobQueueScore ?? 0,
    dataIntegrityScore: latestRun?.dataIntegrityScore ?? 0,
    evolutionScore: latestRun?.evolutionScore ?? 0,
    promotionScore: latestRun?.promotionScore ?? 0,
    uiConsistencyScore: latestRun?.uiConsistencyScore ?? 0,
    securityScore: latestRun?.securityScore ?? 0,
    failures: latestRun?.failuresJson ?? [],
    recommendedActions: latestRun?.recommendedActions ?? [],
    lastRunAt: latestRun?.createdAt ?? null,
  };
}
