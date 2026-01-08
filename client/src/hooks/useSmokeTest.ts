/**
 * Smoke test hook
 * MIGRATED: Supabase → Express API
 */
import { useState } from "react";
import { toast } from "sonner";

export interface SmokeTestResult {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  overallStatus: "PASS" | "FAIL" | "DEGRADED" | "RUNNING";
  // Tier summary - CRITICAL components affect overall status, OPTIONAL don't
  tierSummary?: {
    critical: { total: number; passing: number; failing: number; degraded: number };
    optional: { total: number; passing: number; failing: number; degraded: number };
  };
  results: {
    providerId: string;
    providerName: string;
    tier?: "CRITICAL" | "OPTIONAL"; // CRITICAL = blocks trading, OPTIONAL = performance only
    status: "PASS" | "FAIL" | "DEGRADED" | "SKIPPED";
    latencyMs: number | null;
    errorMessage: string | null;
    proofJson: Record<string, unknown> | null;
  }[];
}

export function useSmokeTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<SmokeTestResult | null>(null);

  const runSmokeTest = async (): Promise<SmokeTestResult | null> => {
    setIsRunning(true);
    try {
      const response = await fetch('/api/smoke-test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: "run" }),
      });

      if (!response.ok) {
        if (response.status === 501) {
          const data = await response.json();
          toast.error("Smoke test not implemented: " + data.message);
          return null;
        }
        toast.error("Smoke test failed");
        return null;
      }

      const data = await response.json();

      if (!data.success) {
        toast.error("Smoke test failed: " + (data.error || 'Unknown error'));
        return null;
      }

      const result = data.data as SmokeTestResult;
      setLastResult(result);

      if (result.overallStatus === "PASS") {
        toast.success("Smoke test passed");
      } else if (result.overallStatus === "DEGRADED") {
        toast.warning("Smoke test completed with warnings");
      } else {
        toast.error("Smoke test failed");
      }

      return result;
    } catch (err) {
      toast.error("Failed to run smoke test");
      return null;
    } finally {
      setIsRunning(false);
    }
  };

  return {
    runSmokeTest,
    isRunning,
    lastResult,
  };
}
