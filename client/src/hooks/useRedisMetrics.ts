import { useQuery } from "@tanstack/react-query";

export interface RedisMetrics {
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  memory: {
    usedBytes: number | null;
    usedMB: number | null;
    peakBytes: number | null;
    peakMB: number | null;
    maxBytes: number | null;
    maxMB: number | null;
    usagePercent: number | null;
  };
  keys: {
    total: number | null;
    expiring: number | null;
  };
  stats: {
    totalCommands: number | null;
    opsPerSecond: number | null;
    connectedClients: number | null;
    uptimeSeconds: number | null;
  };
  error?: string;
  timestamp: string;
}

export function useRedisMetrics() {
  return useQuery<RedisMetrics>({
    queryKey: ["/api/redis/metrics"],
    refetchInterval: 30000,
    staleTime: 10000,
    retry: 1,
  });
}
