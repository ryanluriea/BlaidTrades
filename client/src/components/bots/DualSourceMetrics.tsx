/**
 * Dual-source metrics display - NEVER mixes backtest and paper stats silently
 * Shows clear "Backtest" vs "Paper" labels when displaying metrics
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DualSourceMetricsProps {
  // Backtest stats
  backtestTrades: number | null;
  backtestWinRate: number | null;
  backtestPF: number | null;
  backtestSharpe: number | null;
  backtestMaxDD: number | null;
  
  // Paper/Live stats
  paperTrades: number;
  paperWinRate: number | null;
  paperPnl: number;
  paperSharpe: number | null;
  paperMaxDD: number | null;
  paperPF: number | null;
  
  // Display settings
  stage: string;
  compact?: boolean;
  
  // Timeframe provenance (industry standard: show which timeframe metrics come from)
  backtestTimeframe?: string | null;
  backtestHorizon?: string | null;
}

export function DualSourceMetrics({
  backtestTrades,
  backtestWinRate,
  backtestPF,
  backtestSharpe,
  backtestMaxDD,
  paperTrades,
  paperWinRate,
  paperPnl,
  paperSharpe,
  paperMaxDD,
  paperPF,
  stage,
  compact = false,
  backtestTimeframe,
  backtestHorizon,
}: DualSourceMetricsProps) {
  const isLab = stage === 'TRIALS';
  
  // Build source label with timeframe if available (industry standard: metrics must match displayed timeframe)
  const sourceLabel = backtestTimeframe 
    ? `${backtestTimeframe}${backtestHorizon ? `/${backtestHorizon}` : ''}`
    : 'BT';

  // For TRIALS bots: always show backtest stats (that's their purpose)
  // For non-TRIALS bots (PAPER/SHADOW/LIVE): ALWAYS show paper stats only - no backtest fallback
  if (isLab) {
    return (
      <div className="flex items-baseline gap-3 text-center">
        <MetricCell 
          label={`${sourceLabel} Trades`} 
          value={backtestTrades ?? 0} 
          source="BACKTEST"
          compact={compact}
        />
        <MetricCell 
          label="Win%" 
          value={backtestWinRate} 
          format="percent"
          source="BACKTEST"
          compact={compact}
        />
        <MetricCell 
          label="PF" 
          value={backtestPF} 
          format="decimal"
          source="BACKTEST"
          compact={compact}
        />
        <MetricCell 
          label="Sharpe" 
          value={backtestSharpe} 
          format="decimal"
          source="BACKTEST"
          compact={compact}
        />
      </div>
    );
  }

  // Non-TRIALS (PAPER/SHADOW/LIVE): Always show paper stats - no backtest fallback
  return (
    <div className="flex items-baseline gap-3 text-center">
      <MetricCell 
        label="Trades" 
        value={paperTrades} 
        source="PAPER"
        compact={compact}
      />
      <MetricCell 
        label="Win%" 
        value={paperWinRate} 
        format="percent"
        source="PAPER"
        compact={compact}
      />
      <MetricCell 
        label="P&L" 
        value={paperPnl} 
        format="pnl"
        source="PAPER"
        compact={compact}
      />
      <MetricCell 
        label="PF" 
        value={paperPF} 
        format="decimal"
        source="PAPER"
        compact={compact}
      />
    </div>
  );

  // No data at all
  return (
    <div className="flex items-baseline gap-3 text-center">
      <MetricCell label="Trades" value={0} source="NONE" compact={compact} />
      <MetricCell label="Win%" value={null} format="percent" source="NONE" compact={compact} />
      <MetricCell label="P&L" value={0} format="pnl" source="NONE" compact={compact} />
      <MetricCell label="Sharpe" value={null} format="decimal" source="NONE" compact={compact} />
    </div>
  );
}

interface MetricCellProps {
  label: string;
  value: number | null;
  format?: 'number' | 'percent' | 'decimal' | 'pnl';
  source: 'BACKTEST' | 'PAPER' | 'NONE';
  showSourceBadge?: boolean;
  compact?: boolean;
}

function MetricCell({ label, value, format = 'number', source, showSourceBadge, compact }: MetricCellProps) {
  const formatValue = () => {
    if (value === null || value === undefined) return '—';
    switch (format) {
      case 'percent':
        return `${value.toFixed(1)}%`;
      case 'decimal':
        return value.toFixed(2);
      case 'pnl':
        return value >= 0 ? `$${value.toFixed(0)}` : `-$${Math.abs(value).toFixed(0)}`;
      default:
        return value.toString();
    }
  };

  const valueColor = format === 'pnl' 
    ? value !== null && value >= 0 ? 'text-emerald-500' : 'text-red-500'
    : 'text-foreground';

  return (
    <div className={cn("min-w-[40px]", compact ? "w-12" : "w-14")}>
      <p className="text-[9px] uppercase text-muted-foreground leading-none mb-0.5">{label}</p>
      <p className={cn(
        "text-sm font-medium",
        value === null ? "text-muted-foreground" : valueColor
      )}>
        {formatValue()}
      </p>
    </div>
  );
}
