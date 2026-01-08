import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle } from "lucide-react";

interface DataSourceBadgeProps {
  dataSource: string | null | undefined;
  className?: string;
}

export function DataSourceBadge({ dataSource, className }: DataSourceBadgeProps) {
  if (!dataSource) {
    return null;
  }

  const isSimulated = dataSource === 'SIMULATED_FALLBACK';

  if (isSimulated) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={`${className} border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10`}
            data-testid="badge-sim-data"
          >
            <AlertTriangle className="w-3 h-3 mr-0.5" />
            <span className="text-[10px] font-semibold">SIM DATA</span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium text-red-600 dark:text-red-400">Simulated Data Warning</p>
          <div className="text-xs mt-1 space-y-0.5">
            <p>This bot's last backtest used <strong>simulated market data</strong>, not real Databento feeds.</p>
            <p className="text-muted-foreground">Metrics may not reflect real market conditions.</p>
            <p className="text-muted-foreground mt-2">
              To use real data, ensure DATABENTO_API_KEY is configured and ALLOW_SIM_FALLBACK is FALSE.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
