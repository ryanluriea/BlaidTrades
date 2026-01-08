import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { useBotRecentTrades } from "@/hooks/useBotDetails";
import { TradeSetupDrawer } from "@/components/bots/TradeSetupDrawer";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import { History, ChevronRight } from "lucide-react";
import { format } from "date-fns";

interface BotRecentTradesProps {
  botId: string;
  options?: {
    mode?: string;
    accountId?: string;
    limit?: number;
  };
}

export function BotRecentTrades({ botId, options }: BotRecentTradesProps) {
  const { data: result, isLoading } = useBotRecentTrades(botId, options);
  const [selectedTrade, setSelectedTrade] = useState<any>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleTradeClick = (trade: any) => {
    setSelectedTrade(trade);
    setDrawerOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!result || result.degraded || !result.data) {
    return (
      <Card data-testid="card-trades-degraded">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Recent Trades
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner
            message={result?.message || "Trade data unavailable"}
            error_code={result?.error_code}
            trace_id={result?.trace_id}
          />
        </CardContent>
      </Card>
    );
  }

  const trades = result.data;
  const hasTrades = trades && trades.length > 0;

  return (
    <>
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            Recent Trades
            {hasTrades && (
              <span className="ml-1 text-muted-foreground">({trades.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {hasTrades ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">Time</th>
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">Setup</th>
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">TF</th>
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">Symbol</th>
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">Side</th>
                    <th className="text-right py-1 px-1 font-medium text-muted-foreground">Entry</th>
                    <th className="text-right py-1 px-1 font-medium text-muted-foreground">Exit</th>
                    <th className="text-right py-1 px-1 font-medium text-muted-foreground">P&L</th>
                    <th className="text-left py-1 px-1 font-medium text-muted-foreground">Scope</th>
                    <th className="py-1 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade: any) => (
                    <tr 
                      key={trade.id} 
                      className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => handleTradeClick(trade)}
                    >
                      <td className="py-1.5 px-1 text-muted-foreground">
                        {trade.exit_time 
                          ? format(new Date(trade.exit_time), "MM/dd HH:mm")
                          : "—"
                        }
                      </td>
                      <td className="py-1.5 px-1">
                        {trade.setup_label ? (
                          <span className="truncate max-w-[80px] block" title={trade.setup_label}>
                            {trade.setup_label}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-1">
                        {trade.timeframe ? (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono">
                            {trade.timeframe}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1.5 px-1 font-mono">{trade.instrument}</td>
                      <td className="py-1.5 px-1">
                        <span className={trade.side === "BUY" ? "text-green-500" : "text-red-500"}>
                          {trade.side}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-right font-mono">
                        ${Number(trade.entry_price).toFixed(2)}
                      </td>
                      <td className="py-1.5 px-1 text-right font-mono">
                        {trade.exit_price ? `$${Number(trade.exit_price).toFixed(2)}` : "—"}
                      </td>
                      <td className="py-1.5 px-1 text-right">
                        <PnlDisplay value={trade.pnl || 0} size="sm" />
                      </td>
                      <td className="py-1.5 px-1">
                        <Badge 
                          variant={
                            trade.source_type === 'LIVE' ? 'default' : 
                            trade.source_type === 'PAPER' ? 'secondary' : 
                            'outline'
                          }
                          className="text-[10px] px-1 py-0"
                        >
                          {trade.source_type || (trade as any).bot_instance?.mode || "BT"}
                        </Badge>
                        {trade.horizon && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
                            {trade.horizon}
                          </Badge>
                        )}
                      </td>
                      <td className="py-1.5 px-1">
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-muted-foreground">
              No trades found for the selected filters
            </div>
          )}
        </CardContent>
      </Card>

      <TradeSetupDrawer 
        trade={selectedTrade}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
