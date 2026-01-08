/**
 * Bot Brain Panel - Single source of truth for bot health and state
 * Shows: Health gauge, current intent, blockers, recent events
 * 
 * Uses unified health constants from healthConstants.ts
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Brain, 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Clock,
  Zap,
  Shield,
  RefreshCw,
  TrendingUp,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanonicalBotState } from "@/hooks/useCanonicalBotState";
import { useBotHistory } from "@/hooks/useBotHistory";
import { formatDistanceToNow } from "date-fns";
import { getDisplayHealthState, HEALTH_DISPLAY_COLORS } from "@/lib/healthConstants";

interface BotBrainPanelProps {
  botId: string;
  stage: string;
}

// Health colors defined in component for BLOCKED state support

const RUNNER_STATE_INTENT: Record<string, { text: string; icon: React.ElementType }> = {
  SCANNING: { text: 'Scanning for valid signals during market hours', icon: Activity },
  TRADING: { text: 'Currently in an active trade', icon: TrendingUp },
  STALLED: { text: 'Runner stalled - auto-restart pending', icon: AlertTriangle },
  STOPPED: { text: 'Runner stopped - not monitoring market', icon: XCircle },
  PAUSED: { text: 'Paused by user', icon: Clock },
  STARTING: { text: 'Runner starting up...', icon: Loader2 },
  RESTARTING: { text: 'Runner restarting...', icon: RefreshCw },
  ERROR: { text: 'Runner in error state - needs attention', icon: XCircle },
  CIRCUIT_BREAK: { text: 'Circuit breaker engaged - too many restarts', icon: Shield },
  NO_RUNNER: { text: 'No runner - backtests only', icon: Brain },
};

const JOB_STATE_INTENT: Record<string, string> = {
  BACKTEST_RUNNING: 'Running backtest simulation',
  BACKTEST_QUEUED: 'Backtest queued - awaiting worker',
  EVOLVING: 'Evolving strategy parameters',
  EVALUATING: 'Evaluating current generation',
  QUEUED: 'Jobs queued for processing',
  IDLE: '',
};

export function BotBrainPanel({ botId, stage }: BotBrainPanelProps) {
  const { data: state, isLoading } = useCanonicalBotState(botId);
  const { data: history } = useBotHistory(botId, { limit: 5 });

  if (isLoading || !state) {
    return (
      <Card className="bg-muted/20 border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading brain state...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Use unified health constants for display
  const hasCriticalBlockers = state.blockers.some(b => b.severity === 'CRITICAL');
  const displayState = getDisplayHealthState(state.health_state, state.health_score, hasCriticalBlockers);
  const healthColors = HEALTH_DISPLAY_COLORS[displayState];
  const isBlockedState = displayState === 'BLOCKED';
  
  const runnerIntent = RUNNER_STATE_INTENT[state.runner_state] || RUNNER_STATE_INTENT.NO_RUNNER;
  const jobIntent = JOB_STATE_INTENT[state.job_state] || '';

  // Compute current intent text
  const getCurrentIntent = () => {
    // Priority: active job > runner state > stage default
    if (state.job_state !== 'IDLE' && jobIntent) {
      return jobIntent;
    }
    if (stage === 'TRIALS') {
      return state.job_state === 'BACKTEST_RUNNING' 
        ? 'Running backtest simulation'
        : 'TRIALS mode - backtesting and evolving only';
    }
    return runnerIntent.text;
  };

  const IntentIcon = state.job_state !== 'IDLE' 
    ? (state.job_state.includes('BACKTEST') ? RefreshCw : Zap)
    : runnerIntent.icon;

  return (
    <Card className="bg-muted/20 border-border/50">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 text-primary" />
          Bot Brain
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {/* Health Gauge */}
        <div className={cn(
          "p-3 rounded-lg border",
          healthColors.bg,
          healthColors.border
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger>
                  <div className={cn(
                    "text-2xl font-bold tabular-nums",
                    healthColors.text
                  )}>
                    {state.health_score}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">Health Score Breakdown</p>
                    <p className="text-muted-foreground">
                      Runner reliability (30%), Backtest success (20%), 
                      Evolution stability (20%), Promotion readiness (15%), 
                      Risk discipline (10%), Error frequency (5%)
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Health</p>
                <Tooltip>
                  <TooltipTrigger>
                    <Badge 
                      variant="outline" 
                      className={cn("text-[9px]", healthColors.text, healthColors.border)}
                    >
                      {healthColors.label}
                    </Badge>
                  </TooltipTrigger>
                  {isBlockedState && (
                    <TooltipContent side="bottom" className="max-w-xs text-xs">
                      <p className="font-medium">Blocked by Issues</p>
                      <p className="text-muted-foreground">
                        Score is healthy ({state.health_score}), but critical blockers prevent normal operation.
                        Resolve the blocking factors below to restore full functionality.
                      </p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>
            <Progress 
              value={state.health_score} 
              className="w-24 h-2"
            />
          </div>
          {state.health_reason && (
            <p className="text-[10px] text-muted-foreground mt-2 border-t border-border/30 pt-2">
              {state.health_reason}
            </p>
          )}
        </div>

        {/* Current Intent */}
        <div className="flex items-start gap-2 p-2 rounded bg-background/50">
          <IntentIcon className={cn(
            "w-4 h-4 mt-0.5",
            state.job_state.includes('RUNNING') || state.runner_state === 'RESTARTING' 
              ? "animate-spin text-primary" 
              : "text-muted-foreground"
          )} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">Current Intent</p>
            <p className="text-[11px] text-muted-foreground">{getCurrentIntent()}</p>
            {state.runner_reason && state.runner_state !== 'NO_RUNNER' && (
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                Runner: {state.runner_reason}
              </p>
            )}
          </div>
        </div>

        {/* Blockers */}
        {state.blockers.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">
              Blocking Factors
            </p>
            {state.blockers.slice(0, 3).map((blocker, i) => (
              <div 
                key={i}
                className={cn(
                  "flex items-start gap-2 p-2 rounded text-xs border",
                  blocker.severity === 'CRITICAL' && "bg-red-500/5 border-red-500/30",
                  blocker.severity === 'WARNING' && "bg-amber-500/5 border-amber-500/30",
                  blocker.severity === 'INFO' && "bg-muted/50 border-border/50"
                )}
              >
                {blocker.severity === 'CRITICAL' ? (
                  <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                ) : blocker.severity === 'WARNING' ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{blocker.message}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    → {blocker.suggested_action}
                  </p>
                  {blocker.auto_healable && (
                    <Badge variant="outline" className="text-[8px] mt-1 text-emerald-400 border-emerald-500/30">
                      Auto-healing
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent Brain Events */}
        {history && history.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase text-muted-foreground font-medium">
              Recent Events
            </p>
            <div className="space-y-1">
              {history.slice(0, 5).map((event: any) => (
                <div 
                  key={event.id}
                  className="flex items-center gap-2 text-[10px] text-muted-foreground py-1 border-b border-border/20 last:border-0"
                >
                  <span className="text-muted-foreground/60 tabular-nums shrink-0">
                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                  </span>
                  <span className="truncate">{event.event_type.replace(/_/g, ' ')}</span>
                  {event.message && (
                    <span className="text-muted-foreground/60 truncate">
                      – {event.message}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        {state.last_heartbeat_at && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 border-t border-border/30 pt-2">
            <Clock className="w-3 h-3" />
            Last heartbeat: {formatDistanceToNow(new Date(state.last_heartbeat_at), { addSuffix: true })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
