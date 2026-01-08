/**
 * Candidate evaluation hook
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns explicit degraded state on failure
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface CandidateEval {
  id: string;
  botId: string;
  evaluatedAt: string;
  score: number;
  ranking: number | null;
  criteriaJson: Record<string, any>;
  status: string;
  notes: string | null;
}

export interface CandidateEvalResult {
  data: CandidateEval | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

export interface CandidateEvalsMapResult {
  data: Map<string, CandidateEval> | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
  partialFailures: string[];
}

/**
 * Fetch candidate evaluations for multiple bots (latest per bot)
 * FAIL-CLOSED: Returns { data: null, degraded: true } if ALL fetches fail
 * Partial failures are tracked in partialFailures array
 */
export function useCandidateEvaluations(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["candidate-evaluations", botIds.sort().join(",")],
    queryFn: async (): Promise<CandidateEvalsMapResult> => {
      const traceId = `ce-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
          data: new Map<string, CandidateEval>(),
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
            fetch(`/api/bots/${id}/candidate-eval`, { credentials: 'include' })
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

        const evalMap = new Map<string, CandidateEval>();
        const partialFailures: string[] = [];
        let successCount = 0;

        results.forEach((result) => {
          if (result.success && result.data) {
            evalMap.set(result.botId, result.data);
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
            message: "Failed to fetch any candidate evaluations",
            trace_id: traceId,
            partialFailures,
          };
        }

        return {
          data: evalMap,
          degraded: partialFailures.length > 0,
          error_code: partialFailures.length > 0 ? "PARTIAL_FAILURE" : null,
          message: partialFailures.length > 0 ? `${partialFailures.length} of ${botIds.length} fetches failed` : null,
          trace_id: traceId,
          partialFailures,
        };
      } catch (err) {
        console.error("[useCandidateEvaluations] Request failed:", err);
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
    staleTime: 60_000,
  });
}

/**
 * Fetch single bot candidate evaluation
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useBotCandidateEval(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["candidate-eval", botId],
    queryFn: async (): Promise<CandidateEvalResult> => {
      const traceId = `bce-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const response = await fetch(`/api/bots/${botId}/candidate-eval`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[useBotCandidateEval] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch candidate eval (HTTP ${response.status})`,
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
          data: data.data as CandidateEval | null,
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useBotCandidateEval] Request failed:", err);
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
    staleTime: 60_000,
  });
}

/**
 * Helper to check if candidate eval data is degraded
 */
export function isCandidateEvalDegraded(result: CandidateEvalResult | undefined): boolean {
  return !result || result.degraded;
}

/**
 * Helper to check if candidate evals map is degraded
 */
export function isCandidateEvalsDegraded(result: CandidateEvalsMapResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}
