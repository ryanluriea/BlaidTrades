import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { authenticatedFetch } from "@/lib/fetch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  GitBranch, Clock, ArrowUp, FileJson, FileText, 
  TrendingUp, TrendingDown, Target, Shield, Activity,
  Zap, BarChart3, BookOpen, Bot, CheckCircle2, XCircle, AlertTriangle
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { useTimezone } from "@/hooks/useTimezone";
import { cn } from "@/lib/utils";
import { UNIFIED_STAGE_THRESHOLDS, type GateThresholds } from "@shared/graduationGates";
import { AlphaDecayDetail } from "./AlphaDecayBadge";

interface GenerationRecord {
  id: string;
  botId: string;
  generationNumber: number;
  parentGenerationNumber: number | null;
  createdByJobId: string | null;
  mutationReasonCode: string | null;
  mutationObjective: string | null;
  summaryTitle: string | null;
  summaryDiff: string | null;
  humanRulesMd: string | null;
  performanceSnapshot: Record<string, unknown> | null;
  versionMajor: number | null;
  versionMinor: number | null;
  createdAt: string;
  notes: string | null;
  stage?: string;
  timeframe?: string | null;
  // SEV-1: Institutional rules versioning
  beforeRulesHash?: string | null;
  afterRulesHash?: string | null;
  rulesDiffSummary?: string | null;
  performanceDeltas?: Record<string, unknown> | null;
  // SEV-1: TRIALS Baseline Tracking
  baselineValid?: boolean | null;
  baselineFailureReason?: string | null;
  baselineBacktestId?: string | null;
  baselineMetrics?: Record<string, unknown> | null;
}

function getStageBadgeStyle(stage: string): string {
  switch (stage?.toUpperCase()) {
    case 'TRIALS':
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "PAPER":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "SHADOW":
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "CANARY":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "LIVE":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

interface GenerationHistoryModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
  currentGeneration?: number;
  stage?: string;
}

function getMutationLabel(code: string | null): { label: string; color: string } {
  switch (code) {
    case "EVOLVED":
    case "LAB_CONTINUOUS_EVOLUTION":
      return { label: "Evolved", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
    case "MANUAL":
      return { label: "Manual", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
    case "INITIAL":
      return { label: "Initial", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
    case "PARAM_MUTATION":
      return { label: "Optimized", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
    case "CROSSOVER":
      return { label: "Crossover", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" };
    case "PAPER_VALIDATED":
      return { label: "Paper Validated", color: "bg-green-500/20 text-green-400 border-green-500/30" };
    case "PROMOTED":
      return { label: "Promoted", color: "bg-green-500/20 text-green-400 border-green-500/30" };
    case "REVERTED":
      return { label: "Reverted", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
    default:
      return { label: code || "Unknown", color: "bg-muted text-muted-foreground" };
  }
}

interface GateResult {
  name: string;
  current: number | string | null;
  goal: number | string;
  passed: boolean;
  gap: string;
  direction: 'min' | 'max' | 'eq';
  unit: string;
}

function evaluateGates(snapshot: Record<string, unknown>, thresholds: GateThresholds): { gates: GateResult[], passed: number, total: number } {
  const gates: GateResult[] = [];
  
  const trades = (snapshot.backtestTotalTrades ?? snapshot.totalTrades ?? snapshot.trades ?? 0) as number;
  
  // CONSISTENCY CHECK: If trades is 0, all metrics are invalid
  // You cannot have P&L, win rate, etc. without trades
  const hasValidTrades = trades > 0;
  
  const rawWinRate = (snapshot.backtestWinRate ?? snapshot.winRate ?? snapshot.latestWinRate ?? null) as number | null;
  const rawMaxDd = (snapshot.backtestMaxDd ?? snapshot.maxDrawdown ?? snapshot.latestMaxDd ?? null) as number | null;
  const rawPf = (snapshot.backtestProfitFactor ?? snapshot.profitFactor ?? snapshot.latestProfitFactor ?? null) as number | null;
  const rawSharpe = (snapshot.backtestSharpe ?? snapshot.sharpe ?? snapshot.latestSharpe ?? null) as number | null;
  const rawExpectancy = (snapshot.expectancy ?? snapshot.latestExpectancy ?? null) as number | null;
  const rawPnl = (snapshot.backtestPnl ?? snapshot.pnl ?? snapshot.simPnl ?? snapshot.latestPnl ?? null) as number | null;
  const rawLosers = (snapshot.losingTrades ?? snapshot.losers ?? null) as number | null;
  
  // Only use metrics if we have valid trades
  const winRate = hasValidTrades ? rawWinRate : null;
  const maxDd = hasValidTrades ? rawMaxDd : null;
  const pf = hasValidTrades ? rawPf : null;
  const sharpe = hasValidTrades ? rawSharpe : null;
  const expectancy = hasValidTrades ? rawExpectancy : null;
  const pnl = hasValidTrades ? rawPnl : null;
  const losers = hasValidTrades ? rawLosers : null;
  
  const winRatePct = winRate !== null ? (winRate <= 1 ? winRate * 100 : winRate) : null;
  
  gates.push({
    name: 'Trades',
    current: trades,
    goal: thresholds.minTrades,
    passed: trades >= thresholds.minTrades,
    gap: trades >= thresholds.minTrades ? `+${trades - thresholds.minTrades}` : `${trades - thresholds.minTrades}`,
    direction: 'min',
    unit: '',
  });
  
  gates.push({
    name: 'Win Rate',
    current: winRatePct,
    goal: thresholds.minWinRate,
    passed: winRatePct !== null && winRatePct >= thresholds.minWinRate,
    gap: winRatePct !== null 
      ? (winRatePct >= thresholds.minWinRate ? `+${(winRatePct - thresholds.minWinRate).toFixed(1)}%` : `${(winRatePct - thresholds.minWinRate).toFixed(1)}%`)
      : 'N/A',
    direction: 'min',
    unit: '%',
  });
  
  gates.push({
    name: 'Max DD',
    current: maxDd,
    goal: thresholds.maxDrawdownPct,
    passed: maxDd !== null && maxDd > 0 && maxDd <= thresholds.maxDrawdownPct,
    gap: maxDd !== null 
      ? (maxDd <= thresholds.maxDrawdownPct ? `${(thresholds.maxDrawdownPct - maxDd).toFixed(1)}% margin` : `${(maxDd - thresholds.maxDrawdownPct).toFixed(1)}% over`)
      : 'N/A',
    direction: 'max',
    unit: '%',
  });
  
  gates.push({
    name: 'Profit Factor',
    current: pf,
    goal: thresholds.minProfitFactor,
    passed: pf !== null && pf >= thresholds.minProfitFactor,
    gap: pf !== null 
      ? (pf >= thresholds.minProfitFactor ? `+${(pf - thresholds.minProfitFactor).toFixed(2)}x` : `${(pf - thresholds.minProfitFactor).toFixed(2)}x`)
      : 'N/A',
    direction: 'min',
    unit: 'x',
  });
  
  gates.push({
    name: 'Sharpe',
    current: sharpe,
    goal: thresholds.minSharpe,
    passed: sharpe !== null && sharpe >= thresholds.minSharpe,
    gap: sharpe !== null 
      ? (sharpe >= thresholds.minSharpe ? `+${(sharpe - thresholds.minSharpe).toFixed(2)}` : `${(sharpe - thresholds.minSharpe).toFixed(2)}`)
      : 'N/A',
    direction: 'min',
    unit: '',
  });
  
  if (thresholds.minExpectancy > 0) {
    gates.push({
      name: 'Expectancy',
      current: expectancy,
      goal: thresholds.minExpectancy,
      passed: expectancy !== null && expectancy >= thresholds.minExpectancy,
      gap: expectancy !== null 
        ? (expectancy >= thresholds.minExpectancy ? `+$${(expectancy - thresholds.minExpectancy).toFixed(0)}` : `-$${(thresholds.minExpectancy - expectancy).toFixed(0)}`)
        : 'N/A',
      direction: 'min',
      unit: '$',
    });
  }
  
  if (thresholds.requireProfitable) {
    const isProfitable = pnl !== null && pnl > 0;
    gates.push({
      name: 'Profitable',
      current: pnl !== null ? (pnl > 0 ? 'Yes' : 'No') : null,
      goal: 'Yes',
      passed: isProfitable,
      gap: pnl !== null ? (isProfitable ? `$${pnl.toFixed(0)}` : `$${pnl.toFixed(0)}`) : 'N/A',
      direction: 'eq',
      unit: '',
    });
  }
  
  if (thresholds.requireHasLosers) {
    const hasLosers = losers !== null && losers > 0;
    gates.push({
      name: 'Has Losers',
      current: losers !== null ? (losers > 0 ? 'Yes' : 'No') : null,
      goal: 'Yes',
      passed: hasLosers,
      gap: losers !== null ? `${losers} losing` : 'N/A',
      direction: 'eq',
      unit: '',
    });
  }
  
  const passed = gates.filter(g => g.passed).length;
  return { gates, passed, total: gates.length };
}

function TimelineItem({ 
  gen, 
  isActive, 
  isSelected, 
  onClick, 
  formatDateTime,
}: { 
  gen: GenerationRecord; 
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  formatDateTime: (date: string) => string;
}) {
  const mutationInfo = getMutationLabel(gen.mutationReasonCode);
  const genStage = gen.stage || (gen.performanceSnapshot as any)?._stage || 'TRIALS';
  
  return (
    <div
      onClick={onClick}
      data-testid={`generation-item-${gen.generationNumber}`}
      className={cn(
        "relative flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors",
        isSelected ? "bg-primary/10 border border-primary/30" : "hover-elevate",
        isActive && !isSelected && "bg-muted/30"
      )}
    >
      <div className={cn(
        "flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-mono shrink-0 transition-colors",
        isActive 
          ? "bg-primary text-primary-foreground" 
          : isSelected
          ? "bg-primary/20 text-primary border border-primary/50"
          : "bg-muted text-muted-foreground"
      )}>
        {gen.generationNumber}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 flex-wrap">
          {isActive && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-primary border-primary/50">
              Active
            </Badge>
          )}
          <Badge className={cn("text-[9px] px-1.5 py-0", getStageBadgeStyle(genStage))}>
            {genStage}
          </Badge>
          <Badge className={cn("text-[9px] px-1.5 py-0", mutationInfo.color)}>
            {mutationInfo.label}
          </Badge>
          {gen.timeframe && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono text-muted-foreground border-muted-foreground/30">
              {gen.timeframe}
            </Badge>
          )}
          {gen.baselineValid !== undefined && gen.baselineValid !== null && (
            <Badge 
              className={cn(
                "text-[9px] px-1 py-0",
                gen.baselineValid 
                  ? "bg-green-500/20 text-green-400 border-green-500/30" 
                  : "bg-red-500/20 text-red-400 border-red-500/30"
              )}
            >
              {gen.baselineValid ? "Baseline OK" : gen.baselineFailureReason || "No Baseline"}
            </Badge>
          )}
          {gen.parentGenerationNumber && (
            <span className="text-[9px] text-muted-foreground/60 flex items-center gap-0.5">
              <ArrowUp className="w-2.5 h-2.5" /> from {gen.parentGenerationNumber}
            </span>
          )}
        </div>
        {gen.summaryTitle && (
          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{gen.summaryTitle}</p>
        )}
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          {formatDateTime(gen.createdAt)}
        </p>
      </div>
    </div>
  );
}

function GateIndicator({ gate }: { gate: GateResult }) {
  const Icon = gate.passed ? CheckCircle2 : XCircle;
  const colorClass = gate.passed ? "text-green-400" : "text-red-400";
  const bgClass = gate.passed ? "bg-green-500/10" : "bg-red-500/10";
  
  const formatValue = (value: number | string | null, unit: string): string => {
    if (value === null) return '-';
    if (typeof value === 'string') return value;
    const decimals = unit === '%' || unit === 'x' ? 1 : unit === '$' ? 0 : 0;
    return `${value.toFixed(decimals)}${unit}`;
  };
  
  const getComparisonSymbol = (direction: 'min' | 'max' | 'eq'): string => {
    if (direction === 'min') return '≥';
    if (direction === 'max') return '≤';
    return '=';
  };
  
  return (
    <div className={cn("flex items-center gap-2 p-2.5 rounded-md", bgClass)}>
      <Icon className={cn("w-4 h-4 shrink-0", colorClass)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{gate.name}</span>
          <span className={cn("text-[10px]", gate.passed ? "text-green-400" : "text-red-400")}>
            {gate.gap}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-sm font-mono font-medium">
            {formatValue(gate.current, gate.unit)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {getComparisonSymbol(gate.direction)} {typeof gate.goal === 'number' ? `${gate.goal}${gate.unit}` : gate.goal}
          </span>
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ 
  gen, 
  stage,
  botName,
}: { 
  gen: GenerationRecord | null;
  stage: string;
  botName: string;
}) {
  if (!gen) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <p className="text-sm">Select a generation to view details</p>
      </div>
    );
  }

  const snapshot = gen.performanceSnapshot || {};
  // Use the generation's own stage for thresholds (not bot's current stage)
  const genStage = gen.stage || (snapshot as any)?._stage || stage || 'TRIALS';
  const thresholds = UNIFIED_STAGE_THRESHOLDS[genStage.toUpperCase()] ?? UNIFIED_STAGE_THRESHOLDS.TRIALS;
  const { gates, passed, total } = evaluateGates(snapshot, thresholds);
  
  // CONSISTENCY CHECK: Only show P&L if we have valid trades
  const trades = (snapshot.backtestTotalTrades ?? snapshot.totalTrades ?? snapshot.trades ?? 0) as number;
  const hasValidTrades = trades > 0;
  const rawPnl = (snapshot.backtestPnl ?? snapshot.pnl ?? snapshot.simPnl ?? snapshot.latestPnl ?? null) as number | null;
  const pnl = hasValidTrades ? rawPnl : null;
  const metricsSource = (snapshot as any)?._source || "computed";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-medium">Performance vs Goals</h4>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge 
            variant={passed === total ? "default" : passed >= total / 2 ? "secondary" : "destructive"}
            className="text-xs"
          >
            {passed}/{total} Gates
          </Badge>
          <Badge className={cn("text-[10px]", getStageBadgeStyle(genStage))}>
            {genStage}
          </Badge>
          <Badge variant="secondary" className="text-[10px] font-mono">
            Gen {gen.generationNumber}
          </Badge>
          {gen.timeframe && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {gen.timeframe}
            </Badge>
          )}
        </div>
      </div>
      
      {metricsSource !== "snapshot" && (
        <div className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          <span>Metrics from: {metricsSource === "backtest_sessions" ? "Backtest Sessions" : metricsSource === "paper_trades" ? "Paper Trades" : metricsSource}</span>
        </div>
      )}
      
      {pnl !== null && (
        <div className={cn(
          "p-3 rounded-md flex items-center justify-between",
          pnl >= 0 ? "bg-green-500/10 border border-green-500/20" : "bg-red-500/10 border border-red-500/20"
        )}>
          <div className="flex items-center gap-2">
            {pnl >= 0 ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
            <span className="text-sm text-muted-foreground">Net P&L</span>
          </div>
          <span className={cn("text-lg font-mono font-bold", pnl >= 0 ? "text-green-400" : "text-red-400")}>
            ${pnl.toFixed(2)}
          </span>
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-2">
        {gates.map((gate) => (
          <GateIndicator key={gate.name} gate={gate} />
        ))}
      </div>
      
      <AlphaDecayDetail botId={gen.botId} />
      
      {(gen.mutationObjective || gen.summaryDiff) && (
        <div className="pt-4 border-t border-border space-y-3">
          {gen.mutationObjective && (
            <div>
              <h5 className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-primary">
                <Target className="w-3 h-3" />
                Evolution Objective
              </h5>
              <p className="text-xs text-muted-foreground bg-primary/5 p-2 rounded">
                {gen.mutationObjective}
              </p>
            </div>
          )}
          {gen.summaryDiff && (
            <div>
              <h5 className="text-xs font-medium mb-1.5 flex items-center gap-1.5 text-amber-400">
                <Zap className="w-3 h-3" />
                Changes from Previous
              </h5>
              <p className="text-xs text-muted-foreground bg-amber-500/5 p-2 rounded font-mono">
                {gen.summaryDiff}
              </p>
            </div>
          )}
        </div>
      )}
      
      {gen.humanRulesMd && (
        <div className="pt-4 border-t border-border">
          <h5 className="text-xs font-medium mb-2 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-sky-400" />
            Strategy Rules
          </h5>
          <div className="p-3 bg-muted/30 rounded-md">
            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
              {gen.humanRulesMd}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function GenerationHistoryModal({
  isOpen,
  onOpenChange,
  botId,
  botName,
  currentGeneration: propCurrentGeneration,
  stage,
}: GenerationHistoryModalProps) {
  const { formatShortDateTime } = useTimezone();
  const [selectedGenId, setSelectedGenId] = useState<string | null>(null);
  
  useEffect(() => {
    if (!isOpen) {
      setSelectedGenId(null);
    }
  }, [isOpen]);
  
  const { data: botData } = useQuery<{ success: boolean; data: Record<string, unknown> }>({
    queryKey: ['modal-bot-data', botId],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/bots/${botId}`);
      if (!res.ok) throw new Error("Failed to fetch bot");
      return res.json();
    },
    enabled: isOpen && !!botId,
    staleTime: 30000,
  });
  
  const botDataObj = botData?.data ?? {};
  const currentGeneration = (
    (botDataObj.currentGeneration as number) ?? 
    (botDataObj.current_generation as number) ?? 
    propCurrentGeneration ?? 
    1
  );
  const currentGenerationId = (botDataObj.currentGenerationId as string) ?? 
    (botDataObj.current_generation_id as string) ?? null;
  const botStage = stage || (botDataObj.stage as string) || 'TRIALS';
  
  const { data, isLoading, error } = useQuery<{ success: boolean; data: GenerationRecord[] }>({
    queryKey: ['bot-generations', botId],
    queryFn: async () => {
      const res = await authenticatedFetch(`/api/bot-generations/${botId}`);
      if (!res.ok) throw new Error("Failed to fetch generations");
      return res.json();
    },
    enabled: isOpen && !!botId,
    staleTime: 30000,
    refetchOnMount: 'always',
  });
  
  const generations = useMemo(() => {
    const rawGenerations = data?.data ?? [];
    
    const byNumber = new Map<number, GenerationRecord>();
    for (const gen of rawGenerations) {
      const existing = byNumber.get(gen.generationNumber);
      if (!existing || new Date(gen.createdAt) > new Date(existing.createdAt)) {
        byNumber.set(gen.generationNumber, gen);
      }
    }
    
    const deduped = Array.from(byNumber.values());
    
    return deduped.sort((a, b) => {
      const aIsActive = currentGenerationId ? a.id === currentGenerationId : a.generationNumber === currentGeneration;
      const bIsActive = currentGenerationId ? b.id === currentGenerationId : b.generationNumber === currentGeneration;
      if (aIsActive && !bIsActive) return -1;
      if (bIsActive && !aIsActive) return 1;
      return b.generationNumber - a.generationNumber;
    });
  }, [data, currentGeneration, currentGenerationId]);
  
  const activeGeneration = useMemo(() => {
    if (currentGenerationId) {
      return generations.find(g => g.id === currentGenerationId);
    }
    return generations.find(g => g.generationNumber === currentGeneration);
  }, [generations, currentGeneration, currentGenerationId]);
  
  const selectedGen = useMemo(() => {
    if (selectedGenId) {
      return generations.find(g => g.id === selectedGenId) || null;
    }
    return activeGeneration || generations[0] || null;
  }, [generations, selectedGenId, activeGeneration]);

  const handleDownloadJSON = () => {
    if (!selectedGen) return;
    const exportData = {
      botName,
      botId,
      stage: botStage,
      generation: selectedGen,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${botName.replace(/\s+/g, '_')}_Gen${selectedGen.generationNumber}_${botStage}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadBrief = () => {
    if (!selectedGen) return;
    
    const brief = `
# ${botName} - Generation ${selectedGen.generationNumber} Briefing
Bot ID: ${botId}
Stage: ${botStage.toUpperCase()}
Generation: ${selectedGen.generationNumber}
Created: ${selectedGen.createdAt}
Exported: ${new Date().toISOString()}

---

## Mutation Type
${getMutationLabel(selectedGen.mutationReasonCode).label}
${selectedGen.parentGenerationNumber ? `Parent Generation: ${selectedGen.parentGenerationNumber}` : 'Initial Generation'}

${selectedGen.mutationObjective ? `## Evolution Objective\n${selectedGen.mutationObjective}\n` : ''}
${selectedGen.summaryDiff ? `## Changes from Previous\n${selectedGen.summaryDiff}\n` : ''}
${selectedGen.summaryTitle ? `## Summary\n${selectedGen.summaryTitle}\n` : ''}

## Performance Snapshot
${JSON.stringify(selectedGen.performanceSnapshot, null, 2)}

${selectedGen.humanRulesMd ? `## Strategy Rules\n${selectedGen.humanRulesMd}\n` : ''}

---
Generated by BlaidAgent Trading Platform
    `.trim();
    
    const blob = new Blob([brief], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${botName.replace(/\s+/g, '_')}_Gen${selectedGen.generationNumber}_Brief.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-[900px] w-full max-h-[85vh] p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="p-4 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                <GitBranch className="w-4 h-4 text-primary" />
                <span>Generation History</span>
                <Badge variant="outline" className="text-[10px] ml-2">
                  {botStage.toUpperCase()}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs mt-1 flex items-center gap-2">
                <Bot className="w-3 h-3" />
                <span className="font-medium">{botName}</span>
                <span className="text-muted-foreground/60">-</span>
                <span>Currently on Gen {currentGeneration}</span>
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleDownloadJSON}
                disabled={!selectedGen}
                data-testid="button-download-json"
              >
                <FileJson className="w-3.5 h-3.5 mr-1.5" />
                JSON
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleDownloadBrief}
                disabled={!selectedGen}
                data-testid="button-download-brief"
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                Brief
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0" style={{ height: 'calc(85vh - 80px)' }}>
          <div className="w-64 border-r border-border flex flex-col shrink-0">
            <div className="p-3 border-b border-border bg-muted/20">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Evolution Timeline
              </h3>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {isLoading ? (
                  <>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </>
                ) : generations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <GitBranch className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No generations yet</p>
                  </div>
                ) : (
                  generations.map((gen) => {
                    const isActive = currentGenerationId 
                      ? gen.id === currentGenerationId 
                      : gen.generationNumber === currentGeneration && gen.id === activeGeneration?.id;
                    return (
                      <TimelineItem
                        key={gen.id}
                        gen={gen}
                        isActive={isActive}
                        isSelected={selectedGen?.id === gen.id}
                        onClick={() => setSelectedGenId(gen.id)}
                        formatDateTime={formatShortDateTime}
                      />
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            <ScrollArea className="flex-1">
              <div className="p-4">
                <DetailPanel gen={selectedGen} stage={botStage} botName={botName} />
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
