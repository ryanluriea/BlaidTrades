import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Play, Pause, AlertCircle, Search, TrendingUp, 
  XCircle, RefreshCw, Clock, Brain, Wifi, AlertTriangle 
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ExecutionStatusBadgeProps {
  stage: string;
  mode: string | null;
  activityState: string | null;
  status?: string | null;
  accountName?: string | null;
  lastHeartbeat?: string | null;
  isTradingEnabled?: boolean;
  hasAccount?: boolean;
  className?: string;
}

/**
 * EXECUTION STATES (NO MORE AMBIGUOUS "IDLE")
 * 
 * Based on stage + mode + activity, show TRUTHFUL status:
 * - ❌ No Runner (BUG) - PAPER+ without runner
 * - ⚠️ Execution Desync - mode doesn't match stage
 * - 🔄 Runner Restarting
 * - ⏳ Waiting for Market Open
 * - ⛔ Paused (reason)
 * - 🧠 Backtest Only (TRIALS only)
 * - 📡 Scanning (SIM_LIVE)
 * - 📈 Trading
 * - ❌ Error
 */

const STAGE_TO_EXPECTED_MODE: Record<string, string> = {
  TRIALS: 'BACKTEST_ONLY',
  PAPER: 'SIM_LIVE',
  SHADOW: 'SHADOW',
  CANARY: 'CANARY',
  LIVE: 'LIVE',
};

type ExecutionStatus = 
  | 'NO_RUNNER'
  | 'EXECUTION_DESYNC'
  | 'BACKTEST_ONLY'
  | 'SCANNING'
  | 'TRADING'
  | 'PAUSED'
  | 'ERROR'
  | 'STALLED'
  | 'WAITING_MARKET'
  | 'RESTARTING'
  | 'NO_ACCOUNT';

interface StatusConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
  icon: React.ElementType;
  isBug?: boolean;
  description: string;
}

const STATUS_CONFIG: Record<ExecutionStatus, StatusConfig> = {
  NO_RUNNER: {
    label: 'No Runner',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    dotColor: 'bg-red-400',
    icon: XCircle,
    isBug: true,
    description: 'This bot should have a runner but none exists. System error.',
  },
  EXECUTION_DESYNC: {
    label: 'Desync',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    dotColor: 'bg-orange-400',
    icon: AlertTriangle,
    isBug: true,
    description: 'Execution mode does not match stage. Auto-heal in progress.',
  },
  NO_ACCOUNT: {
    label: 'No Account',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/30',
    borderColor: 'border-muted/50',
    dotColor: 'bg-muted-foreground/50',
    icon: AlertCircle,
    description: 'Bot needs to be attached to an account to run.',
  },
  BACKTEST_ONLY: {
    label: 'Backtest Only',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
    dotColor: 'bg-slate-400',
    icon: Brain,
    description: 'TRIALS bot - only runs backtests, no live scanning.',
  },
  SCANNING: {
    label: 'Scanning',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    dotColor: 'bg-blue-400',
    icon: Search,
    description: 'Actively scanning market for trade signals.',
  },
  TRADING: {
    label: 'Trading',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    dotColor: 'bg-emerald-400',
    icon: TrendingUp,
    description: 'Currently has open positions or executing trades.',
  },
  PAUSED: {
    label: 'Paused',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    dotColor: 'bg-amber-400',
    icon: Pause,
    description: 'Runner paused by user or system.',
  },
  ERROR: {
    label: 'Error',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    dotColor: 'bg-red-400',
    icon: AlertCircle,
    description: 'Runner encountered an error.',
  },
  STALLED: {
    label: 'Stalled',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    dotColor: 'bg-orange-400',
    icon: AlertTriangle,
    description: 'Runner heartbeat stale - may need restart.',
  },
  WAITING_MARKET: {
    label: 'Market Closed',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
    dotColor: 'bg-slate-400',
    icon: Clock,
    description: 'Waiting for market to open.',
  },
  RESTARTING: {
    label: 'Restarting',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    dotColor: 'bg-blue-400',
    icon: RefreshCw,
    description: 'Runner is restarting.',
  },
};

function computeExecutionStatus(props: ExecutionStatusBadgeProps): ExecutionStatus {
  const { stage, mode, activityState, status, hasAccount, isTradingEnabled } = props;
  
  const expectedMode = STAGE_TO_EXPECTED_MODE[stage] || 'BACKTEST_ONLY';
  const shouldBeScanning = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  
  // TRIALS bots are always backtest only
  if (stage === 'TRIALS') {
    return 'BACKTEST_ONLY';
  }
  
  // Check for mode desync (PAPER+ with wrong mode)
  if (shouldBeScanning && mode && mode !== expectedMode) {
    return 'EXECUTION_DESYNC';
  }
  
  // PAPER+ without any runner/mode
  if (shouldBeScanning && !mode) {
    if (!hasAccount) {
      return 'NO_ACCOUNT';
    }
    return 'NO_RUNNER';
  }
  
  // Check activity state
  const normalizedActivity = activityState?.toUpperCase();
  
  if (normalizedActivity === 'SCANNING') return 'SCANNING';
  if (normalizedActivity === 'TRADING') return 'TRADING';
  if (normalizedActivity === 'PAUSED') return 'PAUSED';
  if (normalizedActivity === 'ERROR') return 'ERROR';
  if (normalizedActivity === 'STALLED') return 'STALLED';
  
  // Status-based checks
  if (status === 'paused') return 'PAUSED';
  if (status === 'error') return 'ERROR';
  if (status === 'stopped' && shouldBeScanning) return 'NO_RUNNER';
  
  // If we have a runner in correct mode but IDLE activity - this is suspicious for PAPER+
  if (shouldBeScanning && normalizedActivity === 'IDLE') {
    // This shouldn't happen - PAPER+ should be SCANNING
    return 'EXECUTION_DESYNC';
  }
  
  // Default for TRIALS with mode
  if (mode === 'BACKTEST_ONLY') {
    return 'BACKTEST_ONLY';
  }
  
  // Fallback - if mode matches and running, assume scanning
  if (mode === expectedMode && status === 'running') {
    return 'SCANNING';
  }
  
  return 'BACKTEST_ONLY';
}

export function ExecutionStatusBadge(props: ExecutionStatusBadgeProps) {
  const { stage, mode, accountName, lastHeartbeat, className } = props;
  
  const status = computeExecutionStatus(props);
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  const isActive = ['SCANNING', 'TRADING'].includes(status);
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px]",
          config.bgColor,
          config.borderColor,
          className
        )}>
          {config.isBug && <AlertTriangle className="w-3 h-3 text-red-400" />}
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            config.dotColor,
            isActive && "animate-pulse"
          )} />
          <span className={cn("font-medium", config.color)}>{config.label}</span>
          {mode && mode !== 'BACKTEST_ONLY' && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <span className="text-muted-foreground">{mode}</span>
            </>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs space-y-1">
        <div className="font-medium flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          {config.label}
        </div>
        <div className="text-muted-foreground">{config.description}</div>
        {config.isBug && (
          <div className="text-red-400 text-[10px] mt-1 pt-1 border-t border-border/30">
            ⚠️ System issue detected. Auto-heal should resolve this.
          </div>
        )}
        <div className="text-[10px] text-muted-foreground/70 pt-1 border-t border-border/30 mt-1 space-y-0.5">
          <div>Stage: {stage}</div>
          <div>Mode: {mode || 'None'}</div>
          {accountName && <div>Account: {accountName}</div>}
          {lastHeartbeat && (
            <div>Heartbeat: {formatDistanceToNow(new Date(lastHeartbeat), { addSuffix: true })}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
