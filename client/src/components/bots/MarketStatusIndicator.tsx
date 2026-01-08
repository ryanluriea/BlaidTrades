import { cn } from "@/lib/utils";
import { useMarketHours } from "@/hooks/useMarketHours";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Clock, Pause } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface MarketStatusIndicatorProps {
  symbol?: string;
  className?: string;
  showDetails?: boolean;
}

export function MarketStatusIndicator({ 
  symbol = 'ES', 
  className,
  showDetails = false,
}: MarketStatusIndicatorProps) {
  const { data: marketHours, isLoading } = useMarketHours(symbol);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-1.5 text-muted-foreground text-xs", className)}>
        <Clock className="w-3.5 h-3.5 animate-pulse" />
        <span>Loading...</span>
      </div>
    );
  }

  const isOpen = marketHours?.isOpen ?? false;
  const sessionType = marketHours?.sessionType ?? 'CLOSED';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium",
          isOpen 
            ? "bg-emerald-500/10 border-emerald-500/30" 
            : sessionType === 'MAINTENANCE'
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : "bg-muted/30 border-muted/50 text-muted-foreground",
          className
        )}>
          {isOpen ? (
            <span className="text-emerald-400 animate-pulse font-semibold">
              {sessionType === 'RTH' ? 'RTH' : 'OPEN'}
            </span>
          ) : sessionType === 'MAINTENANCE' ? (
            <>
              <Pause className="w-3 h-3" />
              <span>MAINT</span>
            </>
          ) : (
            <span>CLOSED</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs space-y-1 max-w-xs">
        <div className="font-medium">
          {marketHours?.exchange} Market: {sessionType}
        </div>
        <div className="text-muted-foreground">{marketHours?.reason}</div>
        
        {marketHours?.nextOpen && (
          <div className="text-muted-foreground">
            Opens: {formatDistanceToNow(new Date(marketHours.nextOpen), { addSuffix: true })}
          </div>
        )}
        
        {marketHours?.nextClose && (
          <div className="text-muted-foreground">
            Closes: {formatDistanceToNow(new Date(marketHours.nextClose), { addSuffix: true })}
          </div>
        )}
        
        {marketHours?.holiday && (
          <div className="text-amber-400">
            Holiday: {marketHours.holiday.name}
            {marketHours.holiday.earlyClose && ` (early close ${marketHours.holiday.earlyClose})`}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
