import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  ChevronRight,
  Clock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import {
  ActivityEvent,
  severityConfig,
  eventTypeIcons,
  getOutcomeAccent,
  PnLDisplay,
  EventDetailDrawer,
} from "@/components/activity/shared";

interface BotMiniTimelineProps {
  botId: string;
  limit?: number;
}

function CompactEventCard({ event, onClick }: { event: ActivityEvent; onClick: () => void }) {
  const sevConfig = severityConfig[event.severity] || severityConfig.INFO;
  const EventIcon = eventTypeIcons[event.event_type] || Activity;
  const outcomeAccent = getOutcomeAccent(event);
  const pnl = event.metadata?.realized_pnl as number | undefined;

  return (
    <div
      className={`flex items-center gap-2 p-2 hover-elevate cursor-pointer ${outcomeAccent}`}
      onClick={onClick}
      data-testid={`mini-timeline-event-${event.id}`}
    >
      <div className={`p-1.5 rounded ${sevConfig.color}`}>
        <EventIcon className="h-3 w-3" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{event.title}</span>
          {pnl !== undefined && <PnLDisplay pnl={pnl} />}
        </div>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
        </span>
      </div>
      <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
    </div>
  );
}

export function BotMiniTimeline({ botId, limit = 15 }: BotMiniTimelineProps) {
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<{
    success: boolean;
    data: { items: ActivityEvent[] };
  }>({
    queryKey: ["/api/activity", { bot_id: botId, limit }],
  });

  const events = data?.data?.items || [];

  const handleEventClick = (event: ActivityEvent) => {
    setSelectedEvent(event);
    setDrawerOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-2 p-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            Unable to load activity
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Recent Activity
          </CardTitle>
          <Link to="/fleet?tab=feed" className="text-xs text-primary hover:underline">
            View All
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No recent activity
            </p>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="divide-y divide-border/50">
                {events.map((event) => (
                  <CompactEventCard
                    key={event.id}
                    event={event}
                    onClick={() => handleEventClick(event)}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <EventDetailDrawer
        event={selectedEvent}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
