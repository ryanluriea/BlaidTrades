import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DEFAULT_GATE_THRESHOLDS } from "@/lib/graduationGates";
import { AlertTriangle } from "lucide-react";

type MetricType = 
  | 'pnl' 
  | 'maxDrawdown' 
  | 'sharpe' 
  | 'winRate' 
  | 'trades'
  // New institutional metrics
  | 'sortino'
  | 'calmar'
  | 'ulcerIndex'
  | 'expectancyR'
  | 'profitFactor'
  | 'maxWinStreak'
  | 'maxLossStreak';

interface MetricConfig {
  label: string;
  target?: number;
  direction: 'min' | 'max' | 'none'; // min = value >= target is good, max = value <= target is good
  unit: string;
  description: string;
  formatValue: (v: number) => string;
  formatTarget?: () => string;
}

// Safe number conversion helper
const toNum = (v: unknown): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const METRIC_CONFIGS: Record<Exclude<MetricType, 'pnl'>, MetricConfig> = {
  maxDrawdown: {
    label: 'MAX DD',
    target: DEFAULT_GATE_THRESHOLDS.maxDrawdownPct, // 20% max acceptable drawdown
    direction: 'max',
    unit: '%',
    description: 'Maximum peak-to-trough decline as percentage. Lower is safer.',
    formatValue: (v) => {
      // Display as percentage (value is already in percentage form, e.g., 29.5 = 29.5%)
      const pct = toNum(v);
      if (pct === 0 || !isFinite(pct)) return '—';
      return `-${pct.toFixed(0)}%`;
    },
    formatTarget: () => `≤${DEFAULT_GATE_THRESHOLDS.maxDrawdownPct}%`,
  },
  sharpe: {
    label: 'SHARPE',
    target: DEFAULT_GATE_THRESHOLDS.minSharpe,
    direction: 'min',
    unit: '',
    description: 'Risk-adjusted return ratio (annualized). Higher is better. Requires ≥20 trades and ≥20 trading days.',
    formatValue: (v) => {
      const num = toNum(v);
      // Invalid Sharpe: 0, non-finite, or extreme values outside realistic bounds
      if (num === 0 || !isFinite(num) || num < -5 || num > 5) return '—';
      return num.toFixed(2);
    },
    formatTarget: () => `≥${DEFAULT_GATE_THRESHOLDS.minSharpe}`,
  },
  sortino: {
    label: 'SORTINO',
    target: 1.0,
    direction: 'min',
    unit: '',
    description: 'Risk-adjusted return penalizing only downside volatility. Higher is better. Preferred over Sharpe for asymmetric returns.',
    formatValue: (v) => {
      const num = toNum(v);
      if (num === 0 || !isFinite(num)) return '—';
      return num.toFixed(2);
    },
    formatTarget: () => '≥1.0',
  },
  calmar: {
    label: 'CALMAR',
    target: 0.5,
    direction: 'min',
    unit: '',
    description: 'Annualized return divided by maximum drawdown. Higher indicates better recovery potential.',
    formatValue: (v) => {
      const num = toNum(v);
      if (num === 0 || !isFinite(num)) return '—';
      return num.toFixed(2);
    },
    formatTarget: () => '≥0.5',
  },
  ulcerIndex: {
    label: 'ULCER',
    target: 10,
    direction: 'max',
    unit: '',
    description: 'Measures depth and duration of drawdowns. Lower is better. Values >15 indicate significant pain.',
    formatValue: (v) => toNum(v).toFixed(1),
    formatTarget: () => '≤10',
  },
  winRate: {
    label: 'WIN%',
    target: DEFAULT_GATE_THRESHOLDS.minWinRate,
    direction: 'min',
    unit: '%',
    description: 'Percentage of winning trades. Higher is better.',
    formatValue: (v) => `${toNum(v).toFixed(0)}%`,
    formatTarget: () => `≥${DEFAULT_GATE_THRESHOLDS.minWinRate}%`,
  },
  trades: {
    label: 'TRADES',
    target: DEFAULT_GATE_THRESHOLDS.minTrades,
    direction: 'min',
    unit: '',
    description: 'Number of trades. Minimum 20 required for meaningful statistics.',
    formatValue: (v) => `${toNum(v)}`,
    formatTarget: () => `≥${DEFAULT_GATE_THRESHOLDS.minTrades}`,
  },
  expectancyR: {
    label: 'EXPECT-R',
    target: 0.3,
    direction: 'min',
    unit: 'R',
    description: 'Expected R-multiple per trade. Above 0.3R is considered good edge.',
    formatValue: (v) => {
      const num = toNum(v);
      if (num === 0 || !isFinite(num)) return '—';
      return `${num.toFixed(2)}R`;
    },
    formatTarget: () => '≥0.3R',
  },
  profitFactor: {
    label: 'PF',
    target: DEFAULT_GATE_THRESHOLDS.minProfitFactor,
    direction: 'min',
    unit: '',
    description: 'Gross profit divided by gross loss. Above 1.5 is strong.',
    formatValue: (v) => toNum(v).toFixed(2),
    formatTarget: () => `≥${DEFAULT_GATE_THRESHOLDS.minProfitFactor}`,
  },
  maxWinStreak: {
    label: 'WIN STREAK',
    direction: 'none',
    unit: '',
    description: 'Maximum consecutive winning trades.',
    formatValue: (v) => `${toNum(v)}`,
  },
  maxLossStreak: {
    label: 'LOSS STREAK',
    direction: 'none',
    unit: '',
    description: 'Maximum consecutive losing trades. Important for risk management.',
    formatValue: (v) => `${toNum(v)}`,
  },
};

interface MetricWithTargetProps {
  type: MetricType;
  value: number | null | undefined;
  stage: string;
  className?: string;
  width?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  showConfidence?: boolean;
  onClick?: () => void; // Click handler for the metric value (e.g., open trade decisions drawer)
}

export function MetricWithTarget({ 
  type, 
  value, 
  stage, 
  className, 
  width = 'w-16',
  confidence,
  showConfidence = false,
  onClick
}: MetricWithTargetProps) {
  // PnL doesn't have graduation targets - handled separately
  if (type === 'pnl') {
    return null;
  }

  const config = METRIC_CONFIGS[type];
  const isLabMode = stage === 'TRIALS';
  const hasValue = value !== null && value !== undefined;
  
  // Determine if value meets target (only for metrics with targets)
  const meetsTarget = hasValue && config.target !== undefined && (
    config.direction === 'min' 
      ? value >= config.target 
      : config.direction === 'max'
        ? value <= config.target
        : true // 'none' direction always passes
  );

  // Low confidence warning
  const isLowConfidence = confidence === 'LOW' || confidence === 'INSUFFICIENT';
  
  // Check if this metric type shows dash when zero/null (ratios that need min trades)
  const isDashWhenInvalid = ['sharpe', 'sortino', 'calmar', 'expectancyR'].includes(type);
  // Also check for extreme sharpe values outside -5 to +5
  const isExtremeValue = type === 'sharpe' && hasValue && (value! < -5 || value! > 5);
  const isInvalidValue = isDashWhenInvalid && (!hasValue || value === 0 || !isFinite(value as number) || isExtremeValue);
  
  // Determine the display value and styling
  let displayValue: string;
  let valueColorClass: string;

  if (isInvalidValue) {
    // Show dash for ratio metrics without sufficient data
    displayValue = '—';
    valueColorClass = 'text-muted-foreground/60';
  } else if (isLabMode) {
    // TRIALS mode: show just the value - color indicates pass/fail, tooltip has details
    const currentValue = hasValue ? value : 0;
    displayValue = config.formatValue(currentValue);
    
    if (config.direction === 'none') {
      valueColorClass = 'text-foreground';
    } else if (meetsTarget) {
      valueColorClass = 'text-profit'; // Use design system color
    } else if (hasValue && currentValue !== 0) {
      valueColorClass = 'text-amber-500';
    } else {
      valueColorClass = 'text-muted-foreground/60';
    }
  } else if (hasValue) {
    displayValue = config.formatValue(value);
    if (config.direction === 'none') {
      valueColorClass = 'text-foreground';
    } else {
      valueColorClass = meetsTarget ? 'text-profit' : 'text-amber-500';
    }
  } else {
    // Non-TRIALS with no value
    displayValue = '—';
    valueColorClass = 'text-muted-foreground';
  }

  // Build tooltip content
  const tooltipContent = () => {
    const targetText = config.target !== undefined && config.formatTarget
      ? config.formatTarget()
      : 'No target';
    
    let statusLine: string;
    if (!hasValue) {
      statusLine = isLabMode 
        ? 'Awaiting data — showing target to graduate' 
        : 'No data available';
    } else if (config.direction === 'none') {
      statusLine = 'Informational metric';
    } else if (meetsTarget) {
      statusLine = `✓ Meeting target (${targetText})`;
    } else {
      statusLine = `✗ Below target (${targetText})`;
    }

    return (
      <div className="space-y-1">
        <p className="font-medium">{config.label}</p>
        <p className="text-xs text-muted-foreground">{config.description}</p>
        {config.target !== undefined && (
          <p className="text-xs">
            <span className="text-muted-foreground">Target:</span>{' '}
            <span className="font-mono">{targetText}</span>
          </p>
        )}
        <p className={cn(
          "text-xs font-medium",
          !hasValue ? 'text-muted-foreground' : 
          config.direction === 'none' ? 'text-foreground' :
          meetsTarget ? 'text-profit' : 'text-amber-500'
        )}>
          {statusLine}
        </p>
        {showConfidence && confidence && (
          <p className="text-xs">
            <span className="text-muted-foreground">Statistical confidence:</span>{' '}
            <span className={cn(
              "font-medium",
              confidence === 'HIGH' ? 'text-emerald-500' :
              confidence === 'MEDIUM' ? 'text-amber-500' :
              'text-orange-500'
            )}>
              {confidence}
            </span>
          </p>
        )}
      </div>
    );
  };

  // Trades metric is always clickable if onClick is provided
  const isClickable = onClick && type === 'trades';

  return (
    <div className={cn(width, className)}>
      <p className="text-[10px] uppercase text-muted-foreground leading-none mb-0.5">
        {config.label}
      </p>
      <Tooltip>
        <TooltipTrigger asChild>
          {isClickable ? (
            <button
              onClick={onClick}
              className={cn(
                "font-mono text-sm font-semibold inline-flex items-center gap-0.5",
                "hover:underline cursor-pointer transition-colors",
                valueColorClass
              )}
              data-testid="button-trades-explainer"
            >
              {displayValue}
              {showConfidence && isLowConfidence && hasValue && (
                <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
              )}
            </button>
          ) : (
            <p className={cn(
              "font-mono text-sm font-semibold cursor-help inline-flex items-center gap-0.5",
              valueColorClass
            )}>
              {displayValue}
              {showConfidence && isLowConfidence && hasValue && (
                <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
              )}
            </p>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px]">
          {tooltipContent()}
          {isClickable && (
            <p className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border">
              Click to see trade decisions
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// Convenience component for displaying a metric value without target comparison
interface SimpleMetricProps {
  label: string;
  value: number | null | undefined;
  format?: (v: number) => string;
  className?: string;
  width?: string;
}

export function SimpleMetric({ 
  label, 
  value, 
  format = (v) => v.toFixed(2),
  className,
  width = 'w-16'
}: SimpleMetricProps) {
  const hasValue = value !== null && value !== undefined;
  
  return (
    <div className={cn(width, className)}>
      <p className="text-[10px] uppercase text-muted-foreground leading-none mb-0.5">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold">
        {hasValue ? format(value) : '—'}
      </p>
    </div>
  );
}
