import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, CheckCircle, AlertTriangle, HelpCircle, XCircle, Clock, FileCode, Copy, Check, Shield, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface QCVerificationResult {
  id: string;
  candidateId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  badgeState: "VERIFIED" | "DIVERGENT" | "INCONCLUSIVE" | "FAILED" | null;
  qcScore: number | null;
  qcProjectId: string | null;
  qcBacktestId: string | null;
  progressPct: number | null;
  metricsSummaryJson: {
    netProfit?: number;
    totalTrades?: number;
    winRate?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    profitFactor?: number;
    qcGatePassed?: boolean;
    failureReasons?: string[];
    qcBypassed?: boolean;
    bypassReason?: string;
    backtestDays?: number;
  } | null;
  divergenceDetailsJson: {
    pnlDivergence: number;
    winRateDivergence: number;
    tradeDivergence: number;
    sharpeDivergence: number | null;
    divergenceLevel: "LOW" | "MEDIUM" | "HIGH";
    primaryDivergenceReason: string;
  } | null;
  confidenceBoost: number | null;
  errorMessage: string | null;
  traceId: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

interface QCProofPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateName: string;
  onRerunVerification?: () => void;
  canRerun?: boolean;
}

// QC returns percentages directly (e.g., maxDrawdown=1.6 means 1.6%, winRate=55 means 55%)
// These thresholds must match backend resultNormalizer.ts QC_GATE_THRESHOLDS
const QC_RUBRIC = {
  MIN_TRADES: 15,  // Matches backend - lowered for conservative strategies
  MIN_DAYS: 60,
  MIN_PROFIT_FACTOR: 1.10,
  MAX_DRAWDOWN_PCT: 25, // 25% as percentage (matches QC format)
};

function getStatusConfig(status: string | null, badgeState: string | null) {
  if (status === "QUEUED") return { 
    icon: Clock, 
    label: "Queued", 
    color: "text-blue-400", 
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30"
  };
  if (status === "RUNNING") return { 
    icon: Loader2, 
    label: "Running", 
    color: "text-blue-400", 
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    animate: true
  };
  if (status === "FAILED" || badgeState === "FAILED") return { 
    icon: XCircle, 
    label: "Failed", 
    color: "text-red-400", 
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30"
  };
  if (badgeState === "VERIFIED") return { 
    icon: CheckCircle, 
    label: "Verified", 
    color: "text-emerald-400", 
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30"
  };
  if (badgeState === "DIVERGENT") return { 
    icon: AlertTriangle, 
    label: "Divergent", 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30"
  };
  if (badgeState === "INCONCLUSIVE") return { 
    icon: HelpCircle, 
    label: "Inconclusive", 
    color: "text-muted-foreground", 
    bgColor: "bg-muted/30",
    borderColor: "border-muted"
  };
  return { 
    icon: HelpCircle, 
    label: "Unknown", 
    color: "text-muted-foreground", 
    bgColor: "bg-muted/30",
    borderColor: "border-muted"
  };
}

async function fetchQCVerification(candidateId: string): Promise<QCVerificationResult | null> {
  const response = await fetch(`/api/strategy-lab/candidates/${candidateId}/qc-verification`, {
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error("Failed to fetch verification");
  }
  return response.json();
}

export function QCProofPopup({ 
  open, 
  onOpenChange, 
  candidateId, 
  candidateName,
  onRerunVerification,
  canRerun = true
}: QCProofPopupProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedTraceId, setCopiedTraceId] = useState(false);

  const { data: verification, isLoading, error, isFetching, refetch } = useQuery<QCVerificationResult | null>({
    queryKey: ["/api/strategy-lab/candidates", candidateId, "qc-verification"],
    queryFn: () => fetchQCVerification(candidateId),
    enabled: open && !!candidateId,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (data.status === "QUEUED" || data.status === "RUNNING") return 5000;
      return false;
    },
  });

  useEffect(() => {
    if (open && candidateId) {
      queryClient.removeQueries({ 
        queryKey: ["/api/strategy-lab/candidates", candidateId, "qc-verification"],
        exact: true 
      });
    }
  }, [open, candidateId, queryClient]);

  const rerunMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/strategy-lab/candidates/${candidateId}/qc-verification`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to queue verification");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates", candidateId, "qc-verification"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab"] });
      toast({ title: "QC verification queued", description: "Verification will run shortly." });
      onRerunVerification?.();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to queue verification", description: error.message, variant: "destructive" });
    },
  });

  const handleCopyTraceId = () => {
    if (verification?.traceId) {
      navigator.clipboard.writeText(verification.traceId);
      setCopiedTraceId(true);
      setTimeout(() => setCopiedTraceId(false), 2000);
    }
  };

  const metrics = verification?.metricsSummaryJson;
  const qcMetrics = {
    netProfit: metrics?.netProfit ?? 0,
    totalTrades: metrics?.totalTrades ?? 0,
    winRate: metrics?.winRate ?? 0,
    sharpeRatio: metrics?.sharpeRatio ?? 0,
    maxDrawdown: metrics?.maxDrawdown ?? 0,
    profitFactor: metrics?.profitFactor ?? 0,
  };
  const failureReasons = metrics?.failureReasons ?? [];
  const qcGatePassed = metrics?.qcGatePassed ?? false;
  const backtestDays = metrics?.backtestDays ?? 90;
  const statusConfig = getStatusConfig(verification?.status ?? null, verification?.badgeState ?? null);
  const StatusIcon = statusConfig.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-sm p-0 gap-0 overflow-hidden" 
        data-testid="dialog-qc-proof"
      >
        <DialogHeader className={cn("p-4 border-b", statusConfig.bgColor)}>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Shield className={cn("h-5 w-5", statusConfig.color)} />
            QC Verification
          </DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading verification...</span>
            </div>
          ) : error ? (
            <div className="text-center py-6">
              <XCircle className="h-8 w-8 mx-auto mb-2 text-red-400" />
              <p className="text-sm text-muted-foreground">Failed to load verification</p>
            </div>
          ) : !verification ? (
            <div className="text-center py-6">
              <HelpCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">No Verification Found</p>
              <p className="text-xs text-muted-foreground mb-4">
                This strategy hasn't been verified by QuantConnect yet.
              </p>
              {canRerun && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => rerunMutation.mutate()}
                  disabled={rerunMutation.isPending}
                  data-testid="button-run-first-verification"
                >
                  {rerunMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileCode className="h-4 w-4 mr-2" />
                  )}
                  Run Verification
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Strategy Name & Status */}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{candidateName}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {candidateId.slice(0, 8)}...
                  </div>
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md border",
                  statusConfig.bgColor,
                  statusConfig.borderColor
                )}>
                  <StatusIcon className={cn("h-4 w-4", statusConfig.color, statusConfig.animate && "animate-spin")} />
                  <span className={cn("text-xs font-medium", statusConfig.color)}>
                    {statusConfig.label}
                  </span>
                </div>
              </div>

              {/* Running Progress */}
              {(verification.status === "RUNNING" || verification.status === "QUEUED") && (
                <div className={cn("rounded-md border p-3", statusConfig.bgColor, statusConfig.borderColor)}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">
                      {verification.status === "RUNNING" ? "Running backtest..." : "Waiting in queue..."}
                    </span>
                    {verification.status === "RUNNING" && (
                      <span className="text-sm font-mono font-bold text-blue-400">
                        {verification.progressPct ?? 0}%
                      </span>
                    )}
                  </div>
                  {verification.status === "RUNNING" && (
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all" 
                        style={{ width: `${Math.max(verification.progressPct ?? 0, 2)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* PASSED Banner */}
              {verification.status === "COMPLETED" && qcGatePassed && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30">
                  <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <div className="text-sm font-medium text-emerald-400">QC Gate Passed</div>
                    <div className="text-xs text-muted-foreground">Strategy eligible for promotion</div>
                  </div>
                </div>
              )}

              {/* FAILED Reasons */}
              {verification.status === "COMPLETED" && !qcGatePassed && failureReasons.length > 0 && (
                <div className="rounded-md bg-red-500/10 border border-red-500/30 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-400" />
                    <span className="text-xs font-medium text-red-400">QC Gate Failed</span>
                  </div>
                  <div className="space-y-1">
                    {failureReasons.map((reason, idx) => (
                      <div key={idx} className="text-xs text-red-300 pl-6">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              {/* Metrics Grid - Simple 2x2 */}
              {verification.status === "COMPLETED" && (
                <div className="grid grid-cols-2 gap-3">
                  <MetricBox
                    label="Net Profit"
                    value={`$${qcMetrics.netProfit.toFixed(0)}`}
                    isGood={qcMetrics.netProfit > 0}
                    isBad={qcMetrics.netProfit < 0}
                  />
                  <MetricBox
                    label="Trades"
                    value={qcMetrics.totalTrades.toString()}
                    isGood={qcMetrics.totalTrades >= QC_RUBRIC.MIN_TRADES}
                    isBad={qcMetrics.totalTrades < QC_RUBRIC.MIN_TRADES}
                    threshold={`Min: ${QC_RUBRIC.MIN_TRADES}`}
                  />
                  <MetricBox
                    label="Max Drawdown"
                    value={`${qcMetrics.maxDrawdown.toFixed(1)}%`}
                    isGood={qcMetrics.maxDrawdown <= QC_RUBRIC.MAX_DRAWDOWN_PCT}
                    isBad={qcMetrics.maxDrawdown > QC_RUBRIC.MAX_DRAWDOWN_PCT}
                    threshold={`Max: ${QC_RUBRIC.MAX_DRAWDOWN_PCT}%`}
                  />
                  <MetricBox
                    label="Profit Factor"
                    value={qcMetrics.profitFactor.toFixed(2)}
                    isGood={qcMetrics.profitFactor >= QC_RUBRIC.MIN_PROFIT_FACTOR}
                    isBad={qcMetrics.profitFactor < QC_RUBRIC.MIN_PROFIT_FACTOR}
                    threshold={`Min: ${QC_RUBRIC.MIN_PROFIT_FACTOR.toFixed(2)}`}
                  />
                </div>
              )}

              {/* Footer with trace ID */}
              {verification.traceId && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[180px]">
                    {verification.traceId}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCopyTraceId}
                    data-testid="button-copy-trace-id"
                  >
                    {copiedTraceId ? (
                      <Check className="h-3 w-3 text-green-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              )}

              {/* Rerun Button */}
              {canRerun && verification.status === "COMPLETED" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => rerunMutation.mutate()}
                  disabled={rerunMutation.isPending}
                  data-testid="button-rerun-verification"
                >
                  {rerunMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileCode className="h-4 w-4 mr-2" />
                  )}
                  Re-run Verification
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetricBox({ 
  label, 
  value, 
  isGood, 
  isBad, 
  threshold 
}: { 
  label: string; 
  value: string; 
  isGood?: boolean; 
  isBad?: boolean; 
  threshold?: string;
}) {
  return (
    <div className={cn(
      "rounded-md border p-2.5",
      isGood && "bg-emerald-500/5 border-emerald-500/20",
      isBad && "bg-red-500/5 border-red-500/20",
      !isGood && !isBad && "bg-muted/30 border-border"
    )}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
        {isGood && <CheckCircle className="h-3 w-3 text-emerald-400" />}
        {isBad && <XCircle className="h-3 w-3 text-red-400" />}
      </div>
      <div className={cn(
        "text-sm font-mono font-medium",
        isGood && "text-emerald-400",
        isBad && "text-red-400"
      )}>
        {value}
      </div>
      {threshold && (
        <div className="text-[9px] text-muted-foreground/60 mt-0.5">{threshold}</div>
      )}
    </div>
  );
}
