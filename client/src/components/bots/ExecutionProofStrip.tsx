/**
 * Execution Proof Strip - Shows REAL execution state for each bot
 * Simplified: Run status + Signal status only
 * FAIL-CLOSED: Shows degraded indicator when data unavailable
 */
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, AlertTriangle } from "lucide-react";
import type { ExecutionProof } from "@/hooks/useExecutionProof";

interface ExecutionProofStripProps {
  proof: ExecutionProof | undefined;
  stage: string;
  degraded?: boolean;
  className?: string;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 0) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function ExecutionProofStrip({ proof, stage, degraded, className }: ExecutionProofStripProps) {
  // TRIALS bots don't have execution proof - they only do backtests
  if (stage === 'TRIALS') {
    return null;
  }
  
  // Degraded state - show warning indicator
  if (degraded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="strip-execution-degraded"
            className={cn("flex items-center gap-1.5 text-amber-500 text-xs", className)}
          >
            <AlertTriangle className="w-3 h-3" />
            <span>Degraded</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">Execution proof unavailable</div>
          <div className="text-muted-foreground">Cannot verify runner state</div>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  // No proof data yet
  if (!proof) {
    return (
      <div className={cn("flex items-center gap-1.5 text-muted-foreground text-xs", className)}>
        <span>—</span>
      </div>
    );
  }
  
  // Determine run status
  const FIVE_MINUTES_MS = 5 * 60 * 1000;
  const lastRunAge = proof.last_tick_at 
    ? Date.now() - new Date(proof.last_tick_at).getTime() 
    : null;
  const isMarketClosed = proof.latest_audit?.market_status === 'CLOSED';
  const runOk = lastRunAge !== null && lastRunAge < FIVE_MINUTES_MS;
  const runStale = lastRunAge !== null && lastRunAge >= FIVE_MINUTES_MS;
  
  // Determine signal status
  const hasRecentSignal = proof.latest_audit?.decision_status === 'OK';
  
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      {/* Run status */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "flex items-center gap-1",
            isMarketClosed ? "text-muted-foreground" :
            runOk ? "text-green-400" : 
            runStale ? "text-yellow-400" : 
            "text-muted-foreground"
          )}>
            {runOk && <Check className="w-3 h-3" />}
            {runStale && <AlertTriangle className="w-3 h-3" />}
            <span>Run: {proof.last_tick_at ? formatRelativeTime(proof.last_tick_at) : '—'}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="font-medium">Last Runner Execution</div>
          {proof.last_tick_at && (
            <div className="text-muted-foreground">{new Date(proof.last_tick_at).toLocaleTimeString()}</div>
          )}
          {proof.last_tick_error && <div className="text-red-400 mt-1">{proof.last_tick_error}</div>}
          {isMarketClosed && <div className="text-muted-foreground mt-1">Market closed</div>}
        </TooltipContent>
      </Tooltip>

      {/* Signal status - only show if there's been a recent signal */}
      {hasRecentSignal && (
        <>
          <span className="text-muted-foreground">•</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-cyan-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                <span>Signal</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <div className="font-medium">Trade Signal Fired</div>
              <div className="text-muted-foreground">Strategy generated a signal</div>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
