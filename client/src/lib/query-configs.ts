import { UseQueryOptions } from "@tanstack/react-query";

/**
 * Query configurations for different refresh requirements
 * Trading platforms require real-time data freshness
 */

// Critical trading data - refresh every 15 seconds
export const TRADING_CRITICAL_CONFIG: Partial<UseQueryOptions> = {
  staleTime: 10 * 1000, // 10 seconds
  refetchInterval: 15 * 1000, // Poll every 15 seconds
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false, // Don't poll when tab is hidden
};

// Real-time data - refresh every 5 seconds (positions, P&L)
export const REALTIME_DATA_CONFIG: Partial<UseQueryOptions> = {
  staleTime: 3 * 1000, // 3 seconds
  refetchInterval: 5 * 1000, // Poll every 5 seconds
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
};

// Dashboard data - refresh every 30 seconds
export const DASHBOARD_CONFIG: Partial<UseQueryOptions> = {
  staleTime: 20 * 1000, // 20 seconds
  refetchInterval: 30 * 1000, // Poll every 30 seconds
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
};

// Health/Status data - refresh every 60 seconds
export const HEALTH_STATUS_CONFIG: Partial<UseQueryOptions> = {
  staleTime: 30 * 1000, // 30 seconds
  refetchInterval: 60 * 1000, // Poll every 60 seconds
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  refetchIntervalInBackground: false,
};

// Settings/Configuration - no auto-refresh, but refresh on focus
export const SETTINGS_CONFIG: Partial<UseQueryOptions> = {
  staleTime: 5 * 60 * 1000, // 5 minutes
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
};

// Query keys for cache invalidation
export const QUERY_KEYS = {
  bots: "/api/bots",
  botsOverview: "/api/bots-overview",
  botInstances: "/api/bot-instances",
  positions: "/api/positions",
  jobs: "/api/jobs",
  alerts: "/api/alerts",
  alertsCount: "/api/alerts/count",
  health: "/api/health",
  strategyLab: "/api/strategy-lab/state",
  systemPower: "/api/system/power",
  marketHours: "/api/market-hours",
  autonomyStatus: "/api/bots/autonomy-status",
  cloudBackupStatus: "/api/cloud-backup/status",
  integrationStatus: "/api/integrations/status",
  executionProof: "/api/bots/execution-proof",
  botDetail: (botId: string) => `/api/bots/${botId}` as const,
  botImprovementState: (botId: string) => `/api/bots/${botId}/improvement-state` as const,
} as const;

// Helper to get all query keys related to a specific bot
export function getBotRelatedKeys(botId: string): string[] {
  return [
    QUERY_KEYS.bots,
    QUERY_KEYS.botsOverview,
    QUERY_KEYS.botInstances,
    QUERY_KEYS.autonomyStatus,
    QUERY_KEYS.botDetail(botId),
    QUERY_KEYS.botImprovementState(botId),
  ];
}

// Helper to invalidate related queries after mutations
export function getRelatedQueryKeys(primaryKey: string): string[] {
  const relationships: Record<string, string[]> = {
    [QUERY_KEYS.bots]: [QUERY_KEYS.botsOverview, QUERY_KEYS.botInstances, QUERY_KEYS.autonomyStatus],
    [QUERY_KEYS.positions]: [QUERY_KEYS.bots, QUERY_KEYS.botsOverview],
    [QUERY_KEYS.alerts]: [QUERY_KEYS.alertsCount],
    [QUERY_KEYS.strategyLab]: [QUERY_KEYS.bots, QUERY_KEYS.botsOverview],
  };
  return relationships[primaryKey] || [];
}
