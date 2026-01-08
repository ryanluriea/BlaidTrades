import { useRef, useState } from "react";
import { Calendar, AlertTriangle, MoreVertical, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpcomingHighImpactEvents, EconomicEvent } from "@/hooks/useEconomicEvents";
import { parseISO, isToday, isTomorrow, isYesterday } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const DATA_SOURCES = [
  { id: "fred", label: "FRED" },
  { id: "finnhub", label: "Finnhub" },
  { id: "polygon", label: "Polygon" },
  { id: "newsapi", label: "NewsAPI" },
  { id: "marketaux", label: "Marketaux" },
];

function ImpactDot({ impact }: { impact: string | null }) {
  const colorClass = impact === "HIGH" 
    ? "bg-red-500" 
    : impact === "MEDIUM" 
      ? "bg-yellow-500" 
      : "bg-gray-400";
  
  return (
    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colorClass}`} />
  );
}

function formatEventTime(dateStr: string) {
  try {
    const date = parseISO(dateStr);
    return formatInTimeZone(date, 'America/New_York', 'h:mm a');
  } catch {
    return dateStr;
  }
}

function formatEventDay(dateStr: string) {
  try {
    const date = parseISO(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isYesterday(date)) return "Yesterday";
    return formatInTimeZone(date, 'America/New_York', 'MM/dd');
  } catch {
    return "";
  }
}

function isPastEvent(dateStr: string): boolean {
  try {
    const eventDate = parseISO(dateStr);
    return eventDate < new Date();
  } catch {
    return false;
  }
}

function EventRow({ event, showDayHeader, isFirst }: { event: EconomicEvent; showDayHeader?: string; isFirst?: boolean }) {
  const isPast = isPastEvent(event.scheduled_at);
  
  return (
    <div data-testid={`event-row-${event.id}`}>
      {showDayHeader && (
        <div className={`text-xs font-semibold text-muted-foreground py-1.5 px-1 ${!isFirst ? 'mt-2 border-t border-border/50' : ''}`}>
          {showDayHeader}
        </div>
      )}
      <div className={`flex items-center gap-3 py-2 px-1 ${isPast ? 'opacity-50' : ''}`}>
        <ImpactDot impact={event.impact_level} />
        <div className="flex-1 min-w-0">
          <div className={`text-sm ${isPast ? 'line-through' : ''}`}>
            {event.event_name}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <span>{formatEventTime(event.scheduled_at)}</span>
          <span className="font-medium">{event.country}</span>
        </div>
      </div>
    </div>
  );
}

export function MacroEventsPill() {
  const { data: events = [], isLoading, error } = useUpcomingHighImpactEvents();
  const [isOpen, setIsOpen] = useState(false);
  const [showHigh, setShowHigh] = useState(true);
  const [showMedium, setShowMedium] = useState(true);
  const [enabledSources, setEnabledSources] = useState<Set<string>>(new Set(DATA_SOURCES.map(s => s.id)));
  const nowLineRef = useRef<HTMLDivElement>(null);

  const toggleSource = (sourceId: string) => {
    setEnabledSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  // Filter events based on impact level only (source filtering would need event.source field)
  const filteredEvents = events.filter(e => {
    const impactMatch = (e.impact_level === "HIGH" && showHigh) || (e.impact_level === "MEDIUM" && showMedium);
    return impactMatch;
  });

  const sortedEvents = [...filteredEvents].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
  );

  // Partition into past and upcoming
  const pastEvents = sortedEvents.filter((e) => isPastEvent(e.scheduled_at));
  const upcomingEvents = sortedEvents.filter((e) => !isPastEvent(e.scheduled_at));

  // Counts for badge (unfiltered upcoming)
  const allUpcoming = events.filter((e) => !isPastEvent(e.scheduled_at));
  const highImpactCount = allUpcoming.filter((e) => e.impact_level === "HIGH").length;
  const mediumImpactCount = allUpcoming.filter((e) => e.impact_level === "MEDIUM").length;

  // Group events by day for headers
  function getEventDayKey(event: EconomicEvent) {
    try {
      const date = parseISO(event.scheduled_at);
      return formatInTimeZone(date, 'America/New_York', 'yyyy-MM-dd');
    } catch {
      return 'unknown';
    }
  }

  // No auto-scroll needed - upcoming events are at top, user scrolls down for past

  if (isLoading) {
    return (
      <Button variant="ghost" size="icon" disabled data-testid="button-macro-events-loading">
        <Calendar className="h-4 w-4 text-muted-foreground" />
      </Button>
    );
  }

  if (error) {
    return (
      <Button variant="ghost" size="icon" disabled data-testid="button-macro-events-error">
        <AlertTriangle className="h-4 w-4 text-destructive" />
      </Button>
    );
  }

  // Build day-grouped rendering
  let lastDayKey = '';

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-macro-events"
        >
          <Calendar className="h-4 w-4" />
          {(highImpactCount > 0 || mediumImpactCount > 0) && (
            <Badge 
              className={`absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] font-medium rounded-full border-0 ${
                highImpactCount > 0 
                  ? "bg-red-500 text-white" 
                  : "bg-yellow-500 text-yellow-950"
              }`}
            >
              {highImpactCount + mediumImpactCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Economic Calendar
              </CardTitle>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowHigh(!showHigh)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-opacity ${showHigh ? 'opacity-100' : 'opacity-40'}`}
                  data-testid="filter-high"
                >
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span>High</span>
                </button>
                <button
                  onClick={() => setShowMedium(!showMedium)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-opacity ${showMedium ? 'opacity-100' : 'opacity-40'}`}
                  data-testid="filter-medium"
                >
                  <div className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span>Med</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="p-1 hover:bg-muted rounded" data-testid="button-sources-menu">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Data Sources</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {DATA_SOURCES.map(source => (
                      <DropdownMenuItem
                        key={source.id}
                        onClick={() => toggleSource(source.id)}
                        className="flex items-center justify-between cursor-pointer"
                        data-testid={`menu-source-${source.id}`}
                      >
                        <span>{source.label}</span>
                        {enabledSources.has(source.id) && <Check className="h-4 w-4 text-green-500" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <ScrollArea className="h-[350px]">
            <CardContent className="pt-0 pb-2">
              {/* Upcoming events first (at top) - user sees these on open */}
              {(() => {
                let upcomingLastDayKey = '';
                return upcomingEvents.map((event, index) => {
                  const dayKey = getEventDayKey(event);
                  const showHeader = dayKey !== upcomingLastDayKey;
                  if (showHeader) upcomingLastDayKey = dayKey;
                  return (
                    <EventRow 
                      key={event.id} 
                      event={event} 
                      showDayHeader={showHeader ? formatEventDay(event.scheduled_at) : undefined}
                      isFirst={index === 0}
                    />
                  );
                });
              })()}
              
              {/* Now divider - scroll down to see past events */}
              <div 
                ref={nowLineRef}
                className="flex items-center gap-2 py-3 my-1"
                data-testid="now-divider"
              >
                <div className="h-px flex-1 bg-muted-foreground/30" />
                <span className="text-xs font-medium text-muted-foreground px-2">PASSED</span>
                <div className="h-px flex-1 bg-muted-foreground/30" />
              </div>
              
              {/* Past events below (scroll down to see) - most recent first */}
              {(() => {
                const reversedPast = [...pastEvents].reverse();
                let pastLastDayKey = '';
                return reversedPast.map((event, index) => {
                  const dayKey = getEventDayKey(event);
                  const showHeader = dayKey !== pastLastDayKey;
                  if (showHeader) pastLastDayKey = dayKey;
                  return (
                    <EventRow 
                      key={event.id} 
                      event={event} 
                      showDayHeader={showHeader ? formatEventDay(event.scheduled_at) : undefined}
                      isFirst={index === 0}
                    />
                  );
                });
              })()}
            </CardContent>
          </ScrollArea>
        </Card>
      </PopoverContent>
    </Popover>
  );
}
