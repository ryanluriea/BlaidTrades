import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useGrokResearchState, useToggleGrokResearchState, getDepthLabel, type GrokResearchDepth, useOrchestratorStatus, useToggleFullSpectrum } from "@/hooks/useGrokResearch";
import { Play, Pause, Zap, Clock, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSetGrokResearchDepth, useTriggerGrokResearch } from "@/hooks/useGrokResearch";

export function GrokResearchHeaderControl({ className }: { className?: string }) {
  const { data: grokState, isLoading } = useGrokResearchState();
  const { data: orchestratorStatus } = useOrchestratorStatus();
  const toggleState = useToggleGrokResearchState();
  const setDepth = useSetGrokResearchDepth();
  const triggerResearch = useTriggerGrokResearch();
  const toggleFullSpectrum = useToggleFullSpectrum();

  const isEnabled = grokState?.enabled ?? false;
  const isFullSpectrum = orchestratorStatus?.isFullSpectrum ?? false;
  const depth = isFullSpectrum ? "FULL_SPECTRUM" as GrokResearchDepth : (grokState?.depth ?? "CONTRARIAN_SCAN");

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleState.mutate(!isEnabled);
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

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-purple-500/30 bg-purple-500/5", className)}>
        <span className="text-[11px] text-muted-foreground px-2">Loading...</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 px-1 py-0.5 rounded-md border",
        isEnabled ? "border-purple-500/50 bg-purple-500/10" : "border-border/50 bg-muted/30",
        className
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleToggle}
            disabled={toggleState.isPending}
            data-testid="button-grok-research-toggle"
          >
            {isEnabled ? (
              <Pause className="w-3 h-3 text-purple-400" />
            ) : (
              <Play className="w-3 h-3 text-purple-400" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{isEnabled ? "Pause Grok Research" : "Start Grok Research"}</p>
        </TooltipContent>
      </Tooltip>

      <span className="h-4 w-px bg-border/50 mx-0.5" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 px-1 hover-elevate rounded cursor-pointer"
            data-testid="button-grok-depth-selector"
          >
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-purple-400" />
              <span className="text-[11px] font-medium text-purple-300">
                Grok
              </span>
            </div>

            <span className="h-4 w-px bg-border/50" />

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium text-foreground">
                {getDepthLabel(depth)}
              </span>
            </div>

            <span className="h-4 w-px bg-border/50" />

            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isEnabled ? "text-purple-400" : "text-muted-foreground"
                )}
              >
                {!isEnabled ? "Paused" : isFullSpectrum
                  ? formatNextCycle(
                      Math.min(
                        ...(Object.values(orchestratorStatus?.nextRuns ?? {}).filter(v => v !== null) as number[])
                          .filter(v => v >= 0)
                          .concat([grokState?.nextCycleIn ?? 0])
                      )
                    )
                  : formatNextCycle(grokState?.nextCycleIn)}
              </span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={() => handleDepthChange("CONTRARIAN_SCAN")}
            className={cn(depth === "CONTRARIAN_SCAN" && "bg-accent")}
            data-testid="menu-grok-depth-contrarian"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Contrarian Scan</span>
              <span className="text-xs text-muted-foreground">Find crowded trades (2h cycles)</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleDepthChange("SENTIMENT_BURST")}
            className={cn(depth === "SENTIMENT_BURST" && "bg-accent")}
            data-testid="menu-grok-depth-sentiment"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Sentiment Burst</span>
              <span className="text-xs text-muted-foreground">X/Twitter analysis (30min cycles)</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => handleDepthChange("DEEP_REASONING")}
            className={cn(depth === "DEEP_REASONING" && "bg-accent")}
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
            className={cn(depth === "FULL_SPECTRUM" && "bg-purple-500/20")}
            data-testid="menu-grok-depth-full-spectrum"
          >
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                <span className="font-medium text-purple-300">Full Spectrum</span>
              </div>
              <span className="text-xs text-muted-foreground">All 3 modes concurrent (staggered scheduling)</span>
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
  );
}
