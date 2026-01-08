import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromotionReadinessBadgeProps {
  readinessScore: number;
  stage: string;
  failingGates?: string[];
  className?: string;
}

/**
 * Displays bot's readiness for promotion to next stage
 * 
 * Score ranges:
 * 0-49: Not ready (red)
 * 50-79: Progressing (amber)
 * 80-89: Almost ready (blue)
 * 90-100: Ready for promotion (green)
 */
export function PromotionReadinessBadge({ 
  readinessScore, 
  stage, 
  failingGates = [],
  className 
}: PromotionReadinessBadgeProps) {
  const nextStage = stage === 'TRIALS' ? 'PAPER' 
    : stage === 'PAPER' ? 'SHADOW' 
    : stage === 'SHADOW' ? 'LIVE' 
    : null;

  if (!nextStage) {
    return (
      <Badge variant="outline" className={cn("text-[9px]", className)}>
        <CheckCircle className="w-3 h-3 mr-1 text-emerald-400" />
        LIVE
      </Badge>
    );
  }

  const getConfig = () => {
    if (readinessScore >= 90) {
      return {
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/30',
        icon: CheckCircle,
        label: 'Ready',
      };
    }
    if (readinessScore >= 80) {
      return {
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/30',
        icon: TrendingUp,
        label: 'Almost',
      };
    }
    if (readinessScore >= 50) {
      return {
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
        icon: Clock,
        label: 'Progress',
      };
    }
    return {
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
      icon: AlertCircle,
      label: 'Not Ready',
    };
  };

  const config = getConfig();
  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px]",
          config.bgColor,
          config.borderColor,
          className
        )}>
          <Icon className={cn("w-3 h-3", config.color)} />
          <span className={cn("font-medium", config.color)}>
            {Math.round(readinessScore)}%
          </span>
          <span className="text-muted-foreground">→{nextStage}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">Promotion Readiness</span>
            <span className={config.color}>{config.label}</span>
          </div>
          
          <Progress value={readinessScore} className="h-1.5" />
          
          <div className="text-[10px] text-muted-foreground">
            {readinessScore >= 90 
              ? `Ready for auto-promotion to ${nextStage}`
              : readinessScore >= 80
              ? `Close to promotion - keep improving`
              : `Needs more work before ${nextStage}`
            }
          </div>

          {failingGates.length > 0 && (
            <div className="pt-1 border-t border-border/30">
              <p className="text-[10px] text-muted-foreground mb-1">Failing gates:</p>
              <div className="space-y-0.5">
                {failingGates.slice(0, 3).map((gate, i) => (
                  <div key={i} className="text-[10px] text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-2.5 h-2.5" />
                    {gate}
                  </div>
                ))}
                {failingGates.length > 3 && (
                  <div className="text-[10px] text-muted-foreground">
                    +{failingGates.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
