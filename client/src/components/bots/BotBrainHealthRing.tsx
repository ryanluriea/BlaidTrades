/**
 * BotBrainHealthRing - Primary health signal as a ring/score display
 * 
 * Uses unified health constants from healthConstants.ts
 * Supports BLOCKED, STARTING, and HEALING states
 */
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, AlertTriangle, Ban, Check, Loader2, PlayCircle } from "lucide-react";
import type { HealthState } from "@/lib/canonicalStateEvaluator";
import { 
  getDisplayHealthState, 
  HEALTH_DISPLAY_COLORS,
  HEALTH_THRESHOLDS,
  HEALTH_REASON_LABELS,
  type DisplayHealthState,
  type HealthReasonCode
} from "@/lib/healthConstants";

interface HealthComponents {
  runner_reliability?: number;
  backtest_success?: number;
  evolution_stability?: number;
  promotion_readiness?: number;
  drawdown_discipline?: number;
  error_frequency?: number;
}

interface BotBrainHealthRingProps {
  score: number;
  state: HealthState;
  reason?: string;
  reasonCode?: HealthReasonCode | string | null;
  components?: HealthComponents;
  hasCriticalBlockers?: boolean;
  promotedAt?: string | Date | null;
  isHealing?: boolean;
  autoHealAttempts?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const COMPONENT_WEIGHTS = {
  runner_reliability: { weight: 30, label: 'Runner Reliability' },
  backtest_success: { weight: 20, label: 'Backtest Success' },
  evolution_stability: { weight: 20, label: 'Evolution Stability' },
  promotion_readiness: { weight: 15, label: 'Promotion Readiness' },
  drawdown_discipline: { weight: 10, label: 'Drawdown Discipline' },
  error_frequency: { weight: 5, label: 'Error Frequency' },
};

const SIZE_CONFIG = {
  sm: { ring: 32, stroke: 3, text: 'text-xs', icon: 'w-3 h-3' },
  md: { ring: 48, stroke: 4, text: 'text-sm', icon: 'w-4 h-4' },
  lg: { ring: 64, stroke: 5, text: 'text-lg', icon: 'w-5 h-5' },
};

function getStrokeColor(displayState: DisplayHealthState): string {
  switch (displayState) {
    case 'OK': return '#10b981';
    case 'WARN': return '#f59e0b';
    case 'BLOCKED': return '#f97316';
    case 'STARTING': return '#3b82f6';
    case 'HEALING': return '#06b6d4';
    case 'DEGRADED': return '#ef4444';
  }
}

function getIcon(displayState: DisplayHealthState) {
  switch (displayState) {
    case 'OK': return Check;
    case 'WARN': return AlertTriangle;
    case 'BLOCKED': return Ban;
    case 'STARTING': return PlayCircle;
    case 'HEALING': return Loader2;
    case 'DEGRADED': return AlertCircle;
  }
}

export function BotBrainHealthRing({ 
  score, 
  state, 
  reason,
  reasonCode,
  components,
  hasCriticalBlockers = false,
  promotedAt,
  isHealing = false,
  autoHealAttempts = 0,
  size = 'md',
  showLabel = false,
  className 
}: BotBrainHealthRingProps) {
  const safeScore = Number.isFinite(score) ? score : 0;
  const displayScore = Math.round(safeScore);

  const displayState = getDisplayHealthState(state, safeScore, hasCriticalBlockers, {
    promotedAt,
    isHealing,
    autoHealAttempts,
  });
  const config = SIZE_CONFIG[size];
  const colors = HEALTH_DISPLAY_COLORS[displayState];
  const strokeColor = getStrokeColor(displayState);
  
  const radius = (config.ring - config.stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (safeScore / 100) * circumference;

  // Get reason label if available
  const reasonLabel = reasonCode && reasonCode in HEALTH_REASON_LABELS 
    ? HEALTH_REASON_LABELS[reasonCode as HealthReasonCode] 
    : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-2", className)}>
          {/* Ring SVG */}
          <div className="relative" style={{ width: config.ring, height: config.ring }}>
            <svg
              className="transform -rotate-90"
              width={config.ring}
              height={config.ring}
            >
              {/* Background ring */}
              <circle
                cx={config.ring / 2}
                cy={config.ring / 2}
                r={radius}
                stroke="currentColor"
                strokeWidth={config.stroke}
                fill="none"
                className="text-muted/20"
              />
              {/* Progress ring */}
              <circle
                cx={config.ring / 2}
                cy={config.ring / 2}
                r={radius}
                stroke={strokeColor}
                strokeWidth={config.stroke}
                fill="none"
                strokeLinecap="round"
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset: offset,
                  transition: 'stroke-dashoffset 0.5s ease',
                }}
              />
            </svg>
            {/* Center content */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={cn("font-bold", config.text, colors.text)}>
                {displayScore}
              </span>
            </div>
          </div>
          
          {/* Optional label */}
          {showLabel && (
            <div className="flex flex-col">
              <span className={cn("font-medium", config.text, colors.text)}>
                Health
              </span>
              <span className="text-[10px] text-muted-foreground">
                {colors.label}
              </span>
            </div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Bot Brain Health</span>
            <span className={cn("font-bold", colors.text)}>{displayScore}/100</span>
          </div>
          
          {/* Transitional states explanation */}
          {displayState === 'STARTING' && (
            <div className="text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded flex items-center gap-1.5">
              <PlayCircle className="w-3 h-3" />
              Bot is starting up after promotion. Runner will initialize shortly.
            </div>
          )}
          
          {displayState === 'HEALING' && (
            <div className="text-xs text-cyan-400 bg-cyan-500/10 px-2 py-1 rounded flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Auto-healing in progress (attempt {autoHealAttempts + 1}/3)
            </div>
          )}
          
          {displayState === 'BLOCKED' && (
            <div className="text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded">
              Score is healthy but critical blockers prevent normal operation
            </div>
          )}
          
          {/* Reason with label */}
          {reasonLabel && (
            <div className="text-xs border-t border-border/50 pt-2">
              <div className="font-medium text-foreground">{reasonLabel.title}</div>
              <div className="text-muted-foreground">{reasonLabel.description}</div>
              {reasonLabel.action && (
                <div className={cn("mt-1", colors.text)}>{reasonLabel.action}</div>
              )}
            </div>
          )}
          
          {reason && !reasonLabel && (
            <div className="text-xs text-muted-foreground border-t border-border/50 pt-2">
              {reason}
            </div>
          )}
          
          {/* Component breakdown */}
          {components && (
            <div className="space-y-1.5 pt-2 border-t border-border/50">
              <div className="text-[10px] uppercase text-muted-foreground font-medium">
                Components
              </div>
              {Object.entries(COMPONENT_WEIGHTS).map(([key, { weight, label }]) => {
                const value = components[key as keyof HealthComponents] ?? 100;
                return (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label} ({weight}%)</span>
                    <span className={cn(
                      value >= HEALTH_THRESHOLDS.OK ? "text-emerald-400" : 
                      value >= HEALTH_THRESHOLDS.DEGRADED ? "text-amber-400" : "text-red-400"
                    )}>
                      {Math.round(value)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* State explanation */}
          {displayState === 'DEGRADED' && (
            <div className="text-xs text-red-400 border-t border-border/50 pt-2">
              ⚠️ Bot may be auto-demoted until health improves
            </div>
          )}
          {displayState === 'WARN' && (
            <div className="text-xs text-amber-400 border-t border-border/50 pt-2">
              ⚠️ Monitor for potential issues
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact version for bot list rows - ICON-ONLY with details in tooltip
 */
export function BotBrainHealthCompact({ 
  score, 
  state,
  hasCriticalBlockers = false,
  promotedAt,
  isHealing = false,
  autoHealAttempts = 0,
  reasonCode,
}: { 
  score: number; 
  state: HealthState;
  hasCriticalBlockers?: boolean;
  promotedAt?: string | Date | null;
  isHealing?: boolean;
  autoHealAttempts?: number;
  reasonCode?: string | null;
}) {
  const safeScore = Number.isFinite(score) ? score : 0;
  const displayScore = Math.round(safeScore);

  const displayState = getDisplayHealthState(state, safeScore, hasCriticalBlockers, {
    promotedAt,
    isHealing,
    autoHealAttempts,
  });

  // Only show badge when there's a real problem (clean UI principle)
  // But always show STARTING and HEALING states
  if (displayState === 'OK') return null;
  if (displayState === 'WARN' && safeScore >= HEALTH_THRESHOLDS.OK) return null;
  
  const colors = HEALTH_DISPLAY_COLORS[displayState];
  const Icon = getIcon(displayState);
  const isAnimated = displayState === 'HEALING' || displayState === 'STARTING';

  // Get reason label
  const reasonLabel = reasonCode && reasonCode in HEALTH_REASON_LABELS 
    ? HEALTH_REASON_LABELS[reasonCode as HealthReasonCode] 
    : null;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "flex items-center justify-center w-6 h-5 rounded border cursor-help",
          colors.bg,
          colors.text,
          colors.border
        )}>
          <Icon className={cn("w-3.5 h-3.5", isAnimated && "animate-pulse")} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          <div className="font-medium flex items-center gap-2">
            <span>Health: {displayScore}/100</span>
            <span className={cn("px-1.5 py-0.5 rounded text-[10px]", colors.bg, colors.text)}>
              {colors.label}
            </span>
          </div>
          
          {/* State-specific message */}
          <div className="text-xs text-muted-foreground">
            {displayState === 'STARTING' && 'Bot is starting up after promotion'}
            {displayState === 'HEALING' && `Auto-healing in progress (attempt ${autoHealAttempts + 1}/3)`}
            {displayState === 'BLOCKED' && 'Critical blockers prevent normal operation'}
            {displayState === 'DEGRADED' && 'Bot may be auto-demoted until health improves'}
            {displayState === 'WARN' && 'Monitor for potential issues'}
          </div>
          
          {/* Reason if available */}
          {reasonLabel && (
            <div className="text-xs pt-1 border-t border-border/30">
              <span className="text-foreground">{reasonLabel.title}:</span>{' '}
              <span className="text-muted-foreground">{reasonLabel.description}</span>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
