/**
 * Bot Status Badge Lanes - COMPACT ICON-ONLY VERSION
 * 
 * Separate badge lanes to prevent visual contradiction:
 * 1. Runner Lane: SCANNING | TRADING | STALLED | STARTING | RESTARTING | ERROR
 * 2. Backtest Lane: BT Running | BT Queued(n)
 * 3. Evolution Lane: Evolving | Tournament | Mutation Pending | Cooldown
 * 4. Health Lane: Health score (only if <80)
 * 
 * RULES:
 * - NO "OK" badges - clean UI
 * - ICON-ONLY with rich tooltips
 * - PAUSED + QUEUED together is FORBIDDEN
 * - Uses REAL-TIME heartbeat freshness, not stale health_state
 */
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import { 
  AlertCircle, 
  Loader2, 
  Search, 
  TrendingUp, 
  Pause,
  XCircle,
  RefreshCw,
  Clock,
  FlaskConical,
  Brain,
  Ban,
  HeartPulse,
  PlayCircle,
  CheckCircle2,
  Sparkles,
  CircleDot,
  Zap,
  Wrench,
  Dna,
  Trophy
} from "lucide-react";
import type { CanonicalBotState } from "@/lib/canonicalStateEvaluator";
import { BotBrainHealthCompact } from "./BotBrainHealthRing";
import { useRealTimeRunnerState, formatHeartbeatAge } from "@/hooks/useRealTimeRunnerState";
import { HEARTBEAT_THRESHOLDS } from "@/lib/healthConstants";
import { useServerClock } from "@/contexts/ServerClockContext";
import { useBotHeartbeat } from "@/contexts/LivePnLContext";

interface BotStatusBadgeLanesProps {
  state: CanonicalBotState;
  botId?: string; // For WebSocket heartbeat subscription
  displayState?: string;
  reasonCode?: string;
  onRestartRunner?: () => void;
  restartPending?: boolean;
  className?: string;
  // Historical activity indicators for Fresh badge logic
  totalTrades?: number;
  hasBacktestData?: boolean;
  // Job counts for activity badges (real-time from server)
  backtestsRunning?: number;
  backtestsQueued?: number;
  evolvingRunning?: number;
  evolvingQueued?: number;
  improvingRunning?: number;
  improvingQueued?: number;
  // Job attempt number for "Backtesting • xN" badge
  jobAttempt?: number;
  // Improvement iteration for "Improving • #N" badge
  improvementIteration?: number;
  // Recently completed job (within 10 min) for badge persistence (SEV-1 spec)
  recentJob?: {
    id: string;
    type: string;
    status: string;
    completedAt: string;
    attempt: number;
    iteration: number;
  };
  // TRIALS idle info for "next in Xm" display
  labIdleInfo?: {
    idleReasonCode: string | null;
    nextRunMinutes: number | null;
    lastJobAt: string | null;
  } | null;
  // Bot stage for determining TRIALS context
  stage?: string;
}

// Healing badge - icon only with pulsing heart
function HealingBadge({ heartbeatAge }: { heartbeatAge?: number | null }) {
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(prev => prev <= 1 ? 60 : prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center justify-center w-6 h-5 rounded border text-cyan-400 bg-cyan-500/10 border-cyan-500/30">
          <HeartPulse className="w-3.5 h-3.5 animate-pulse" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">Auto-Healing</div>
        {heartbeatAge && (
          <div className="text-muted-foreground">
            Heartbeat stale ({formatHeartbeatAge(heartbeatAge)})
          </div>
        )}
        <div className="text-cyan-400">Next heal attempt in {secondsLeft}s</div>
      </TooltipContent>
    </Tooltip>
  );
}

// Icon-only badge component with optional time display
function StatusBadge({ 
  icon: Icon, 
  label, 
  color, 
  animate,
  tooltip,
  count,
  time
}: { 
  icon: React.ElementType; 
  label: string; 
  color: string;
  animate?: boolean;
  tooltip?: string;
  count?: number;
  time?: string;
}) {
  const needsExtraWidth = count || time;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center justify-center rounded border h-5",
          needsExtraWidth ? "gap-0.5 px-1.5" : "w-6",
          color
        )}>
          <Icon className={cn("w-3.5 h-3.5", animate && "animate-pulse")} />
          {time && <span className="text-[9px] font-mono">{time}</span>}
          {count && <span className="text-[9px] font-mono">{count}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs">
        <div className="font-medium">{label}</div>
        {tooltip && <div className="text-muted-foreground">{tooltip}</div>}
      </TooltipContent>
    </Tooltip>
  );
}

// Text-based activity badge (like screenshot: "Backtesting • x2", "Improving • #1")
function ActivityBadge({
  label,
  suffix,
  color,
  animate,
  tooltip
}: {
  label: string;
  suffix?: string;
  color: string;
  animate?: boolean;
  tooltip?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border",
          color,
          animate && "animate-pulse"
        )} data-testid={`badge-${label.toLowerCase().replace(/\s/g, '-')}`}>
          <span>{label}</span>
          {suffix && (
            <>
              <span className="opacity-50">•</span>
              <span>{suffix}</span>
            </>
          )}
        </span>
      </TooltipTrigger>
      {tooltip && (
        <TooltipContent side="top" className="text-xs max-w-xs">
          <div className="text-muted-foreground">{tooltip}</div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

// Idle badge for LAB bots showing "next in Xm" with Clock icon
function IdleBadge({ 
  nextMinutes, 
  reasonCode,
  lastJobAt 
}: { 
  nextMinutes: number | null; 
  reasonCode: string | null;
  lastJobAt: string | null;
}) {
  // Map reason codes to human-readable labels
  const reasonLabels: Record<string, string> = {
    'NEEDS_BASELINE': 'Needs baseline backtest',
    'BACKTEST_DUE': 'Backtest due',
    'IMPROVE_DUE': 'Improvement due',
    'EVOLVE_DUE': 'Evolution due',
    'WAITING_INTERVAL': 'Waiting for next scheduled run',
  };
  
  const reasonText = reasonCode ? (reasonLabels[reasonCode] || reasonCode) : 'Waiting';
  
  // LAB bots: Never show "overdue" or "pending" - all states are autonomous
  // Show neutral countdown or "ready" when due (nextMinutes <= 0)
  const isReady = nextMinutes !== null && nextMinutes <= 0;
  const timeDisplay = nextMinutes === null ? 'ready' : 
                      isReady ? 'ready' : 
                      `in ${nextMinutes}m`;
  
  // All states use muted color - no warning state for autonomous LAB operation
  const badgeColor = 'bg-muted/20 border-muted/30 text-muted-foreground';
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badgeColor}`} data-testid="badge-lab-idle">
          <Clock className="w-3 h-3" />
          <span>{timeDisplay}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs">
        <div className="font-medium">{isReady ? 'Ready for Next Run' : 'Autonomous Schedule'}</div>
        <div className="text-muted-foreground">{reasonText}</div>
        {lastJobAt && (
          <div className="text-muted-foreground text-[10px] mt-1">
            Last job: {new Date(lastJobAt).toLocaleTimeString()}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function BotStatusBadgeLanes({ 
  state, 
  botId,
  displayState, 
  reasonCode, 
  onRestartRunner, 
  restartPending, 
  className, 
  totalTrades = 0, 
  hasBacktestData = false,
  backtestsRunning = 0,
  backtestsQueued = 0,
  evolvingRunning = 0,
  evolvingQueued = 0,
  improvingRunning = 0,
  improvingQueued = 0,
  jobAttempt = 1,
  improvementIteration = 1,
  recentJob,
  labIdleInfo,
  stage,
}: BotStatusBadgeLanesProps) {
  const lanes: React.ReactNode[] = [];
  const isLabBot = state._context?.stage === 'TRIALS';
  const isExecutionStage = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(state._context?.stage || '');
  const { serverNow } = useServerClock();
  
  // Get real-time heartbeat from WebSocket (if available)
  const wsHeartbeat = useBotHeartbeat(botId || '');
  
  // Prefer WebSocket heartbeat over REST data for freshness
  // WebSocket updates every ~30s, REST data could be from page load
  const effectiveLastHeartbeat = wsHeartbeat?.lastHeartbeatAt || state.last_heartbeat_at;
  const effectiveHasRunner = wsHeartbeat ? wsHeartbeat.hasRunner : (state._context?.has_runner ?? false);
  
  // Use REAL-TIME heartbeat state for execution stage bots
  const realTimeState = useRealTimeRunnerState(
    effectiveLastHeartbeat,
    state.runner_state === 'TRADING' ? 'TRADING' : undefined,
    state.promoted_at,
    effectiveHasRunner
  );

  // =============================================
  // LANE 1: RUNNER STATE (use real-time for execution stages)
  // =============================================
  if (isExecutionStage) {
    // Override runner_state with real-time heartbeat check
    const runnerBadge = getRealTimeRunnerBadge(state, realTimeState, { onRestartRunner, restartPending });
    if (runnerBadge) {
      lanes.push(runnerBadge);
    }
  } else {
    const runnerBadge = getRunnerBadge(state, { onRestartRunner, restartPending });
    if (runnerBadge) {
      lanes.push(runnerBadge);
    }
  }

  // =============================================
  // LANE 2: HEALTH STATE (only if degraded/warning AND not within grace/healing)
  // Skip for LAB bots - low health scores are expected during evolution
  // Skip if we're showing STARTING or HEALING from real-time state
  // =============================================
  const hasCriticalBlockers = state.blockers.some(b => b.severity === 'CRITICAL');
  const isStartingOrHealing = realTimeState.effectiveState === 'STARTING' || state.is_healing;
  
  if (state.health_state !== 'OK' && !isLabBot && !isStartingOrHealing) {
    lanes.push(
      <BotBrainHealthCompact 
        key="health" 
        score={state.health_score} 
        state={state.health_state}
        hasCriticalBlockers={hasCriticalBlockers}
        promotedAt={state.promoted_at}
        isHealing={state.is_healing}
        autoHealAttempts={state.auto_heal_attempts}
        reasonCode={state.health_reason_code}
      />
    );
  }

  // =============================================
  // LANE 3: LAB IDLE INFO - Shows autonomous countdown (no "overdue" warning)
  // The scheduler handles job queuing automatically - shows when next job is scheduled
  // =============================================
  const hasActiveJobs = backtestsRunning > 0 || backtestsQueued > 0 || 
                        evolvingRunning > 0 || evolvingQueued > 0 || 
                        improvingRunning > 0 || improvingQueued > 0;
  const recentJobType = recentJob?.type?.toUpperCase() || '';
  const hasRecentJobs = recentJob && ['BACKTESTER', 'BACKTEST', 'EVOLVING', 'IMPROVING'].includes(recentJobType);
  // Show idle badge only when no active/recent jobs - displays autonomous countdown
  const showLabIdle = (isLabBot || stage === 'TRIALS') && labIdleInfo && !hasActiveJobs && !hasRecentJobs;
  
  if (showLabIdle && labIdleInfo) {
    lanes.push(
      <IdleBadge 
        key="lab-idle"
        nextMinutes={labIdleInfo.nextRunMinutes}
        reasonCode={labIdleInfo.idleReasonCode}
        lastJobAt={labIdleInfo.lastJobAt}
      />
    );
  }

  // =============================================
  // BLOCKERS (only if no other badges and critical)
  // =============================================
  if (lanes.length === 0) {
    const criticalBlocker = state.blockers.find(b => b.severity === 'CRITICAL');
    if (criticalBlocker) {
      lanes.push(
        <StatusBadge
          key="blocker"
          icon={AlertCircle}
          label="Blocked"
          color="text-red-400 bg-red-500/10 border-red-500/30"
          tooltip={criticalBlocker.message}
        />
      );
    }
  }

  // =============================================
  // CANONICAL STATE FALLBACK - Show primary badge for actual states ONLY
  // FRESH: Skip primary badge - only show secondary "New" pill (handled below)
  // =============================================
  if (lanes.length === 0 && displayState && displayState !== 'FRESH') {
    const fallbackBadge = getCanonicalStateBadge(displayState, reasonCode);
    if (fallbackBadge) {
      lanes.push(fallbackBadge);
    }
  }

  // =============================================
  // SECONDARY PILLS - Less prominent info badges
  // =============================================
  // Add "New" pill for FRESH bots ONLY if they haven't started trading yet
  // Once a bot has any runner activity (SCANNING, TRADING) or backtests, hide the pill
  // ALSO check historical activity: trades > 0 or has backtest data means not "new"
  const hasCurrentRunnerActivity = state.runner_state && ['SCANNING', 'TRADING', 'PAUSED'].includes(state.runner_state);
  const hasCurrentBacktestActivity = state.job_state && state.job_state !== 'IDLE';
  const hasHistoricalActivity = totalTrades > 0 || hasBacktestData;
  const isTrulyNew = displayState === 'FRESH' && !hasCurrentRunnerActivity && !hasCurrentBacktestActivity && !hasHistoricalActivity;
  
  if (isTrulyNew) {
    lanes.push(
      <Tooltip key="fresh-pill">
        <TooltipTrigger asChild>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/20">
            New
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="text-muted-foreground">Newly created - run your first backtest!</div>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (lanes.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {lanes}
    </div>
  );
}

// Get badge for canonical state when no activity badges are showing
// CRITICAL: Must handle ALL possible displayState values - never return null!
function getCanonicalStateBadge(displayState: string, reasonCode?: string): React.ReactNode {
  switch (displayState) {
    case 'IDLE':
      return (
        <StatusBadge
          key="canonical"
          icon={CircleDot}
          label="Idle"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip={reasonCode === 'BACKTEST_COMPLETE' ? 'Backtest complete - ready for next action' : 
                   reasonCode === 'READY_FOR_BACKTEST' ? 'Ready to run backtest' : 
                   reasonCode === 'NEWLY_CREATED' ? 'Newly created - run your first backtest!' :
                   'Awaiting action'}
        />
      );
    // FRESH is now mapped to IDLE with secondary "New" pill - keep for backwards compatibility
    case 'FRESH':
      return (
        <StatusBadge
          key="canonical"
          icon={CircleDot}
          label="Idle"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip="Newly created bot - run your first backtest!"
        />
      );
    case 'NEEDS_BACKTEST':
      return (
        <StatusBadge
          key="canonical"
          icon={FlaskConical}
          label="Needs BT"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          tooltip="This stage requires a baseline backtest before proceeding"
        />
      );
    case 'RUNNER_REQUIRED':
      return (
        <StatusBadge
          key="canonical"
          icon={Zap}
          label="Start Runner"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          tooltip="This stage requires a runner - start one to proceed"
        />
      );
    case 'RUNNER_STALE':
      return (
        <StatusBadge
          key="canonical"
          icon={AlertCircle}
          label="Runner Stale"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          tooltip="Runner heartbeat is stale - may need restart"
        />
      );
    case 'RUNNER_STARTING':
      return (
        <StatusBadge
          key="canonical"
          icon={Loader2}
          label="Starting"
          color="text-blue-400 bg-blue-500/10 border-blue-500/30"
          tooltip="Runner is starting up"
          animate
        />
      );
    case 'RUNNER_RUNNING':
      return (
        <StatusBadge
          key="canonical"
          icon={HeartPulse}
          label="Running"
          color="text-green-400 bg-green-500/10 border-green-500/30"
          tooltip="Runner is active and healthy"
        />
      );
    case 'RUNNER_PAUSED':
      return (
        <StatusBadge
          key="canonical"
          icon={Pause}
          label="Paused"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          tooltip="Runner is paused"
        />
      );
    case 'BACKTEST_RUNNING':
      return (
        <StatusBadge
          key="canonical"
          icon={FlaskConical}
          label="Backtesting"
          color="text-blue-400 bg-blue-500/10 border-blue-500/30"
          tooltip="Backtest is running"
          animate
        />
      );
    case 'BACKTEST_QUEUED':
      return (
        <StatusBadge
          key="canonical"
          icon={Clock}
          label="BT Queued"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip="Backtest job is queued"
        />
      );
    case 'EVOLVING':
      return (
        <StatusBadge
          key="canonical"
          icon={Dna}
          label="Evolving"
          color="text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30"
          tooltip="Bot is undergoing evolution"
          animate
        />
      );
    case 'BLOCKED':
      return (
        <StatusBadge
          key="canonical"
          icon={Ban}
          label="Blocked"
          color="text-red-400 bg-red-500/10 border-red-500/30"
          tooltip={reasonCode || 'Blocked by stage gates'}
        />
      );
    case 'ERROR':
      return (
        <StatusBadge
          key="canonical"
          icon={AlertCircle}
          label="Error"
          color="text-red-400 bg-red-500/10 border-red-500/30"
          tooltip={reasonCode || 'Bot is in error state'}
        />
      );
    case 'UNKNOWN_DATA':
      return (
        <StatusBadge
          key="canonical"
          icon={AlertCircle}
          label="Loading"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip="Loading bot state..."
        />
      );
    // DEFAULT FALLBACK - Never return null, always show something!
    default:
      return (
        <StatusBadge
          key="canonical"
          icon={CircleDot}
          label={displayState || 'Ready'}
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip={reasonCode || `Status: ${displayState || 'Ready'}`}
        />
      );
  }
}

// Real-time runner badge using actual heartbeat freshness
function getRealTimeRunnerBadge(
  state: CanonicalBotState,
  realTimeState: ReturnType<typeof useRealTimeRunnerState>,
  actions?: { onRestartRunner?: () => void; restartPending?: boolean }
): React.ReactNode | null {
  // RULE: PAUSED overrides everything
  if (state.runner_state === 'PAUSED') {
    return (
      <StatusBadge
        key="runner"
        icon={Pause}
        label="Paused"
        color="text-amber-400 bg-amber-500/10 border-amber-500/30"
        tooltip={state.runner_reason || 'User paused'}
      />
    );
  }

  // Use real-time effective state
  // Show "LIVE" badge with tooltip showing heartbeat age (user preference)
  const heartbeatTime = realTimeState.heartbeatAgeMs != null 
    ? formatHeartbeatAge(realTimeState.heartbeatAgeMs) 
    : undefined;

  switch (realTimeState.effectiveState) {
    case 'SCANNING':
    case 'TRADING': {
      // Unified "Live" badge for both states per user preference
      const activityContext = realTimeState.effectiveState === 'TRADING' ? 'In trade' : 'Scanning';
      return (
        <StatusBadge
          key="runner"
          icon={CheckCircle2}
          label="Live"
          color="text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
          tooltip={`${activityContext}${heartbeatTime ? ` • Heartbeat: ${heartbeatTime}` : ''}`}
          time="LIVE"
        />
      );
    }
    case 'STARTING':
      return (
        <StatusBadge
          key="runner"
          icon={PlayCircle}
          label="Starting"
          color="text-blue-400 bg-blue-500/10 border-blue-500/30"
          animate
          tooltip="Runner starting up (within grace period)"
        />
      );
    case 'STALLED':
      return <HealingBadge key="runner" heartbeatAge={realTimeState.heartbeatAgeMs} />;
    case 'NO_RUNNER':
      return (
        <StatusBadge
          key="runner"
          icon={Ban}
          label="No Runner"
          color="text-red-400 bg-red-500/10 border-red-500/30"
          tooltip="No primary runner - auto-start pending"
        />
      );
    default:
      return null;
  }
}

function getRunnerBadge(
  state: CanonicalBotState,
  actions?: { onRestartRunner?: () => void; restartPending?: boolean }
): React.ReactNode | null {
  // RULE: PAUSED + QUEUED together is FORBIDDEN - show only PAUSED
  if (state.runner_state === 'PAUSED') {
    return (
      <StatusBadge
        key="runner"
        icon={Pause}
        label="Paused"
        color="text-amber-400 bg-amber-500/10 border-amber-500/30"
        tooltip={state.runner_reason || 'User paused'}
      />
    );
  }

  switch (state.runner_state) {
    case 'SCANNING':
      return (
        <StatusBadge
          key="runner"
          icon={Search}
          label="Scanning"
          color="text-blue-400 bg-blue-500/10 border-blue-500/30"
          animate
          tooltip="Actively scanning for trade signals"
        />
      );
    case 'TRADING':
      return (
        <StatusBadge
          key="runner"
          icon={TrendingUp}
          label="Trading"
          color="text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
          animate
          tooltip="In active trade"
        />
      );
    case 'STALLED':
      return <HealingBadge key="runner" />;
    case 'CIRCUIT_BREAK':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "flex items-center justify-center rounded border h-5",
                actions?.onRestartRunner ? "gap-0.5 px-1.5" : "w-6",
                "text-red-400 bg-red-500/10 border-red-500/30"
              )}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              {!!actions?.onRestartRunner && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions?.onRestartRunner?.();
                  }}
                  disabled={actions?.restartPending}
                  className={cn(
                    "inline-flex items-center",
                    actions?.restartPending && "opacity-60 cursor-not-allowed"
                  )}
                  aria-label="Force restart"
                >
                  <RefreshCw className={cn("w-3 h-3", actions?.restartPending && "animate-spin")} />
                </button>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            <div className="font-medium">Circuit Breaker</div>
            <div className="text-muted-foreground">{state.runner_reason || 'Auto-heal failed 3+ times'}</div>
            <div className="text-amber-400 text-[10px] mt-1">Will auto-resume after cooldown</div>
          </TooltipContent>
        </Tooltip>
      );
    case 'STARTING':
      return (
        <StatusBadge
          key="runner"
          icon={Loader2}
          label="Starting"
          color="text-blue-400 bg-blue-500/10 border-blue-500/30"
          animate
          tooltip="Runner starting up"
        />
      );
    case 'RESTARTING':
      return (
        <StatusBadge
          key="runner"
          icon={RefreshCw}
          label="Restarting"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          animate
          tooltip={state.runner_reason || 'Restart in progress'}
        />
      );
    case 'ERROR':
      return (
        <StatusBadge
          key="runner"
          icon={XCircle}
          label="Error"
          color="text-red-400 bg-red-500/10 border-red-500/30"
          tooltip={state.runner_reason || 'Runner error - check logs'}
        />
      );
    case 'NO_RUNNER':
      if (state._context?.stage && ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(state._context.stage)) {
        return (
          <StatusBadge
            key="runner"
            icon={Ban}
            label="No Runner"
            color="text-red-400 bg-red-500/10 border-red-500/30"
            tooltip="No primary runner - start required"
          />
        );
      }
      return null;
    default:
      return null;
  }
}

function getBacktestBadge(state: CanonicalBotState): React.ReactNode | null {
  switch (state.job_state) {
    case 'BACKTEST_RUNNING':
      return (
        <StatusBadge
          key="backtest"
          icon={FlaskConical}
          label="Backtesting"
          color="text-purple-400 bg-purple-500/10 border-purple-500/30"
          animate
          tooltip={state.job_reason || 'Backtest in progress'}
        />
      );
    case 'BACKTEST_QUEUED':
      return (
        <StatusBadge
          key="backtest"
          icon={FlaskConical}
          label="Queued"
          color="text-purple-400/70 bg-purple-500/5 border-purple-500/20"
          tooltip={state.job_reason || 'Backtest queued'}
        />
      );
    default:
      return null;
  }
}

function getEvolutionBadge(state: CanonicalBotState): React.ReactNode | null {
  switch (state.evolution_state) {
    case 'EVOLVING':
      return (
        <StatusBadge
          key="evolution"
          icon={Dna}
          label="Evolving"
          color="text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30"
          animate
          tooltip="AI is mutating strategy parameters"
        />
      );
    case 'TOURNAMENT_RUNNING':
      return (
        <StatusBadge
          key="evolution"
          icon={Trophy}
          label="Tournament"
          color="text-amber-400 bg-amber-500/10 border-amber-500/30"
          animate
          tooltip="Strategy variations competing"
        />
      );
    case 'AWAITING_BACKTEST':
      return (
        <StatusBadge
          key="evolution"
          icon={Clock}
          label="Awaiting BT"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip="Waiting for backtest to complete"
        />
      );
    case 'MUTATION_PENDING':
      return (
        <StatusBadge
          key="evolution"
          icon={Sparkles}
          label="Mutation"
          color="text-fuchsia-400/70 bg-fuchsia-500/5 border-fuchsia-500/20"
          tooltip="Generating strategy mutations"
        />
      );
    case 'COOLDOWN':
      return (
        <StatusBadge
          key="evolution"
          icon={Clock}
          label="Cooldown"
          color="text-muted-foreground bg-muted/30 border-muted/50"
          tooltip="Resting between evolution cycles"
        />
      );
    default:
      return null;
  }
}
