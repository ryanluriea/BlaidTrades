/**
 * Utilization audit hook
 * MIGRATED: Supabase → Express API
 */
import { useState } from "react";
import { toast } from "sonner";

export interface AuditResult {
  id: string;
  windowStart: string;
  windowEnd: string;
  overallStatus: "PASS" | "FAIL" | "DEGRADED";
  rows: {
    botId: string;
    botName: string;
    providerId: string;
    providerName: string;
    eligibility: "ELIGIBLE" | "NOT_ELIGIBLE";
    usage: "USED" | "UNUSED" | "INTENTIONALLY_UNUSED";
    usageCount: number;
    reasonCode?: string;
  }[];
}

export function useUtilizationAudit() {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<AuditResult | null>(null);

  const runAudit = async (
    window: "24h" | "7d" | "30d" = "24h"
  ): Promise<AuditResult | null> => {
    setIsRunning(true);
    try {
      const response = await fetch(`/api/utilization-audit?window=${window}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 501) {
          const data = await response.json();
          toast.error("Utilization audit not implemented: " + data.message);
          return null;
        }
        toast.error("Utilization audit failed");
        return null;
      }

      const data = await response.json();

      if (!data.success) {
        toast.error("Utilization audit failed: " + (data.error || 'Unknown error'));
        return null;
      }

      const result = data.data as AuditResult;
      setLastResult(result);

      if (result.overallStatus === "PASS") {
        toast.success("Utilization audit passed");
      } else if (result.overallStatus === "DEGRADED") {
        toast.warning("Utilization audit completed with warnings");
      } else {
        toast.error("Utilization audit failed");
      }

      return result;
    } catch (err) {
      toast.error("Failed to run utilization audit");
      return null;
    } finally {
      setIsRunning(false);
    }
  };

  return {
    runAudit,
    isRunning,
    lastResult,
  };
}
