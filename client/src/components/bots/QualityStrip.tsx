/**
 * Quality Strip
 * Compact quality indicators for bot table rows
 */
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getArchetypeDisplay, type LossArchetype } from "@/lib/tradeQuality";
import { Activity, Waves, Target, AlertTriangle, Zap } from "lucide-react";

interface QualityStripProps {
  setupQuality30?: number | null;
  chopRate30?: number | null;
  regimeMatch60?: number | null;
  topLossArchetype30?: LossArchetype | null;
  topLossArchetypeRate30?: number | null;
  slippageScore?: number | null;
  compact?: boolean;
  className?: string;
}

// Micro-bar component for visual quality indicator
function QualityMicroBar({ 
  value, 
  max = 100, 
  color = "bg-primary",
  inverse = false,
}: { 
  value: number; 
  max?: number; 
  color?: string;
  inverse?: boolean;
}) {
  const percent = inverse 
    ? Math.max(0, 100 - (value / max) * 100)
    : Math.min(100, (value / max) * 100);
  
  return (
    <div className="w-8 h-1.5 rounded-full bg-muted overflow-hidden">
      <div 
        className={cn("h-full rounded-full transition-all", color)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function QualityStrip({
  setupQuality30,
  chopRate30,
  regimeMatch60,
  topLossArchetype30,
  topLossArchetypeRate30,
  slippageScore,
  compact = false,
  className,
}: QualityStripProps) {
  // Check if we have any data
  const hasData = setupQuality30 !== null && setupQuality30 !== undefined;
  
  if (!hasData) {
    return (
      <div className={cn("flex items-center gap-1 text-muted-foreground text-[10px]", className)}>
        —
      </div>
    );
  }

  const archetypeDisplay = topLossArchetype30 && topLossArchetype30 !== 'NONE' 
    ? getArchetypeDisplay(topLossArchetype30)
    : null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {/* Setup Quality */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-0.5">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <Badge 
              variant="outline" 
              className={cn(
                "h-4 px-1 text-[9px] font-mono tabular-nums",
                (setupQuality30 ?? 0) >= 70 ? "text-emerald-500 border-emerald-500/30" :
                (setupQuality30 ?? 0) >= 50 ? "text-amber-500 border-amber-500/30" :
                "text-destructive border-destructive/30"
              )}
            >
              {setupQuality30}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-xs">
            <div className="font-medium">Setup Quality: {setupQuality30}/100</div>
            <div className="text-muted-foreground">Decision quality score (last 30 trades)</div>
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Chop Rate */}
      {chopRate30 !== null && chopRate30 !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5">
              <Waves className="w-3 h-3 text-muted-foreground" />
              <QualityMicroBar 
                value={chopRate30 * 100} 
                color={chopRate30 > 0.3 ? "bg-destructive" : chopRate30 > 0.15 ? "bg-amber-500" : "bg-emerald-500"}
                inverse
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium">Chop Rate: {(chopRate30 * 100).toFixed(0)}%</div>
              <div className="text-muted-foreground">% of entries in choppy conditions</div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Regime Match */}
      {regimeMatch60 !== null && regimeMatch60 !== undefined && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-0.5">
              <Target className="w-3 h-3 text-muted-foreground" />
              <QualityMicroBar 
                value={regimeMatch60 * 100} 
                color={regimeMatch60 >= 0.8 ? "bg-emerald-500" : regimeMatch60 >= 0.6 ? "bg-amber-500" : "bg-destructive"}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium">Regime Match: {(regimeMatch60 * 100).toFixed(0)}%</div>
              <div className="text-muted-foreground">% of trades in correct regime (last 60)</div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Top Loss Archetype */}
      {archetypeDisplay && topLossArchetypeRate30 && topLossArchetypeRate30 > 0.1 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant="outline" 
              className={cn(
                "h-4 px-1 text-[9px] border",
                archetypeDisplay.color,
                "border-current/20"
              )}
            >
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
              {compact ? archetypeDisplay.icon : archetypeDisplay.label}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium">
                Top Loss Pattern: {archetypeDisplay.label}
              </div>
              <div className="text-muted-foreground">
                {(topLossArchetypeRate30 * 100).toFixed(0)}% of losses
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Slippage indicator (only show if significant) */}
      {slippageScore !== null && slippageScore !== undefined && slippageScore > 0.3 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center">
              <Zap className={cn(
                "w-3 h-3",
                slippageScore > 0.5 ? "text-destructive" : "text-amber-500"
              )} />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-medium">Slippage Sensitivity</div>
              <div className="text-muted-foreground">
                {slippageScore > 0.5 ? "High execution costs" : "Moderate slippage detected"}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
