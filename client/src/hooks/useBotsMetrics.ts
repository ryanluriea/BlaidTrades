import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";
import type { TrendDirection } from "./useBotsOverview";
export type { TrendDirection } from "./useBotsOverview";

/**
 * Normalized stage-correct metrics - use these for display, not raw backtest/live fields.
 * Backend computes these using shared/metricsPolicy.ts single source of truth.
 */
export interface StageMetrics {
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  maxDrawdownPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  pnl: number;
  source: 'BACKTEST' | 'LIVE' | 'NONE';
}

export interface BotMetrics {
  botId: string;
  pnl: number;
  trades: number;
  winRate: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  maxDrawdownPct: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  lastTradeAt: string | null;
  sharpeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  statisticallySignificant: boolean;
  backtestTrades: number;
  backtestWinRate: number | null;
  backtestPF: number | null;
  backtestMaxDD: number | null;
  backtestExpectancy: number | null;
  backtestSharpe: number | null;
  backtestSortino: number | null;
  backtestLastAt: string | null;
  backtestSharpeConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' | null;
  statsSource: 'BACKTEST' | 'PAPER' | 'NONE';
  // Timeframe-specific metrics provenance (industry standard)
  backtestTimeframe: string | null;
  backtestHorizon: string | null;
  // NORMALIZED STAGE METRICS - Frontend should use ONLY these for display
  stageMetrics?: StageMetrics;
}

interface MatrixAggregate {
  median_pf?: number;
  worst_pf?: number;
  best_pf?: number;
  worst_max_dd_pct?: number;
  trade_count_total?: number;
  consistency_score?: number;
  cells_with_data?: number;
  total_cells?: number;
}

export interface BotEnrichedData {
  botId: string;
  mode: string | null;
  generationNumber: number | null;
  latestGeneration: number | null;
  versionMajor: number;
  versionMinor: number;
  latestVersionMajor: number | null;
  latestVersionMinor: number | null;
  accountName: string | null;
  accountType: string | null;
  accountId: string | null;
  activityState: string | null;
  lastHeartbeat: string | null;
  healthScore: number | null;
  healthStatus: "OK" | "WARN" | "DEGRADED";
  healthReason: string | null;
  exposure: number;
  backtestCount: number;
  trend?: TrendDirection;
  trendDirection?: string | null;
  peakGeneration?: number | null;
  peakSharpe?: number | null;
  declineFromPeakPct?: number | null;
  isRevertCandidate?: boolean;
  latestWalkForwardStatus?: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  latestWalkForwardProgress?: number;
  latestWalkForwardTimeframes?: string[];
  latestWalkForwardCompletedCells?: number;
  latestWalkForwardTotalCells?: number;
  latestWalkForwardCurrentTimeframe?: string | null;
  alertCount?: number;
  matrixAggregate?: MatrixAggregate | null;
  accountTotalBlownCount?: number;
  accountConsecutiveBlownCount?: number;
}

export function useBotsMetrics(botIds: string[], timeFilter: string = "all") {
  const { user } = useAuth();
  const restOnline = useRestOnline();

  return useQuery({
    queryKey: ["bots_metrics", botIds, timeFilter, user?.id, restOnline],
    queryFn: async () => {
      if (!restOnline || !botIds.length) return new Map<string, BotMetrics>();

      const response = await fetch("/api/bots-metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ bot_ids: botIds, time_filter: timeFilter }),
      });

      if (!response.ok) throw new Error("Failed to fetch metrics");
      const json = await response.json();
      const data = json.data || {};

      const metricsMap = new Map<string, BotMetrics>();
      Object.entries(data).forEach(([botId, metrics]) => {
        metricsMap.set(botId, metrics as BotMetrics);
      });

      return metricsMap;
    },
    enabled: !!user && botIds.length > 0,
    staleTime: 30000,
    placeholderData: (prev) => prev,
  });
}

export function useBotsEnrichedData(botIds: string[]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bots_enriched", botIds, user?.id],
    queryFn: async () => {
      if (!botIds.length) return new Map<string, BotEnrichedData>();

      const response = await fetch("/api/bots-enriched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_ids: botIds }),
      });

      if (!response.ok) return new Map<string, BotEnrichedData>();
      const json = await response.json();
      const data = json.data || {};

      const dataMap = new Map<string, BotEnrichedData>();
      Object.entries(data).forEach(([botId, enriched]) => {
        dataMap.set(botId, enriched as BotEnrichedData);
      });

      return dataMap;
    },
    enabled: !!user && botIds.length > 0,
    staleTime: 10000,
    placeholderData: (prev) => prev,
  });
}
