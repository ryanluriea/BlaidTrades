import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRestOnline } from "@/hooks/useRestOnline";
import type { TradeLog, BotInstance, BotGeneration, SystemEvent } from "@shared/schema";

export type { TradeLog, BotInstance, BotGeneration, SystemEvent };

export function useTradeLogs(accountId?: string, limit = 50) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["trade_logs", accountId, limit, user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const params = new URLSearchParams();
      params.set("user_id", user.id);
      params.set("limit", String(limit));
      params.set("exclude_invalid", "true");
      params.set("exclude_test", "true");
      if (accountId) params.set("bot_instance_id", accountId);
      
      const response = await fetch(`/api/trades?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch trade logs");
      const result = await response.json();
      return result.data as TradeLog[];
    },
    enabled: !!user,
  });
}

export function useBotInstances(botId?: string) {
  const { user } = useAuth();
  const restOnline = useRestOnline();

  return useQuery({
    queryKey: ["bot_instances", botId],
    queryFn: async () => {
      if (!restOnline) return [];

      const params = new URLSearchParams();
      if (botId) params.set("bot_id", botId);
      
      const response = await fetch(`/api/bot-instances?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch bot instances");
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user && restOnline,
  });
}

export function useBotGenerations(botId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bot_generations", botId],
    queryFn: async () => {
      if (!botId) return [];
      
      const response = await fetch(`/api/bot-generations/${botId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch bot generations");
      const result = await response.json();
      return result.data as BotGeneration[];
    },
    enabled: !!user && !!botId,
  });
}

export function useSignals(botInstanceId?: string, backtestSessionId?: string, limit = 50) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["signals", botInstanceId, backtestSessionId, limit],
    queryFn: async () => {
      return [];
    },
    enabled: !!user && (!!botInstanceId || !!backtestSessionId),
  });
}

export function useBiasFeedEvents(botId: string | undefined, limit = 20) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["bias_feed_events", botId, limit],
    queryFn: async () => {
      if (!botId) return [];
      return [];
    },
    enabled: !!user && !!botId,
  });
}

export function useSystemEvents(limit = 50) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["system_events", limit],
    queryFn: async () => {
      const response = await fetch(`/api/system-events?limit=${limit}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch system events");
      const result = await response.json();
      return result.data as SystemEvent[];
    },
    enabled: !!user,
  });
}

export function useAiOpsBriefings(limit = 10) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["ai_ops_briefings", limit],
    queryFn: async () => {
      return [];
    },
    enabled: !!user,
  });
}

export function useDataProviderStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["data_provider_status"],
    queryFn: async () => {
      return [];
    },
    enabled: !!user,
  });
}

export function useOpenPositions(accountId?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["open_positions", accountId, user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      
      const params = new URLSearchParams();
      params.set("user_id", user.id);
      if (accountId) params.set("account_id", accountId);
      
      const response = await fetch(`/api/trades/open?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch open positions");
      const result = await response.json();
      return result.data as TradeLog[];
    },
    enabled: !!user,
  });
}

export interface SystemAuditData {
  success: boolean;
  trace_id: string;
  timestamp: string;
  auditDurationMs: number;
  healthScore: number;
  healthStatus: 'HEALTHY' | 'NEEDS_ATTENTION' | 'CRITICAL';
  summary: {
    totalBots: number;
    botsWithIssues: number;
    staleBots: number;
    openPositions: number;
    runningJobs: number;
    queuedJobs: number;
  };
  metricsSource: {
    issues: {
      id: string;
      name: string;
      stage: string;
      symbol: string;
      paperTrades: number;
      backtests: number;
      sourceStatus: string;
      expectedSource: string;
      hasIssue: boolean;
    }[];
    allBots: {
      id: string;
      name: string;
      stage: string;
      symbol: string;
      paperTrades: number;
      backtests: number;
      sourceStatus: string;
      expectedSource: string;
      hasIssue: boolean;
    }[];
  };
  stageCompliance: Record<string, { correct: number; incorrect: number; noData: number }>;
  formulaParity: Record<string, { storage: string; backtest: string; match: boolean }>;
  dataFreshness: {
    staleCount: number;
    staleBots: { id: string; name: string; stage: string; isStale: boolean }[];
  };
  database: {
    totalBots: number;
    totalPaperTrades: number;
    totalBacktestSessions: number;
  };
  recommendations: string[];
}

export function useSystemAudit() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["system_audit"],
    queryFn: async () => {
      const response = await fetch('/api/system/audit', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch system audit");
      return await response.json() as SystemAuditData;
    },
    enabled: !!user,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });
}

export interface CodeHealthData {
  success: boolean;
  trace_id: string;
  timestamp: string;
  scanDurationMs: number;
  healthScore: number;
  healthStatus: 'EXCELLENT' | 'GOOD' | 'NEEDS_CLEANUP' | 'TECH_DEBT';
  counts: {
    todos: number;
    fixmes: number;
    debugLogs: number;
    deprecated: number;
    hacks: number;
  };
  totalIssues: number;
  issuesByType: {
    TODO: { file: string; line: number; type: string; content: string }[];
    FIXME: { file: string; line: number; type: string; content: string }[];
    DEBUG: { file: string; line: number; type: string; content: string }[];
    DEPRECATED: { file: string; line: number; type: string; content: string }[];
    HACK: { file: string; line: number; type: string; content: string }[];
  };
  fileStats: { file: string; issueCount: number }[];
}

export function useCodeHealth() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["code_health"],
    queryFn: async () => {
      const response = await fetch('/api/system/code-health', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch code health");
      return await response.json() as CodeHealthData;
    },
    enabled: !!user,
    refetchInterval: 300000, // Refresh every 5 minutes (less frequent than audit)
    staleTime: 120000,
  });
}
