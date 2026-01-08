import { cn } from "@/lib/utils";
import { FlaskConical, PlayCircle, Eye, Zap, AlertTriangle, LayoutGrid, LucideIcon, Plus, Bird, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

export interface StageMetrics {
  count: number;
  pnl: number;
  trades: number;
  winRate: number | null;
  running: number;
}

interface AutonomyPipelineProps {
  selectedStage: string | null;
  onStageSelect: (stage: string | null) => void;
  onNewBotClick?: () => void;
  stageMetrics?: Record<string, StageMetrics>;
  actions?: ReactNode;
}

interface StageConfig {
  key: string | null;
  label: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  tooltip: string;
}

function formatPnl(pnl: number): string {
  if (pnl === 0) return "$0";
  const sign = pnl >= 0 ? "" : "-";
  const abs = Math.abs(pnl);
  if (abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(1)}k`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function formatWinRate(wr: number | null): string {
  if (wr === null) return "—";
  return `${wr.toFixed(0)}%`;
}

const stages: StageConfig[] = [
  { 
    key: null, 
    label: "All", 
    icon: LayoutGrid, 
    color: "text-foreground",
    bgColor: "bg-secondary",
    tooltip: "Show all bots" 
  },
  { 
    key: "TRIALS", 
    label: "Trials", 
    icon: FlaskConical, 
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    tooltip: "Backtest-only or not yet promoted" 
  },
  { 
    key: "PAPER", 
    label: "Paper", 
    icon: PlayCircle, 
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    tooltip: "Running in SIM mode" 
  },
  { 
    key: "SHADOW", 
    label: "Shadow", 
    icon: Eye, 
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    tooltip: "Live data, simulated execution" 
  },
  { 
    key: "CANARY", 
    label: "Canary", 
    icon: Bird, 
    color: "text-orange-400",
    bgColor: "bg-orange-500/20",
    tooltip: "Small real position testing" 
  },
  { 
    key: "LIVE", 
    label: "Live", 
    icon: Zap, 
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/20",
    tooltip: "Real broker execution" 
  },
  { 
    key: "DEGRADED", 
    label: "", 
    icon: AlertTriangle, 
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    tooltip: "Health check failures or risk violations" 
  },
];

export function AutonomyPipeline({ selectedStage, onStageSelect, onNewBotClick, stageMetrics, actions }: AutonomyPipelineProps) {
  return (
    <div className="sticky top-0 z-50 flex items-center gap-1 px-4 lg:px-6 py-1.5 -mx-4 lg:-mx-6 bg-card border-b border-border/30">
      {onNewBotClick && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                size="icon"
                variant="outline"
                onClick={onNewBotClick}
                aria-label="Create new bot"
                data-testid="button-new-bot"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Create New Bot</p>
            </TooltipContent>
          </Tooltip>
          <div className="h-6 w-px bg-border/50 mx-1" />
        </>
      )}
      {stages.map((stage, index) => {
        const Icon = stage.icon;
        const metricsKey = stage.key === null ? "ALL" : stage.key;
        const metrics = stageMetrics?.[metricsKey];
        const count = metrics?.count ?? 0;
        const isSelected = selectedStage === stage.key;
        const hasMetrics = metrics && count > 0 && stage.key !== null && stage.key !== 'TRIALS';
        const showArrow = stage.key !== null && stage.key !== 'DEGRADED' && index < stages.length - 2;

        return (
          <div key={stage.key ?? "all"} className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isSelected ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onStageSelect(stage.key)}
                  data-testid={`button-stage-${stage.key ?? 'all'}`}
                  className={cn(
                    isSelected && stage.bgColor,
                    isSelected && stage.color,
                    isSelected && "border border-current/20"
                  )}
                >
                  <Icon className={cn("w-3.5 h-3.5", isSelected ? stage.color : "opacity-70")} />
                  {stage.label && (
                    <span className="text-xs tracking-wide">{stage.label}</span>
                  )}
                  {count > 0 && (
                    <span className={cn(
                      "text-[10px] font-semibold tabular-nums ml-0.5 px-1.5 py-0.5 rounded",
                      isSelected 
                        ? "bg-background/60 text-foreground" 
                        : "bg-muted/60 text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  )}
                  {hasMetrics && (
                    <span className="text-[10px] opacity-70 tabular-nums ml-1">
                      <span className={metrics.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {formatPnl(metrics.pnl)}
                      </span>
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div>{stage.tooltip}</div>
                {hasMetrics && (
                  <div className="text-[10px] tabular-nums mt-1">
                    {metrics.trades} trades | {formatWinRate(metrics.winRate)} win rate
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
            {showArrow && (
              <ChevronRight className="w-3 h-3 text-muted-foreground/40 mx-0.5 flex-shrink-0" />
            )}
          </div>
        );
      })}
      
      <div className="flex-1" />
      
      {actions && (
        <>
          <div className="h-6 w-px bg-border/50 mx-1.5" />
          <div className="flex items-center gap-1.5">
            {actions}
          </div>
        </>
      )}
    </div>
  );
}
