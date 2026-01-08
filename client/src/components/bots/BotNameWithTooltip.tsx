import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Bot, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStageColor } from "@/lib/stageConfig";

interface BotNameWithTooltipProps {
  name: string;
  description?: string | null;
  className?: string;
  showIcon?: boolean;
  isNearingSessionEnd?: boolean;
  stage?: string;
}

// Extract technical name from description if it follows the pattern [TECH_NAME] Description
function extractTechnicalName(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/^\[([^\]]+)\]/);
  return match ? match[1] : null;
}

// Extract the clean description without the technical name prefix
function extractCleanDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  // If no brackets, return the full description (e.g., "MES Trend Following Strategy")
  if (!description.match(/^\[/)) return description;
  return description.replace(/^\[[^\]]+\]\s*/, '');
}

export function BotNameWithTooltip({ 
  name, 
  description, 
  className = "",
  showIcon = false,
  isNearingSessionEnd = false,
  stage = "TRIALS"
}: BotNameWithTooltipProps) {
  const technicalName = extractTechnicalName(description);
  const cleanDescription = extractCleanDescription(description);
  
  const hasTooltipContent = technicalName || cleanDescription || isNearingSessionEnd;
  
  // Show moon for PAPER+ stages when nearing session end
  const isPaperPlus = stage && ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  const showMoon = isPaperPlus && isNearingSessionEnd;
  
  // Get stage-specific color for the bot name
  const stageColor = getStageColor(stage);

  // For names without tooltip content, always wrap with tooltip showing full name
  // This ensures long names truncated by CSS can still be viewed in full
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "font-medium inline-block truncate",
            hasTooltipContent && "cursor-help border-b border-dotted border-muted-foreground/30",
            stageColor, 
            className
          )}>
            {showIcon && <Bot className="w-3.5 h-3.5 opacity-60 inline mr-1" />}
            {name}
            {showMoon && (
              <Moon className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" data-testid="icon-session-ending" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            {/* Always show full name in tooltip (may be truncated in UI) */}
            <p className="text-xs font-medium">{name}</p>
            {showMoon && (
              <p className="text-xs text-amber-400 font-medium">
                Nearing session end - will stop trading soon
              </p>
            )}
            {technicalName && (
              <p className="text-xs font-mono text-muted-foreground">
                {technicalName}
              </p>
            )}
            {cleanDescription && (
              <p className="text-xs text-muted-foreground">
                {cleanDescription}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
