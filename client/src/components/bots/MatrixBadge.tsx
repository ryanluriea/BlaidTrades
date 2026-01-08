import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Grid3X3, TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock, Loader2, ChevronDown } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";

interface MatrixAggregate {
  median_pf: number | null;
  worst_pf: number | null;
  median_max_dd_pct: number | null;
  worst_max_dd_pct: number | null;
  trade_count_total: number;
  consistency_score: number;
  stability_score: number;
  cells_with_data: number;
  total_cells: number;
}

interface MatrixRun {
  id: string;
  status: string;
  totalCells: number;
  completedCells: number;
  createdAt: string | null;
  completedAt: string | null;
  timeframes: string[] | null;
  horizons: string[] | null;
}

interface MatrixBadgeProps {
  botId: string;
  aggregate: MatrixAggregate | null;
  bestCell?: any;
  worstCell?: any;
  completedAt?: string | null;
  showDetails?: boolean;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case "FAILED":
    case "CANCELLED":
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case "RUNNING":
      return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "COMPLETED":
      return "bg-green-500/10 text-green-400 border-green-500/20";
    case "FAILED":
    case "CANCELLED":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "RUNNING":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function MatrixRunRow({ run }: { run: MatrixRun }) {
  const date = run.completedAt || run.createdAt;
  
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
      {getStatusIcon(run.status)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {run.timeframes?.join(", ") || "Matrix Run"}
          </span>
          <Badge variant="outline" className={cn("text-[10px] h-4", getStatusColor(run.status))}>
            {run.completedCells}/{run.totalCells}
          </Badge>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {date ? format(new Date(date), "MMM d, h:mm a") : "Pending"}
        </div>
      </div>
    </div>
  );
}

export function MatrixBadge({ botId, aggregate, bestCell, worstCell, completedAt, showDetails = false }: MatrixBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const { data: runsData, isLoading: runsLoading } = useQuery<{ success: boolean; data: MatrixRun[] }>({
    queryKey: ["/api/bots", botId, "matrix-runs"],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/matrix-runs?limit=10`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch matrix runs");
      return response.json();
    },
    enabled: isOpen && !!botId,
    staleTime: 30000,
  });
  
  const runs = runsData?.data || [];
  
  const isHealthy = aggregate && aggregate.consistency_score >= 55 && (aggregate.median_pf || 0) >= 1.02;
  const isWarning = aggregate && aggregate.consistency_score >= 40 && (aggregate.worst_pf || 0) < 0.98;
  const hasData = aggregate && aggregate.cells_with_data > 0;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 min-w-[60px] w-[60px] px-1.5 gap-1 justify-center",
            hasData && isHealthy && "bg-green-500/20 hover:bg-green-500/30",
            hasData && isWarning && !isHealthy && "bg-amber-500/20 hover:bg-amber-500/30",
            hasData && !isHealthy && !isWarning && "bg-muted/30 hover:bg-muted/50",
            !hasData && "bg-muted/20 hover:bg-muted/30"
          )}
          data-testid={`button-matrix-badge-${botId}`}
        >
          <Grid3X3 className={cn(
            "h-3.5 w-3.5",
            hasData && isHealthy && "text-green-400",
            hasData && isWarning && !isHealthy && "text-amber-400",
            (hasData && !isHealthy && !isWarning) && "text-muted-foreground",
            !hasData && "text-muted-foreground/50"
          )} />
          {bestCell?.timeframe && (
            <span className={cn(
              "text-[10px] font-mono font-medium",
              hasData && isHealthy && "text-green-400",
              hasData && isWarning && !isHealthy && "text-amber-400",
              (hasData && !isHealthy && !isWarning) && "text-muted-foreground",
              !hasData && "text-muted-foreground/50"
            )}>
              {bestCell.timeframe}
            </span>
          )}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Card className="border-0 shadow-none">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Grid3X3 className="h-4 w-4" />
              Matrix Run History
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {hasData && aggregate && (
              <div className="mb-3 p-2 rounded bg-muted/30 border border-border/50">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Latest Aggregate</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Cells</div>
                    <div className="font-mono font-medium">{aggregate.cells_with_data}/{aggregate.total_cells}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Median PF</div>
                    <div className={cn("font-mono font-medium", (aggregate.median_pf || 0) >= 1.05 && "text-green-400")}>
                      {aggregate.median_pf?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Trades</div>
                    <div className="font-mono font-medium">{aggregate.trade_count_total.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Worst PF</div>
                    <div className={cn("font-mono font-medium", (aggregate.worst_pf || 0) < 1 && "text-amber-400")}>
                      {aggregate.worst_pf?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Consistency</div>
                    <div className={cn("font-mono font-medium", aggregate.consistency_score >= 55 && "text-green-400")}>
                      {aggregate.consistency_score.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Worst DD</div>
                    <div className={cn("font-mono font-medium", (aggregate.worst_max_dd_pct || 0) > 15 && "text-red-400")}>
                      {aggregate.worst_max_dd_pct?.toFixed(1)}%
                    </div>
                  </div>
                </div>
                
                {(bestCell || worstCell) && (
                  <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-2">
                    {bestCell && (
                      <div className="flex items-center gap-1 text-green-400 text-[10px]">
                        <TrendingUp className="h-3 w-3" />
                        <span>Best: {bestCell.timeframe}/{bestCell.horizon}</span>
                        <span className="text-muted-foreground">PF {bestCell.profit_factor?.toFixed(2)}</span>
                      </div>
                    )}
                    {worstCell && (
                      <div className="flex items-center gap-1 text-amber-400 text-[10px]">
                        <TrendingDown className="h-3 w-3" />
                        <span>Worst: {worstCell.timeframe}/{worstCell.horizon}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {completedAt && (
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Completed {formatDistanceToNow(new Date(completedAt), { addSuffix: true })}
                  </div>
                )}
              </div>
            )}
            
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Run History</div>
            <div className="max-h-48 overflow-y-auto">
              {runsLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : runs.length === 0 ? (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  No matrix runs yet
                </div>
              ) : (
                runs.map((run) => (
                  <MatrixRunRow key={run.id} run={run} />
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </PopoverContent>
    </Popover>
  );
}

interface MetricProvenanceProps {
  label: string;
  value: string | number;
  source: 'matrix_aggregate' | 'matrix_best' | 'matrix_worst' | 'single_backtest' | 'live_trades';
  unit?: string;
}

export function MetricProvenance({ label, value, source, unit = '' }: MetricProvenanceProps) {
  const sourceLabels: Record<string, { label: string; color: string }> = {
    matrix_aggregate: { label: 'Matrix (median)', color: 'text-blue-400' },
    matrix_best: { label: 'Matrix (best cell)', color: 'text-green-400' },
    matrix_worst: { label: 'Matrix (worst cell)', color: 'text-amber-400' },
    single_backtest: { label: 'Single backtest', color: 'text-muted-foreground' },
    live_trades: { label: 'Live trades', color: 'text-purple-400' },
  };

  const { label: sourceLabel, color } = sourceLabels[source] || { label: source, color: 'text-muted-foreground' };

  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono font-semibold">
        {typeof value === 'number' ? value.toFixed(2) : value}{unit}
      </span>
      <span className={`text-[10px] ${color}`}>{sourceLabel}</span>
    </div>
  );
}
