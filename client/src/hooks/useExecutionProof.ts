/**
 * Execution proof hooks
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns degraded state on any error
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface OpenPosition {
  side: 'BUY' | 'SELL';
  quantity: number;
  average_entry_price: number;
  current_price: number | null;
  unrealized_pnl: number | null;
  stop_price: number | null;
  target_price: number | null;
  opened_at: string | null;
  entry_reason_code: string | null;
}

export interface ExecutionProof {
  bot_id: string;
  has_runner: boolean;
  last_tick_at: string | null;
  last_evaluation_at: string | null;
  last_bar_close: number | null;
  last_bar_time: string | null;
  last_signal_at: string | null;
  last_order_at: string | null;
  last_fill_at: string | null;
  activity_state: string | null;
  consecutive_failures: number;
  last_tick_error: string | null;
  warming_up: boolean;
  bar_count: number;
  bars_needed: number;
  open_position: OpenPosition | null;
  scanning_since: string | null;
  session_state: 'CLOSED' | 'OPEN' | null;
  is_sleeping: boolean;
  outside_session: boolean;
  latest_audit: {
    runner_status: string;
    decision_status: string;
    order_status: string;
    market_status: string;
    overall_status: string;
    checked_at: string;
  } | null;
}

export interface ExecutionProofResult {
  data: Record<string, ExecutionProof> | null;
  degraded: boolean;
  error_code?: string;
  message?: string;
  trace_id?: string;
}

function generateTraceId(): string {
  return `ep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function createDegradedResult(error_code: string, message: string): ExecutionProofResult {
  return {
    data: null,
    degraded: true,
    error_code,
    message,
    trace_id: generateTraceId(),
  };
}

function createSuccessResult(data: Record<string, ExecutionProof>): ExecutionProofResult {
  return {
    data,
    degraded: false,
  };
}

/**
 * Hook to fetch execution proof for bots - shows REAL execution state
 * FAIL-CLOSED: Returns { data: null, degraded: true } on any error
 */
export function useExecutionProof(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["execution-proof", botIds],
    queryFn: async (): Promise<ExecutionProofResult> => {
      if (!user) {
        return createDegradedResult("NO_USER", "User not authenticated");
      }
      
      if (!botIds || botIds.length === 0) {
        return createDegradedResult("MISSING_PARAM", "No bot IDs provided");
      }

      const validBotIds = botIds.filter(id => id && typeof id === 'string');
      if (validBotIds.length === 0) {
        return createDegradedResult("INVALID_PARAM", "No valid bot IDs provided");
      }

      const url = `/api/bots/execution-proof?bot_ids=${validBotIds.join(',')}`;
      
      try {
        const response = await fetch(url, { credentials: 'include' });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          return createDegradedResult(
            `HTTP_${response.status}`,
            errorData.error || `HTTP ${response.status}`
          );
        }

        const data = await response.json();

        if (!data.success) {
          return createDegradedResult(
            data.error_code || "API_ERROR",
            data.error || data.message || 'Failed to fetch execution proof'
          );
        }

        const proofs = data.data || {};
        const result: Record<string, ExecutionProof> = {};

        for (const botId of validBotIds) {
          const proof = proofs[botId];
          result[botId] = {
            bot_id: botId,
            has_runner: proof?.has_runner || false,
            last_tick_at: proof?.last_tick_at || null,
            last_evaluation_at: proof?.last_evaluation_at || null,
            last_bar_close: proof?.last_bar_close || null,
            last_bar_time: proof?.last_bar_time || null,
            last_signal_at: proof?.last_signal_at || null,
            last_order_at: proof?.last_order_at || null,
            last_fill_at: proof?.last_fill_at || null,
            activity_state: proof?.activity_state || null,
            consecutive_failures: proof?.consecutive_failures || 0,
            last_tick_error: proof?.last_tick_error || null,
            warming_up: proof?.warming_up ?? true,
            bar_count: proof?.bar_count || 0,
            bars_needed: proof?.bars_needed || 21,
            open_position: proof?.open_position || null,
            scanning_since: proof?.scanning_since || null,
            session_state: proof?.session_state || null,
            is_sleeping: proof?.is_sleeping ?? false,
            outside_session: proof?.outside_session ?? false,
            latest_audit: proof?.latest_audit || null,
          };
        }

        return createSuccessResult(result);
      } catch (error) {
        return createDegradedResult(
          "FETCH_ERROR",
          error instanceof Error ? error.message : "Network error"
        );
      }
    },
    enabled: !!user && botIds.length > 0,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

/**
 * Helper to check if execution proof is in degraded state
 */
export function isExecutionProofDegraded(result: ExecutionProofResult | undefined): boolean {
  return !result || result.degraded === true || result.data === null;
}

/**
 * Hook to fetch execution proof for a single bot
 */
export function useSingleBotExecutionProof(botId: string | undefined) {
  const result = useExecutionProof(botId ? [botId] : []);
  return {
    ...result,
    data: botId && result.data?.data ? result.data.data[botId] : undefined,
    degraded: result.data?.degraded ?? true,
    error_code: result.data?.error_code,
    message: result.data?.message,
  };
}
