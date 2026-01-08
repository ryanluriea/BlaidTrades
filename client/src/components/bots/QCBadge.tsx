import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, AlertTriangle, HelpCircle, XCircle, Clock, ShieldCheck, ShieldX, ShieldAlert, ShieldQuestion } from "lucide-react";

// Legacy database states (stored in DB) and new display states
export type QCBadgeState = 
  | "VERIFIED" | "DIVERGENT" | "INCONCLUSIVE" | "FAILED"  // Legacy DB states
  | "QC_PASSED" | "QC_FAILED" | "QC_INCONCLUSIVE"         // New spec states  
  | "QC_BYPASSED"                                          // Admin bypass state
  | "QUEUED" | "RUNNING" | "NONE";

interface QCBadgeProps {
  state: QCBadgeState;
  qcScore?: number | null;
  className?: string;
  showLabel?: boolean;
  attemptCount?: number | null;
  maxAttempts?: number | null;
  progressPct?: number | null;
  elapsedTime?: string | null;
  failureReasons?: string[] | null;
}

// Normalize legacy states to new spec states for display
function normalizeState(state: QCBadgeState): QCBadgeState {
  switch (state) {
    case "VERIFIED": return "QC_PASSED";
    case "DIVERGENT": return "QC_FAILED";
    case "INCONCLUSIVE": return "QC_INCONCLUSIVE";
    case "FAILED": return "QC_FAILED";
    default: return state;
  }
}

const BADGE_CONFIG: Record<QCBadgeState, {
  icon: typeof CheckCircle;
  label: string;
  description: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
}> = {
  // New spec states (primary)
  QC_PASSED: {
    icon: ShieldCheck,
    label: "QC Passed",
    description: "Strategy verified by QuantConnect LEAN Engine - meets all quality thresholds (30+ trades, 60+ days, PF ≥1.10, DD ≤25%)",
    variant: "outline",
    className: "border-green-500/50 text-green-600 dark:text-green-400",
  },
  QC_FAILED: {
    icon: ShieldX,
    label: "QC Failed",
    description: "Strategy failed QC verification gate - does not meet minimum quality thresholds",
    variant: "outline",
    className: "border-red-500/50 text-red-600 dark:text-red-400",
  },
  QC_INCONCLUSIVE: {
    icon: ShieldQuestion,
    label: "Inconclusive",
    description: "QC verification completed but results were inconclusive - insufficient sample size",
    variant: "outline",
    className: "border-yellow-500/50 text-yellow-600 dark:text-yellow-400",
  },
  // Legacy states (for backwards compatibility - map to new displays)
  VERIFIED: {
    icon: ShieldCheck,
    label: "QC Passed",
    description: "Strategy verified by QuantConnect LEAN Engine - meets all quality thresholds",
    variant: "outline",
    className: "border-green-500/50 text-green-600 dark:text-green-400",
  },
  DIVERGENT: {
    icon: ShieldX,
    label: "QC Failed",
    description: "Strategy failed QC verification - metrics do not meet thresholds or diverge from expected",
    variant: "outline",
    className: "border-red-500/50 text-red-600 dark:text-red-400",
  },
  INCONCLUSIVE: {
    icon: ShieldQuestion,
    label: "Inconclusive",
    description: "QC verification completed but results were inconclusive - insufficient data",
    variant: "outline",
    className: "border-yellow-500/50 text-yellow-600 dark:text-yellow-400",
  },
  FAILED: {
    icon: XCircle,
    label: "QC Error",
    description: "QC verification encountered an execution error - API failure or timeout",
    variant: "outline",
    className: "border-red-500/50 text-red-600 dark:text-red-400",
  },
  QUEUED: {
    icon: Clock,
    label: "Queued",
    description: "QC verification is queued and waiting to run",
    variant: "outline",
    className: "border-blue-500/50 text-blue-600 dark:text-blue-400",
  },
  RUNNING: {
    icon: Clock,
    label: "Running",
    description: "QC verification is currently in progress",
    variant: "outline",
    className: "border-blue-500/50 text-blue-600 dark:text-blue-400 animate-pulse",
  },
  NONE: {
    icon: ShieldAlert,
    label: "QC Required",
    description: "No QC verification has been run for this strategy - required before Trial promotion",
    variant: "outline",
    className: "border-muted-foreground/30 text-muted-foreground/60",
  },
  QC_BYPASSED: {
    icon: AlertTriangle,
    label: "QC BYPASSED",
    description: "QC gate was bypassed by admin - strategy was NOT verified by QuantConnect. Use with extreme caution.",
    variant: "outline",
    className: "border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400 animate-pulse",
  },
};

export function QCBadge({ state, qcScore, className = "", showLabel = true, attemptCount, maxAttempts, progressPct, elapsedTime, failureReasons }: QCBadgeProps) {
  const config = BADGE_CONFIG[state] || BADGE_CONFIG.NONE;
  const Icon = config.icon;
  
  const showAttemptBadge = attemptCount != null && attemptCount > 0 && maxAttempts != null && maxAttempts > 1;
  const isRetrying = showAttemptBadge && state === "QUEUED" && attemptCount > 1;
  const isRunning = state === "RUNNING";
  const isFailed = state === "QC_FAILED" || state === "DIVERGENT" || state === "FAILED";
  const progress = progressPct ?? 0;

  const tooltipContent = (
    <div className="space-y-1 max-w-xs">
      <p className="font-medium">{config.label}</p>
      <p className="text-xs text-muted-foreground">{config.description}</p>
      {isRunning && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>Progress:</span>
            <span className="font-mono font-medium text-blue-400">{progress}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all duration-300" 
              style={{ width: `${Math.max(progress, 2)}%` }}
            />
          </div>
          {elapsedTime && (
            <p className="text-xs text-muted-foreground">
              Running: <span className="font-mono">{elapsedTime}</span>
            </p>
          )}
        </div>
      )}
      {isFailed && failureReasons && failureReasons.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-red-500">Failure Reasons:</p>
          {failureReasons.map((reason, idx) => (
            <p key={idx} className="text-xs text-muted-foreground pl-2">- {reason}</p>
          ))}
        </div>
      )}
      {qcScore !== undefined && qcScore !== null && (
        <p className="text-xs">
          QC Score: <span className="font-mono font-medium">{(qcScore * 100).toFixed(1)}%</span>
        </p>
      )}
      {showAttemptBadge && (
        <p className="text-xs">
          Attempt: <span className="font-mono font-medium">{attemptCount}/{maxAttempts}</span>
          {isRetrying && <span className="ml-1 text-yellow-500">(retrying)</span>}
        </p>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative inline-flex">
          <Badge
            variant={config.variant}
            className={`gap-1 cursor-help ${config.className} ${className}`}
            data-testid={`badge-qc-${state.toLowerCase()}`}
          >
            <Icon className="h-3 w-3" />
            {showLabel && <span className="text-xs">{config.label}</span>}
          </Badge>
          {showAttemptBadge && (
            <span 
              className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold rounded-full bg-muted-foreground text-background"
              data-testid="badge-qc-attempt-count"
            >
              {attemptCount}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-50">
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

export function getQCBadgeStateFromStatus(
  status?: string | null,
  badgeState?: string | null
): QCBadgeState {
  if (!status) return "NONE";
  
  if (status === "QUEUED") return "QUEUED";
  if (status === "RUNNING") return "RUNNING";
  if (status === "FAILED") return "FAILED";
  
  if (status === "COMPLETED" && badgeState) {
    // New spec states
    if (badgeState === "QC_PASSED") return "QC_PASSED";
    if (badgeState === "QC_FAILED") return "QC_FAILED";
    if (badgeState === "QC_INCONCLUSIVE") return "QC_INCONCLUSIVE";
    // Legacy database states - normalize to new display states
    if (badgeState === "VERIFIED") return "QC_PASSED";
    if (badgeState === "DIVERGENT") return "QC_FAILED";
    if (badgeState === "INCONCLUSIVE") return "QC_INCONCLUSIVE";
    if (badgeState === "FAILED") return "QC_FAILED";
  }
  
  return "NONE";
}

// Check if a badge state represents a passed QC gate
export function isQCGatePassed(badgeState?: string | null): boolean {
  return badgeState === "QC_PASSED" || badgeState === "VERIFIED";
}
