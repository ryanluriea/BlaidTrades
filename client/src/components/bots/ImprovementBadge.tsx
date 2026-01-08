import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, Pause, CheckCircle, Timer, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImprovementState } from "@/hooks/useImprovementState";
import { formatDistanceToNow } from "date-fns";
import { useServerClock } from "@/contexts/ServerClockContext";

interface ImprovementBadgeProps {
  state: ImprovementState | null | undefined;
  /** If provided, ensures READY is only shown when gates are actually met */
  graduationEligible?: boolean | null;
  /** Does the bot have an EVOLVE job running or queued? */
  hasEvolveJob?: boolean;
  /** When the evolve job started (for elapsed time display) */
  evolveStartedAt?: string | null;
  className?: string;
}

// Get cooldown tier label based on consecutive failures
function getCooldownTier(consecutiveFailures: number): string {
  if (consecutiveFailures <= 5) return "Fast";
  if (consecutiveFailures <= 10) return "Normal";
  if (consecutiveFailures <= 20) return "Slow";
  if (consecutiveFailures <= 50) return "Very Slow";
  return "Minimal";
}

// Format gate values with appropriate units
function formatGateValue(gate: string | undefined, value: number): string {
  if (!gate) return String(value);
  const g = gate.toUpperCase();
  if (g.includes('WIN_RATE') || g.includes('RATE')) return `${value.toFixed(1)}%`;
  if (g.includes('DRAWDOWN')) return `$${value.toLocaleString()}`;
  if (g.includes('PROFIT_FACTOR') || g.includes('SHARPE')) return value.toFixed(2);
  return String(value);
}

export function ImprovementBadge({ state, graduationEligible, hasEvolveJob, evolveStartedAt, className }: ImprovementBadgeProps) {
  // State for real-time elapsed time
  const [elapsedTime, setElapsedTime] = useState<string | null>(null);
  const { serverNow } = useServerClock();

  // Calculate elapsed time for evolving (with clock skew protection)
  const getElapsedTime = () => {
    if (!evolveStartedAt) return null;
    const started = new Date(evolveStartedAt);
    const rawDiffMs = serverNow - started.getTime();
    // CRITICAL: Clamp to 0 to prevent negative elapsed times (clock skew protection)
    const diffMs = Math.max(0, rawDiffMs);
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    
    if (diffMins >= 60) {
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      return `${hours}h ${mins}m`;
    }
    if (diffMins > 0) {
      return `${diffMins}m ${diffSecs}s`;
    }
    return `${diffSecs}s`;
  };

  // Update elapsed time when serverNow changes (ticks every second via context)
  useEffect(() => {
    if (!hasEvolveJob || !evolveStartedAt) {
      setElapsedTime(null);
      return;
    }
    
    // Update elapsed time using server-synchronized clock
    setElapsedTime(getElapsedTime());
  }, [hasEvolveJob, evolveStartedAt, serverNow]);

  // Don't show anything if no state OR if status is IDLE - avoids duplicate with ActivityBadges "Idle"
  if (!state || state.status === 'IDLE') {
    return null;
  }
  
  // Normalize property access FIRST to handle both camelCase (interface) and snake_case (API payload)
  // This must happen before the guard check so cooldown detection works with either format
  const nextRetryAt = state.nextRetryAt ?? (state as any).next_retry_at;
  const lastFailureCategory = state.lastFailureCategory ?? (state as any).last_failure_category;
  const attemptsUsed = state.attemptsUsed ?? (state as any).attempts_used ?? 0;
  const consecutiveFailures = state.consecutiveFailures ?? (state as any).consecutive_failures ?? 0;
  const lastImprovementAt = state.lastImprovementAt ?? (state as any).last_improvement_at;
  const nextAction = state.nextAction ?? (state as any).next_action;
  const whyNotPromoted = state.whyNotPromoted ?? (state as any).why_not_promoted;
  const notes = state.notes;
  
  // Hide only the "IMPROVING + evolving" case since the grid box handles it
  // But preserve PAUSED, GRADUATED_READY, and cooldown displays
  // Uses normalized nextRetryAt to ensure cooldown detection works with both property naming conventions
  if (hasEvolveJob && state.status === 'IMPROVING') {
    const isInCooldownCheck = nextRetryAt && new Date(nextRetryAt) > new Date();
    // Still show if in cooldown (important UX feedback)
    if (!isInCooldownCheck) {
      return null;
    }
  }
  
  // Check if in cooldown
  const isInCooldown = nextRetryAt && new Date(nextRetryAt) > new Date();
  const cooldownTier = getCooldownTier(consecutiveFailures);

  const getStatusConfig = () => {
    // Special handling for cooldown state
    if (state.status === 'IMPROVING' && isInCooldown) {
      const timeUntil = formatDistanceToNow(new Date(nextRetryAt!), { addSuffix: false });
      return {
        icon: Timer,
        colorClass: 'bg-orange-500/20 border-orange-500/30',
        iconColor: 'text-orange-400',
        tooltipTitle: `Cooldown (${cooldownTier})`,
        tooltipDesc: `Next attempt in ${timeUntil}`,
      };
    }

    switch (state.status) {
      case 'IMPROVING':
        return {
          icon: Sparkles,
          colorClass: hasEvolveJob 
            ? 'bg-cyan-500/20 border-cyan-500/30' 
            : 'bg-blue-500/20 border-blue-500/30',
          iconColor: hasEvolveJob ? 'text-cyan-400' : 'text-blue-400',
          tooltipTitle: hasEvolveJob ? 'Evolving' : 'Improving',
          tooltipDesc: hasEvolveJob 
            ? `Running evolution cycle`
            : `Waiting for backtest`,
          animate: hasEvolveJob,
        };
      case 'PAUSED':
        return {
          icon: Pause,
          colorClass: 'bg-yellow-500/20 border-yellow-500/30',
          iconColor: 'text-yellow-400',
          tooltipTitle: 'Paused',
          tooltipDesc: 'Improvement paused by user',
        };
      case 'GRADUATED_READY':
        // Only show READY if current computed gates actually confirm eligibility
        if (graduationEligible === false) {
          return null;
        }
        return {
          icon: CheckCircle,
          colorClass: 'bg-green-500/20 border-green-500/30',
          iconColor: 'text-green-400',
          tooltipTitle: 'Ready',
          tooltipDesc: 'Ready for promotion to Paper',
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig();
  
  if (!config) {
    return null;
  }
  
  const Icon = config.icon;
  const failureLabel = lastFailureCategory 
    ? lastFailureCategory.replace(/_/g, ' ')
    : null;

  // Calculate improvement duration (with clock skew protection)
  const getCompactDuration = () => {
    if (!lastImprovementAt) return null;
    const started = new Date(lastImprovementAt);
    const rawDiffMs = serverNow - started.getTime();
    // CRITICAL: Clamp to 0 to prevent negative elapsed times
    const diffMs = Math.max(0, rawDiffMs);
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins >= 1440) {
      const days = Math.floor(diffMins / 1440);
      return `${days}d`;
    }
    if (diffMins >= 60) {
      const hours = Math.floor(diffMins / 60);
      return `${hours}h`;
    }
    if (diffMins > 0) {
      return `${diffMins}m`;
    }
    return '<1m';
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center justify-center w-6 h-5 rounded border",
          config.colorClass,
          className
        )}>
          <Icon className={cn(
            "w-3.5 h-3.5",
            config.iconColor,
            config.animate && "animate-pulse"
          )} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm p-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold border-b border-border pb-1">{config.tooltipTitle}</p>
          <p className="text-xs text-muted-foreground">{config.tooltipDesc}</p>
          
          {state.status === 'IMPROVING' && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                <span className="font-medium text-foreground">Attempt #{attemptsUsed}</span>
                {consecutiveFailures > 0 && (
                  <span className="text-orange-400"> • {consecutiveFailures} consecutive fails</span>
                )}
              </p>
              
              {elapsedTime && (
                <p>Elapsed: <span className="text-foreground font-medium">{elapsedTime}</span></p>
              )}
              
              {!elapsedTime && lastImprovementAt && (
                <p>Duration: <span className="text-foreground font-medium">{getCompactDuration()}</span></p>
              )}
              
              {isInCooldown && nextRetryAt && (
                <p className="text-orange-400 flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  Next retry: {formatDistanceToNow(new Date(nextRetryAt), { addSuffix: true })}
                </p>
              )}
            </div>
          )}
          
          {/* Show what gates are failing */}
          {state.status === 'IMPROVING' && whyNotPromoted && (
            <div className="text-[11px] pt-2 border-t border-border">
              <p className="font-medium text-foreground mb-1.5">Improving gates:</p>
              <div className="space-y-1">
                {Array.isArray(whyNotPromoted) ? (
                  (whyNotPromoted as Array<{gate: string; actual?: number; threshold?: number}>).map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{item.gate?.replace(/_/g, ' ') || `Gate ${idx}`}</span>
                      <span className="text-red-400 font-mono">
                        {item.actual !== undefined ? formatGateValue(item.gate, item.actual) : '—'}
                        {item.threshold !== undefined && (
                          <span className="text-muted-foreground"> / {formatGateValue(item.gate, item.threshold)}</span>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  Object.entries(whyNotPromoted as Record<string, any>).map(([gate, info]) => (
                    <div key={gate} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{gate.replace(/_/g, ' ')}</span>
                      {typeof info === 'object' && info !== null ? (
                        <span className="text-red-400 font-mono">
                          {info.current !== undefined ? `${info.current}` : info.actual !== undefined ? `${info.actual}` : '—'} 
                          {(info.required !== undefined || info.threshold !== undefined) && (
                            <span className="text-muted-foreground"> / {info.required ?? info.threshold}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-red-400">{String(info)}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {state.status === 'PAUSED' && (
            <div className="text-xs text-muted-foreground space-y-1">
              {notes ? (
                <p className="text-amber-400">{notes}</p>
              ) : (
                <p>Evolution paused. Resume to continue improving.</p>
              )}
              {consecutiveFailures > 0 && (
                <p className="text-orange-400">{consecutiveFailures} failures before pause</p>
              )}
            </div>
          )}
          
          {state.status === 'GRADUATED_READY' && (
            <p className="text-xs text-muted-foreground">
              Bot graduated from TRIALS and is ready for Paper.
            </p>
          )}
          
          {state.status !== 'PAUSED' && failureLabel && (
            <p className="text-xs text-amber-400 flex items-center gap-1 pt-2 border-t border-border">
              <AlertTriangle className="w-3 h-3" />
              Last issue: {failureLabel}
            </p>
          )}
          {nextAction && state.status !== 'PAUSED' && (
            <p className="text-xs text-muted-foreground mt-1">
              Next: <span className="text-cyan-400">{nextAction.replace(/_/g, ' ')}</span>
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
