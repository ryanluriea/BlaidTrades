import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Copy,
  ExternalLink,
  MessageSquare,
  Play,
  RefreshCw,
  Shield,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTimezone } from "@/hooks/useTimezone";
import type { ActivityEvent } from "@/hooks/useActivityFeed";

export type { ActivityEvent };

export const severityConfig: Record<string, { color: string; icon: React.ElementType }> = {
  INFO: { color: "bg-blue-500/20 text-blue-400", icon: Activity },
  WARN: { color: "bg-yellow-500/20 text-yellow-400", icon: AlertTriangle },
  ERROR: { color: "bg-destructive/20 text-destructive", icon: AlertTriangle },
  CRITICAL: { color: "bg-red-600/20 text-red-400", icon: Zap },
};

export const eventTypeIcons: Record<string, React.ElementType> = {
  TRADE_EXECUTED: TrendingUp,
  TRADE_EXITED: TrendingUp,
  ORDER_BLOCKED_RISK: AlertTriangle,
  PROMOTED: TrendingUp,
  DEMOTED: TrendingUp,
  GRADUATED: TrendingUp,
  BACKTEST_STARTED: Activity,
  BACKTEST_COMPLETED: Activity,
  BACKTEST_FAILED: AlertTriangle,
  RUNNER_STARTED: Play,
  RUNNER_RESTARTED: RefreshCw,
  RUNNER_STOPPED: X,
  JOB_TIMEOUT: Clock,
  KILL_TRIGGERED: Zap,
  AUTONOMY_TIER_CHANGED: Shield,
  AUTONOMY_GATE_BLOCKED: AlertTriangle,
  INTEGRATION_VERIFIED: Activity,
  INTEGRATION_USAGE_PROOF: Activity,
  NOTIFY_DISCORD_SENT: MessageSquare,
  NOTIFY_DISCORD_FAILED: MessageSquare,
  SYSTEM_STATUS_CHANGED: Activity,
  BOT_CREATED: Bot,
  BOT_ARCHIVED: Bot,
};

export function getOutcomeAccent(event: ActivityEvent): string {
  const eventType = event.event_type;
  const severity = event.severity;
  const pnl = event.metadata?.realized_pnl as number | undefined;

  if (eventType === "TRADE_EXECUTED" || eventType === "TRADE_EXITED") {
    if (pnl !== undefined) {
      if (pnl > 100) return "border-l-2 border-l-green-500";
      if (pnl > 0) return "border-l-2 border-l-green-400/60";
      if (pnl < -100) return "border-l-2 border-l-red-500";
      if (pnl < 0) return "border-l-2 border-l-red-400/60";
    }
    return "border-l-2 border-l-green-400/40";
  }

  if (eventType.includes("FAILED") || eventType.includes("ERROR") || eventType === "KILL_TRIGGERED") {
    return "border-l-2 border-l-red-500";
  }

  if (eventType === "ORDER_BLOCKED_RISK" || eventType === "AUTONOMY_GATE_BLOCKED" || severity === "WARN") {
    return "border-l-2 border-l-amber-500";
  }

  if (eventType === "PROMOTED" || eventType === "GRADUATED" || eventType === "BACKTEST_COMPLETED") {
    return "border-l-2 border-l-green-500";
  }

  if (eventType === "DEMOTED") {
    return "border-l-2 border-l-amber-500";
  }

  return "border-l-2 border-l-blue-400/40";
}

export function isAutonomyEvent(eventType: string): boolean {
  return eventType.includes("AUTONOMY") || eventType === "KILL_TRIGGERED";
}

export function PnLDisplay({ pnl }: { pnl: number }) {
  const isPositive = pnl >= 0;
  const intensity = Math.abs(pnl) > 100 ? "font-semibold" : "font-normal";
  const color = isPositive
    ? Math.abs(pnl) > 100 ? "text-green-500" : "text-green-400/80"
    : Math.abs(pnl) > 100 ? "text-red-500" : "text-red-400/80";

  return (
    <span className={`text-xs ${color} ${intensity}`} data-testid="pnl-display">
      {isPositive ? "+" : ""}{pnl.toFixed(2)}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={handleCopy}
      data-testid={`button-copy-${label || "text"}`}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export function EventDetailDrawer({
  event,
  open,
  onClose,
}: {
  event: ActivityEvent | null;
  open: boolean;
  onClose: () => void;
}) {
  const { formatDateTime, getTimezoneAbbr } = useTimezone();
  
  if (!event) return null;

  const sevConfig = severityConfig[event.severity] || severityConfig.INFO;
  const isTradeEvent = event.event_type.includes("TRADE") || event.event_type.includes("ORDER");
  const showAutonomyBadge = isAutonomyEvent(event.event_type);
  const decisionTraceId = event.metadata?.decision_trace_id;
  const noTradeTraceId = event.metadata?.no_trade_trace_id;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Badge className={sevConfig.color}>{event.severity}</Badge>
            {event.title}
          </SheetTitle>
          <SheetDescription>
            {formatDateTime(event.created_at)} {getTimezoneAbbr()}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-1">Event Type</h4>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{event.event_type.replace(/_/g, " ")}</Badge>
              {showAutonomyBadge && (
                <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-400 border-purple-500/30">
                  <Shield className="h-3 w-3 mr-1" />
                  Autonomy
                </Badge>
              )}
            </div>
          </div>

          {event.summary && (
            <div>
              <h4 className="text-sm font-medium mb-1">Summary</h4>
              <p className="text-sm text-muted-foreground">{event.summary}</p>
            </div>
          )}

          {event.bot_name && event.bot_id && (
            <div>
              <h4 className="text-sm font-medium mb-1">Bot</h4>
              <Link
                to={`/bots/${event.bot_id}`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                {event.bot_name}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}

          {event.stage && (
            <div>
              <h4 className="text-sm font-medium mb-1">Stage</h4>
              <Badge>{event.stage}</Badge>
            </div>
          )}

          {event.symbol && (
            <div>
              <h4 className="text-sm font-medium mb-1">Symbol</h4>
              <span className="text-sm font-mono">{event.symbol}</span>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium mb-1">Trace ID</h4>
            <div className="flex items-center gap-1">
              <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{event.trace_id}</code>
              <CopyButton text={event.trace_id} label="trace-id" />
            </div>
          </div>

          {event.job_id && (
            <div>
              <h4 className="text-sm font-medium mb-1">Job ID</h4>
              <div className="flex items-center gap-1">
                <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{event.job_id}</code>
                <CopyButton text={event.job_id} label="job-id" />
              </div>
            </div>
          )}

          {isTradeEvent && (decisionTraceId || noTradeTraceId) && (
            <div>
              <h4 className="text-sm font-medium mb-2">Related Traces</h4>
              <div className="flex flex-col gap-2">
                {decisionTraceId && event.bot_id && (
                  <Link
                    to={`/bots/${event.bot_id}?tab=decisions`}
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Decision Trace
                  </Link>
                )}
                {noTradeTraceId && event.bot_id && (
                  <Link
                    to={`/bots/${event.bot_id}?tab=no-trades`}
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View Suppression Reasons
                  </Link>
                )}
              </div>
            </div>
          )}

          {showAutonomyBadge && event.bot_id && (
            <div>
              <h4 className="text-sm font-medium mb-2">Autonomy Details</h4>
              <Link
                to={`/bots/${event.bot_id}?tab=autonomy`}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <Shield className="h-3 w-3" />
                View Autonomy Score
              </Link>
            </div>
          )}

          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Payload</h4>
              <ScrollArea className="h-40">
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto font-mono">
                  {JSON.stringify(event.metadata, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
