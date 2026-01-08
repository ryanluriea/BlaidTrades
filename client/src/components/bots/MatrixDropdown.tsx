import { cn } from "@/lib/utils";
import { authenticatedFetch } from "@/lib/fetch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Grid3X3, CheckCircle2, Clock, XCircle, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { normalizeTimeframe } from "@shared/timeframeUtils";

interface MatrixRun {
  id: string;
  status: string;
  timeframes: string[];
  horizons: string[];
  completedCells: number;
  totalCells: number;
  medianProfitFactor: number | null;
  worstProfitFactor: number | null;
  bestProfitFactor: number | null;
  worstMaxDrawdownPct: number | null;
  tradeCountTotal: number | null;
  consistencyScore: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface MatrixAggregate {
  median_pf?: number;
  worst_pf?: number;
  best_pf?: number;
  worst_max_dd_pct?: number;
  trade_count_total?: number;
  consistency_score?: number;
  cells_with_data?: number;
  total_cells?: number;
}

interface MatrixDropdownProps {
  botId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  progress?: number;
  timeframes?: string[];
  aggregate?: MatrixAggregate | null;
  /** Bot's configured timeframe to display next to Matrix icon */
  botTimeframe?: string;
  /** Number of cells completed in current run */
  completedCells?: number;
  /** Total cells in current run */
  totalCells?: number;
  /** Current timeframe being tested */
  currentTimeframe?: string | null;
  className?: string;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'RUNNING':
      return <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />;
    case 'QUEUED':
      return <Clock className="w-3.5 h-3.5 text-amber-400" />;
    case 'FAILED':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function getMatrixColor(status: string | null) {
  switch (status) {
    case 'COMPLETED':
      return "text-emerald-400 bg-emerald-500/20 border-emerald-500/30";
    case 'RUNNING':
      return "text-blue-400 bg-blue-500/20 border-blue-500/30";
    case 'QUEUED':
      return "text-amber-400 bg-amber-500/20 border-amber-500/30";
    case 'FAILED':
      return "text-red-400 bg-red-500/20 border-red-500/30";
    default:
      return "opacity-20 text-muted-foreground border-muted-foreground/30";
  }
}

function formatTimeframes(timeframes: string[] | undefined): string {
  if (!timeframes || timeframes.length === 0) return '';
  return timeframes.slice(0, 3).join(', ');
}

export function MatrixDropdown({
  botId,
  status,
  progress = 0,
  timeframes,
  aggregate,
  botTimeframe,
  completedCells = 0,
  totalCells = 0,
  currentTimeframe,
  className,
}: MatrixDropdownProps) {
  const hasActivity = status === 'QUEUED' || status === 'RUNNING' || status === 'COMPLETED' || status === 'FAILED';
  const isRunning = status === 'RUNNING';
  const isQueued = status === 'QUEUED';
  
  const { data: runHistory, isLoading } = useQuery<MatrixRun[]>({
    queryKey: ['/api/matrix-runs', botId],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/matrix-runs?botId=${botId}`);
      if (!res.ok) throw new Error('Failed to fetch matrix runs');
      return res.json();
    },
    enabled: hasActivity,
    staleTime: 30000,
  });

  const latestRun = runHistory?.[0];
  const displayTimeframes = timeframes || latestRun?.timeframes;
  const normalizedTimeframe = normalizeTimeframe(botTimeframe);
  const normalizedCurrentTimeframe = normalizeTimeframe(currentTimeframe ?? undefined);

  // Build trigger button content
  const triggerButton = (
    <button
      className={cn(
        "w-[64px] h-6 flex items-center justify-center gap-1 rounded-sm border transition-all cursor-pointer px-1",
        hasActivity 
          ? cn(getMatrixColor(status), "border-current/30")
          : "opacity-20 text-muted-foreground border-muted-foreground/30"
      )}
      data-testid="button-matrix-dropdown"
    >
      {isRunning ? (
        <>
          <div className="relative w-5 h-5 flex-shrink-0">
            <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.2"
              />
              <circle
                cx="10"
                cy="10"
                r="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={`${(Math.min(100, Math.max(0, progress)) / 100) * 50.265} 50.265`}
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          </div>
          {/* INSTITUTIONAL: Always show generation timeframe (source of truth), not matrix current timeframe */}
          <span className="text-[11px] font-mono leading-none font-semibold truncate">
            {normalizedTimeframe || "..."}
          </span>
        </>
      ) : isQueued ? (
        <>
          <Clock className="w-4 h-4 flex-shrink-0" />
          {/* Show generation timeframe even when queued, not just "Queued" */}
          <span className="text-[11px] font-mono leading-none">
            {normalizedTimeframe || "Q"}
          </span>
        </>
      ) : (
        <>
          <Grid3X3 className="w-4 h-4 flex-shrink-0" />
          {normalizedTimeframe && (
            <span className="text-[11px] font-mono leading-none">
              {normalizedTimeframe}
            </span>
          )}
        </>
      )}
    </button>
  );

  // Wrap running/queued state in tooltip for full context
  const triggerContent = (isRunning || isQueued) ? (
    <Tooltip>
      <TooltipTrigger asChild>
        {triggerButton}
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs">
        <div className="space-y-1">
          <div className="font-medium flex items-center gap-1.5">
            {isRunning ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Matrix Run In Progress
              </>
            ) : (
              <>
                <Clock className="w-3 h-3" />
                Matrix Run Queued
              </>
            )}
          </div>
          {isRunning && (
            <>
              <div className="text-muted-foreground">
                {normalizedCurrentTimeframe 
                  ? `Currently testing: ${normalizedCurrentTimeframe} timeframe`
                  : 'Initializing matrix cells...'}
              </div>
              {totalCells > 0 && (
                <div className="text-muted-foreground">
                  Cells: {completedCells}/{totalCells} ({progress}% complete)
                </div>
              )}
              {displayTimeframes && displayTimeframes.length > 0 && (
                <div className="text-muted-foreground">
                  Timeframes: {displayTimeframes.join(', ')}
                </div>
              )}
            </>
          )}
          {isQueued && (
            <div className="text-muted-foreground">
              Waiting to start matrix evaluation...
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  ) : triggerButton;

  if (!hasActivity) {
    if (normalizedTimeframe) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {triggerContent}
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="font-medium">Generation Timeframe</div>
            <div className="text-muted-foreground">{normalizedTimeframe} (locked for this generation)</div>
          </TooltipContent>
        </Tooltip>
      );
    }
    return triggerContent;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent 
        side="bottom" 
        align="start" 
        className="w-80 p-0"
        data-testid="popover-matrix-history"
      >
        <div className="p-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Grid3X3 className="w-4 h-4" />
              <span className="font-medium text-sm">Matrix Run History</span>
            </div>
            {normalizedTimeframe && (
              <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                {normalizedTimeframe}
              </span>
            )}
          </div>
        </div>

        {aggregate && (
          <div className="p-3 border-b bg-muted/30">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Latest Aggregate</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-muted-foreground text-xs">Cells</div>
                <div className="font-mono">{aggregate.cells_with_data ?? 0}/{aggregate.total_cells ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Median PF</div>
                <div className="font-mono">{aggregate.median_pf?.toFixed(2) ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Trades</div>
                <div className="font-mono">{aggregate.trade_count_total?.toLocaleString() ?? '-'}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Worst PF</div>
                <div className={cn("font-mono", (aggregate.worst_pf ?? 0) < 1 ? "text-red-400" : "text-emerald-400")}>
                  {aggregate.worst_pf?.toFixed(2) ?? '-'}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Consistency</div>
                <div className="font-mono">{aggregate.consistency_score?.toFixed(0) ?? '-'}%</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Worst DD</div>
                <div className={cn("font-mono", (aggregate.worst_max_dd_pct ?? 0) > 25 ? "text-red-400" : "text-amber-400")}>
                  {aggregate.worst_max_dd_pct?.toFixed(1) ?? '-'}%
                </div>
              </div>
            </div>

            {latestRun && (
              <div className="mt-3 flex items-center gap-2 text-xs">
                <TrendingUp className="w-3 h-3 text-emerald-400" />
                <span className="text-muted-foreground">Best:</span>
                <span className="font-mono text-emerald-400">
                  {displayTimeframes?.[0] ?? '1m'}/{latestRun.horizons?.[1] ?? '90d'}
                </span>
                <span className="text-muted-foreground">PF</span>
                <span className="font-mono">{aggregate.best_pf?.toFixed(2) ?? '-'}</span>
                
                <TrendingDown className="w-3 h-3 text-red-400 ml-2" />
                <span className="text-muted-foreground">Worst:</span>
                <span className="font-mono text-red-400">
                  {displayTimeframes?.[0] ?? '1m'}/{latestRun.horizons?.[0] ?? '30d'}
                </span>
              </div>
            )}

            {latestRun?.completedAt && (
              <div className="mt-2 text-xs text-muted-foreground">
                Completed {formatDistanceToNow(new Date(latestRun.completedAt), { addSuffix: true })}
              </div>
            )}
          </div>
        )}

        <div className="p-3">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Run History</div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : runHistory && runHistory.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {runHistory.slice(0, 5).map((run) => (
                <div 
                  key={run.id} 
                  className="flex items-center gap-2 text-sm"
                  data-testid={`matrix-run-${run.id}`}
                >
                  <StatusIcon status={run.status} />
                  <span className="font-mono text-xs">
                    {run.timeframes?.join(', ') ?? '-'}
                  </span>
                  <span className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full font-mono",
                    run.status === 'COMPLETED' ? "bg-emerald-500/20 text-emerald-400" :
                    run.status === 'RUNNING' ? "bg-blue-500/20 text-blue-400" :
                    "bg-muted text-muted-foreground"
                  )}>
                    {run.completedCells}/{run.totalCells}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: false })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No matrix runs yet
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
