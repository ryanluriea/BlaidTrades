import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FlaskConical, Dna, Brain, Clock } from "lucide-react";
import type { JobsSummary } from "@/hooks/useBotRunnerAndJobs";

// Re-export for backward compatibility
export type { JobsSummary };

interface JobsBadgeProps {
  jobs: JobsSummary;
  className?: string;
}

/**
 * Displays concurrent background jobs for a bot - COMPACT ICON-ONLY VERSION
 * Shows backtests, evaluations, and training jobs as small icon badges
 */
export function JobsBadge({ jobs, className }: JobsBadgeProps) {
  const { backtestsRunning, backtestsQueued, evaluating, training } = jobs;
  
  const hasAnyJobs = backtestsRunning > 0 || backtestsQueued > 0 || evaluating || training;
  
  if (!hasAnyJobs) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {/* Backtests Running */}
      {backtestsRunning > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "flex items-center justify-center rounded border h-5",
              backtestsRunning > 1 ? "gap-0.5 px-1.5" : "w-6",
              "bg-purple-500/20 text-purple-400 border-purple-500/30"
            )}>
              <FlaskConical className="w-3.5 h-3.5 animate-pulse" />
              {backtestsRunning > 1 && (
                <span className="text-[9px] font-mono">{backtestsRunning}</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">Backtesting</div>
            <div className="text-muted-foreground">
              {backtestsRunning} job{backtestsRunning !== 1 ? 's' : ''} running
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Backtests Queued */}
      {backtestsQueued > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "flex items-center justify-center rounded border h-5",
              backtestsQueued > 1 ? "gap-0.5 px-1.5" : "w-6",
              "bg-muted/50 text-muted-foreground border-muted/50"
            )}>
              <Clock className="w-3.5 h-3.5" />
              {backtestsQueued > 1 && (
                <span className="text-[9px] font-mono">{backtestsQueued}</span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">Queued</div>
            <div className="text-muted-foreground">
              {backtestsQueued} job{backtestsQueued !== 1 ? 's' : ''} waiting
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Evaluating */}
      {evaluating && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "flex items-center justify-center w-6 h-5 rounded border",
              "bg-amber-500/20 text-amber-400 border-amber-500/30"
            )}>
              <Brain className="w-3.5 h-3.5 animate-pulse" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">Evaluating</div>
            <div className="text-muted-foreground">
              Graduation engine evaluating bot
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Training/Evolution */}
      {training && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn(
              "flex items-center justify-center w-6 h-5 rounded border",
              "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            )}>
              <Dna className="w-3.5 h-3.5 animate-pulse" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">Training</div>
            <div className="text-muted-foreground">
              Evolution engine mutating and testing
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
