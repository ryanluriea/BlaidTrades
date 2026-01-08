import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Play, Pause, AlertCircle, Search, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RunnerBadgeProps {
  mode: string | null;
  activityState: string | null;
  /** Real-time runner state from WebSocket - takes precedence when DATA_FROZEN */
  runnerState?: string | null;
  accountName?: string | null;
  lastHeartbeat?: string | null;
  status?: string;
  className?: string;
}

const modeConfig: Record<string, { color: string; bgColor: string; borderColor: string; label: string }> = {
  SIM_LIVE: { 
    color: "text-blue-400", 
    bgColor: "bg-blue-500/10", 
    borderColor: "border-blue-500/30",
    label: "SIM" 
  },
  SHADOW: { 
    color: "text-purple-400", 
    bgColor: "bg-purple-500/10", 
    borderColor: "border-purple-500/30",
    label: "SHADOW" 
  },
  LIVE: { 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10", 
    borderColor: "border-amber-500/30",
    label: "LIVE" 
  },
};

const activityConfig: Record<string, { color: string; dotColor: string; label: string; icon: React.ElementType }> = {
  IDLE: { color: "text-muted-foreground", dotColor: "bg-muted-foreground/50", label: "Idle", icon: Pause },
  SCANNING: { color: "text-blue-400", dotColor: "bg-blue-400", label: "Scanning", icon: Search },
  TRADING: { color: "text-emerald-400", dotColor: "bg-emerald-400", label: "Trading", icon: TrendingUp },
  PAUSED: { color: "text-amber-400", dotColor: "bg-amber-400", label: "Paused", icon: Pause },
  ERROR: { color: "text-red-400", dotColor: "bg-red-400", label: "Error", icon: AlertCircle },
  STALLED: { color: "text-orange-400", dotColor: "bg-orange-400", label: "Stalled", icon: AlertCircle },
  DATA_FROZEN: { color: "text-cyan-400", dotColor: "bg-cyan-400", label: "Scanning for data...", icon: Search },
  MARKET_CLOSED: { color: "text-slate-400", dotColor: "bg-slate-400", label: "Market Closed", icon: Pause },
};

/**
 * Displays the primary runner instance for a bot
 * Shows mode (SIM/SHADOW/LIVE) and current activity (Scanning/Trading/Idle)
 */
export function RunnerBadge({ 
  mode, 
  activityState, 
  runnerState,
  accountName,
  lastHeartbeat,
  status,
  className 
}: RunnerBadgeProps) {
  // No runner case
  if (!mode) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px]",
            "bg-muted/30 border-muted/50 text-muted-foreground",
            className
          )}>
            <span className="font-normal">Runner:</span>
            <span className="font-medium">None</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          <div className="font-medium mb-1">No Active Runner</div>
          <div className="text-muted-foreground">
            This bot has no primary execution loop running. 
            Attach to an account and start the bot to create a runner.
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // INSTITUTIONAL SAFETY: runnerState from WebSocket takes precedence for DATA_FROZEN
  // This ensures real-time data issues are immediately visible to users
  const effectiveState = runnerState?.toUpperCase() === 'DATA_FROZEN' 
    ? 'DATA_FROZEN' 
    : (activityState?.toUpperCase() || "IDLE");
  
  const modeInfo = modeConfig[mode] || modeConfig.SIM_LIVE;
  const activity = activityConfig[effectiveState] || activityConfig.IDLE;
  const isActive = ["SCANNING", "TRADING", "DATA_FROZEN"].includes(effectiveState);
  const ActivityIcon = activity.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px]",
          modeInfo.bgColor,
          modeInfo.borderColor,
          className
        )}>
          <span className="text-muted-foreground font-normal">Runner:</span>
          <span className={cn("font-medium", modeInfo.color)}>{modeInfo.label}</span>
          <span className="text-muted-foreground/50">·</span>
          <div className={cn("flex items-center gap-1", activity.color)}>
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              activity.dotColor,
              isActive && "animate-pulse"
            )} />
            <span>{activity.label}</span>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs space-y-1">
        <div className="font-medium">Primary Execution Loop</div>
        <div>Mode: {modeInfo.label} ({mode})</div>
        <div>Activity: {activity.label}</div>
        {accountName && <div>Account: {accountName}</div>}
        {lastHeartbeat && (
          <div>Last heartbeat: {formatDistanceToNow(new Date(lastHeartbeat), { addSuffix: true })}</div>
        )}
        <div className="text-muted-foreground pt-1 border-t border-border/30 mt-1">
          The runner handles live market scanning and trade execution
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
