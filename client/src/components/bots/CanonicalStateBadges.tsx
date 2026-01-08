/**
 * Canonical State Badges - renders bot state from single source of truth
 * 
 * Uses unified health constants from healthConstants.ts
 * 
 * RULES:
 * - NO "OK" badges - clean UI
 * - Only show warnings/errors
 * - One badge per concern lane
 * - Tooltips show blocker_code + remediation
 */
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  AlertCircle, 
  AlertTriangle, 
  Loader2, 
  Search, 
  TrendingUp, 
  Pause,
  XCircle,
  RefreshCw,
  Zap,
  Clock,
  FlaskConical,
  Brain
} from "lucide-react";
import type { CanonicalBotState, RunnerState, JobState, EvolutionState, BlockerCode } from "@/lib/canonicalStateEvaluator";
import { HealthScoreBadge } from "./HealthScoreBadge";

interface CanonicalStateBadgesProps {
  state: CanonicalBotState;
  showHealth?: boolean;
  className?: string;
}

// Runner state config - only render for non-OK states
const RUNNER_CONFIG: Record<RunnerState, { 
  icon: React.ElementType; 
  label: string; 
  color: string;
  show: boolean;
  animate?: boolean;
} | null> = {
  SCANNING: { icon: Search, label: 'Scanning', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', show: true, animate: true },
  TRADING: { icon: TrendingUp, label: 'Trading', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', show: true, animate: true },
  STALLED: { icon: AlertCircle, label: 'Stalled', color: 'text-red-400 bg-red-500/10 border-red-500/30', show: true },
  STOPPED: null, // Don't show - expected state
  PAUSED: { icon: Pause, label: 'Paused', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true },
  STARTING: { icon: Loader2, label: 'Starting', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30', show: true, animate: true },
  RESTARTING: { icon: RefreshCw, label: 'Restarting', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true, animate: true },
  ERROR: { icon: XCircle, label: 'Error', color: 'text-red-400 bg-red-500/10 border-red-500/30', show: true },
  CIRCUIT_BREAK: { icon: Zap, label: 'Circuit Break', color: 'text-red-400 bg-red-500/10 border-red-500/30', show: true },
  NO_RUNNER: null, // Only show if required
};

// Job state config
const JOB_CONFIG: Record<JobState, {
  icon: React.ElementType;
  label: string;
  color: string;
  show: boolean;
  animate?: boolean;
} | null> = {
  IDLE: null,
  BACKTEST_RUNNING: { icon: FlaskConical, label: 'Backtesting', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', show: true, animate: true },
  BACKTEST_QUEUED: { icon: FlaskConical, label: 'BT Queued', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', show: true },
  EVOLVING: { icon: Brain, label: 'Evolving', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true, animate: true },
  EVALUATING: { icon: Brain, label: 'Evaluating', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true, animate: true },
  QUEUED: { icon: Clock, label: 'Queued', color: 'text-muted-foreground bg-muted/30 border-muted/50', show: true },
};

// Evolution state config  
const EVOLUTION_CONFIG: Record<EvolutionState, {
  icon: React.ElementType;
  label: string;
  color: string;
  show: boolean;
  animate?: boolean;
} | null> = {
  IDLE: null,
  EVOLVING: { icon: Brain, label: 'Evolving', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true, animate: true },
  TOURNAMENT_RUNNING: { icon: Brain, label: 'Tournament', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true, animate: true },
  AWAITING_BACKTEST: { icon: FlaskConical, label: 'Awaiting BT', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30', show: true },
  MUTATION_PENDING: { icon: Brain, label: 'Mutation Pending', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30', show: true },
  COOLDOWN: { icon: Clock, label: 'Cooldown', color: 'text-muted-foreground bg-muted/30 border-muted/50', show: true },
};

function BlockerBadge({ blocker }: { blocker: BlockerCode }) {
  const isCritical = blocker.severity === 'CRITICAL';
  const Icon = isCritical ? AlertCircle : AlertTriangle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium",
          isCritical 
            ? "text-red-400 bg-red-500/10 border-red-500/30"
            : "text-amber-400 bg-amber-500/10 border-amber-500/30"
        )}>
          <Icon className="w-3 h-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="text-xs">
          <div className="font-medium">{blocker.code}</div>
          <div className="text-muted-foreground">{blocker.message}</div>
          <div className="text-blue-400 mt-1 border-t border-border/30 pt-1">
            {blocker.suggested_action}
          </div>
          {blocker.auto_healable && (
            <div className="text-emerald-400 text-[10px]">✓ Auto-healable</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export function CanonicalStateBadges({ state, showHealth = true, className }: CanonicalStateBadgesProps) {
  const badges: React.ReactNode[] = [];
  const hasCriticalBlockers = state.blockers.some(b => b.severity === 'CRITICAL');

  // 1. Health badge (only if degraded/warning) - pass blocker info for BLOCKED state
  if (showHealth && state.health_state !== 'OK') {
    badges.push(
      <HealthScoreBadge 
        key="health" 
        score={state.health_score} 
        state={state.health_state}
        reason={state.health_reason}
        hasCriticalBlockers={hasCriticalBlockers}
      />
    );
  }

  // 2. Runner state badge
  const runnerConfig = RUNNER_CONFIG[state.runner_state];
  if (runnerConfig?.show) {
    const Icon = runnerConfig.icon;
    badges.push(
      <Tooltip key="runner">
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium",
            runnerConfig.color
          )}>
            <Icon className={cn("w-3 h-3", runnerConfig.animate && "animate-pulse")} />
            <span>{runnerConfig.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          <div className="font-medium">{state.runner_reason || runnerConfig.label}</div>
          {state.last_heartbeat_at && (
            <div className="text-muted-foreground">
              Last heartbeat: {new Date(state.last_heartbeat_at).toLocaleTimeString()}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 3. Job state badge (skip if IDLE or already showing runner backtest)
  const jobConfig = JOB_CONFIG[state.job_state];
  if (jobConfig?.show) {
    const Icon = jobConfig.icon;
    badges.push(
      <Tooltip key="job">
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium",
            jobConfig.color
          )}>
            <Icon className={cn("w-3 h-3", jobConfig.animate && "animate-pulse")} />
            <span>{jobConfig.label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {state.job_reason || jobConfig.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  // 4. Critical blockers (max 1 to keep UI clean)
  const criticalBlocker = state.blockers.find(b => b.severity === 'CRITICAL');
  const hasRunnerOrHealthBadge = badges.length > 0;
  if (criticalBlocker && !hasRunnerOrHealthBadge) {
    badges.push(<BlockerBadge key={`blocker-${criticalBlocker.code}`} blocker={criticalBlocker} />);
  }

  if (badges.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {badges}
    </div>
  );
}
