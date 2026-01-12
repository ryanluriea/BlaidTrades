import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export type QCBadgeState = "VERIFIED" | "DIVERGENT" | "INCONCLUSIVE" | "FAILED" | "QUEUED" | "RUNNING" | "QC_PASSED" | "QC_FAILED" | "QC_INCONCLUSIVE" | "QC_BYPASSED" | "NONE";

export interface QCVerification {
  id: string;
  candidateId: string;
  botId: string | null;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT";
  badgeState: QCBadgeState | null;
  snapshotHash: string;
  tierAtRun: string | null;
  confidenceAtRun: number | null;
  qcScore: number | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  traceId: string | null;
  attemptCount: number | null;
  maxAttempts: number | null;
  progressPct: number | null;
}

export interface QCBudgetStatus {
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  weeklyUsed: number;
  weeklyLimit: number;
  weeklyRemaining: number;
  canRun: boolean;
  exhaustionReason?: string;
}

async function fetchQCBudget(): Promise<QCBudgetStatus> {
  const response = await fetch("/api/qc/budget", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch QC budget");
  const json = await response.json();
  return json.data;
}

export function useQCBudget() {
  return useQuery<QCBudgetStatus>({
    queryKey: ["/api/qc/budget"],
    queryFn: fetchQCBudget,
    refetchInterval: 30000,
    staleTime: 10000,
  });
}

async function fetchQCVerifications(candidateId?: string): Promise<QCVerification[]> {
  // INSTITUTIONAL: Request higher limit to ensure TRIALS candidates (promoted after QC) 
  // are included even if many new verifications have run since their QC passed
  const url = candidateId 
    ? `/api/qc/verifications?candidateId=${candidateId}` 
    : "/api/qc/verifications?limit=200";
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch QC verifications");
  const json = await response.json();
  return json.data;
}

export function useQCVerifications(candidateId?: string) {
  return useQuery<QCVerification[]>({
    queryKey: ["/api/qc/verifications", candidateId],
    queryFn: () => fetchQCVerifications(candidateId),
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

async function fetchQCVerificationStatus(verificationId: string): Promise<QCVerification> {
  const response = await fetch(`/api/qc/status/${verificationId}`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch QC verification status");
  const json = await response.json();
  return json.data;
}

export function useQCVerificationStatus(verificationId?: string) {
  return useQuery<QCVerification>({
    queryKey: ["/api/qc/status", verificationId],
    queryFn: () => fetchQCVerificationStatus(verificationId!),
    enabled: !!verificationId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (data.status === "QUEUED" || data.status === "RUNNING") {
        return 5000;
      }
      return false;
    },
  });
}

export function useRunQCVerification() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ candidateId, botId }: { candidateId: string; botId?: string }) => {
      const response = await fetch("/api/qc/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ candidateId, botId }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || "Failed to queue QC verification");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/qc/budget"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qc/verifications"] });
      toast({
        title: "QC Verification Queued",
        description: `Verification ID: ${data.data?.verificationId?.slice(0, 8)}...`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "QC Verification Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

async function fetchQCConfigStatus(): Promise<{
  configured: boolean;
  missing: string[];
  connected: boolean;
  connectionError?: string;
}> {
  const response = await fetch("/api/qc/config-status", { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch QC config status");
  const json = await response.json();
  return json.data;
}

export function useQCConfigStatus() {
  return useQuery({
    queryKey: ["/api/qc/config-status"],
    queryFn: fetchQCConfigStatus,
    staleTime: 60000,
  });
}

export interface QCBadgeInfo {
  state: QCBadgeState;
  attemptCount: number | null;
  maxAttempts: number | null;
  queuedAt: string | null;
  startedAt: string | null;
  progressPct: number | null;
  qcScore: number | null;
}

export function getCandidateQCBadgeState(
  verifications: QCVerification[] | undefined,
  candidateId: string
): QCBadgeState {
  return getCandidateQCBadgeInfo(verifications, candidateId).state;
}

export function getCandidateQCBadgeInfo(
  verifications: QCVerification[] | undefined,
  candidateId: string
): QCBadgeInfo {
  const emptyResult: QCBadgeInfo = { 
    state: "NONE", 
    attemptCount: null, 
    maxAttempts: null,
    queuedAt: null,
    startedAt: null,
    progressPct: null,
    qcScore: null
  };
  
  if (!verifications || verifications.length === 0) {
    return emptyResult;
  }
  
  const candidateVerifications = verifications.filter(v => v.candidateId === candidateId);
  if (candidateVerifications.length === 0) {
    return emptyResult;
  }
  
  const sorted = [...candidateVerifications].sort(
    (a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()
  );
  const latest = sorted[0];
  const baseInfo = { 
    attemptCount: latest.attemptCount, 
    maxAttempts: latest.maxAttempts,
    queuedAt: latest.queuedAt,
    startedAt: latest.startedAt,
    progressPct: latest.progressPct,
    qcScore: latest.qcScore
  };
  
  if (latest.status === "QUEUED") return { state: "QUEUED", ...baseInfo };
  if (latest.status === "RUNNING") return { state: "RUNNING", ...baseInfo };
  if (latest.status === "FAILED" || latest.status === "TIMEOUT") return { state: "FAILED", ...baseInfo };
  
  if (latest.status === "COMPLETED" && latest.badgeState) {
    return { state: latest.badgeState, ...baseInfo };
  }
  
  return emptyResult;
}

export function isQCEligible(confidenceScore: number, tier: string | null): boolean {
  const normalizedTier = tier?.toUpperCase() || "";
  return confidenceScore >= 75 && (normalizedTier === "A" || normalizedTier === "B");
}
