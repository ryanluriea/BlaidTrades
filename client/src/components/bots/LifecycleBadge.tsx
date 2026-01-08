import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, X } from "lucide-react";
import { STAGE_CONFIG, getStageConfig } from "@/lib/stageConfig";

interface LifecycleBadgeProps {
  stage: string;
  className?: string;
}

/**
 * Displays the bot's lifecycle stage as a simple badge
 * Shows stage description and capabilities on hover
 */
export function LifecycleBadge({ stage, className }: LifecycleBadgeProps) {
  const config = getStageConfig(stage);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(
          "text-[10px] font-semibold px-2 py-0.5 rounded border cursor-help",
          config.color,
          config.bgColor,
          config.borderColor,
          className
        )}>
          {config.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="p-0 w-56" sideOffset={8}>
        <div className="p-2 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xs font-semibold", config.color)}>{config.label}</span>
            <span className="text-xs text-muted-foreground">-</span>
            <span className="text-xs text-foreground">{config.description}</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{config.subtitle}</div>
        </div>
        
        <div className="p-2 space-y-2">
          {config.capabilities.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">Can:</div>
              {config.capabilities.map((cap, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  <span className="text-foreground">{cap}</span>
                </div>
              ))}
            </div>
          )}
          
          {config.restrictions.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">Cannot:</div>
              {config.restrictions.map((restriction, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <X className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                  <span className="text-muted-foreground">{restriction}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
