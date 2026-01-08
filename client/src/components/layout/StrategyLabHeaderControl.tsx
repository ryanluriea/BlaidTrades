import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useStrategyLabAutonomousState, useToggleStrategyLabState } from "@/hooks/useStrategyLab";
import { Play, Pause, Activity, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStrategyLabDialog } from "@/contexts/StrategyLabDialogContext";

export function StrategyLabHeaderControl({ className }: { className?: string }) {
  const { data: autonomousState } = useStrategyLabAutonomousState();
  const toggleState = useToggleStrategyLabState();
  const { openSettings } = useStrategyLabDialog();

  const isPlaying = autonomousState?.isPlaying ?? false;
  const adaptiveMode = autonomousState?.adaptiveMode ?? "BALANCED";

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

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleState.mutate(!isPlaying);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-border/50 bg-muted/30",
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
            data-testid="button-strategy-lab-toggle"
          >
            {isPlaying ? (
              <Pause className="w-3 h-3 text-foreground" />
            ) : (
              <Play className="w-3 h-3 text-foreground" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{isPlaying ? "Pause Strategy Lab" : "Start Strategy Lab"}</p>
        </TooltipContent>
      </Tooltip>

      <span className="h-4 w-px bg-border/50 mx-0.5" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={openSettings}
            className="flex items-center gap-1.5 px-1 hover-elevate rounded cursor-pointer"
            data-testid="button-strategy-lab-settings"
          >
            <div className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-blue-400" />
              <span className="text-[11px] font-medium text-foreground">
                {getModeLabel()}
              </span>
            </div>

            <span className="h-4 w-px bg-border/50" />

            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span
                className={cn(
                  "text-[11px] font-medium",
                  isPlaying ? "text-emerald-400" : "text-muted-foreground"
                )}
              >
                {isPlaying ? "Running" : "Paused"}
              </span>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Strategy Lab Settings</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
