/**
 * ActivityGrid - 3x2 grid of activity indicator icons
 * 
 * Layout:  [BT] [IM] [EV]   ← Backtesting | Improving | Evolving
 *          [RN] [MX] [AL]   ← Runner | Matrix | Alerts
 * 
 * All 6 slots are always visible:
 * - Inactive: faded (opacity-20), monochrome
 * - Active: full opacity with activity-specific colors
 * 
 * Designed to sit next to bot name, spanning all 3 text lines.
 */
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart2, Dna, Wrench, Search, TrendingUp, TrendingDown, Zap, Wallet, DollarSign, Activity, Lock, Moon, Bomb, Ban, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAccounts, type Account, type EnrichedAccount } from "@/hooks/useAccounts";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useUpdateBotAccount } from "@/hooks/useBotInlineEdit";
import { MatrixDropdown } from "./MatrixDropdown";
import { AlertsDropdown } from "./AlertsDropdown";
import { TradeIdeaDrawer } from "./TradeIdeaDrawer";
import { ImprovementDetailsDrawer } from "./ImprovementDetailsDrawer";
import { InlineAccountEdit } from "./InlineAccountEdit";
import { SmoothCounter } from "@/components/ui/animated-number";
import { LLMProviderBadge } from "./LLMProviderBadge";
import { BotCostBadge } from "./BotCostBadge";
import { SignalSourcesBadge } from "./SignalSourcesBadge";

function formatCompactDuration(since: Date): string {
  // Guard against invalid dates
  if (!since || isNaN(since.getTime())) {
    return '';
  }
  
  const now = Date.now();
  const diffMs = now - since.getTime();
  // Clamp to >= 0 to prevent negative values from clock skew
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m`;
  }
  
  const diffHr = Math.floor(diffMin / 60);
  const remainingMin = diffMin % 60;
  if (remainingMin === 0) {
    return `${diffHr}h`;
  }
  return `${diffHr}h${remainingMin}m`;
}

interface RecentJob {
  id: string;
  type: string;
  status: string;
  completedAt?: string | null;
  totalCompleted?: number;
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

interface ActivityGridProps {
  botId: string;
  backtestsRunning?: number;
  backtestsQueued?: number;
  evolvingRunning?: number;
  evolvingQueued?: number;
  improvingRunning?: number;
  improvingQueued?: number;
  /** When the running backtest started (for elapsed time display) */
  backtestStartedAt?: string | null;
  /** When the running evolution started (for elapsed time display) */
  evolveStartedAt?: string | null;
  /** When the running improvement started (for elapsed time display) */
  improveStartedAt?: string | null;
  runnerState?: 'IDLE' | 'SCANNING' | 'SIGNAL' | 'TRADING' | 'STARTING' | 'STALLED' | 'ERROR' | 'DATA_FROZEN' | 'MAINTENANCE' | null;
  /** When scanning started (for "Scanning since X" display) */
  scanningSince?: string | null;
  /** Recently completed job (within 10 min) for badge persistence */
  recentJob?: RecentJob;
  /** Improvement iteration count for display */
  improvementIteration?: number;
  /** Backtest job attempt count for display */
  jobAttempt?: number;
  /** Position side when TRADING (LONG/SHORT) */
  positionSide?: 'LONG' | 'SHORT' | null;
  /** Number of contracts in position */
  positionQuantity?: number | null;
  /** Entry price for current position */
  entryPrice?: number | null;
  /** Current market price */
  currentPrice?: number | null;
  /** Stop loss price */
  stopPrice?: number | null;
  /** Take profit / target price */
  targetPrice?: number | null;
  /** Unrealized P&L for open position */
  unrealizedPnl?: number | null;
  /** Entry reason code (e.g., EMA_CROSSOVER) */
  entryReasonCode?: string | null;
  /** When position was opened (ISO timestamp) */
  positionOpenedAt?: string | null;
  /** INSTITUTIONAL SAFETY: Explicit flag from WebSocket confirming position is active.
   * This MUST be true for position duration to display. Prevents stale data from
   * race conditions with out-of-order WebSocket packets. */
  livePositionActive?: boolean;
  /** Matrix run status */
  matrixStatus?: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | null;
  /** Matrix completion percentage (0-100) */
  matrixProgress?: number;
  /** Matrix timeframes for display (e.g., ["1m", "5m", "15m"]) */
  matrixTimeframes?: string[];
  /** Matrix cells completed in current run */
  matrixCompletedCells?: number;
  /** Matrix total cells in current run */
  matrixTotalCells?: number;
  /** Matrix current timeframe being tested */
  matrixCurrentTimeframe?: string | null;
  /** Matrix aggregate stats */
  matrixAggregate?: MatrixAggregate | null;
  /** Number of active/unread alerts for this bot */
  alertCount?: number;
  /** Bot's configured timeframe for display next to Matrix icon */
  botTimeframe?: string;
  /** Bot name for alerts popup */
  botName?: string;
  /** Bot stage for alerts popup */
  stage?: string;
  /** Generation number for alerts popup */
  generationNumber?: number;
  /** Win rate for alerts popup */
  winRate?: number | null;
  /** Profit factor for alerts popup */
  profitFactor?: number | null;
  /** Expectancy (expected $ per trade) */
  expectancy?: number | null;
  /** Max drawdown % for alerts popup */
  maxDrawdownPct?: number | null;
  /** Sharpe ratio for alerts popup */
  sharpe?: number | null;
  /** Trade count for alerts popup and ActivityGrid display */
  trades?: number | null;
  /** Timestamp of last trade for recency display */
  lastTradeAt?: string | null;
  /** Callback when trades slot is clicked */
  onTradesClick?: () => void;
  className?: string;
  
  /** Peak generation tracking for revert candidate indicator */
  peakGeneration?: number | null;
  /** Peak Sharpe ratio for display */
  peakSharpe?: number | null;
  /** Whether bot is flagged for potential reversion */
  isRevertCandidate?: boolean;
  /** Percentage decline from peak performance */
  declineFromPeakPct?: number | null;
  /** Performance trend direction */
  trendDirection?: string | null;
  
  /** PAPER+ Stage Props - Show LIVE/NET/WALLET instead of progress indicators */
  /** Live unrealized P&L for open position */
  livePnl?: number | null;
  /** Net realized P&L (cumulative) */
  netPnl?: number | null;
  /** Account ID for wallet selector */
  accountId?: string | null;
  /** Account name for display */
  accountName?: string | null;
  /** Account type (SIM/LIVE/DEMO) */
  accountType?: 'SIM' | 'LIVE' | 'DEMO' | null;
  /** Whether account editing is locked */
  isAccountLocked?: boolean;
  /** Reason for account lock */
  accountLockReason?: string;
  /** Session state for PAPER+ bots (CLOSED = outside RTH) */
  sessionState?: 'CLOSED' | 'OPEN' | null;
  /** Whether the bot is sleeping (outside session) */
  isSleeping?: boolean;
  /** Whether the attached account is blown (balance <= 0) */
  isAccountBlown?: boolean;
  /** Total number of times the account has been blown */
  accountTotalBlownCount?: number;
  /** Consecutive blown count for the account */
  accountConsecutiveBlownCount?: number;
  
  /** LLM/COST/SOURCES slot props */
  /** Bot's strategy config for LLM provider detection */
  strategyConfig?: Record<string, unknown>;
  /** Bot's trading symbol for sources display */
  symbol?: string;
  /** Available symbols for instrument selector */
  availableSymbols?: string[];
  /** Whether symbol editing is locked */
  isSymbolLocked?: boolean;
  /** Reason for symbol lock */
  symbolLockReason?: string;
  /** Callback when sources slot is clicked */
  onSourcesClick?: () => void;
  /** Pre-fetched LLM cost data from bots-overview (eliminates N+1 query) */
  llmCostData?: {
    total_cost_usd: number;
    total_input_tokens: number;
    total_output_tokens: number;
    event_count: number;
    last_provider: string | null;
    last_model: string | null;
  } | null;
  
  /** Metrics generation status - indicates if metrics are from current or prior generation */
  metricsStatus?: 'AVAILABLE' | 'AWAITING_EVIDENCE' | 'PRIOR_GENERATION' | null;
  
  /** INSTITUTIONAL FRESHNESS CONTRACT: Controls P&L display validity
   * If false, live P&L must be masked with "Awaiting mark" to prevent stale data display */
  displayAllowed?: boolean;
  /** Data source for mark prices: 'live' | 'cache' | 'none' */
  dataSource?: 'live' | 'cache' | 'none';
  /** If true, show maintenance-specific messaging instead of generic "Awaiting" in LIVE slot */
  isMaintenanceWindow?: boolean;
}

interface ActivitySlotProps {
  icon: React.ElementType;
  isActive: boolean;
  isRunning?: boolean;
  isQueued?: boolean;
  /** Shows a completed checkmark instead of the icon when true */
  isCompleted?: boolean;
  count?: number;
  /** Primary text to display (e.g., timeframe "5m") - takes precedence over count */
  primaryText?: string | null;
  /** Progress percentage (0-100) for the circular progress ring */
  progressPercent?: number | null;
  tooltip: string;
  activeColor: string;
  label: string;
  duration?: string | null;
  onClick?: () => void;
  clickable?: boolean;
  className?: string;
}

interface PnlSlotProps {
  label: string;
  value: number | null;
  tooltip: string;
  trades?: number | null;
  lastTradeAt?: string | null;
  onTradesClick?: () => void;
  stage?: string;
  /** INSTITUTIONAL: If false, mask value with "Awaiting mark" to prevent stale display */
  displayAllowed?: boolean;
  /** Data source indicator for tooltip context */
  dataSource?: 'live' | 'cache' | 'none';
  /** If true, show maintenance-specific messaging instead of generic "Awaiting" */
  isMaintenanceWindow?: boolean;
}

// Promotion gate thresholds for trades count by stage
// Aligned with canonical promotion-engine values
const TRADES_GATE_THRESHOLDS: Record<string, number | null> = {
  TRIALS: null,    // No gate for TRIALS - no promotion requirement
  PAPER: 30,    // Need 30 trades to pass PAPER gate
  SHADOW: 25,   // Need 25 trades to pass SHADOW gate
  CANARY: 60,   // Need 60 trades to pass CANARY gate
  LIVE: null,   // LIVE has no gate (already at highest stage)
};

// Get trades gate status for coloring
function getTradesGateStatus(stage: string, trades: number): 'passed' | 'near' | 'below' | 'none' {
  const threshold = TRADES_GATE_THRESHOLDS[stage];
  if (threshold === null || threshold === undefined) return 'none'; // No gate for this stage
  if (trades >= threshold) return 'passed';
  if (trades >= threshold * 0.8) return 'near'; // Within 80% of target
  return 'below';
}

interface TradesSlotProps {
  trades: number | null;
  tooltip: string;
  onClick?: () => void;
  lastTradeAt?: string | null;
}

function formatRelativeTime(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  
  const now = Date.now();
  const diffMs = now - date.getTime();
  // Clamp to >= 0 to handle clock skew (server timestamp slightly in future)
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  
  if (diffSec < 60) return 'now';
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d`;
}

function TradesSlot({ trades, tooltip, onClick, lastTradeAt }: TradesSlotProps) {
  const hasValue = trades != null && trades > 0;
  
  // Auto-refresh relative time every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastTradeAt) return;
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, [lastTradeAt]);
  
  // Format trades compactly: 1234 -> "1.2K"
  const formattedValue = trades != null
    ? trades >= 1000 
      ? `${(trades / 1000).toFixed(1)}K`
      : trades.toString()
    : '-';
  
  const relativeTime = formatRelativeTime(lastTradeAt);
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all",
            hasValue
              ? "text-cyan-400 bg-cyan-500/20 border-cyan-500/30"
              : "opacity-40 text-muted-foreground border-muted-foreground/30",
            onClick && "cursor-pointer hover:bg-cyan-500/30"
          )}
          data-testid="trades-slot"
          onClick={onClick}
        >
          <span className="text-[9px] uppercase leading-none opacity-70">TRADES</span>
          <div className="flex items-center gap-0.5">
            <span className="text-[11px] font-mono font-semibold leading-none">{formattedValue}</span>
            {relativeTime && (
              <span className="text-[8px] font-mono text-muted-foreground/70 leading-none">{relativeTime}</span>
            )}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">Total Trades</div>
        <div className="text-muted-foreground">{tooltip}</div>
        {lastTradeAt && (
          <div className="text-muted-foreground mt-1">
            Last trade: {new Date(lastTradeAt).toLocaleString()}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function PnlSlot({ label, value, tooltip, trades, lastTradeAt, onTradesClick, stage = 'TRIALS', displayAllowed = true, dataSource, isMaintenanceWindow = false }: PnlSlotProps) {
  // INSTITUTIONAL FRESHNESS: If displayAllowed is false, mask the value
  // This prevents stale/cache data from being displayed as if it were live
  const isStale = displayAllowed === false;
  
  // When stale, treat as no value regardless of what was passed
  const effectiveValue = isStale ? null : value;
  
  const isPositive = effectiveValue != null && effectiveValue > 0;
  const isNegative = effectiveValue != null && effectiveValue < 0;
  const hasValue = effectiveValue != null;
  const hasTrades = trades != null && trades > 0;
  const showTradesBadge = trades != null; // Always show badge if trades prop is provided (even if 0)
  
  const isLivePnl = label === "LIVE";
  
  // Format trades compactly: 1234 -> "1.2K"
  const formattedTrades = trades != null
    ? trades >= 1000 
      ? `${(trades / 1000).toFixed(1)}K`
      : trades.toString()
    : '0';
    
  const relativeTime = formatRelativeTime(lastTradeAt);
  
  // Get promotion gate status for badge coloring
  const gateStatus = getTradesGateStatus(stage, trades ?? 0);
  const threshold = TRADES_GATE_THRESHOLDS[stage];
  const hasGate = threshold !== null && threshold !== undefined;
  
  // Badge color based on gate status
  const getBadgeColor = () => {
    if (!hasTrades) return "bg-muted-foreground/40 text-muted-foreground";
    switch (gateStatus) {
      case 'passed': return "bg-emerald-500 text-white shadow-sm shadow-emerald-500/50";
      case 'near': return "bg-amber-500 text-white shadow-sm shadow-amber-500/50";
      case 'none': return "bg-cyan-500 text-white shadow-sm shadow-cyan-500/50"; // No gate, show as normal
      default: return "bg-cyan-500 text-white shadow-sm shadow-cyan-500/50";
    }
  };
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "relative w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all",
            hasValue
              ? isPositive 
                ? "text-green-400 bg-green-500/20 border-green-500/30"
                : isNegative
                  ? "text-red-400 bg-red-500/20 border-red-500/30"
                  : "text-muted-foreground bg-muted/20 border-muted-foreground/30"
              : "opacity-40 text-muted-foreground border-muted-foreground/30"
          )}
          data-testid={`pnl-slot-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {showTradesBadge && (
            <span 
              className={cn(
                "absolute -top-2 -left-2 px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded leading-none",
                getBadgeColor(),
                onTradesClick && hasTrades && "cursor-pointer hover:brightness-110"
              )}
              onClick={(e) => {
                if (hasTrades) {
                  e.stopPropagation();
                  onTradesClick?.();
                }
              }}
              data-testid="badge-trades-net"
            >
              {formattedTrades}
            </span>
          )}
          <span className="text-[9px] uppercase leading-none opacity-70">{label}</span>
          {isStale && isLivePnl ? (
            /* INSTITUTIONAL: Mask stale P&L with clear message - differentiate maintenance vs other reasons */
            <span className={cn(
              "text-[9px] font-mono leading-none",
              isMaintenanceWindow ? "text-amber-400" : "text-amber-400"
            )}>
              {isMaintenanceWindow ? "Maint." : "Awaiting"}
            </span>
          ) : hasValue && isLivePnl ? (
            <SmoothCounter 
              value={effectiveValue} 
              duration={600} 
              decimals={2} 
              showSign={true} 
              showCurrency={true}
              className="text-[11px] font-semibold leading-none"
            />
          ) : (
            <span className="text-[11px] font-mono font-semibold leading-none">
              {hasValue 
                ? formatPnlCompact(effectiveValue)
                : '-'
              }
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{label}</div>
        {isStale && isLivePnl ? (
          isMaintenanceWindow ? (
            <div className="text-amber-400">CME daily maintenance (5-6 PM ET) - resumes automatically</div>
          ) : (
            <div className="text-amber-400">Awaiting live mark price{dataSource ? ` (source: ${dataSource})` : ''}</div>
          )
        ) : (
          <div className="text-muted-foreground">{tooltip}</div>
        )}
        {showTradesBadge && (
          <div className="mt-1 pt-1 border-t border-muted-foreground/20">
            <span className={cn(
              "font-medium",
              gateStatus === 'passed' ? "text-emerald-400" : 
              gateStatus === 'near' ? "text-amber-400" : 
              gateStatus === 'none' ? "text-cyan-400" :
              hasTrades ? "text-cyan-400" : "text-muted-foreground"
            )}>
              {formattedTrades} trades
            </span>
            {hasGate && gateStatus !== 'none' && (
              <span className="text-muted-foreground ml-1">
                ({gateStatus === 'passed' ? 'gate passed' : `${Math.max(0, (threshold ?? 0) - (trades ?? 0))} to gate`})
              </span>
            )}
            {hasTrades && relativeTime && <div className="text-muted-foreground mt-0.5">Last: {relativeTime}</div>}
            {!hasTrades && <span className="text-muted-foreground ml-1">(no trades yet)</span>}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// Get color class for metric value based on thresholds
// Handles negative values and extreme inputs defensively
// COPIED EXACTLY from BotTableRow.tsx for institutional parity
function getMetricColor(type: string, value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "text-muted-foreground bg-muted/20";
  
  switch (type) {
    case 'maxDrawdown':
      // Drawdown stored as positive percentage (e.g., 5 = 5% drawdown)
      // Handle negative values (shouldn't happen but defensive)
      const absDD = Math.abs(value);
      if (absDD === 0) return "text-muted-foreground bg-muted/20";
      if (absDD > 100) return "text-red-400 bg-red-500/20"; // Invalid extreme value
      if (absDD <= 5) return "text-green-400 bg-green-500/20";
      if (absDD <= 10) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    case 'sharpe':
      // Higher is better, handle extreme values
      if (value < -5 || value > 5) return "text-muted-foreground bg-muted/20"; // Invalid
      if (value >= 1.0) return "text-green-400 bg-green-500/20";
      if (value >= 0.5) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    case 'winRate':
      // Higher is better (value is percentage 0-100)
      if (value < 0 || value > 100) return "text-muted-foreground bg-muted/20"; // Invalid
      if (value >= 50) return "text-green-400 bg-green-500/20";
      if (value >= 40) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    case 'profitFactor':
      // Higher is better (gross profit / gross loss ratio)
      if (value <= 0) return "text-muted-foreground bg-muted/20"; // Invalid
      if (value >= 1.5) return "text-green-400 bg-green-500/20";
      if (value >= 1.0) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    case 'expectancy':
      // Expected $ per trade - positive is good, negative is bad
      if (value >= 10) return "text-green-400 bg-green-500/20";
      if (value >= 0) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    default:
      return "text-muted-foreground bg-muted/20";
  }
}

// Format metric value for display
// COPIED EXACTLY from BotTableRow.tsx for institutional parity
function formatMetricValue(type: string, value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '-';
  
  switch (type) {
    case 'maxDrawdown':
      const absDD = Math.abs(value);
      if (absDD === 0 || absDD > 100) return '-';
      // Use 1 decimal place to preserve sub-1% values like 0.3%
      // Calculate dollar amount assuming $10,000 initial capital
      const dollarAmount = (absDD / 100) * 10000;
      return `-$${dollarAmount.toFixed(0)}`;
    case 'sharpe':
      if (value === 0 || value < -5 || value > 5) return '-';
      return value.toFixed(2);
    case 'winRate':
      if (value < 0 || value > 100) return '-';
      return `${value.toFixed(0)}%`;
    case 'profitFactor':
      if (value <= 0) return '-';
      return value.toFixed(2);
    case 'expectancy':
      // Expected $ per trade - show as compact value, preserves negative for losses
      return formatPnlCompact(value);
    default:
      return String(value);
  }
}

// MetricSlot - Displays formatted metrics (PF, MAX DD, SHARPE, WIN%, EXPECTANCY)
// Uses identical formatting and color logic as BotTableRow.tsx MetricGridBox
interface MetricSlotProps {
  label: string;
  value: number | null | undefined;
  format: 'profitFactor' | 'maxDrawdown' | 'sharpe' | 'winRate' | 'expectancy';
  tooltip: string;
  tradeCount?: number | null;
}

function MetricSlot({ label, value, format, tooltip, tradeCount }: MetricSlotProps) {
  const formattedValue = formatMetricValue(format, value);
  const hasValue = formattedValue !== '-';
  const colorClass = getMetricColor(format, value);
  
  // For Sharpe specifically, show contextual message when null
  let displayValue = formattedValue;
  let displayTooltip = tooltip;
  
  if (format === 'sharpe' && !hasValue && tradeCount != null) {
    displayValue = 'low var';
    displayTooltip = tradeCount < 5 
      ? `Need at least 5 trades to calculate Sharpe. Currently have ${tradeCount}.`
      : `Sharpe requires variance in returns. All ${tradeCount} trades have similar P&L amounts.`;
  }
  
  // For MAX DD, include the percentage in the tooltip since display is in dollars
  if (format === 'maxDrawdown' && hasValue && value != null) {
    displayTooltip = `${tooltip} (${Math.abs(value).toFixed(2)}%)`;
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all",
            hasValue
              ? `${colorClass} border-current/30`
              : "opacity-40 text-muted-foreground border-muted-foreground/30"
          )}
          data-testid={`metric-slot-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <span className="text-[9px] uppercase leading-none opacity-70">{label}</span>
          <span className="text-[11px] font-mono font-semibold leading-none">{displayValue}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">{displayTooltip}</div>
      </TooltipContent>
    </Tooltip>
  );
}

interface WalletSlotProps {
  botId: string;
  stage: string;
  accountId: string | null;
  accountName: string | null;
  accountType: 'SIM' | 'LIVE' | 'DEMO' | null;
  isLocked?: boolean;
  lockReason?: string;
  totalBlownCount?: number;
  /** Bot's cumulative P&L to add to initial balance for current balance display */
  botNetPnl?: number | null;
}

function formatBalanceCompact(balance: number | null | undefined, includeDollarSign = true): string {
  if (balance == null) return '--';
  const absBalance = Math.abs(balance);
  const prefix = includeDollarSign ? '$' : '';
  if (absBalance >= 1000000) {
    return `${prefix}${(balance / 1000000).toFixed(1)}M`;
  }
  if (absBalance >= 100000) {
    return `${prefix}${Math.round(balance / 1000)}K`;
  }
  const rounded = Math.round(balance);
  if (absBalance >= 1000) {
    const thousands = Math.floor(rounded / 1000);
    const remainder = Math.abs(rounded % 1000);
    return `${prefix}${thousands},${remainder.toString().padStart(3, '0')}`;
  }
  return `${prefix}${rounded}`;
}

/**
 * Format P&L values as compact whole numbers: $1.2k, $10.1k, -$500 etc.
 * User preference: No "+" prefix for positive, but keep "-" for negative, 
 * rounded to whole numbers, compact notation for thousands.
 */
function formatPnlCompact(value: number | null | undefined): string {
  if (value == null) return '-';
  const absValue = Math.abs(value);
  const prefix = value < 0 ? '-$' : '$';
  
  // Use compact notation for thousands
  if (absValue >= 10000) {
    // 10k+ shows as 10.1k or -10.1k
    return `${prefix}${(absValue / 1000).toFixed(1)}k`;
  }
  if (absValue >= 1000) {
    // 1k-9.9k shows as 1.24k or -1.24k
    return `${prefix}${(absValue / 1000).toFixed(2)}k`;
  }
  
  // Under 1000: round to whole number
  return `${prefix}${Math.round(absValue)}`;
}

export function WalletSlot({ 
  botId, 
  stage, 
  accountId, 
  accountName, 
  accountType,
  isLocked = false,
  lockReason,
  totalBlownCount = 0,
  botNetPnl,
}: WalletSlotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [displayAccountId, setDisplayAccountId] = useState<string | null>(accountId);
  const [displayAccountName, setDisplayAccountName] = useState<string | null>(accountName);
  const [displayAccountType, setDisplayAccountType] = useState<string | null>(accountType);
  const [selectedAccountId, setSelectedAccountId] = useState(accountId || "");
  const { data: accountsRaw, isLoading, isError } = useAccounts();
  const accounts = accountsRaw ?? [];
  const updateAccount = useUpdateBotAccount();
  
  const isAccountsDegraded = isError || (!isLoading && !accountsRaw);
  
  // Sync display state when props change from external sources
  useEffect(() => {
    if (!isOpen && accountId !== displayAccountId) {
      setDisplayAccountId(accountId);
      setDisplayAccountName(accountName);
      setDisplayAccountType(accountType);
      setSelectedAccountId(accountId || "");
    }
  }, [accountId, accountName, accountType]);
  
  // Find current account to get balance data
  const currentAccount = accounts.find((a) => a.id === displayAccountId) as EnrichedAccount | undefined;
  // Compute current balance based on BOT STAGE (not account type):
  // - PAPER stage: use initialBalance + bot.netPnl for per-bot accuracy (covers both VIRTUAL and SIM accounts)
  // - LIVE/SHADOW/etc stages: use computedBalance or currentBalance from broker sync
  const isPaperStage = stage === 'PAPER';
  
  let balance: number | null = null;
  if (isPaperStage && botNetPnl != null) {
    // PAPER bot: starting capital + cumulative P&L
    // Derive starting capital: prefer explicit initialBalance, else back-calculate from accountBalance
    const accountBalance = currentAccount?.currentBalance ?? currentAccount?.computedBalance ?? null;
    if (currentAccount?.initialBalance != null) {
      // Explicit initial balance available
      balance = currentAccount.initialBalance + botNetPnl;
    } else if (accountBalance != null) {
      // Back-calculate: accountBalance already includes P&L, so result is just accountBalance
      // (accountBalance - botNetPnl) + botNetPnl = accountBalance
      balance = accountBalance;
    }
    // If neither available, balance remains null (shows '--')
  } else {
    // LIVE/SHADOW/etc stages or no P&L data: use account-level balance
    balance = currentAccount?.computedBalance ?? currentAccount?.currentBalance ?? null;
  }
  
  const isBlownAccount = balance !== null && balance <= 0;
  const balanceDisplay = formatBalanceCompact(balance);
  
  // Filter accounts based on stage compatibility (same as InlineAccountEdit)
  const compatibleAccounts = accounts.filter((account: Account) => {
    if (stage === "LIVE") {
      return account.accountType === "LIVE";
    }
    if (stage === "PAPER") {
      return account.accountType !== "LIVE"; // VIRTUAL or SIM
    }
    if (stage === "SHADOW") {
      return true; // All account types allowed for SHADOW
    }
    // LAB - all accounts or none
    return true;
  });
  
  // Group accounts by type
  const virtualAccounts = compatibleAccounts.filter((a) => a.accountType === 'VIRTUAL');
  const simAccounts = compatibleAccounts.filter((a) => a.accountType === 'SIM');
  const liveAccounts = compatibleAccounts.filter((a) => a.accountType === 'LIVE');
  
  const handleSave = () => {
    const newAccountId = selectedAccountId === "none" ? null : selectedAccountId || null;
    if (newAccountId !== displayAccountId) {
      // Optimistically update local display immediately
      if (newAccountId) {
        const account = accounts.find((a) => a.id === newAccountId);
        setDisplayAccountId(newAccountId);
        setDisplayAccountName(account?.name || null);
        setDisplayAccountType(account?.accountType || null);
      } else {
        setDisplayAccountId(null);
        setDisplayAccountName(null);
        setDisplayAccountType(null);
      }
      
      updateAccount.mutate({
        botId,
        oldAccountId: displayAccountId,
        newAccountId,
        stage,
      });
    }
    setIsOpen(false);
  };
  
  const handleCancel = () => {
    setSelectedAccountId(displayAccountId || "");
    setIsOpen(false);
  };
  
  // Degraded state - show disabled grid box
  if (isAccountsDegraded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all bg-amber-500/20 text-amber-500 border-amber-500/30 cursor-not-allowed"
            data-testid={`wallet-slot-degraded-${botId}`}
          >
            <span className="text-[9px] uppercase leading-none opacity-70">ACCT</span>
            <span className="text-[11px] font-mono font-semibold leading-none">--</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">Account Unavailable</div>
          <div className="text-muted-foreground">Account data unavailable</div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Locked state - show disabled grid box (wallet badge with lock overlay)
  if (isLocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all opacity-50 text-muted-foreground border-muted-foreground/30 cursor-not-allowed"
            data-testid={`wallet-slot-locked-${botId}`}
          >
            <span className="text-[9px] uppercase leading-none opacity-70">ACCT</span>
            <span className="text-[11px] font-mono font-semibold leading-none">{balanceDisplay}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">Account Locked</div>
          <div className="text-muted-foreground">{lockReason || "Editing locked"}</div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // No account selected - show faded state
  const hasAccount = !!displayAccountId;
  
  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      if (!open) handleCancel();
      else setIsOpen(true);
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <div 
              className={cn(
                "w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all cursor-pointer hover-elevate",
                isBlownAccount
                  ? "text-red-500 border-red-500/50 bg-red-500/10"
                  : hasAccount 
                    ? "text-blue-400 border-blue-400/30"
                    : "opacity-20 text-muted-foreground border-muted-foreground/30"
              )}
              onClick={(e) => e.stopPropagation()}
              data-testid={`button-wallet-${botId}`}
            >
              <span className="text-[9px] uppercase leading-none opacity-70">ACCT</span>
              {isBlownAccount ? (
                <span className="text-[11px] font-mono font-semibold leading-none">
                  {totalBlownCount > 1 ? `x${totalBlownCount}` : 'BLOWN'}
                </span>
              ) : (
                <span className="text-[11px] font-mono font-semibold leading-none">
                  {hasAccount ? balanceDisplay : '--'}
                </span>
              )}
            </div>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">
            {isBlownAccount ? "Account Blown" : "Account Balance"}
          </div>
          {hasAccount ? (
            <>
              <div className="text-muted-foreground">{displayAccountName} ({displayAccountType})</div>
              {currentAccount?.initialBalance != null && (
                <div className="text-muted-foreground">
                  Starting: ${currentAccount.initialBalance.toLocaleString()}
                </div>
              )}
              <div className={cn("text-muted-foreground", isBlownAccount && "text-red-400")}>
                Balance: ${balance?.toLocaleString() ?? '--'}
              </div>
              {isBlownAccount && (
                <div className="text-red-400 text-[10px] mt-1">
                  Trading paused - reset required
                  {totalBlownCount > 1 && ` (${totalBlownCount} total blows)`}
                </div>
              )}
              <div className="text-muted-foreground/70 text-[10px] mt-1">Click to change</div>
            </>
          ) : (
            <div className="text-muted-foreground">Click to attach account</div>
          )}
        </TooltipContent>
      </Tooltip>
      <PopoverContent 
        align="end" 
        side="bottom" 
        className="w-48 p-2" 
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <Select value={selectedAccountId || "none"} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="h-7 text-[11px] px-2">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent className="bg-popover z-50">
              {stage === 'TRIALS' && (
                <SelectItem value="none" className="text-xs">
                  No account
                </SelectItem>
              )}
              
              {virtualAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Virtual</SelectLabel>
                  {virtualAccounts.map((account) => {
                    const enriched = account as EnrichedAccount;
                    const bal = enriched.computedBalance ?? enriched.currentBalance;
                    return (
                      <SelectItem key={account.id} value={account.id} className="text-xs">
                        {account.name} ({formatBalanceCompact(bal)})
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              )}
              
              {simAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Simulation</SelectLabel>
                  {simAccounts.map((account) => {
                    const enriched = account as EnrichedAccount;
                    const bal = enriched.computedBalance ?? enriched.currentBalance;
                    return (
                      <SelectItem key={account.id} value={account.id} className="text-xs">
                        {account.name} ({formatBalanceCompact(bal)})
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              )}
              
              {liveAccounts.length > 0 && stage !== "PAPER" && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] text-muted-foreground">Live</SelectLabel>
                  {liveAccounts.map((account) => {
                    const enriched = account as EnrichedAccount;
                    const bal = enriched.computedBalance ?? enriched.currentBalance;
                    return (
                      <SelectItem key={account.id} value={account.id} className="text-xs">
                        {account.name} ({formatBalanceCompact(bal)})
                      </SelectItem>
                    );
                  })}
                </SelectGroup>
              )}
              
              {compatibleAccounts.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No compatible accounts
                </div>
              )}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={handleCancel}>
              Cancel
            </Button>
            <Button size="sm" className="h-6 px-3 text-xs" onClick={handleSave} disabled={updateAccount.isPending}>
              {updateAccount.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ActivitySlot({ icon: Icon, isActive, isRunning, isQueued, isCompleted, count, primaryText, progressPercent, tooltip, activeColor, label, duration, onClick, clickable, className }: ActivitySlotProps) {
  const isClickable = clickable && isActive && onClick;
  
  // Always use the provided icon - never swap it out
  // Show queued state with a small clock badge instead
  
  // Calculate progress ring if provided
  const showProgressRing = progressPercent != null && progressPercent > 0 && isRunning;
  const circumference = 2 * Math.PI * 12; // radius = 12
  const strokeDashoffset = showProgressRing 
    ? circumference - (progressPercent / 100) * circumference 
    : circumference;
  
  const content = (
    <div 
      className={cn(
        "w-[64px] h-6 flex items-center justify-center gap-0.5 rounded-sm border transition-all px-1 relative",
        isActive 
          ? cn(activeColor, "border-current/30")
          : "opacity-20 text-muted-foreground border-muted-foreground/30",
        isClickable && "cursor-pointer hover-elevate",
        className
      )}
      onClick={isClickable ? onClick : undefined}
      data-testid={isClickable ? "button-trade-idea" : undefined}
    >
      {showProgressRing ? (
        <div className="relative flex items-center justify-center">
          <svg className="w-6 h-6 -rotate-90" viewBox="0 0 28 28">
            <circle
              cx="14"
              cy="14"
              r="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-20"
            />
            <circle
              cx="14"
              cy="14"
              r="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-300"
            />
          </svg>
          <Icon className="w-3 h-3 absolute" />
        </div>
      ) : (
        <Icon className={cn(
          "w-4 h-4 flex-shrink-0",
          isRunning && !isCompleted && "animate-pulse"
        )} />
      )}
      {isCompleted && (
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-current" />
      )}
      {isQueued && !isRunning && count !== undefined && count > 0 && (
        <span className="text-[9px] font-medium leading-none opacity-70">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {!isQueued && primaryText && isActive && (
        <span className="text-[10px] font-bold leading-none">
          {primaryText}
        </span>
      )}
      {!isQueued && !primaryText && count !== undefined && count > 0 && isActive && (
        <span className="text-[10px] font-bold leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {duration && isActive && (
        <span className="text-[10px] font-medium leading-none truncate text-muted-foreground">
          {duration}
        </span>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{label}</div>
        {isActive ? (
          <div className="text-muted-foreground whitespace-pre-line">{tooltip}</div>
        ) : (
          <div className="text-muted-foreground">Inactive</div>
        )}
        {isClickable && (
          <div className="text-muted-foreground/70 text-[10px] mt-1 pt-1 border-t border-border">
            Click to view trade details
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function ActivityGrid({
  botId,
  backtestsRunning = 0,
  backtestsQueued = 0,
  evolvingRunning = 0,
  evolvingQueued = 0,
  improvingRunning = 0,
  improvingQueued = 0,
  backtestStartedAt = null,
  evolveStartedAt = null,
  improveStartedAt = null,
  runnerState = null,
  scanningSince = null,
  recentJob,
  improvementIteration,
  jobAttempt,
  positionSide,
  positionQuantity,
  entryPrice,
  currentPrice,
  stopPrice,
  targetPrice,
  unrealizedPnl,
  entryReasonCode,
  positionOpenedAt,
  livePositionActive,
  matrixStatus = null,
  matrixProgress = 0,
  matrixTimeframes,
  matrixCompletedCells = 0,
  matrixTotalCells = 0,
  matrixCurrentTimeframe = null,
  matrixAggregate,
  alertCount = 0,
  botTimeframe,
  botName = 'Bot',
  stage = 'TRIALS',
  generationNumber,
  winRate,
  profitFactor,
  expectancy,
  maxDrawdownPct,
  sharpe,
  trades,
  lastTradeAt,
  onTradesClick,
  className,
  peakGeneration,
  peakSharpe,
  isRevertCandidate,
  declineFromPeakPct,
  trendDirection,
  livePnl,
  netPnl,
  accountId,
  accountName,
  accountType,
  isAccountLocked,
  accountLockReason,
  sessionState = null,
  isSleeping = false,
  isAccountBlown = false,
  accountTotalBlownCount = 0,
  accountConsecutiveBlownCount = 0,
  strategyConfig,
  symbol,
  availableSymbols = [],
  isSymbolLocked = false,
  symbolLockReason,
  onSourcesClick,
  llmCostData,
  metricsStatus,
  displayAllowed,
  dataSource,
  isMaintenanceWindow = false,
}: ActivityGridProps) {
  const [tradeIdeaOpen, setTradeIdeaOpen] = useState(false);
  const [improvementDrawerOpen, setImprovementDrawerOpen] = useState(false);
  
  // Auto-refresh elapsed time every second when jobs are running
  const hasRunningJobs = backtestsRunning > 0 || evolvingRunning > 0 || improvingRunning > 0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasRunningJobs) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [hasRunningJobs, backtestStartedAt, evolveStartedAt, improveStartedAt]);
  
  // Force use of tick to prevent React from optimizing away rerenders
  const _tickRef = tick;
  
  // Compute isAccountBlown from account data if not passed as prop
  const { data: allAccounts } = useAccounts();
  const currentAccount = allAccounts?.find((a: Account) => a.id === accountId) as EnrichedAccount | undefined;
  const accountBalance = currentAccount?.computedBalance ?? currentAccount?.currentBalance;
  const computedIsAccountBlown = isAccountBlown || (accountBalance !== undefined && accountBalance !== null && accountBalance <= 0);
  
  // Determine if this is a PAPER+ stage (show LIVE/NET/WALLET instead of progress indicators)
  const isPaperPlus = stage !== 'TRIALS';
  
  // Determine recentJob type for persistence (lights up even after completion)
  const recentJobType = recentJob?.type?.toUpperCase() || '';
  const hasRecentBacktest = ['BACKTESTER', 'BACKTEST'].includes(recentJobType);
  const hasRecentEvolving = recentJobType === 'EVOLVING';
  const hasRecentImproving = recentJobType === 'IMPROVING';
  
  // Active states: running OR queued OR recently completed
  const hasBacktesting = backtestsRunning > 0 || backtestsQueued > 0 || hasRecentBacktest;
  const hasEvolving = evolvingRunning > 0 || evolvingQueued > 0 || hasRecentEvolving;
  const hasImproving = improvingRunning > 0 || improvingQueued > 0 || hasRecentImproving;
  const hasRunnerActivity = runnerState === 'SCANNING' || runnerState === 'SIGNAL' || runnerState === 'TRADING' || runnerState === 'STARTING' || runnerState === 'DATA_FROZEN';
  const hasMatrixActivity = matrixStatus === 'QUEUED' || matrixStatus === 'RUNNING' || matrixStatus === 'COMPLETED';
  const hasAlerts = alertCount > 0;
  
  // Build position object for TradeIdeaDrawer
  const isTrading = runnerState === 'TRADING' && positionQuantity && positionQuantity > 0;
  const openPosition = isTrading ? {
    quantity: positionQuantity,
    side: positionSide === 'SHORT' ? 'SELL' as const : 'BUY' as const,
    entryPrice: entryPrice ?? 0,
    currentPrice: currentPrice ?? 0,
    unrealizedPnl: unrealizedPnl ?? 0,
    entryReasonCode: entryReasonCode ?? undefined,
    openedAt: positionOpenedAt ?? undefined,
    stopPrice: stopPrice ?? undefined,
    targetPrice: targetPrice ?? undefined,
  } : null;

  // Tooltip text
  const btTooltip = backtestsRunning > 0
    ? `Running${backtestsQueued > 0 ? ` (+${backtestsQueued} queued)` : ''}`
    : backtestsQueued > 0 ? `${backtestsQueued} queued` 
    : hasRecentBacktest ? `Completed${jobAttempt && jobAttempt > 1 ? ` (#${jobAttempt})` : ''}` : '';
  
  const evTooltip = evolvingRunning > 0
    ? `Running${evolvingQueued > 0 ? ` (+${evolvingQueued} queued)` : ''}`
    : evolvingQueued > 0 ? `${evolvingQueued} queued` 
    : hasRecentEvolving ? 'Recently completed' : '';
  
  const imTooltip = improvingRunning > 0
    ? `Running${improvingQueued > 0 ? ` (+${improvingQueued} queued)` : ''}`
    : improvingQueued > 0 ? `${improvingQueued} queued` 
    : hasRecentImproving ? `Completed${improvementIteration ? ` (#${improvementIteration})` : ''}` : '';
  
  const scanningSinceStr = scanningSince 
    ? formatCompactDuration(new Date(scanningSince))
    : null;
  
  // Calculate position elapsed time when trading
  // INSTITUTIONAL GRADE VALIDATION: Multiple defensive layers to prevent stale duration display
  // ALL guards must pass for duration to display - fail-safe to hide by default
  const MAX_VALID_POSITION_AGE_MS = 18 * 60 * 60 * 1000; // 18 hours
  const positionElapsedStr = (() => {
    // GUARD 0 (AUTHORITATIVE): livePositionActive MUST be explicitly TRUE from WebSocket
    // This is the ultimate gate - we NEVER trust cached REST data for position duration
    // If livePositionActive is undefined, false, or anything other than true, hide duration
    // This prevents stale "4h" durations from showing when positions are closed
    if (livePositionActive !== true) return null;
    
    // GUARD 1: Must have valid position timestamp
    if (!positionOpenedAt) return null;
    
    // GUARD 2: Runner must be explicitly in TRADING state
    if (runnerState !== 'TRADING') return null;
    
    // GUARD 3: Session must NOT be CLOSED - if closed, never show duration
    if (sessionState === 'CLOSED') return null;
    
    // GUARD 4: Bot must NOT be sleeping
    if (isSleeping) return null;
    
    // GUARD 5: Position quantity must be positive (not 0, null, or undefined)
    if (!positionQuantity || positionQuantity <= 0) return null;
    
    // GUARD 6: Position side must be set (LONG or SHORT)
    if (!positionSide) return null;
    
    // GUARD 7: Validate timestamp is reasonable (within 18 hours, not in the future)
    const openedTime = new Date(positionOpenedAt).getTime();
    const now = Date.now();
    const ageMs = now - openedTime;
    
    if (ageMs > MAX_VALID_POSITION_AGE_MS || ageMs < 0) {
      return null;
    }
    
    return formatCompactDuration(new Date(positionOpenedAt));
  })();
  
  const formatPrice = (p: number | null | undefined) => p != null ? p.toFixed(2) : '--';
  const formatPnl = (p: number | null | undefined) => {
    if (p == null) return '--';
    const sign = p >= 0 ? '+' : '';
    return `${sign}$${p.toFixed(2)}`;
  };
  const formatReasonCode = (code: string | null | undefined) => {
    if (!code) return null;
    return code.replace(/_/g, ' ').replace(/ENTRY /i, '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  };
  
  const runnerTooltip = runnerState === 'TRADING' 
    ? [
        `${positionSide || 'LONG'} x${positionQuantity ?? 1}`,
        `Entry: ${formatPrice(entryPrice)}`,
        `Current: ${formatPrice(currentPrice)}`,
        stopPrice != null ? `Stop: ${formatPrice(stopPrice)}` : null,
        targetPrice != null ? `Target: ${formatPrice(targetPrice)}` : null,
        `P&L: ${formatPnl(unrealizedPnl)}`,
        entryReasonCode ? `Reason: ${formatReasonCode(entryReasonCode)}` : null,
      ].filter(Boolean).join('\n')
    : runnerState === 'SIGNAL' ? 'Entry signal detected!'
    : runnerState === 'DATA_FROZEN'
      ? 'Scanning for data... (awaiting live market feed)'
    : runnerState === 'MAINTENANCE'
      ? 'Paused for daily maintenance (5-6 PM ET)'
    : runnerState === 'SCANNING' 
      ? `Scanning for signals${scanningSinceStr ? ` (${scanningSinceStr})` : ''}`
    : runnerState === 'STARTING' ? 'Starting up...' : '';

  const matrixTooltip = matrixStatus === 'RUNNING'
    ? `Running (${matrixProgress}% complete)`
    : matrixStatus === 'QUEUED' ? 'Queued'
    : matrixStatus === 'COMPLETED' ? 'Completed'
    : matrixStatus === 'FAILED' ? 'Failed' : '';

  const alertTooltip = alertCount > 0
    ? `${alertCount} active alert${alertCount > 1 ? 's' : ''}`
    : '';

  const RunnerIcon = runnerState === 'TRADING' 
    ? (positionSide === 'SHORT' ? TrendingDown : TrendingUp)
    : runnerState === 'SIGNAL' ? Zap 
    : runnerState === 'MAINTENANCE' ? Moon
    : Search;
  
  // Compute elapsed time for running jobs
  const btElapsed = backtestsRunning > 0 && backtestStartedAt 
    ? formatCompactDuration(new Date(backtestStartedAt)) 
    : null;
  const evElapsed = evolvingRunning > 0 && evolveStartedAt 
    ? formatCompactDuration(new Date(evolveStartedAt)) 
    : null;
  const imElapsed = improvingRunning > 0 && improveStartedAt 
    ? formatCompactDuration(new Date(improveStartedAt)) 
    : null;
  
  // Count display priority:
  // 1. Running: show current iteration/attempt from activeJob props
  // 2. Queued: show queue count
  // 3. Recently completed: show recentJob.totalCompleted
  const btCount = backtestsRunning > 0 ? (jobAttempt && jobAttempt > 1 ? jobAttempt : undefined)
    : backtestsQueued > 0 ? backtestsQueued 
    : hasRecentBacktest ? (recentJob?.totalCompleted || undefined) : undefined;
  const evCount = evolvingQueued > 0 ? evolvingQueued : undefined;
  const imCount = improvingRunning > 0 ? improvementIteration
    : improvingQueued > 0 ? improvingQueued 
    : hasRecentImproving ? (recentJob?.totalCompleted || improvementIteration) : undefined;

  // Grid layout configuration - easily reorder by changing these arrays
  // Each position maps to a slot type
  // Last 4 columns: LLM, ALERTS, COST, SOURCES (shared across all stages)
  // Trade count badge now lives on the NET PNL slot
  const gridLayout = isPaperPlus ? {
    // PAPER+ layout: Matches TRIALS structure - Row 1 = metrics + improve/evolve + LLM/ALERTS, Row 2 = metrics + matrix/wallet + COST/SOURCES
    row1: ['NET', 'LIVE', 'PF', 'MAXDD', 'EMPTY', 'IMPROVE', 'EVOLVE', 'LLM', 'ALERTS', 'EMPTY'],
    row2: ['EXPECTANCY', 'RUNNER', 'SHARPE', 'WIN', 'EMPTY', 'MATRIX', 'WALLET', 'COST', 'SOURCES', 'EMPTY'],
  } : {
    // TRIALS layout: Row 1 = metrics shifted left + improve/evolve + LLM/ALERTS, Row 2 = metrics shifted left + matrix/backtest + COST/SOURCES
    row1: ['NET', 'PF', 'MAXDD', 'EMPTY', 'EMPTY', 'IMPROVE', 'EVOLVE', 'LLM', 'ALERTS', 'EMPTY'],
    row2: ['EXPECTANCY', 'SHARPE', 'WIN', 'EMPTY', 'EMPTY', 'MATRIX', 'BACKTEST', 'COST', 'SOURCES', 'EMPTY'],
  };

  // Render slot with unique key
  const renderSlotWithKey = (slotType: string, idx: number, row: number) => {
    const key = `${row}-${idx}-${slotType}`;
    switch (slotType) {
      case 'NET':
        return <PnlSlot key={key} label="NET" value={netPnl ?? null} tooltip={netPnl != null ? "Cumulative realized P&L" : "No trades yet"} trades={trades} lastTradeAt={lastTradeAt} onTradesClick={onTradesClick} stage={stage} />;
      case 'LIVE':
        return <PnlSlot key={key} label="LIVE" value={livePnl ?? null} tooltip={livePnl != null ? "Unrealized P&L from open position" : "No open position"} displayAllowed={displayAllowed} dataSource={dataSource} isMaintenanceWindow={isMaintenanceWindow} />;
      case 'PF':
        return <MetricSlot key={key} label="PF" value={profitFactor} format="profitFactor" tooltip="Profit Factor: Gross profit / Gross loss ratio. Above 1.5 is excellent." />;
      case 'MAXDD':
        return <MetricSlot key={key} label="MAX DD" value={maxDrawdownPct} format="maxDrawdown" tooltip="Maximum peak-to-trough decline. Lower is safer." />;
      case 'EXPECTANCY':
        return <MetricSlot key={key} label="EXP" value={expectancy} format="expectancy" tooltip="Expected profit/loss per trade. Higher is better." />;
      case 'RUNNER':
        if (computedIsAccountBlown) {
          return <ActivitySlot key={key} icon={Ban} isActive={true} isRunning={false} tooltip="Trading blocked - account blown. Reset account to resume." activeColor="text-red-400 bg-red-500/20" label="Blocked" />;
        }
        // MAINTENANCE: Daily 5-6 PM ET break - show "Paused" with Moon icon
        if (runnerState === 'MAINTENANCE') {
          return <ActivitySlot key={key} icon={Moon} isActive={true} isRunning={false} tooltip="Paused for daily maintenance (5-6 PM ET)" activeColor="text-amber-400 bg-amber-500/20" label="Paused" />;
        }
        // CLOSED: Full market closure (weekend/holiday) - show "Closed" 
        return isSleeping || sessionState === 'CLOSED' || runnerState === 'MARKET_CLOSED' ? (
          <ActivitySlot key={key} icon={Moon} isActive={true} isRunning={false} tooltip="CME futures market closed. Sleeping until next market open." activeColor="text-indigo-400 bg-indigo-500/20" label="Closed" />
        ) : (
          <ActivitySlot key={key} icon={RunnerIcon} isActive={hasRunnerActivity} isRunning={runnerState === 'TRADING' || runnerState === 'SIGNAL' || runnerState === 'SCANNING' || runnerState === 'DATA_FROZEN'} tooltip={runnerTooltip} count={runnerState === 'TRADING' && positionQuantity ? positionQuantity : undefined} activeColor={runnerState === 'TRADING' ? (positionSide === 'SHORT' ? "text-red-400 bg-red-500/20" : "text-green-400 bg-green-500/20") : runnerState === 'SIGNAL' ? "text-yellow-400 bg-yellow-500/20" : runnerState === 'SCANNING' ? "text-cyan-400 bg-cyan-500/20" : runnerState === 'DATA_FROZEN' ? "text-cyan-400 bg-cyan-500/20" : runnerState === 'STARTING' ? "text-orange-400 bg-orange-500/20" : "text-muted-foreground bg-muted/30"} label={runnerState === 'TRADING' ? (positionSide === 'SHORT' ? "Short" : "Long") : runnerState === 'SIGNAL' ? "Signal" : runnerState === 'SCANNING' ? "Scan" : runnerState === 'DATA_FROZEN' ? "Awaiting" : runnerState === 'STARTING' ? "Start" : "Runner"} duration={runnerState === 'TRADING' ? positionElapsedStr : runnerState === 'SCANNING' ? scanningSinceStr : null} clickable={runnerState === 'TRADING'} onClick={() => setTradeIdeaOpen(true)} />
        );
      case 'SHARPE':
        return <MetricSlot key={key} label="SHARPE" value={sharpe} format="sharpe" tooltip="Risk-adjusted return ratio. Higher is better." tradeCount={trades} />;
      case 'WIN':
        return <MetricSlot key={key} label="WIN%" value={winRate} format="winRate" tooltip="Percentage of winning trades. Higher is better." />;
      case 'IMPROVE': {
        const imIsCompleted = !improvingRunning && !improvingQueued && hasRecentImproving && recentJob?.status === 'COMPLETED';
        return <ActivitySlot key={key} icon={Wrench} isActive={hasImproving} isRunning={improvingRunning > 0} isQueued={improvingQueued > 0 && improvingRunning === 0} count={imCount} tooltip={imTooltip || 'Not running'} activeColor="text-blue-400 bg-blue-500/20" label="Improve" duration={imElapsed} clickable={imIsCompleted} onClick={() => setImprovementDrawerOpen(true)} />;
      }
      case 'EVOLVE':
        return <ActivitySlot key={key} icon={Dna} isActive={hasEvolving} isRunning={evolvingRunning > 0} count={evCount} tooltip={evTooltip || 'Not running'} activeColor="text-fuchsia-400 bg-fuchsia-500/20" label="Evolve" duration={evElapsed} />;
      case 'MATRIX':
        return <MatrixDropdown key={key} botId={botId} status={matrixStatus} progress={matrixProgress} timeframes={matrixTimeframes || []} completedCells={matrixCompletedCells} totalCells={matrixTotalCells} currentTimeframe={matrixCurrentTimeframe} aggregate={matrixAggregate ?? undefined} botTimeframe={botTimeframe} />;
      case 'BACKTEST': {
        // Keep purple styling and add small checkmark overlay when completed
        const btIsCompleted = !backtestsRunning && !backtestsQueued && hasRecentBacktest && recentJob?.status === 'COMPLETED';
        return <ActivitySlot key={key} icon={BarChart2} isActive={hasBacktesting} isRunning={backtestsRunning > 0} isQueued={backtestsQueued > 0 && backtestsRunning === 0} isCompleted={btIsCompleted} count={btCount} tooltip={btTooltip || 'Not running'} activeColor="text-purple-400 bg-purple-500/20" label="Backtest" duration={btElapsed} />;
      }
      case 'WALLET':
        return <WalletSlot key={key} botId={botId} stage={stage} accountId={accountId} accountName={accountName} accountType={accountType} isLocked={isAccountLocked} lockReason={accountLockReason} totalBlownCount={accountTotalBlownCount} botNetPnl={netPnl} />;
      case 'ALERTS':
        return <AlertsDropdown key={key} botId={botId} botName={botName} stage={stage} generationNumber={generationNumber} winRate={winRate} profitFactor={profitFactor} maxDrawdownPct={maxDrawdownPct} sharpe={sharpe} trades={trades} alertCount={alertCount} peakGeneration={peakGeneration} peakSharpe={peakSharpe} isRevertCandidate={isRevertCandidate} declineFromPeakPct={declineFromPeakPct} trendDirection={trendDirection} />;
      case 'LLM':
        return (
          <div key={key} className="w-[64px] h-6 flex items-center justify-center">
            <LLMProviderBadge botId={botId} botName={botName} strategyConfig={strategyConfig} compact />
          </div>
        );
      case 'COST':
        return (
          <div key={key} className="w-[64px] h-6 flex items-center justify-center">
            <BotCostBadge botId={botId} compact llmCostData={llmCostData} />
          </div>
        );
      case 'SOURCES':
        return (
          <button
            key={key}
            className="w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border bg-muted/20 border-muted-foreground/30 cursor-pointer hover:bg-muted/40 transition-all"
            data-testid="metric-box-sources"
            onClick={onSourcesClick}
          >
            <span className="text-[9px] uppercase leading-none opacity-70 text-muted-foreground">SOURCES</span>
            <SignalSourcesBadge botId={botId} symbol={symbol || "MES"} strategyConfig={strategyConfig || {}} compact />
          </button>
        );
      case 'EMPTY':
      default:
        // Structural placeholder - maintains 64px width in grid but renders nothing visible
        return <div key={key} className="w-[64px] h-6 pointer-events-none" aria-hidden="true" />;
    }
  };

  // Show stale metrics warning when displaying prior generation data
  const isStaleMetrics = metricsStatus === 'PRIOR_GENERATION';
  
  return (
    <div 
      className={cn("flex-shrink-0 relative flex items-center gap-2", className)}
      data-testid="activity-grid"
    >
      {/* Stale metrics indicator */}
      {isStaleMetrics && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="absolute -top-1 -left-1 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded-sm bg-amber-500/20 border border-amber-500/40 text-amber-500"
              data-testid="stale-metrics-indicator"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              <span className="text-[8px] font-medium uppercase">Stale</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs">Metrics from prior generation. Run a backtest to update.</p>
          </TooltipContent>
        </Tooltip>
      )}
      
      {/* Unified 2x10 grid for all stages */}
      <div className={cn("grid grid-cols-10 gap-1", isStaleMetrics && "opacity-60")}>
        {/* Row 1 */}
        {gridLayout.row1.map((slotType, idx) => renderSlotWithKey(slotType, idx, 1))}
        {/* Row 2 */}
        {gridLayout.row2.map((slotType, idx) => renderSlotWithKey(slotType, idx, 2))}
      </div>
      
      {/* Instrument Selector moved to BotTableRow inline with progress dots */}
      
      {openPosition && (
        <TradeIdeaDrawer
          open={tradeIdeaOpen}
          onOpenChange={setTradeIdeaOpen}
          botName={botName}
          stage={stage}
          position={openPosition}
        />
      )}
      
      <ImprovementDetailsDrawer
        open={improvementDrawerOpen}
        onOpenChange={setImprovementDrawerOpen}
        botId={botId}
        botName={botName}
        generationNumber={generationNumber}
      />
    </div>
  );
}
