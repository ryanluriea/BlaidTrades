import { useState, useMemo, useRef, useEffect } from "react";
import { 
  MoreVertical, 
  Play, 
  Pause, 
  Settings, 
  Trash2, 
  ChevronDown, 
  ChevronRight, 
  AlertCircle, 
  CheckCircle, 
  AlertTriangle,
  Pin,
  Clock,
  Activity,
  Check,
  Wrench,
  Dna,
  BarChart2,
  Shield,
  BadgeCheck,
  XCircle
} from "lucide-react";
import { FlashValue } from "@/components/ui/flash-value";
import { useServerClock } from "@/contexts/ServerClockContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { BotDetailDropdown } from "./BotDetailDropdown";
import { BotNameWithTooltip } from "./BotNameWithTooltip";
import { InlineSymbolEdit } from "./InlineSymbolEdit";
import { InlineStageEdit } from "./InlineStageEdit";
// InlineAccountEdit removed - account selection now in ActivityGrid for PAPER+ stages
import { PriorityBadge } from "./PriorityBadge";
import { ActivityBadges } from "./ActivityBadges";
import { ActivityGrid, WalletSlot } from "./ActivityGrid";
import { MatrixDropdown } from "./MatrixDropdown";
import { ImprovementBadge } from "./ImprovementBadge";
import { DemotionRecoveryBadge } from "./DemotionRecoveryBadge";
import { WhyNotRunningDrawer } from "./WhyNotRunningDrawer";
import { KillStateBadge } from "./KillStateBadge";
import { WhyNotTradingExplainer } from "./WhyNotTradingExplainer";
import { PromotionProgressBar } from "./PromotionProgressBar";
import { PerformancePromotionBadges } from "./PerformancePromotionBadges";
import { BotSettingsModal } from "./BotSettingsModal";
import { MetricWithTarget } from "./MetricWithTarget";
import { GenerationBadge } from "./GenerationBadge";
import { AccountBadge } from "./AccountBadge";
import { CandidateBadge } from "./CandidateBadge";
import { BacktestStatusBadge, type BacktestStatus } from "./BacktestStatusBadge";
import { QCBadge, type QCBadgeState } from "./QCBadge";
import { QCProofPopup } from "./QCProofPopup";
import { InlineAiProviderBadge } from "./InlineAiProviderBadge";
import { InlineEliteBadge } from "./InlineEliteBadge";
import { useQCVerifications, getCandidateQCBadgeInfo } from "@/hooks/useQCVerification";
import { ExecutionProofStrip } from "./ExecutionProofStrip";
import { StrategyTypeBadge } from "./StrategyTypeBadge";
import { DataSourceBadge } from "./DataSourceBadge";
import { BotCostBadge } from "./BotCostBadge";
import { LLMProviderBadge } from "./LLMProviderBadge";
import { SignalSourcesBadge } from "./SignalSourcesBadge";
import { PerBotSourcesDialog, getBotSignalSources } from "./PerBotSourcesDialog";
import { AlertsDropdown } from "./AlertsDropdown";
import { BotConfidenceScore } from "./BotConfidenceScore";
import type { JobsSummary } from "./JobsBadge";
import type { ImprovementState } from "@/hooks/useImprovementState";
import type { DemotionEvent } from "@/hooks/useBotDemotions";
import type { CandidateEval } from "@/hooks/useCandidateEval";
import type { ExecutionProof } from "@/hooks/useExecutionProof";
import { useRestartRunner } from "@/hooks/useRunnerControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Bot } from "@/hooks/useBots";
import type { BotMetrics, BotEnrichedData } from "@/hooks/useBotsMetrics";
import type { RunnerInstance } from "@/hooks/useBotRunnerAndJobs";
import { cn } from "@/lib/utils";
import { computeBotHealth, getHealthDisplay } from "@/lib/botHealth";
import { computeGraduationStatus, type BotMetricsInput } from "@/lib/graduationGates";
import { getStageBorderLeftColor } from "@/lib/stageConfig";
import type { PriorityBucket } from "@/lib/priorityScore";
import { useLivePnLContext, useStabilizedLivePnL, useBotHeartbeat } from "@/contexts/LivePnLContext";
import { useSymbolPreference } from "@/hooks/useSymbolPreference";

// MetricGridBox - Grid box styled metric display matching ActivityGrid PnlSlot pattern
// Uses same dimensions (w-[64px] h-6) as PnlSlot for institutional density
interface MetricGridBoxProps {
  label: string;
  value: string;
  colorClass: string;
  tooltip: string;
  onClick?: () => void;
}

function MetricGridBox({ label, value, colorClass, tooltip, onClick }: MetricGridBoxProps) {
  const hasValue = value !== '-' && value !== '—';
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "w-[64px] h-6 flex flex-col items-center justify-center rounded-sm border transition-all",
            hasValue
              ? `${colorClass} border-current/30`
              : "opacity-40 text-muted-foreground border-muted-foreground/30",
            onClick && "cursor-pointer hover-elevate"
          )}
          onClick={onClick}
          data-testid={`metric-box-${label.toLowerCase().replace(/[%\s]+/g, '-')}`}
        >
          <span className="text-[9px] uppercase leading-none opacity-70">{label}</span>
          <span className="text-[11px] font-mono font-semibold leading-none">{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[200px]">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">{tooltip}</div>
      </TooltipContent>
    </Tooltip>
  );
}

// Inline QC Verification Checkmark - Social Media Style Badge
interface InlineQCCheckmarkProps {
  state?: QCBadgeState;
  onClick?: () => void;
}

function InlineQCCheckmark({ state, onClick }: InlineQCCheckmarkProps) {
  if (!state || state === "NONE") return null;
  
  const isPassed = state === "QC_PASSED" || state === "VERIFIED";
  const isFailed = state === "QC_FAILED" || state === "DIVERGENT" || state === "FAILED";
  const isInconclusive = state === "QC_INCONCLUSIVE" || state === "INCONCLUSIVE";
  const isPending = state === "QUEUED" || state === "RUNNING";
  
  let Icon = Shield;
  let bgColor = "bg-muted";
  let tooltipTitle = "QC Status";
  let tooltipDesc = "";
  
  if (isPassed) {
    Icon = BadgeCheck;
    bgColor = "bg-emerald-500";
    tooltipTitle = "QC Verified";
    tooltipDesc = "Passed QuantConnect LEAN verification";
  } else if (isFailed) {
    Icon = XCircle;
    bgColor = "bg-red-500/80";
    tooltipTitle = "QC Failed";
    tooltipDesc = "Did not meet QC verification thresholds";
  } else if (isInconclusive) {
    Icon = Shield;
    bgColor = "bg-yellow-500/80";
    tooltipTitle = "QC Inconclusive";
    tooltipDesc = "Verification results inconclusive";
  } else if (isPending) {
    Icon = Clock;
    bgColor = "bg-blue-500/80";
    tooltipTitle = state === "RUNNING" ? "QC Running" : "QC Queued";
    tooltipDesc = "QuantConnect verification in progress";
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0 cursor-pointer",
            bgColor,
            isPending && "animate-pulse"
          )}
          onClick={(e) => { e.stopPropagation(); onClick?.(); }}
          data-testid={`badge-qc-inline-${state.toLowerCase()}`}
        >
          <Icon className="h-2.5 w-2.5 text-white" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className={cn(
          "font-medium",
          isPassed && "text-emerald-400",
          isFailed && "text-red-400",
          isInconclusive && "text-yellow-400",
          isPending && "text-blue-400"
        )}>{tooltipTitle}</p>
        <p className="text-muted-foreground">{tooltipDesc}</p>
        {onClick && <p className="text-[9px] text-blue-400/80 italic mt-0.5">Click for details</p>}
      </TooltipContent>
    </Tooltip>
  );
}

// Get color class for metric value based on thresholds
// Handles negative values and extreme inputs defensively
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
    case 'trades':
      // More is better for evidence
      if (value < 0) return "text-muted-foreground bg-muted/20"; // Invalid
      if (value >= 60) return "text-green-400 bg-green-500/20";
      if (value >= 20) return "text-amber-400 bg-amber-500/20";
      return "text-muted-foreground bg-muted/20";
    case 'profitFactor':
      // Higher is better (gross profit / gross loss ratio)
      if (value <= 0) return "text-muted-foreground bg-muted/20"; // Invalid
      if (value >= 1.5) return "text-green-400 bg-green-500/20";
      if (value >= 1.0) return "text-amber-400 bg-amber-500/20";
      return "text-red-400 bg-red-500/20";
    default:
      return "text-muted-foreground bg-muted/20";
  }
}

// Format metric value for display
function formatMetricValue(type: string, value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return '-';
  
  switch (type) {
    case 'maxDrawdown':
      const absDD = Math.abs(value);
      if (absDD === 0 || absDD > 100) return '-';
      // Display in dollars assuming $10,000 initial capital
      const dollarAmount = (absDD / 100) * 10000;
      return `-$${dollarAmount.toFixed(0)}`;
    case 'sharpe':
      if (value === 0 || value < -5 || value > 5) return '-';
      return value.toFixed(2);
    case 'winRate':
      if (value < 0 || value > 100) return '-';
      return `${value.toFixed(0)}%`;
    case 'trades':
      if (value < 0) return '-';
      return `${Math.floor(value)}`;
    case 'profitFactor':
      if (value <= 0) return '-';
      return value.toFixed(2);
    default:
      return String(value);
  }
}

// Format relative time using server-adjusted clock (e.g., "5s ago", "2m ago", "1h ago")
// CRITICAL: Clamped to prevent negative elapsed times (clock skew protection)
function formatRelativeTime(dateStr?: string, serverNow?: number): string {
  if (!dateStr) return "";
  const now = serverNow ?? Date.now();
  const rawDiffMs = now - new Date(dateStr).getTime();
  // Clamp to 0 to prevent negative elapsed times
  const seconds = Math.max(0, Math.floor(rawDiffMs / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Check if we're nearing session end (within 15 minutes of 4:00 PM ET)
// Used to show crescent moon indicator for PAPER+ bots
function isNearingSessionEnd(timestamp?: number): boolean {
  // Guard: require valid timestamp after year 2020 (Unix 1577836800000)
  if (!timestamp || timestamp < 1577836800000) return false;
  
  // Convert to ET timezone
  const date = new Date(timestamp);
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
  });
  const parts = etFormatter.formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  
  // Only show on trading days (Mon-Fri)
  const tradingDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  if (!tradingDays.includes(weekday)) return false;
  
  // Session ends at 16:00 (4 PM) ET
  // Check if we're between 15:45 and 16:00
  const currentMinutes = hour * 60 + minute;
  const sessionEndMinutes = 16 * 60; // 4:00 PM
  const minutesUntilEnd = sessionEndMinutes - currentMinutes;
  
  return minutesUntilEnd > 0 && minutesUntilEnd <= 15;
}

interface BotTableRowProps {
  bot: Bot;
  stage: string;
  symbol: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  metrics?: BotMetrics;
  enrichedData?: BotEnrichedData;
  visibleColumns: string[];
  onDelete: () => void;
  priorityScore?: number | null;
  priorityBucket?: PriorityBucket | null;
  priorityComputedAt?: string | null;
  runner?: RunnerInstance | null;
  jobs?: JobsSummary;
  /** Prevent "optimistic" OK/Scanning rendering before runner+jobs are loaded (avoids reload flicker) */
  runnerJobsLoading?: boolean;
  improvementState?: ImprovementState | null;
  latestDemotion?: DemotionEvent | null;
  candidateEval?: CandidateEval | null;
  /** Matrix backtest aggregate data */
  matrixAggregate?: any | null;
  matrixBestCell?: any | null;
  matrixWorstCell?: any | null;
  lastMatrixCompletedAt?: string | null;
  /** Pinning */
  isPinned?: boolean;
  onTogglePin?: () => void;
  /** Recently updated (for pulse animation) */
  isRecentlyUpdated?: boolean;
  /** Last updated timestamp */
  updatedAt?: string;
  /** Execution proof data for PAPER/SHADOW/LIVE bots */
  executionProof?: ExecutionProof;
  /** Execution proof degraded state */
  executionProofDegraded?: boolean;
  /** Backtest freshness data (industry-standard) */
  backtestStatus?: BacktestStatus;
  sessionCompletedAt?: string | null;
  sessionAgeSeconds?: number | null;
  lastFailedAt?: string | null;
  lastFailedReason?: string | null;
  failedSinceLastSuccess?: number;
  /** Strategy type for identity display */
  strategyType?: string | null;
  /** Last backtest data source: 'DATABENTO_REAL' | 'SIMULATED_FALLBACK' | null */
  lastDataSource?: string | null;
  /** TRIALS idle info for display */
  labIdleInfo?: {
    idleReasonCode: string | null;
    nextRunMinutes: number | null;
    lastJobAt: string | null;
  } | null;
  /** Idle reason visibility */
  idleReason?: string | null;
  queuedJobType?: string | null;
  hasRunningJob?: boolean;
  /** INSTITUTIONAL FRESHNESS CONTRACT: Controls P&L display validity
   * If false, live P&L must be masked with "Awaiting mark" to prevent stale data display */
  displayAllowed?: boolean;
  /** Data source for mark prices: 'live' | 'cache' | 'none' */
  dataSource?: 'live' | 'cache' | 'none';
  /** If true, show maintenance-specific messaging instead of generic "Awaiting" */
  isMaintenanceWindow?: boolean;
}

export function BotTableRow({
  bot,
  stage,
  symbol,
  isExpanded,
  onToggleExpanded,
  metrics,
  enrichedData,
  visibleColumns,
  onDelete,
  priorityScore,
  priorityBucket,
  priorityComputedAt,
  runner = null,
  jobs = { backtestsRunning: 0, backtestsQueued: 0, evaluating: false, training: false, evolvingRunning: 0, evolvingQueued: 0, improvingRunning: 0, improvingQueued: 0, backtestStartedAt: null, evolveStartedAt: null, improveStartedAt: null },
  runnerJobsLoading = false,
  improvementState = null,
  latestDemotion = null,
  candidateEval = null,
  matrixAggregate = null,
  matrixBestCell = null,
  matrixWorstCell = null,
  lastMatrixCompletedAt = null,
  isPinned = false,
  onTogglePin,
  isRecentlyUpdated = false,
  updatedAt,
  executionProof,
  executionProofDegraded = false,
  backtestStatus,
  sessionCompletedAt,
  sessionAgeSeconds,
  lastFailedAt,
  lastFailedReason,
  failedSinceLastSuccess,
  strategyType,
  lastDataSource,
  labIdleInfo,
  idleReason,
  queuedJobType,
  hasRunningJob,
  displayAllowed,
  dataSource,
  isMaintenanceWindow = false,
}: BotTableRowProps) {
  const restartRunner = useRestartRunner();
  const { serverNow } = useServerClock();
  const { filteredSymbols } = useSymbolPreference();
  
  // Get real-time heartbeat from WebSocket (updates every ~30s)
  const wsHeartbeat = useBotHeartbeat(bot.id);

  // Derive activity state from runner instance
  const activityState = runner?.activityState || "IDLE";
  
  // Use DB health as source of truth if available, otherwise compute
  // DB fields: health_state, health_reason_code, health_reason_detail
  const dbHealthState = (bot as any).health_state as "OK" | "WARN" | "DEGRADED" | null;
  const dbHealthReasonCode = (bot as any).health_reason_code as string | null;
  const dbHealthReasonDetail = (bot as any).health_reason_detail as string | null;
  const dbHealthDegradedSince = (bot as any).health_degraded_since as string | null;
  
  // Compute health as fallback or for real-time updates
  // Prefer WebSocket heartbeat (real-time, ~30s updates) over REST data (stale from page load)
  const effectiveHeartbeat = wsHeartbeat?.lastHeartbeatAt || runner?.lastHeartbeat || enrichedData?.lastHeartbeat || null;
  const computedHealth = computeBotHealth({
    activityState,
    lastHeartbeat: effectiveHeartbeat,
    stallReason: null,
    instanceStatus: runner?.status || bot.status,
    mode: runner?.mode || enrichedData?.mode || bot.mode,
    recentErrorCount: 0,
    hasRiskViolation: false,
    executionBlocked: false,
  });
  
  // Prefer DB health state, fall back to computed if DB says OK but computed says worse
  // This handles the case where DB hasn't been updated yet
  const health = {
    status: dbHealthState || computedHealth.status,
    reason: dbHealthReasonDetail || computedHealth.reason,
    reasons: computedHealth.reasons,
  };
  
  // If computed health is worse than DB, use computed (DB may be stale)
  if (computedHealth.status === "DEGRADED" && dbHealthState !== "DEGRADED") {
    health.status = computedHealth.status;
    health.reason = computedHealth.reason;
  }
  
  const healthDisplay = getHealthDisplay(health.status);
  
  // Build gate metrics from stageMetrics - unified source with correct generation filtering
  // CRITICAL: All metrics flow through stageMetrics to prevent cross-generation data leakage
  const gateMetrics: BotMetricsInput = {
    totalTrades: metrics?.stageMetrics?.trades ?? 0,
    winRate: metrics?.stageMetrics?.winRate ?? null,
    profitFactor: metrics?.stageMetrics?.profitFactor ?? null,
    maxDrawdownPct: metrics?.stageMetrics?.maxDrawdownPct ?? null,
    expectancy: metrics?.stageMetrics?.expectancy ?? null,
    sharpe: metrics?.stageMetrics?.sharpe ?? null,
    pnl: metrics?.stageMetrics?.pnl ?? 0,
  };

  const graduationStatus = computeGraduationStatus(gateMetrics);

  // Format identity components
  const genDisplay = enrichedData?.generationNumber ? `G${enrichedData.generationNumber}` : "G1";
  
  // Check if editing is locked (LIVE trading)
  const isLiveTrading = runner?.mode === "LIVE" && activityState === "TRADING";
  const editLockReason = isLiveTrading 
    ? "Cannot edit while LIVE trading" 
    : health.status === "DEGRADED" 
      ? "Bot is degraded - fix issues first"
      : undefined;
  const isEditLocked = isLiveTrading || health.status === "DEGRADED";

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [whyNotTradingOpen, setWhyNotTradingOpen] = useState(false);
  const [qcProofOpen, setQcProofOpen] = useState(false);
  
  // QC Verification status for bots created from strategy candidates
  // Note: sourceCandidateId may exist in DB but not in TS type - access via bracket notation
  const sourceCandidateId = (bot as Record<string, unknown>)['sourceCandidateId'] as string | undefined;
  const { data: qcVerifications } = useQCVerifications(sourceCandidateId);
  const qcBadgeInfo = sourceCandidateId 
    ? getCandidateQCBadgeInfo(qcVerifications, sourceCandidateId)
    : null;
  
  // Determine if bot is actually trading
  const isActivelyTrading = activityState === 'TRADING' || runner?.activityState === 'TRADING';

  // REAL-TIME WEBSOCKET: Use shared context for live P&L updates (single WebSocket for all rows)
  const { updates: livePnLUpdates, subscribe: subscribeLivePnL, unsubscribe: unsubscribeLivePnL, isConnected: wsConnected, isReconnecting } = useLivePnLContext();
  const livePnLUpdate = livePnLUpdates.get(bot.id);
  
  // Subscribe to WebSocket updates when bot has an open position
  // CRITICAL FIX: Do NOT gate on wsConnected - subscribe immediately and let context queue
  // This prevents unsubscribing during reconnects which causes stale REST to briefly show
  useEffect(() => {
    if (isActivelyTrading) {
      subscribeLivePnL([bot.id]);
      return () => unsubscribeLivePnL([bot.id]);
    }
  }, [bot.id, isActivelyTrading, subscribeLivePnL, unsubscribeLivePnL]);

  // POSITION STABILIZATION: Prevent flashing by remembering last valid position
  // Only clear position when we have explicit confirmation of no position (quantity=0 or no data for 30s)
  const lastValidPositionRef = useRef<{
    side: 'LONG' | 'SHORT' | null;
    quantity: number | null;
    entryPrice: number | null;
    currentPrice: number | null;
    stopPrice: number | null;
    targetPrice: number | null;
    unrealizedPnl: number | null;
    entryReasonCode: string | null;
    openedAt: string | null;
    timestamp: number;
  } | null>(null);

  // Compute stabilized position data with REAL-TIME WebSocket as AUTHORITATIVE source
  // CRITICAL FIX: WebSocket data is ALWAYS authoritative for P&L while position is open
  // This prevents stale REST data from overwriting accurate real-time WebSocket values
  const stabilizedPosition = useMemo(() => {
    const openPos = executionProof?.open_position;
    const wsData = livePnLUpdate;
    const now = Date.now();
    
    // CRITICAL FIX: Extend freshness window during reconnects (30s vs 5s)
    // During reconnects, we trust cached WebSocket data over stale REST data from database
    // Once reconnected, fresh WebSocket updates will resume within 100ms
    const freshnessWindow = isReconnecting ? 30000 : 5000;
    const wsIsFresh = wsData && (now - wsData.timestamp) < freshnessWindow;
    
    // CASE 1: REST explicitly confirms no position (quantity=0) - HIGHEST PRIORITY
    // This must come first to prevent showing phantom positions after close
    if (openPos && openPos.quantity === 0) {
      lastValidPositionRef.current = null;
      return null;
    }
    
    // CASE 2: We have valid REST position data with quantity > 0
    if (openPos && openPos.quantity > 0) {
      const side = openPos.side === 'BUY' ? 'LONG' as const : openPos.side === 'SELL' ? 'SHORT' as const : null;
      
      // AUTHORITATIVE: WebSocket is ALWAYS preferred for P&L and price if available
      // REST data is only used for fields WebSocket doesn't provide (stops, targets, etc.)
      lastValidPositionRef.current = {
        side: wsIsFresh ? wsData.side : side,
        quantity: openPos.quantity,
        entryPrice: wsIsFresh ? wsData.entryPrice : (openPos.average_entry_price ?? null),
        currentPrice: wsIsFresh ? wsData.currentPrice : (openPos.current_price ?? null),
        stopPrice: openPos.stop_price ?? null,
        targetPrice: openPos.target_price ?? null,
        // CRITICAL: ALWAYS use WebSocket P&L if fresh - never let stale REST overwrite
        unrealizedPnl: wsIsFresh ? wsData.unrealizedPnl : (openPos.unrealized_pnl ?? null),
        entryReasonCode: openPos.entry_reason_code ?? null,
        openedAt: openPos.opened_at ?? null,
        timestamp: now,
      };
      return lastValidPositionRef.current;
    }
    
    // CASE 3: REST data is temporarily missing (refetch in progress) but WebSocket is active
    // CRITICAL FIX: Trust WebSocket as authoritative during REST gaps - don't flash to "no position"
    // BUT only if we have a cached position (prevents showing position from nothing)
    if (wsIsFresh && lastValidPositionRef.current) {
      // WebSocket is still sending P&L updates - position is definitely still open
      // Keep the cached position data but update P&L from WebSocket
      return {
        ...lastValidPositionRef.current,
        side: wsData.side,
        currentPrice: wsData.currentPrice,
        entryPrice: wsData.entryPrice,
        unrealizedPnl: wsData.unrealizedPnl,
        timestamp: now,
      };
    }
    
    // CASE 4: No REST data, no fresh WebSocket, but we have cached position within grace period
    // Prevent UI flashing during REST query refetches
    if (lastValidPositionRef.current && (now - lastValidPositionRef.current.timestamp) < 10000) {
      return lastValidPositionRef.current;
    }
    
    // CASE 5: Data is stale (>10s with no updates), clear position
    lastValidPositionRef.current = null;
    return null;
  }, [executionProof?.open_position, livePnLUpdate, isReconnecting]);

  // SESSION STATE STABILIZATION: Prevent sleep/session indicator flickering during refetches
  // Cache last known session state to show during REST query gaps
  const lastSessionStateRef = useRef<{
    sessionState: 'CLOSED' | 'OPEN' | null;
    isSleeping: boolean;
    timestamp: number;
  } | null>(null);

  const stabilizedSession = useMemo(() => {
    const now = Date.now();
    const currentSessionState = executionProof?.session_state ?? null;
    const currentIsSleeping = executionProof?.is_sleeping ?? false;
    
    // If we have fresh data from executionProof, update cache and return it
    if (executionProof !== undefined) {
      lastSessionStateRef.current = {
        sessionState: currentSessionState as 'CLOSED' | 'OPEN' | null,
        isSleeping: currentIsSleeping,
        timestamp: now,
      };
      return lastSessionStateRef.current;
    }
    
    // REST data temporarily missing - use cached value within 10s grace period
    // Extend to 30s during WebSocket reconnects (more tolerant of REST gaps)
    const graceWindow = isReconnecting ? 30000 : 10000;
    if (lastSessionStateRef.current && (now - lastSessionStateRef.current.timestamp) < graceWindow) {
      return lastSessionStateRef.current;
    }
    
    // No cached data or stale - return defaults
    return {
      sessionState: null as 'CLOSED' | 'OPEN' | null,
      isSleeping: false,
      timestamp: now,
    };
  }, [executionProof, isReconnecting]);

  // RUNNER STATE STABILIZATION: Prevent runner badge flickering during REST refetches
  // Cache last known runner activity state with fields needed for ActivityGrid
  const lastRunnerStateRef = useRef<{
    activityState: 'TRADING' | 'SCANNING' | 'SIGNAL' | 'STARTING' | 'MAINTENANCE' | null;
    scanningSince: string | null;
    hasRunner: boolean;
    warmingUp: boolean;
    lastSignalAt: string | null;
    timestamp: number;
  } | null>(null);

  const stabilizedRunnerState = useMemo(() => {
    const now = Date.now();
    
    // If we have fresh executionProof data, update cache
    if (executionProof !== undefined) {
      lastRunnerStateRef.current = {
        activityState: executionProof.activity_state as 'TRADING' | 'SCANNING' | 'SIGNAL' | 'STARTING' | 'MAINTENANCE' | null,
        scanningSince: executionProof.scanning_since ?? null,
        hasRunner: executionProof.has_runner ?? false,
        warmingUp: executionProof.warming_up ?? false,
        lastSignalAt: executionProof.last_signal_at ?? null,
        timestamp: now,
      };
      return lastRunnerStateRef.current;
    }
    
    // REST data temporarily missing - use cached value within grace period
    const graceWindow = isReconnecting ? 30000 : 10000;
    if (lastRunnerStateRef.current && (now - lastRunnerStateRef.current.timestamp) < graceWindow) {
      return lastRunnerStateRef.current;
    }
    
    // No cached data or stale - return defaults
    return {
      activityState: null as 'TRADING' | 'SCANNING' | 'SIGNAL' | 'STARTING' | 'MAINTENANCE' | null,
      scanningSince: null as string | null,
      hasRunner: false,
      warmingUp: false,
      lastSignalAt: null as string | null,
      timestamp: now,
    };
  }, [executionProof, isReconnecting]);

  // ENRICHED DATA STABILIZATION: Prevent ActivityGrid flickering during REST refetches
  // Cache last known enrichedData to prevent UI elements disappearing mid-refetch
  const lastEnrichedDataRef = useRef<{
    data: typeof enrichedData;
    timestamp: number;
  } | null>(null);

  const stabilizedEnrichedData = useMemo(() => {
    const now = Date.now();
    
    // If we have fresh enrichedData, update cache and return it
    if (enrichedData !== undefined && enrichedData !== null) {
      lastEnrichedDataRef.current = {
        data: enrichedData,
        timestamp: now,
      };
      return enrichedData;
    }
    
    // REST data temporarily missing - use cached value within grace period
    const graceWindow = isReconnecting ? 30000 : 10000;
    if (lastEnrichedDataRef.current && (now - lastEnrichedDataRef.current.timestamp) < graceWindow) {
      return lastEnrichedDataRef.current.data;
    }
    
    // No cached data or stale - return undefined
    return undefined;
  }, [enrichedData, isReconnecting]);

  // METRICS STABILIZATION: Prevent metrics flickering during REST refetches
  // Cache last known metrics to prevent UI elements disappearing mid-refetch
  const lastMetricsRef = useRef<{
    data: typeof metrics;
    timestamp: number;
  } | null>(null);

  const stabilizedMetrics = useMemo(() => {
    const now = Date.now();
    
    // If we have fresh metrics, update cache and return it
    if (metrics !== undefined && metrics !== null) {
      lastMetricsRef.current = {
        data: metrics,
        timestamp: now,
      };
      return metrics;
    }
    
    // REST data temporarily missing - use cached value within grace period
    const graceWindow = isReconnecting ? 30000 : 10000;
    if (lastMetricsRef.current && (now - lastMetricsRef.current.timestamp) < graceWindow) {
      return lastMetricsRef.current.data;
    }
    
    // No cached data or stale - return undefined
    return undefined;
  }, [metrics, isReconnecting]);

  // STABILIZED LIVE P&L: Use dedicated hook to prevent REST snapshots from overwriting WebSocket values
  // This prevents the -$280 → -$21.25 jump during React Query refetches
  const hasOpenPosition = Boolean(
    executionProof?.open_position?.quantity && executionProof.open_position.quantity > 0
  );
  const restUnrealizedPnl = executionProof?.open_position?.unrealized_pnl ?? null;
  // Pass accountId to reset cache when account changes (e.g., after blown account recovery)
  const stabilizedLivePnL = useStabilizedLivePnL(bot.id, restUnrealizedPnl, hasOpenPosition, stabilizedEnrichedData?.accountId);

  // CANONICAL: Use server-provided botNow ONLY - no client-side fallback
  const serverBotNow = (bot as any).botNow;
  
  // Map single canonical state to individual state fields for badge rendering
  // This maps the server's botNow.state to badge lane display states
  function mapCanonicalStateToFields(state: string | undefined) {
    if (!state) return { 
      runner: 'UNKNOWN' as const, 
      job: 'UNKNOWN' as const, 
      evolution: 'UNKNOWN' as const, 
      health: 'DEGRADED' as const,
      displayState: 'UNKNOWN_DATA' as const,
    };
    switch (state) {
      case 'ERROR': return { 
        runner: 'ERROR' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'DEGRADED' as const,
        displayState: 'ERROR' as const,
      };
      case 'BLOCKED_BY_GATES': return { 
        runner: 'BLOCKED' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'WARN' as const,
        displayState: 'BLOCKED' as const,
      };
      case 'BACKTEST_RUNNING': return { 
        runner: 'NO_RUNNER' as const, job: 'BACKTEST_RUNNING' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'BACKTEST_RUNNING' as const,
      };
      case 'EVOLVING': return { 
        runner: 'NO_RUNNER' as const, job: 'EVOLVING' as const, evolution: 'EVOLVING' as const, health: 'OK' as const,
        displayState: 'EVOLVING' as const,
      };
      case 'RUNNER_RUNNING': return { 
        runner: 'RUNNING' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'RUNNER_RUNNING' as const,
      };
      case 'RUNNER_STARTING': return { 
        runner: 'STARTING' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'RUNNER_STARTING' as const,
      };
      case 'BACKTEST_QUEUED': return { 
        runner: 'NO_RUNNER' as const, job: 'BACKTEST_QUEUED' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'BACKTEST_QUEUED' as const,
      };
      case 'RUNNER_STALE': return { 
        runner: 'STALE' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'WARN' as const,
        displayState: 'RUNNER_STALE' as const,
      };
      case 'RUNNER_REQUIRED': return { 
        runner: 'REQUIRED' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'WARN' as const,
        displayState: 'RUNNER_REQUIRED' as const,
      };
      case 'NEEDS_BACKTEST': return { 
        runner: 'NO_RUNNER' as const, job: 'NEEDS_BACKTEST' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'NEEDS_BACKTEST' as const,
      };
      case 'FRESH': return { 
        runner: 'NO_RUNNER' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'FRESH' as const,
      };
      case 'IDLE': return { 
        runner: 'NO_RUNNER' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: 'IDLE' as const,
      };
      default: return { 
        runner: 'NO_RUNNER' as const, job: 'IDLE' as const, evolution: 'IDLE' as const, health: 'OK' as const,
        displayState: state as any,
      };
    }
  }
  
  // If botNow is missing, show UNKNOWN_DATA state
  const hasBotNow = !!serverBotNow;
  if (!hasBotNow) {
    console.warn(`[BotTableRow] botNow missing from API for bot ${bot.id}`);
  }
  
  const stateFields = mapCanonicalStateToFields(serverBotNow?.state);
  
  const canonicalState = {
    runner_state: stateFields.runner,
    job_state: stateFields.job,
    evolution_state: stateFields.evolution,
    health_state: stateFields.health,
    health_score: Math.round(Number(bot.healthScore ?? 100)),
    runner_reason: serverBotNow?.reasonCode,
    job_reason: serverBotNow?.reasonCode,
    evolution_reason: undefined,
    health_reason: undefined,
    blockers: serverBotNow?.stageGate?.blockers?.map((b: any) => ({
      code: b.code,
      severity: b.severity === 'critical' ? 'CRITICAL' : b.severity === 'warn' ? 'WARNING' : 'INFO',
      message: b.code,
      suggested_action: b.fix || '',
      auto_healable: false,
    })) || [],
    why_not_trading: serverBotNow?.stageGate?.blockers?.map((b: any) => b.code) || [],
    why_not_promoted: [],
    is_auto_healable: false,
    suggested_actions: serverBotNow?.stageGate?.blockers?.filter((b: any) => b.fix).map((b: any) => b.fix) || [],
    last_heartbeat_at: serverBotNow?.runner?.lastHeartbeatAt,
    _context: { 
      stage, 
      mode: bot.mode || 'BACKTEST_ONLY', 
      has_runner: !!serverBotNow?.runner, 
      active_jobs: serverBotNow?.activeJob ? 1 : 0 
    },
  };

  // Stage color mapping for left border stripe - using shared config for consistency
  const stageColorClass = getStageBorderLeftColor(stage);

  // Detect if backtest metrics are stale (from prior generation)
  // Compare backtest timestamp with generationUpdatedAt from bot
  // Note: bot fields may be camelCase (from Drizzle) or snake_case (from raw API)
  const generationUpdatedAt = (bot as any).generationUpdatedAt ?? (bot as any).generation_updated_at;
  const backtestLastAt = metrics?.backtestLastAt;
  const isMetricsStale = useMemo(() => {
    // Only check for BACKTEST source outside TRIALS
    if (metrics?.statsSource !== 'BACKTEST') return false;
    if (stage === 'TRIALS') return false; // LAB always uses backtest, never "stale"
    // If we don't have both timestamps, can't determine staleness
    if (!backtestLastAt || !generationUpdatedAt) return false;
    // Metrics are stale if backtest completed before generation was updated
    return new Date(backtestLastAt) < new Date(generationUpdatedAt);
  }, [metrics?.statsSource, backtestLastAt, generationUpdatedAt, stage]);

  return (
    <Card className={cn(
      "transition-colors overflow-hidden border-l-4",
      stageColorClass
    )}>
      <CardContent className="p-1.5">
        {/* Main Row: EXPAND → IDENTITY → ACTIVITY → ACCOUNT → METRICS → HEALTH → ACTIONS */}
        {/* Using flex with tight gap-0.5 spacing for institutional density */}
        <div className="flex items-center gap-0.5">
          
          {/* 1. EXPAND CARET + MENU (stacked vertically, aligned to top) */}
          <div className="flex flex-col items-center flex-shrink-0 gap-0.5 self-start mt-0.5">
            {/* 3-dot menu on top */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="bg-popover">
                {onTogglePin && (
                  <>
                    <DropdownMenuItem onSelect={() => onTogglePin()}>
                      <Pin className="w-4 h-4 mr-2" fill={isPinned ? "currentColor" : "none"} />
                      {isPinned ? "Unpin" : "Pin to Top"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {(canonicalState.runner_state === 'STALE') && (
                  <>
                    <DropdownMenuItem
                      onSelect={() => restartRunner.mutate({ botId: bot.id, reason: 'USER_RESTART' })}
                      disabled={restartRunner.isPending}
                    >
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      Restart Runner
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {bot.status === "running" ? (
                  <DropdownMenuItem>
                    <Pause className="w-4 h-4 mr-2" />
                    Pause
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem>
                    <Play className="w-4 h-4 mr-2" />
                    Start
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSourcesOpen(true)}>
                  <Activity className="w-4 h-4 mr-2" />
                  Signal Sources
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={onDelete}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* AI Provider Badge - Grok/Perplexity indicator */}
            <InlineAiProviderBadge
              provider={(bot as any).aiProvider}
              createdByAi={(bot as any).createdByAi}
              badge={(bot as any).aiProviderBadge}
              reasoning={(bot as any).aiReasoning}
              sources={(bot as any).aiResearchSources}
              researchDepth={(bot as any).aiResearchDepth}
            />
            {/* Chevron below */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onToggleExpanded}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </Button>
          </div>

          {/* 2. IDENTITY BLOCK - fixed width to prevent stretching, keep grid aligned */}
          <div className="w-[260px] min-w-[220px] flex-shrink-0">
            {/* Text columns (stacked) - tighter space-y-0.5 for institutional density */}
            <div className="min-w-0 w-full flex flex-col space-y-0.5">
              {/* Line 1: Bot Name + Key Badges - name is flex-1 and truncates, badges are flex-shrink-0 */}
              {/* Symbol Selector moved to ActivityGrid (right of indicator dots) */}
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {/* AI Confidence Score - compact indicator from strategy research */}
                <span className="flex-shrink-0">
                  <BotConfidenceScore 
                    score={(bot.strategyConfig as Record<string, unknown>)?.candidateConfidence as number | undefined}
                  />
                </span>
                <span className="truncate min-w-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
                  <BotNameWithTooltip
                    name={bot.name}
                    description={(bot.strategyConfig as Record<string, unknown>)?.fullName as string || (bot as any).description}
                    className="text-sm max-w-full"
                    stage={stage}
                    isNearingSessionEnd={isNearingSessionEnd(serverNow)}
                    createdAt={(bot as any).created_at}
                    lastActiveAt={stabilizedMetrics?.lastTradeAt ?? (bot as any).last_trade_at}
                  />
                </span>
                {/* Elite Trophy Badge - High profitability potential (right of bot name) */}
                <span className="flex-shrink-0">
                  <InlineEliteBadge
                    metrics={{
                      sharpeRatio: stabilizedMetrics?.stageMetrics?.sharpe,
                      winRate: stabilizedMetrics?.stageMetrics?.winRate,
                      profitFactor: stabilizedMetrics?.stageMetrics?.profitFactor,
                      maxDrawdownPct: stabilizedMetrics?.stageMetrics?.maxDrawdownPct,
                      netPnl: stabilizedMetrics?.stageMetrics?.pnl,
                      totalTrades: stabilizedMetrics?.stageMetrics?.trades,
                      stage: stage,
                    }}
                  />
                </span>
                {/* QC Verification Badge - Social Media Style Checkmark (right after name) */}
                {qcBadgeInfo && qcBadgeInfo.state !== "NONE" && (
                  <span className="flex-shrink-0">
                    <InlineQCCheckmark
                      state={qcBadgeInfo.state as QCBadgeState}
                      onClick={() => setQcProofOpen(true)}
                    />
                  </span>
                )}
                {/* Pin indicator - inline with bot name */}
                <Pin 
                  className={cn(
                    "w-3.5 h-3.5 text-amber-400 transition-opacity flex-shrink-0",
                    isPinned ? "opacity-100" : "opacity-0 pointer-events-none"
                  )} 
                  fill="currentColor" 
                />
                {/* Account wallet icon - only for TRIALS (PAPER+ has it in ActivityGrid) */}
                {stage === 'TRIALS' && (
                  <span className="flex-shrink-0">
                    <AccountBadge
                      botId={bot.id}
                      stage={stage}
                      accountId={stabilizedEnrichedData?.accountId}
                      accountName={stabilizedEnrichedData?.accountName}
                      accountType={stabilizedEnrichedData?.accountType as 'SIM' | 'LIVE' | 'DEMO' | undefined}
                      linkedAccountCount={1}
                      isLocked={isEditLocked}
                      lockReason={editLockReason}
                    />
                  </span>
                )}
                {strategyType && (
                  <span className="flex-shrink-0">
                    <StrategyTypeBadge
                      archetype={strategyType}
                      entryConditionType={(stabilizedEnrichedData as any)?.entryConditionType}
                    />
                  </span>
                )}
                <span className="flex-shrink-0">
                  <DataSourceBadge dataSource={lastDataSource} />
                </span>
              </div>
            
            {/* Lines 2+3: Progress dots + Instrument + Stage/Gen badges */}
            <div className="flex flex-col gap-0.5">
              {/* Line 2: Progress Dots + Instrument Selector (inline) */}
              <div className="flex items-center gap-2.5">
                <PromotionProgressBar
                stage={stage}
                healthState={health.status as 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN'}
                rollup30={metrics?.stageMetrics ? {
                  trades: stabilizedMetrics?.stageMetrics.trades,
                  winRate: stabilizedMetrics?.stageMetrics.winRate,
                  sharpe: stabilizedMetrics?.stageMetrics.sharpe,
                  profitFactor: stabilizedMetrics?.stageMetrics.profitFactor,
                  expectancy: stabilizedMetrics?.stageMetrics.expectancy,
                  maxDdPct: stabilizedMetrics?.stageMetrics.maxDrawdownPct,
                  activeDays: Math.min(30, Math.max(1, Math.ceil((stabilizedMetrics?.stageMetrics.trades ?? 0) / 3))),
                  lastTradeAt: null,
                } : null}
                lastBacktestCompletedAt={bot.lastBacktestAt ? new Date(bot.lastBacktestAt).toISOString() : null}
                lastBacktestStatus={(bot as any).lastBacktestStatus || null}
                totalTrades={metrics?.stageMetrics?.trades ?? 0}
                isBacktesting={jobs.backtestsRunning > 0}
                runnerStatus={stage !== 'TRIALS' && runner?.startedAt && runner.status === 'RUNNING' ? {
                  isRunning: true,
                  lastEvaluation: executionProof?.last_evaluation_at,
                  lastHeartbeat: runner.lastHeartbeat,
                  lastBarClose: executionProof?.last_bar_close,
                  startedAt: runner.startedAt,
                  serverNow,
                } : stage !== 'TRIALS' && executionProofDegraded ? {
                  isRunning: false,
                  isIdle: true,
                } : undefined}
                large
              />
              {/* Compact instrument selector - inline with dots */}
              {filteredSymbols.length > 0 && (
                <InlineSymbolEdit
                  botId={bot.id}
                  currentSymbol={bot.symbol || "MES"}
                  availableSymbols={filteredSymbols}
                  isLocked={isEditLocked}
                  lockReason={editLockReason}
                  compact
                />
              )}
              </div>
              
              {/* Line 3: Stage + Generation Badge */}
              <div className="flex items-center gap-1.5">
                {/* Stage badge - shown for all stages */}
                <InlineStageEdit
                  botId={bot.id}
                  botName={bot.name}
                  currentStage={stage}
                  accountId={stabilizedEnrichedData?.accountId}
                  accountType={stabilizedEnrichedData?.accountType}
                  isLocked={isEditLocked}
                  lockReason={editLockReason}
                />
                {/* Generation badge - compact inline style */}
                <FlashValue value={stabilizedEnrichedData?.generationNumber}>
                  <GenerationBadge
                    generationNumber={stabilizedEnrichedData?.generationNumber ?? 1}
                    latestGeneration={stabilizedEnrichedData?.latestGeneration ?? undefined}
                    versionMajor={stabilizedEnrichedData?.versionMajor ?? 1}
                    versionMinor={stabilizedEnrichedData?.versionMinor ?? 0}
                    latestVersionMajor={stabilizedEnrichedData?.latestVersionMajor ?? undefined}
                    botId={bot.id}
                    botName={bot.name}
                    latestVersionMinor={stabilizedEnrichedData?.latestVersionMinor ?? undefined}
                    trend={stabilizedEnrichedData?.trend as any}
                    peakGeneration={stabilizedEnrichedData?.peakGeneration ?? undefined}
                    declineFromPeakPct={stabilizedEnrichedData?.declineFromPeakPct ?? undefined}
                    lastEvolutionAt={bot.lastEvolutionAt}
                    generationStartedAt={(bot as any).generationUpdatedAt ?? (bot as any).generation_updated_at}
                    stage={stage}
                    metricsStatus={(bot as any).metrics_status || 'AWAITING_EVIDENCE'}
                    sessionTrades={metrics?.stageMetrics?.trades}
                  />
                </FlashValue>
              </div>
            </div>
            </div>
          </div>

          {/* 3. UNIFIED ACTIVITY GRID - 2x10 grid */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ActivityGrid
              botId={bot.id}
              className="self-stretch"
            backtestsRunning={jobs.backtestsRunning}
            backtestsQueued={jobs.backtestsQueued}
            evolvingRunning={jobs.evolvingRunning}
            evolvingQueued={jobs.evolvingQueued}
            improvingRunning={jobs.improvingRunning}
            improvingQueued={jobs.improvingQueued}
            backtestStartedAt={jobs.backtestStartedAt}
            evolveStartedAt={jobs.evolveStartedAt}
            improveStartedAt={jobs.improveStartedAt}
            recentJob={serverBotNow?.recentJob}
            improvementIteration={serverBotNow?.activeJob?.iteration ?? stabilizedEnrichedData?.generationNumber ?? 1}
            jobAttempt={serverBotNow?.activeJob?.attempt ?? 1}
            runnerState={
              // Use stabilizedPosition and stabilizedRunnerState to prevent flashing during data refreshes
              (stabilizedPosition && stabilizedPosition.quantity && stabilizedPosition.quantity > 0) ? 'TRADING' :
              runner?.activityState === 'TRADING' || stabilizedRunnerState.activityState === 'TRADING' ? 'TRADING' :
              stabilizedRunnerState.lastSignalAt && 
                (serverNow - new Date(stabilizedRunnerState.lastSignalAt).getTime()) < 60000 &&
                runner?.activityState !== 'TRADING' ? 'SIGNAL' :
              runner?.activityState === 'MAINTENANCE' || stabilizedRunnerState.activityState === 'MAINTENANCE' ? 'MAINTENANCE' :
              runner?.activityState === 'SCANNING' || stabilizedRunnerState.activityState === 'SCANNING' ? 'SCANNING' :
              runner?.status === 'STARTING' || (stabilizedRunnerState.hasRunner && stabilizedRunnerState.warmingUp) ? 'STARTING' :
              null
            }
            scanningSince={stabilizedRunnerState.scanningSince}
            positionSide={stabilizedPosition?.side ?? null}
            positionQuantity={stabilizedPosition?.quantity ?? null}
            entryPrice={stabilizedPosition?.entryPrice ?? null}
            currentPrice={stabilizedPosition?.currentPrice ?? null}
            stopPrice={stabilizedPosition?.stopPrice ?? null}
            targetPrice={stabilizedPosition?.targetPrice ?? null}
            unrealizedPnl={stabilizedPosition?.unrealizedPnl ?? null}
            entryReasonCode={stabilizedPosition?.entryReasonCode ?? null}
            positionOpenedAt={stabilizedPosition?.openedAt ?? null}
            livePositionActive={livePnLUpdate?.livePositionActive}
            matrixStatus={stabilizedEnrichedData?.latestWalkForwardStatus as any}
            matrixProgress={stabilizedEnrichedData?.latestWalkForwardProgress ?? 0}
            matrixTimeframes={stabilizedEnrichedData?.latestWalkForwardTimeframes ?? []}
            matrixCompletedCells={stabilizedEnrichedData?.latestWalkForwardCompletedCells ?? 0}
            matrixTotalCells={stabilizedEnrichedData?.latestWalkForwardTotalCells ?? 0}
            matrixCurrentTimeframe={stabilizedEnrichedData?.latestWalkForwardCurrentTimeframe ?? null}
            matrixAggregate={stabilizedEnrichedData?.matrixAggregate}
            alertCount={stabilizedEnrichedData?.alertCount ?? 0}
            botTimeframe={stabilizedMetrics?.backtestTimeframe ?? undefined}
            botName={bot.name}
            stage={stage}
            generationNumber={stabilizedEnrichedData?.generationNumber}
            winRate={stabilizedMetrics?.stageMetrics?.winRate ?? null}
            profitFactor={stabilizedMetrics?.stageMetrics?.profitFactor ?? null}
            expectancy={stabilizedMetrics?.stageMetrics?.expectancy ?? null}
            maxDrawdownPct={stabilizedMetrics?.stageMetrics?.maxDrawdownPct ?? null}
            sharpe={stabilizedMetrics?.stageMetrics?.sharpe ?? null}
            trades={stabilizedMetrics?.stageMetrics?.trades ?? null}
            lastTradeAt={stabilizedMetrics?.lastTradeAt ?? (stage === 'TRIALS' ? stabilizedMetrics?.backtestLastAt : null) ?? null}
            onTradesClick={() => setWhyNotTradingOpen(true)}
            livePnl={stabilizedLivePnL.unrealizedPnl}
            netPnl={stabilizedMetrics?.stageMetrics?.pnl ?? null}
            accountId={stabilizedEnrichedData?.accountId ?? null}
            accountName={stabilizedEnrichedData?.accountName ?? null}
            accountType={stabilizedEnrichedData?.accountType as 'SIM' | 'LIVE' | 'DEMO' | null}
            isAccountLocked={isEditLocked}
            accountLockReason={editLockReason}
            accountTotalBlownCount={stabilizedEnrichedData?.accountTotalBlownCount ?? 0}
            accountConsecutiveBlownCount={stabilizedEnrichedData?.accountConsecutiveBlownCount ?? 0}
            sessionState={stabilizedSession.sessionState}
            isSleeping={stabilizedSession.isSleeping}
            strategyConfig={bot.strategyConfig as Record<string, unknown>}
            symbol={bot.symbol || "MES"}
            availableSymbols={filteredSymbols}
            isSymbolLocked={isEditLocked}
            symbolLockReason={editLockReason}
            onSourcesClick={() => setSourcesOpen(true)}
            peakGeneration={stabilizedEnrichedData?.peakGeneration ?? null}
            peakSharpe={stabilizedEnrichedData?.peakSharpe ?? null}
            isRevertCandidate={stabilizedEnrichedData?.isRevertCandidate ?? false}
            declineFromPeakPct={stabilizedEnrichedData?.declineFromPeakPct ?? null}
            trendDirection={stabilizedEnrichedData?.trendDirection ?? null}
            metricsStatus={(bot as any).metrics_status || null}
            llmCostData={(bot as any).llm_cost ?? null}
            displayAllowed={displayAllowed}
            dataSource={dataSource}
            isMaintenanceWindow={isMaintenanceWindow}
          />
          </div>

          {/* 5. BADGES - natural widths, consistent ORDER for alignment */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Kill State (only when present) */}
            {(bot as any).killState && (bot as any).killState !== 'NONE' && (
              <KillStateBadge
                killState={(bot as any).killState}
                killReasonCode={(bot as any).killReasonCode}
                killReasonDetail={(bot as any).killReasonDetail}
                demotionCooldownUntil={(bot as any).demotionCooldownUntil}
              />
            )}
            
            {/* Demotion Recovery Badge - TRIALS stage only */}
            {stage === 'TRIALS' && (
              <DemotionRecoveryBadge
                demotion={latestDemotion}
                currentStage={stage}
                improvementStatus={improvementState?.status}
              />
            )}

            {/* TRIALS: Backtest Status + Improvement inline */}
            {stage === 'TRIALS' && (
              <>
                {/* Backtest Freshness Badge - Industry Standard */}
                <BacktestStatusBadge
                  status={backtestStatus || (jobs.backtestsRunning > 0 ? 'running' : jobs.backtestsQueued > 0 ? 'queued' : 'stale')}
                  completedAt={sessionCompletedAt}
                  ageSeconds={sessionAgeSeconds}
                  failedAt={lastFailedAt}
                  failedReason={lastFailedReason}
                  failedCount={failedSinceLastSuccess}
                />
                {(() => {
                  const hasAnyJobs =
                    jobs.backtestsRunning > 0 ||
                    jobs.backtestsQueued > 0 ||
                    jobs.evolvingRunning > 0 ||
                    jobs.evolvingQueued > 0 ||
                    jobs.evaluating ||
                    jobs.training;
                  
                  const hasEvolveJob = jobs.evolvingRunning > 0 || jobs.evolvingQueued > 0;

                  if (improvementState?.status === 'PAUSED' && hasAnyJobs) return null;

                  return (
                    <ImprovementBadge
                      state={improvementState}
                      graduationEligible={graduationStatus.isEligible}
                      hasEvolveJob={hasEvolveJob}
                      evolveStartedAt={jobs.evolveStartedAt}
                    />
                  );
                })()}
              </>
            )}

            {/* Non-TRIALS: Priority badge */}
            {stage !== 'TRIALS' && (
              <PriorityBadge bucket={priorityBucket} score={priorityScore} computedAt={priorityComputedAt} />
            )}
          </div>

          {/* 5b. CANDIDATE SCORE BADGE - Shows graduation status */}
          {candidateEval && (
            <CandidateBadge
              status={candidateEval.status as 'PASS' | 'FAIL' | 'NEAR_MISS'}
              candidateScore={(candidateEval as any).candidate_score}
              failedDimensions={((candidateEval as any).reasons_json as any)?.reasons?.filter((r: string) => r.includes('need')) || []}
              reasons={[
                { dimension: 'Trades', current: (candidateEval as any).trades_count ?? 0, required: 60, delta: 60 - ((candidateEval as any).trades_count ?? 0), passed: ((candidateEval as any).trades_count ?? 0) >= 60 },
                { dimension: 'Profit Factor', current: (candidateEval as any).profit_factor ?? 0, required: 1.15, delta: 1.15 - ((candidateEval as any).profit_factor ?? 0), passed: ((candidateEval as any).profit_factor ?? 0) >= 1.15 },
                { dimension: 'Win Rate', current: (candidateEval as any).win_rate ?? 0, required: 40, delta: 40 - ((candidateEval as any).win_rate ?? 0), passed: ((candidateEval as any).win_rate ?? 0) >= 40 },
                { dimension: 'Max Drawdown', current: (candidateEval as any).max_drawdown ?? 0, required: 8, delta: ((candidateEval as any).max_drawdown ?? 0) - 8, passed: ((candidateEval as any).max_drawdown ?? 100) <= 8 },
              ]}
            />
          )}

          {/* 6-7. RIGHT COLUMN: Health + Actions (top) + Account (bottom for PAPER+) */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {/* Top row: Health Alert + Actions */}
            <div className="flex items-center gap-1">
              {/* HEALTH - Only show when there's a PROBLEM (WARN/DEGRADED), not for OK or unknown */}
              {runnerJobsLoading ? (
                <div className="hidden sm:flex items-center justify-center w-8">
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
              ) : (health.status === "WARN" || health.status === "DEGRADED") ? (
                <WhyNotRunningDrawer
                  botId={bot.id}
                  botName={bot.name}
                  stage={stage}
                  accountId={stabilizedEnrichedData?.accountId || null}
                  accountName={stabilizedEnrichedData?.accountName || null}
                  healthState={health.status}
                  activityState={activityState}
                  healthReasonCode={dbHealthReasonCode}
                  healthReasonDetail={dbHealthReasonDetail}
                  healthDegradedSince={dbHealthDegradedSince}
                  trigger={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className={cn(
                          "hidden sm:flex items-center justify-center w-8 cursor-pointer hover:opacity-80 transition-opacity",
                          health.status === "DEGRADED" ? "text-destructive" : "text-yellow-500"
                        )}>
                          <AlertCircle className="w-5 h-5" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p className="text-xs">{health.reason || healthDisplay.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  }
                />
              ) : null}

              {/* Idle reason badge removed - info now shown in ActivityGrid */}
            </div>
            
            {/* Account dropdown moved to ActivityGrid for PAPER+ stages */}
          </div>

          <BotSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} bot={bot} />
          <PerBotSourcesDialog
            botId={bot.id}
            botName={bot.name}
            currentConfig={getBotSignalSources(bot.strategyConfig as Record<string, unknown>) || undefined}
            strategyConfig={bot.strategyConfig as Record<string, unknown>}
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
          />
          {/* QC Proof Popup - shows verification details for bots from strategy candidates */}
          {/* Mount popup whenever sourceCandidateId exists - popup handles its own loading state */}
          {sourceCandidateId && (
            <QCProofPopup
              candidateId={sourceCandidateId}
              candidateName={bot.name}
              open={qcProofOpen}
              onOpenChange={setQcProofOpen}
            />
          )}
        </div>

        {/* Mobile Stats Row */}
        {/* CRITICAL: All metrics use stabilizedMetrics for consistency */}
        <div className="sm:hidden grid grid-cols-5 gap-2 text-center bg-muted/30 rounded-md p-2 mt-2">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">LIVE</p>
            <FlashValue value={stabilizedLivePnL.unrealizedPnl}>
              {stabilizedLivePnL.unrealizedPnl !== null ? (
                <PnlDisplay value={stabilizedLivePnL.unrealizedPnl} size="md" className="justify-center font-semibold" precision={2} />
              ) : (
                <span className="text-sm text-muted-foreground/50">-</span>
              )}
            </FlashValue>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">NET</p>
            <FlashValue value={stabilizedMetrics?.stageMetrics?.pnl}>
              <PnlDisplay value={stabilizedMetrics?.stageMetrics?.pnl ?? 0} size="md" className="justify-center font-semibold" />
            </FlashValue>
          </div>
          <div className="flex flex-col items-center">
            <FlashValue value={stabilizedMetrics?.stageMetrics?.winRate}>
              <MetricWithTarget
                type="winRate"
                value={stabilizedMetrics?.stageMetrics?.winRate ?? null}
                stage={stage}
                width="w-full"
              />
            </FlashValue>
          </div>
          <div className="flex flex-col items-center">
            <FlashValue value={stabilizedMetrics?.stageMetrics?.trades}>
              <MetricWithTarget
                type="trades"
                value={stabilizedMetrics?.stageMetrics?.trades ?? 0}
                stage={stage}
                width="w-full"
                onClick={() => setWhyNotTradingOpen(true)}
              />
            </FlashValue>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Health</p>
            {runnerJobsLoading ? (
              <div className="flex items-center justify-center">
                <Skeleton className="h-4 w-10 rounded" />
              </div>
            ) : (
              <div className={cn("flex items-center justify-center gap-1", healthDisplay.colorClass)}>
                {/* RULE: No OK icons - only show problems */}
                {health.status === "WARN" && <AlertTriangle className="w-3.5 h-3.5" />}
                {health.status === "DEGRADED" && <AlertCircle className="w-3.5 h-3.5" />}
              </div>
            )}
          </div>
        </div>

        {/* Expanded Detail */}
        {isExpanded && (
          <div className="mt-3 border-t border-border pt-3">
            <BotDetailDropdown bot={bot} isExpanded={isExpanded} />
          </div>
        )}
      </CardContent>
      
      {/* Why Not Trading Explainer Drawer */}
      <WhyNotTradingExplainer
        open={whyNotTradingOpen}
        onOpenChange={setWhyNotTradingOpen}
        botId={bot.id}
        botName={bot.name}
      />
    </Card>
  );
}
