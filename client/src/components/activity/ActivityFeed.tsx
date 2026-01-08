import { useState, useCallback } from "react";
import { useActivityFeed, ActivityFeedFilters, ACTIVITY_EVENT_TYPES, SEVERITY_LEVELS, STAGES } from "@/hooks/useActivityFeed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Activity, 
  ChevronRight,
  Clock, 
  Filter, 
  Loader2, 
  RefreshCw,
  Search, 
  Shield,
} from "lucide-react";
import { formatDistanceToNow, subDays, subHours } from "date-fns";
import { Link } from "react-router-dom";
import {
  ActivityEvent,
  severityConfig,
  eventTypeIcons,
  getOutcomeAccent,
  isAutonomyEvent,
  PnLDisplay,
  EventDetailDrawer,
} from "./shared";

const TIME_RANGE_OPTIONS = [
  { value: "all", label: "All Time" },
  { value: "1h", label: "1 Hour" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
];

const EVENT_TYPE_CATEGORIES: Record<string, { label: string; types: string[] }> = {
  trading: {
    label: "Trading",
    types: ["TRADE_EXECUTED", "TRADE_EXITED", "ORDER_BLOCKED_RISK"],
  },
  lifecycle: {
    label: "Bot Lifecycle",
    types: ["PROMOTED", "DEMOTED", "GRADUATED", "BOT_CREATED", "BOT_ARCHIVED"],
  },
  runner: {
    label: "Runners & Jobs",
    types: ["RUNNER_STARTED", "RUNNER_STOPPED", "RUNNER_RESTARTED", "JOB_TIMEOUT"],
  },
  autonomy: {
    label: "Autonomy",
    types: ["AUTONOMY_TIER_CHANGED", "AUTONOMY_GATE_BLOCKED", "KILL_TRIGGERED"],
  },
  system: {
    label: "System",
    types: ["SYSTEM_STATUS_CHANGED", "INTEGRATION_VERIFIED", "INTEGRATION_USAGE_PROOF", "NOTIFY_DISCORD_SENT", "NOTIFY_DISCORD_FAILED"],
  },
  backtest: {
    label: "Backtesting",
    types: ["BACKTEST_STARTED", "BACKTEST_COMPLETED", "BACKTEST_FAILED"],
  },
};


function EventCard({ event, onClick }: { event: ActivityEvent; onClick: () => void }) {
  const sevConfig = severityConfig[event.severity] || severityConfig.INFO;
  const EventIcon = eventTypeIcons[event.event_type] || Activity;
  const outcomeAccent = getOutcomeAccent(event);
  const pnl = event.metadata?.realized_pnl as number | undefined;
  const showAutonomyBadge = isAutonomyEvent(event.event_type);
  
  return (
    <div 
      className={`flex items-start gap-3 p-3 hover-elevate cursor-pointer border-b border-border/50 last:border-0 ${outcomeAccent}`}
      onClick={onClick}
      data-testid={`activity-event-${event.id}`}
    >
      <div className={`p-2 rounded ${sevConfig.color}`}>
        <EventIcon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{event.title}</span>
          <Badge variant="outline" className="text-xs">
            {event.event_type.replace(/_/g, " ")}
          </Badge>
          {showAutonomyBadge && (
            <Badge variant="secondary" className="text-xs bg-purple-500/20 text-purple-400 border-purple-500/30">
              <Shield className="h-3 w-3 mr-1" />
              Autonomy
            </Badge>
          )}
          {pnl !== undefined && <PnLDisplay pnl={pnl} />}
        </div>
        {event.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {event.summary}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          {event.bot_name && (
            <Link 
              to={`/bots/${event.bot_id}`} 
              className="hover:underline text-primary"
              onClick={(e) => e.stopPropagation()}
            >
              {event.bot_name}
            </Link>
          )}
          {event.stage && (
            <Badge variant="secondary" className="text-xs">
              {event.stage}
            </Badge>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </div>
  );
}


interface ActivityFeedProps {
  botId?: string;
  compact?: boolean;
  maxHeight?: string;
}

export function ActivityFeed({ botId, compact = false, maxHeight = "400px" }: ActivityFeedProps) {
  const [filters, setFilters] = useState<ActivityFeedFilters>({
    botId,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  
  const { 
    data, 
    isLoading, 
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useActivityFeed(filters);
  
  const handleSearch = useCallback(() => {
    setFilters(prev => ({ ...prev, q: searchQuery || undefined }));
  }, [searchQuery]);
  
  const handleSeverityFilter = (severity: string) => {
    if (severity === "all") {
      setFilters(prev => ({ ...prev, severity: undefined }));
    } else {
      setFilters(prev => ({ ...prev, severity: [severity] }));
    }
  };
  
  const handleCategoryFilter = (category: string) => {
    if (category === "all") {
      setFilters(prev => ({ ...prev, types: undefined }));
    } else {
      const categoryTypes = EVENT_TYPE_CATEGORIES[category]?.types || [];
      setFilters(prev => ({ ...prev, types: categoryTypes }));
    }
  };
  
  const handleTimeRangeFilter = (range: string) => {
    if (range === "all") {
      setFilters(prev => ({ ...prev, from: undefined, to: undefined }));
    } else {
      const now = new Date();
      let fromDate: Date;
      switch (range) {
        case "1h":
          fromDate = subHours(now, 1);
          break;
        case "24h":
          fromDate = subDays(now, 1);
          break;
        case "7d":
          fromDate = subDays(now, 7);
          break;
        case "30d":
          fromDate = subDays(now, 30);
          break;
        default:
          fromDate = subDays(now, 1);
      }
      setFilters(prev => ({ ...prev, from: fromDate.toISOString(), to: now.toISOString() }));
    }
  };
  
  const clearFilters = () => {
    setFilters({ botId });
    setSearchQuery("");
  };
  
  const allEvents = data?.pages.flatMap(page => page.data.items) || [];
  
  const hasActiveFilters = filters.severity || filters.types || filters.q || filters.stage || filters.from;
  
  return (
    <Card>
      <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Activity Feed
          {allEvents.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {allEvents.length}
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => refetch()}
            data-testid="button-refresh-activity"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {!compact && (
            <Button
              variant={showFilters ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
              data-testid="button-toggle-filters"
            >
              <Filter className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      
      {showFilters && !compact && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-8"
                data-testid="input-search-activity"
              />
            </div>
            <Button size="sm" onClick={handleSearch} data-testid="button-search-activity">
              Search
            </Button>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Select onValueChange={handleTimeRangeFilter} defaultValue="all">
              <SelectTrigger className="w-28" data-testid="select-time-filter">
                <SelectValue placeholder="Time" />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select onValueChange={handleSeverityFilter} defaultValue="all">
              <SelectTrigger className="w-32" data-testid="select-severity-filter">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severity</SelectItem>
                {SEVERITY_LEVELS.map(sev => (
                  <SelectItem key={sev} value={sev}>{sev}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select onValueChange={handleCategoryFilter} defaultValue="all">
              <SelectTrigger className="w-36" data-testid="select-category-filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {Object.entries(EVENT_TYPE_CATEGORIES).map(([key, cat]) => (
                  <SelectItem key={key} value={key}>{cat.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {hasActiveFilters && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
      
      <CardContent className="p-0">
        <ScrollArea style={{ height: maxHeight }}>
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : allEvents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No activity events found
            </div>
          ) : (
            <>
              {allEvents.map((event) => (
                <EventCard 
                  key={event.id} 
                  event={event} 
                  onClick={() => setSelectedEvent(event)}
                />
              ))}
              
              {hasNextPage && (
                <div className="p-4 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    data-testid="button-load-more-activity"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </ScrollArea>
      </CardContent>
      
      <EventDetailDrawer
        event={selectedEvent}
        open={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </Card>
  );
}

export function RecentActivityWidget() {
  const { data, isLoading } = useActivityFeed({});
  const events = data?.pages[0]?.data.items.slice(0, 5) || [];
  
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  
  if (events.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        No recent activity
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      {events.map((event) => {
        const sevConfig = severityConfig[event.severity] || severityConfig.INFO;
        return (
          <div 
            key={event.id}
            className="flex items-center gap-2 text-sm"
          >
            <Badge className={`${sevConfig.color} text-xs`}>
              {event.severity}
            </Badge>
            <span className="truncate flex-1">{event.title}</span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
