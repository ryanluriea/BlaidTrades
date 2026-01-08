import { useState, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GitBranch, TrendingUp, TrendingDown, Equal, Minus, RotateCcw, CheckCircle, AlertCircle, Info, Clock } from "lucide-react";
import { GenerationHistoryModal } from "./GenerationHistoryModal";
import { formatDistanceToNow, differenceInMinutes, differenceInHours, differenceInDays } from "date-fns";

type TrendDirection = "IMPROVING" | "DECLINING" | "STABLE" | "REVERTED" | "INSUFFICIENT_DATA" | null;

// Format time lapse as compact string (e.g., "2h 15m", "3d", "45m")
// Clamps negative durations to 0 to handle client/server clock drift
function formatTimeLapseCompact(startDate: Date): string {
  const now = new Date();
  const totalMinutes = Math.max(0, differenceInMinutes(now, startDate));
  const hours = Math.max(0, differenceInHours(now, startDate));
  const days = Math.max(0, differenceInDays(now, startDate));
  
  if (days >= 1) {
    return `${days}d`;
  }
  if (hours >= 1) {
    const remainingMinutes = Math.max(0, totalMinutes % 60);
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours}h`;
  }
  return `${totalMinutes}m`;
}

// Format time lapse as detailed string (e.g., "2 hours, 15 minutes")
// Clamps negative durations to 0 to handle client/server clock drift
function formatTimeLapseDetailed(startDate: Date): string {
  const now = new Date();
  const totalMinutes = Math.max(0, differenceInMinutes(now, startDate));
  const hours = Math.max(0, differenceInHours(now, startDate));
  const days = Math.max(0, differenceInDays(now, startDate));
  
  if (days >= 1) {
    const remainingHours = Math.max(0, hours % 24);
    if (remainingHours > 0) {
      return `${days} day${days > 1 ? 's' : ''}, ${remainingHours} hour${remainingHours > 1 ? 's' : ''}`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  }
  if (hours >= 1) {
    const remainingMinutes = Math.max(0, totalMinutes % 60);
    if (remainingMinutes > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''}, ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${totalMinutes} minute${totalMinutes !== 1 ? 's' : ''}`;
}

interface GenerationBadgeProps {
  generationNumber: number;
  latestGeneration?: number;
  versionMajor?: number;
  versionMinor?: number;
  latestVersionMajor?: number;
  latestVersionMinor?: number;
  className?: string;
  botId?: string;
  botName?: string;
  trend?: TrendDirection;
  peakGeneration?: number;
  declineFromPeakPct?: number;
  lastEvolutionAt?: string | Date | null;
  generationStartedAt?: string | Date | null;
  // Metrics health info
  stage?: string;
  metricsStatus?: string;
  sessionTrades?: number | null;
}

export function GenerationBadge({ 
  generationNumber, 
  latestGeneration,
  versionMajor = 1,
  versionMinor = 0,
  className,
  botId,
  botName,
  trend,
  peakGeneration,
  declineFromPeakPct,
  lastEvolutionAt,
  generationStartedAt,
  stage,
  metricsStatus,
  sessionTrades,
}: GenerationBadgeProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const isClickable = !!botId;
  
  // Self-update timer to keep time lapse current (updates every 60 seconds)
  useEffect(() => {
    if (!generationStartedAt) return;
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [generationStartedAt]);
  
  // Check if there's a pending/rejected evolution
  const hasPendingGen = latestGeneration && latestGeneration > generationNumber;
  const displayGen = `Gen ${generationNumber}`;
  
  // Calculate time lapse for current generation (tick dependency ensures re-render)
  const genStartDate = generationStartedAt ? new Date(generationStartedAt) : null;
  const timeLapseCompact = genStartDate ? formatTimeLapseCompact(genStartDate) : null;
  const timeLapseDetailed = genStartDate ? formatTimeLapseDetailed(genStartDate) : null;
  // Suppress unused variable warning - tick is used to trigger re-renders
  void tick;

  const handleClick = (e: React.MouseEvent) => {
    if (isClickable) {
      e.stopPropagation();
      setIsHistoryOpen(true);
    }
  };

  const getTrendIcon = () => {
    switch (trend) {
      case "IMPROVING":
        return <TrendingUp className="w-3 h-3 text-green-500" />;
      case "DECLINING":
        return <TrendingDown className="w-3 h-3 text-yellow-500" />;
      case "REVERTED":
        return <RotateCcw className="w-3 h-3 text-purple-500" />;
      case "STABLE":
        return <Equal className="w-3 h-3 text-sky-400 dark:text-sky-400" />;
      case "INSUFFICIENT_DATA":
        return <Minus className="w-3 h-3 text-muted-foreground/50" />;
      default:
        return null;
    }
  };

  const getTrendLabel = () => {
    switch (trend) {
      case "IMPROVING":
        return "Performance improving";
      case "DECLINING":
        return `Declining ${declineFromPeakPct ? `(${declineFromPeakPct.toFixed(1)}% from peak)` : ''}`;
      case "REVERTED":
        return `Reverted${peakGeneration ? ` to Gen ${peakGeneration}` : ''}`;
      case "STABLE":
        return "Performance stable";
      case "INSUFFICIENT_DATA":
        return "Gathering trend data";
      default:
        return null;
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span 
            onClick={handleClick}
            data-testid={`badge-generation-${botId || 'unknown'}`}
            className={`inline-flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground bg-muted/30 border border-muted-foreground/20 px-2 py-0.5 rounded ${
              isClickable ? 'cursor-pointer hover:bg-muted/50 transition-colors' : 'cursor-help'
            } ${className || ''}`}
          >
            <span className="flex items-center gap-1">
              {displayGen}
              {getTrendIcon()}
            </span>
            {timeLapseCompact && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <span className="flex items-center gap-0.5 text-muted-foreground/70">
                  <Clock className="w-2.5 h-2.5" />
                  {timeLapseCompact}
                </span>
              </>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs p-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 border-b border-border pb-1">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold">{displayGen}</span>
              {getTrendIcon()}
            </div>
            
            <div className="text-[11px] space-y-1.5 text-muted-foreground">
              <p>
                <span className="text-foreground/70">Evolution cycles:</span> {generationNumber}
              </p>
              {timeLapseDetailed && (
                <p className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-muted-foreground/70" />
                  <span className="text-foreground/70">Running for:</span>{' '}
                  <span className="text-foreground">{timeLapseDetailed}</span>
                </p>
              )}
              {lastEvolutionAt && (
                <p>
                  <span className="text-foreground/70">Last evolved:</span>{' '}
                  {formatDistanceToNow(new Date(lastEvolutionAt), { addSuffix: true })}
                </p>
              )}
              {getTrendLabel() && (
                <p className="flex items-center gap-1">
                  <span className="text-foreground/70">Trend:</span> {getTrendLabel()}
                </p>
              )}
              {peakGeneration && peakGeneration !== generationNumber && (
                <p>
                  <span className="text-foreground/70">Peak generation:</span> Gen {peakGeneration}
                </p>
              )}
              {hasPendingGen && (
                <p className="text-amber-500/90">
                  Gen {latestGeneration} rejected (validation)
                </p>
              )}
              
              {/* Metrics Health Section */}
              {stage && (
                <div className="border-t border-border pt-1.5 mt-1.5">
                  <p className="flex items-center gap-1">
                    <span className="text-foreground/70">Metrics scope:</span>{' '}
                    {stage.toUpperCase() === 'TRIALS' ? 'Current gen only' : 'Cumulative'}
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="text-foreground/70">Status:</span>{' '}
                    {metricsStatus === 'PRIOR_GENERATION' ? (
                      <span className="flex items-center gap-1 text-red-400">
                        <AlertCircle className="w-3 h-3" /> Prior gen (stale)
                      </span>
                    ) : metricsStatus === 'AVAILABLE' ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <CheckCircle className="w-3 h-3" /> Available
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Info className="w-3 h-3" /> Awaiting backtest
                      </span>
                    )}
                  </p>
                  {stage.toUpperCase() === 'TRIALS' && (
                    <p>
                      <span className="text-foreground/70">Trades:</span>{' '}
                      {sessionTrades ?? 0}{(sessionTrades ?? 0) < 50 ? '/50 needed' : ''}
                    </p>
                  )}
                </div>
              )}
              
              <p className="text-[10px] text-muted-foreground/70">
                {isClickable ? 'Click to view evolution history' : 'Generation increments on each evolution cycle'}
              </p>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      {isClickable && (
        <GenerationHistoryModal
          isOpen={isHistoryOpen}
          onOpenChange={setIsHistoryOpen}
          botId={botId}
          botName={botName || 'Bot'}
          currentGeneration={generationNumber}
          stage={stage}
        />
      )}
    </>
  );
}
