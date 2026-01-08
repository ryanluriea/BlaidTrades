/**
 * AlertsDropdown - Alerts indicator with popover showing AI Summary and Recent Activity
 * 
 * Combines the ActivitySlot visual style with the BotActivityPopover's full popup content.
 * Displayed in the ActivityGrid at the Alerts slot position.
 */
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/fetch";
import { MessageCircle, Sparkles, Loader2, Clock, Shield, Activity, RefreshCw, Zap, ArrowRight, X, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatInTimeZone } from "date-fns-tz";
import { useServerClock, formatRelativeTimeWithClock } from "@/contexts/ServerClockContext";
import {
  ActivityEvent,
  severityConfig,
  eventTypeIcons,
  getOutcomeAccent,
  isAutonomyEvent,
} from "@/components/activity/shared";

interface AlertsDropdownProps {
  botId: string;
  botName: string;
  stage: string;
  generationNumber?: number;
  winRate?: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  sharpe?: number | null;
  trades?: number | null;
  alertCount?: number;
  peakGeneration?: number | null;
  peakSharpe?: number | null;
  isRevertCandidate?: boolean;
  declineFromPeakPct?: number | null;
  trendDirection?: string | null;
}

interface ActivityResponse {
  success: boolean;
  data: {
    items: ActivityEvent[];
    nextCursor: string | null;
  };
}

interface ActivityCountResponse {
  success: boolean;
  count: number;
  latest_at: string | null;
  bot_id: string;
  since: string;
}

interface AISummaryResponse {
  success: boolean;
  summary: string;
  highlights: {
    type: "positive" | "negative" | "neutral";
    text: string;
  }[];
  performanceTrend: "improving" | "declining" | "stable" | null;
  recentChanges: { description: string; when: string }[];
  suggestedNextSteps: string[];
  promotionStatus: {
    gatesTotal: number;
    gatesPassed: number;
    blockers: string[];
    estimatedDays: number | null;
  } | null;
}

const IMPORTANT_EVENT_TYPES = [
  "PROMOTED",
  "DEMOTED",
  "GRADUATED",
  "KILL_TRIGGERED",
  "AUTONOMY_TIER_CHANGED",
  "AUTONOMY_GATE_BLOCKED",
  "BACKTEST_COMPLETED",
  "BACKTEST_FAILED",
  "RUNNER_STOPPED",
  "JOB_TIMEOUT",
];

function prioritizeEvents(events: ActivityEvent[]): ActivityEvent[] {
  const priority: Record<string, number> = {
    KILL_TRIGGERED: 1,
    DEMOTED: 2,
    AUTONOMY_GATE_BLOCKED: 3,
    BACKTEST_FAILED: 4,
    RUNNER_STOPPED: 5,
    JOB_TIMEOUT: 6,
    PROMOTED: 7,
    GRADUATED: 8,
    AUTONOMY_TIER_CHANGED: 9,
    BACKTEST_COMPLETED: 10,
  };
  
  return [...events].sort((a, b) => {
    const pa = priority[a.event_type] ?? 100;
    const pb = priority[b.event_type] ?? 100;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function formatAbsoluteTime(dateStr: string): string {
  try {
    return formatInTimeZone(new Date(dateStr), "America/New_York", "MMM d, h:mm a zzz");
  } catch {
    return new Date(dateStr).toLocaleString("en-US", { 
      month: "short", 
      day: "numeric", 
      hour: "numeric", 
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/New_York"
    });
  }
}

interface GroupedEvent {
  event: ActivityEvent;
  count: number;
  latestAt: string;
}

function getEventSignature(event: ActivityEvent): string {
  const summaryPrefix = (event.summary || "").slice(0, 50);
  return `${event.event_type}:${event.title}:${summaryPrefix}`;
}

function deduplicateEvents(events: ActivityEvent[], serverNow: number): GroupedEvent[] {
  if (events.length === 0) return [];
  
  const signatureMap = new Map<string, GroupedEvent>();
  const twentyFourHoursAgo = serverNow - 24 * 60 * 60 * 1000;
  const result: GroupedEvent[] = [];
  
  for (const event of events) {
    const eventTime = new Date(event.created_at).getTime();
    const signature = getEventSignature(event);
    
    if (eventTime > twentyFourHoursAgo && signatureMap.has(signature)) {
      const existing = signatureMap.get(signature)!;
      existing.count++;
      if (eventTime > new Date(existing.latestAt).getTime()) {
        existing.latestAt = event.created_at;
      }
    } else {
      const group: GroupedEvent = {
        event,
        count: 1,
        latestAt: event.created_at,
      };
      signatureMap.set(signature, group);
      result.push(group);
    }
  }
  
  return result;
}

function CompactEventCard({ event, count = 1, serverNow }: { event: ActivityEvent; count?: number; serverNow: number }) {
  const sevConfig = severityConfig[event.severity] || severityConfig.INFO;
  const EventIcon = eventTypeIcons[event.event_type] || Activity;
  const outcomeAccent = getOutcomeAccent(event);
  const showAutonomyBadge = isAutonomyEvent(event.event_type);
  
  return (
    <div 
      className={cn(
        "flex items-start gap-2.5 p-2.5 hover-elevate cursor-pointer border-b border-border/30 last:border-0",
        outcomeAccent
      )}
      data-testid={`bot-activity-event-${event.id}`}
    >
      <div className={cn("p-1.5 rounded flex-shrink-0", sevConfig.color)}>
        <EventIcon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-medium text-xs">{event.title}</span>
          {count > 1 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-muted text-muted-foreground">
              x{count}
            </Badge>
          )}
          {showAutonomyBadge && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30">
              <Shield className="h-2.5 w-2.5" />
            </Badge>
          )}
        </div>
        {event.summary && (
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
            {event.summary}
          </p>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1 mt-1 cursor-help">
              <Clock className="h-2.5 w-2.5" />
              {formatRelativeTimeWithClock(event.created_at, serverNow)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {formatAbsoluteTime(event.created_at)}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function AISummarySection({ 
  botId, 
  botName,
  stage,
  generationNumber,
  winRate,
  profitFactor,
  maxDrawdownPct,
  sharpe,
  trades,
}: AlertsDropdownProps) {
  const { data, isLoading, error } = useQuery<AISummaryResponse>({
    queryKey: ["/api/bots", botId, "ai-summary"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/bots/${botId}/ai-summary`);
      if (!res.ok) {
        return {
          success: false,
          summary: generateFallbackSummary({ botName, stage, generationNumber, winRate, profitFactor, maxDrawdownPct, sharpe, trades }),
          highlights: [],
          promotionStatus: null,
          recentChanges: [],
          suggestedNextSteps: [],
          performanceTrend: null,
        };
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="p-3 bg-muted/30 rounded-md mb-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating AI summary...
        </div>
      </div>
    );
  }

  const summary = data?.summary || generateFallbackSummary({ botName, stage, generationNumber, winRate, profitFactor, maxDrawdownPct, sharpe, trades });
  const highlights = data?.highlights || [];
  const promotionStatus = data?.promotionStatus;
  const recentChanges = data?.recentChanges || [];
  const suggestedNextSteps = data?.suggestedNextSteps || [];

  return (
    <div className="p-3 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-md mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
        <span className="text-xs font-medium text-purple-400">AI Summary</span>
      </div>
      <p className="text-xs text-foreground/90 leading-relaxed">{summary}</p>
      
      {highlights.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {highlights.map((h, i) => (
            <Badge 
              key={i}
              variant="outline"
              className={cn(
                "text-[9px] px-1.5",
                h.type === "positive" && "bg-green-500/10 text-green-400 border-green-500/30",
                h.type === "negative" && "bg-red-500/10 text-red-400 border-red-500/30",
                h.type === "neutral" && "bg-muted text-muted-foreground"
              )}
            >
              {h.text}
            </Badge>
          ))}
        </div>
      )}
      
      <div className="mt-2 pt-2 border-t border-purple-500/20">
        <div className="flex items-center gap-1 mb-1">
          <Zap className="h-3 w-3 text-yellow-400" />
          <span className="text-[10px] font-medium text-muted-foreground">What Changed</span>
        </div>
        {recentChanges.length > 0 ? (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            {recentChanges.slice(0, 2).map((c, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-muted-foreground/50">-</span>
                <span className="line-clamp-1">{c.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-muted-foreground/60 italic">
            Strategy parameters being optimized through backtesting
          </p>
        )}
      </div>
      
      <div className="mt-2 pt-2 border-t border-purple-500/20">
        <div className="flex items-center gap-1 mb-1">
          <ArrowRight className="h-3 w-3 text-blue-400" />
          <span className="text-[10px] font-medium text-muted-foreground">What's Next</span>
        </div>
        {suggestedNextSteps.length > 0 ? (
          <ul className="text-[10px] text-muted-foreground space-y-0.5">
            {suggestedNextSteps.slice(0, 2).map((step, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-blue-400/70">{i + 1}.</span>
                <span className="line-clamp-1">{step}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-muted-foreground/60 italic">
            Continue evolving to meet promotion gates
          </p>
        )}
      </div>
      
      {promotionStatus && (
        <div className="mt-2 pt-2 border-t border-purple-500/20">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${(promotionStatus.gatesPassed / promotionStatus.gatesTotal) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {promotionStatus.gatesPassed}/{promotionStatus.gatesTotal} gates
            </span>
          </div>
          {promotionStatus.blockers.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Blockers: {promotionStatus.blockers.slice(0, 2).join(", ")}
              {promotionStatus.blockers.length > 2 && ` +${promotionStatus.blockers.length - 2} more`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function generateFallbackSummary(props: Partial<AlertsDropdownProps>): string {
  const { botName, stage, generationNumber, winRate, profitFactor, trades } = props;
  
  const parts: string[] = [];
  
  if (generationNumber && generationNumber > 1) {
    parts.push(`${botName} has evolved ${generationNumber} times`);
  } else {
    parts.push(`${botName} is in early development`);
  }
  
  if (stage) {
    parts.push(`currently in ${stage} stage`);
  }
  
  if (winRate !== null && winRate !== undefined) {
    const wr = typeof winRate === 'number' ? (winRate > 1 ? winRate : winRate * 100) : 0;
    if (wr >= 50) {
      parts.push(`with a solid ${wr.toFixed(0)}% win rate`);
    } else if (wr >= 40) {
      parts.push(`with ${wr.toFixed(0)}% win rate`);
    }
  }
  
  if (trades !== null && trades !== undefined && trades < 50) {
    parts.push(`Needs ${50 - trades} more trades for statistical significance`);
  }
  
  return parts.join(". ") + ".";
}

const ACTIVITY_VIEWED_KEY_PREFIX = "bot-activity-viewed-";

function getLastViewedTime(botId: string): number | null {
  try {
    const stored = localStorage.getItem(`${ACTIVITY_VIEWED_KEY_PREFIX}${botId}`);
    if (stored) {
      const ts = parseInt(stored, 10);
      if (!isNaN(ts) && ts > 0) {
        return ts;
      }
    }
  } catch {
  }
  return null;
}

function setLastViewedTime(botId: string, timestamp: number): void {
  try {
    localStorage.setItem(`${ACTIVITY_VIEWED_KEY_PREFIX}${botId}`, timestamp.toString());
  } catch {
  }
}

export function AlertsDropdown(props: AlertsDropdownProps) {
  const { botId, botName, stage, alertCount = 0, isRevertCandidate = false } = props;
  const [open, setOpen] = useState(false);
  const [lastViewedAt, setLastViewedAt] = useState<number | null>(() => getLastViewedTime(botId));
  const { serverNow } = useServerClock();
  const hasRecordedOpenRef = useRef(false);
  
  const hasAlerts = alertCount > 0;
  
  useEffect(() => {
    if (open && !hasRecordedOpenRef.current) {
      hasRecordedOpenRef.current = true;
      setLastViewedTime(botId, serverNow);
      setLastViewedAt(serverNow);
    }
    if (!open) {
      hasRecordedOpenRef.current = false;
    }
  }, [open, botId, serverNow]);
  
  const { data: countData } = useQuery<ActivityCountResponse>({
    queryKey: ["/api/activity-count", botId],
    queryFn: async () => {
      const params = new URLSearchParams({ botId });
      const res = await authenticatedFetch(`/api/activity-count?${params}`);
      if (!res.ok) throw new Error("Failed to fetch activity count");
      return res.json();
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });
  
  const { data, isLoading, refetch, isFetching } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", { botId, types: IMPORTANT_EVENT_TYPES }],
    queryFn: async () => {
      const params = new URLSearchParams({
        botId,
        types: IMPORTANT_EVENT_TYPES.join(","),
        limit: "20",
      });
      const res = await authenticatedFetch(`/api/activity?${params}`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    enabled: open,
    staleTime: 30000,
  });
  
  const events = data?.data?.items || [];
  const prioritizedEvents = prioritizeEvents(events);
  const groupedEvents = deduplicateEvents(prioritizedEvents, serverNow);
  
  const hasUnseenActivity = (() => {
    if (!countData?.count || countData.count === 0) return false;
    if (!lastViewedAt) return true;
    if (countData.latest_at) {
      const latestEventTime = new Date(countData.latest_at).getTime();
      return latestEventTime > lastViewedAt;
    }
    return false;
  })();
  
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <button
              onClick={handleClick}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-[64px] h-6 flex items-center justify-center rounded-sm border bg-muted/20 border-muted-foreground/30 transition-all relative cursor-pointer hover:bg-muted/40"
              data-testid={`alerts-dropdown-${botId}`}
            >
              <MessageCircle className={cn(
                "w-5 h-5",
                (hasAlerts || hasUnseenActivity) ? "text-purple-400" : "text-muted-foreground"
              )} />
              {/* Messenger-style red notification badge */}
              {(hasAlerts || hasUnseenActivity || isRevertCandidate) && (
                <span 
                  className={cn(
                    "absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white shadow-sm",
                    isRevertCandidate ? "bg-red-500" : (hasAlerts || hasUnseenActivity) ? "bg-red-500" : "bg-red-500"
                  )}
                  data-testid={`badge-unseen-activity-${botId}`}
                >
                  {hasAlerts ? (alertCount > 99 ? '99+' : alertCount) : hasUnseenActivity ? 'new' : ''}
                </span>
              )}
            </button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">AI Messages</div>
          {(hasAlerts || hasUnseenActivity) ? (
            <div className="text-muted-foreground">
              {alertCount > 0 ? `${alertCount} message${alertCount > 1 ? 's' : ''}` : 'New activity'}
            </div>
          ) : (
            <div className="text-muted-foreground">No new messages</div>
          )}
        </TooltipContent>
      </Tooltip>
      
      <DialogContent 
        className="max-w-2xl p-0 gap-0"
        data-testid={`dialog-alerts-${botId}`}
      >
        <DialogHeader className="p-4 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-purple-400" />
              <DialogTitle className="text-base font-semibold">{botName}</DialogTitle>
              <Badge variant="secondary" className="text-[10px]">{stage}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] text-muted-foreground border-dashed">
                <MessageSquare className="h-3 w-3 mr-1" />
                Reply Coming Soon
              </Badge>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="button-refresh-alerts-activity"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="grid grid-cols-2 divide-x divide-border min-h-[400px]">
          <div className="p-4 bg-muted/10">
            <AISummarySection {...props} />
          </div>
          
          <ScrollArea className="h-[400px]">
            <div className="p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : groupedEvents.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No recent activity</p>
                  <p className="text-xs">Important events will appear here</p>
                </div>
              ) : (
                <div className="space-y-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Recent Activity
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {events.length} events
                    </Badge>
                  </div>
                  {groupedEvents.slice(0, 20).map((grouped) => (
                    <CompactEventCard 
                      key={grouped.event.id} 
                      event={grouped.event} 
                      count={grouped.count}
                      serverNow={serverNow}
                    />
                  ))}
                  {groupedEvents.length > 20 && (
                    <div className="pt-2 text-center">
                      <span className="text-xs text-muted-foreground">
                        +{groupedEvents.length - 20} more event groups
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
