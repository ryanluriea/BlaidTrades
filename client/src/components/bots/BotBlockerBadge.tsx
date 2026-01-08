import { cn } from "@/lib/utils";
import { 
  Clock, 
  AlertTriangle, 
  XCircle, 
  Loader2, 
  Radio, 
  ShieldAlert,
  Unplug,
  Calendar,
  Activity,
  CheckCircle
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type BlockerType } from "@/lib/graduationGates";

interface BotBlockerBadgeProps {
  blocker: BlockerType;
  message: string;
  severity: 'info' | 'warning' | 'error';
  actionHint?: string;
  compact?: boolean;
}

const BLOCKER_ICONS: Record<BlockerType, React.ElementType> = {
  MARKET_CLOSED: Clock,
  NO_MARKET_DATA: Radio,
  MACRO_EVENT_BLOCK: Calendar,
  RISK_ENGINE_BLOCK: ShieldAlert,
  JOB_QUEUE_EMPTY: Activity,
  STRATEGY_SANITY_FAIL: XCircle,
  BROKER_NOT_VALIDATED: AlertTriangle,
  NO_ACCOUNT_ATTACHED: Unplug,
  ACCOUNT_NOT_ARMED: ShieldAlert,
  HEALTH_DEGRADED: XCircle,
  BACKTEST_IN_PROGRESS: Loader2,
  WAITING_FOR_SIGNAL: Activity,
  NONE: CheckCircle,
  // New canonical blockers
  CIRCUIT_BREAKER_OPEN: AlertTriangle,
  RUNNER_ERROR: XCircle,
  RUNNER_STALLED: Clock,
  RUNNER_HEARTBEAT_WARNING: Clock,
  NO_PRIMARY_RUNNER: Unplug,
  MODE_STAGE_MISMATCH: AlertTriangle,
  LAB_RUNNER_ACTIVE: AlertTriangle,
  TRADING_DISABLED_RUNNER_ACTIVE: AlertTriangle,
  JOB_STALLED: Clock,
  JOB_DEAD_LETTER: XCircle,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-muted text-muted-foreground',
  warning: 'bg-warning/10 text-warning border-warning/20',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
};

export function BotBlockerBadge({ 
  blocker, 
  message, 
  severity, 
  actionHint,
  compact = true 
}: BotBlockerBadgeProps) {
  const Icon = BLOCKER_ICONS[blocker] || Activity;
  const isSpinning = blocker === 'BACKTEST_IN_PROGRESS';

  if (blocker === 'NONE') return null;

  const content = (
    <Badge 
      variant="outline" 
      className={cn(
        "gap-1 text-[10px] font-normal",
        SEVERITY_COLORS[severity],
        compact && "px-1.5 py-0"
      )}
    >
      <Icon className={cn("w-3 h-3", isSpinning && "animate-spin")} />
      {!compact && message}
    </Badge>
  );

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-xs">
            <div className="font-medium">{message}</div>
            {actionHint && (
              <div className="text-muted-foreground mt-1">{actionHint}</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
