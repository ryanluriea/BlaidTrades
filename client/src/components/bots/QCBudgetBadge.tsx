import { BadgeCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQCBudget, useQCConfigStatus } from "@/hooks/useQCVerification";
import { cn } from "@/lib/utils";

interface QCBudgetBadgeProps {
  className?: string;
}

export function QCBudgetBadge({ className }: QCBudgetBadgeProps) {
  const { data: budget, isLoading: budgetLoading } = useQCBudget();
  const { data: configStatus } = useQCConfigStatus();

  if (!configStatus?.configured) {
    return null;
  }

  if (budgetLoading) {
    return (
      <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 gap-1", className)}>
        <Loader2 className="h-3 w-3 animate-spin" />
        QC
      </Badge>
    );
  }

  if (!budget) {
    return null;
  }

  const dailyRemaining = budget.dailyLimit - budget.dailyUsed;
  const weeklyRemaining = budget.weeklyLimit - budget.weeklyUsed;

  const getStatusColor = () => {
    if (dailyRemaining === 0 || weeklyRemaining === 0) {
      return "text-red-400 border-red-500/30 bg-red-500/10";
    }
    if (dailyRemaining <= 3 || weeklyRemaining <= 10) {
      return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    }
    return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn("text-[10px] px-1.5 py-0 gap-1 cursor-help", getStatusColor(), className)}
            data-testid="badge-qc-budget"
          >
            <BadgeCheck className="h-3 w-3" />
            QC: {budget.dailyUsed}/{budget.dailyLimit}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px]">
          <div className="space-y-1">
            <div className="text-xs font-medium">QuantConnect Verification Budget</div>
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between gap-2">
                <span>Daily runs:</span>
                <span className="font-mono">{dailyRemaining} / {budget.dailyLimit} remaining</span>
              </div>
              <div className="flex justify-between gap-2">
                <span>Weekly runs:</span>
                <span className="font-mono">{weeklyRemaining} / {budget.weeklyLimit} remaining</span>
              </div>
            </div>
            {!budget.canRun && (
              <div className="text-[10px] text-red-400 pt-1 border-t border-border/50">
                {budget.exhaustionReason || "Budget exhausted - no runs available"}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
