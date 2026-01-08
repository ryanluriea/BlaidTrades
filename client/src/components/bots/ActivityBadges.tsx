/**
 * Activity Badges - COMPACT ICON-ONLY VERSION
 * 
 * Badge Lane Rules (G in spec):
 * - Runner | Backtests | Evolution | Health separate lanes
 * - NEVER show "OK" badges - clean UI
 * - PAUSED + QUEUED together is FORBIDDEN
 * - Icon-only badges with rich tooltips
 * - Shows run time next to activity icon (e.g., 🔍 3s)
 */
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Pause, 
  Search, 
  TrendingUp, 
  FlaskConical, 
  Brain, 
  AlertCircle,
  XCircle,
  AlertTriangle,
  Clock
} from "lucide-react";
import type { JobsSummary } from "@/hooks/useBotRunnerAndJobs";
import { useServerClock } from "@/contexts/ServerClockContext";

interface ActivityBadgesProps {
  /** Primary activity state from runner instance */
  activityState: string | null;
  /** Execution mode - only shown when trading */
  executionMode: string | null;
  /** Concurrent jobs (backtests, evaluations, training, evolving) */
  jobs: JobsSummary;
  /** Bot stage for truthful status */
  stage?: string;
  /** Does the bot have an attached account? */
  hasAccount?: boolean;
  /** Bot health status - if DEGRADED, override activity to show STALLED */
  healthStatus?: "OK" | "WARN" | "DEGRADED";
  /** Pause scope from improvement state */
  pauseScope?: 'EVOLUTION_ONLY' | 'ALL' | null;
  /** Who paused (AUTO vs USER) */
  pausedBy?: 'AUTO' | 'USER' | null;
  /** Last runner tick timestamp - shown next to activity icon */
  lastRunAt?: string | null;
  /** Last job completed timestamp - for TRIALS idle display */
  lastJobAt?: string | null;
  /** Idle reason code for TRIALS bots (e.g., "WAITING_INTERVAL", "BACKTEST_DUE") */
  idleReasonCode?: string | null;
  /** Minutes until next expected work for TRIALS bots */
  nextRunMinutes?: number | null;
  className?: string;
}

function formatRunTime(dateStr: string | null | undefined, serverNow: number): string | null {
  if (!dateStr) return null;
  const seconds = Math.floor((serverNow - new Date(dateStr).getTime()) / 1000);
  if (seconds < 0) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Format elapsed time for running jobs - more detailed format like "1m 32s", "1hr 5m"
 */
function formatElapsedTime(startedAt: string | null | undefined, serverNow: number): string | null {
  if (!startedAt) return null;
  const totalSeconds = Math.floor((serverNow - new Date(startedAt).getTime()) / 1000);
  if (totalSeconds < 0) return "0s";
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return minutes > 0 ? `${hours}hr ${minutes}m` : `${hours}hr`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

interface ActivityConfig {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  animate?: boolean;
  isBug?: boolean;
}

const STAGE_TO_EXPECTED_MODE: Record<string, string> = {
  TRIALS: 'BACKTEST_ONLY',
  PAPER: 'SIM_LIVE',
  SHADOW: 'SHADOW',
  CANARY: 'CANARY',
  LIVE: 'LIVE',
};

const activityConfig: Record<string, ActivityConfig> = {
  IDLE: { 
    icon: Pause, 
    label: "Idle", 
    color: "text-muted-foreground", 
    bgColor: "bg-muted/30", 
    borderColor: "border-muted/50" 
  },
  NO_RUNNER: {
    icon: XCircle,
    label: "No Runner",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    isBug: true
  },
  DESYNC: {
    icon: AlertTriangle,
    label: "Desync",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    isBug: true
  },
  NO_ACCOUNT: {
    icon: AlertCircle,
    label: "No Account",
    color: "text-muted-foreground",
    bgColor: "bg-muted/30",
    borderColor: "border-muted/50"
  },
  BACKTEST_ONLY: {
    icon: Brain,
    label: "Backtest Only",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30"
  },
  SCANNING: { 
    icon: Search, 
    label: "Scanning", 
    color: "text-blue-400", 
    bgColor: "bg-blue-500/10", 
    borderColor: "border-blue-500/30",
    animate: true
  },
  TRADING: { 
    icon: TrendingUp, 
    label: "Trading", 
    color: "text-emerald-400", 
    bgColor: "bg-emerald-500/10", 
    borderColor: "border-emerald-500/30",
    animate: true
  },
  BACKTESTING: { 
    icon: FlaskConical, 
    label: "Backtesting", 
    color: "text-purple-400", 
    bgColor: "bg-purple-500/10", 
    borderColor: "border-purple-500/30",
    animate: true
  },
  EVALUATING: { 
    icon: Brain, 
    label: "Evaluating", 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10", 
    borderColor: "border-amber-500/30",
    animate: true
  },
  ERROR: { 
    icon: AlertCircle, 
    label: "Error", 
    color: "text-red-400", 
    bgColor: "bg-red-500/10", 
    borderColor: "border-red-500/30" 
  },
  PAUSED: { 
    icon: Pause, 
    label: "Paused", 
    color: "text-amber-400", 
    bgColor: "bg-amber-500/10", 
    borderColor: "border-amber-500/30" 
  },
  EVOLUTION_PAUSED: {
    icon: Pause,
    label: "Evolution Paused",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30"
  },
  STALLED: { 
    icon: AlertCircle, 
    label: "Stalled", 
    color: "text-orange-400", 
    bgColor: "bg-orange-500/10", 
    borderColor: "border-orange-500/30" 
  },
  WAITING_MARKET: {
    icon: Clock,
    label: "Market Closed",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30"
  },
  MARKET_CLOSED: {
    icon: Clock,
    label: "Market Closed",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30"
  },
};

const executionModeLabels: Record<string, string> = {
  SIM_LIVE: "SIM",
  SHADOW: "SHADOW",
  LIVE: "LIVE",
  BACKTEST_ONLY: "BT",
};

function computeTruthfulState(
  stage: string | undefined,
  executionMode: string | null,
  activityState: string | null,
  hasAccount: boolean | undefined,
  healthStatus?: string
): string {
  const normalizedActivity = activityState?.toUpperCase() || "IDLE";
  const shouldBeScanning = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage || '');
  const expectedMode = STAGE_TO_EXPECTED_MODE[stage || 'TRIALS'] || 'BACKTEST_ONLY';

  if (healthStatus === "DEGRADED" && shouldBeScanning) {
    return 'STALLED';
  }

  if (stage === 'TRIALS') {
    if (normalizedActivity === 'BACKTESTING') return 'BACKTESTING';
    if (normalizedActivity === 'EVALUATING') return 'EVALUATING';
    return 'IDLE';
  }

  if (shouldBeScanning && !executionMode) {
    if (hasAccount === false) return 'NO_ACCOUNT';
    return 'NO_RUNNER';
  }

  if (shouldBeScanning && executionMode && executionMode !== expectedMode) {
    return 'DESYNC';
  }

  if (['SCANNING', 'TRADING', 'PAUSED', 'ERROR', 'STALLED', 'BACKTESTING', 'EVALUATING'].includes(normalizedActivity)) {
    return normalizedActivity;
  }

  if (shouldBeScanning && normalizedActivity === 'IDLE') {
    return 'IDLE';
  }

  return 'IDLE';
}

// Map idle reason codes to human-readable descriptions
const IDLE_REASON_LABELS: Record<string, string> = {
  NEEDS_BASELINE: "Needs initial backtest",
  BACKTEST_DUE: "Backtest interval reached",
  IMPROVE_DUE: "Improvement cycle ready",
  EVOLVE_DUE: "Evolution cycle ready",
  WAITING_INTERVAL: "Waiting for next interval",
  UNKNOWN: "Scheduling next work",
};

export function ActivityBadges({ 
  activityState, 
  executionMode, 
  jobs,
  stage,
  hasAccount,
  healthStatus,
  pauseScope,
  pausedBy,
  lastRunAt,
  lastJobAt,
  idleReasonCode,
  nextRunMinutes,
  className 
}: ActivityBadgesProps) {
  const { serverNow } = useServerClock();
  const runTime = formatRunTime(lastRunAt, serverNow);
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const runAge = lastRunAt ? serverNow - new Date(lastRunAt).getTime() : null;
  const isRunStale = runAge !== null && runAge >= FIVE_MINUTES_MS;
  const activities: Array<{ 
    key: string; 
    config: ActivityConfig; 
    tooltipContent: string;
    showMode?: string;
    count?: number;
    elapsedTime?: string | null;
    meta?: { running: number; queued: number };
  }> = [];
  
  // Handle pause_scope: if EVOLUTION_ONLY, show that badge separately
  if (pauseScope === 'EVOLUTION_ONLY') {
    activities.push({
      key: 'EVOLUTION_PAUSED',
      config: activityConfig.EVOLUTION_PAUSED,
      tooltipContent: `Evolution paused${pausedBy === 'AUTO' ? ' (auto)' : ''}`,
    });
  }
  
  const primaryState = computeTruthfulState(stage, executionMode, activityState, hasAccount, healthStatus);
  const primaryConfig = activityConfig[primaryState] || activityConfig.IDLE;
  
  const isTrading = primaryState === "TRADING";
  const modeSuffix = isTrading && executionMode ? executionModeLabels[executionMode] : undefined;
  
  const hasRunningJobs = jobs.backtestsRunning > 0 || jobs.evolvingRunning > 0 || jobs.evaluating;
  const hasQueuedJobs = jobs.backtestsQueued > 0 || jobs.evolvingQueued > 0;
  
  const isLowPriorityState = ["IDLE", "BACKTEST_ONLY"].includes(primaryState);
  const isPausedWithJobs = primaryState === "PAUSED" && (hasQueuedJobs || hasRunningJobs);
  const shouldShowPrimaryState = !(isLowPriorityState && (hasRunningJobs || hasQueuedJobs)) && !isPausedWithJobs;
  
  const isLabWithoutJobs = stage === 'TRIALS' && !hasRunningJobs && !hasQueuedJobs && primaryState === 'IDLE';
  
  // Show special idle badge for TRIALS bots with idle reason and next run time
  if (isLabWithoutJobs) {
    const lastJobTime = lastJobAt ? formatRunTime(lastJobAt, serverNow) : null;
    const reasonLabel = idleReasonCode ? IDLE_REASON_LABELS[idleReasonCode] || idleReasonCode : "Scheduling";
    const nextRunText = nextRunMinutes !== null && nextRunMinutes !== undefined
      ? (nextRunMinutes <= 0 ? "due now" : `in ${nextRunMinutes}m`)
      : null;
    
    activities.push({
      key: 'TRIALS_IDLE',
      config: {
        icon: Clock,
        label: nextRunText ? `Next ${nextRunText}` : "Idle",
        color: nextRunMinutes !== null && nextRunMinutes <= 0 ? "text-amber-400" : "text-muted-foreground",
        bgColor: nextRunMinutes !== null && nextRunMinutes <= 0 ? "bg-amber-500/10" : "bg-muted/30",
        borderColor: nextRunMinutes !== null && nextRunMinutes <= 0 ? "border-amber-500/30" : "border-muted/50",
      },
      tooltipContent: `${reasonLabel}${lastJobTime ? ` | Last: ${lastJobTime}` : ''}`,
    });
  }
  
  if (shouldShowPrimaryState && !isLabWithoutJobs) {
    let tooltip = `Bot is ${primaryConfig.label.toLowerCase()}`;
    if (primaryConfig.isBug) {
      tooltip = `⚠️ ${primaryConfig.label} - auto-heal should fix this`;
    }
    
    activities.push({
      key: primaryState,
      config: primaryConfig,
      tooltipContent: tooltip,
      showMode: modeSuffix,
    });
  }

  // Show backtest jobs - with elapsed time when running
  const totalBacktests = jobs.backtestsRunning + jobs.backtestsQueued;
  if (totalBacktests > 0 && primaryState !== "BACKTESTING") {
    const isRunning = jobs.backtestsRunning > 0;
    const backtestElapsed = isRunning ? formatElapsedTime(jobs.backtestStartedAt, serverNow) : null;
    activities.push({
      key: `BACKTEST_COMBINED_${totalBacktests}`,
      config: {
        icon: FlaskConical,
        label: "Backtesting",
        color: "text-purple-400",
        bgColor: "bg-purple-500/10",
        borderColor: "border-purple-500/30",
        animate: isRunning,
      },
      tooltipContent: `${jobs.backtestsRunning} running${jobs.backtestsQueued > 0 ? `, ${jobs.backtestsQueued} queued` : ''}`,
      count: totalBacktests > 1 ? totalBacktests : undefined,
      elapsedTime: backtestElapsed,
      meta: { running: jobs.backtestsRunning, queued: jobs.backtestsQueued },
    });
  }

  // Show evolution jobs - with elapsed time when running
  const totalEvolutions = jobs.evolvingRunning + jobs.evolvingQueued;
  if (totalEvolutions > 0) {
    const isRunning = jobs.evolvingRunning > 0;
    const evolveElapsed = isRunning ? formatElapsedTime(jobs.evolveStartedAt, serverNow) : null;
    activities.push({
      key: `EVOLVE_COMBINED_${totalEvolutions}`,
      config: {
        icon: Brain,
        label: "Evolving",
        color: "text-cyan-400",
        bgColor: "bg-cyan-500/10",
        borderColor: "border-cyan-500/30",
        animate: isRunning,
      },
      tooltipContent: `${jobs.evolvingRunning} running${jobs.evolvingQueued > 0 ? `, ${jobs.evolvingQueued} queued` : ''}`,
      count: totalEvolutions > 1 ? totalEvolutions : undefined,
      elapsedTime: evolveElapsed,
      meta: { running: jobs.evolvingRunning, queued: jobs.evolvingQueued },
    });
  }

  // Show evaluation
  if (jobs.evaluating && primaryState !== "EVALUATING") {
    activities.push({
      key: "EVALUATING_JOB",
      config: activityConfig.EVALUATING,
      tooltipContent: "Graduation engine evaluating bot",
    });
  }

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {activities.map(({ key, config, tooltipContent, showMode, count, elapsedTime }, index) => {
        const Icon = config.icon;
        
        // Show run time on primary activity badge (first one, if it's a running state)
        const isPrimaryRunningState = index === 0 && ['SCANNING', 'TRADING'].includes(key);
        const showRunTime = isPrimaryRunningState && runTime;
        
        // Determine if we need extra width for mode/count/bug icon/time/elapsed
        const needsExtraWidth = showMode || count || config.isBug || showRunTime || elapsedTime;
        
        return (
          <Tooltip key={key}>
            <TooltipTrigger asChild>
              <span className={cn(
                "flex items-center justify-center rounded border h-5",
                needsExtraWidth ? "gap-0.5 px-1.5" : "w-6",
                config.color,
                config.bgColor,
                config.borderColor,
                isRunStale && isPrimaryRunningState && "border-yellow-500/50"
              )}>
                {config.isBug && <AlertTriangle className="w-2.5 h-2.5" />}
                <Icon className={cn(
                  "w-3.5 h-3.5",
                  config.animate && "animate-pulse"
                )} />
                {/* Show run time for scanning/trading */}
                {showRunTime && (
                  <span className={cn(
                    "text-[9px] font-mono",
                    isRunStale ? "text-yellow-400" : ""
                  )}>{runTime}</span>
                )}
                {/* Show mode abbreviation for trading */}
                {showMode && (
                  <span className="text-[9px] font-medium">{showMode}</span>
                )}
                {/* Show elapsed time for running jobs */}
                {elapsedTime && (
                  <span className="text-[9px] font-mono">{elapsedTime}</span>
                )}
                {/* Show count for backtests if > 1 */}
                {count && !elapsedTime && (
                  <span className="text-[9px] font-mono">{count}</span>
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs max-w-xs">
              <div className="font-medium">{config.label}</div>
              <div className="text-muted-foreground">{tooltipContent}</div>
              {showRunTime && lastRunAt && (
                <div className="text-muted-foreground mt-1">
                  Last run: {new Date(lastRunAt).toLocaleTimeString()}
                  {isRunStale && <span className="text-yellow-400 ml-1">(stale)</span>}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
