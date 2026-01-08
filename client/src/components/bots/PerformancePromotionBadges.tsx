import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  getPerformanceGrade, 
  getPromotionEligibility,
  type PerformanceGrade,
  type PromotionEligibility,
} from "@/lib/stagePolicies";

interface PerformancePromotionBadgesProps {
  stage: string;
  promotionState?: "READY" | "PENDING_AUDIT" | "BLOCKED";
  blockReason?: string;
  className?: string;
  compact?: boolean;
}

const performanceConfig: Record<PerformanceGrade, { label: string; color: string; bgColor: string }> = {
  SANDBOX: { 
    label: "SANDBOX", 
    color: "text-muted-foreground", 
    bgColor: "bg-muted/50" 
  },
  VALID: { 
    label: "VALID", 
    color: "text-emerald-600 dark:text-emerald-400", 
    bgColor: "bg-emerald-500/10" 
  },
  REAL: { 
    label: "REAL", 
    color: "text-amber-600 dark:text-amber-400", 
    bgColor: "bg-amber-500/10" 
  },
};

const promotionConfig: Record<PromotionEligibility | "PENDING_AUDIT" | "BLOCKED", { label: string; color: string; bgColor: string }> = {
  DISABLED: { 
    label: "Disabled", 
    color: "text-muted-foreground", 
    bgColor: "bg-muted/50" 
  },
  ELIGIBLE: { 
    label: "Eligible", 
    color: "text-emerald-600 dark:text-emerald-400", 
    bgColor: "bg-emerald-500/10" 
  },
  PENDING_AUDIT: { 
    label: "Pending Audit", 
    color: "text-amber-600 dark:text-amber-400", 
    bgColor: "bg-amber-500/10" 
  },
  BLOCKED: { 
    label: "Blocked", 
    color: "text-red-600 dark:text-red-400", 
    bgColor: "bg-red-500/10" 
  },
};

export function PerformancePromotionBadges({
  stage,
  promotionState,
  blockReason,
  className,
  compact = false,
}: PerformancePromotionBadgesProps) {
  const performanceGrade = getPerformanceGrade(stage);
  const baseEligibility = getPromotionEligibility(stage);
  
  // Determine actual promotion status
  const promotionStatus: PromotionEligibility | "PENDING_AUDIT" | "BLOCKED" = 
    promotionState === "BLOCKED" ? "BLOCKED" :
    promotionState === "PENDING_AUDIT" ? "PENDING_AUDIT" :
    baseEligibility;
  
  const perfConfig = performanceConfig[performanceGrade];
  const promoConfig = promotionConfig[promotionStatus];

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded", perfConfig.bgColor, perfConfig.color)}>
          {perfConfig.label}
        </span>
        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded", promoConfig.bgColor, promoConfig.color)}>
          {promoConfig.label}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground uppercase">PERF:</span>
            <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", perfConfig.bgColor, perfConfig.color, "border-0")}>
              {perfConfig.label}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          <p className="font-medium mb-1">Performance Grade: {perfConfig.label}</p>
          {performanceGrade === "SANDBOX" && (
            <p className="text-muted-foreground">Results from this stage are experimental and NOT considered valid for track record.</p>
          )}
          {performanceGrade === "VALID" && (
            <p className="text-muted-foreground">Results are performance-accurate with realistic execution simulation.</p>
          )}
          {performanceGrade === "REAL" && (
            <p className="text-muted-foreground">Results are from real broker execution with real capital.</p>
          )}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground uppercase">PROMO:</span>
            <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", promoConfig.bgColor, promoConfig.color, "border-0")}>
              {promoConfig.label}
            </Badge>
            {promotionStatus === "BLOCKED" && blockReason && (
              <Info className="w-3 h-3 text-red-400" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-xs">
          <p className="font-medium mb-1">Promotion: {promoConfig.label}</p>
          {promotionStatus === "DISABLED" && (
            <p className="text-muted-foreground">This stage is not eligible for automatic promotion.</p>
          )}
          {promotionStatus === "ELIGIBLE" && (
            <p className="text-muted-foreground">Bot can be promoted after passing audit checks.</p>
          )}
          {promotionStatus === "PENDING_AUDIT" && (
            <p className="text-muted-foreground">Promotion pending - complete audit checklist to proceed.</p>
          )}
          {promotionStatus === "BLOCKED" && (
            <p className="text-red-400">{blockReason || "Promotion blocked due to unmet requirements."}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/**
 * Tooltip explaining Virtual vs Simulation
 */
export function VirtualSimulationTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs max-w-xs p-3">
        <p className="font-medium mb-2">Virtual vs Simulation</p>
        <p className="text-muted-foreground mb-2">
          <strong>Virtual (Sandbox)</strong> is for experimentation. Results are not performance-valid and typically cannot be promoted.
        </p>
        <p className="text-muted-foreground">
          <strong>Simulation (Paper)</strong> is performance-accurate paper trading with realistic execution and risk. It can be promoted after passing the audit.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
