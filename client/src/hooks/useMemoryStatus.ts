import { useQuery } from "@tanstack/react-query";

export interface MemorySample {
  timestamp: string;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapPercent: number;
}

export interface MemoryStatus {
  current: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
    arrayBuffers: number;
    heapPercent?: number;
    heapUsedPercent?: number;
  };
  peak: {
    heapUsed: number;
    heapPercent?: number;
    heapUsedPercent?: number;
    timestamp: string;
  };
  avgHeapPercent?: number;
  trend?: "stable" | "rising" | "falling";
  isUnderPressure?: boolean;
  loadSheddingActive?: boolean;
  blockedRequests?: number;
  sampleCount?: number;
  uptime?: number;
  sentinelStatus?: {
    running: boolean;
    intervalMs: number;
    highWaterMark: number;
    lowWaterMark: number;
  };
  samples?: MemorySample[];
}

export function useMemoryStatus() {
  return useQuery({
    queryKey: ["/ops/memory"],
    queryFn: async (): Promise<MemoryStatus | null> => {
      try {
        const response = await fetch("/ops/memory");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        return result.data || null;
      } catch (error) {
        console.error("[useMemoryStatus] Failed to fetch:", error);
        return null;
      }
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });
}
