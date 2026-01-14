import { useState, type MouseEvent } from "react";
import { 
  XCircle, 
  Loader2,
  RefreshCw,
  RotateCcw,
  Target,
  FileText,
  AlertTriangle,
  Check,
  MoreVertical,
  BookmarkPlus,
  Trash2,
  Info,
  ArrowUpRight,
  Star,
  Dna,
  TrendingUp,
  Activity,
  ChevronDown,
  BadgeCheck,
  Shield,
  Clock,
  CheckSquare,
  Zap,
  DollarSign,
  Timer
} from "lucide-react";
import { type QCBadgeState } from "./QCBadge";
import { QCProofPopup } from "./QCProofPopup";
import { InlineAiProviderBadge } from "./InlineAiProviderBadge";
import { StrategyCandidateEliteBadge } from "./InlineEliteBadge";
import { TournamentBadge, type TournamentTier } from "./TournamentBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getStageBorderLeftColor } from "@/lib/stageConfig";
import type { StrategyCandidate } from "@/hooks/useStrategyLab";

export type RejectionReason = 
  | "TOO_RISKY"
  | "UNCLEAR_EDGE"
  | "POOR_TIMING"
  | "DUPLICATE_STRATEGY"
  | "LOW_CONFIDENCE"
  | "NOT_NOVEL"
  | "BAD_MARKET_FIT"
  | "OTHER";

const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: "TOO_RISKY", label: "Too Risky" },
  { value: "UNCLEAR_EDGE", label: "Unclear Edge" },
  { value: "POOR_TIMING", label: "Poor Timing" },
  { value: "DUPLICATE_STRATEGY", label: "Duplicate Strategy" },
  { value: "LOW_CONFIDENCE", label: "Low Confidence" },
  { value: "NOT_NOVEL", label: "Not Novel Enough" },
  { value: "BAD_MARKET_FIT", label: "Bad Market Fit" },
  { value: "OTHER", label: "Other" },
];

interface StrategyCandidateTableRowProps {
  candidate: StrategyCandidate;
  rowNumber: number;
  formatTimeAgo: (date: string | Date | null | undefined) => string;
  onSendToLab?: (id: string) => void;
  onReject?: (id: string, reason: RejectionReason, notes?: string) => void;
  onRestore?: (id: string) => void;
  onRecycle?: (id: string) => void;
  onSaveAsArchetype?: (id: string, name: string, category?: string) => void;
  onDelete?: (id: string) => void;
  onFavorite?: (id: string, isFavorite: boolean) => void;
  onRunQCVerification?: (id: string) => void;
  isSending?: boolean;
  isRejecting?: boolean;
  isRestoring?: boolean;
  isRecycling?: boolean;
  isSavingArchetype?: boolean;
  isDeleting?: boolean;
  isFavoriting?: boolean;
  isRunningQC?: boolean;
  showRejectedActions?: boolean;
  showManualPromote?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectChange?: (id: string, selected: boolean) => void;
  qcBudget?: { dailyUsed: number; dailyLimit: number; weeklyUsed: number; weeklyLimit: number; canRun: boolean };
  qcBadgeState?: QCBadgeState;
  qcAttemptCount?: number | null;
  qcMaxAttempts?: number | null;
  qcQueuedAt?: string | null;
  qcStartedAt?: string | null;
  qcProgressPct?: number | null;
  qcScore?: number | null;
  showQCStatus?: boolean;
  compact?: boolean;
  nameColorClass?: string;
  tournamentTier?: TournamentTier;
  tournamentRank?: number;
  tournamentScore?: number;
}

function getShortName(name: string, maxLength: number = 25): string {
  if (name.length <= maxLength) return name;
  return name.slice(0, maxLength - 3) + "...";
}

function normalizeInvalidCondition(condition: string | undefined): string {
  if (!condition) return "Stop loss triggered or signal invalidation";
  
  const normalized = condition.toLowerCase().trim();
  
  if (normalized === "stop loss" || normalized === "stop_loss" || normalized === "stoploss") {
    return "Stop loss triggered at risk threshold";
  }
  if (normalized === "time" || normalized === "time_stop") {
    return "Time-based exit after max hold period";
  }
  if (normalized === "signal" || normalized === "signal_invalidation") {
    return "Entry signal invalidated by price action";
  }
  if (normalized === "volatility" || normalized === "vol_spike") {
    return "Volatility exceeds safe operating range";
  }
  if (normalized === "regime" || normalized === "regime_change") {
    return "Market regime shifted unfavorably";
  }
  
  return condition;
}

function getConfidenceColorStatic(score: number): string {
  if (score >= 75) return "text-green-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function formatElapsedTime(startTime: string | null | undefined): string {
  if (!startTime) return "";
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const elapsedMs = now - start;
  
  if (elapsedMs < 0) return "";
  
  const seconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function getConfidenceBgColor(score: number): string {
  if (score >= 75) return "bg-green-500/20";
  if (score >= 60) return "bg-amber-500/20";
  return "bg-red-500/20";
}

// QC Status Pill - Compact inline pill for under strategy name
interface QCStatusPillProps {
  state: QCBadgeState;
  elapsedTime?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

function QCStatusPill({ state, elapsedTime, onClick }: QCStatusPillProps) {
  if (!state || state === "NONE") return null;
  
  const config: Record<QCBadgeState, { label: string; icon: typeof Shield; bg: string; text: string; desc: string }> = {
    VERIFIED: { 
      label: "QC OK", 
      icon: BadgeCheck, 
      bg: "bg-green-500/15 border-green-500/40", 
      text: "text-green-400",
      desc: "Verified by QuantConnect LEAN Engine"
    },
    DIVERGENT: { 
      label: "QC DIV", 
      icon: AlertTriangle, 
      bg: "bg-yellow-500/15 border-yellow-500/40", 
      text: "text-yellow-400",
      desc: "Results differ from local backtest"
    },
    FAILED: { 
      label: "QC ERR", 
      icon: XCircle, 
      bg: "bg-red-500/15 border-red-500/40", 
      text: "text-red-400",
      desc: "QC verification encountered an error"
    },
    RUNNING: { 
      label: elapsedTime || "QC...", 
      icon: Loader2, 
      bg: "bg-blue-500/15 border-blue-500/40 animate-pulse", 
      text: "text-blue-400",
      desc: "Running QC backtest (2-5 min)"
    },
    QUEUED: { 
      label: elapsedTime ? `Q ${elapsedTime}` : "Queued", 
      icon: Clock, 
      bg: "bg-blue-500/10 border-blue-500/30", 
      text: "text-blue-400/80",
      desc: "Waiting in queue for QC verification"
    },
    INCONCLUSIVE: { 
      label: "QC N/A", 
      icon: Shield, 
      bg: "bg-muted/30 border-muted-foreground/30", 
      text: "text-muted-foreground",
      desc: "QC verification was inconclusive"
    },
    QC_PASSED: { 
      label: "QC OK", 
      icon: BadgeCheck, 
      bg: "bg-green-500/15 border-green-500/40", 
      text: "text-green-400",
      desc: "Passed QuantConnect verification gate"
    },
    QC_FAILED: { 
      label: "QC FAIL", 
      icon: XCircle, 
      bg: "bg-red-500/15 border-red-500/40", 
      text: "text-red-400",
      desc: "Failed QuantConnect verification gate"
    },
    QC_INCONCLUSIVE: { 
      label: "QC N/A", 
      icon: Shield, 
      bg: "bg-muted/30 border-muted-foreground/30", 
      text: "text-muted-foreground",
      desc: "QC verification was inconclusive"
    },
    QC_BYPASSED: { 
      label: "BYPASSED", 
      icon: AlertTriangle, 
      bg: "bg-orange-500/20 border-orange-500/50", 
      text: "text-orange-400",
      desc: "QC gate bypassed by admin - use with caution"
    },
    NONE: { 
      label: "", 
      icon: Shield, 
      bg: "", 
      text: "",
      desc: ""
    },
  };
  
  const c = config[state];
  const Icon = c.icon;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border cursor-pointer text-[9px] font-medium",
              c.bg, c.text
            )}
            onClick={onClick}
            data-testid={`qc-pill-${state.toLowerCase()}`}
          >
            <Icon className={cn("h-2.5 w-2.5", state === "RUNNING" && "animate-spin")} />
            <span className="font-mono">{c.label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <div className="space-y-1">
            <span className="text-xs font-medium">{state === "VERIFIED" ? "QC Verified" : state === "DIVERGENT" ? "Results Divergent" : state === "FAILED" ? "QC Failed" : state === "RUNNING" ? "QC Running" : state === "QUEUED" ? "QC Queued" : "QC Inconclusive"}</span>
            <p className="text-[10px] text-muted-foreground">{c.desc}</p>
            <p className="text-[9px] text-blue-400/80 italic">Click for details</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Inline QC Verification Checkmark - Social Media Style Badge
interface InlineQCCheckmarkProps {
  state?: QCBadgeState;
  qcScore?: number | null;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

function InlineQCCheckmark({ state, qcScore, onClick }: InlineQCCheckmarkProps) {
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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={cn(
              "inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0 cursor-pointer",
              bgColor,
              isPending && "animate-pulse"
            )}
            onClick={onClick}
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
          {qcScore != null && (
            <p className="text-muted-foreground">
              QC Score: <span className="font-mono font-medium">{(qcScore * 100).toFixed(1)}%</span>
            </p>
          )}
          {onClick && <p className="text-[9px] text-blue-400/80 italic mt-0.5">Click for details</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getConfidenceBgStatic(score: number): string {
  if (score >= 80) return "bg-emerald-500/15 border-emerald-500/40";
  if (score >= 65) return "bg-amber-500/15 border-amber-500/40";
  if (score >= 50) return "bg-orange-500/15 border-orange-500/40";
  return "bg-red-500/15 border-red-500/40";
}

function getConfidenceTier(score: number): string {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function getUniquenessColor(score: number): string {
  if (score >= 80) return "text-purple-400";
  if (score >= 60) return "text-cyan-400";
  if (score >= 40) return "text-slate-400";
  return "text-slate-500";
}

function getUniquenessBg(score: number): string {
  if (score >= 80) return "bg-purple-500/15 border-purple-500/30";
  if (score >= 60) return "bg-cyan-500/15 border-cyan-500/30";
  if (score >= 40) return "bg-slate-500/15 border-slate-500/30";
  return "bg-slate-600/15 border-slate-600/30";
}

interface UniquenessBadgeWithDetailsProps {
  score: number | null;
  candidate: StrategyCandidate;
  formatTimeAgo: (date: string | Date | null | undefined) => string;
}

function UniquenessBadgeWithDetails({ score, candidate, formatTimeAgo }: UniquenessBadgeWithDetailsProps) {
  const hasScore = score !== null && score !== undefined;
  const displayScore = score ?? 0;
  
  const uniquenessLabel = !hasScore 
    ? "Not calculated"
    : displayScore >= 80 
    ? "Highly unique (80%+)"
    : displayScore >= 60 
    ? "Moderately unique (60-79%)"
    : displayScore >= 40 
    ? "Similar (40-59%)"
    : "Very similar (<40%)";

  // Extract strategy details for popup
  const tier = getConfidenceTier(candidate.confidenceScore);
  const status = candidate.disposition;
  const plainSummary = candidate.explainersJson as any || {};
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div 
          className={cn(
            "flex flex-col items-center px-2 py-1 rounded border cursor-pointer min-w-[52px]",
            hasScore ? getUniquenessBg(displayScore) : "bg-muted/30 border-muted-foreground/20"
          )}
          data-testid={`button-uniqueness-${candidate.id}`}
        >
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground font-medium">Uniqueness</span>
          <span className={cn(
            "text-sm font-mono font-bold",
            hasScore ? getUniquenessColor(displayScore) : "text-muted-foreground/60"
          )}>
            {hasScore ? `${Math.round(displayScore)}%` : "N/A"}
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" side="bottom" align="center">
        <div className="space-y-3">
          {/* Header - using inline badges without tooltips to avoid nested tooltip/popover conflicts */}
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-sm font-semibold">{candidate.strategyName}</span>
            <div className="flex items-center gap-1">
              {/* Tier Badge (inline, no tooltip) */}
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[9px] px-1.5 py-0",
                  tier === "A" && "bg-green-500/20 text-green-400 border-green-500/30",
                  tier === "B" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                  tier === "C" && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                  tier === "D" && "bg-red-500/20 text-red-400 border-red-500/30"
                )}
              >
                Tier {tier}
              </Badge>
              {/* Status Badge (inline, no tooltip) */}
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[9px] px-1.5 py-0",
                  status === "MERGED" && "bg-green-500/20 text-green-400 border-green-500/30",
                  status === "SENT_TO_LAB" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                  (status === "QUEUED" || status === "PENDING_REVIEW" || status === "QUEUED_FOR_QC") && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                  (status === "REJECTED" || status === "ARCHIVED") && "bg-red-500/20 text-red-400 border-red-500/30"
                )}
              >
                {status?.replace(/_/g, " ") || "QUEUED"}
              </Badge>
            </div>
          </div>
          
          {/* Uniqueness indicator */}
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Uniqueness:</span>
            <span className={cn("font-medium", hasScore ? getUniquenessColor(displayScore) : "text-muted-foreground")}>
              {hasScore ? `${Math.round(displayScore)}% - ${uniquenessLabel}` : uniquenessLabel}
            </span>
          </div>
          
          {/* Layman-Friendly What/When/Why - Always show with fallbacks */}
          <div className="space-y-2 text-[11px]">
            <div className="flex items-start gap-2">
              <div className="bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">What</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.what || 
                 candidate.hypothesis || 
                 `Looks for ${candidate.archetypeName?.replace(/_/g, ' ') || 'trading'} opportunities.`}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="bg-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">When</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.when || "During regular trading hours (9:30 AM - 4:00 PM ET)"}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="bg-purple-500/20 text-purple-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">Why</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.why || 
                 (candidate.explainersJson as any)?.why ||
                 candidate.hypothesis ||
                 "Captures predictable price patterns."}
              </span>
            </div>
          </div>
          
          {/* Meta info */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/50 text-[9px] text-muted-foreground">
            <span>{candidate.archetypeName || "Custom"}</span>
            <span className="opacity-50">|</span>
            <span>{formatTimeAgo(candidate.createdAt)}</span>
            {candidate.lineageChain && candidate.lineageChain.length > 0 && (
              <>
                <span className="opacity-50">|</span>
                <span className="text-purple-400 font-mono">v{candidate.lineageChain.length + 1}</span>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Simplified Uniqueness Pill for stacked layout
function UniquenessPill({ score, candidate, formatTimeAgo }: UniquenessBadgeWithDetailsProps) {
  const hasScore = score !== null && score !== undefined;
  const displayScore = score ?? 0;
  
  const uniquenessLabel = !hasScore 
    ? "Not calculated"
    : displayScore >= 80 
    ? "Highly unique"
    : displayScore >= 60 
    ? "Moderately unique"
    : displayScore >= 40 
    ? "Similar"
    : "Very similar";

  const tier = getConfidenceTier(candidate.confidenceScore);
  const status = candidate.disposition;
  const plainSummary = candidate.explainersJson as any || {};
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <div 
          className={cn(
            "flex items-center gap-1.5 px-2 py-0.5 rounded-full cursor-pointer border text-[10px]",
            hasScore ? getUniquenessBg(displayScore) : "bg-muted/30 border-muted-foreground/20"
          )}
          data-testid={`button-uniqueness-${candidate.id}`}
        >
          <span className="text-muted-foreground/70 uppercase tracking-wide text-[8px]">Uniq</span>
          <span className={cn("font-mono font-bold tabular-nums", hasScore ? getUniquenessColor(displayScore) : "text-muted-foreground/60")}>
            {hasScore ? `${Math.round(displayScore)}%` : "N/A"}
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" side="bottom" align="center">
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-sm font-semibold">{candidate.strategyName}</span>
            <div className="flex items-center gap-1">
              <Badge variant="outline" className={cn(
                "text-[9px] px-1.5 py-0",
                tier === "A" && "bg-green-500/20 text-green-400 border-green-500/30",
                tier === "B" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                tier === "C" && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                tier === "D" && "bg-red-500/20 text-red-400 border-red-500/30"
              )}>Tier {tier}</Badge>
              <Badge variant="outline" className={cn(
                "text-[9px] px-1.5 py-0",
                status === "SENT_TO_LAB" && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                (status === "QUEUED" || status === "PENDING_REVIEW" || status === "QUEUED_FOR_QC") && "bg-amber-500/20 text-amber-400 border-amber-500/30",
                status === "REJECTED" && "bg-red-500/20 text-red-400 border-red-500/30"
              )}>{status?.replace(/_/g, " ") || "QUEUED"}</Badge>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">Uniqueness:</span>
            <span className={cn("font-medium", hasScore ? getUniquenessColor(displayScore) : "text-muted-foreground")}>
              {hasScore ? `${Math.round(displayScore)}% - ${uniquenessLabel}` : uniquenessLabel}
            </span>
          </div>
          
          {/* Layman-Friendly What/When/Why - Always show with fallbacks */}
          <div className="space-y-2 text-[11px]">
            <div className="flex items-start gap-2">
              <div className="bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">What</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.what || 
                 candidate.hypothesis || 
                 `Looks for ${candidate.archetypeName?.replace(/_/g, ' ') || 'trading'} opportunities.`}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="bg-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">When</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.when || "During regular trading hours (9:30 AM - 4:00 PM ET)"}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <div className="bg-purple-500/20 text-purple-400 rounded px-1.5 py-0.5 text-[9px] font-medium shrink-0">Why</div>
              <span className="text-foreground leading-relaxed">
                {plainSummary?.why || 
                 (candidate.explainersJson as any)?.why ||
                 "Captures predictable price patterns."}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 pt-2 border-t border-border/50 text-[9px] text-muted-foreground">
            <span>{candidate.archetypeName || "Custom"}</span>
            <span className="opacity-50">|</span>
            <span>{formatTimeAgo(candidate.createdAt)}</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getTierBadge(tier: string) {
  const tierInfo = {
    "A": { 
      color: "bg-green-500/20 text-green-400 border-green-500/30",
      tooltip: "Tier A: Highest confidence (80+). Strong research backing, sound structure, validated historically, regime robust."
    },
    "B": { 
      color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      tooltip: "Tier B: Good confidence (65-79). Solid fundamentals with room for validation."
    },
    "C": { 
      color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      tooltip: "Tier C: Moderate confidence (50-64). Needs more evidence or has structural concerns."
    },
    "D": { 
      color: "bg-red-500/20 text-red-400 border-red-500/30",
      tooltip: "Tier D: Low confidence (<50). Weak research, structural issues, or untested in current regime."
    },
  };
  const info = tierInfo[tier as keyof typeof tierInfo] || tierInfo.D;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 cursor-help", info.color)}>
            Tier {tier}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[200px]">
          <span className="text-xs">{info.tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getStatusBadge(status: string) {
  const statusMap: Record<string, { label: string; color: string; tooltip: string }> = {
    "PENDING_REVIEW": { 
      label: "Review", 
      color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      tooltip: "Awaiting human review before promotion to TRIALS stage."
    },
    "SENT_TO_LAB": { 
      label: "In Trials", 
      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      tooltip: "Promoted to Trials stage for backtesting and validation."
    },
    "REJECTED": { 
      label: "Rejected", 
      color: "bg-red-500/20 text-red-400 border-red-500/30",
      tooltip: "Rejected during review. Can be restored or recycled for future research."
    },
    "QUEUED": { 
      label: "Queued", 
      color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      tooltip: "Queued for automatic promotion when auto-approval is enabled."
    },
    "QUEUED_FOR_QC": { 
      label: "QC Testing", 
      color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
      tooltip: "Undergoing QuantConnect verification backtesting."
    },
  };
  const s = statusMap[status] || { label: status, color: "bg-muted text-muted-foreground", tooltip: "Strategy disposition status" };
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 cursor-help", s.color)}>
            {s.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[200px]">
          <span className="text-xs">{s.tooltip}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getRiskColor(risk: string): string {
  if (!risk || risk === "—") return "text-muted-foreground/60";
  const lower = risk.toLowerCase();
  if (risk === "Low" || lower.includes("low") || lower.includes("conservative")) return "text-emerald-400";
  if (risk === "Medium" || lower.includes("medium") || lower.includes("moderate")) return "text-amber-400";
  if (risk === "High" || lower.includes("high") || lower.includes("aggressive")) return "text-red-400";
  return "text-muted-foreground";
}

// Frontend archetype defaults for existing candidates without expectedBehavior
const ARCHETYPE_DEFAULTS: Record<string, { winRate: string; rr: string; freq: string; risk: string }> = {
  "breakout_retest": { winRate: "45-55%", rr: "2.0:1", freq: "2-4/day", risk: "Medium" },
  "mean_reversion": { winRate: "55-65%", rr: "1.2:1", freq: "3-6/day", risk: "Low" },
  "trend_following": { winRate: "35-45%", rr: "2.5:1", freq: "1-3/day", risk: "Medium" },
  "momentum": { winRate: "50-60%", rr: "1.8:1", freq: "3-5/day", risk: "Medium" },
  "range": { winRate: "55-65%", rr: "1.3:1", freq: "4-8/day", risk: "Low" },
  "volatility_breakout": { winRate: "40-50%", rr: "2.2:1", freq: "1-3/day", risk: "High" },
  "session_transition": { winRate: "50-60%", rr: "1.5:1", freq: "2-4/day", risk: "Medium" },
  "microstructure": { winRate: "60-70%", rr: "1.2:1", freq: "5-10/day", risk: "Low" },
  "event_driven": { winRate: "45-55%", rr: "2.0:1", freq: "1-2/day", risk: "High" },
  "scalping": { winRate: "55-65%", rr: "1.1:1", freq: "10-20/day", risk: "Low" },
  "swing": { winRate: "40-50%", rr: "2.5:1", freq: "1-2/wk", risk: "Medium" },
  "arbitrage": { winRate: "70-80%", rr: "1.0:1", freq: "5-15/day", risk: "Low" },
};

function getArchetypeDefaults(archetypeName?: string | null) {
  if (!archetypeName) return null;
  const key = archetypeName.toLowerCase().replace(/[^a-z_]/g, "_");
  return ARCHETYPE_DEFAULTS[key] || null;
}

function GenerationBadge({ 
  lineageChain, 
  recycledFromId,
  currentScore 
}: { 
  lineageChain?: string[]; 
  recycledFromId?: string | null;
  currentScore?: number;
}) {
  const generation = (lineageChain?.length || 0) + 1;
  const isEvolved = generation > 1 || !!recycledFromId;
  
  if (!isEvolved) return null;
  
  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-purple-400 cursor-help" data-testid="icon-generation">
              <Dna className="h-3 w-3" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px]">
            <div className="space-y-1">
              <div className="text-xs font-medium">Gen {generation} Strategy</div>
              <div className="text-[10px] text-muted-foreground">
                {generation > 1 
                  ? `Evolved through ${generation - 1} iteration${generation > 2 ? 's' : ''} of research and refinement.`
                  : recycledFromId 
                    ? "Recycled and reworked from a rejected candidate."
                    : "First generation strategy."
                }
              </div>
              {lineageChain && lineageChain.length > 0 && (
                <div className="text-[9px] text-muted-foreground/60 font-mono pt-1 border-t border-border/50">
                  Lineage: {lineageChain.slice(-3).map((id, i) => (
                    <span key={id}>{i > 0 && " → "}{id.slice(0, 6)}</span>
                  ))}
                  {lineageChain.length > 3 && <span>...</span>}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      {recycledFromId && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-emerald-400 cursor-help" data-testid="icon-evolved">
                <TrendingUp className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <div className="space-y-1">
                <div className="text-xs font-medium">Improved Strategy</div>
                <div className="text-[10px] text-muted-foreground">
                  Recycled from rejected candidate and refined with improved parameters.
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

interface AuditFactor {
  factor: string;
  points: number;
  maxPoints: number;
  reason: string;
}

interface ComponentAudit {
  score: number;
  maxScore: number;
  weight: number;
  weightedContribution: number;
  factors: AuditFactor[];
  formula: string;
}

function ConfidenceRow({ 
  label, 
  value, 
  weight, 
  candidateId,
  audit 
}: { 
  label: string; 
  value: number; 
  weight: number; 
  candidateId?: string;
  audit?: ComponentAudit;
}) {
  const labelId = label.toLowerCase().replace(/\s+/g, '-');
  const [showDetails, setShowDetails] = useState(false);
  
  return (
    <div data-testid={candidateId ? `confidence-row-${labelId}-${candidateId}` : `confidence-row-${labelId}`}>
      <div 
        className={cn(
          "flex items-center justify-between text-[10px]",
          audit && "cursor-pointer"
        )}
        onClick={(e) => { e.stopPropagation(); audit && setShowDetails(!showDetails); }}
      >
        <span className={cn("text-muted-foreground", audit && "flex items-center gap-1")}>
          {label}
          {audit && (
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", showDetails && "rotate-180")} />
          )}
        </span>
        <div className="flex items-center gap-2">
          <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
            <div 
              className={cn("h-full rounded-full", value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${value}%` }}
            />
          </div>
          <span 
            className={cn("font-mono tabular-nums w-6 text-right", getConfidenceColorStatic(value))}
            data-testid={candidateId ? `text-confidence-value-${labelId}-${candidateId}` : undefined}
          >
            {value}
          </span>
          <span className="text-muted-foreground/60">({weight}%)</span>
        </div>
      </div>
      {showDetails && audit && (
        <div className="mt-1 ml-2 pl-2 border-l border-border/50 space-y-0.5">
          {audit.factors.map((factor, idx) => (
            <div key={idx} className="text-[9px] flex items-center justify-between gap-2">
              <span className="text-muted-foreground/80 truncate flex-1">{factor.factor}</span>
              <span className={cn(
                "font-mono shrink-0",
                factor.points === factor.maxPoints ? "text-emerald-400" : 
                factor.points > 0 ? "text-foreground" : "text-muted-foreground/50"
              )}>
                {factor.points}/{factor.maxPoints}
              </span>
            </div>
          ))}
          <div className="text-[8px] text-muted-foreground/60 pt-0.5 italic">
            {audit.formula}
          </div>
        </div>
      )}
    </div>
  );
}

export function StrategyCandidateTableRow({
  candidate,
  rowNumber,
  formatTimeAgo,
  onSendToLab,
  onReject,
  onRestore,
  onRecycle,
  onSaveAsArchetype,
  onDelete,
  onFavorite,
  onRunQCVerification,
  isSending = false,
  isRejecting = false,
  isRestoring = false,
  isRecycling = false,
  isSavingArchetype = false,
  isDeleting = false,
  isFavoriting = false,
  isRunningQC = false,
  showRejectedActions = false,
  showManualPromote = false,
  selectable = false,
  selected = false,
  onSelectChange,
  qcBudget,
  qcBadgeState,
  qcAttemptCount,
  qcMaxAttempts,
  qcQueuedAt,
  qcStartedAt,
  qcProgressPct,
  qcScore,
  showQCStatus = false,
  compact = false,
  nameColorClass,
  tournamentTier,
  tournamentRank,
  tournamentScore,
}: StrategyCandidateTableRowProps) {
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<RejectionReason | "">("");
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [archetypeDialogOpen, setArchetypeDialogOpen] = useState(false);
  const [archetypeName, setArchetypeName] = useState("");
  const [archetypeCategory, setArchetypeCategory] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [qcProofOpen, setQcProofOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  
  const isRejected = candidate.disposition === "REJECTED";
  
  const handleConfirmReject = () => {
    if (rejectionReason && onReject) {
      onReject(candidate.id, rejectionReason, rejectionNotes || undefined);
      setRejectDialogOpen(false);
      setRejectionReason("");
      setRejectionNotes("");
    }
  };
  
  const status = candidate.disposition || "PENDING_REVIEW";
  const confidenceTier = getConfidenceTier(candidate.confidenceScore);
  
  // Get expected behavior from explainersJson or fall back to archetype defaults
  const expectedBehavior = candidate.explainersJson?.expectedBehavior || {};
  const archetypeDefaults = getArchetypeDefaults(candidate.archetypeName);
  
  const riskProfile = expectedBehavior.drawdownProfile || archetypeDefaults?.risk || "—";
  const expectedWinRate = expectedBehavior.winRate || archetypeDefaults?.winRate || "—";
  const expectedRR = (expectedBehavior as any).rewardRiskRatio || (expectedBehavior as any).rr || archetypeDefaults?.rr || "—";
  const tradeFrequency = expectedBehavior.tradeFrequency || archetypeDefaults?.freq || "—";
  
  const rawBreakdown = candidate.confidenceBreakdownJson || {};
  const confidenceBreakdown = {
    researchConfidence: rawBreakdown.researchConfidence ?? Math.round(candidate.confidenceScore * 0.9),
    structuralSoundness: rawBreakdown.structuralSoundness ?? Math.round(candidate.confidenceScore * 0.85),
    historicalValidation: rawBreakdown.historicalValidation ?? Math.round(candidate.confidenceScore * 0.8),
    regimeRobustness: rawBreakdown.regimeRobustness ?? Math.round(candidate.confidenceScore * 0.75),
  };
  
  // Extract audit trail for detailed breakdown display
  const auditData = rawBreakdown.audit as {
    calculatedAt?: string;
    version?: string;
    components?: {
      research?: ComponentAudit;
      structural?: ComponentAudit;
      historical?: ComponentAudit;
      regime?: ComponentAudit;
    };
    backtestValidation?: {
      hasBacktestData: boolean;
      validationBonus: number;
      validationReason: string;
    };
  } | undefined;

  // Border color based on candidate's column/disposition
  // - New column: white/neutral
  // - Testing column (QUEUED_FOR_QC): cyan (matches Testing header)
  // - Trials column (SENT_TO_LAB): amber (matches Trials header)
  const getStatusBorderColor = () => {
    const disposition = candidate.disposition;
    
    // Testing column: cyan to match the Testing header color
    if (disposition === "QUEUED_FOR_QC") {
      return 'border-l-cyan-500';
    }
    
    // Trials column: amber to match the Trials header color
    if (disposition === "SENT_TO_LAB") {
      return 'border-l-amber-500';
    }
    
    // New column: white/neutral highlight
    return 'border-l-slate-400';
  };
  
  const statusColorClass = getStatusBorderColor();

  const plainSummary = candidate.plainLanguageSummaryJson;
  
  // Handler that only opens details dialog for clicks on the card surface
  // (not on buttons, inputs, or other interactive elements)
  const handleCardClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Skip if clicking on interactive elements or their children
    const interactiveTagNames = ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'];
    let currentEl: HTMLElement | null = target;
    while (currentEl && currentEl !== e.currentTarget) {
      if (interactiveTagNames.includes(currentEl.tagName) ||
          currentEl.getAttribute('role') === 'button' ||
          currentEl.getAttribute('role') === 'menuitem' ||
          currentEl.getAttribute('data-testid')?.startsWith('button-') ||
          currentEl.getAttribute('data-testid')?.startsWith('menu-')) {
        return; // Don't open dialog for interactive element clicks
      }
      currentEl = currentEl.parentElement;
    }
    setDetailsDialogOpen(true);
  };
  
  return (
    <div 
      className="flex items-stretch" 
      data-testid={`candidate-row-${candidate.id}`}
      onClick={handleCardClick}
      style={{ cursor: 'pointer' }}
    >
      <Card className={cn(
        "flex-1 transition-colors overflow-hidden border-l-4", 
        statusColorClass,
        selected && "ring-2 ring-primary/50 bg-primary/5",
        compact && "border-l-2"
      )}>
        <CardContent className={cn("p-2", compact && "p-1.5")}>
          {/* Main Row Layout - Compact single line */}
          <div className={cn("flex items-center gap-2", compact && "gap-1.5")}>

            {/* 1. IDENTITY BLOCK - Strategy Name + What preview */}
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-1.5">
                {/* Elite Brain Badge - Before name for high-potential strategies */}
                <StrategyCandidateEliteBadge 
                  metrics={{
                    confidenceScore: candidate.confidenceScore,
                    noveltyScore: candidate.noveltyScore,
                    disposition: candidate.disposition,
                    linkedBotSharpe: candidate.linkedBot?.stageMetrics?.sharpeRatio ?? candidate.linkedBot?.metrics?.sharpeRatio,
                    linkedBotWinRate: candidate.linkedBot?.stageMetrics?.winRate ?? candidate.linkedBot?.metrics?.winRate,
                    linkedBotProfitFactor: (candidate.linkedBot?.stageMetrics as any)?.profitFactor,
                    linkedBotMaxDrawdown: candidate.linkedBot?.stageMetrics?.maxDrawdownPct ?? candidate.linkedBot?.metrics?.maxDrawdownPct,
                    linkedBotNetPnl: candidate.linkedBot?.stageMetrics?.netPnl ?? candidate.linkedBot?.metrics?.netPnl,
                    linkedBotTrades: candidate.linkedBot?.stageMetrics?.trades ?? candidate.linkedBot?.metrics?.totalTrades,
                    linkedBotStage: candidate.linkedBot?.stage,
                  }}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span 
                        className={cn("text-sm font-semibold cursor-default truncate", nameColorClass)} 
                        data-testid={`text-strategy-name-${candidate.id}`}
                      >
                        {getShortName(candidate.strategyName, 28)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[400px]">
                      <div className="space-y-1">
                        <div className="font-medium">{candidate.strategyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {candidate.archetypeName || "Custom"} | {formatTimeAgo(candidate.createdAt)}
                        </div>
                        {candidate.createdBotId && (
                          <div className="text-xs text-muted-foreground font-mono">
                            Bot ID: {candidate.createdBotId}
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {/* QC Verification Badge - Social Media Style Checkmark */}
                <InlineQCCheckmark 
                  state={qcBadgeState}
                  qcScore={qcScore}
                  onClick={qcBadgeState && qcBadgeState !== "NONE" ? (e) => { e.stopPropagation(); setQcProofOpen(true); } : undefined}
                />
                {/* Tournament Tier Badge - Only shown in Trials column for bots with tournament ranking */}
                {tournamentTier && tournamentTier !== "UNRANKED" && (
                  <TournamentBadge 
                    tier={tournamentTier}
                    rank={tournamentRank}
                    score={tournamentScore}
                    size="sm"
                  />
                )}
                {/* Favorite star toggle - always accessible via 3-dot menu, visible indicator when favorited */}
                {candidate.isFavorite && onFavorite && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFavorite(candidate.id, false);
                          }}
                          disabled={isFavoriting}
                          data-testid={`button-unfavorite-${candidate.id}`}
                        >
                          {isFavoriting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">Remove from favorites</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {/* Archetype, Time, and Status Icons as subtext */}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground/80">
                  {candidate.archetypeName || "Custom"} | {formatTimeAgo(candidate.createdAt)}
                </span>
                {/* Status icons in subtitle line */}
                {candidate.source === "LAB_FEEDBACK" && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-amber-400 cursor-help" data-testid="icon-rework">
                          <RefreshCw className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        Reworked from QC feedback
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <GenerationBadge 
                  lineageChain={candidate.lineageChain} 
                  recycledFromId={candidate.recycledFromId} 
                />
              </div>
              
              {/* ALL BADGES ROW - Confidence, Uniqueness, QC (at bottom of identity block) */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {/* CONFIDENCE PILL */}
                <Popover>
                <PopoverTrigger asChild>
                  <div 
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded-full cursor-pointer border text-[10px]",
                      candidate.regimeAdjustment?.regimeBonus != null && candidate.regimeAdjustment.regimeBonus !== 0 
                        ? getConfidenceBgStatic(candidate.regimeAdjustment.adjustedScore ?? candidate.confidenceScore)
                        : getConfidenceBgStatic(candidate.confidenceScore)
                    )}
                    data-testid={`candidate-confidence-${candidate.id}`}
                  >
                    {(() => {
                      const displayScore = candidate.regimeAdjustment?.adjustedScore ?? candidate.confidenceScore;
                      const regimeBonus = candidate.regimeAdjustment?.regimeBonus ?? 0;
                      return (
                        <>
                          <span className="text-muted-foreground/70 uppercase tracking-wide text-[8px]">Conf</span>
                          <span className={cn("font-mono font-bold tabular-nums", getConfidenceColorStatic(displayScore))}>
                            {displayScore}
                          </span>
                          {regimeBonus !== 0 && (
                            <span className={cn("font-mono text-[8px]", regimeBonus > 0 ? "text-emerald-400" : "text-rose-400")}>
                              {regimeBonus > 0 ? "+" : ""}{regimeBonus}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </PopoverTrigger>
              <PopoverContent className="w-72 p-3" side="bottom" align="center">
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                    <span className="text-xs font-semibold">4-Component Confidence</span>
                    <div className="flex items-center gap-1.5">
                      {getTierBadge(confidenceTier)}
                      <span className={cn("text-lg font-mono font-bold", getConfidenceColorStatic(candidate.confidenceScore))}>
                        {candidate.confidenceScore}
                      </span>
                    </div>
                  </div>
                  <ConfidenceRow 
                    label="Research" 
                    value={confidenceBreakdown.researchConfidence} 
                    weight={30} 
                    candidateId={candidate.id}
                    audit={auditData?.components?.research}
                  />
                  <ConfidenceRow 
                    label="Structural" 
                    value={confidenceBreakdown.structuralSoundness} 
                    weight={25} 
                    candidateId={candidate.id}
                    audit={auditData?.components?.structural}
                  />
                  <ConfidenceRow 
                    label="Historical" 
                    value={confidenceBreakdown.historicalValidation} 
                    weight={30} 
                    candidateId={candidate.id}
                    audit={auditData?.components?.historical}
                  />
                  <ConfidenceRow 
                    label="Regime" 
                    value={confidenceBreakdown.regimeRobustness} 
                    weight={15} 
                    candidateId={candidate.id}
                    audit={auditData?.components?.regime}
                  />
                  <div className="text-[9px] text-muted-foreground pt-1 border-t border-border/50 mt-2">
                    {auditData?.version ? `v${auditData.version} | ` : ""}Research 30% + Structural 25% + Historical 30% + Regime 15%
                  </div>
                  {auditData?.backtestValidation?.hasBacktestData && (
                    <div className="text-[9px] text-emerald-400 pt-1">
                      Backtest bonus: +{auditData.backtestValidation.validationBonus} pts
                    </div>
                  )}
                  {/* Regime Adjustment Section - Safe accessor helper */}
                  {(() => {
                    const ra = candidate.regimeAdjustment;
                    const hasValidData = ra && typeof ra === 'object' && Object.keys(ra).length > 0 && typeof ra.regimeMatch === 'string';
                    
                    if (!ra || Object.keys(ra).length === 0) return null;
                    
                    if (!hasValidData) {
                      return (
                        <div className="pt-2 border-t border-border/50 mt-2">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                            <Activity className="h-3 w-3" />
                            <span>Regime signal unavailable—refresh to recompute</span>
                          </div>
                        </div>
                      );
                    }
                    
                    const regimeMatch = ra.regimeMatch ?? 'NEUTRAL';
                    const originalScore = ra.originalScore ?? 0;
                    const adjustedScore = ra.adjustedScore ?? 0;
                    const regimeBonus = ra.regimeBonus ?? 0;
                    const reason = ra.reason ?? '';
                    const currentRegime = ra.currentRegime ?? 'Unknown';
                    
                    return (
                      <div className="pt-2 border-t border-border/50 mt-2 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-medium text-muted-foreground">Live Regime Adjustment</span>
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "text-[8px] px-1.5 py-0",
                              regimeMatch === "OPTIMAL" && "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
                              regimeMatch === "FAVORABLE" && "border-blue-500/50 text-blue-400 bg-blue-500/10",
                              regimeMatch === "NEUTRAL" && "border-zinc-500/50 text-zinc-400 bg-zinc-500/10",
                              regimeMatch === "UNFAVORABLE" && "border-rose-500/50 text-rose-400 bg-rose-500/10"
                            )}
                          >
                            {regimeMatch}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-muted-foreground">Base:</span>
                          <span className="font-mono font-medium">{originalScore}</span>
                          <span className="text-muted-foreground/60">→</span>
                          <span className="text-muted-foreground">Adj:</span>
                          <span className={cn(
                            "font-mono font-bold",
                            getConfidenceColorStatic(adjustedScore)
                          )}>
                            {adjustedScore}
                          </span>
                          <span className={cn(
                            "font-mono font-semibold",
                            regimeBonus > 0 ? "text-emerald-400" : 
                            regimeBonus < 0 ? "text-rose-400" : "text-zinc-400"
                          )}>
                            ({regimeBonus > 0 ? "+" : ""}{regimeBonus} pts)
                          </span>
                        </div>
                        {reason && (
                          <div className="text-[9px] text-muted-foreground/70">
                            {reason}
                          </div>
                        )}
                        <div className="text-[8px] text-muted-foreground/50 flex items-center gap-1">
                          <Activity className="h-2.5 w-2.5" />
                          Current: {String(currentRegime).replace(/_/g, " ")}
                        </div>
                      </div>
                    );
                  })()}
                  
                  {/* Expected Performance Stats */}
                  <div className="pt-2 border-t border-border/50 mt-2">
                    <div className="text-[10px] font-medium text-muted-foreground mb-2">Expected Performance</div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="text-center">
                        <div className="text-[8px] text-muted-foreground/70 uppercase">Win</div>
                        <div className="text-[11px] font-mono font-medium">{expectedWinRate}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-muted-foreground/70 uppercase">R:R</div>
                        <div className="text-[11px] font-mono font-medium">{expectedRR}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-muted-foreground/70 uppercase">Freq</div>
                        <div className="text-[11px] font-mono font-medium">{tradeFrequency}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[8px] text-muted-foreground/70 uppercase">Risk</div>
                        <div className={cn("text-[11px] font-mono font-medium", getRiskColor(riskProfile))}>{riskProfile}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
              </Popover>
              
                {/* UNIQUENESS PILL */}
                <UniquenessPill 
                  score={candidate.noveltyScore} 
                  candidate={candidate} 
                  formatTimeAgo={formatTimeAgo} 
                />
                
                {/* QC STATUS PILL */}
                {showQCStatus && (status === "QUEUED_FOR_QC" || (qcBadgeState && qcBadgeState !== "NONE")) && (
                  <QCStatusPill 
                    state={qcBadgeState || "QUEUED"}
                    elapsedTime={qcBadgeState === "RUNNING" ? formatElapsedTime(qcStartedAt) : qcBadgeState === "QUEUED" ? formatElapsedTime(qcQueuedAt) : undefined}
                    onClick={(e) => { e.stopPropagation(); setQcProofOpen(true); }}
                  />
                )}
              </div>
            </div>

            {/* RIGHT SIDE - 3-dot menu on top, AI badge below */}
            <div 
              className="flex flex-col items-center gap-1 ml-auto self-start" 
              data-testid={`candidate-actions-${candidate.id}`}
              onClick={(e) => e.stopPropagation()}
            >
            {/* 3-dot Actions Menu - Top Right */}
            <div className="flex items-center gap-1">
            {showRejectedActions && isRejected ? (
              <>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        size="sm" 
                        variant="outline"
                        disabled={isRestoring}
                        onClick={() => onRestore?.(candidate.id)}
                        data-testid={`button-restore-${candidate.id}`}
                      >
                        {isRestoring ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        <span className="ml-1">Restore</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Restore to Review queue</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        disabled={isRecycling}
                        onClick={() => onRecycle?.(candidate.id)}
                        data-testid={`button-recycle-${candidate.id}`}
                      >
                        {isRecycling ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        <span className="ml-1">Recycle</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Mark as recycled for future research</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </>
            ) : null}
            {/* 3-dot Actions Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button 
                  size="icon" 
                  variant="ghost"
                  data-testid={`button-actions-menu-${candidate.id}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
                {/* Select for bulk actions - only when selectable */}
                {selectable && onSelectChange && (
                  <DropdownMenuItem 
                    onClick={() => onSelectChange(candidate.id, !selected)}
                    data-testid={`menu-select-${candidate.id}`}
                  >
                    <CheckSquare className="h-4 w-4 mr-2" />
                    {selected ? "Deselect" : "Select for Bulk Actions"}
                  </DropdownMenuItem>
                )}
                {selectable && onSelectChange && <DropdownMenuSeparator />}
                {/* Manual Promote option - only when auto-promote is disabled */}
                {showManualPromote && onSendToLab && status !== "SENT_TO_LAB" && status !== "REJECTED" && (
                  <>
                    <DropdownMenuItem 
                      onClick={() => onSendToLab(candidate.id)}
                      disabled={isSending}
                      className="text-emerald-500 focus:text-emerald-500"
                      data-testid={`menu-promote-${candidate.id}`}
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 mr-2" />
                      )}
                      Promote to Trials
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem 
                  onClick={() => {
                    setArchetypeName(candidate.strategyName);
                    setArchetypeCategory(candidate.archetypeName || "Custom");
                    setArchetypeDialogOpen(true);
                  }}
                  disabled={isSavingArchetype}
                  data-testid={`menu-save-archetype-${candidate.id}`}
                >
                  <BookmarkPlus className="h-4 w-4 mr-2" />
                  Save as Archetype
                </DropdownMenuItem>
                {/* QC Verification option - only for Tier A/B with confidence >= 75 */}
                {onRunQCVerification && candidate.confidenceScore >= 75 && 
                 (confidenceTier === "A" || confidenceTier === "B") && (
                  <DropdownMenuItem 
                    onClick={() => onRunQCVerification(candidate.id)}
                    disabled={isRunningQC || (qcBudget && !qcBudget.canRun)}
                    className="text-blue-500 focus:text-blue-500"
                    data-testid={`menu-run-qc-${candidate.id}`}
                  >
                    {isRunningQC ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <BadgeCheck className="h-4 w-4 mr-2" />
                    )}
                    Run QC Verification
                    {qcBudget && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {qcBudget.dailyLimit - qcBudget.dailyUsed} left
                      </span>
                    )}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {status !== "REJECTED" && (
                  <DropdownMenuItem 
                    onClick={() => setRejectDialogOpen(true)}
                    disabled={isRejecting}
                    className="text-amber-500 focus:text-amber-500"
                    data-testid={`menu-reject-${candidate.id}`}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem 
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={isDeleting}
                  className="text-red-500 focus:text-red-500"
                  data-testid={`menu-delete-${candidate.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>

            {/* AI Provider Badge - Below the 3-dot menu */}
            <InlineAiProviderBadge 
              provider={candidate.aiProvider} 
              createdByAi={candidate.createdByAi}
              badge={candidate.aiProviderBadge}
              reasoning={(candidate as any).aiReasoning}
              sources={(candidate as any).aiResearchSources}
              researchDepth={(candidate as any).aiResearchDepth}
            />

            {/* Save as Archetype Dialog */}
            <Dialog open={archetypeDialogOpen} onOpenChange={setArchetypeDialogOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <BookmarkPlus className="h-5 w-5 text-primary" />
                    Save as Archetype
                  </DialogTitle>
                  <DialogDescription>
                    Save this strategy as a reusable archetype. It will appear in your archetype list when creating new bots.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="archetype-name">Archetype Name *</Label>
                    <Input
                      id="archetype-name"
                      placeholder="e.g., My Custom Breakout"
                      value={archetypeName}
                      onChange={(e) => setArchetypeName(e.target.value)}
                      data-testid={`input-archetype-name-${candidate.id}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="archetype-category">Category</Label>
                    <Input
                      id="archetype-category"
                      placeholder="e.g., Breakout, Momentum, Mean Reversion"
                      value={archetypeCategory}
                      onChange={(e) => setArchetypeCategory(e.target.value)}
                      data-testid={`input-archetype-category-${candidate.id}`}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setArchetypeDialogOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      if (archetypeName.trim() && onSaveAsArchetype) {
                        onSaveAsArchetype(candidate.id, archetypeName.trim(), archetypeCategory.trim() || undefined);
                        setArchetypeDialogOpen(false);
                      }
                    }}
                    disabled={!archetypeName.trim() || isSavingArchetype}
                    data-testid={`button-confirm-save-archetype-${candidate.id}`}
                  >
                    {isSavingArchetype ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save Archetype
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Reject Dialog */}
            <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Reject Strategy
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">{candidate.strategyName}</span>
                    <span className="block mt-1">This will move the candidate to the Rejected tab. You can restore it later if needed.</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="rejection-reason">Reason *</Label>
                    <Select value={rejectionReason} onValueChange={(v) => setRejectionReason(v as RejectionReason)}>
                      <SelectTrigger id="rejection-reason" data-testid={`select-rejection-reason-${candidate.id}`}>
                        <SelectValue placeholder="Select a reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {REJECTION_REASONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rejection-notes">Notes (optional)</Label>
                    <Textarea
                      id="rejection-notes"
                      placeholder="Additional context for why this strategy was rejected..."
                      value={rejectionNotes}
                      onChange={(e) => setRejectionNotes(e.target.value)}
                      className="min-h-[80px] text-sm"
                      data-testid={`textarea-rejection-notes-${candidate.id}`}
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid={`button-cancel-reject-${candidate.id}`}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleConfirmReject}
                    disabled={!rejectionReason || isRejecting}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid={`button-confirm-reject-${candidate.id}`}
                  >
                    {isRejecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Confirm Reject
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <Trash2 className="h-5 w-5 text-red-500" />
                    Delete Strategy
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <span className="font-medium text-foreground">{candidate.strategyName}</span>
                    <span className="block mt-1">This action cannot be undone. The strategy will be permanently deleted.</span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid={`button-cancel-delete-${candidate.id}`}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      onDelete?.(candidate.id);
                      setDeleteDialogOpen(false);
                    }}
                    disabled={isDeleting}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid={`button-confirm-delete-${candidate.id}`}
                  >
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* QC Proof Popup */}
            <QCProofPopup
              open={qcProofOpen}
              onOpenChange={setQcProofOpen}
              candidateId={candidate.id}
              candidateName={candidate.strategyName}
              canRerun={qcBudget?.canRun ?? true}
            />
            
            {/* Layman-Friendly Strategy Details Dialog */}
            <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
              <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-lg">
                    <Target className="h-5 w-5 text-primary" />
                    {candidate.strategyName}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{candidate.archetypeName || "Custom Strategy"}</span>
                    <span className="text-muted-foreground/50">|</span>
                    <span className="text-muted-foreground">{formatTimeAgo(candidate.createdAt)}</span>
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-2">
                  {/* Simple Summary Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Zap className="h-4 w-4 text-amber-400" />
                      </div>
                      <div className="text-lg font-bold text-foreground">{candidate.confidenceScore}%</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Confidence</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <DollarSign className="h-4 w-4 text-emerald-400" />
                      </div>
                      <div className="text-lg font-bold text-foreground">{expectedWinRate}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Win Rate</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                      <div className="flex items-center justify-center mb-1">
                        <Timer className="h-4 w-4 text-blue-400" />
                      </div>
                      <div className="text-lg font-bold text-foreground">{tradeFrequency}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Trade Freq</div>
                    </div>
                  </div>
                  
                  {/* Plain Language Explanation */}
                  <div className="space-y-3 pt-2 border-t border-border/50">
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="bg-blue-500/20 text-blue-400 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 mt-0.5">What</div>
                        <p className="text-sm text-foreground leading-relaxed">
                          {plainSummary?.what || 
                           candidate.hypothesis || 
                           `This strategy looks for ${candidate.archetypeName?.replace(/_/g, ' ') || 'trading'} opportunities in the market.`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="bg-emerald-500/20 text-emerald-400 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 mt-0.5">When</div>
                        <p className="text-sm text-foreground leading-relaxed">
                          {plainSummary?.when || 
                           (candidate.rulesJson?.tradingSession 
                             ? `Trades during ${candidate.rulesJson.tradingSession}`
                             : "Active during regular trading hours (9:30 AM - 4:00 PM ET)")}
                        </p>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="bg-purple-500/20 text-purple-400 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0 mt-0.5">Why</div>
                        <p className="text-sm text-foreground leading-relaxed">
                          {plainSummary?.why || 
                           (candidate.explainersJson as any)?.why ||
                           "Designed to capture predictable price movements based on technical patterns and market structure."}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Risk Level */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <span className="text-sm text-muted-foreground">Risk Level:</span>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-xs",
                        riskProfile === "Low" && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                        riskProfile === "Medium" && "bg-amber-500/15 text-amber-400 border-amber-500/30",
                        riskProfile === "High" && "bg-red-500/15 text-red-400 border-red-500/30"
                      )}
                    >
                      {riskProfile}
                    </Badge>
                  </div>
                  
                  {/* Status */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Current Status:</span>
                    {getStatusBadge(status)}
                  </div>
                </div>
                
                <DialogFooter className="gap-2">
                  <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
                    Close
                  </Button>
                  {showManualPromote && onSendToLab && status !== "SENT_TO_LAB" && status !== "REJECTED" && (
                    <Button 
                      onClick={() => { onSendToLab(candidate.id); setDetailsDialogOpen(false); }}
                      disabled={isSending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowUpRight className="h-4 w-4 mr-2" />}
                      Send to Trials
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
