/**
 * Candidate Badge - COMPACT ICON + SCORE VERSION
 * Shows PASS/FAIL/NEAR_MISS as merged icon+score badge
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getCandidateStatusDisplay, type CandidateGateResult } from "@/lib/candidateEvaluator";
import { CheckCircle, AlertCircle, XCircle } from "lucide-react";

interface CandidateBadgeProps {
  status: CandidateGateResult['status'];
  candidateScore: number;
  failedDimensions?: string[];
  reasons?: CandidateGateResult['reasons'];
  compact?: boolean;
  className?: string;
}

export function CandidateBadge({
  status,
  candidateScore,
  failedDimensions = [],
  reasons = [],
  compact = false,
  className,
}: CandidateBadgeProps) {
  const display = getCandidateStatusDisplay(status);

  const Icon = status === 'PASS' ? CheckCircle : status === 'NEAR_MISS' ? AlertCircle : XCircle;
  
  // Determine colors based on status
  const colorClasses = {
    PASS: "bg-green-500/20 text-green-400 border-green-500/30",
    NEAR_MISS: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    FAIL: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center gap-0.5 px-1.5 h-5 rounded border text-[10px] font-medium",
          colorClasses[status],
          className
        )}>
          <Icon className="w-3 h-3" />
          <span className="font-mono tabular-nums">{candidateScore}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="space-y-2 text-xs">
          <div className="font-medium flex items-center gap-1.5">
            <Icon className={cn("w-3.5 h-3.5", display.color)} />
            <span>{display.label}</span>
            <span className="text-muted-foreground">• Score: {candidateScore}/100</span>
          </div>
          
          {status !== 'PASS' && failedDimensions.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Missing gates:</div>
              <ul className="list-disc list-inside text-destructive">
                {failedDimensions.map((dim, i) => (
                  <li key={i}>{dim}</li>
                ))}
              </ul>
            </div>
          )}

          {reasons.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] pt-1 border-t border-border">
              {reasons.map((r) => (
                <div key={r.dimension} className="flex justify-between">
                  <span className="text-muted-foreground">{r.dimension}:</span>
                  <span className={cn(
                    r.passed ? "text-emerald-500" : "text-destructive"
                  )}>
                    {typeof r.current === 'number' ? r.current.toFixed(r.dimension === 'Max Drawdown' ? 0 : 2) : r.current}
                    {r.dimension === 'Win Rate' && '%'}
                    {r.dimension === 'Max Drawdown' && '$'}
                    {r.dimension === 'Profit Factor' && 'x'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
