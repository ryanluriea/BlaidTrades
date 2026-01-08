/**
 * WhyNotTradingBadge - Single sentence explanation for why a bot isn't trading
 * Shows a human-readable reason with appropriate styling
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Clock, 
  AlertTriangle, 
  PauseCircle, 
  Loader2, 
  XCircle,
  Zap,
  TrendingUp,
  Shield,
  Timer
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanonicalBotState } from "@/lib/canonicalStateEvaluator";
import { formatDistanceToNow } from "date-fns";

interface WhyNotTradingBadgeProps {
  state: CanonicalBotState;
  stage: string;
  className?: string;
}

interface StatusConfig {
  icon: React.ElementType;
  label: string;
  description: string;
  color: string;
}

function getStatusConfig(state: CanonicalBotState, stage: string): StatusConfig {
  // Check for trading first
  if (state.runner_state === 'TRADING') {
    return {
      icon: TrendingUp,
      label: 'Trading',
      description: 'Currently in an active trade',
      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    };
  }

  // Check for scanning
  if (state.runner_state === 'SCANNING') {
    return {
      icon: Zap,
      label: 'Scanning',
      description: 'Monitoring market for entry signals',
      color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
  }

  // LAB stage
  if (stage === 'TRIALS') {
    if (state.job_state === 'BACKTEST_RUNNING') {
      return {
        icon: Loader2,
        label: 'Backtesting',
        description: 'Running backtest simulation',
        color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      };
    }
    if (state.job_state === 'EVOLVING') {
      return {
        icon: Loader2,
        label: 'Evolving',
        description: 'Improving strategy parameters',
        color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      };
    }
    return {
      icon: Clock,
      label: 'TRIALS mode',
      description: 'Backtesting and evolution only',
      color: 'bg-muted text-muted-foreground border-border',
    };
  }

  // Circuit breaker
  if (state.runner_state === 'CIRCUIT_BREAK') {
    return {
      icon: Shield,
      label: 'Circuit break',
      description: 'Too many restarts - cooling down',
      color: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
  }

  // User paused
  if (state.runner_state === 'PAUSED') {
    return {
      icon: PauseCircle,
      label: 'Paused by user',
      description: 'Manually paused - resume to continue',
      color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    };
  }

  // Stalled
  if (state.runner_state === 'STALLED') {
    return {
      icon: AlertTriangle,
      label: 'Runner stalled',
      description: 'Heartbeat missing - auto-restart pending',
      color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    };
  }

  // Starting/restarting
  if (state.runner_state === 'STARTING' || state.runner_state === 'RESTARTING') {
    return {
      icon: Loader2,
      label: state.runner_state === 'STARTING' ? 'Starting' : 'Restarting',
      description: 'Runner initializing...',
      color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    };
  }

  // Error
  if (state.runner_state === 'ERROR') {
    return {
      icon: XCircle,
      label: 'Error',
      description: state.runner_reason || 'Runner in error state',
      color: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
  }

  // No runner
  if (state.runner_state === 'NO_RUNNER') {
    return {
      icon: Clock,
      label: 'No runner',
      description: 'Start runner to begin trading',
      color: 'bg-muted text-muted-foreground border-border',
    };
  }

  // Stopped
  if (state.runner_state === 'STOPPED') {
    return {
      icon: PauseCircle,
      label: 'Stopped',
      description: 'Runner stopped',
      color: 'bg-muted text-muted-foreground border-border',
    };
  }

  // Default
  return {
    icon: Clock,
    label: 'Waiting',
    description: 'Waiting for conditions',
    color: 'bg-muted text-muted-foreground border-border',
  };
}

export function WhyNotTradingBadge({ state, stage, className }: WhyNotTradingBadgeProps) {
  const config = getStatusConfig(state, stage);
  const Icon = config.icon;
  const isAnimated = Icon === Loader2;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className={cn(
            "text-[10px] px-2 py-0.5 gap-1.5 h-5 cursor-help",
            config.color,
            className
          )}
        >
          <Icon className={cn("w-3 h-3", isAnimated && "animate-spin")} />
          <span className="font-medium">{config.label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-2">
          <p className="text-xs font-medium">{config.description}</p>
          
          {/* Show blockers if any */}
          {state.why_not_trading.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase">Why not trading:</p>
              {state.why_not_trading.slice(0, 3).map((reason, i) => (
                <p key={i} className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="text-amber-400">•</span> {reason}
                </p>
              ))}
            </div>
          )}

          {/* Show last heartbeat */}
          {state.last_heartbeat_at && (
            <p className="text-[10px] text-muted-foreground/60 pt-1">
              Last heartbeat: {formatDistanceToNow(new Date(state.last_heartbeat_at), { addSuffix: true })}
            </p>
          )}

          {/* Show if auto-healable */}
          {state.is_auto_healable && state.blockers.length > 0 && (
            <p className="text-[10px] text-emerald-400 pt-1">
              ✓ Auto-healing in progress
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
