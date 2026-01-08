import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Star, Code, ShieldCheck, ShieldX, ShieldQuestion, ShieldAlert, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export type QCVerificationState = 
  | "QC_PASSED" | "VERIFIED"
  | "QC_FAILED" | "DIVERGENT" | "FAILED"
  | "QC_INCONCLUSIVE" | "INCONCLUSIVE"
  | "QUEUED" | "RUNNING"
  | "NONE" | null | undefined;

interface StrategyNameDisplayProps {
  humanName: string;
  systemCodename: string;
  isWinner?: boolean;
  qcState?: QCVerificationState;
  className?: string;
}

function QCVerificationCheckmark({ state }: { state: QCVerificationState }) {
  if (!state || state === "NONE") return null;
  
  const isPassed = state === "QC_PASSED" || state === "VERIFIED";
  const isFailed = state === "QC_FAILED" || state === "DIVERGENT" || state === "FAILED";
  const isInconclusive = state === "QC_INCONCLUSIVE" || state === "INCONCLUSIVE";
  const isPending = state === "QUEUED" || state === "RUNNING";
  
  if (isPassed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500 shrink-0 cursor-help" data-testid="badge-qc-verified">
            <ShieldCheck className="h-2.5 w-2.5 text-white" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-medium text-emerald-400">QC Verified</p>
          <p className="text-muted-foreground">Passed QuantConnect LEAN verification</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isFailed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-red-500/80 shrink-0 cursor-help" data-testid="badge-qc-failed">
            <ShieldX className="h-2.5 w-2.5 text-white" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-medium text-red-400">QC Failed</p>
          <p className="text-muted-foreground">Did not meet QC verification thresholds</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isInconclusive) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-yellow-500/80 shrink-0 cursor-help" data-testid="badge-qc-inconclusive">
            <ShieldQuestion className="h-2.5 w-2.5 text-white" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-medium text-yellow-400">QC Inconclusive</p>
          <p className="text-muted-foreground">Verification results inconclusive</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (isPending) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500/80 shrink-0 cursor-help animate-pulse" data-testid="badge-qc-pending">
            <Clock className="h-2.5 w-2.5 text-white" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-medium text-blue-400">QC {state === "RUNNING" ? "Running" : "Queued"}</p>
          <p className="text-muted-foreground">QuantConnect verification in progress</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return null;
}

export function StrategyNameDisplay({ 
  humanName, 
  systemCodename, 
  isWinner,
  qcState,
  className 
}: StrategyNameDisplayProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("min-w-0", className)}>
            <div className="flex items-center gap-1.5">
              <h4 className="font-semibold text-sm truncate">
                {humanName}
              </h4>
              <QCVerificationCheckmark state={qcState} />
              {isWinner && (
                <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400 shrink-0" />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground font-mono truncate flex items-center gap-1">
              <Code className="h-2.5 w-2.5 shrink-0" />
              {systemCodename}
            </p>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-xs">
          <div className="space-y-1.5">
            <div>
              <p className="text-xs text-muted-foreground">Human Name</p>
              <p className="font-medium">{humanName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">System Codename</p>
              <p className="font-mono text-xs">{systemCodename}</p>
            </div>
            {isWinner && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Star className="h-2.5 w-2.5 text-amber-400 fill-amber-400" />
                Tournament Winner
              </Badge>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
