import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface TradeDecisionTrace {
  id: string;
  decision_id: string | null;
  bot_id: string;
  bot_instance_id: string | null;
  account_id: string | null;
  mode: string;
  stage: string;
  symbol: string;
  timestamp: string;
  routing_result: string;
  final_action: string;
  reason_codes: any;
  sources_used: any;
  risk_checks: Record<string, any>;
  arbiter_verdict: Record<string, any>;
  metrics: Record<string, any>;
  ai_usage_ids: string[];
  created_at: string;
}

export function useTradeDecisionTraces(botId: string | undefined, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade-decision-traces", botId, limit],
    queryFn: async (): Promise<TradeDecisionTrace[]> => {
      if (!user || !botId) return [];

      const response = await fetch(`/api/trade-decision-traces?bot_id=${botId}&limit=${limit}`, {
        credentials: "include",
      });

      if (!response.ok) return [];
      const json = await response.json();
      return json.data || [];
    },
    enabled: !!user && !!botId,
  });
}

export function useTradeDecisionTrace(traceId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade-decision-trace", traceId],
    queryFn: async (): Promise<TradeDecisionTrace | null> => {
      if (!user || !traceId) return null;

      const response = await fetch(`/api/trade-decision-traces/${traceId}`, {
        credentials: "include",
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!traceId,
  });
}

export function useDecisionTraceByDecisionId(decisionId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade-decision-trace-by-decision", decisionId],
    queryFn: async (): Promise<TradeDecisionTrace | null> => {
      if (!user || !decisionId) return null;

      const response = await fetch(`/api/trade-decision-traces/by-decision/${decisionId}`, {
        credentials: "include",
      });

      if (!response.ok) return null;
      const json = await response.json();
      return json.data || null;
    },
    enabled: !!user && !!decisionId,
  });
}
