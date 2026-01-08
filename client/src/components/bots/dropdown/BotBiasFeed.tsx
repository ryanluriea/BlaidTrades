import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBotBiasFeed } from "@/hooks/useBotDetails";
import { Activity } from "lucide-react";
import { format } from "date-fns";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotBiasFeedProps {
  botId: string;
}

export function BotBiasFeed({ botId }: BotBiasFeedProps) {
  const { data: events, isLoading, isError } = useBotBiasFeed(botId);

  const isDegraded = isError || (!isLoading && events === undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            Bias Visualization Feed
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner message="Bias feed unavailable" variant="inline" />
        </CardContent>
      </Card>
    );
  }

  const hasEvents = events && events.length > 0;

  const getBiasTypeStyle = (type: string) => {
    switch (type) {
      case "bullish":
        return { color: "text-green-500", bg: "bg-green-500/10", icon: "▲" };
      case "bearish":
        return { color: "text-red-500", bg: "bg-red-500/10", icon: "▼" };
      case "neutral":
        return { color: "text-yellow-500", bg: "bg-yellow-500/10", icon: "◆" };
      case "mixed":
        return { color: "text-purple-500", bg: "bg-purple-500/10", icon: "◇" };
      default:
        return { color: "text-muted-foreground", bg: "bg-muted", icon: "○" };
    }
  };

  const getConfidenceWidth = (confidence: number | null) => {
    if (confidence === null) return 0;
    return Math.min(Math.max(confidence, 0), 100);
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          Bias Visualization Feed
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {hasEvents ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {events.map((event) => {
              const style = getBiasTypeStyle(event.bias_type);
              return (
                <div
                  key={event.id}
                  className={`rounded p-2 text-xs ${style.bg} border-l-2`}
                  style={{ borderLeftColor: `hsl(var(--${event.bias_type === "bullish" ? "green" : event.bias_type === "bearish" ? "red" : "yellow"}-500))` }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${style.color}`}>{style.icon}</span>
                      <span className={`font-medium ${style.color} uppercase text-[10px]`}>
                        {event.bias_type}
                      </span>
                      {event.timeframe && (
                        <span className="text-muted-foreground text-[10px]">
                          ({event.timeframe})
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-[10px]">
                      {format(new Date(event.created_at), "MM/dd HH:mm")}
                    </span>
                  </div>

                  {event.confidence !== null && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                        <span>Confidence</span>
                        <span>{Number(event.confidence).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-background/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${style.bg.replace("/10", "")}`}
                          style={{ width: `${getConfidenceWidth(Number(event.confidence))}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {event.reasoning && (
                    <p className="text-muted-foreground mt-1.5 text-[10px] leading-relaxed">
                      {event.reasoning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No bias events recorded yet. Events will appear as the bot analyzes market conditions.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
