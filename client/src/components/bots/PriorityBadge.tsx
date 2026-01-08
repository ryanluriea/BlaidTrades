import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIORITY_BUCKET_DISPLAY, type PriorityBucket } from "@/lib/constants";

interface PriorityBadgeProps {
  bucket: PriorityBucket | null | undefined;
  score: number | null | undefined;
  computedAt?: string | null;
  className?: string;
}

export function PriorityBadge({ bucket, score, computedAt, className }: PriorityBadgeProps) {
  // If never scored, don't show anything (PromotionProgressBar already shows rating status)
  const isUnrated = computedAt === null || computedAt === undefined || score === null || score === undefined;
  
  if (isUnrated) {
    return null;
  }
  
  const display = PRIORITY_BUCKET_DISPLAY[bucket || "D"];
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center justify-center px-2 py-0.5 rounded border border-muted/50 text-[10px] font-semibold w-10 h-6",
          "bg-muted/30",
          display.color,
          className
        )}>
          {display.label}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs space-y-1">
        <div className="font-medium">Priority Score: {score}/100</div>
        <div className="text-muted-foreground">{display.description}</div>
      </TooltipContent>
    </Tooltip>
  );
}
