import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ScaleTestResult {
  runId: string;
  profile: string;
  status: "PASS" | "FAIL" | "ERROR" | "RUNNING" | "PENDING";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  metrics: Record<string, number | string>;
  errors: string[];
  instanceId: string;
}

export interface ScaleTestStatus {
  running: boolean;
  currentProfile?: string;
  runId?: string;
  startedAt?: string;
  progress?: number;
}

export function useScaleTestResults() {
  return useQuery({
    queryKey: ["/ops/scale-test/results"],
    queryFn: async (): Promise<ScaleTestResult[]> => {
      try {
        const response = await fetch("/ops/scale-test/results");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        return result.data || [];
      } catch (error) {
        console.error("[useScaleTestResults] Failed to fetch:", error);
        return [];
      }
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useScaleTestStatus() {
  return useQuery({
    queryKey: ["/ops/scale-test/status"],
    queryFn: async (): Promise<ScaleTestStatus | null> => {
      try {
        const response = await fetch("/ops/scale-test/status");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const result = await response.json();
        return result.data || null;
      } catch (error) {
        console.error("[useScaleTestStatus] Failed to fetch:", error);
        return null;
      }
    },
    refetchInterval: 2000,
    staleTime: 1000,
  });
}

export function useRunScaleTest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: string): Promise<{ runId: string }> => {
      const response = await fetch("/ops/scale-test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/ops/scale-test/results"] });
      queryClient.invalidateQueries({ queryKey: ["/ops/scale-test/status"] });
    },
  });
}
