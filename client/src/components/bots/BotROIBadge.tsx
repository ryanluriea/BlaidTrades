import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BotCostsData {
  botId: string;
  totalCostUsd: number;
  breakdown: Array<{
    category: string;
    provider: string;
    total_cost_usd: string;
  }>;
}

interface BotROIBadgeProps {
  botId: string;
  pnl: number;
  className?: string;
}

function formatROI(roi: number): string {
  if (!isFinite(roi)) return "N/A";
  if (roi > 1000) return ">1000x";
  if (roi < -1000) return "<-1000x";
  return `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}x`;
}

function formatCurrency(value: number): string {
  if (Math.abs(value) < 0.01) return value < 0 ? "-$0.01" : "$0.00";
  if (Math.abs(value) < 1) return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(3)}`;
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

export function BotROIBadge({ botId, pnl, className }: BotROIBadgeProps) {
  const { data: costsData, isLoading } = useQuery<{ success: boolean; data: BotCostsData }>({
    queryKey: ["/api/bots", botId, "costs"],
    queryFn: async () => {
      const response = await fetch(`/api/bots/${botId}/costs`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch bot costs");
      return response.json();
    },
    enabled: !!botId,
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <Badge 
        variant="outline" 
        className={cn("h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30", className)}
        data-testid={`badge-roi-${botId}`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  const totalCost = costsData?.data?.totalCostUsd || 0;
  
  if (totalCost === 0 && pnl === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn("h-5 px-1.5 gap-1 text-[10px] text-muted-foreground bg-muted/30", className)}
            data-testid={`badge-roi-${botId}`}
          >
            <Minus className="h-3 w-3" />
            <span>--</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">No cost or P&L data yet</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const roi = totalCost > 0 ? pnl / totalCost : 0;
  const isPositive = roi > 0;
  const isBreakEven = Math.abs(roi) < 0.1;
  const isHighROI = roi >= 10;
  const isNegativeROI = roi < -1;

  const badgeStyles = isBreakEven
    ? "text-muted-foreground bg-muted/30"
    : isHighROI
      ? "text-green-400 bg-green-500/10 border-green-500/30"
      : isPositive
        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
        : isNegativeROI
          ? "text-red-400 bg-red-500/10 border-red-500/30"
          : "text-orange-400 bg-orange-500/10 border-orange-500/30";

  const IconComponent = isBreakEven ? Minus : isPositive ? TrendingUp : TrendingDown;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge 
          variant="outline" 
          className={cn("h-5 px-1.5 gap-1 text-[10px]", badgeStyles, className)}
          data-testid={`badge-roi-${botId}`}
        >
          <IconComponent className="h-3 w-3" />
          <span>{formatROI(roi)}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px]">
        <div className="space-y-1">
          <p className="text-xs font-medium">AI Investment ROI</p>
          <div className="text-[10px] text-muted-foreground space-y-0.5">
            <div className="flex justify-between gap-3">
              <span>AI Cost:</span>
              <span className="font-mono text-purple-400">{formatCurrency(totalCost)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>P&L:</span>
              <span className={cn("font-mono", pnl >= 0 ? "text-green-400" : "text-red-400")}>
                {formatCurrency(pnl)}
              </span>
            </div>
            <div className="flex justify-between gap-3 pt-1 border-t border-border/50">
              <span>Return:</span>
              <span className={cn("font-mono font-medium", isPositive ? "text-green-400" : "text-red-400")}>
                {formatROI(roi)}
              </span>
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground/70 pt-1">
            {roi >= 1 ? "Profitable AI investment" : roi > 0 ? "Marginal returns" : "AI costs exceed returns"}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
