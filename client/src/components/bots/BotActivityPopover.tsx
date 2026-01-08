import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/fetch";
import { Bell, Sparkles, Loader2, ChevronRight, Clock, TrendingUp, TrendingDown, Shield, AlertTriangle, Activity, Check, RefreshCw, Zap, ArrowRight, RotateCcw, Crown, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface BotActivityPopoverProps {
  botId: string;
  botName: string;
  stage: string;
  generationNumber?: number;
  winRate?: number | null;
  profitFactor?: number | null;
  maxDrawdownPct?: number | null;
  sharpe?: number | null;
  trades?: number | null;
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
  serverTime?: string;
}

interface ActivityCountResponse {
  success: boolean;
  count: number;
  latest_at: string | null;
  bot_id: string;
  since: string;
  serverTime?: string;
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
  "BOT_AUTO_REVERTED",
];

function prioritizeEvents(events: ActivityEvent[]): ActivityEvent[] {
  const priority: Record<string, number> = {
    BOT_AUTO_REVERTED: 0,
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

/**
 * Parse date string, normalizing PostgreSQL timestamps to UTC
 * PostgreSQL timestamps like "2025-12-28 14:42:00.000" lack timezone info
 * and must be treated as UTC, not local time
 */
function parseAsUTC(dateStr: string): Date {
  // Replace space with T for ISO format, append Z if no timezone marker
  let normalized = dateStr.replace(" ", "T");
  if (!normalized.includes("+") && !normalized.includes("Z") && !normalized.includes("-", 10)) {
    normalized += "Z";
  }
  return new Date(normalized);
}

function formatAbsoluteTime(dateStr: string): string {
  try {
    const utcDate = parseAsUTC(dateStr);
    return formatInTimeZone(utcDate, "America/New_York", "MMM d, h:mm a zzz");
  } catch {
    return parseAsUTC(dateStr).toLocaleString("en-US", { 
      month: "short", 
      day: "numeric", 
      hour: "numeric", 
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: "America/New_York"
    });
  }
}

/**
 * Transform technical event titles to plain language
 */
function humanizeEventTitle(event: ActivityEvent): string {
  const { event_type, title } = event;
  
  // Improvement cycle events
  if (event_type === "BACKTEST_COMPLETED") {
    if (title.includes("Improvement cycle")) {
      return "Strategy tuned";
    }
    if (title.includes("Backtest completed")) {
      return "Backtest finished";
    }
  }
  
  // Evolution events
  if (event_type === "AI_EVOLUTION" || title.includes("AI-Evolved")) {
    if (title.includes("AI-Evolved to Gen")) {
      const genMatch = title.match(/Gen (\d+)/);
      return genMatch ? `Evolved to Gen ${genMatch[1]}` : "Strategy evolved";
    }
    if (title.includes("Evolution converged")) {
      return "Evolution complete";
    }
    return "Strategy evolving";
  }
  
  // Promotion/Demotion events
  if (event_type === "PROMOTED" || title.includes("PROMOTED")) {
    return "Promoted to next stage";
  }
  if (event_type === "DEMOTED" || title.includes("DEMOTED")) {
    return "Demoted to previous stage";
  }
  
  // Revert events
  if (event_type === "BOT_AUTO_REVERTED" || title.includes("Auto-reverted")) {
    const genMatch = title.match(/Gen (\d+)/);
    return genMatch ? `Reverted to Gen ${genMatch[1]}` : "Strategy reverted";
  }
  
  // Self-healing events
  if (title.includes("Self-healing:")) {
    return title.replace("Self-healing:", "Auto-fixed:").trim();
  }
  
  // Account events
  if (title.includes("Auto-reset:")) {
    return "Account reset";
  }
  if (title.includes("Account reset succeeded")) {
    return "Account restored";
  }
  
  // Runner events
  if (title.includes("Auto-Restarted:")) {
    return "Trading restarted";
  }
  if (title.includes("RUNNER_STOPPED")) {
    return "Trading paused";
  }
  
  // Research events
  if (title.includes("Strategy Lab research cycle completed")) {
    return "Research cycle done";
  }
  
  // Building trade history
  if (title.includes("Building trade history")) {
    return "Building trade history";
  }
  
  // Ready for live
  if (title.includes("READY FOR LIVE") || title.includes("Ready for LIVE")) {
    return "Ready for live trading";
  }
  
  // Default: return original but cleaned up
  // Remove bot name prefix pattern like "BotName: "
  const cleaned = title.replace(/^[^:]+:\s*/, "");
  return cleaned || title;
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
  const grouped = new Map<string, GroupedEvent>();
  
  for (const event of events) {
    const signature = getEventSignature(event);
    const existing = grouped.get(signature);
    
    if (existing) {
      existing.count++;
      if (new Date(event.created_at).getTime() > new Date(existing.latestAt).getTime()) {
        existing.latestAt = event.created_at;
        existing.event = event;
      }
    } else {
      grouped.set(signature, {
        event,
        count: 1,
        latestAt: event.created_at,
      });
    }
  }
  
  return Array.from(grouped.values()).sort((a, b) => 
    new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime()
  );
}

function CompactEventCard({ event, count, serverNow }: { event: ActivityEvent; count: number; serverNow: number }) {
  const IconComponent = eventTypeIcons[event.event_type] || Activity;
  const severity = severityConfig[event.severity] || severityConfig.INFO;
  const showAutonomyBadge = isAutonomyEvent(event.event_type);
  const displayTitle = humanizeEventTitle(event);
  
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0 hover-elevate px-2 -mx-2 rounded">
      <div className={cn("p-1.5 rounded shrink-0 mt-0.5", severity.color?.split(' ')[0])}>
        <IconComponent className={cn("h-3.5 w-3.5", severity.color?.split(' ')[1])} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium truncate">{displayTitle}</span>
          {count > 1 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0">
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

function PeakGenerationIndicator({ 
  generationNumber, 
  peakGeneration, 
  peakSharpe, 
  sharpe,
  isRevertCandidate,
  declineFromPeakPct,
  trendDirection,
}: Pick<BotActivityPopoverProps, 'generationNumber' | 'peakGeneration' | 'peakSharpe' | 'sharpe' | 'isRevertCandidate' | 'declineFromPeakPct' | 'trendDirection'>) {
  const isAtPeak = generationNumber === peakGeneration;
  const hasPeakData = peakGeneration != null && peakSharpe != null;
  
  if (!hasPeakData) return null;

  return (
    <div className="p-3 bg-muted/30 rounded-md border border-border/50">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="h-4 w-4 text-yellow-500" />
        <span className="text-xs font-medium">Peak Performance</span>
        {isRevertCandidate && (
          <Badge variant="destructive" className="text-[9px] px-1.5 ml-auto">
            <RotateCcw className="h-2.5 w-2.5 mr-1" />
            Revert Candidate
          </Badge>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Peak Generation</span>
          <div className="font-medium flex items-center gap-1">
            Gen {peakGeneration}
            {isAtPeak && <Check className="h-3 w-3 text-green-500" />}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">Peak Sharpe</span>
          <div className="font-medium text-yellow-500">{peakSharpe?.toFixed(2)}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Current Gen</span>
          <div className="font-medium">Gen {generationNumber ?? 1}</div>
        </div>
        <div>
          <span className="text-muted-foreground">Current Sharpe</span>
          <div className={cn("font-medium", sharpe && sharpe > 0 ? "text-green-500" : "text-red-500")}>
            {sharpe?.toFixed(2) ?? "--"}
          </div>
        </div>
      </div>
      
      {declineFromPeakPct != null && declineFromPeakPct > 0 && (
        <div className="mt-2 pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Decline from Peak</span>
            <span className={cn(
              "font-medium",
              declineFromPeakPct > 20 ? "text-red-500" : 
              declineFromPeakPct > 10 ? "text-yellow-500" : "text-muted-foreground"
            )}>
              -{declineFromPeakPct.toFixed(1)}%
            </span>
          </div>
          {isRevertCandidate && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Will auto-revert to Gen {peakGeneration} if decline persists (20%+ threshold)
            </p>
          )}
        </div>
      )}
      
      {trendDirection && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          {trendDirection === "IMPROVING" && <TrendingUp className="h-3 w-3 text-green-500" />}
          {trendDirection === "DECLINING" && <TrendingDown className="h-3 w-3 text-red-500" />}
          <span className={cn(
            trendDirection === "IMPROVING" && "text-green-500",
            trendDirection === "DECLINING" && "text-red-500",
            trendDirection === "STABLE" && "text-muted-foreground"
          )}>
            Trend: {trendDirection}
          </span>
        </div>
      )}
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
  peakGeneration,
  peakSharpe,
  isRevertCandidate,
  declineFromPeakPct,
  trendDirection,
}: BotActivityPopoverProps) {
  const { data, isLoading, error } = useQuery<AISummaryResponse>({
    queryKey: ["/api/bots", botId, "ai-summary"],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/bots/${botId}/ai-summary`);
      if (!res.ok) {
        return {
          success: false,
          summary: generateFallbackSummary({ botName, stage, generationNumber, winRate, profitFactor, maxDrawdownPct, sharpe, trades, peakGeneration, peakSharpe, isRevertCandidate, declineFromPeakPct, trendDirection }),
          highlights: [],
          promotionStatus: null,
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
          Analyzing bot performance...
        </div>
      </div>
    );
  }

  const summary = data?.summary || generateFallbackSummary({ botName, stage, generationNumber, winRate, profitFactor, maxDrawdownPct, sharpe, trades, peakGeneration, peakSharpe, isRevertCandidate, declineFromPeakPct, trendDirection });
  const highlights = data?.highlights || [];
  const promotionStatus = data?.promotionStatus;
  const recentChanges = data?.recentChanges || [];
  const suggestedNextSteps = data?.suggestedNextSteps || [];

  return (
    <div className="space-y-3">
      <div className="p-3 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-md">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
          <span className="text-xs font-medium text-purple-400">AI Analysis</span>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed">{summary}</p>
        
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
        
        {recentChanges.length > 0 && (
          <div className="mt-2 pt-2 border-t border-purple-500/20">
            <div className="flex items-center gap-1 mb-1">
              <Zap className="h-3 w-3 text-yellow-400" />
              <span className="text-[10px] font-medium text-muted-foreground">What Changed</span>
            </div>
            <ul className="text-[10px] text-muted-foreground space-y-0.5">
              {recentChanges.slice(0, 3).map((c, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-muted-foreground/50">-</span>
                  <span>{c.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {suggestedNextSteps.length > 0 && (
          <div className="mt-2 pt-2 border-t border-purple-500/20">
            <div className="flex items-center gap-1 mb-1">
              <Target className="h-3 w-3 text-blue-400" />
              <span className="text-[10px] font-medium text-muted-foreground">What's Next</span>
            </div>
            <ul className="text-[10px] text-muted-foreground space-y-0.5">
              {suggestedNextSteps.slice(0, 2).map((step, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-blue-400/70">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
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
                Needs: {promotionStatus.blockers.slice(0, 2).join(", ")}
                {promotionStatus.blockers.length > 2 && ` +${promotionStatus.blockers.length - 2} more`}
              </p>
            )}
          </div>
        )}
      </div>
      
      <PeakGenerationIndicator 
        generationNumber={generationNumber}
        peakGeneration={peakGeneration}
        peakSharpe={peakSharpe}
        sharpe={sharpe}
        isRevertCandidate={isRevertCandidate}
        declineFromPeakPct={declineFromPeakPct}
        trendDirection={trendDirection}
      />
    </div>
  );
}

function generateFallbackSummary(props: Partial<BotActivityPopoverProps>): string {
  const { botName, stage, generationNumber, winRate, profitFactor, trades, sharpe, isRevertCandidate, declineFromPeakPct, peakGeneration, trendDirection } = props;
  
  const parts: string[] = [];
  
  if (generationNumber && generationNumber > 1) {
    parts.push(`${botName} has evolved ${generationNumber} times`);
  } else {
    parts.push(`${botName} is in early development`);
  }
  
  if (stage) {
    parts.push(`currently in ${stage} stage`);
  }
  
  if (trendDirection === "IMPROVING") {
    parts.push("and is showing improvement");
  } else if (trendDirection === "DECLINING") {
    parts.push("but recent performance is declining");
  }
  
  if (isRevertCandidate && peakGeneration && declineFromPeakPct) {
    parts.push(`Performance has dropped ${declineFromPeakPct.toFixed(0)}% from peak (Gen ${peakGeneration}). The system may auto-revert to restore better performance`);
  }
  
  if (winRate !== null && winRate !== undefined) {
    const wr = typeof winRate === 'number' ? (winRate > 1 ? winRate : winRate * 100) : 0;
    if (wr >= 50) {
      parts.push(`Win rate at ${wr.toFixed(0)}% shows consistent trade selection`);
    } else if (wr >= 40) {
      parts.push(`Win rate at ${wr.toFixed(0)}% needs improvement`);
    } else if (wr > 0) {
      parts.push(`Win rate at ${wr.toFixed(0)}% is below target - strategy optimization in progress`);
    }
  }
  
  if (sharpe !== null && sharpe !== undefined) {
    if (sharpe > 1.5) {
      parts.push("Risk-adjusted returns are excellent");
    } else if (sharpe > 0.5) {
      parts.push("Risk-adjusted returns are acceptable");
    } else if (sharpe < 0) {
      parts.push("Risk-adjusted returns are negative - optimization needed");
    }
  }
  
  if (trades !== null && trades !== undefined && trades < 50) {
    parts.push(`Needs ${50 - trades} more trades for statistical confidence`);
  }
  
  return parts.join(". ") + ".";
}

const ACTIVITY_VIEWED_KEY_PREFIX = "bot-activity-viewed-";

function getLastViewedTime(botId: string): number | null {
  try {
    const stored = localStorage.getItem(`${ACTIVITY_VIEWED_KEY_PREFIX}${botId}`);
    return stored ? parseInt(stored, 10) : null;
  } catch {
    return null;
  }
}

function setLastViewedTime(botId: string, timestamp: number): void {
  try {
    localStorage.setItem(`${ACTIVITY_VIEWED_KEY_PREFIX}${botId}`, timestamp.toString());
  } catch {}
}

export function BotActivityPopover(props: BotActivityPopoverProps) {
  const { botId, botName, stage, isRevertCandidate } = props;
  const [open, setOpen] = useState(false);
  const [lastViewedAt, setLastViewedAt] = useState<number | null>(() => getLastViewedTime(botId));
  const { serverNow, updateFromServerTime } = useServerClock();
  
  const { data: countData } = useQuery<ActivityCountResponse>({
    queryKey: ["/api/activity-count", botId],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await authenticatedFetch(`/api/activity-count?botId=${botId}&since=${since}`);
      if (!res.ok) return { success: false, count: 0, latest_at: null, bot_id: botId, since };
      const result = await res.json();
      if (result.serverTime) {
        updateFromServerTime(result.serverTime);
      }
      return result;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  
  const { data, isLoading, isFetching, refetch } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", botId],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/activity?botId=${botId}&limit=50`);
      if (!res.ok) throw new Error("Failed to fetch activity");
      const result = await res.json();
      if (result.serverTime) {
        updateFromServerTime(result.serverTime);
      }
      return result;
    },
    enabled: open,
    staleTime: 30_000,
  });
  
  useEffect(() => {
    if (open) {
      setLastViewedTime(botId, serverNow);
      setLastViewedAt(serverNow);
    }
  }, [open, botId, serverNow]);

  const events = data?.data?.items || [];
  const sortedEvents = prioritizeEvents(events);
  const groupedEvents = deduplicateEvents(sortedEvents, serverNow);
  
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
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative"
              data-testid={`button-bot-activity-${botId}`}
              onClick={handleClick}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Bell className="h-4 w-4" />
              {(hasUnseenActivity || isRevertCandidate) && (
                <span 
                  className={cn(
                    "absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                    isRevertCandidate ? "bg-red-500" : "bg-purple-500"
                  )}
                  data-testid={`badge-activity-dot-${botId}`}
                />
              )}
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">
            {isRevertCandidate ? "Revert candidate - click to view" : "Bot activity & AI analysis"}
          </p>
        </TooltipContent>
      </Tooltip>
      
      <DialogContent 
        className="max-w-2xl max-h-[85vh] p-0 gap-0"
        data-testid={`dialog-bot-activity-${botId}`}
      >
        <DialogHeader className="p-4 border-b border-border flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-400" />
            <DialogTitle className="text-base">{botName}</DialogTitle>
            <Badge variant="secondary" className="text-xs">{stage}</Badge>
            {isRevertCandidate && (
              <Badge variant="destructive" className="text-xs">
                <RotateCcw className="h-3 w-3 mr-1" />
                Revert Candidate
              </Badge>
            )}
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-activity"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </DialogHeader>
        
        <div className="flex flex-col md:flex-row h-[calc(85vh-80px)]">
          <div className="flex-1 p-4 border-b md:border-b-0 md:border-r border-border overflow-auto">
            <AISummarySection {...props} />
          </div>
          
          <ScrollArea className="flex-1 max-h-[50vh] md:max-h-none">
            <div className="p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : groupedEvents.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No recent activity</p>
                  <p className="text-xs">Events will appear here</p>
                </div>
              ) : (
                <div className="space-y-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Recent Activity
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
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
                      <span className="text-[10px] text-muted-foreground">
                        +{groupedEvents.length - 20} more events
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
