/**
 * Bot details hooks
 * MIGRATED: Supabase → Express API
 * FAIL-CLOSED: Returns explicit degraded state on failure, never zeroed metrics
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface TradeLog {
  id: string;
  botId: string;
  botInstanceId: string | null;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  isOpen: boolean;
  entryTime: string;
  exitTime: string | null;
  sourceType: string;
  isInvalid: boolean;
}

export interface Signal {
  id: string;
  botInstanceId: string;
  symbol: string;
  direction: string;
  confidence: number;
  createdAt: string;
}

export interface BiasFeedEvent {
  id: string;
  botId: string;
  eventType: string;
  payload: Record<string, any>;
  createdAt: string;
}

interface PerformanceSummary {
  totalPnl: number;
  todayPnl: number;
  winRate: number | null;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  totalTrades: number;
  expectancy: number | null;
}

interface EquityCurvePoint {
  date: string;
  equity: number;
  pnl: number;
}

export interface PerformanceResult {
  data: PerformanceSummary | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

export interface TradesResult {
  data: TradeLog[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

export interface EquityCurveResult {
  data: EquityCurvePoint[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

export interface PositionsResult {
  data: any[] | null;
  degraded: boolean;
  error_code: string | null;
  message: string | null;
  trace_id: string;
}

/**
 * Fetch bot performance summary
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure, NOT zeroed metrics
 */
export function useBotPerformance(
  botId: string | undefined,
  options?: {
    mode?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_performance", botId, options],
    queryFn: async (): Promise<PerformanceResult> => {
      const traceId = `perf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const response = await fetch(`/api/bots/${botId}/performance`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[useBotPerformance] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch performance (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success || !data.data) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: "API returned error or no data",
            trace_id: traceId,
          };
        }

        return {
          data: data.data as PerformanceSummary,
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useBotPerformance] Request failed:", err);
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
 * Fetch bot equity curve
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useBotEquityCurve(
  botId: string | undefined,
  options?: {
    mode?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
  }
) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_equity_curve", botId, options],
    queryFn: async (): Promise<EquityCurveResult> => {
      const traceId = `ec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const response = await fetch(`/api/bots/${botId}/equity-curve`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[useBotEquityCurve] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch equity curve (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: "API returned error",
            trace_id: traceId,
          };
        }

        return {
          data: (data.data || []) as EquityCurvePoint[],
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useBotEquityCurve] Request failed:", err);
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
 * Fetch bot instances
 * FAIL-CLOSED: Throws on error (React Query handles retry/error state)
 */
export function useBotInstances(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_instances_detail", botId],
    queryFn: async () => {
      if (!botId) {
        throw new Error("Bot ID required");
      }

      const response = await fetch(`/api/bot-instances?bot_id=${botId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch bot instances');
      }

      return data.data || [];
    },
    enabled: !!user && !!botId,
  });
}

/**
 * Fetch bot open positions
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure (critical for risk)
 */
export function useBotOpenPositions(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_open_positions", botId],
    queryFn: async (): Promise<PositionsResult> => {
      const traceId = `pos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const response = await fetch(`/api/bots/${botId}/open-positions`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[useBotOpenPositions] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch positions (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: "API returned error",
            trace_id: traceId,
          };
        }

        return {
          data: data.data || [],
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useBotOpenPositions] Request failed:", err);
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
    refetchInterval: 5000,
  });
}

/**
 * Fetch bot recent trades
 * FAIL-CLOSED: Returns { data: null, degraded: true } on failure
 */
export function useBotRecentTrades(
  botId: string | undefined,
  options?: {
    mode?: string;
    accountId?: string;
    limit?: number;
  }
) {
  const { user } = useAuth();
  const limit = options?.limit || 20;

  return useQuery({
    queryKey: ["bot_recent_trades", botId, options],
    queryFn: async (): Promise<TradesResult> => {
      const traceId = `trades-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

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
        const response = await fetch(`/api/bots/${botId}/trades?limit=${limit}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.error("[useBotRecentTrades] HTTP error:", response.status);
          return {
            data: null,
            degraded: true,
            error_code: `HTTP_${response.status}`,
            message: `Failed to fetch trades (HTTP ${response.status})`,
            trace_id: traceId,
          };
        }

        const data = await response.json();

        if (!data.success) {
          return {
            data: null,
            degraded: true,
            error_code: data.error || "API_ERROR",
            message: "API returned error",
            trace_id: traceId,
          };
        }

        return {
          data: (data.data || []) as TradeLog[],
          degraded: false,
          error_code: null,
          message: null,
          trace_id: traceId,
        };
      } catch (err) {
        console.error("[useBotRecentTrades] Request failed:", err);
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
 * Fetch bot signals
 * Returns empty array on failure (non-critical data)
 */
export function useBotSignals(botId: string | undefined, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_signals", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      try {
        const response = await fetch(`/api/bots/${botId}/signals?limit=${limit}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.warn("[useBotSignals] HTTP error:", response.status);
          return [];
        }

        const data = await response.json();

        if (!data.success) {
          return [];
        }

        return data.data || [];
      } catch (err) {
        console.warn("[useBotSignals] Request failed:", err);
        return [];
      }
    },
    enabled: !!user && !!botId,
  });
}

/**
 * Fetch bot bias feed
 * Returns empty array on failure (non-critical data)
 */
export function useBotBiasFeed(botId: string | undefined, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_bias_feed", botId, limit],
    queryFn: async () => {
      if (!botId) return [];

      try {
        const response = await fetch(`/api/bots/${botId}/bias-feed?limit=${limit}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          console.warn("[useBotBiasFeed] HTTP error:", response.status);
          return [];
        }

        const data = await response.json();

        if (!data.success) {
          return [];
        }

        return data.data || [];
      } catch (err) {
        console.warn("[useBotBiasFeed] Request failed:", err);
        return [];
      }
    },
    enabled: !!user && !!botId,
  });
}

/**
 * Helper functions to check degraded state
 */
export function isPerformanceDegraded(result: PerformanceResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

export function isTradesDegraded(result: TradesResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

export function isPositionsDegraded(result: PositionsResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}

export function isEquityCurveDegraded(result: EquityCurveResult | undefined): boolean {
  return !result || result.degraded || result.data === null;
}
