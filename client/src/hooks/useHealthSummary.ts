import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeHealthFromIntegrations,
  type ComputedHealth,
  type IntegrationRow,
  type ComponentHealthResult,
  type HealthBlocker,
} from "@/lib/healthComputation";

export type HealthComponent = ComponentHealthResult;
export type HealthIssue = HealthBlocker;
export type { HealthBlocker };

export interface ProblemBot {
  id: string;
  name: string;
  stage: string;
  issue: string;
}

export interface HealthSummary extends ComputedHealth {
  top_issues: HealthBlocker[];
  problem_bots: ProblemBot[];
  live_trading_ready: boolean;
  live_blockers?: string[];
  updated_at: string;
  last_smoke_test_status?: string;
}

async function fetchHealthSummary(userId: string | undefined): Promise<HealthSummary> {
  if (!userId) {
    return {
      overall: "YELLOW",
      live_ready: false,
      canary_ready: false,
      blockers: [],
      components: [],
      timestamp: new Date().toISOString(),
      top_issues: [],
      problem_bots: [],
      live_trading_ready: false,
      updated_at: new Date().toISOString(),
    };
  }

  const response = await fetch(`/api/health-summary?user_id=${userId}`, {
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch health summary');
  }
  
  const result = await response.json();
  const data = result.data || {};
  
  const integrations = data.integrations || [];
  const bots = data.bots || [];
  // Normalize audit status - backend may return "PASSED"/"FAILED" or "PASS"/"FAIL"
  const rawAuditStatus = data.lastAudit?.status?.toUpperCase();
  const lastAuditStatus: "PASS" | "FAIL" | null = 
    (rawAuditStatus === "PASS" || rawAuditStatus === "PASSED") ? "PASS" : 
    (rawAuditStatus === "FAIL" || rawAuditStatus === "FAILED") ? "FAIL" : 
    null;

  const degradedBots = bots?.filter((b: any) => b.health_state === "DEGRADED" || b.healthState === "DEGRADED") || [];
  const problemBots: ProblemBot[] = degradedBots.map((bot: any) => ({
    id: bot.id,
    name: bot.name,
    stage: bot.stage,
    issue: "DEGRADED",
  }));

  const hasLiveBots = bots?.some((b: any) => b.stage === "LIVE") || false;
  const hasCanaryBots = bots?.some((b: any) => b.stage === "CANARY") || false;

  const mappedIntegrations: IntegrationRow[] = (integrations || []).map((i: any) => ({
    id: i.id,
    kind: i.kind,
    provider: i.provider,
    label: i.label,
    status: i.status,
    is_enabled: i.is_enabled ?? i.isEnabled,
    is_primary: i.is_primary ?? i.isPrimary,
    last_verified_at: i.last_verified_at ?? i.lastVerifiedAt,
    last_success_at: i.last_success_at ?? i.lastSuccessAt,
    last_error_at: i.last_error_at ?? i.lastErrorAt,
    last_error_message: i.last_error_message ?? i.lastErrorMessage,
    last_latency_ms: i.last_latency_ms ?? i.lastLatencyMs,
  }));

  const health = computeHealthFromIntegrations(mappedIntegrations, {
    hasLiveBots,
    hasCanaryBots,
    degradedBotCount: degradedBots.length,
    criticalAlertCount: Number(data.criticalAlertsCount || 0),
    lastAuditStatus,
  });

  const liveBlockers = health.blockers
    .filter((b) => b.severity === "CRITICAL" || b.severity === "ERROR")
    .map((b) => b.message);

  return {
    ...health,
    top_issues: health.blockers,
    problem_bots: problemBots,
    live_trading_ready: health.live_ready,
    live_blockers: liveBlockers.length > 0 ? liveBlockers : undefined,
    updated_at: health.timestamp,
  };
}

export function useHealthSummary() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["/api/health-summary", user?.id],
    queryFn: () => fetchHealthSummary(user?.id),
    enabled: !!user?.id,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: false,
  });
}
