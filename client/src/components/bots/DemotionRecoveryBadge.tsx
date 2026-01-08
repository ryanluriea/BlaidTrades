import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { DemotionEvent } from "@/hooks/useBotDemotions";

interface DemotionRecoveryBadgeProps {
  demotion: DemotionEvent | null | undefined;
  currentStage: string;
  improvementStatus?: string | null;
  className?: string;
}

// Map reason codes to user-friendly labels
function getReasonLabel(code: string): string {
  const map: Record<string, string> = {
    DD_BREACH: "Drawdown breach",
    LOSS_STREAK: "Loss streak",
    RISK_VIOLATION: "Risk violation",
    STALE_HEARTBEAT: "Heartbeat timeout",
    CIRCUIT_BREAKER: "Circuit breaker",
    MANUAL: "Manual demotion",
    HEALTH_DEGRADED: "Health degraded",
    PERFORMANCE: "Performance issue",
    REPEATED_FAILS: "Repeated backtest failures",
  };
  return map[code] || code.replace(/_/g, " ");
}

export function DemotionRecoveryBadge({
  demotion,
  currentStage,
  improvementStatus,
  className,
}: DemotionRecoveryBadgeProps) {
  // Only show if there's a recent demotion
  if (!demotion) return null;
  
  // Check if demotion is recent (within last 14 days)
  const demotionDate = new Date(demotion.created_at);
  const daysSinceDemotion = (Date.now() - demotionDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceDemotion > 14) return null;

  // TWO CASES:
  // 1. Bot is still in demoted stage (to_stage === currentStage) - "Working back to X"
  // 2. Bot was restored/promoted back (from_stage === currentStage) - "Rebuilding after demotion"
  
  const isStillDemoted = demotion.to_stage === currentStage;
  const wasRestoredBack = demotion.from_stage === currentStage;
  
  // Don't show if neither case applies
  if (!isStillDemoted && !wasRestoredBack) return null;

  const tooltipTitle = isStillDemoted 
    ? "Recovery in progress" 
    : "Recently restored after demotion";
  const tooltipMessage = isStillDemoted
    ? `Working back to ${demotion.from_stage}`
    : `Restored. Proving stability.`;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center justify-center w-6 h-5 rounded border",
          "bg-amber-500/20 text-amber-400 border-amber-500/30",
          className
        )}>
          <RotateCcw className="w-3.5 h-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs p-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold border-b border-border pb-1 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            {tooltipTitle}
          </p>
          
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <span className="text-foreground font-medium">Demoted:</span>{" "}
              {demotion.from_stage} → {demotion.to_stage}
            </p>
            <p>
              <span className="text-foreground font-medium">Reason:</span>{" "}
              {getReasonLabel(demotion.reason_code)}
            </p>
            {demotion.reason_detail && (
              <p className="text-[11px] italic text-muted-foreground/80">
                {demotion.reason_detail}
              </p>
            )}
            <p>
              <span className="text-foreground font-medium">When:</span>{" "}
              {formatDistanceToNow(demotionDate, { addSuffix: true })}
            </p>
          </div>
          
          <div className="pt-1 border-t border-border">
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              {tooltipMessage}
            </p>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
