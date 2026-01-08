import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface IntegrationStatus {
  id: string;
  label: string;
  kind: string;
  provider: string;
  configured: boolean;
  validated: boolean;
  status: "PASS" | "FAIL" | "DEGRADED" | "NOT_CONFIGURED";
  last_success_at: string | null;
  latency_ms: number | null;
  proof_json: Record<string, unknown> | null;
  intentionally_unused: boolean;
  intentionally_unused_reason: string | null;
}

export interface ReadinessReport {
  generated_at: string;
  integrations: IntegrationStatus[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    degraded: number;
    not_configured: number;
  };
  smoke_test_latest: {
    id: string;
    overall_status: string;
    finished_at: string;
  } | null;
  canary_ready: boolean;
  canary_blockers: string[];
  live_ready: boolean;
  live_blockers: string[];
}

export function useCredentialReadiness() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<ReadinessReport | null>(null);

  const generateReport = async (): Promise<ReadinessReport | null> => {
    if (!user) {
      toast.error("Not authenticated");
      return null;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/credential-readiness?user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        toast.error("Failed to generate readiness report: " + (errorData.error || 'Unknown error'));
        return null;
      }

      const data = await response.json();
      setReport(data);

      if (data.live_ready) {
        toast.success("All credentials validated - LIVE READY");
      } else if (data.canary_ready) {
        toast.success("CANARY READY, LIVE has blockers");
      } else {
        toast.warning("Credential validation has issues");
      }

      return data;
    } catch (err) {
      toast.error("Failed to generate readiness report");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credential-readiness-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  return {
    generateReport,
    exportReport,
    isLoading,
    report,
  };
}
