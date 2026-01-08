import { useQuery, useInfiniteQuery } from "@tanstack/react-query";

export interface ActivityEvent {
  id: string;
  event_type: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  title: string;
  summary: string | null;
  bot_id: string | null;
  bot_name?: string | null;
  user_id: string | null;
  job_id: string | null;
  stage: string | null;
  symbol: string | null;
  metadata: Record<string, any> | null;
  trace_id: string | null;
  created_at: string;
}

export interface ActivityFeedFilters {
  botId?: string;
  types?: string[];
  severity?: string[];
  stage?: string[];
  q?: string;
  from?: string;
  to?: string;
  userId?: string;
}

export interface ActivityFeedResponse {
  success: boolean;
  data: {
    items: ActivityEvent[];
    nextCursor: string | null;
  };
  trace_id: string;
}

function buildActivityUrl(filters: ActivityFeedFilters, cursor?: string): string {
  const params = new URLSearchParams();
  
  if (filters.botId) params.set("botId", filters.botId);
  if (filters.types?.length) params.set("types", filters.types.join(","));
  if (filters.severity?.length) params.set("severity", filters.severity.join(","));
  if (filters.stage?.length) params.set("stage", filters.stage.join(","));
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.userId) params.set("userId", filters.userId);
  if (cursor) params.set("cursor", cursor);
  
  params.set("limit", "50");
  
  return `/api/activity?${params.toString()}`;
}

export function useActivityFeed(filters: ActivityFeedFilters = {}) {
  return useInfiniteQuery<ActivityFeedResponse>({
    queryKey: ["/api/activity", filters],
    queryFn: async ({ pageParam }) => {
      const url = buildActivityUrl(filters, pageParam as string | undefined);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch activity feed");
      }
      return response.json();
    },
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useRecentActivity(limit: number = 10) {
  return useQuery<ActivityFeedResponse>({
    queryKey: ["/api/activity", "recent", limit],
    queryFn: async () => {
      const response = await fetch(`/api/activity?limit=${limit}`);
      if (!response.ok) {
        throw new Error("Failed to fetch recent activity");
      }
      return response.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export const ACTIVITY_EVENT_TYPES = [
  "TRADE_EXECUTED",
  "TRADE_EXITED",
  "ORDER_BLOCKED_RISK",
  "PROMOTED",
  "DEMOTED",
  "GRADUATED",
  "BACKTEST_STARTED",
  "BACKTEST_COMPLETED",
  "BACKTEST_FAILED",
  "RUNNER_STARTED",
  "RUNNER_RESTARTED",
  "RUNNER_STOPPED",
  "JOB_TIMEOUT",
  "KILL_TRIGGERED",
  "AUTONOMY_TIER_CHANGED",
  "AUTONOMY_GATE_BLOCKED",
  "INTEGRATION_VERIFIED",
  "INTEGRATION_USAGE_PROOF",
  "NOTIFY_DISCORD_SENT",
  "NOTIFY_DISCORD_FAILED",
  "SYSTEM_STATUS_CHANGED",
  "BOT_CREATED",
  "BOT_ARCHIVED",
] as const;

export const SEVERITY_LEVELS = ["INFO", "WARN", "ERROR", "CRITICAL"] as const;

export const STAGES = ["TRIALS", "PAPER", "SHADOW", "CANARY", "LIVE"] as const;
