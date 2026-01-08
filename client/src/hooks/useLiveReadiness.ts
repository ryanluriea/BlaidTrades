/**
 * Live readiness hook
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns ready=false, degraded=true on any error
 * CONTRACT: { data: LiveReadinessData | null, degraded, error_code, message, trace_id }
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeHealthFromIntegrations,
  type ComputedHealth,
  type IntegrationRow,
  type HealthBlocker,
  type ComponentHealthResult,
} from "@/lib/healthComputation";

export type { HealthBlocker as Blocker };
export type ComponentHealth = ComponentHealthResult;

export interface LiveReadinessData {
  liveReady: boolean;
  canaryReady: boolean;
  overallStatus: "OK" | "WARN" | "BLOCKED";
  blockers: HealthBlocker[];
  componentHealth: ComponentHealthResult[];
  timestamp: string;
}

export interface LiveReadinessResult {
  data: LiveReadinessData | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

/**
 * Hook to compute live readiness using the shared canonical computation
 * FAIL-CLOSED: Returns { data: null, degraded: true } on any error
 * UI MUST check result.degraded before accessing result.data
 */
export function useLiveReadiness() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["live-readiness", user?.id],
    queryFn: async (): Promise<LiveReadinessResult> => {
      const traceId = `lr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
        };
      }

      try {
        // Use SYSTEM integrations status (not user integrations)
        // /api/integrations/status returns registry-based integration status
        // This shows whether databento, ironbeam, etc. are configured/connected system-wide
        const [integrationsRes, botsRes] = await Promise.all([
          fetch(`/api/integrations/status`, { credentials: 'include' }),
          fetch(`/api/bots?user_id=${user.id}`, { credentials: 'include' }),
        ]);

        // FAIL-CLOSED: If either endpoint fails, return null data + degraded
        if (!integrationsRes.ok || !botsRes.ok) {
          console.error("[useLiveReadiness] Endpoint failure:", {
            integrations: integrationsRes.status,
            bots: botsRes.status,
          });
          return {
            data: null,
            degraded: true,
            error_code: "ENDPOINT_FAILURE",
            message: `Failed to fetch readiness data (integrations: ${integrationsRes.status}, bots: ${botsRes.status})`,
            trace_id: traceId,
          };
        }

        const integrationsData = await integrationsRes.json();
        const botsData = await botsRes.json();

        // FAIL-CLOSED: If API returns error, return null data + degraded
        if (!integrationsData.success || !botsData.success) {
          return {
            data: null,
            degraded: true,
            error_code: "API_ERROR",
            message: "API returned error status",
            trace_id: traceId,
          };
        }

        // Map from /api/integrations/status format to IntegrationRow format
        // /api/integrations/status returns: { category: "data"|"broker", connected, configured, ... }
        // computeHealthFromIntegrations expects: { kind: "MARKET_DATA"|"BROKER", status, ... }
        const systemIntegrations = integrationsData.data?.integrations || [];
        const bots = botsData.data || [];

        const hasLiveBots = bots.some((b: any) => b.stage === "LIVE");
        const hasCanaryBots = bots.some((b: any) => b.stage === "CANARY");
        const degradedBots = bots.filter((b: any) => b.healthState === "DEGRADED");

        // Category to kind mapping: data → MARKET_DATA, broker → BROKER
        const categoryToKind = (category: string): string => {
          if (category === "data") return "MARKET_DATA";
          if (category === "broker") return "BROKER";
          if (category === "ai") return "AI";
          return category.toUpperCase();
        };

        // Map connected/configured/degraded to status
        const deriveStatus = (i: any): string => {
          if (!i.configured) return "DISABLED";
          if (i.connected) return "CONNECTED";
          if (i.degraded) return "DEGRADED";
          if (i.error_code) return "ERROR";
          return "UNVERIFIED";
        };

        const mappedIntegrations: IntegrationRow[] = systemIntegrations.map((i: any) => ({
          id: i.provider,
          kind: categoryToKind(i.category),
          provider: i.provider,
          label: i.displayName || i.provider,
          status: deriveStatus(i),
          is_enabled: i.configured,
          is_primary: i.provider === "databento" || i.provider === "ironbeam" || i.provider === "groq" || i.provider === "openai",
          last_verified_at: i.last_verified_at,
          last_success_at: i.last_used_at,
          last_error_at: i.error_code ? new Date().toISOString() : null,
          last_error_message: i.message !== "Connected" ? i.message : null,
          last_latency_ms: null,
        }));

        const health = computeHealthFromIntegrations(mappedIntegrations, {
          hasLiveBots,
          hasCanaryBots,
          degradedBotCount: degradedBots.length,
          criticalAlertCount: 0,
          lastAuditStatus: null,
        });

        const overallStatus: "OK" | "WARN" | "BLOCKED" =
          health.overall === "GREEN" ? "OK" : health.overall === "YELLOW" ? "WARN" : "BLOCKED";

        return {
          data: {
            liveReady: health.live_ready,
            canaryReady: health.canary_ready,
            overallStatus,
            blockers: health.blockers,
            componentHealth: health.components,
            timestamp: health.timestamp,
          },
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useLiveReadiness] Request failed:", err);
        // FAIL-CLOSED: Any error = null data + degraded
        return {
          data: null,
          degraded: true,
          error_code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
        };
      }
    },
    enabled: !!user,
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

/**
 * Helper to check if live readiness data is degraded
 * Returns true if result is undefined, degraded, or data is null
 */
export function isLiveReadinessDegraded(result: LiveReadinessResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

/**
 * Helper to safely access live readiness data
 * Returns null if degraded, forcing caller to handle the error state
 */
export function getLiveReadinessData(result: LiveReadinessResult | undefined): LiveReadinessData | null {
  if (isLiveReadinessDegraded(result)) {
    return null;
  }
  return result!.data;
}

export { computeHealthFromIntegrations } from "@/lib/healthComputation";
