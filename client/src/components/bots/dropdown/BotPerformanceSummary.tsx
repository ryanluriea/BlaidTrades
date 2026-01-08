import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { ConfidenceBadge, getConfidenceFromSamples } from "@/components/ui/confidence-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBotPerformance } from "@/hooks/useBotDetails";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import { BarChart3, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BotPerformanceSummaryProps {
  botId: string;
  options?: {
    mode?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
  };
}

export function BotPerformanceSummary({ botId, options }: BotPerformanceSummaryProps) {
  const { data: result, isLoading } = useBotPerformance(botId, options);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="p-3 pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!result || result.degraded || !result.data) {
    return (
      <Card data-testid="card-performance-degraded">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            Performance Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          <DegradedBanner
            message={result?.message || "Performance data unavailable"}
            error_code={result?.error_code}
            trace_id={result?.trace_id}
          />
        </CardContent>
      </Card>
    );
  }

  const perf = result.data;

  // Calculate confidence from sample size
  const confidence = getConfidenceFromSamples(perf.totalTrades);
  const isLowConfidence = confidence === 'LOW' || confidence === 'INSUFFICIENT';

  // Calculate simple sharpe approximation from trade data
  const avgReturn = perf.totalTrades > 0 ? perf.totalPnl / perf.totalTrades : 0;
  const sharpeApprox = perf.expectancy !== null && perf.avgLoss > 0 
    ? perf.expectancy / perf.avgLoss 
    : null;

  const stats = [
    { 
      label: "Total P&L", 
      value: <PnlDisplay value={perf.totalPnl} size="sm" className="justify-center" />,
      raw: perf.totalPnl
    },
    { 
      label: "Today P&L", 
      value: <PnlDisplay value={perf.todayPnl} size="sm" className="justify-center" />,
      raw: perf.todayPnl
    },
    { 
      label: "Win Rate", 
      value: perf.winRate !== null ? `${perf.winRate.toFixed(1)}%` : "—",
      colorClass: perf.winRate && perf.winRate >= 45 ? 'text-emerald-500' : perf.winRate && perf.winRate < 40 ? 'text-amber-500' : undefined,
      raw: perf.winRate
    },
    { 
      label: "Trades", 
      value: perf.totalTrades.toString(),
      showConfidence: true,
      raw: perf.totalTrades
    },
    { 
      label: "Avg Win", 
      value: perf.avgWin > 0 ? `$${perf.avgWin.toFixed(0)}` : "—",
      colorClass: perf.avgWin > 0 ? 'text-emerald-500' : undefined,
      raw: perf.avgWin
    },
    { 
      label: "Avg Loss", 
      value: perf.avgLoss > 0 ? `$${perf.avgLoss.toFixed(0)}` : "—",
      colorClass: perf.avgLoss > 0 ? 'text-loss' : undefined,
      raw: perf.avgLoss
    },
    { 
      label: "Max DD", 
      value: perf.maxDrawdown > 0 ? `$${perf.maxDrawdown.toFixed(0)}` : "—",
      icon: TrendingDown,
      colorClass: 'text-loss',
      description: "Maximum peak-to-trough decline based on running P&L",
      raw: perf.maxDrawdown
    },
    { 
      label: "Expect.", 
      value: perf.expectancy !== null ? `$${perf.expectancy.toFixed(0)}` : "—",
      colorClass: perf.expectancy && perf.expectancy > 0 ? 'text-emerald-500' : perf.expectancy && perf.expectancy < 0 ? 'text-loss' : undefined,
      description: "Expected $ per trade = (WR × Avg Win) - ((1-WR) × Avg Loss)",
      raw: perf.expectancy
    },
  ];

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" />
          Performance Summary
          {perf.totalTrades >= 10 && (
            <ConfidenceBadge confidence={confidence} size="sm" />
          )}
          {isLowConfidence && perf.totalTrades > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <AlertTriangle className="w-3 h-3 text-amber-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Limited data ({perf.totalTrades} trades). Metrics may not be statistically reliable.</p>
              </TooltipContent>
            </Tooltip>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="grid grid-cols-4 gap-2">
          {stats.map((stat, i) => (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div className="text-center bg-muted/30 rounded p-1.5 cursor-help">
                  <p className="text-[9px] uppercase text-muted-foreground truncate flex items-center justify-center gap-0.5">
                    {stat.icon && <stat.icon className="w-2.5 h-2.5" />}
                    {stat.label}
                    {stat.showConfidence && isLowConfidence && (
                      <AlertTriangle className="w-2 h-2 text-amber-500" />
                    )}
                  </p>
                  <div className={cn(
                    "font-mono text-xs font-semibold mt-0.5",
                    stat.colorClass
                  )}>
                    {typeof stat.value === "string" ? stat.value : stat.value}
                  </div>
                </div>
              </TooltipTrigger>
              {stat.description && (
                <TooltipContent side="top" className="max-w-[200px]">
                  <p className="text-xs">{stat.description}</p>
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
