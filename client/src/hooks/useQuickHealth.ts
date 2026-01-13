import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface QuickHealthData {
  status: "healthy" | "degraded" | "unhealthy";
  database: {
    ok: boolean;
    latencyMs: number;
    healthy: boolean;
  };
  redis: {
    ok: boolean;
    latencyMs: number;
    healthy: boolean;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    healthy: boolean;
  };
  metrics: {
    httpRequests: number;
    httpErrors: number;
    errorRate: number;
    activeBots: number;
    backtestsRunning: number;
  };
  selfHealing: {
    enabled: boolean;
    lastAction: {
      action: string;
      reason: string;
      timestamp: string;
      success: boolean;
    } | null;
  };
  timestamp: string;
}

export function useQuickHealth() {
  return useQuery<QuickHealthData>({
    queryKey: ["/api/system/quick-health"],
    refetchInterval: 30000,
    staleTime: 10000,
  });
}

export function useHealCache() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/system/heal-cache");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system/quick-health"] });
    },
  });
}
