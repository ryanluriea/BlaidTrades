import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X, AlertTriangle } from "lucide-react";

interface GateStatus {
  id: string;
  name: string;
  passed: boolean;
  current: number;
  required: number;
  unit: string;
  description?: string;
}

interface RunnerStatusInfo {
  isRunning: boolean;
  isIdle?: boolean;
  lastEvaluation?: string | null;
  lastHeartbeat?: string | null;
  lastBarClose?: number | null;
  startedAt?: string | null;
  serverNow?: number;
}

interface RatingDotsProps {
  gatesPassed: number;
  gatesTotal: number;
  isEligible: boolean;
  healthState: 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN';
  gates: GateStatus[];
  blockers?: string[];
  stage: string;
  className?: string;
  /** Vertical layout for sidebar placement - fills bottom to top, matches ActivityGrid height */
  vertical?: boolean;
  /** Runner status info to display in tooltip */
  runnerStatus?: RunnerStatusInfo;
  /** Large dots (8px) with spacing for horizontal full-width display */
  large?: boolean;
}

// Dot colors with more distinct progression
const DOT_COLORS = [
  { filled: 'bg-slate-500', unfilled: 'bg-slate-500/20' },     // 1 - Gray (starting)
  { filled: 'bg-blue-500', unfilled: 'bg-blue-500/20' },       // 2 - Blue (building)
  { filled: 'bg-cyan-400', unfilled: 'bg-cyan-400/20' },       // 3 - Cyan (progress)
  { filled: 'bg-amber-400', unfilled: 'bg-amber-400/20' },     // 4 - Amber (good)
  { filled: 'bg-emerald-400', unfilled: 'bg-emerald-400/20' }, // 5 - Green (excellent)
];

// Helper to format relative time
function formatRelativeTime(dateStr: string | null, serverNow?: number): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = serverNow ? serverNow : Date.now();
  const diffMs = now - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function RatingDots({
  gatesPassed,
  gatesTotal,
  isEligible,
  healthState,
  gates,
  blockers = [],
  stage,
  className,
  vertical = false,
  runnerStatus,
  large = false,
}: RatingDotsProps) {
  const isHealthBlocked = healthState === 'DEGRADED' || healthState === 'FROZEN';
  const nextStage = stage === 'TRIALS' ? 'PAPER' : stage === 'PAPER' ? 'SHADOW' : stage === 'SHADOW' ? 'CANARY' : 'LIVE';

  // Layout classes - vertical matches ActivityGrid height (2 rows × 32px + gap)
  // Large mode uses gap-2 for tighter spacing with pt-0.5 pb-1 for balanced vertical spacing
  const containerClass = vertical
    ? "flex flex-col-reverse items-center justify-between h-[68px] py-1 cursor-help"
    : large
      ? "flex items-center gap-2 pt-0.5 pb-1 cursor-help"
      : "flex items-center gap-1 cursor-help";

  // Dot size - large mode uses 8px dots like vertical mode
  const dotClass = (vertical || large) ? "w-2 h-2 rounded-full" : "w-1.5 h-1.5 rounded-full";

  // Don't show for LIVE bots - just show a single green dot
  if (stage === 'LIVE') {
    const liveContainerClass = vertical
      ? "flex flex-col-reverse items-center justify-between h-[68px] py-1"
      : large
        ? "flex items-center gap-2 pt-0.5 pb-1"
        : "flex items-center gap-1";
    return (
      <div className={cn(liveContainerClass, className)}>
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className={cn(
              dotClass,
              i < gatesPassed ? DOT_COLORS[i].filled : DOT_COLORS[i].unfilled
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(containerClass, className)}>
          {[...Array(gatesTotal)].map((_, index) => {
            const isFilled = index < gatesPassed;
            const dotColor = DOT_COLORS[Math.min(index, DOT_COLORS.length - 1)];
            
            // Determine animation state
            let animationClass = '';
            if (isHealthBlocked && index === 0) {
              animationClass = 'animate-pulse-red';
            } else if (isEligible && isFilled) {
              animationClass = 'animate-pulse-green';
            }

            return (
              <div
                key={index}
                className={cn(
                  dotClass,
                  "transition-all duration-300",
                  isFilled ? dotColor.filled : dotColor.unfilled,
                  isHealthBlocked && "opacity-40",
                  animationClass
                )}
              />
            );
          })}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs text-xs">
        <div className="space-y-2">
          {/* Header */}
          <div className="font-medium">
            {isHealthBlocked ? (
              <span className="text-destructive">Blocked: Health {healthState}</span>
            ) : isEligible ? (
              <span className="text-profit">Ready for {nextStage}</span>
            ) : (
              <span>Progress to {nextStage}: {gatesPassed}/{gatesTotal}</span>
            )}
          </div>

          {/* Gate checklist */}
          <div className="space-y-1">
            {gates.map(gate => {
              const formatValue = (val: number, unit: string) => {
                if (unit === '%') return `${val.toFixed(1)}%`;
                if (unit === 'x') return `${val.toFixed(2)}x`;
                if (unit === '$') return `$${val.toFixed(0)}`;
                return val.toString();
              };

              return (
                <div key={gate.id} className="flex items-start gap-1.5">
                  {gate.passed ? (
                    <Check className="w-3 h-3 text-profit flex-shrink-0 mt-0.5" />
                  ) : (
                    <X className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex flex-col">
                    <span className={cn(
                      "text-xs",
                      gate.passed ? "text-profit" : "text-muted-foreground"
                    )}>
                      {gate.name}: {formatValue(gate.current, gate.unit)}
                      <span className="text-muted-foreground"> / {formatValue(gate.required, gate.unit)}</span>
                    </span>
                    {gate.description && (
                      <span className="text-[10px] text-muted-foreground/70">{gate.description}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Blockers summary */}
          {blockers.length > 0 && !isHealthBlocked && (
            <div className="flex items-start gap-1.5 pt-1 border-t border-border/50">
              <AlertTriangle className="w-3 h-3 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-xs text-warning">
                Blocked by: {blockers.join(', ')}
              </div>
            </div>
          )}

          {/* Runner status - only for PAPER+ stages */}
          {runnerStatus && (
            <div className="pt-1.5 border-t border-border/50">
              {runnerStatus.isRunning ? (
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    <span className="text-emerald-400 font-medium">Runner Active</span>
                  </div>
                  {runnerStatus.lastEvaluation && (
                    <div className="text-muted-foreground pl-4">
                      Last signal check: {formatRelativeTime(runnerStatus.lastEvaluation, runnerStatus.serverNow)}
                    </div>
                  )}
                  {runnerStatus.lastHeartbeat && (
                    <div className="text-muted-foreground pl-4">
                      Data received: {formatRelativeTime(runnerStatus.lastHeartbeat, runnerStatus.serverNow)}
                    </div>
                  )}
                  {runnerStatus.lastBarClose && (
                    <div className="text-muted-foreground pl-4">
                      Last price: ${runnerStatus.lastBarClose.toFixed(2)}
                    </div>
                  )}
                  {runnerStatus.startedAt && (
                    <div className="text-muted-foreground/50 pl-4">
                      Started {formatRelativeTime(runnerStatus.startedAt, runnerStatus.serverNow)}
                    </div>
                  )}
                </div>
              ) : runnerStatus.isIdle ? (
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500 flex-shrink-0" />
                  <span className="text-amber-500">Runner Idle</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
