import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MatrixBestCell {
  timeframe?: string;
  horizon?: string;
  profitFactor?: number;
  winRate?: number;
  netPnl?: number;
  totalTrades?: number;
}

interface ActiveTimeframeBadgeProps {
  bestCell: MatrixBestCell | null | undefined;
  className?: string;
}

export function ActiveTimeframeBadge({ bestCell, className }: ActiveTimeframeBadgeProps) {
  if (!bestCell?.timeframe) {
    return null;
  }

  const { timeframe, horizon, profitFactor, totalTrades } = bestCell;
  
  const isProfitable = (profitFactor ?? 0) >= 1.0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "h-5 px-1.5 gap-1 text-[10px] font-mono",
            isProfitable 
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/10 text-amber-400 border-amber-500/30",
            className
          )}
          data-testid="badge-active-timeframe"
        >
          <Clock className="h-3 w-3" />
          <span>{timeframe}</span>
          {horizon && <span className="text-muted-foreground">/{horizon}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">Active Matrix Configuration</p>
          <p className="text-muted-foreground">
            Optimal timeframe selected from matrix optimization.
          </p>
          {profitFactor != null && (
            <p className="text-muted-foreground">
              Profit Factor: <span className={isProfitable ? "text-emerald-400" : "text-amber-400"}>{profitFactor.toFixed(2)}</span>
            </p>
          )}
          {totalTrades != null && (
            <p className="text-muted-foreground">
              Trades: {totalTrades.toLocaleString()}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
