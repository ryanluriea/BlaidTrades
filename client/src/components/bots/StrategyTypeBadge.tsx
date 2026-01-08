import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle, AlertCircle, HelpCircle } from "lucide-react";
import { 
  STRATEGY_ARCHETYPES, 
  ENTRY_CONDITION_TYPES, 
  ARCHETYPE_TO_ENTRY_CONDITION,
  normalizeArchetype,
  type StrategyArchetype,
  type EntryConditionType
} from "@shared/strategy-types";

interface StrategyTypeBadgeProps {
  archetype?: string | null;
  entryConditionType?: string | null;
  className?: string;
}

// Get human-readable archetype labels from canonical types
const ARCHETYPE_LABELS: Record<StrategyArchetype, string> = {
  breakout: "Breakout",
  orb_breakout: "ORB",
  rth_breakout: "RTH Breakout",
  breakout_retest: "Breakout Retest",
  mean_reversion: "Mean Rev",
  exhaustion_fade: "Exh Fade",
  gap_fade: "Gap Fade",
  gap_fill: "Gap Fill",
  gap_and_go: "Gap & Go",
  reversal: "Reversal",
  reversal_hunter: "Rev Hunter",
  vwap: "VWAP",
  vwap_bounce: "VWAP Bounce",
  vwap_reclaim: "VWAP Reclaim",
  vwap_scalper: "VWAP Scalp",
  trend: "Trend",
  trend_following: "Trend Follow",
  trend_ema_cross: "EMA Cross",
  trend_macd: "MACD",
  momentum_surge: "Momentum",
  scalping: "Scalp",
  micro_pullback: "Micro PB",
  range_scalper: "Range Scalp",
};

// Get human-readable archetype name using canonical labels
function getArchetypeLabel(archetype: string): string {
  const normalized = normalizeArchetype(archetype);
  if (normalized && ARCHETYPE_LABELS[normalized]) {
    return ARCHETYPE_LABELS[normalized];
  }
  // Fallback: capitalize words
  return archetype.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// Get expected entry condition for archetype using CANONICAL mapping
function getExpectedEntry(archetype: string): EntryConditionType | null {
  const normalized = normalizeArchetype(archetype);
  if (!normalized) return null;
  return ARCHETYPE_TO_ENTRY_CONDITION[normalized];
}

export function StrategyTypeBadge({ archetype, entryConditionType, className }: StrategyTypeBadgeProps) {
  // No archetype provided
  if (!archetype) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={className}>
            <HelpCircle className="w-3 h-3 mr-0.5" />
            <span className="text-[10px]">No Type</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">Strategy Type Unknown</p>
          <p className="text-xs text-muted-foreground">
            No archetype assigned to this bot.
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  const normalizedArchetype = normalizeArchetype(archetype);
  const label = getArchetypeLabel(archetype);
  
  // FAIL-CLOSED: If normalization fails, show error state
  if (!normalizedArchetype) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${className} border-red-500/50 text-red-600 dark:text-red-400`}
          >
            <AlertCircle className="w-3 h-3 mr-0.5" />
            <span className="text-[10px]">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium text-red-600 dark:text-red-400">Unknown Archetype</p>
          <div className="text-xs mt-1 space-y-0.5">
            <p><span className="text-muted-foreground">Input:</span> {archetype}</p>
            <p className="text-red-600 dark:text-red-400">
              This archetype is not in the canonical type system. 
              Strategy execution may use fallback behavior.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  const expectedEntry = getExpectedEntry(archetype);
  const actualEntry = entryConditionType || null;
  
  // No entry condition yet - pending verification
  if (!actualEntry) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={className}>
            <span className="text-[10px]">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium">{label} Strategy</p>
          <div className="text-xs mt-1 space-y-0.5">
            <p><span className="text-muted-foreground">Expected Entry:</span> {expectedEntry || "Unknown"}</p>
            <p className="text-muted-foreground">
              Entry condition type will be verified during next backtest.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Check if the mapping is correct using CANONICAL mapping only
  const isValidMapping = expectedEntry === actualEntry;
  
  if (isValidMapping) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${className} border-green-500/50 text-green-600 dark:text-green-400`}
          >
            <CheckCircle className="w-3 h-3 mr-0.5" />
            <span className="text-[10px]">{label}</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium text-green-600 dark:text-green-400">Strategy Verified</p>
          <div className="text-xs mt-1 space-y-0.5">
            <p><span className="text-muted-foreground">Archetype:</span> {normalizedArchetype}</p>
            <p><span className="text-muted-foreground">Entry Logic:</span> {actualEntry}</p>
            <p className="text-green-600 dark:text-green-400">
              Implementation matches canonical mapping.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // Mismatch - show warning
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className={`${className} border-amber-500/50 text-amber-600 dark:text-amber-400`}
        >
          <AlertCircle className="w-3 h-3 mr-0.5" />
          <span className="text-[10px]">{label}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium text-amber-600 dark:text-amber-400">Strategy Mismatch</p>
        <div className="text-xs mt-1 space-y-0.5">
          <p><span className="text-muted-foreground">Archetype:</span> {normalizedArchetype}</p>
          <p><span className="text-muted-foreground">Expected Entry:</span> {expectedEntry || "Unknown"}</p>
          <p><span className="text-muted-foreground">Actual Entry:</span> {actualEntry}</p>
          <p className="text-amber-600 dark:text-amber-400">
            Entry logic does not match canonical mapping.
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
