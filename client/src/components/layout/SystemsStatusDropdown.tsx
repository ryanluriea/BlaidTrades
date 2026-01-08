import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Cpu, Play, Pause, Activity, Zap, Clock, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useStrategyLabAutonomousState, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { useStrategyLabDialog } from "@/contexts/StrategyLabDialogContext";
import {
  useGrokResearchState,
  useToggleGrokResearchState,
  getDepthLabel,
  type GrokResearchDepth,
  useOrchestratorStatus,
  useToggleFullSpectrum,
  useSetGrokResearchDepth,
  useTriggerGrokResearch,
} from "@/hooks/useGrokResearch";

export function SystemsStatusDropdown({ className }: { className?: string }) {
  const { data: strategyLabState } = useStrategyLabAutonomousState();
  const toggleStrategyLab = useToggleStrategyLabState();
  const { openSettings } = useStrategyLabDialog();
  
  const { data: grokState, isLoading: grokLoading } = useGrokResearchState();
  const { data: orchestratorStatus } = useOrchestratorStatus();
  const toggleGrok = useToggleGrokResearchState();
  const setDepth = useSetGrokResearchDepth();
  const triggerResearch = useTriggerGrokResearch();
  const toggleFullSpectrum = useToggleFullSpectrum();

  const strategyLabPlaying = strategyLabState?.isPlaying ?? false;
  const adaptiveMode = strategyLabState?.adaptiveMode ?? "BALANCED";
  
  const grokEnabled = grokState?.enabled ?? false;
  const isFullSpectrum = orchestratorStatus?.isFullSpectrum ?? false;
  const grokDepth = isFullSpectrum ? "FULL_SPECTRUM" as GrokResearchDepth : (grokState?.depth ?? "CONTRARIAN_SCAN");

  const anyRunning = strategyLabPlaying || grokEnabled;
  const allPaused = !strategyLabPlaying && !grokEnabled;

  const getModeLabel = () => {
    switch (adaptiveMode) {
      case "SCANNING":
        return "Scanning";
      case "DEEP_RESEARCH":
        return "Deep";
      default:
        return "Balanced";
    }
  };

  const formatNextCycle = (ms: number | null | undefined): string => {
    if (!ms) return "Ready";
    const minutes = Math.ceil(ms / 60_000);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  const handleStrategyLabToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleStrategyLab.mutate(!strategyLabPlaying);
  };

  const handleGrokToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleGrok.mutate(!grokEnabled);
  };

  const handleDepthChange = (newDepth: GrokResearchDepth) => {
    if (newDepth === "FULL_SPECTRUM") {
      toggleFullSpectrum.mutate(true);
    } else {
      if (isFullSpectrum) {
        toggleFullSpectrum.mutate(false);
      }
      setDepth.mutate(newDepth);
    }
  };

  const handleManualTrigger = () => {
    triggerResearch.mutate({});
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("relative", className)}
              data-testid="button-systems-status"
            >
              <Cpu className="w-4 h-4" />
              <span
                className={cn(
                  "absolute top-1 right-1 w-2 h-2 rounded-full",
                  anyRunning ? "bg-emerald-500" : "bg-amber-500"
                )}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{allPaused ? "Systems Paused" : "Systems Running"}</p>
        </TooltipContent>
      </Tooltip>
      
      <PopoverContent align="end" className="w-72 p-2">
        <div className="space-y-2">
          <div className="px-2 py-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Autonomous Systems
            </span>
          </div>
          
          <div
            className={cn(
              "flex items-center gap-2 px-2 py-2 rounded-md border",
              strategyLabPlaying ? "border-blue-500/50 bg-blue-500/10" : "border-border/50 bg-muted/30"
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={handleStrategyLabToggle}
                  disabled={toggleStrategyLab.isPending}
                  data-testid="button-strategy-lab-toggle"
                >
                  {strategyLabPlaying ? (
                    <Pause className="w-3.5 h-3.5 text-blue-400" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-blue-400" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{strategyLabPlaying ? "Pause Strategy Lab" : "Start Strategy Lab"}</p>
              </TooltipContent>
            </Tooltip>

            <button
              type="button"
              onClick={openSettings}
              className="flex-1 flex items-center justify-between hover-elevate rounded px-1 py-0.5 cursor-pointer"
              data-testid="button-strategy-lab-settings"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-blue-400" />
                <span className="text-xs font-medium">Strategy Lab</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">{getModeLabel()}</span>
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    strategyLabPlaying ? "text-emerald-400" : "text-muted-foreground"
                  )}
                >
                  {strategyLabPlaying ? "Running" : "Paused"}
                </span>
              </div>
            </button>
          </div>

          <div
            className={cn(
              "flex items-center gap-2 px-2 py-2 rounded-md border",
              grokEnabled ? "border-purple-500/50 bg-purple-500/10" : "border-border/50 bg-muted/30"
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={handleGrokToggle}
                  disabled={toggleGrok.isPending}
                  data-testid="button-grok-research-toggle"
                >
                  {grokEnabled ? (
                    <Pause className="w-3.5 h-3.5 text-purple-400" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-purple-400" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <p>{grokEnabled ? "Pause Grok Research" : "Start Grok Research"}</p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex-1 flex items-center justify-between hover-elevate rounded px-1 py-0.5 cursor-pointer"
                  data-testid="button-grok-depth-selector"
                >
                  <div className="flex items-center gap-1.5">
                    <Zap className="w-3 h-3 text-purple-400" />
                    <span className="text-xs font-medium">Grok Research</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{getDepthLabel(grokDepth)}</span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        grokEnabled ? "text-purple-400" : "text-muted-foreground"
                      )}
                    >
                      {!grokEnabled ? "Paused" : isFullSpectrum
                        ? (() => {
                            const nextRunValues = (Object.values(orchestratorStatus?.nextRuns ?? {}).filter(v => v !== null) as number[])
                              .filter(v => v >= 0)
                              .concat([grokState?.nextCycleIn ?? 0].filter(v => v > 0));
                            return formatNextCycle(nextRunValues.length > 0 ? Math.min(...nextRunValues) : null);
                          })()
                        : formatNextCycle(grokState?.nextCycleIn)}
                    </span>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => handleDepthChange("CONTRARIAN_SCAN")}
                  className={cn(grokDepth === "CONTRARIAN_SCAN" && "bg-accent")}
                  data-testid="menu-grok-depth-contrarian"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">Contrarian Scan</span>
                    <span className="text-xs text-muted-foreground">Find crowded trades (2h cycles)</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDepthChange("SENTIMENT_BURST")}
                  className={cn(grokDepth === "SENTIMENT_BURST" && "bg-accent")}
                  data-testid="menu-grok-depth-sentiment"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">Sentiment Burst</span>
                    <span className="text-xs text-muted-foreground">X/Twitter analysis (30min cycles)</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDepthChange("DEEP_REASONING")}
                  className={cn(grokDepth === "DEEP_REASONING" && "bg-accent")}
                  data-testid="menu-grok-depth-deep"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">Deep Reasoning</span>
                    <span className="text-xs text-muted-foreground">Institutional analysis (6h cycles)</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDepthChange("FULL_SPECTRUM")}
                  className={cn(grokDepth === "FULL_SPECTRUM" && "bg-purple-500/20")}
                  data-testid="menu-grok-depth-full-spectrum"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-400" />
                      <span className="font-medium text-purple-300">Full Spectrum</span>
                    </div>
                    <span className="text-xs text-muted-foreground">All 3 modes concurrent (staggered)</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleManualTrigger}
                  disabled={triggerResearch.isPending}
                  data-testid="menu-grok-manual-trigger"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-purple-400" />
                    <span>{triggerResearch.isPending ? "Running..." : "Run Now"}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
