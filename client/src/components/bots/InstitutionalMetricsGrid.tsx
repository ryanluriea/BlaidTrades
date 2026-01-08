import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { ConfidenceBadge, StatisticalWarning, parseConfidence, type ConfidenceLevel } from "@/components/ui/confidence-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity, BarChart3, AlertTriangle } from "lucide-react";

interface InstitutionalMetricsGridProps {
  // Core metrics
  totalPnl?: number | null;
  winRate?: number | null;
  totalTrades?: number | null;
  profitFactor?: number | null;
  
  // Risk-adjusted metrics
  sharpe?: number | null;
  sortino?: number | null;
  calmar?: number | null;
  maxDrawdownPct?: number | null;
  maxDrawdownDollars?: number | null;
  
  // Advanced metrics
  ulcerIndex?: number | null;
  expectancyR?: number | null;
  maxWinStreak?: number | null;
  maxLossStreak?: number | null;
  
  // Statistical info
  sharpeConfidence?: string | null;
  statisticallySignificant?: boolean;
  tradingDays?: number;
  
  // Display options
  showAllMetrics?: boolean;
  className?: string;
}

function MetricCard({ 
  label, 
  value, 
  format,
  icon: Icon,
  colorClass,
  description,
  confidence,
  showConfidence = false
}: {
  label: string;
  value: number | null | undefined;
  format?: (v: number) => string;
  icon?: typeof TrendingUp;
  colorClass?: string;
  description?: string;
  confidence?: ConfidenceLevel;
  showConfidence?: boolean;
}) {
  const hasValue = value !== null && value !== undefined && !isNaN(value);
  const formattedValue = hasValue && format ? format(value) : (hasValue ? value.toFixed(2) : '—');
  
  return (
    <div className="text-center bg-muted/30 rounded-lg p-3">
      <div className="flex items-center justify-center gap-1 mb-1">
        {Icon && <Icon className="w-3 h-3 text-muted-foreground" />}
        <p className="text-[10px] uppercase text-muted-foreground font-medium">{label}</p>
        {showConfidence && confidence && (
          <ConfidenceBadge confidence={confidence} size="sm" />
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <p className={cn(
            "font-mono text-lg font-semibold cursor-help",
            colorClass || 'text-foreground'
          )}>
            {formattedValue}
          </p>
        </TooltipTrigger>
        {description && (
          <TooltipContent side="top" className="max-w-[200px]">
            <p className="text-xs">{description}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}

export function InstitutionalMetricsGrid({
  totalPnl,
  winRate,
  totalTrades,
  profitFactor,
  sharpe,
  sortino,
  calmar,
  maxDrawdownPct,
  maxDrawdownDollars,
  ulcerIndex,
  expectancyR,
  maxWinStreak,
  maxLossStreak,
  sharpeConfidence,
  statisticallySignificant,
  tradingDays,
  showAllMetrics = true,
  className
}: InstitutionalMetricsGridProps) {
  const confidence = parseConfidence(sharpeConfidence);
  const isReliable = statisticallySignificant !== false;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Statistical Warning Banner */}
      <StatisticalWarning 
        isSignificant={isReliable} 
        sampleSize={tradingDays || totalTrades || undefined}
        minRequired={20}
      />

      {/* Row 1: Core Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Core Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center bg-muted/30 rounded-lg p-3">
              <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1">Total P&L</p>
              <PnlDisplay value={totalPnl || 0} size="lg" className="justify-center" />
            </div>
            <MetricCard
              label="Win Rate"
              value={winRate}
              format={(v) => `${v.toFixed(1)}%`}
              colorClass={winRate && winRate >= 45 ? 'text-emerald-500' : winRate ? 'text-amber-500' : undefined}
              description="Percentage of winning trades"
            />
            <MetricCard
              label="Total Trades"
              value={totalTrades}
              format={(v) => v.toFixed(0)}
              description="Total number of closed trades"
            />
            <MetricCard
              label="Profit Factor"
              value={profitFactor}
              format={(v) => v.toFixed(2)}
              colorClass={profitFactor && profitFactor >= 1.5 ? 'text-emerald-500' : profitFactor && profitFactor >= 1.0 ? 'text-amber-500' : 'text-loss'}
              description="Gross profit / gross loss. Above 1.5 is strong."
            />
          </div>
        </CardContent>
      </Card>

      {/* Row 2: Risk-Adjusted Returns */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Risk-Adjusted Returns
            {confidence !== 'INSUFFICIENT' && (
              <ConfidenceBadge confidence={confidence} showLabel size="sm" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Sharpe"
              value={sharpe}
              format={(v) => v.toFixed(2)}
              colorClass={sharpe && sharpe >= 1.0 ? 'text-emerald-500' : sharpe && sharpe >= 0.5 ? 'text-amber-500' : undefined}
              description="Risk-adjusted return (annualized). ≥1.0 is good, ≥2.0 is excellent."
              confidence={confidence}
              showConfidence
            />
            <MetricCard
              label="Sortino"
              value={sortino}
              format={(v) => v.toFixed(2)}
              colorClass={sortino && sortino >= 1.5 ? 'text-emerald-500' : sortino && sortino >= 1.0 ? 'text-amber-500' : undefined}
              description="Like Sharpe but only penalizes downside volatility. Better for asymmetric returns."
            />
            <MetricCard
              label="Calmar"
              value={calmar}
              format={(v) => v.toFixed(2)}
              colorClass={calmar && calmar >= 1.0 ? 'text-emerald-500' : calmar && calmar >= 0.5 ? 'text-amber-500' : undefined}
              description="Annual return / max drawdown. Higher = better recovery potential."
            />
            <MetricCard
              label="Max DD"
              value={maxDrawdownPct}
              format={(v) => `-${v.toFixed(1)}%`}
              icon={TrendingDown}
              colorClass="text-loss"
              description={maxDrawdownDollars ? `Maximum peak-to-trough decline ($${maxDrawdownDollars.toLocaleString()})` : 'Maximum peak-to-trough decline'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Row 3: Advanced Metrics (optional) */}
      {showAllMetrics && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Advanced Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label="Ulcer Index"
                value={ulcerIndex}
                format={(v) => v.toFixed(1)}
                colorClass={ulcerIndex && ulcerIndex <= 5 ? 'text-emerald-500' : ulcerIndex && ulcerIndex <= 10 ? 'text-amber-500' : 'text-loss'}
                description="Measures drawdown depth & duration. Lower is better. >15 = significant pain."
              />
              <MetricCard
                label="Expectancy (R)"
                value={expectancyR}
                format={(v) => `${v.toFixed(2)}R`}
                colorClass={expectancyR && expectancyR >= 0.3 ? 'text-emerald-500' : expectancyR && expectancyR > 0 ? 'text-amber-500' : 'text-loss'}
                description="Expected R-multiple per trade. ≥0.3R indicates strong edge."
              />
              <MetricCard
                label="Max Win Streak"
                value={maxWinStreak}
                format={(v) => v.toFixed(0)}
                icon={TrendingUp}
                colorClass="text-emerald-500"
                description="Maximum consecutive winning trades"
              />
              <MetricCard
                label="Max Loss Streak"
                value={maxLossStreak}
                format={(v) => v.toFixed(0)}
                icon={TrendingDown}
                colorClass="text-loss"
                description="Maximum consecutive losing trades. Important for position sizing."
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
