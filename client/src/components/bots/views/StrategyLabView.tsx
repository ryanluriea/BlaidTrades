import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, Play, Pause, Square, Microscope, Brain, Shield, Dna, CheckCircle2, XCircle, 
  AlertTriangle, Loader2, Globe, Lock, Zap, Clock, DollarSign, ChevronRight,
  RefreshCw, ExternalLink, FileText, Search, BookOpen, Compass, Target, TrendingUp,
  BarChart3, Award, Settings2, ChevronDown, RotateCcw, Sparkles, Activity, Info, Rocket,
  MoreVertical, Trash2, Filter, SortDesc, ArrowUpDown, Star, Layers, FlaskConical, Recycle, MessageSquare, Eye
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useRelativeTimeFormatter, formatRelativeTime } from "@/hooks/useRelativeTime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  useStrategyLabSessions, 
  useStrategyLabSession, 
  useCreateSession, 
  useSessionControl,
  useRunStep,
  useExportCandidate,
  usePromoteCandidate,
  useRejectCandidate,
  useRestoreCandidate,
  useRecycleCandidate,
  useBulkDeleteCandidates,
  useSaveAsArchetype,
  computeCostStats,
  useStrategyLabAutonomousState,
  useStrategyCandidates,
  useTrialsBotsCount,
  useToggleStrategyLabState,
  useToggleManualApproval,
  useFavoriteCandidate,
  type StrategyLabSession,
  type StrategyLabTask,
  type StrategyLabStep,
  type StrategyLabSource,
  type StrategyLabCandidate,
  type StrategyCandidate,
} from "@/hooks/useStrategyLab";
import { UNIVERSES } from "@/lib/cmeInstruments";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { isBeyondTrials } from "@/lib/stageConfig";
import { useStrategyLabDialog } from "@/contexts/StrategyLabDialogContext";
import { StrategyLabAILogos } from "./StrategyLabAILogos";
import { StrategyLabAICostBar, StrategyLabAICostBadge } from "./StrategyLabAICostBar";
import { StrategyLabTaskNarration } from "./StrategyLabTaskNarration";
import { StrategyLabExecutionSteps } from "./StrategyLabExecutionSteps";
import { StrategyCandidateList } from "@/components/strategy-lab";
import { StrategyLabResearchDesk } from "./StrategyLabResearchDesk";
import { StrategyLabCandidateSection } from "./StrategyLabCandidateSection";
import { StrategyLabEmptyState, StrategyLabThinkingState } from "./StrategyLabEmptyState";
import { StrategyLabSessionRow } from "@/components/strategy-lab/StrategyLabSessionRow";
import { StrategyCandidateTableRow } from "../StrategyCandidateTableRow";
import { useQCBudget, useQCVerifications, useRunQCVerification, getCandidateQCBadgeInfo, type QCBadgeState } from "@/hooks/useQCVerification";
import type { PerplexityModel, SearchRecency, AutoPromoteTier } from "@/hooks/useStrategyLab";

const STEP_CONFIG: Record<string, { icon: typeof Brain; label: string; color: string }> = {
  SEARCH: { icon: Search, label: "Search", color: "text-blue-400" },
  FETCH_SOURCE: { icon: Globe, label: "Fetch", color: "text-cyan-400" },
  EXTRACT_RULES: { icon: FileText, label: "Extract", color: "text-indigo-400" },
  SYNTHESIZE: { icon: Microscope, label: "Synthesize", color: "text-purple-400" },
  DESIGN_STRATEGY: { icon: Brain, label: "Design", color: "text-violet-400" },
  RISK_MODEL: { icon: Shield, label: "Risk", color: "text-amber-400" },
  PARAM_RANGES: { icon: Zap, label: "Params", color: "text-yellow-400" },
  BACKTEST_SPEC: { icon: RefreshCw, label: "Backtest", color: "text-emerald-400" },
  QA_CHECK: { icon: CheckCircle2, label: "QA", color: "text-green-400" },
  EXPORT_TO_LAB: { icon: ExternalLink, label: "Export", color: "text-teal-400" },
  RESEARCH: { icon: BookOpen, label: "Research", color: "text-blue-400" },
  GENERATE: { icon: Dna, label: "Generate", color: "text-purple-400" },
  SCREEN: { icon: Target, label: "Screen", color: "text-amber-400" },
  RANK: { icon: Award, label: "Rank", color: "text-emerald-400" },
  DISCOVER_UNIVERSE: { icon: Compass, label: "Discover", color: "text-blue-400" },
  OPEN_WEB_RESEARCH: { icon: Globe, label: "Web Research", color: "text-cyan-400" },
  CLOSED_WORLD_SYNTHESIS: { icon: Lock, label: "Synthesis", color: "text-purple-400" },
  STRATEGY_DESIGN: { icon: Brain, label: "Strategy Design", color: "text-violet-400" },
  PARAMETERIZATION: { icon: Zap, label: "Parameters", color: "text-yellow-400" },
  VALIDATION_PLAN: { icon: Target, label: "Validation", color: "text-amber-400" },
  BACKTEST_SUBMIT: { icon: RefreshCw, label: "Backtest", color: "text-emerald-400" },
  RESULTS_ANALYSIS: { icon: BarChart3, label: "Analysis", color: "text-teal-400" },
  REGIME_BREAKDOWN: { icon: TrendingUp, label: "Regimes", color: "text-indigo-400" },
  RISK_MODELING: { icon: Shield, label: "Risk Model", color: "text-orange-400" },
  EXPORT_STRATEGY: { icon: ExternalLink, label: "Export", color: "text-green-400" },
};

const SYMBOLS = ['ES', 'MES', 'NQ', 'MNQ', 'SPY', 'QQQ'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const UNIVERSE_OPTIONS = [
  { value: 'CME_CORE', label: 'CME Core', desc: 'ES, NQ, MES, MNQ, CL, GC, SI, 6E, ZN, ZB' },
  { value: 'CME_INDEX', label: 'CME Index', desc: 'ES, NQ, RTY + Micros' },
  { value: 'CME_ENERGY', label: 'CME Energy', desc: 'CL, MCL' },
  { value: 'CME_METALS', label: 'CME Metals', desc: 'GC, SI, MGC, SIL' },
  { value: 'CME_RATES', label: 'CME Rates', desc: 'ZN, ZB' },
];

const CONTRACT_PREFERENCE_OPTIONS = [
  { value: 'MICROS_ONLY', label: 'Micros only', desc: 'MES, MNQ, M2K, MCL...' },
  { value: 'MINIS_ONLY', label: 'Minis only', desc: 'ES, NQ, RTY, CL...' },
  { value: 'BOTH_PREFER_MICROS', label: 'Both (prefer Micros)', desc: 'Test all, rank micros higher' },
  { value: 'BOTH_PREFER_MINIS', label: 'Both (prefer Minis)', desc: 'Test all, rank minis higher' },
];

// Constraint values - null means "Auto"
interface ConstraintOverrides {
  min_trades_month: number | null;
  max_drawdown_pct: number | null;
  holding_time: string | null;
  session_hours: string | null;
}

interface NewSessionState {
  title: string;
  symbol: string;
  timeframe: string;
  research_mode: 'CLOSED' | 'OPEN' | 'HYBRID';
  run_mode: 'INTERACTIVE' | 'AUTOPILOT';
  session_mode: 'STANDARD' | 'GENETICS';
  discovery_enabled: boolean;
  universe: string;
  contract_preference: string;
  auto_map_equivalents: boolean;
  start_auto: boolean;
  constraints: ConstraintOverrides;
  genetics_pool_size: number;
  genetics_recombination_rate: number;
}

// Default constraints state (all Auto)
const DEFAULT_CONSTRAINTS: ConstraintOverrides = {
  min_trades_month: null,
  max_drawdown_pct: null,
  holding_time: null,
  session_hours: null,
};

function hasAnyConstraintOverride(constraints: ConstraintOverrides): boolean {
  return Object.values(constraints).some(v => v !== null);
}


function getConfidenceColorStatic(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 65) return "text-amber-400";
  if (score >= 50) return "text-orange-400";
  return "text-red-400";
}

function getConfidenceBgColor(score: number) {
  if (score >= 80) return "bg-emerald-500/20";
  if (score >= 65) return "bg-amber-500/20";
  if (score >= 50) return "bg-orange-500/20";
  return "bg-red-500/20";
}

function getStatusBadge(status: string) {
  const configs: Record<string, { label: string; color: string; Icon: typeof Sparkles }> = {
    NEW: { label: "New", color: "text-blue-400 border-blue-400/40", Icon: Sparkles },
    VALIDATED: { label: "Validated", color: "text-emerald-400 border-emerald-400/40", Icon: CheckCircle2 },
    SENT_TO_LAB: { label: "Promoted", color: "text-violet-400 border-violet-400/40", Icon: Rocket },
    RECYCLED: { label: "Recycled", color: "text-amber-400 border-amber-400/40", Icon: RotateCcw },
    QUEUED: { label: "Queued", color: "text-cyan-400 border-cyan-400/40", Icon: Clock },
    REJECTED: { label: "Rejected", color: "text-red-400 border-red-400/40", Icon: XCircle },
    PENDING_REVIEW: { label: "Review", color: "text-blue-400 border-blue-400/40", Icon: Microscope },
  };
  const cfg = configs[status] || { label: status, color: "text-muted-foreground border-border", Icon: Microscope };
  return (
    <Badge variant="outline" className={cn("text-[10px]", cfg.color)}>
      <cfg.Icon className="h-2.5 w-2.5 mr-1" />
      {cfg.label}
    </Badge>
  );
}

function getConfidenceTier(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function isDeployable(score: number): boolean {
  return score >= 40;
}

function getTierBadge(tier: string) {
  const configs: Record<string, { label: string; color: string; bgColor: string }> = {
    A: { label: "Tier A", color: "text-emerald-400", bgColor: "bg-emerald-500/20" },
    B: { label: "Tier B", color: "text-blue-400", bgColor: "bg-blue-500/20" },
    C: { label: "Tier C", color: "text-amber-400", bgColor: "bg-amber-500/20" },
    D: { label: "Tier D", color: "text-red-400", bgColor: "bg-red-500/20" },
  };
  const cfg = configs[tier] || { label: `Tier ${tier}`, color: "text-muted-foreground", bgColor: "bg-muted/30" };
  return (
    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", cfg.color, cfg.bgColor)}>
      {cfg.label}
    </span>
  );
}

function getRiskColor(risk: string) {
  switch (risk?.toLowerCase()) {
    case "low": return "text-emerald-400 bg-emerald-500/10";
    case "medium": return "text-amber-400 bg-amber-500/10";
    case "high": return "text-red-400 bg-red-500/10";
    default: return "text-muted-foreground bg-muted/30";
  }
}

interface EnhancedCardProps {
  candidate: StrategyCandidate;
  formatTimeAgo: (d: string) => string;
  getConfidenceColor: (s: number) => string;
  getDispositionBadge: (d: string) => React.ReactNode;
  onSendToLab?: (candidateId: string) => void;
  isSending?: boolean;
}

type CandidateTab = "candidates" | "qc_testing" | "in_lab" | "rejected";

function StrategyCandidateEnhancedCard({ candidate, formatTimeAgo: fmtTime, onSendToLab, isSending }: EnhancedCardProps) {
  const [expandedConfidence, setExpandedConfidence] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState(false);
  
  const status = candidate.disposition || "PENDING_REVIEW";
  const regimes = candidate.regimeTrigger ? [candidate.regimeTrigger] : [];
  const expectedBehavior = candidate.explainersJson?.expectedBehavior || {};
  const riskProfile = expectedBehavior.drawdownProfile || "Medium";
  const expectedWinRate = expectedBehavior.winRate || "55-65%";
  const expectedRR = "1.5:1";
  const tradeFrequency = expectedBehavior.tradeFrequency || "2-5/day";
  const marketType = "Mixed";
  
  const confidenceTier = getConfidenceTier(candidate.confidenceScore);
  
  const mechanics = {
    entry: candidate.rulesJson?.entry || "Signal-based entry on confirmation",
    exit: candidate.rulesJson?.exit || "Time or target-based exit",
    invalidation: candidate.rulesJson?.riskModel || "Stop loss or regime change",
  };
  
  const rawBreakdown = candidate.confidenceBreakdownJson || {};
  const confidenceBreakdown = {
    researchConfidence: rawBreakdown.researchConfidence ?? Math.round(candidate.confidenceScore * 0.9),
    structuralSoundness: rawBreakdown.structuralSoundness ?? Math.round(candidate.confidenceScore * 0.85),
    historicalValidation: rawBreakdown.historicalValidation ?? Math.round(candidate.confidenceScore * 0.8),
    regimeRobustness: rawBreakdown.regimeRobustness ?? Math.round(candidate.confidenceScore * 0.75),
  };

  return (
    <Card className="overflow-hidden" data-testid={`candidate-card-${candidate.id}`}>
      <CardContent className="p-3 space-y-2">
        {/* Compact Header Row - Name, Badges, Score, Actions all inline */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-sm font-semibold truncate">{candidate.strategyName}</h3>
              {getStatusBadge(status)}
              {candidate.source === "LAB_FEEDBACK" && (
                <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400 bg-amber-500/10" data-testid={`badge-rework-${candidate.id}`}>
                  <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                  REWORK
                </Badge>
              )}
              {getTierBadge(confidenceTier)}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{candidate.archetypeName || "Custom"}</span>
              <span className="opacity-50">|</span>
              <span>{fmtTime(candidate.createdAt)}</span>
              {candidate.lineageChain && candidate.lineageChain.length > 0 && (
                <>
                  <span className="opacity-50">|</span>
                  <span className="text-purple-400 font-mono" data-testid={`lineage-${candidate.id}`}>
                    v{candidate.lineageChain.length + 1}
                  </span>
                </>
              )}
            </div>
          </div>
          
          {/* Confidence Score - Compact */}
          <div className="flex items-center gap-1" data-testid={`candidate-confidence-${candidate.id}`}>
            <div className={cn(
              "text-base font-mono font-bold tabular-nums",
              getConfidenceColorStatic(candidate.confidenceScore)
            )} data-testid={`text-confidence-score-${candidate.id}`}>
              {candidate.confidenceScore}
            </div>
          </div>
          
          {/* Inline Actions */}
          <div className="flex items-center gap-0.5" data-testid={`candidate-actions-${candidate.id}`}>
            <Button 
              size="sm" 
              className="h-7 text-xs px-2" 
              disabled={status === "SENT_TO_LAB" || isSending}
              onClick={() => onSendToLab?.(candidate.id)}
              data-testid={`button-send-to-lab-${candidate.id}`}
            >
              {isSending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Microscope className="h-3 w-3" />
              )}
              <span className="ml-1 hidden sm:inline">{status === "SENT_TO_LAB" ? "In Trials" : "Trials"}</span>
            </Button>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-watch-${candidate.id}`}>
                    <Info className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">View Details</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-archive-${candidate.id}`}>
                    <XCircle className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reject</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        {/* Compact Metrics Row */}
        <div className="flex items-center gap-3 text-[10px] px-1" data-testid={`candidate-metrics-${candidate.id}`}>
          <div className="flex items-center gap-1" data-testid={`metric-winrate-${candidate.id}`}>
            <span className="text-muted-foreground">Win:</span>
            <span className="font-medium">{expectedWinRate}</span>
          </div>
          <div className="flex items-center gap-1" data-testid={`metric-rr-${candidate.id}`}>
            <span className="text-muted-foreground">R:R:</span>
            <span className="font-medium">{expectedRR}</span>
          </div>
          <div className="flex items-center gap-1" data-testid={`metric-frequency-${candidate.id}`}>
            <span className="text-muted-foreground">Freq:</span>
            <span className="font-medium">{tradeFrequency}</span>
          </div>
          <div className="flex items-center gap-1" data-testid={`metric-risk-${candidate.id}`}>
            <span className="text-muted-foreground">Risk:</span>
            <span className={cn("font-medium", getRiskColor(riskProfile))}>{riskProfile}</span>
          </div>
        </div>
        
        {/* Strategy Details - Collapsible */}
        <Collapsible open={expandedDetails} onOpenChange={setExpandedDetails}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between h-6 px-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3 text-purple-400" />
                Strategy Details
              </span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", expandedDetails && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5 space-y-2">
            {/* Strategy Intent */}
            <div data-testid={`candidate-intent-${candidate.id}`}>
              <div className="flex items-center gap-1 mb-0.5">
                <Target className="h-3 w-3 text-purple-400" />
                <span className="text-[9px] font-semibold uppercase text-muted-foreground">Intent</span>
              </div>
              <p className="text-[11px] leading-relaxed" data-testid={`text-intent-${candidate.id}`}>
                {candidate.hypothesis || candidate.explainersJson?.why || "Exploiting structural inefficiency in market microstructure"}
              </p>
            </div>
            
            {/* Mechanics Summary */}
            <div className="text-[10px] space-y-0.5" data-testid={`candidate-mechanics-${candidate.id}`}>
              <div className="flex gap-1.5">
                <span className="text-emerald-400 font-medium w-12 shrink-0">Entry:</span>
                <span className="text-muted-foreground" data-testid={`text-entry-${candidate.id}`}>{mechanics.entry}</span>
              </div>
              <div className="flex gap-1.5">
                <span className="text-amber-400 font-medium w-12 shrink-0">Exit:</span>
                <span className="text-muted-foreground" data-testid={`text-exit-${candidate.id}`}>{mechanics.exit}</span>
              </div>
              <div className="flex gap-1.5">
                <span className="text-red-400 font-medium w-12 shrink-0">Invalid:</span>
                <span className="text-muted-foreground" data-testid={`text-invalidation-${candidate.id}`}>{mechanics.invalidation}</span>
              </div>
            </div>
            
            {/* Why This Strategy Exists */}
            {(candidate.explainersJson?.why || candidate.explainersJson?.targetedInefficiency || candidate.explainersJson?.researchMemo) && (
              <div className="p-2 bg-purple-500/5 border border-purple-500/20 rounded" data-testid={`candidate-why-${candidate.id}`}>
                <div className="flex items-center gap-1 mb-1">
                  <FileText className="h-3 w-3 text-purple-400" />
                  <span className="text-[9px] font-semibold uppercase text-purple-400">Why This Strategy</span>
                </div>
                <div className="space-y-1 text-[10px] text-muted-foreground">
                  {candidate.explainersJson?.targetedInefficiency && (
                    <p><span className="text-foreground font-medium">Inefficiency:</span> {candidate.explainersJson.targetedInefficiency}</p>
                  )}
                  {candidate.explainersJson?.why && (
                    <p><span className="text-foreground font-medium">Why Now:</span> {candidate.explainersJson.why}</p>
                  )}
                  {candidate.explainersJson?.regimeFit && (
                    <p><span className="text-foreground font-medium">Regime Fit:</span> {candidate.explainersJson.regimeFit}</p>
                  )}
                  {candidate.explainersJson?.falsificationConditions && (
                    <p><span className="text-foreground font-medium">Invalidated If:</span> {candidate.explainersJson.falsificationConditions}</p>
                  )}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        
        {/* Linked Bot (when in LAB) */}
        {candidate.createdBotId && status === "SENT_TO_LAB" && (
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded space-y-1.5" data-testid={`linked-bot-${candidate.id}`}>
            <div className="flex items-center gap-2">
              <Microscope className="h-3 w-3 text-emerald-400" />
              <span className="text-[10px] text-emerald-400 font-medium">Running in LAB</span>
              <span className="text-[9px] text-muted-foreground font-mono ml-auto">{candidate.createdBotId.slice(0, 8)}...</span>
            </div>
            {/* Bot Metrics - show if linkedBot data exists with actual metrics */}
            {candidate.linkedBot && candidate.linkedBot.stageMetrics && (
              <div className="grid grid-cols-4 gap-1.5 text-center pt-1 border-t border-emerald-500/20">
                <div>
                  <div className="text-[9px] text-muted-foreground">Trades</div>
                  <div className="text-[10px] font-medium">
                    {candidate.linkedBot.stageMetrics.trades}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Win Rate</div>
                  <div className="text-[10px] font-medium">
                    {candidate.linkedBot.stageMetrics.winRate != null 
                      ? `${(candidate.linkedBot.stageMetrics.winRate * 100).toFixed(1)}%` 
                      : "--"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Net P&L</div>
                  <div className={cn(
                    "text-[10px] font-medium",
                    (candidate.linkedBot.stageMetrics.netPnl || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {candidate.linkedBot.stageMetrics.netPnl != null 
                      ? `$${candidate.linkedBot.stageMetrics.netPnl.toFixed(2)}` 
                      : "--"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Stage</div>
                  <div className="text-[10px] font-medium text-emerald-400">
                    {candidate.linkedBot.stage || "LAB"}
                  </div>
                </div>
              </div>
            )}
            {/* Awaiting data message when no metrics yet */}
            {(!candidate.linkedBot || !candidate.linkedBot.stageMetrics) && (
              <div className="pt-1 border-t border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-muted-foreground">
                    Awaiting backtest results...
                  </span>
                  <span className="text-[9px] text-emerald-400 font-medium">
                    {candidate.linkedBot?.stage || "LAB"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Confidence Breakdown - Expandable */}
        <Collapsible open={expandedConfidence} onOpenChange={setExpandedConfidence}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between h-6 px-1.5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <BarChart3 className="h-3 w-3" />
                Confidence Breakdown
              </span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", expandedConfidence && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <div className="space-y-1 p-1.5 bg-muted/20 rounded text-[10px]">
              <ConfidenceRow label="Research Confidence" value={confidenceBreakdown.researchConfidence} weight={30} />
              <ConfidenceRow label="Historical Validation" value={confidenceBreakdown.historicalValidation} weight={30} />
              <ConfidenceRow label="Structural Soundness" value={confidenceBreakdown.structuralSoundness} weight={25} />
              <ConfidenceRow label="Regime Robustness" value={confidenceBreakdown.regimeRobustness} weight={15} />
            </div>
          </CollapsibleContent>
        </Collapsible>
        
      </CardContent>
    </Card>
  );
}

function ConfidenceRow({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
          <div 
            className={cn("h-full rounded-full", value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-red-500")}
            style={{ width: `${value}%` }}
          />
        </div>
        <span className={cn("font-mono tabular-nums w-6 text-right", getConfidenceColorStatic(value))}>{value}</span>
        <span className="text-muted-foreground/60">({weight}%)</span>
      </div>
    </div>
  );
}

export function StrategyLabView() {
  const navigate = useNavigate();
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CandidateTab>("candidates");
  const [newSession, setNewSession] = useState<NewSessionState>({
    title: "",
    symbol: "ES",
    timeframe: "5m",
    research_mode: "HYBRID",
    run_mode: "AUTOPILOT",
    session_mode: "STANDARD",
    discovery_enabled: true,
    universe: "CME_CORE",
    contract_preference: "BOTH_PREFER_MICROS",
    auto_map_equivalents: true,
    start_auto: true,
    constraints: { ...DEFAULT_CONSTRAINTS },
    genetics_pool_size: 20,
    genetics_recombination_rate: 0.7,
  });

  const { data: sessions, isLoading: sessionsLoading } = useStrategyLabSessions();
  const createSession = useCreateSession();
  
  const { data: autonomousState, isLoading: stateLoading } = useStrategyLabAutonomousState();
  const { data: candidates, isLoading: candidatesLoading, isFetching: candidatesFetching } = useStrategyCandidates(500);
  const { data: trialsBotsData } = useTrialsBotsCount();
  const trialsBotsCount = trialsBotsData?.count ?? 0;
  const toggleState = useToggleStrategyLabState();
  const toggleManualApproval = useToggleManualApproval();
  const promoteCandidateMutation = usePromoteCandidate();
  const rejectCandidateMutation = useRejectCandidate();
  const restoreCandidateMutation = useRestoreCandidate();
  const recycleCandidateMutation = useRecycleCandidate();
  const saveAsArchetypeMutation = useSaveAsArchetype();
  const favoriteCandidateMutation = useFavoriteCandidate();
  const [sendingCandidateId, setSendingCandidateId] = useState<string | null>(null);
  const [rejectingCandidateId, setRejectingCandidateId] = useState<string | null>(null);
  const [restoringCandidateId, setRestoringCandidateId] = useState<string | null>(null);
  const [recyclingCandidateId, setRecyclingCandidateId] = useState<string | null>(null);
  const [savingArchetypeCandidateId, setSavingArchetypeCandidateId] = useState<string | null>(null);
  const [deletingCandidateId, setDeletingCandidateId] = useState<string | null>(null);
  const [favoritingCandidateId, setFavoritingCandidateId] = useState<string | null>(null);
  const [runningQCCandidateId, setRunningQCCandidateId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [sortMode, setSortMode] = useState<"confidence" | "date" | "qc_priority">("qc_priority");
  
  // Per-column lazy loading - start with fewer items for faster initial render
  const INITIAL_VISIBLE = 8;
  const LOAD_MORE_COUNT = 8;
  const [newColumnVisible, setNewColumnVisible] = useState(INITIAL_VISIBLE);
  const [testingColumnVisible, setTestingColumnVisible] = useState(INITIAL_VISIBLE);
  const [trialsColumnVisible, setTrialsColumnVisible] = useState(INITIAL_VISIBLE);
  const newSentinelRef = useRef<HTMLDivElement>(null);
  const testingSentinelRef = useRef<HTMLDivElement>(null);
  const trialsSentinelRef = useRef<HTMLDivElement>(null);
  
  // Per-column filters
  type FilterType = "all" | "deep" | "standard" | "favorites" | "recycled" | "custom";
  const [newColumnFilter, setNewColumnFilter] = useState<FilterType>("all");
  const [testingColumnFilter, setTestingColumnFilter] = useState<FilterType>("all");
  const [trialsColumnFilter, setTrialsColumnFilter] = useState<FilterType>("all");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const { isSettingsOpen: settingsDialogOpen, setSettingsOpen: setSettingsDialogOpen } = useStrategyLabDialog();
  const [autoPromoteThreshold, setAutoPromoteThreshold] = useState(85);
  const [autoPromoteTierRequirement, setAutoPromoteTierRequirement] = useState<AutoPromoteTier>("B");
  const [perplexityModel, setPerplexityModel] = useState<PerplexityModel>("BALANCED");
  const [searchRecency, setSearchRecency] = useState<SearchRecency>("WEEK");
  const [customFocus, setCustomFocus] = useState("");
  const [costEfficiencyMode, setCostEfficiencyMode] = useState(false);
  
  // QC Verification settings state
  const [qcDailyLimit, setQcDailyLimit] = useState(10);
  const [qcWeeklyLimit, setQcWeeklyLimit] = useState(40);
  const [qcAutoTriggerEnabled, setQcAutoTriggerEnabled] = useState(true);
  const [qcAutoTriggerThreshold, setQcAutoTriggerThreshold] = useState(80);
  const [qcAutoTriggerTier, setQcAutoTriggerTier] = useState<"A" | "B" | "AB">("AB");
  
  // Derive effective QC enabled state from server (authoritative) or local state
  // While loading, fall back to local state which tracks the server value after sync
  const isQcColumnVisible = useMemo(() => {
    // Use server state when available for authoritative value
    if (autonomousState?.qcAutoTriggerEnabled !== undefined) {
      return autonomousState.qcAutoTriggerEnabled;
    }
    // Fall back to local state (synced from server or default)
    return qcAutoTriggerEnabled;
  }, [autonomousState?.qcAutoTriggerEnabled, qcAutoTriggerEnabled]);
  
  // Fast-track to PAPER settings (skip TRIALS if QC results are exceptional)
  const [fastTrackEnabled, setFastTrackEnabled] = useState(true);
  const [fastTrackMinTrades, setFastTrackMinTrades] = useState(50);
  const [fastTrackMinSharpe, setFastTrackMinSharpe] = useState(1.5);
  const [fastTrackMinWinRate, setFastTrackMinWinRate] = useState(55);
  const [fastTrackMaxDrawdown, setFastTrackMaxDrawdown] = useState(15);
  
  // Trials auto-promotion settings (TRIALS → PAPER)
  const [trialsAutoPromoteEnabled, setTrialsAutoPromoteEnabled] = useState(true);
  const [trialsMinTrades, setTrialsMinTrades] = useState(50);
  const [trialsMinSharpe, setTrialsMinSharpe] = useState(1.0);
  const [trialsMinWinRate, setTrialsMinWinRate] = useState(50);
  const [trialsMaxDrawdown, setTrialsMaxDrawdown] = useState(20);
  
  // Collapsible settings state for each tab
  const [newTabSettingsOpen, setNewTabSettingsOpen] = useState(false);
  const [testingTabSettingsOpen, setTestingTabSettingsOpen] = useState(false);
  const [trialsTabSettingsOpen, setTrialsTabSettingsOpen] = useState(false);
  
  // Counter to track pending saves - prevents autonomousState sync during save operations
  // Using a counter instead of boolean allows proper handling of overlapping saves
  const pendingSavesCountRef = useRef(0);
  
  const bulkDeleteMutation = useBulkDeleteCandidates();
  
  const { data: qcBudget } = useQCBudget();
  const { data: qcVerifications } = useQCVerifications();
  const runQCVerificationMutation = useRunQCVerification();
  
  useEffect(() => {
    // Skip sync if we have pending saves - prevents stale server data from overwriting local changes
    if (pendingSavesCountRef.current > 0) {
      return;
    }
    
    if (autonomousState?.autoPromoteThreshold !== undefined) {
      setAutoPromoteThreshold(autonomousState.autoPromoteThreshold);
    }
    if (autonomousState?.autoPromoteTier) {
      setAutoPromoteTierRequirement(autonomousState.autoPromoteTier);
    }
    if (autonomousState?.perplexityModel) {
      setPerplexityModel(autonomousState.perplexityModel as PerplexityModel);
    }
    if (autonomousState?.searchRecency) {
      setSearchRecency(autonomousState.searchRecency as SearchRecency);
    }
    if (autonomousState?.customFocus !== undefined) {
      setCustomFocus(autonomousState.customFocus || "");
    }
    if (typeof autonomousState?.costEfficiencyMode === "boolean") {
      setCostEfficiencyMode(autonomousState.costEfficiencyMode);
    }
    // Sync QC Verification settings
    if (typeof autonomousState?.qcDailyLimit === "number") {
      setQcDailyLimit(autonomousState.qcDailyLimit);
    }
    if (typeof autonomousState?.qcWeeklyLimit === "number") {
      setQcWeeklyLimit(autonomousState.qcWeeklyLimit);
    }
    if (typeof autonomousState?.qcAutoTriggerEnabled === "boolean") {
      setQcAutoTriggerEnabled(autonomousState.qcAutoTriggerEnabled);
    }
    if (typeof autonomousState?.qcAutoTriggerThreshold === "number") {
      setQcAutoTriggerThreshold(autonomousState.qcAutoTriggerThreshold);
    }
    if (autonomousState?.qcAutoTriggerTier) {
      setQcAutoTriggerTier(autonomousState.qcAutoTriggerTier);
    }
    // Sync Fast Track settings
    if (typeof autonomousState?.fastTrackEnabled === "boolean") {
      setFastTrackEnabled(autonomousState.fastTrackEnabled);
    }
    if (typeof autonomousState?.fastTrackMinTrades === "number") {
      setFastTrackMinTrades(autonomousState.fastTrackMinTrades);
    }
    if (typeof autonomousState?.fastTrackMinSharpe === "number") {
      setFastTrackMinSharpe(autonomousState.fastTrackMinSharpe);
    }
    if (typeof autonomousState?.fastTrackMinWinRate === "number") {
      setFastTrackMinWinRate(autonomousState.fastTrackMinWinRate);
    }
    if (typeof autonomousState?.fastTrackMaxDrawdown === "number") {
      setFastTrackMaxDrawdown(autonomousState.fastTrackMaxDrawdown);
    }
    // Sync Trials auto-promotion settings
    if (typeof autonomousState?.trialsAutoPromoteEnabled === "boolean") {
      setTrialsAutoPromoteEnabled(autonomousState.trialsAutoPromoteEnabled);
    }
    if (typeof autonomousState?.trialsMinTrades === "number") {
      setTrialsMinTrades(autonomousState.trialsMinTrades);
    }
    if (typeof autonomousState?.trialsMinSharpe === "number") {
      setTrialsMinSharpe(autonomousState.trialsMinSharpe);
    }
    if (typeof autonomousState?.trialsMinWinRate === "number") {
      setTrialsMinWinRate(autonomousState.trialsMinWinRate);
    }
    if (typeof autonomousState?.trialsMaxDrawdown === "number") {
      setTrialsMaxDrawdown(autonomousState.trialsMaxDrawdown);
    }
  }, [autonomousState?.autoPromoteThreshold, autonomousState?.autoPromoteTier, autonomousState?.perplexityModel, autonomousState?.searchRecency, autonomousState?.customFocus, autonomousState?.costEfficiencyMode, autonomousState?.qcDailyLimit, autonomousState?.qcWeeklyLimit, autonomousState?.qcAutoTriggerEnabled, autonomousState?.qcAutoTriggerThreshold, autonomousState?.qcAutoTriggerTier, autonomousState?.fastTrackEnabled, autonomousState?.fastTrackMinTrades, autonomousState?.fastTrackMinSharpe, autonomousState?.fastTrackMinWinRate, autonomousState?.fastTrackMaxDrawdown, autonomousState?.trialsAutoPromoteEnabled, autonomousState?.trialsMinTrades, autonomousState?.trialsMinSharpe, autonomousState?.trialsMinWinRate, autonomousState?.trialsMaxDrawdown]);

  // Shared helper function for saving column dropdown settings with proper tracking
  const handleColumnSettingsSave = useCallback((updates: Record<string, unknown>) => {
    pendingSavesCountRef.current++;
    toggleState.mutate({
      autoPromoteThreshold, autoPromoteTier: autoPromoteTierRequirement,
      perplexityModel, searchRecency, customFocus, costEfficiencyMode,
      qcAutoTriggerEnabled, qcDailyLimit, qcWeeklyLimit,
      qcAutoTriggerThreshold, qcAutoTriggerTier,
      fastTrackEnabled, fastTrackMinTrades, fastTrackMinSharpe, fastTrackMinWinRate, fastTrackMaxDrawdown,
      trialsAutoPromoteEnabled, trialsMinTrades, trialsMinSharpe, trialsMinWinRate, trialsMaxDrawdown,
      ...updates,
    }, {
      onSettled: () => {
        setTimeout(() => {
          pendingSavesCountRef.current = Math.max(0, pendingSavesCountRef.current - 1);
        }, 100);
      }
    });
  }, [
    toggleState, autoPromoteThreshold, autoPromoteTierRequirement, perplexityModel, searchRecency,
    customFocus, costEfficiencyMode, qcAutoTriggerEnabled, qcDailyLimit, qcWeeklyLimit,
    qcAutoTriggerThreshold, qcAutoTriggerTier, fastTrackEnabled, fastTrackMinTrades,
    fastTrackMinSharpe, fastTrackMinWinRate, fastTrackMaxDrawdown, trialsAutoPromoteEnabled,
    trialsMinTrades, trialsMinSharpe, trialsMinWinRate, trialsMaxDrawdown
  ]);
  
  // Per-column IntersectionObserver for lazy loading
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    
    const createObserver = (
      ref: React.RefObject<HTMLDivElement>,
      setter: React.Dispatch<React.SetStateAction<number>>
    ) => {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setter(prev => prev + LOAD_MORE_COUNT);
          }
        },
        { threshold: 0.1, rootMargin: '200px' }
      );
      
      const el = ref.current;
      if (el) {
        observer.observe(el);
        observers.push(observer);
      }
    };
    
    createObserver(newSentinelRef, setNewColumnVisible);
    createObserver(testingSentinelRef, setTestingColumnVisible);
    createObserver(trialsSentinelRef, setTrialsColumnVisible);
    
    return () => observers.forEach(o => o.disconnect());
  }, []);
  
  const { toast } = useToast();
  const { formatTimeAgo, tick } = useRelativeTimeFormatter();
  
  const handleSendToLab = (candidateId: string) => {
    const c = candidatesList.find(x => x.id === candidateId);
    if (!c) {
      toast({ title: "Error", description: "Candidate not found", variant: "destructive" });
      return;
    }
    setSendingCandidateId(candidateId);
    promoteCandidateMutation.mutate({
      candidate_id: candidateId,
      session_id: c.sessionId,
    }, {
      onSettled: () => setSendingCandidateId(null),
    });
  };

  const handleRejectCandidate = (candidateId: string, reason: string, notes?: string) => {
    const c = candidatesList.find(x => x.id === candidateId);
    if (!c) {
      toast({ title: "Error", description: "Candidate not found", variant: "destructive" });
      return;
    }
    setRejectingCandidateId(candidateId);
    rejectCandidateMutation.mutate({
      candidate_id: candidateId,
      session_id: c.sessionId || '',
      reason: reason,
      notes: notes,
    }, {
      onSettled: () => setRejectingCandidateId(null),
    });
  };

  const handleRestoreCandidate = (candidateId: string) => {
    setRestoringCandidateId(candidateId);
    restoreCandidateMutation.mutate({
      candidate_id: candidateId,
    }, {
      onSettled: () => setRestoringCandidateId(null),
    });
  };

  const handleRecycleCandidate = (candidateId: string) => {
    setRecyclingCandidateId(candidateId);
    recycleCandidateMutation.mutate({
      candidate_id: candidateId,
    }, {
      onSettled: () => setRecyclingCandidateId(null),
    });
  };

  const handleSaveAsArchetype = (candidateId: string, name: string, category?: string) => {
    setSavingArchetypeCandidateId(candidateId);
    saveAsArchetypeMutation.mutate({
      candidate_id: candidateId,
      name,
      category,
    }, {
      onSettled: () => setSavingArchetypeCandidateId(null),
    });
  };

  const handleDeleteCandidate = (candidateId: string) => {
    setDeletingCandidateId(candidateId);
    bulkDeleteMutation.mutate({
      candidate_ids: [candidateId],
    }, {
      onSettled: () => setDeletingCandidateId(null),
    });
  };

  const handleFavoriteCandidate = (candidateId: string, isFavorite: boolean) => {
    setFavoritingCandidateId(candidateId);
    favoriteCandidateMutation.mutate({
      candidateId,
      isFavorite,
    }, {
      onSettled: () => setFavoritingCandidateId(null),
    });
  };

  const handleRunQCVerification = (candidateId: string) => {
    setRunningQCCandidateId(candidateId);
    runQCVerificationMutation.mutate({
      candidateId,
    }, {
      onSettled: () => setRunningQCCandidateId(null),
    });
  };

  const toggleExpanded = (sessionId: string) => {
    setExpandedSessionId(prev => prev === sessionId ? null : sessionId);
  };

  const handleCreateSession = () => {
    // Title is now optional (auto-naming)
    
    // Only include constraints that were explicitly set (not Auto/null)
    const constraintsToSend = hasAnyConstraintOverride(newSession.constraints)
      ? Object.fromEntries(
          Object.entries(newSession.constraints).filter(([_, v]) => v !== null)
        )
      : undefined;
    
    const baseParams = {
      title: newSession.title.trim() || undefined, // Let server auto-name if empty
      research_mode: newSession.research_mode,
      run_mode: newSession.run_mode,
      session_mode: newSession.session_mode,
    };

    const params = newSession.discovery_enabled
      ? {
          ...baseParams,
          discovery_enabled: true,
          universe: newSession.universe,
          contract_preference: newSession.contract_preference,
          auto_map_equivalents: newSession.auto_map_equivalents,
          constraints: constraintsToSend,
          start_auto: newSession.start_auto,
          ...(newSession.session_mode === 'GENETICS' ? {
            genetics_config: {
              pool_size: newSession.genetics_pool_size,
              recombination_rate: newSession.genetics_recombination_rate,
              selection_pressure: 2.0,
              mutation_rate: 0.15,
              elite_count: 3,
              immigration_rate: 0.1,
              species_target: 4,
              termination: { max_generations: 50, fitness_threshold: 85 },
            },
          } : {}),
        }
      : {
          ...baseParams,
          symbol: newSession.symbol,
          timeframe: newSession.timeframe,
          ...(newSession.session_mode === 'GENETICS' ? {
            genetics_config: {
              pool_size: newSession.genetics_pool_size,
              recombination_rate: newSession.genetics_recombination_rate,
              selection_pressure: 2.0,
              mutation_rate: 0.15,
              elite_count: 3,
              immigration_rate: 0.1,
              species_target: 4,
              termination: { max_generations: 50, fitness_threshold: 85 },
            },
          } : {}),
        };

    createSession.mutate(params, {
      onSuccess: (session) => {
        setExpandedSessionId(session.id);
        setCreateDialogOpen(false);
        setAdvancedOpen(false);
        setNewSession({
          title: "",
          symbol: "ES",
          timeframe: "5m",
          research_mode: "HYBRID",
          run_mode: "AUTOPILOT",
          session_mode: "STANDARD",
          discovery_enabled: true,
          universe: "CME_CORE",
          contract_preference: "BOTH_PREFER_MICROS",
          auto_map_equivalents: true,
          start_auto: true,
          constraints: { ...DEFAULT_CONSTRAINTS },
          genetics_pool_size: 20,
          genetics_recombination_rate: 0.7,
        });
      },
    });
  };

  const isPlaying = autonomousState?.isPlaying ?? false;
  const requireManualApproval = autonomousState?.requireManualApproval ?? true;
  const candidatesList = candidates ?? [];
  // Show loading skeleton when fetching initial data OR when refetching with no data yet
  const isLoadingCandidates = candidatesLoading || (candidatesFetching && !candidates);
  
  const handleToggleState = () => {
    toggleState.mutate(!isPlaying);
  };
  
  const handleToggleManualApproval = (value?: boolean) => {
    const newValue = value !== undefined ? value : !requireManualApproval;
    toggleManualApproval.mutate(newValue);
  };
  
  const getConfidenceColor = (score: number) => {
    if (score >= 80) return "text-emerald-400";
    if (score >= 65) return "text-amber-400";
    return "text-red-400";
  };
  
  const getDispositionBadge = (disposition: string) => {
    switch (disposition) {
      case "SENT_TO_LAB":
        return <Badge variant="outline" className="text-emerald-400 border-emerald-400/40 text-xs">Promoted</Badge>;
      case "QUEUED":
        return <Badge variant="outline" className="text-amber-400 border-amber-400/40 text-xs">Queued</Badge>;
      case "REJECTED":
        return <Badge variant="outline" className="text-red-400 border-red-400/40 text-xs">Rejected</Badge>;
      case "PENDING_REVIEW":
        return <Badge variant="outline" className="text-blue-400 border-blue-400/40 text-xs">Review</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground text-xs">{disposition}</Badge>;
    }
  };

  const getAdaptiveModeConfig = (mode: string) => {
    switch (mode) {
      case "SCANNING":
        return { label: "Scanning", interval: "1h", icon: Zap, color: "text-amber-400" };
      case "DEEP_RESEARCH":
        return { label: "Deep Research", interval: "6h", icon: Rocket, color: "text-purple-400" };
      default:
        return { label: "Balanced", interval: "2h", icon: Activity, color: "text-blue-400" };
    }
  };
  
  const adaptiveMode = autonomousState?.adaptiveMode || "BALANCED";
  const adaptiveConfig = getAdaptiveModeConfig(adaptiveMode);
  const AdaptiveIcon = adaptiveConfig.icon;
  const adaptiveReason = autonomousState?.adaptiveReason || "Autonomous adaptive system";
  
  // Compute filter counts for the header grid based on current tab
  const headerFilterCounts = useMemo(() => {
    let currentTabList: typeof candidatesList;
    switch (activeTab) {
      case "candidates":
        currentTabList = candidatesList.filter(c => 
          c.disposition !== "SENT_TO_LAB" && 
          c.disposition !== "REJECTED" && 
          c.disposition !== "QUEUED_FOR_QC"
        );
        break;
      case "qc_testing":
        currentTabList = candidatesList.filter(c => c.disposition === "QUEUED_FOR_QC");
        break;
      case "in_lab":
        // Filter by disposition AND exclude bots promoted beyond TRIALS (PAPER, SHADOW, CANARY, LIVE)
        currentTabList = candidatesList.filter(c => 
          c.disposition === "SENT_TO_LAB" && 
          !isBeyondTrials(c.linkedBot?.stage)
        );
        break;
      case "rejected":
        currentTabList = candidatesList.filter(c => c.disposition === "REJECTED");
        break;
      default:
        currentTabList = [];
    }
    
    return {
      all: currentTabList.length,
      deep: currentTabList.filter(c => c.researchDepth === "DEEP").length,
      standard: currentTabList.filter(c => c.researchDepth !== "DEEP").length,
      favorites: currentTabList.filter(c => c.isFavorite === true).length,
      recycled: currentTabList.filter(c => c.recycledFromId != null).length,
      custom: currentTabList.filter(c => c.customFocusUsed && c.customFocusUsed.trim() !== "").length,
    };
  }, [candidatesList, activeTab]);
  
  // Computed column data for header - moved outside IIFE for header access
  const columnData = useMemo(() => {
    const pendingCandidates = candidatesList.filter(c => {
      const d = c.disposition;
      return d !== "SENT_TO_LAB" && d !== "REJECTED" && d !== "QUEUED_FOR_QC";
    });
    const qcTestingCandidates = candidatesList.filter(c => 
      c.disposition === "QUEUED_FOR_QC"
    );
    // Filter sent to lab candidates, excluding bots promoted beyond TRIALS (PAPER, SHADOW, CANARY, LIVE)
    const sentToLabCandidates = candidatesList.filter(c => 
      c.disposition === "SENT_TO_LAB" && 
      !isBeyondTrials(c.linkedBot?.stage)
    );
    
    const applyFilter = (list: StrategyCandidate[], filter: FilterType) => {
      switch (filter) {
        case "deep":
          return list.filter(c => c.researchDepth === "DEEP");
        case "standard":
          return list.filter(c => c.researchDepth !== "DEEP");
        case "favorites":
          return list.filter(c => c.isFavorite === true);
        case "recycled":
          return list.filter(c => c.recycledFromId != null);
        case "custom":
          return list.filter(c => c.customFocusUsed && c.customFocusUsed.trim() !== "");
        default:
          return list;
      }
    };
    
    const getFilterCounts = (list: StrategyCandidate[]) => ({
      all: list.length,
      deep: list.filter(c => c.researchDepth === "DEEP").length,
      standard: list.filter(c => c.researchDepth !== "DEEP").length,
      favorites: list.filter(c => c.isFavorite === true).length,
      recycled: list.filter(c => c.recycledFromId != null).length,
      custom: list.filter(c => c.customFocusUsed && c.customFocusUsed.trim() !== "").length,
    });
    
    return {
      pendingCount: applyFilter(pendingCandidates, newColumnFilter).length,
      testingCount: applyFilter(qcTestingCandidates, testingColumnFilter).length,
      trialsCount: applyFilter(sentToLabCandidates, trialsColumnFilter).length,
      newFilterCounts: getFilterCounts(pendingCandidates),
      testingFilterCounts: getFilterCounts(qcTestingCandidates),
      trialsFilterCounts: getFilterCounts(sentToLabCandidates),
    };
  }, [candidatesList, newColumnFilter, testingColumnFilter, trialsColumnFilter]);
  
  // FilterDropdown component for column headers
  const FilterDropdown = ({ 
    columnId, 
    currentFilter, 
    setFilter, 
    counts 
  }: { 
    columnId: string; 
    currentFilter: FilterType; 
    setFilter: (f: FilterType) => void;
    counts: { all: number; deep: number; standard: number; favorites: number; recycled: number; custom: number };
  }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm" 
          className={cn(
            "h-5 px-1.5 text-[10px] gap-0.5",
            currentFilter !== "all" && "bg-primary/10 text-primary"
          )}
          data-testid={`filter-dropdown-${columnId}`}
        >
          <Filter className="w-2.5 h-2.5" />
          {currentFilter === "all" ? "All" : currentFilter === "deep" ? "Deep" : currentFilter === "standard" ? "Std" : currentFilter === "favorites" ? "Fav" : currentFilter === "recycled" ? "Rec" : "Cust"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "all"}
          onCheckedChange={() => setFilter("all")}
        >
          <Layers className="w-3 h-3 mr-1.5" />
          All ({counts.all})
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "deep"}
          onCheckedChange={() => setFilter("deep")}
          disabled={counts.deep === 0}
        >
          <FlaskConical className="w-3 h-3 mr-1.5 text-purple-400" />
          Deep ({counts.deep})
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "standard"}
          onCheckedChange={() => setFilter("standard")}
          disabled={counts.standard === 0}
        >
          <Sparkles className="w-3 h-3 mr-1.5 text-blue-400" />
          Standard ({counts.standard})
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "favorites"}
          onCheckedChange={() => setFilter("favorites")}
          disabled={counts.favorites === 0}
        >
          <Star className="w-3 h-3 mr-1.5 text-amber-400" />
          Favorites ({counts.favorites})
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "recycled"}
          onCheckedChange={() => setFilter("recycled")}
          disabled={counts.recycled === 0}
        >
          <Recycle className="w-3 h-3 mr-1.5 text-emerald-400" />
          Recycled ({counts.recycled})
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem 
          checked={currentFilter === "custom"}
          onCheckedChange={() => setFilter("custom")}
          disabled={counts.custom === 0}
        >
          <MessageSquare className="w-3 h-3 mr-1.5 text-cyan-400" />
          Custom ({counts.custom})
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  
  const [countdown, setCountdown] = useState("");
  const lastResearchTime = autonomousState?.lastResearchCycleTime || 0;
  const adaptiveIntervalMs = autonomousState?.adaptiveIntervalMs || 2 * 60 * 60 * 1000;
  
  useEffect(() => {
    if (!isPlaying) {
      setCountdown("Paused");
      return;
    }
    
    const updateCountdown = () => {
      if (lastResearchTime === 0) {
        setCountdown("Initializing...");
        return;
      }
      
      const nextRunTime = lastResearchTime + adaptiveIntervalMs;
      const now = Date.now();
      const remaining = nextRunTime - now;
      
      if (remaining <= 0) {
        setCountdown("Research active");
        return;
      }
      
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      
      // Use fixed-width format with zero-padding to prevent layout shift
      const pad = (n: number) => n.toString().padStart(2, '0');
      setCountdown(`${hours}:${pad(minutes)}:${pad(seconds)}`)
    };
    
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, lastResearchTime, adaptiveIntervalMs]);

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      {/* Subheader - Column Headers + Menu in one row */}
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 lg:px-6 py-1.5 -mx-4 lg:-mx-6 bg-card border-b border-border/30">
        {/* Column Headers Grid - 3 columns when QC enabled, 2 columns when disabled */}
        <div className={cn("flex-1 grid gap-3", isQcColumnVisible ? "grid-cols-3" : "grid-cols-2")} data-testid="kanban-header">
          {/* New Column Header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 rounded-lg border border-border/30">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-session">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">New Strategy Session</TooltipContent>
            </Tooltip>
            <Sparkles className="w-4 h-4 text-foreground" />
            <span className="text-sm font-medium">New</span>
            <Badge variant="secondary" className="text-[10px] h-5">
              {columnData.pendingCount}
            </Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(
                  "h-5 px-1.5 text-[10px] gap-1",
                  qcAutoTriggerEnabled ? "text-foreground" : "text-muted-foreground"
                )}>
                  <Zap className="w-3 h-3" />
                  {qcAutoTriggerEnabled ? `${qcAutoTriggerThreshold}%+ ${qcAutoTriggerTier}` : "Off"}
                  {qcBudget && (
                    <span className="text-[9px] font-mono text-muted-foreground">
                      {qcBudget.dailyUsed}/{qcBudget.dailyLimit}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3" side="bottom" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium">Auto-Trigger to QC</div>
                    <Switch 
                      checked={qcAutoTriggerEnabled}
                      disabled={toggleState.isPending}
                      onCheckedChange={(checked) => {
                        setQcAutoTriggerEnabled(checked);
                        handleColumnSettingsSave({ qcAutoTriggerEnabled: checked });
                      }}
                      data-testid="switch-qc-auto-trigger"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <Label className="font-normal">Confidence threshold</Label>
                      <span className="font-mono text-muted-foreground">{qcAutoTriggerThreshold}%</span>
                    </div>
                    <Slider
                      value={[qcAutoTriggerThreshold]}
                      onValueChange={([val]) => setQcAutoTriggerThreshold(val)}
                      onValueCommit={([val]) => handleColumnSettingsSave({ qcAutoTriggerThreshold: val })}
                      min={50} max={100} step={5}
                      disabled={!qcAutoTriggerEnabled || toggleState.isPending}
                      data-testid="slider-qc-threshold"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-normal">Tier filter</Label>
                    <Select
                      value={qcAutoTriggerTier}
                      onValueChange={(val: "A" | "B" | "AB") => {
                        setQcAutoTriggerTier(val);
                        handleColumnSettingsSave({ qcAutoTriggerTier: val });
                      }}
                      disabled={!qcAutoTriggerEnabled || toggleState.isPending}
                    >
                      <SelectTrigger className="w-20 h-7 text-xs" data-testid="select-qc-tier">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">A only</SelectItem>
                        <SelectItem value="B">B only</SelectItem>
                        <SelectItem value="AB">A + B</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {qcBudget && (
                    <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Daily/Weekly Budget</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{qcBudget.dailyUsed}/{qcBudget.dailyLimit}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="font-mono">{qcBudget.weeklyUsed}/{qcBudget.weeklyLimit}</span>
                        <Badge variant="outline" className={cn("text-[8px]", qcBudget.canRun ? "text-emerald-400 border-emerald-500/40" : "text-amber-400 border-amber-500/40")}>
                          {qcBudget.canRun ? "OK" : "Limit"}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex-1" />
            <FilterDropdown 
              columnId="new" 
              currentFilter={newColumnFilter} 
              setFilter={setNewColumnFilter} 
              counts={columnData.newFilterCounts} 
            />
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          
          {/* Testing Column Header - Only visible when QC is enabled */}
          {isQcColumnVisible && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 rounded-lg border border-border/30 text-cyan-400">
            <Shield className="w-4 h-4" />
            <span className="text-sm font-medium">Testing</span>
            <Badge variant="secondary" className="text-[10px] h-5">
              {columnData.testingCount}
            </Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(
                  "h-5 px-1.5 text-[10px] gap-1",
                  trialsAutoPromoteEnabled ? "text-cyan-400" : "text-muted-foreground"
                )}>
                  <Activity className="w-3 h-3" />
                  {trialsAutoPromoteEnabled ? "Auto" : "Manual"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" side="bottom" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium">Auto-Promote to Trials</div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Create TRIALS bots when QC passes thresholds
                      </p>
                    </div>
                    <Switch 
                      checked={trialsAutoPromoteEnabled}
                      disabled={toggleState.isPending}
                      onCheckedChange={(checked) => {
                        setTrialsAutoPromoteEnabled(checked);
                        handleColumnSettingsSave({ trialsAutoPromoteEnabled: checked });
                      }}
                      data-testid="switch-trials-auto-promote"
                    />
                  </div>
                  <div className={cn("grid grid-cols-2 gap-2", !trialsAutoPromoteEnabled && "opacity-50 pointer-events-none")}>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Trades</Label>
                      <Input
                        type="number" min={10} max={500}
                        value={trialsMinTrades}
                        onChange={(e) => setTrialsMinTrades(parseInt(e.target.value) || 50)}
                        onBlur={(e) => handleColumnSettingsSave({ trialsMinTrades: parseInt(e.target.value) || 50 })}
                        className="h-7 text-xs"
                        disabled={!trialsAutoPromoteEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Sharpe</Label>
                      <Input
                        type="number" min={0} max={5} step={0.1}
                        value={trialsMinSharpe}
                        onChange={(e) => setTrialsMinSharpe(parseFloat(e.target.value) || 1.0)}
                        onBlur={(e) => handleColumnSettingsSave({ trialsMinSharpe: parseFloat(e.target.value) || 1.0 })}
                        className="h-7 text-xs"
                        disabled={!trialsAutoPromoteEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Win Rate %</Label>
                      <Input
                        type="number" min={30} max={80}
                        value={trialsMinWinRate}
                        onChange={(e) => setTrialsMinWinRate(parseInt(e.target.value) || 50)}
                        onBlur={(e) => handleColumnSettingsSave({ trialsMinWinRate: parseInt(e.target.value) || 50 })}
                        className="h-7 text-xs"
                        disabled={!trialsAutoPromoteEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Drawdown %</Label>
                      <Input
                        type="number" min={5} max={50}
                        value={trialsMaxDrawdown}
                        onChange={(e) => setTrialsMaxDrawdown(parseInt(e.target.value) || 20)}
                        onBlur={(e) => handleColumnSettingsSave({ trialsMaxDrawdown: parseInt(e.target.value) || 20 })}
                        className="h-7 text-xs"
                        disabled={!trialsAutoPromoteEnabled || toggleState.isPending}
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex-1" />
            <FilterDropdown 
              columnId="testing" 
              currentFilter={testingColumnFilter} 
              setFilter={setTestingColumnFilter} 
              counts={columnData.testingFilterCounts} 
            />
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          )}
          
          {/* Trials Column Header */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/10 rounded-lg border border-border/30 text-amber-400">
            <Rocket className="w-4 h-4" />
            <span className="text-sm font-medium">Trials</span>
            <Badge variant="secondary" className="text-[10px] h-5">
              {columnData.trialsCount}
            </Badge>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className={cn(
                  "h-5 px-1.5 text-[10px] gap-1",
                  fastTrackEnabled ? "text-amber-400" : "text-muted-foreground"
                )}>
                  <Rocket className="w-3 h-3" />
                  {fastTrackEnabled ? "Enabled" : "Off"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-3" side="bottom" align="start">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium">Fast Track to PAPER</div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Skip TRIALS and create bot directly in PAPER if QC results are exceptional
                      </p>
                    </div>
                    <Switch 
                      checked={fastTrackEnabled}
                      disabled={toggleState.isPending}
                      onCheckedChange={(checked) => {
                        setFastTrackEnabled(checked);
                        handleColumnSettingsSave({ fastTrackEnabled: checked });
                      }}
                      data-testid="switch-fast-track"
                    />
                  </div>
                  <div className={cn("grid grid-cols-2 gap-2", !fastTrackEnabled && "opacity-50 pointer-events-none")}>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Trades</Label>
                      <Input
                        type="number" min={10} max={200}
                        value={fastTrackMinTrades}
                        onChange={(e) => setFastTrackMinTrades(parseInt(e.target.value) || 50)}
                        onBlur={(e) => handleColumnSettingsSave({ fastTrackMinTrades: parseInt(e.target.value) || 50 })}
                        className="h-7 text-xs"
                        disabled={!fastTrackEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Sharpe</Label>
                      <Input
                        type="number" min={0} max={5} step={0.1}
                        value={fastTrackMinSharpe}
                        onChange={(e) => setFastTrackMinSharpe(parseFloat(e.target.value) || 1.5)}
                        onBlur={(e) => handleColumnSettingsSave({ fastTrackMinSharpe: parseFloat(e.target.value) || 1.5 })}
                        className="h-7 text-xs"
                        disabled={!fastTrackEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Min Win Rate %</Label>
                      <Input
                        type="number" min={30} max={80}
                        value={fastTrackMinWinRate}
                        onChange={(e) => setFastTrackMinWinRate(parseInt(e.target.value) || 55)}
                        onBlur={(e) => handleColumnSettingsSave({ fastTrackMinWinRate: parseInt(e.target.value) || 55 })}
                        className="h-7 text-xs"
                        disabled={!fastTrackEnabled || toggleState.isPending}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Max Drawdown %</Label>
                      <Input
                        type="number" min={5} max={50}
                        value={fastTrackMaxDrawdown}
                        onChange={(e) => setFastTrackMaxDrawdown(parseInt(e.target.value) || 15)}
                        onBlur={(e) => handleColumnSettingsSave({ fastTrackMaxDrawdown: parseInt(e.target.value) || 15 })}
                        className="h-7 text-xs"
                        disabled={!fastTrackEnabled || toggleState.isPending}
                      />
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <div className="flex-1" />
            <FilterDropdown 
              columnId="trials" 
              currentFilter={trialsColumnFilter} 
              setFilter={setTrialsColumnFilter} 
              counts={columnData.trialsFilterCounts} 
            />
          </div>
        </div>
        
        {/* Right side - Menu */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 3-Dot Menu - Filter, Sort, Bulk Actions, Settings */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" data-testid="button-strategy-lab-menu">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort By
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem 
                checked={sortMode === "confidence"}
                onCheckedChange={() => setSortMode("confidence")}
                data-testid="menu-sort-confidence"
              >
                Confidence (Best First)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={sortMode === "date"}
                onCheckedChange={() => setSortMode("date")}
                data-testid="menu-sort-date"
              >
                Date (Newest First)
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={sortMode === "qc_priority"}
                onCheckedChange={() => setSortMode("qc_priority")}
                data-testid="menu-sort-qc"
              >
                QC Priority (Active First)
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5" />
                Selection
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem 
                checked={multiSelectMode}
                onCheckedChange={(checked) => {
                  setMultiSelectMode(checked);
                  if (!checked) setSelectedIds(new Set());
                }}
                data-testid="menu-multi-select"
              >
                Multi-Select Mode
              </DropdownMenuCheckboxItem>
              {multiSelectMode && selectedIds.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive"
                    onClick={() => setBulkDeleteOpen(true)}
                    data-testid="menu-bulk-delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete Selected ({selectedIds.size})
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Research Actions
              </DropdownMenuLabel>
              <DropdownMenuItem 
                onClick={async () => {
                  try {
                    toast({ title: "Triggering Research...", description: "Starting manual research cycle" });
                    const response = await fetch("/api/strategy-lab/trigger-research", { method: "POST" });
                    const result = await response.json();
                    if (result.success) {
                      toast({ 
                        title: "Research Triggered", 
                        description: result.data 
                          ? `Generated ${result.data.candidatesGenerated || 0} candidates` 
                          : "Research cycle started"
                      });
                      queryClient.invalidateQueries({ queryKey: ["/api/strategy-lab/candidates"] });
                    } else {
                      toast({ title: "Research Failed", description: result.error || "Unknown error", variant: "destructive" });
                    }
                  } catch (error: any) {
                    toast({ title: "Research Failed", description: error.message, variant: "destructive" });
                  }
                }}
                data-testid="menu-force-research"
              >
                <Zap className="h-3.5 w-3.5 mr-2" />
                Force Research Now
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={async () => {
                  try {
                    const response = await fetch("/api/strategy-lab/test-providers");
                    const result = await response.json();
                    if (result.success) {
                      toast({ 
                        title: result.hasProviders ? "AI Providers Configured" : "No AI Providers!", 
                        description: result.message,
                        variant: result.hasProviders ? "default" : "destructive"
                      });
                    } else {
                      toast({ title: "Provider Check Failed", description: result.error, variant: "destructive" });
                    }
                  } catch (error: any) {
                    toast({ title: "Provider Check Failed", description: error.message, variant: "destructive" });
                  }
                }}
                data-testid="menu-test-providers"
              >
                <Activity className="h-3.5 w-3.5 mr-2" />
                Check AI Providers
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => setSettingsDialogOpen(true)}
                data-testid="menu-settings"
              >
                <Settings2 className="h-3.5 w-3.5 mr-2" />
                Strategy Lab Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Candidate(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected strategy candidates will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                bulkDeleteMutation.mutate(
                  { candidate_ids: Array.from(selectedIds) },
                  {
                    onSuccess: () => {
                      setSelectedIds(new Set());
                      setMultiSelectMode(false);
                      setBulkDeleteOpen(false);
                    },
                  }
                );
              }}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* 3-Column Kanban Layout: New → Testing → Trials */}
      {(() => {
        // New column: QUEUED, PENDING_REVIEW, or any disposition that isn't explicitly handled
        // This ensures new dispositions default to "New" column
        const pendingCandidates = candidatesList.filter(c => {
          const d = c.disposition;
          return d !== "SENT_TO_LAB" && d !== "REJECTED" && d !== "QUEUED_FOR_QC";
        });
        const qcTestingCandidates = candidatesList.filter(c => 
          c.disposition === "QUEUED_FOR_QC"
        );
        const sentToLabCandidates = candidatesList.filter(c => 
          c.disposition === "SENT_TO_LAB"
        );
        const rejectedCandidates = candidatesList.filter(c => 
          c.disposition === "REJECTED"
        );
        
        const applyFilter = (list: StrategyCandidate[], filter: FilterType) => {
          switch (filter) {
            case "deep":
              return list.filter(c => c.researchDepth === "DEEP");
            case "standard":
              return list.filter(c => c.researchDepth !== "DEEP");
            case "favorites":
              return list.filter(c => c.isFavorite === true);
            case "recycled":
              return list.filter(c => c.recycledFromId != null);
            case "custom":
              return list.filter(c => c.customFocusUsed && c.customFocusUsed.trim() !== "");
            default:
              return list;
          }
        };
        
        // Get filter counts for a list
        const getFilterCounts = (list: StrategyCandidate[]) => ({
          all: list.length,
          deep: list.filter(c => c.researchDepth === "DEEP").length,
          standard: list.filter(c => c.researchDepth !== "DEEP").length,
          favorites: list.filter(c => c.isFavorite === true).length,
          recycled: list.filter(c => c.recycledFromId != null).length,
          custom: list.filter(c => c.customFocusUsed && c.customFocusUsed.trim() !== "").length,
        });
        
        // Sort by adjusted score (with regime bonus) if available, otherwise base score
        const getEffectiveScore = (c: StrategyCandidate): number => {
          return c.regimeAdjustment?.adjustedScore ?? c.confidenceScore ?? 0;
        };
        
        // QC priority order: RUNNING > QUEUED > VERIFIED > DIVERGENT > INCONCLUSIVE > FAILED > NONE
        const getQcPriority = (c: StrategyCandidate): number => {
          const info = getCandidateQCBadgeInfo(qcVerifications, c.id);
          switch (info.state) {
            case "RUNNING": return 10;
            case "QUEUED": return 9;
            case "VERIFIED": return 8;
            case "DIVERGENT": return 7;
            case "INCONCLUSIVE": return 6;
            case "FAILED": return 5;
            default: return 0;
          }
        };
        
        const sortFn = sortMode === "qc_priority"
          ? (a: StrategyCandidate, b: StrategyCandidate) => {
              const qcDiff = getQcPriority(b) - getQcPriority(a);
              if (qcDiff !== 0) return qcDiff;
              const scoreDiff = getEffectiveScore(b) - getEffectiveScore(a);
              if (scoreDiff !== 0) return scoreDiff;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
          : sortMode === "confidence" 
          ? (a: StrategyCandidate, b: StrategyCandidate) => {
              const scoreDiff = getEffectiveScore(b) - getEffectiveScore(a);
              if (scoreDiff !== 0) return scoreDiff;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
          : (a: StrategyCandidate, b: StrategyCandidate) => 
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        
        const sortedPending = [...applyFilter(pendingCandidates, newColumnFilter)].sort(sortFn);
        const sortedQcTesting = [...applyFilter(qcTestingCandidates, testingColumnFilter)].sort(sortFn);
        const sortedSentToLab = [...applyFilter(sentToLabCandidates, trialsColumnFilter)].sort(sortFn);
        const sortedRejected = [...rejectedCandidates].sort(sortFn);
        
        // Move selected candidates to a target disposition
        const handleMoveSelected = async (targetDisposition: "QUEUED_FOR_QC" | "SENT_TO_LAB" | "REJECTED") => {
          const idsToMove = Array.from(selectedIds);
          if (idsToMove.length === 0) return;
          
          for (const id of idsToMove) {
            const candidate = candidatesList.find(c => c.id === id);
            if (!candidate) continue;
            
            // Don't move if already in target disposition
            if (candidate.disposition === targetDisposition) continue;
            
            if (targetDisposition === "QUEUED_FOR_QC") {
              // Queue for QC testing
              handleRunQCVerification(id);
            } else if (targetDisposition === "SENT_TO_LAB") {
              // Send to trials
              handleSendToLab(id);
            } else if (targetDisposition === "REJECTED") {
              // Reject with default reason
              handleRejectCandidate(id, "LOW_CONFIDENCE", "Bulk rejected via kanban move");
            }
          }
          setSelectedIds(new Set());
        };
        
        // Render a single column body (header is rendered separately in the fixed header row)
        const renderColumnBody = (
          columnId: "new" | "testing" | "trials",
          icon: typeof Sparkles,
          candidates: StrategyCandidate[],
          emptyMessage: string,
          emptySubMessage: string,
          showQC: boolean = false,
          showSendToLab: boolean = false,
          visibleCount: number = 50,
          sentinelRef?: React.RefObject<HTMLDivElement>
        ) => {
          const Icon = icon;
          // Column-specific name colors: Testing = cyan, Trials = amber
          const columnNameColor = columnId === "testing" ? "text-cyan-400" 
            : columnId === "trials" ? "text-amber-400" 
            : undefined;
          
          // Slice to visible count for lazy loading
          const visibleCandidates = candidates.slice(0, visibleCount);
          const hasMore = candidates.length > visibleCount;
          
          return (
            <div 
              className="flex flex-col flex-1 min-h-0 bg-muted/10 rounded-lg border border-border/30 overflow-hidden"
              data-testid={`column-${columnId}`}
            >
              {/* Column Content - independently scrollable, hidden scrollbar for clean look */}
              <ScrollArea className="flex-1 p-2" hideScrollbar>
                {isLoadingCandidates ? (
                  <div className="space-y-1.5">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="p-2.5 rounded-md border border-border/20 bg-card/50 space-y-2 animate-pulse">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <Skeleton className="h-3.5 w-3.5 rounded-full" />
                            <Skeleton className="h-4 w-32" />
                          </div>
                          <Skeleton className="h-5 w-12 rounded" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-20" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : candidates.length > 0 ? (
                  <div className="space-y-1.5">
                    <AnimatePresence mode="popLayout">
                      {visibleCandidates.map((candidate, index) => (
                        <motion.div
                          key={candidate.id}
                          layoutId={candidate.id}
                          initial={{ opacity: 0, y: -8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, x: 50, scale: 0.95 }}
                          transition={{ 
                            type: "spring", 
                            stiffness: 400, 
                            damping: 30,
                            layout: { type: "spring", stiffness: 350, damping: 28 }
                          }}
                        >
                          <StrategyCandidateTableRow
                            key={`row-${candidate.id}-${tick}`}
                            candidate={candidate}
                            rowNumber={index + 1}
                            formatTimeAgo={formatTimeAgo}
                            onSendToLab={showSendToLab ? handleSendToLab : undefined}
                            onReject={handleRejectCandidate}
                            onRestore={handleRestoreCandidate}
                            onRecycle={handleRecycleCandidate}
                            onSaveAsArchetype={handleSaveAsArchetype}
                            onDelete={handleDeleteCandidate}
                            onFavorite={handleFavoriteCandidate}
                            isSending={sendingCandidateId === candidate.id}
                            isRejecting={rejectingCandidateId === candidate.id}
                            nameColorClass={columnNameColor}
                            isRestoring={restoringCandidateId === candidate.id}
                            isRecycling={recyclingCandidateId === candidate.id}
                            isSavingArchetype={savingArchetypeCandidateId === candidate.id}
                            isDeleting={deletingCandidateId === candidate.id}
                            isFavoriting={favoritingCandidateId === candidate.id}
                            showRejectedActions={false}
                            showManualPromote={requireManualApproval}
                            selectable={true}
                            selected={selectedIds.has(candidate.id)}
                            onSelectChange={(id, checked) => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (checked) next.add(id);
                                else next.delete(id);
                                return next;
                              });
                            }}
                            qcBudget={showQC && qcBudget ? { dailyUsed: qcBudget.dailyUsed, dailyLimit: qcBudget.dailyLimit, weeklyUsed: qcBudget.weeklyUsed, weeklyLimit: qcBudget.weeklyLimit, canRun: qcBudget.canRun } : undefined}
                            qcBadgeState={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).state : undefined}
                            qcAttemptCount={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).attemptCount : undefined}
                            qcMaxAttempts={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).maxAttempts : undefined}
                            qcQueuedAt={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).queuedAt : undefined}
                            qcStartedAt={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).startedAt : undefined}
                            qcProgressPct={showQC ? getCandidateQCBadgeInfo(qcVerifications, candidate.id).progressPct : undefined}
                            showQCStatus={showQC}
                            onRunQCVerification={showQC ? handleRunQCVerification : undefined}
                            isRunningQC={showQC && runningQCCandidateId === candidate.id}
                            compact={true}
                          />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {/* Invisible sentinel for lazy loading - triggers when scrolled into view */}
                    {hasMore && sentinelRef && (
                      <div 
                        ref={sentinelRef} 
                        className="h-1 w-full"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center p-4">
                    <div className="rounded-full bg-muted p-2.5 mb-3">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground">{emptyMessage}</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">{emptySubMessage}</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          );
        };
        
        return (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* Selection Controls Bar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 rounded-lg border border-border/40">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {selectedIds.size} selected
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <TooltipProvider>
                    {isQcColumnVisible && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => handleMoveSelected("QUEUED_FOR_QC")}
                        >
                          <Shield className="w-3 h-3 text-cyan-400" />
                          To Testing
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Move selected to QC Testing</TooltipContent>
                    </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={() => handleMoveSelected("SENT_TO_LAB")}
                        >
                          <Rocket className="w-3 h-3 text-violet-400" />
                          To Trials
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Move selected to Trials</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5 text-red-400"
                          onClick={() => handleMoveSelected("REJECTED")}
                        >
                          <XCircle className="w-3 h-3" />
                          Reject
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Reject selected</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            )}
            
            {/* Kanban Body - Independently Scrolling, with spacer to match header */}
            <div className="flex flex-1 min-h-0 items-stretch gap-3">
              <div className={cn("flex-1 grid gap-3 min-h-0", isQcColumnVisible ? "grid-cols-3" : "grid-cols-2")} data-testid="kanban-grid">
                {renderColumnBody(
                  "new",
                  Sparkles,
                  sortedPending,
                  isPlaying ? "Discovering..." : "No new candidates",
                  isPlaying ? "AI is researching new strategies" : "Start research to generate candidates",
                  false,
                  true,
                  newColumnVisible,
                  newSentinelRef
                )}
                {isQcColumnVisible && renderColumnBody(
                  "testing",
                  Shield,
                  sortedQcTesting,
                  "No strategies in testing",
                  "Queue strategies for QC verification",
                  true,
                  false,
                  testingColumnVisible,
                  testingSentinelRef
                )}
                {renderColumnBody(
                  "trials",
                  Rocket,
                  sortedSentToLab,
                  "No bots in trials",
                  isQcColumnVisible ? "Strategies that pass QC go here" : "Send strategies here for trials",
                  isQcColumnVisible,
                  false,
                  trialsColumnVisible,
                  trialsSentinelRef
                )}
              </div>
              {/* Spacer to match header menu width */}
              <div className="w-9 shrink-0" />
            </div>
            
            {/* Rejected Section - Collapsible */}
            {rejectedCandidates.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-between text-muted-foreground"
                    data-testid="toggle-rejected-section"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle className="w-3.5 h-3.5 text-red-400/60" />
                      <span className="text-xs">Rejected</span>
                      <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
                        {rejectedCandidates.length}
                      </Badge>
                    </div>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-1.5 p-2 bg-muted/10 rounded-lg border border-border/30">
                    {sortedRejected.slice(0, 10).map((candidate, index) => (
                      <StrategyCandidateTableRow
                        key={`rejected-${candidate.id}-${tick}`}
                        candidate={candidate}
                        rowNumber={index + 1}
                        formatTimeAgo={formatTimeAgo}
                        onRestore={handleRestoreCandidate}
                        onRecycle={handleRecycleCandidate}
                        onDelete={handleDeleteCandidate}
                        isRestoring={restoringCandidateId === candidate.id}
                        isRecycling={recyclingCandidateId === candidate.id}
                        isDeleting={deletingCandidateId === candidate.id}
                        showRejectedActions={true}
                        selectable={true}
                        selected={selectedIds.has(candidate.id)}
                        onSelectChange={(id, checked) => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(id);
                            else next.delete(id);
                            return next;
                          });
                        }}
                        compact={true}
                      />
                    ))}
                    {rejectedCandidates.length > 10 && (
                      <div className="text-center py-2">
                        <span className="text-xs text-muted-foreground">
                          +{rejectedCandidates.length - 10} more rejected
                        </span>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        );
      })()}

      {/* Sessions List - Row Based Like Bots */}
      {sessionsLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 rounded-md border border-border/20 bg-card/50 space-y-2 animate-pulse">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-36" />
                </div>
                <Skeleton className="h-5 w-14 rounded" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : sessions && sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((session) => (
            <StrategyLabSessionRow
              key={session.id}
              session={session}
              isExpanded={expandedSessionId === session.id}
              onToggleExpanded={() => toggleExpanded(session.id)}
            />
          ))}
        </div>
      )}

      {/* Create Session Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <DialogTitle className="text-lg font-semibold">New Strategy Lab Session</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Configure research mode and target
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="max-h-[65vh]">
            <div className="px-6 py-5 space-y-5">
              {/* Session Mode Toggle */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Session Type</Label>
                <RadioGroup
                  value={newSession.session_mode}
                  onValueChange={(v: 'STANDARD' | 'GENETICS') => setNewSession(s => ({ ...s, session_mode: v }))}
                  className="grid grid-cols-2 gap-2"
                >
                  <Label
                    htmlFor="mode-standard"
                    className={cn(
                      "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all",
                      newSession.session_mode === 'STANDARD'
                        ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                        : "border-border/60 hover:bg-muted/30"
                    )}
                  >
                    <RadioGroupItem value="STANDARD" id="mode-standard" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Standard Research</p>
                      <p className="text-xs text-muted-foreground">Linear AI-guided research</p>
                    </div>
                  </Label>
                  <Label
                    htmlFor="mode-genetics"
                    className={cn(
                      "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all",
                      newSession.session_mode === 'GENETICS'
                        ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/20"
                        : "border-border/60 hover:bg-muted/30"
                    )}
                  >
                    <RadioGroupItem value="GENETICS" id="mode-genetics" />
                    <div className="min-w-0 flex items-center gap-2">
                      <div>
                        <p className="text-sm font-medium flex items-center gap-1">
                          <Dna className="h-3.5 w-3.5 text-emerald-500" />
                          Genetics Session
                        </p>
                        <p className="text-xs text-muted-foreground">Evolve via recombination</p>
                      </div>
                    </div>
                  </Label>
                </RadioGroup>
              </div>

              {/* Session Name - Optional for auto-naming */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  Session Name <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  placeholder={newSession.session_mode === 'GENETICS' 
                    ? "Leave blank for auto-name (e.g., SL • Genetics • MES • 5m • Gen 1)"
                    : "Leave blank for auto-name (e.g., SL • Standard • ES • 5m)"}
                  value={newSession.title}
                  onChange={(e) => setNewSession(s => ({ ...s, title: e.target.value }))}
                  className="h-10"
                />
              </div>

              {/* Genetics-specific options */}
              {newSession.session_mode === 'GENETICS' && (
                <div className="p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Dna className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">Genetics Configuration</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Genetic Pool Size</Label>
                      <div className="flex items-center gap-2">
                        <Slider
                          value={[newSession.genetics_pool_size]}
                          onValueChange={([v]) => setNewSession(s => ({ ...s, genetics_pool_size: v }))}
                          min={10}
                          max={50}
                          step={5}
                          className="flex-1"
                        />
                        <span className="text-sm font-medium w-8 text-right">{newSession.genetics_pool_size}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Recombination Rate</Label>
                      <div className="flex items-center gap-2">
                        <Slider
                          value={[newSession.genetics_recombination_rate * 100]}
                          onValueChange={([v]) => setNewSession(s => ({ ...s, genetics_recombination_rate: v / 100 }))}
                          min={50}
                          max={90}
                          step={5}
                          className="flex-1"
                        />
                        <span className="text-sm font-medium w-10 text-right">{Math.round(newSession.genetics_recombination_rate * 100)}%</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Genomes recombine traits via genetic selection. Higher recombination = faster convergence but less diversity.
                  </p>
                </div>
              )}

              {/* Discovery Mode Toggle */}
              <div 
                className={cn(
                  "flex items-center justify-between p-4 rounded-lg border transition-colors cursor-pointer",
                  newSession.discovery_enabled 
                    ? "border-primary/50 bg-primary/5" 
                    : "border-border/60 bg-card hover:bg-muted/30"
                )}
                onClick={() => setNewSession(s => ({ ...s, discovery_enabled: !s.discovery_enabled }))}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-md",
                    newSession.discovery_enabled ? "bg-primary/10" : "bg-muted"
                  )}>
                    <Compass className={cn(
                      "h-4 w-4",
                      newSession.discovery_enabled ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Discovery Mode</p>
                    <p className="text-xs text-muted-foreground">Auto-find best CME edges</p>
                  </div>
                </div>
                <Switch
                  checked={newSession.discovery_enabled}
                  onCheckedChange={(checked) => setNewSession(s => ({ ...s, discovery_enabled: checked }))}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {newSession.discovery_enabled ? (
                <div className="space-y-5">
                  {/* Universe Selection */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Universe</Label>
                    <Select 
                      value={newSession.universe} 
                      onValueChange={(v) => setNewSession(s => ({ ...s, universe: v }))}
                    >
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNIVERSE_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-xs text-muted-foreground">· {opt.desc}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Contract Preference */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium">Contract Preference</Label>
                    <RadioGroup
                      value={newSession.contract_preference}
                      onValueChange={(v) => setNewSession(s => ({ ...s, contract_preference: v }))}
                      className="grid grid-cols-2 gap-2"
                    >
                      {CONTRACT_PREFERENCE_OPTIONS.map(opt => (
                        <Label
                          key={opt.value}
                          htmlFor={opt.value}
                          className={cn(
                            "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all",
                            newSession.contract_preference === opt.value
                              ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                              : "border-border/60 hover:bg-muted/30"
                          )}
                        >
                          <RadioGroupItem value={opt.value} id={opt.value} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{opt.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{opt.desc}</p>
                          </div>
                        </Label>
                      ))}
                    </RadioGroup>
                    
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-xs text-muted-foreground">Micros preferred for safer scaling</p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Switch
                          id="auto-map"
                          checked={newSession.auto_map_equivalents}
                          onCheckedChange={(checked) => setNewSession(s => ({ ...s, auto_map_equivalents: checked }))}
                        />
                        <span className="text-xs text-muted-foreground">Auto-map equivalents</span>
                      </label>
                    </div>
                  </div>

                  {/* Optimization Info Notice */}
                  <div className="p-3 rounded-lg border border-dashed border-border/50 bg-muted/20">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          The lab optimizes for profitability with balanced risk-adjusted returns. Trade frequency and drawdown targets are auto-selected during validation, or override in Advanced.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Advanced Constraints (Collapsed) */}
                  <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between h-10 px-3 text-sm text-muted-foreground hover:text-foreground">
                        <span className="flex items-center gap-2">
                          <Settings2 className="h-4 w-4" />
                          Advanced
                          {hasAnyConstraintOverride(newSession.constraints) ? (
                            <Badge variant="outline" className="text-[10px] h-5 text-amber-400 border-amber-400/50">Custom</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] h-5">Auto</Badge>
                          )}
                        </span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-3">
                      <div className="space-y-4 p-4 rounded-lg border border-border/60 bg-muted/20">
                        {/* Reset to Auto button */}
                        {hasAnyConstraintOverride(newSession.constraints) && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 text-xs gap-1.5"
                            onClick={() => setNewSession(s => ({ ...s, constraints: { ...DEFAULT_CONSTRAINTS } }))}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reset to Auto
                          </Button>
                        )}
                        
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Min trades/month</span>
                            {newSession.constraints.min_trades_month === null ? (
                              <Badge variant="secondary" className="text-[10px] h-5">Auto</Badge>
                            ) : (
                              <span className="font-medium tabular-nums">{newSession.constraints.min_trades_month}</span>
                            )}
                          </div>
                          <Slider
                            value={[newSession.constraints.min_trades_month ?? 30]}
                            onValueChange={([v]) => setNewSession(s => ({
                              ...s,
                              constraints: { ...s.constraints, min_trades_month: v }
                            }))}
                            min={10}
                            max={100}
                            step={5}
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Max drawdown</span>
                            {newSession.constraints.max_drawdown_pct === null ? (
                              <Badge variant="secondary" className="text-[10px] h-5">Auto</Badge>
                            ) : (
                              <span className="font-medium tabular-nums">{newSession.constraints.max_drawdown_pct}%</span>
                            )}
                          </div>
                          <Slider
                            value={[newSession.constraints.max_drawdown_pct ?? 12]}
                            onValueChange={([v]) => setNewSession(s => ({
                              ...s,
                              constraints: { ...s.constraints, max_drawdown_pct: v }
                            }))}
                            min={5}
                            max={30}
                            step={1}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Holding Time</Label>
                            <Select
                              value={newSession.constraints.holding_time ?? "auto"}
                              onValueChange={(v) => setNewSession(s => ({
                                ...s,
                                constraints: { ...s.constraints, holding_time: v === "auto" ? null : v }
                              }))}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  <span className="flex items-center gap-1.5">Auto <Badge variant="secondary" className="text-[9px] h-4 ml-1">recommended</Badge></span>
                                </SelectItem>
                                <SelectItem value="scalp">Scalp (minutes)</SelectItem>
                                <SelectItem value="intraday">Intraday (hours)</SelectItem>
                                <SelectItem value="swing-intraday">Swing-Intraday</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Session Hours</Label>
                            <Select
                              value={newSession.constraints.session_hours ?? "auto"}
                              onValueChange={(v) => setNewSession(s => ({
                                ...s,
                                constraints: { ...s.constraints, session_hours: v === "auto" ? null : v }
                              }))}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto">
                                  <span className="flex items-center gap-1.5">Auto <Badge variant="secondary" className="text-[9px] h-4 ml-1">recommended</Badge></span>
                                </SelectItem>
                                <SelectItem value="RTH">RTH Only</SelectItem>
                                <SelectItem value="ETH">ETH Only</SelectItem>
                                <SelectItem value="BOTH">Both RTH & ETH</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Start Auto */}
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Switch
                      id="start-auto"
                      checked={newSession.start_auto}
                      onCheckedChange={(checked) => setNewSession(s => ({ ...s, start_auto: checked }))}
                    />
                    <span className="text-sm">Start automatically after create</span>
                  </label>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Standard Symbol/Timeframe */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Symbol</Label>
                      <Select value={newSession.symbol} onValueChange={(v) => setNewSession(s => ({ ...s, symbol: v }))}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Timeframe</Label>
                      <Select value={newSession.timeframe} onValueChange={(v) => setNewSession(s => ({ ...s, timeframe: v }))}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TIMEFRAMES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {/* Research + Run Mode */}
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Research Mode</Label>
                  <Select value={newSession.research_mode} onValueChange={(v: any) => setNewSession(s => ({ ...s, research_mode: v }))}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CLOSED">
                        <span className="flex items-center gap-2"><Lock className="h-3.5 w-3.5" /> Closed-World</span>
                      </SelectItem>
                      <SelectItem value="OPEN">
                        <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> Open-World</span>
                      </SelectItem>
                      <SelectItem value="HYBRID">
                        <span className="flex items-center gap-2"><Zap className="h-3.5 w-3.5" /> Hybrid</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Run Mode</Label>
                  <Select value={newSession.run_mode} onValueChange={(v: any) => setNewSession(s => ({ ...s, run_mode: v }))}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INTERACTIVE">Interactive</SelectItem>
                      <SelectItem value="AUTOPILOT">Autopilot</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </ScrollArea>
          
          <DialogFooter className="px-6 py-4 border-t border-border/40 bg-muted/20">
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateSession} disabled={createSession.isPending}>
              {createSession.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Create Session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionCard({ session, isSelected, onClick }: { session: StrategyLabSession; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border cursor-pointer transition-colors",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{session.name}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {session.discovery_enabled ? (
              <>
                <Badge variant="secondary" className="text-[9px] h-4 gap-0.5">
                  <Compass className="h-2.5 w-2.5" />
                  Discovery
                </Badge>
                <Badge variant="outline" className="text-[9px] h-4">{session.universe || 'CME'}</Badge>
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-[9px] h-4">{session.symbol}</Badge>
                <Badge variant="outline" className="text-[9px] h-4">{session.research_mode}</Badge>
              </>
            )}
          </div>
        </div>
        <StatusBadge status={session.status} />
      </div>
      <div className="flex items-center gap-2 mt-2">
        {session.total_ai_cost_usd > 0 && (
          <Badge variant="outline" className="text-[9px] h-4 gap-1">
            <DollarSign className="h-2.5 w-2.5 text-emerald-400" />
            ${session.total_ai_cost_usd.toFixed(2)}
          </Badge>
        )}
        {session.last_activity_at && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            {formatRelativeTime(session.last_activity_at)}
          </span>
        )}
      </div>
      {session.current_step && session.status === 'RUNNING' && (
        <p className="text-[10px] text-blue-400 mt-1.5 truncate animate-pulse">
          → {session.current_step.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
    IDLE: { color: "bg-muted text-muted-foreground", icon: Clock },
    RUNNING: { color: "bg-blue-500/20 text-blue-400", icon: RefreshCw },
    PAUSED: { color: "bg-amber-500/20 text-amber-400", icon: Pause },
    COMPLETED: { color: "bg-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
    FAILED: { color: "bg-destructive/20 text-destructive", icon: XCircle },
    DRAFT: { color: "bg-muted text-muted-foreground", icon: Microscope },
  };
  const { color, icon: Icon } = config[status] || config.IDLE;

  return (
    <Badge variant="outline" className={cn("text-[10px] gap-1", color)}>
      <Icon className={cn("h-3 w-3", status === 'RUNNING' && "animate-spin")} />
      {status}
    </Badge>
  );
}

function StepCard({ step }: { step: StrategyLabStep }) {
  const config = STEP_CONFIG[step.step_type] || { icon: Brain, label: step.step_type, color: "text-muted-foreground" };
  const Icon = config.icon;
  const isRunning = step.status === 'RUNNING';
  const isDone = step.status === 'DONE';
  const isFailed = step.status === 'FAILED';

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      isRunning && "border-blue-500/50 bg-blue-500/5",
      isDone && "border-emerald-500/30 bg-emerald-500/5",
      isFailed && "border-destructive/30 bg-destructive/5"
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", config.color, isRunning && "animate-pulse")} />
        <span className="text-sm font-medium">{config.label}</span>
        <Badge variant="outline" className={cn(
          "text-[9px] ml-auto",
          isDone && "bg-emerald-500/20 text-emerald-400",
          isRunning && "bg-blue-500/20 text-blue-400",
          isFailed && "bg-destructive/20 text-destructive"
        )}>
          {step.status}
        </Badge>
      </div>
      {step.output_json && Object.keys(step.output_json).length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground max-h-20 overflow-hidden">
          {step.output_json.text 
            ? String(step.output_json.text).slice(0, 200) + (String(step.output_json.text).length > 200 ? '...' : '')
            : JSON.stringify(step.output_json).slice(0, 200)}
        </div>
      )}
      {step.error_detail && (
        <div className="mt-2 text-xs text-destructive">
          {step.error_code}: {step.error_detail}
        </div>
      )}
      {step.finished_at && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {new Date(step.finished_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: StrategyLabSource }) {
  return (
    <div className="p-2 rounded-lg border border-border/50 bg-muted/20">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[9px]">{source.citation_key || 'S?'}</Badge>
        <span className="text-xs font-medium truncate">{source.title}</span>
      </div>
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:underline truncate block mt-1">
          {source.url}
        </a>
      )}
      <div className="flex items-center gap-2 mt-1">
        <Badge variant="outline" className="text-[9px]">{source.source_type}</Badge>
        <span className="text-[9px] text-muted-foreground">
          Reliability: {(source.reliability_score * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function CandidateCard({ candidate, onExport, isExporting }: { 
  candidate: StrategyLabCandidate; 
  onExport?: () => void;
  isExporting?: boolean;
}) {
  const blueprint = candidate.blueprint as any;
  const scores = candidate.scores as any;
  
  return (
    <div className={cn(
      "p-3 rounded-lg border",
      candidate.status === 'FINALIST' && "border-emerald-500/50 bg-emerald-500/5",
      candidate.status === 'PASSED' && "border-emerald-500/50 bg-emerald-500/5",
      candidate.status === 'EXPORTED' && "border-primary/50 bg-primary/5",
      candidate.status === 'REJECTED' && "border-muted opacity-50",
      candidate.status === 'FAILED' && "border-destructive/30 opacity-50"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {candidate.rank && (
            <Badge variant="secondary" className="text-[10px] h-5 w-5 p-0 justify-center">
              #{candidate.rank}
            </Badge>
          )}
          <div>
            <p className="text-sm font-medium">{blueprint?.name || 'Unnamed'}</p>
            <p className="text-[10px] text-muted-foreground">{blueprint?.archetype || 'Unknown archetype'}</p>
          </div>
        </div>
        <Badge variant="outline" className={cn(
          "text-[9px]",
          (candidate.status === 'FINALIST' || candidate.status === 'PASSED') && "bg-emerald-500/20 text-emerald-400",
          candidate.status === 'EXPORTED' && "bg-primary/20 text-primary",
          candidate.status === 'VALIDATING' && "bg-blue-500/20 text-blue-400"
        )}>
          {candidate.status}
        </Badge>
      </div>
      
      {/* Symbols/Timeframes */}
      <div className="flex flex-wrap gap-1 mt-2">
        {blueprint?.symbol_candidates?.slice(0, 4).map((s: string) => (
          <Badge key={s} variant="outline" className="text-[9px]">{s}</Badge>
        ))}
        {blueprint?.timeframe_candidates?.slice(0, 2).map((t: string) => (
          <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>
        ))}
      </div>

      {/* Scores */}
      {scores?.aggregate && (
        <div className="grid grid-cols-4 gap-1 mt-2 text-[10px]">
          <div className="text-center">
            <p className="text-muted-foreground">PF</p>
            <p className="font-medium">{scores.aggregate.profit_factor?.toFixed(2) || '-'}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Win%</p>
            <p className="font-medium">{scores.aggregate.win_rate ? (scores.aggregate.win_rate * 100).toFixed(0) + '%' : '-'}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">MaxDD</p>
            <p className="font-medium">{scores.aggregate.max_drawdown_pct ? scores.aggregate.max_drawdown_pct.toFixed(1) + '%' : '-'}</p>
          </div>
          <div className="text-center">
            <p className="text-muted-foreground">Score</p>
            <p className="font-medium text-primary">{scores.robustness_score?.toFixed(0) || '-'}</p>
          </div>
        </div>
      )}

      {/* Export Buttons */}
      {(candidate.status === 'FINALIST' || candidate.status === 'PASSED') && onExport && (
        <Button 
          size="sm" 
          variant="outline" 
          className="w-full mt-2 h-7 text-xs"
          onClick={onExport}
          disabled={isExporting}
        >
          {isExporting ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <ExternalLink className="h-3 w-3 mr-1" />
          )}
          Export to Lab
        </Button>
      )}
      
      {/* Rejection reason */}
      {candidate.rejection_reason && (
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          {candidate.rejection_reason}
        </p>
      )}
    </div>
  );
}

function CostBadge({ stats }: { stats: { totalCost: number; totalTokensIn: number; totalTokensOut: number; byProvider: Record<string, { cost: number; calls: number }> } }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="text-xs gap-1 cursor-help">
            <DollarSign className="h-3 w-3" />
            ${stats.totalCost.toFixed(4)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="w-64">
          <div className="space-y-2">
            <div className="text-xs font-medium">Cost Breakdown</div>
            <div className="text-[10px] space-y-1">
              {Object.entries(stats.byProvider).map(([provider, data]) => (
                <div key={provider} className="flex justify-between">
                  <span>{provider}</span>
                  <span>${data.cost.toFixed(4)} ({data.calls} calls)</span>
                </div>
              ))}
            </div>
            <Separator />
            <div className="text-[10px]">
              Tokens: {stats.totalTokensIn.toLocaleString()} in / {stats.totalTokensOut.toLocaleString()} out
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function TaskProgressBar({ tasks }: { tasks: StrategyLabTask[] }) {
  const succeeded = tasks.filter(t => t.status === 'SUCCEEDED').length;
  const running = tasks.filter(t => t.status === 'RUNNING').length;
  const failed = tasks.filter(t => t.status === 'FAILED').length;
  const total = tasks.length;
  const pct = total > 0 ? (succeeded / total) * 100 : 0;
  
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn(
            "h-full transition-all",
            failed > 0 ? "bg-destructive" : running > 0 ? "bg-blue-500" : "bg-emerald-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {succeeded}/{total}
      </span>
    </div>
  );
}

function TaskCard({ task }: { task: StrategyLabTask }) {
  const config = STEP_CONFIG[task.task_type] || { icon: Brain, label: task.task_type, color: "text-muted-foreground" };
  const Icon = config.icon;
  const isRunning = task.status === 'RUNNING';
  const isDone = task.status === 'SUCCEEDED';
  const isFailed = task.status === 'FAILED';
  const isQueued = task.status === 'QUEUED';

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      isRunning && "border-blue-500/50 bg-blue-500/5",
      isDone && "border-emerald-500/30 bg-emerald-500/5",
      isFailed && "border-destructive/30 bg-destructive/5",
      isQueued && "border-border/50 opacity-60"
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", config.color, isRunning && "animate-pulse")} />
        <span className="text-sm font-medium">{config.label}</span>
        <Badge variant="outline" className={cn(
          "text-[9px] ml-auto",
          isDone && "bg-emerald-500/20 text-emerald-400",
          isRunning && "bg-blue-500/20 text-blue-400",
          isFailed && "bg-destructive/20 text-destructive",
          isQueued && "bg-muted text-muted-foreground"
        )}>
          {task.status}
        </Badge>
      </div>
      
      {/* Result preview */}
      {task.result && Object.keys(task.result).length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground max-h-16 overflow-hidden">
          {JSON.stringify(task.result).slice(0, 150)}...
        </div>
      )}
      
      {/* Error display */}
      {task.error_message && (
        <div className="mt-2 text-xs text-destructive">
          {task.error_code}: {task.error_message}
        </div>
      )}
      
      {/* Timing info */}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
        {task.attempts > 1 && (
          <span>Attempts: {task.attempts}</span>
        )}
        {task.finished_at && (
          <span className="ml-auto">{new Date(task.finished_at).toLocaleTimeString()}</span>
        )}
        {isRunning && task.started_at && (
          <span className="ml-auto">Started {formatRelativeTime(task.started_at)}</span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      <Microscope className="h-8 w-8 mx-auto mb-2 opacity-50" />
      <p>No sessions yet</p>
      <p className="text-xs">Create one to start</p>
    </div>
  );
}
