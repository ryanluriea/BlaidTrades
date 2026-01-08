import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useHealthSummary } from "@/hooks/useHealthSummary";
import { useMarketHours } from "@/hooks/useMarketHours";
import { HealthDrawer } from "./HealthDrawer";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, AlertTriangle, XCircle, WifiOff, Pause, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface UnifiedStatusBadgeProps {
  symbol?: string;
  className?: string;
}

export function UnifiedStatusBadge({ 
  symbol = 'ES',
  className 
}: UnifiedStatusBadgeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: health, isLoading: healthLoading, isError: healthError } = useHealthSummary();
  const { data: marketHours, isLoading: marketLoading } = useMarketHours(symbol);

  const isLoading = healthLoading || marketLoading;
  const isHealthDegraded = healthError || (!healthLoading && !health);
  
  const isMarketOpen = marketHours?.isOpen ?? false;
  const sessionType = marketHours?.sessionType ?? 'CLOSED';
  const isMaintenance = sessionType === 'MAINTENANCE';

  const getHealthIcon = () => {
    if (isHealthDegraded) {
      return { Icon: WifiOff, color: "text-amber-400" };
    }
    switch (health?.overall) {
      case "GREEN":
        return { Icon: CheckCircle2, color: "text-emerald-400" };
      case "YELLOW":
        return { Icon: AlertTriangle, color: "text-yellow-400" };
      case "RED":
        return { Icon: XCircle, color: "text-destructive" };
      default:
        return { Icon: CheckCircle2, color: "text-muted-foreground" };
    }
  };

  const getBadgeStyles = () => {
    if (isHealthDegraded || health?.overall === 'RED') {
      return "bg-destructive/10 border-destructive/30";
    }
    if (health?.overall === 'YELLOW') {
      return "bg-yellow-500/10 border-yellow-500/30";
    }
    if (isMaintenance) {
      return "bg-amber-500/10 border-amber-500/30";
    }
    if (isMarketOpen) {
      return "bg-emerald-500/10 border-emerald-500/30";
    }
    return "bg-muted/30 border-muted/50";
  };

  const getHealthLabel = () => {
    if (isHealthDegraded) return "System: Unavailable";
    switch (health?.overall) {
      case "GREEN": return "System: Healthy";
      case "YELLOW": return "System: Degraded";
      case "RED": return "System: Critical";
      default: return "System: Unknown";
    }
  };

  const { Icon: HealthIcon, color: healthIconColor } = getHealthIcon();

  if (isLoading) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-medium bg-muted/30 border-muted/50",
        className
      )}>
        <Clock className="w-3.5 h-3.5 animate-pulse text-muted-foreground" />
        <span className="text-muted-foreground">Loading...</span>
      </div>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setDrawerOpen(true)}
            className={cn(
              "flex items-center gap-2 px-2 py-1 rounded border text-xs font-medium transition-colors hover:opacity-80",
              getBadgeStyles(),
              className
            )}
            data-testid="button-unified-status"
          >
            <HealthIcon className={cn("w-3.5 h-3.5", healthIconColor)} />
            
            {isMarketOpen ? (
              <span className="text-emerald-400 animate-pulse font-semibold">
                {sessionType === 'RTH' ? 'RTH' : 'OPEN'}
              </span>
            ) : isMaintenance ? (
              <div className="flex items-center gap-1 text-amber-400">
                <Pause className="w-3 h-3" />
                <span>MAINT</span>
              </div>
            ) : (
              <span className="text-muted-foreground">CLOSED</span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-2 max-w-xs">
          <div className="space-y-1">
            <div className="font-medium flex items-center gap-1.5">
              <span className={cn(
                "w-2 h-2 rounded-full",
                isMarketOpen ? "bg-emerald-500" : isMaintenance ? "bg-amber-500" : "bg-muted-foreground"
              )} />
              {isMarketOpen ? `Market: ${sessionType === 'RTH' ? 'RTH Open' : 'Open'}` : 
               isMaintenance ? "Market: Maintenance" : "Market: Closed"}
            </div>
            {marketHours?.exchange && (
              <div className="text-muted-foreground pl-3.5">
                {marketHours.exchange}: {sessionType}
              </div>
            )}
            {marketHours?.reason && (
              <div className="text-muted-foreground pl-3.5">{marketHours.reason}</div>
            )}
            {marketHours?.nextOpen && !isMarketOpen && (
              <div className="text-muted-foreground pl-3.5">
                Opens {formatDistanceToNow(new Date(marketHours.nextOpen), { addSuffix: true })}
              </div>
            )}
            {marketHours?.nextClose && isMarketOpen && (
              <div className="text-muted-foreground pl-3.5">
                Closes {formatDistanceToNow(new Date(marketHours.nextClose), { addSuffix: true })}
              </div>
            )}
            {marketHours?.holiday && (
              <div className="text-amber-400 pl-3.5">
                Holiday: {marketHours.holiday.name}
              </div>
            )}
          </div>
          
          <div className="border-t border-border pt-2">
            <div className="font-medium flex items-center gap-1.5">
              <span className={cn(
                "w-2 h-2 rounded-full",
                isHealthDegraded ? "bg-amber-500" :
                health?.overall === 'GREEN' ? "bg-emerald-500" :
                health?.overall === 'YELLOW' ? "bg-yellow-500" :
                health?.overall === 'RED' ? "bg-destructive" : "bg-muted-foreground"
              )} />
              {getHealthLabel()}
            </div>
            <div className="text-muted-foreground pl-3.5 mt-0.5">
              Click for details
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      <ErrorBoundary 
        onReset={() => setDrawerOpen(false)}
        fallback={null}
      >
        <HealthDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
      </ErrorBoundary>
    </>
  );
}
