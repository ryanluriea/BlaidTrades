import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AuditSection {
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP";
  details: Record<string, any>;
}

export interface FullAuditResult {
  success: boolean;
  audit_id: string;
  status: "PASS" | "FAIL";
  summary: {
    sections_passed: number;
    sections_warned: number;
    sections_failed: number;
    sections_skipped: number;
    canary_ready: boolean;
    live_ready: boolean;
  };
  sections: AuditSection[];
  legacy_coverage: Array<{
    category: string;
    provider: string;
    configured: boolean;
    validated: boolean;
    in_use: boolean;
    intentionally_unused: boolean;
    reason: string | null;
  }>;
}

export function useRunFullAudit() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<FullAuditResult> => {
      if (!user) throw new Error("Not authenticated");

      const response = await fetch(`/api/audits/full?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Audit failed");

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["full-audits"] });
      queryClient.invalidateQueries({ queryKey: ["legacy-coverage"] });
      
      if (data.status === "PASS") {
        toast.success("Full Audit PASSED", {
          description: `${data.summary.sections_passed} sections passed. System is ${data.summary.canary_ready ? "CANARY" : "NOT CANARY"} ready.`,
        });
      } else {
        toast.warning("Full Audit completed with issues", {
          description: `${data.summary.sections_failed} sections failed, ${data.summary.sections_warned} warnings.`,
        });
      }
    },
    onError: (error) => {
      toast.error(`Audit failed: ${error.message}`);
    },
  });
}

export function useLatestAudit() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["full-audits", "latest", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const response = await fetch(`/api/audits/latest?user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.data || data;
    },
    enabled: !!user,
  });
}

export function useLegacyCoverage() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["legacy-coverage", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const response = await fetch(`/api/legacy-coverage?user_id=${user.id}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return result.data || [];
    },
    enabled: !!user,
  });
}
