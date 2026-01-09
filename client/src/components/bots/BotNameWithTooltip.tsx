import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Bot, Moon, Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { getStageColor } from "@/lib/stageConfig";

interface BotNameWithTooltipProps {
  name: string;
  description?: string | null;
  className?: string;
  showIcon?: boolean;
  isNearingSessionEnd?: boolean;
  stage?: string;
  createdAt?: string | Date | null;
  lastActiveAt?: string | Date | null;
}

function parseTimestamp(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
  
  // PostgreSQL timestamps come as "2026-01-06 00:32:04.81192" (space separator, no timezone)
  // Normalize to ISO format: replace first space with 'T' and append 'Z' if no timezone
  let normalized = date;
  if (typeof date === 'string' && date.includes(' ') && !date.includes('T')) {
    normalized = date.replace(' ', 'T');
    if (!normalized.includes('Z') && !normalized.includes('+') && !normalized.includes('-', 10)) {
      normalized += 'Z';
    }
  }
  
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateTime(date: string | Date | null | undefined): string {
  const d = parseTimestamp(date);
  if (!d) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatRelativeTime(date: string | Date | null | undefined): string {
  const d = parseTimestamp(date);
  if (!d) return 'Never';
  
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  
  if (diffSec < 60) return 'Just now';
  
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return '1 month ago';
  return `${diffMonths} months ago`;
}

function extractTechnicalName(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/^\[([^\]]+)\]/);
  return match ? match[1] : null;
}

function extractCleanDescription(description: string | null | undefined): string | null {
  if (!description) return null;
  if (!description.match(/^\[/)) return description;
  return description.replace(/^\[[^\]]+\]\s*/, '');
}

export function BotNameWithTooltip({ 
  name, 
  description, 
  className = "",
  showIcon = false,
  isNearingSessionEnd = false,
  stage = "TRIALS",
  createdAt,
  lastActiveAt
}: BotNameWithTooltipProps) {
  const technicalName = extractTechnicalName(description);
  const cleanDescription = extractCleanDescription(description);
  
  const hasTooltipContent = technicalName || cleanDescription || isNearingSessionEnd || createdAt || lastActiveAt;
  
  const isPaperPlus = stage && ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(stage);
  const showMoon = isPaperPlus && isNearingSessionEnd;
  
  const stageColor = getStageColor(stage);
  
  const createdAtFormatted = formatDateTime(createdAt);
  const lastActiveFormatted = formatRelativeTime(lastActiveAt);
  const lastActiveFullDate = formatDateTime(lastActiveAt);

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
          <div className="space-y-1.5">
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
            {(createdAtFormatted || lastActiveAt) && (
              <div className="pt-1 border-t border-muted-foreground/20 space-y-0.5">
                {createdAtFormatted && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Created: {createdAtFormatted}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Activity className="w-3 h-3" />
                  <span>
                    Active: {lastActiveFormatted}
                    {lastActiveFullDate && lastActiveFormatted !== 'Never' && lastActiveFormatted !== 'Just now' && (
                      <span className="opacity-70"> ({lastActiveFullDate})</span>
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
