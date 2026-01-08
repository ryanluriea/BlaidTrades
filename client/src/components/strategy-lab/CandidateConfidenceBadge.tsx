import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, XCircle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface CandidateConfidenceBadgeProps {
  score: number;
  className?: string;
  showLabel?: boolean;
}

export function CandidateConfidenceBadge({ score, className, showLabel = true }: CandidateConfidenceBadgeProps) {
  const getConfig = (score: number) => {
    if (score >= 85) return { 
      icon: CheckCircle2, 
      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      label: "High Confidence",
      desc: "Ready for auto-promotion"
    };
    if (score >= 70) return { 
      icon: TrendingUp, 
      color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      label: "Good",
      desc: "Manual review recommended"
    };
    if (score >= 50) return { 
      icon: AlertTriangle, 
      color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      label: "Moderate",
      desc: "Needs validation"
    };
    return { 
      icon: XCircle, 
      color: "bg-destructive/20 text-destructive border-destructive/30",
      label: "Low",
      desc: "Not recommended for deployment"
    };
  };

  const config = getConfig(score);
  const Icon = config.icon;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("gap-1 tabular-nums font-mono", config.color, className)}
          >
            <Icon className="h-3 w-3" />
            {score}
            {showLabel && <span className="text-[9px] font-normal ml-0.5">{config.label}</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-medium">{config.label} ({score}/100)</p>
          <p className="text-muted-foreground">{config.desc}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
