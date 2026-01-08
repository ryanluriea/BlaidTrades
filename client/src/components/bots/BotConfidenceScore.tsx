import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface BotConfidenceScoreProps {
  score: number | null | undefined;
  className?: string;
}

export function BotConfidenceScore({ score, className }: BotConfidenceScoreProps) {
  if (score == null) return null;
  
  const normalizedScore = score <= 1 ? Math.round(score * 100) : Math.round(score);
  
  const getColorClass = (s: number) => {
    if (s >= 85) return "text-emerald-400";
    if (s >= 70) return "text-blue-400";
    if (s >= 50) return "text-amber-400";
    return "text-muted-foreground";
  };
  
  const getLabel = (s: number) => {
    if (s >= 85) return "High Confidence";
    if (s >= 70) return "Good";
    if (s >= 50) return "Moderate";
    return "Low";
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className={cn(
            "flex items-center gap-0.5 text-[10px] font-mono tabular-nums shrink-0",
            getColorClass(normalizedScore),
            className
          )}
          data-testid="bot-confidence-score"
        >
          <Sparkles className="h-2.5 w-2.5" />
          <span>{normalizedScore}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <p className="font-medium">AI Confidence: {normalizedScore}/100</p>
        <p className="text-muted-foreground">{getLabel(normalizedScore)} - from strategy research</p>
      </TooltipContent>
    </Tooltip>
  );
}
