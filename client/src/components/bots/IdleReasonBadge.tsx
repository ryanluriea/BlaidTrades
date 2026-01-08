import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Loader2, AlertCircle, Pause, PlayCircle, CheckCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// Institutional idle reason code descriptions
const IDLE_REASON_DESCRIPTIONS: Record<string, string> = {
  RUNNING: "Job currently executing",
  QUEUED: "Job queued awaiting worker",
  SLA_BREACH: "No work scheduled for too long - system intervention needed",
  WAITING_ON_DATA: "Awaiting data feed or bar cache",
  WAITING_ON_WORKER: "Worker capacity exhausted - will resume shortly",
  SATURATED: "System at capacity - queuing work",
  NEEDS_BASELINE: "First backtest needed to establish baseline",
  BACKTEST_DUE: "Backtest interval exceeded - scheduling",
  IMPROVE_DUE: "Improvement due after recent backtest",
  EVOLVE_DUE: "Evolution cycle due",
  HEALTHY_IDLE: "Normal wait between scheduled work",
};

interface IdleReasonBadgeProps {
  idleReason: string | null;
  queuedJobType: string | null;
  hasRunningJob: boolean;
  idleReasonCode?: string | null;
  className?: string;
}

export function IdleReasonBadge({ 
  idleReason, 
  queuedJobType, 
  hasRunningJob,
  idleReasonCode,
  className 
}: IdleReasonBadgeProps) {
  if (!idleReason && !idleReasonCode) return null;
  
  // Use new institutional codes if available
  const code = idleReasonCode?.toUpperCase() || '';
  
  // Legacy detection for backwards compatibility
  const isQueued = code === 'QUEUED' || idleReason?.startsWith("Queued:");
  const isRunning = code === 'RUNNING' || hasRunningJob || idleReason?.startsWith("Running:");
  const isSLABreach = code === 'SLA_BREACH';
  const isHealthyIdle = code === 'HEALTHY_IDLE';
  
  // Don't show floating badge for BACKTEST/IMPROVING/EVOLVING jobs - they're shown in ActivityGrid
  const reasonJobType = idleReason?.includes(':') ? idleReason.split(':')[1]?.trim().toUpperCase() : queuedJobType?.toUpperCase();
  const normalizedJobType = reasonJobType?.startsWith('BACKTEST') ? 'BACKTEST' : reasonJobType;
  if ((isQueued || isRunning) && ['BACKTEST', 'BACKTESTER', 'IMPROVING', 'EVOLVING'].includes(normalizedJobType || '')) {
    return null;
  }
  
  const isBlocked = idleReason?.startsWith("Blocked:");
  const isAwaiting = idleReason?.includes("Awaiting") || code === 'NEEDS_BASELINE';
  
  let Icon = Clock;
  let colorClass = "text-muted-foreground bg-muted/30";
  
  if (isRunning) {
    Icon = Loader2;
    colorClass = "text-blue-400 bg-blue-500/10";
  } else if (isQueued) {
    Icon = PlayCircle;
    colorClass = "text-amber-400 bg-amber-500/10";
  } else if (isSLABreach) {
    Icon = AlertTriangle;
    colorClass = "text-red-400 bg-red-500/10";
  } else if (isBlocked) {
    Icon = AlertCircle;
    colorClass = "text-red-400 bg-red-500/10";
  } else if (isHealthyIdle) {
    Icon = CheckCircle;
    colorClass = "text-green-400 bg-green-500/10";
  } else if (isAwaiting) {
    Icon = Pause;
    colorClass = "text-muted-foreground bg-muted/30";
  }
  
  const displayReason = idleReasonCode 
    ? IDLE_REASON_DESCRIPTIONS[code] || idleReasonCode 
    : idleReason;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span 
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded",
            colorClass,
            className
          )}
          data-testid="badge-idle-reason"
        >
          <Icon className={cn("w-4 h-4", isRunning && "animate-spin")} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs">
        <div className="text-xs">
          <div className="font-medium mb-1">{displayReason}</div>
          {idleReasonCode && (
            <div className="text-muted-foreground font-mono text-[10px]">{idleReasonCode}</div>
          )}
          {isQueued && queuedJobType && (
            <div className="text-muted-foreground">Job type: {queuedJobType}</div>
          )}
          {isHealthyIdle && (
            <div className="text-muted-foreground">Autonomy will schedule work on cadence</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
