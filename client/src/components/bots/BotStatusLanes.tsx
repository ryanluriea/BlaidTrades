import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { 
  Play, 
  Pause, 
  AlertCircle, 
  Search, 
  TrendingUp,
  FlaskConical,
  Brain,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  Loader2,
  CheckCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { JobsSummary } from "@/hooks/useBotRunnerAndJobs";

interface BotStatusLanesProps {
  // Runner lane
  mode: string | null;
  activityState: string | null;
  lastHeartbeat?: string | null;
  accountName?: string | null;
  
  // Backtest lane
  jobs: JobsSummary;
  
  // Health lane
  healthStatus?: "OK" | "WARN" | "DEGRADED";
  healthReason?: string | null;
  stage?: string;
  
  // Actions
  onStartRunner?: () => void;
  onRestartRunner?: () => void;
  onResumeRunner?: () => void;
  isStarting?: boolean;
  
  className?: string;
}

/**
 * THREE SEPARATE BADGE LANES:
 * 1. Runner Lane: Shows execution loop status (Scanning/Trading/Paused/None)
 * 2. Backtest Lane: Shows backtest jobs (Running/Queued/None)
 * 3. Health Lane: Shows only degraded/warning states with reason + fix button
 * 
 * RULE: Never show "OK" or "Healthy" - only show problems
 */
export function BotStatusLanes({
  mode,
  activityState,
  lastHeartbeat,
  accountName,
  jobs,
  healthStatus,
  healthReason,
  stage,
  onStartRunner,
  onRestartRunner,
  onResumeRunner,
  isStarting,
  className,
}: BotStatusLanesProps) {
  const normalizedActivity = activityState?.toUpperCase() || "IDLE";
  const isHeartbeatStale = lastHeartbeat && 
    (Date.now() - new Date(lastHeartbeat).getTime()) > 2 * 60 * 1000;

  // RUNNER LANE
  const renderRunnerLane = () => {
    // No runner at all
    if (!mode) {
      // TRIALS bots don't need runners
      if (stage === 'TRIALS') return null;
      
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] bg-muted/30 border-muted/50 text-muted-foreground">
              <XCircle className="w-3 h-3" />
              <span>No Runner</span>
              {onStartRunner && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-4 px-1 ml-1"
                  onClick={onStartRunner}
                  disabled={isStarting}
                >
                  {isStarting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Play className="w-2.5 h-2.5" />}
                </Button>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            No active execution loop. Click to start runner.
          </TooltipContent>
        </Tooltip>
      );
    }

    // Runner exists but stale heartbeat
    if (isHeartbeatStale && healthStatus !== "OK") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] bg-orange-500/10 border-orange-500/30 text-orange-400">
              <AlertTriangle className="w-3 h-3" />
              <span>Stale</span>
              {onRestartRunner && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-4 px-1 ml-1"
                  onClick={onRestartRunner}
                  disabled={isStarting}
                >
                  {isStarting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
                </Button>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">
            Runner heartbeat stale ({lastHeartbeat ? formatDistanceToNow(new Date(lastHeartbeat)) : 'unknown'}). 
            Click to restart.
          </TooltipContent>
        </Tooltip>
      );
    }

    // Active states
    const modeLabels: Record<string, string> = {
      SIM_LIVE: "SIM",
      SHADOW: "SHADOW",
      LIVE: "LIVE",
      BACKTEST_ONLY: "BT",
    };

    const activityConfig: Record<string, { icon: React.ElementType; label: string; color: string; bgColor: string; borderColor: string; animate?: boolean }> = {
      SCANNING: { icon: Search, label: "Scanning", color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/30", animate: true },
      TRADING: { icon: TrendingUp, label: "Trading", color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", animate: true },
      PAUSED: { icon: Pause, label: "Paused", color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30" },
      ERROR: { icon: AlertCircle, label: "Error", color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/30" },
      IDLE: { icon: Clock, label: "Idle", color: "text-muted-foreground", bgColor: "bg-muted/30", borderColor: "border-muted/50" },
    };

    const config = activityConfig[normalizedActivity] || activityConfig.IDLE;
    const Icon = config.icon;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]",
            config.bgColor,
            config.borderColor,
            config.color
          )}>
            <Icon className={cn("w-3 h-3", config.animate && "animate-pulse")} />
            <span>{config.label}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{modeLabels[mode] || mode}</span>
            {normalizedActivity === "PAUSED" && onResumeRunner && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-4 px-1 ml-1"
                onClick={onResumeRunner}
              >
                <Play className="w-2.5 h-2.5" />
              </Button>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          <div>Mode: {mode}</div>
          <div>Activity: {config.label}</div>
          {accountName && <div>Account: {accountName}</div>}
          {lastHeartbeat && <div>Heartbeat: {formatDistanceToNow(new Date(lastHeartbeat), { addSuffix: true })}</div>}
        </TooltipContent>
      </Tooltip>
    );
  };

  // BACKTEST LANE
  const renderBacktestLane = () => {
    const totalBacktests = jobs.backtestsRunning + jobs.backtestsQueued;
    if (totalBacktests === 0) return null;

    const isRunning = jobs.backtestsRunning > 0;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]",
            "bg-purple-500/10 border-purple-500/30 text-purple-400"
          )}>
            <FlaskConical className={cn("w-3 h-3", isRunning && "animate-pulse")} />
            <span>{isRunning ? "Backtesting" : "Queued"}</span>
            {totalBacktests > 1 && (
              <span className="text-muted-foreground">×{totalBacktests}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs">
          {jobs.backtestsRunning > 0 && <div>{jobs.backtestsRunning} running</div>}
          {jobs.backtestsQueued > 0 && <div>{jobs.backtestsQueued} queued</div>}
        </TooltipContent>
      </Tooltip>
    );
  };

  // EVOLVING LANE
  const renderEvolvingLane = () => {
    const totalEvolving = jobs.evolvingRunning + jobs.evolvingQueued;
    if (totalEvolving === 0 && !jobs.evaluating) return null;

    if (jobs.evaluating) {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-400">
          <Brain className="w-3 h-3 animate-pulse" />
          <span>Evaluating</span>
        </span>
      );
    }

    if (totalEvolving > 0) {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-400">
          <Brain className={cn("w-3 h-3", jobs.evolvingRunning > 0 && "animate-pulse")} />
          <span>Evolving</span>
          {totalEvolving > 1 && <span className="text-muted-foreground">×{totalEvolving}</span>}
        </span>
      );
    }

    return null;
  };

  // HEALTH LANE - Only show problems, never "OK"
  const renderHealthLane = () => {
    if (healthStatus === "OK" || !healthStatus) return null;

    const config = {
      WARN: { icon: AlertTriangle, color: "text-amber-400", bgColor: "bg-amber-500/10", borderColor: "border-amber-500/30" },
      DEGRADED: { icon: AlertCircle, color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/30" },
    }[healthStatus] || { icon: AlertCircle, color: "text-muted-foreground", bgColor: "bg-muted/30", borderColor: "border-muted/50" };

    const Icon = config.icon;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px]",
            config.bgColor,
            config.borderColor,
            config.color
          )}>
            <Icon className="w-3 h-3" />
            <span>{healthStatus === "DEGRADED" ? "Degraded" : "Warning"}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-xs">
          <div className="font-medium">Health Issue</div>
          {healthReason && <div className="text-muted-foreground mt-1">{healthReason}</div>}
          {onRestartRunner && (
            <div className="mt-2 pt-2 border-t border-border/30">
              <button 
                onClick={onRestartRunner}
                className="text-primary hover:underline"
              >
                Click to auto-heal
              </button>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {renderRunnerLane()}
      {renderBacktestLane()}
      {renderEvolvingLane()}
      {renderHealthLane()}
    </div>
  );
}
