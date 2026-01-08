import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBotSignals } from "@/hooks/useBotDetails";
import { Brain } from "lucide-react";
import { format } from "date-fns";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotMindConsoleProps {
  botId: string;
}

export function BotMindConsole({ botId }: BotMindConsoleProps) {
  const { data: signals, isLoading, isError } = useBotSignals(botId);

  const isDegraded = isError || (!isLoading && signals === undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
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
            <Brain className="w-3.5 h-3.5" />
            Mind Console (Signals)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner message="Signal data unavailable" variant="inline" />
        </CardContent>
      </Card>
    );
  }

  const hasSignals = signals && signals.length > 0;

  const getSignalTypeColor = (type: string) => {
    switch (type) {
      case "entry":
        return "text-green-500 bg-green-500/10";
      case "exit":
        return "text-red-500 bg-red-500/10";
      case "scale_in":
        return "text-blue-500 bg-blue-500/10";
      case "scale_out":
        return "text-orange-500 bg-orange-500/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  const getBiasColor = (strength: number | null) => {
    if (strength === null) return "text-muted-foreground";
    if (strength > 50) return "text-green-500";
    if (strength < -50) return "text-red-500";
    return "text-yellow-500";
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5" />
          Mind Console (Signals)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {hasSignals ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {signals.map((signal) => (
              <div
                key={signal.id}
                className="bg-muted/30 rounded p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getSignalTypeColor(signal.signal_type)}`}>
                      {signal.signal_type.toUpperCase()}
                    </span>
                    {signal.direction && (
                      <span className={signal.direction === "BUY" ? "text-green-500" : "text-red-500"}>
                        {signal.direction}
                      </span>
                    )}
                    <span className="text-muted-foreground font-mono">
                      {signal.instrument}
                    </span>
                  </div>
                  <span className="text-muted-foreground text-[10px]">
                    {format(new Date(signal.created_at), "MM/dd HH:mm:ss")}
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  {signal.strength !== null && (
                    <span className={`font-mono text-[10px] ${getBiasColor(signal.strength)}`}>
                      Bias: {signal.strength > 0 ? "+" : ""}{signal.strength}
                    </span>
                  )}
                  {signal.price_at_signal && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      @ ${Number(signal.price_at_signal).toFixed(2)}
                    </span>
                  )}
                </div>

                {signal.reasoning && (
                  <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                    {signal.reasoning}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground">
            No signals recorded yet. Signals will appear here when the bot runs.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
