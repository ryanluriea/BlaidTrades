/**
 * Promotion evaluations hook
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns explicit degraded state on failure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface PromotionEvaluation {
  id: string;
  createdAt: string;
  botId: string;
  fromStage: string;
  toStage: string;
  progressPercent: number;
  gatesJson: Record<string, {
    value: number | string | boolean | null;
    required: number | string | boolean;
    pass: boolean;
    score: number;
    label: string;
  }>;
  recommendation: "PROMOTE" | "HOLD" | "BLOCKED";
  blockedReasonCodes: string[];
  evaluatedAt: string;
  userId: string;
}

export interface UpsertPromotionEvaluationInput {
  botId: string;
  fromStage: string;
  toStage: string;
  progressPercent: number;
  gatesJson: PromotionEvaluation["gatesJson"];
  recommendation: "PROMOTE" | "HOLD" | "BLOCKED";
  blockedReasonCodes?: string[];
}

export interface PromotionEvalResult {
  data: PromotionEvaluation | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

export interface PromotionEvalsMapResult {
  data: Map<string, PromotionEvaluation> | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
  partialFailures: string[];
}

export interface PromotionReadyBot extends PromotionEvaluation {
  bots: { id: string; name: string; stage: string; healthState: string } | null;
}

export interface PromotionReadyBotsResult {
  data: PromotionReadyBot[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

/**
 * Fetch the latest promotion evaluation for a bot
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function usePromotionEvaluation(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["promotion_evaluation", botId],
    queryFn: async (): Promise<PromotionEvalResult> => {
      const traceId = `pe-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
        };
      }

      if (!botId) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_BOT_ID",
          message: "Bot ID required",
          trace_id: traceId,
        };
      }

      try {
        const response = await fetch(`/api/bots/${botId}/promotion-evaluation`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[usePromotionEvaluation] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch promotion evaluation (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: data.message || "API returned error",
            trace_id: traceId,
          };
        }

        return {
          data: data.data as PromotionEvaluation | null,
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[usePromotionEvaluation] Request failed:", err);
        return {
          data: null,
          degraded: true,
          error_code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
        };
      }
    },
    enabled: !!user && !!botId,
  });
}

/**
 * Fetch promotion evaluations for multiple bots
 * FAIL-CLOSED: Returns { data: null, degraded: true } if ALL fetches fail
 */
export function usePromotionEvaluations(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["promotion_evaluations", botIds],
    queryFn: async (): Promise<PromotionEvalsMapResult> => {
      const traceId = `pes-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (!user) {
        return {
          data: null,
          degraded: true,
          error_code: "NO_USER",
          message: "User authentication required",
          trace_id: traceId,
          partialFailures: [],
        };
      }

      if (botIds.length === 0) {
        return {
          data: new Map<string, PromotionEvaluation>(),
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
          partialFailures: [],
        };
      }

      try {
        const results = await Promise.all(
          botIds.map(id =>
            fetch(`/api/bots/${id}/promotion-evaluation`, { credentials: 'include' })
              .then(async r => {
                if (!r.ok) {
                  return { botId: id, success: false, error: `HTTP_${r.status}` };
                }
                const data = await r.json();
                return { botId: id, ...data };
              })
              .catch(err => ({ botId: id, success: false, error: err.message }))
          )
        );

        const map = new Map<string, PromotionEvaluation>();
        const partialFailures: string[] = [];
        let successCount = 0;

        results.forEach((result) => {
          if (result.success && result.data) {
            map.set(result.botId, result.data);
            successCount++;
          } else {
            partialFailures.push(result.botId);
          }
        });

        // If ALL failed, return degraded
        if (successCount === 0 && botIds.length > 0) {
          return {
            data: null,
            degraded: true,
            error_code: "ALL_FETCHES_FAILED",
            message: "Failed to fetch any promotion evaluations",
            trace_id: traceId,
            partialFailures,
          };
        }

        return {
          data: map,
          degraded: partialFailures.length > 0,
          error_code: partialFailures.length > 0 ? "PARTIAL_FAILURE" : null,
          message: partialFailures.length > 0 ? `${partialFailures.length} of ${botIds.length} fetches failed` : null,
          trace_id: traceId,
          partialFailures,
        };
      } catch (err) {
        console.error("[usePromotionEvaluations] Request failed:", err);
        return {
          data: null,
          degraded: true,
          error_code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Request failed",
          trace_id: traceId,
          partialFailures: botIds,
        };
      }
    },
    enabled: !!user && botIds.length > 0,
  });
}

/**
 * Upsert a promotion evaluation (create or update)
 */
export function useUpsertPromotionEvaluation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: UpsertPromotionEvaluationInput) => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/bots/${input.botId}/promotion-evaluation`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          blockedReasonCodes: input.blockedReasonCodes ?? [],
          evaluatedAt: new Date().toISOString(),
          userId: user.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to upsert promotion evaluation');
      }

      const data = await response.json();
      return data.data as PromotionEvaluation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["promotion_evaluation", data.botId] });
      queryClient.invalidateQueries({ queryKey: ["promotion_evaluations"] });
    },
  });
}

/**
 * Get promotion-ready bots (>= 90% progress)
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function usePromotionReadyBots() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["promotion_ready_bots"],
    queryFn: async (): Promise<PromotionReadyBotsResult> => {
      const traceId = `prb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const botsRes = await fetch('/api/bots', { credentials: 'include' });

        if (!botsRes.ok) {
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${botsRes.status}`,
            message: `Failed to fetch bots (HTTP ${botsRes.status})`,
            trace_id: traceId,
          };
        }

        const botsData = await botsRes.json();

        if (!botsData.success) {
          return {
            data: null,
            degraded: true,
            error_code: "API_ERROR",
            message: "API returned error",
            trace_id: traceId,
          };
        }

        const bots = botsData.data || [];

        const results = await Promise.all(
          bots.map((bot: any) =>
            fetch(`/api/bots/${bot.id}/promotion-evaluation`, { credentials: 'include' })
              .then(async r => {
                if (!r.ok) return null;
                const data = await r.json();
                return data.success ? { ...data.data, bot } : null;
              })
              .catch(() => null)
          )
        );

        const readyBots: PromotionReadyBot[] = [];

        results.forEach((result, idx) => {
          if (result) {
            const eval_ = result as PromotionEvaluation;
            if (eval_.progressPercent >= 90 && eval_.recommendation === "PROMOTE") {
              readyBots.push({
                ...eval_,
                bots: {
                  id: bots[idx].id,
                  name: bots[idx].name,
                  stage: bots[idx].stage,
                  healthState: bots[idx].healthState,
                },
              });
            }
          }
        });

        return {
          data: readyBots.sort((a, b) => b.progressPercent - a.progressPercent),
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[usePromotionReadyBots] Request failed:", err);
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
  });
}

/**
 * Helper to check if promotion evaluation data is degraded
 */
export function isPromotionEvalDegraded(result: PromotionEvalResult | undefined): boolean {
  return !result || result.degraded;
}

/**
 * Helper to check if promotion evaluations map is degraded
 */
export function isPromotionEvalsDegraded(result: PromotionEvalsMapResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

/**
 * Helper to check if promotion ready bots data is degraded
 */
export function isPromotionReadyBotsDegraded(result: PromotionReadyBotsResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}
