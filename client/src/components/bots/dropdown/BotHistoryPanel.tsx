import { History, GitBranch, RotateCcw, Play, Pause, Square, AlertTriangle, TrendingUp, Zap, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBotHistory } from "@/hooks/useBotHistory";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { useServerClock, formatRelativeTimeWithClock } from "@/contexts/ServerClockContext";

function parseAsUTC(dateStr: string): Date {
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

interface BotHistoryPanelProps {
  botId: string;
}

const eventConfig: Record<string, { color: string; icon: React.ElementType }> = {
  CREATED: { color: "bg-green-500/20 text-green-400", icon: Play },
  EVOLVED: { color: "bg-purple-500/20 text-purple-400", icon: GitBranch },
  REVERTED: { color: "bg-yellow-500/20 text-yellow-400", icon: RotateCcw },
  CLONED: { color: "bg-blue-500/20 text-blue-400", icon: GitBranch },
  BRANCHED: { color: "bg-indigo-500/20 text-indigo-400", icon: GitBranch },
  PROMOTED: { color: "bg-emerald-500/20 text-emerald-400", icon: TrendingUp },
  PAUSED: { color: "bg-yellow-500/20 text-yellow-400", icon: Pause },
  RESUMED: { color: "bg-green-500/20 text-green-400", icon: Play },
  STARTED: { color: "bg-green-500/20 text-green-400", icon: Play },
  STOPPED: { color: "bg-muted text-muted-foreground", icon: Square },
  ERROR: { color: "bg-destructive/20 text-destructive", icon: AlertTriangle },
  STALL: { color: "bg-orange-500/20 text-orange-400", icon: AlertTriangle },
  BACKTEST_STARTED: { color: "bg-purple-500/20 text-purple-400", icon: TrendingUp },
  BACKTEST_FINISHED: { color: "bg-purple-500/20 text-purple-400", icon: TrendingUp },
  TRADE_OPENED: { color: "bg-blue-500/20 text-blue-400", icon: Zap },
  TRADE_CLOSED: { color: "bg-blue-500/20 text-blue-400", icon: Zap },
};

const eventTypes = [
  { value: "all", label: "All Events" },
  { value: "CREATED", label: "Created" },
  { value: "EVOLVED", label: "Evolved" },
  { value: "REVERTED", label: "Reverted" },
  { value: "BRANCHED", label: "Branched" },
  { value: "PROMOTED", label: "Promoted" },
  { value: "STARTED", label: "Started" },
  { value: "STOPPED", label: "Stopped" },
  { value: "PAUSED", label: "Paused" },
  { value: "ERROR", label: "Error" },
  { value: "STALL", label: "Stall" },
  { value: "BACKTEST_STARTED", label: "Backtest Started" },
  { value: "BACKTEST_FINISHED", label: "Backtest Finished" },
];

export function BotHistoryPanel({ botId }: BotHistoryPanelProps) {
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const { serverNow } = useServerClock();
  
  const { data: events, isLoading } = useBotHistory(botId, {
    limit: 50,
    eventType: eventTypeFilter === "all" ? undefined : eventTypeFilter,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            History
          </CardTitle>
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-[140px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eventTypes.map((type) => (
                <SelectItem key={type.value} value={type.value} className="text-xs">
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[200px]">
          {events && events.length > 0 ? (
            <div className="space-y-2">
              {events.map((event) => {
                const config = eventConfig[event.event_type] || { 
                  color: "bg-muted text-muted-foreground", 
                  icon: History 
                };
                const EventIcon = config.icon;

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <Badge className={`${config.color} shrink-0 mt-0.5`}>
                      <EventIcon className="h-3 w-3" />
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{event.event_type.replace(/_/g, " ")}</span>
                        {event.mode && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {event.mode}
                          </Badge>
                        )}
                      </div>
                      {event.message && (
                        <p className="text-xs text-muted-foreground truncate">{event.message}</p>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1 cursor-help">
                            <Clock className="h-2.5 w-2.5" />
                            {formatRelativeTimeWithClock(event.timestamp, serverNow)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          {formatAbsoluteTime(event.timestamp)}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[150px] text-muted-foreground">
              <History className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No history events</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
