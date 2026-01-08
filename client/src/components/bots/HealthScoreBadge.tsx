/**
 * Health Score Badge - COMPACT ICON-ONLY VERSION
 * 
 * Uses unified health constants. Only shows badge when there's a problem:
 * - STARTING: Bot just promoted, initializing
 * - HEALING: Auto-recovery in progress
 * - BLOCKED: Critical blockers prevent operation
 * - DEGRADED: Score < 40 after heal attempts exhausted
 * - WARN: Score 40-60 or warning issues
 * - OK: No badge shown (clean UI principle)
 */
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, Ban, Loader2, PlayCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { HealthState } from "@/lib/canonicalStateEvaluator";
import { 
  getDisplayHealthState, 
  HEALTH_DISPLAY_COLORS,
  HEALTH_REASON_LABELS,
  type DisplayHealthState,
  type HealthReasonCode
} from "@/lib/healthConstants";

interface HealthScoreBadgeProps {
  score: number;
  state: HealthState;
  reason?: string;
  reasonCode?: string | null;
  hasCriticalBlockers?: boolean;
  promotedAt?: string | Date | null;
  isHealing?: boolean;
  autoHealAttempts?: number;
  className?: string;
}

export function HealthScoreBadge({ 
  score, 
  state, 
  reason, 
  reasonCode,
  hasCriticalBlockers = false,
  promotedAt,
  isHealing = false,
  autoHealAttempts = 0,
  className 
}: HealthScoreBadgeProps) {
  const displayState = getDisplayHealthState(state, score, hasCriticalBlockers, {
    promotedAt,
    isHealing,
    autoHealAttempts,
  });

  // Only show badge when there's a problem (clean UI principle)
  // But always show STARTING and HEALING states as they are informative
  if (displayState === 'OK') return null;

  const colors = HEALTH_DISPLAY_COLORS[displayState];
  
  // Select appropriate icon
  const Icon = displayState === 'STARTING'
    ? PlayCircle
    : displayState === 'HEALING'
      ? Loader2
      : displayState === 'BLOCKED' 
        ? Ban 
        : displayState === 'DEGRADED' 
          ? AlertCircle 
          : AlertTriangle;

  const isAnimated = displayState === 'STARTING' || displayState === 'HEALING';

  // Get reason label if available
  const reasonLabel = reasonCode && reasonCode in HEALTH_REASON_LABELS 
    ? HEALTH_REASON_LABELS[reasonCode as HealthReasonCode] 
    : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "flex items-center justify-center w-6 h-5 rounded border cursor-help",
            colors.text,
            colors.bg,
            colors.border,
            className
          )}
        >
          <Icon className={cn(
            "w-3.5 h-3.5", 
            isAnimated && (displayState === 'HEALING' ? "animate-spin" : "animate-pulse")
          )} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs space-y-1">
          <div className="font-medium flex items-center gap-2">
            <span>Health: {score}/100</span>
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[10px]",
              colors.bg, colors.text
            )}>
              {colors.label}
            </span>
          </div>
          
          {displayState === 'STARTING' && (
            <div className="text-blue-400 flex items-center gap-1">
              <PlayCircle className="w-3 h-3" />
              Bot starting up after promotion. Runner initializing...
            </div>
          )}
          
          {displayState === 'HEALING' && (
            <div className="text-cyan-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Auto-healing in progress (attempt {autoHealAttempts + 1}/3)
            </div>
          )}
          
          {/* Show reason with label if available */}
          {reasonLabel && (
            <div className="pt-1 border-t border-border/30">
              <span className="text-foreground font-medium">{reasonLabel.title}</span>
              <div className="text-muted-foreground">{reasonLabel.description}</div>
              {reasonLabel.action && (
                <div className={cn("mt-0.5", colors.text)}>{reasonLabel.action}</div>
              )}
            </div>
          )}
          
          {reason && !reasonLabel && (
            <div className="text-muted-foreground">{reason}</div>
          )}
          
          {displayState === 'BLOCKED' && (
            <div className="text-orange-400 text-[10px] pt-1 border-t border-border/30">
              Score is healthy but critical blockers prevent operation
            </div>
          )}
          {displayState === 'DEGRADED' && (
            <div className="text-red-400 text-[10px] pt-1 border-t border-border/30">
              Auto-heal failed after {autoHealAttempts} attempts. Bot may be paused.
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
