import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skull, AlertTriangle, ShieldOff, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface KillStateBadgeProps {
  killState: 'NONE' | 'SOFT_KILLED' | 'HARD_KILLED' | 'QUARANTINED';
  killReasonCode?: string | null;
  killReasonDetail?: string | null;
  killUntil?: string | null;
  demotionCooldownUntil?: string | null;
  className?: string;
}

const KILL_STATE_CONFIG = {
  NONE: null,
  SOFT_KILLED: {
    icon: AlertTriangle,
    label: 'Soft Kill',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    description: 'Trading halted, auto-restart pending',
  },
  HARD_KILLED: {
    icon: Skull,
    label: 'Hard Kill',
    color: 'bg-destructive/20 text-destructive border-destructive/30',
    description: 'Demoted + trading disabled + cooldown',
  },
  QUARANTINED: {
    icon: ShieldOff,
    label: 'Quarantined',
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    description: 'Isolated to TRIALS, requires fix',
  },
};

const REASON_LABELS: Record<string, string> = {
  STALE_HEARTBEAT_CRITICAL: 'Stale heartbeat',
  EXECUTION_REJECTION_SPIKE: 'Broker rejections',
  DATA_PROVIDER_MISSING: 'No market data',
  RATE_LIMIT_STORM: 'Rate limit storm',
  DD_BREACH: 'Drawdown breach',
  EDGE_LOST: 'Edge lost',
  CONFIG_INVALID: 'Invalid config',
  BROKER_REJECTS: 'Broker rejects',
  MANUAL_KILL: 'Manual kill',
};

export function KillStateBadge({
  killState,
  killReasonCode,
  killReasonDetail,
  killUntil,
  demotionCooldownUntil,
  className,
}: KillStateBadgeProps) {
  if (killState === 'NONE') return null;

  const config = KILL_STATE_CONFIG[killState];
  if (!config) return null;

  const Icon = config.icon;
  const reasonLabel = killReasonCode ? REASON_LABELS[killReasonCode] || killReasonCode : null;
  const cooldownActive = demotionCooldownUntil && new Date(demotionCooldownUntil) > new Date();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 px-1.5 py-0.5 h-5 text-[10px] font-medium border animate-pulse",
            config.color,
            className
          )}
        >
          <Icon className="w-3 h-3" />
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-1.5">
          <div className="font-medium flex items-center gap-1.5">
            <Icon className="w-3.5 h-3.5" />
            {config.label}
          </div>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          
          {reasonLabel && (
            <div className="text-xs">
              <span className="text-muted-foreground">Reason:</span>{' '}
              <span className="font-medium">{reasonLabel}</span>
            </div>
          )}
          
          {killReasonDetail && (
            <p className="text-xs text-muted-foreground">{killReasonDetail}</p>
          )}
          
          {cooldownActive && demotionCooldownUntil && (
            <div className="text-xs text-warning">
              Cooldown: {formatDistanceToNow(new Date(demotionCooldownUntil), { addSuffix: true })}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
