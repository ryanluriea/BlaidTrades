import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  MoreHorizontal,
  Clock,
  Eye,
  X,
  ArrowUpRight,
  ExternalLink,
  Bot,
  Wallet,
} from "lucide-react";
import type { Alert } from "@/hooks/useAlerts";

interface AlertCardProps {
  alert: Alert;
  onDismiss: (id: string) => void;
  onSnooze: (id: string, hours: number) => void;
  onAcknowledge: (id: string) => void;
  onPromote?: (alert: Alert) => void;
  onViewEntity?: (alert: Alert) => void;
}

const severityConfig = {
  INFO: {
    icon: Info,
    color: "text-blue-500",
    bg: "bg-blue-500/5 hover:bg-blue-500/10",
    border: "border-blue-500/10",
    dot: "bg-blue-500",
  },
  WARN: {
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-500/5 hover:bg-amber-500/10",
    border: "border-amber-500/10",
    dot: "bg-amber-500",
  },
  CRITICAL: {
    icon: AlertCircle,
    color: "text-rose-500",
    bg: "bg-rose-500/5 hover:bg-rose-500/10",
    border: "border-rose-500/10",
    dot: "bg-rose-500",
  },
};

const categoryLabels: Record<string, string> = {
  PROMOTION_READY: "Ready to Promote",
  LIVE_PROMOTION_RECOMMENDED: "Live Ready",
  BOT_DEGRADED: "Degraded",
  BOT_STALLED: "Stalled",
  DATA_HEALTH: "Data Issue",
  EXECUTION_RISK: "Execution Risk",
  ACCOUNT_RISK_BREACH: "Risk Breach",
  ARBITER_DECISION_ANOMALY: "Anomaly",
};

const entityIcons = {
  BOT: Bot,
  ACCOUNT: Wallet,
  SYSTEM: Info,
  TRADE: ArrowUpRight,
};

export function AlertCard({
  alert,
  onDismiss,
  onSnooze,
  onAcknowledge,
  onPromote,
  onViewEntity,
}: AlertCardProps) {
  const config = severityConfig[alert.severity] || severityConfig.INFO;
  const EntityIcon = entityIcons[alert.entityType as keyof typeof entityIcons] || Info;

  const payload = alert.payloadJson as Record<string, unknown> | null;
  const isPromotionAlert =
    alert.category === "PROMOTION_READY" ||
    alert.category === "LIVE_PROMOTION_RECOMMENDED";
  
  const isUnread = alert.status === "OPEN";

  return (
    <div
      className={cn(
        "group relative p-3 rounded-xl border transition-all duration-200",
        config.bg,
        config.border,
        isUnread && "ring-1 ring-primary/20"
      )}
    >
      {/* Unread indicator */}
      {isUnread && (
        <div className={cn("absolute top-3 left-3 w-2 h-2 rounded-full", config.dot)} />
      )}

      {/* Content */}
      <div className={cn("space-y-2", isUnread && "pl-4")}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground line-clamp-1">
                {alert.title}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px] h-5 px-1.5 font-normal border-0",
                  config.bg
                )}
              >
                {categoryLabels[alert.category] || alert.category}
              </Badge>
              {alert.entityType !== "SYSTEM" && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal gap-1">
                  <EntityIcon className="w-3 h-3" />
                  {alert.entityType}
                </Badge>
              )}
            </div>
          </div>

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {isUnread && (
                <DropdownMenuItem onClick={() => onAcknowledge(alert.id)}>
                  <Eye className="w-4 h-4 mr-2" />
                  Mark as read
                </DropdownMenuItem>
              )}
              {onViewEntity && alert.entityId && (
                <DropdownMenuItem onClick={() => onViewEntity(alert)}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View {alert.entityType.toLowerCase()}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onSnooze(alert.id, 1)}>
                <Clock className="w-4 h-4 mr-2" />
                Snooze 1 hour
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSnooze(alert.id, 24)}>
                <Clock className="w-4 h-4 mr-2" />
                Snooze 1 day
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSnooze(alert.id, 168)}>
                <Clock className="w-4 h-4 mr-2" />
                Snooze 1 week
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDismiss(alert.id)}
                className="text-destructive focus:text-destructive"
              >
                <X className="w-4 h-4 mr-2" />
                Dismiss
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Message */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {alert.message}
        </p>

        {/* Promotion details */}
        {isPromotionAlert && payload && (
          <div className="flex items-center gap-3 text-xs">
            {payload.progress_percent !== undefined && (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div 
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(100, payload.progress_percent as number)}%` }}
                  />
                </div>
                <span className="text-muted-foreground font-mono">
                  {Math.round(payload.progress_percent as number)}%
                </span>
              </div>
            )}
            {payload.next_stage && (
              <Badge variant="outline" className="text-[10px] h-5 font-mono">
                → {payload.next_stage as string}
              </Badge>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>

          {/* Action buttons */}
          {isPromotionAlert && onPromote && isUnread && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="default"
                className="h-6 px-2.5 text-[10px] font-medium"
                onClick={() => onPromote(alert)}
              >
                Promote
                <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
