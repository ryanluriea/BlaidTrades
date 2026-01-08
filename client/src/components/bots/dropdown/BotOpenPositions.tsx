import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { useBotOpenPositions } from "@/hooks/useBotDetails";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import { Crosshair } from "lucide-react";

interface BotOpenPositionsProps {
  botId: string;
}

export function BotOpenPositions({ botId }: BotOpenPositionsProps) {
  const { data: result, isLoading } = useBotOpenPositions(botId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!result || result.degraded || !result.data) {
    return (
      <Card data-testid="card-positions-degraded">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Crosshair className="w-3.5 h-3.5" />
            Open Positions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner
            message={result?.message || "Position data unavailable"}
            error_code={result?.error_code}
            trace_id={result?.trace_id}
          />
        </CardContent>
      </Card>
    );
  }

  const positions = result.data;
  const hasPositions = positions && positions.length > 0;

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Crosshair className="w-3.5 h-3.5" />
          Open Positions
          {hasPositions && (
            <span className="ml-1 bg-primary/20 text-primary text-[10px] px-1.5 rounded">
              {positions.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {hasPositions ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 px-1 font-medium text-muted-foreground">Symbol</th>
                  <th className="text-left py-1 px-1 font-medium text-muted-foreground">Side</th>
                  <th className="text-right py-1 px-1 font-medium text-muted-foreground">Size</th>
                  <th className="text-right py-1 px-1 font-medium text-muted-foreground">Entry</th>
                  <th className="text-right py-1 px-1 font-medium text-muted-foreground">Unreal. P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.id} className="border-b border-border/50">
                    <td className="py-1.5 px-1 font-mono">{pos.instrument}</td>
                    <td className="py-1.5 px-1">
                      <span className={pos.side === "BUY" ? "text-green-500" : "text-red-500"}>
                        {pos.side}
                      </span>
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono">{pos.quantity}</td>
                    <td className="py-1.5 px-1 text-right font-mono">
                      ${Number(pos.entry_price).toFixed(2)}
                    </td>
                    <td className="py-1.5 px-1 text-right">
                      <PnlDisplay value={pos.pnl || 0} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-3 text-xs text-muted-foreground">
            No open positions
          </div>
        )}
      </CardContent>
    </Card>
  );
}
