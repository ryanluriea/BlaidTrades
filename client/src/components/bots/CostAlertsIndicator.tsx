import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AlertTriangle, DollarSign, Cpu, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BotCostAlert {
  botId: string;
  botName: string;
  symbol: string;
  monthlyCostUsd: number;
  threshold: number;
  exceededBy: number;
}

interface BudgetAlert {
  provider: string;
  monthlyLimitUsd: number;
  currentSpendUsd: number;
  percentUsed: number;
  isAutoThrottled: boolean;
  isPaused: boolean;
}

interface CostAlertsData {
  threshold: number;
  botsExceedingThreshold: BotCostAlert[];
  budgetAlerts: BudgetAlert[];
  hasAlerts: boolean;
}

interface CostAlertsIndicatorProps {
  threshold?: number;
  className?: string;
}

const PROVIDER_NAMES: Record<string, string> = {
  groq: "Groq",
  openai: "OpenAI",
  anthropic: "Claude",
  gemini: "Gemini",
  xai: "xAI",
  openrouter: "OpenRouter",
};

export function CostAlertsIndicator({ threshold = 5.0, className }: CostAlertsIndicatorProps) {
  const { data, isLoading } = useQuery<{ success: boolean; data: CostAlertsData }>({
    queryKey: ["/api/costs/alerts-check", threshold],
    queryFn: async () => {
      const response = await fetch(`/api/costs/alerts-check?threshold=${threshold}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to check cost alerts");
      return response.json();
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const alerts = data?.data;
  const totalAlerts = (alerts?.botsExceedingThreshold?.length || 0) + (alerts?.budgetAlerts?.length || 0);

  if (isLoading) {
    return (
      <Badge 
        variant="outline" 
        className={cn("h-6 px-2 gap-1 text-xs text-muted-foreground bg-muted/30", className)}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </Badge>
    );
  }

  if (!alerts?.hasAlerts) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 px-2 gap-1 text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-400",
            className
          )}
          data-testid="button-cost-alerts"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>{totalAlerts} Cost Alert{totalAlerts !== 1 ? "s" : ""}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-medium">Cost Alerts</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Bots or providers exceeding spending thresholds
          </p>
        </div>

        <div className="max-h-60 overflow-y-auto">
          {alerts.budgetAlerts.length > 0 && (
            <div className="p-2 border-b border-border/50">
              <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1.5 px-1">
                LLM Budget Alerts
              </p>
              {alerts.budgetAlerts.map((alert) => (
                <div 
                  key={alert.provider}
                  className="flex items-center gap-2 p-2 rounded-md bg-amber-500/5"
                >
                  <Cpu className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">
                        {PROVIDER_NAMES[alert.provider] || alert.provider}
                      </span>
                      <Badge 
                        variant="outline"
                        className={cn(
                          "h-4 px-1 text-[9px]",
                          alert.percentUsed >= 100 
                            ? "text-red-400 bg-red-500/10 border-red-500/30"
                            : "text-amber-400 bg-amber-500/10 border-amber-500/30"
                        )}
                      >
                        {alert.percentUsed.toFixed(0)}%
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      ${alert.currentSpendUsd.toFixed(2)} / ${alert.monthlyLimitUsd.toFixed(2)}
                      {alert.isAutoThrottled && (
                        <span className="text-red-400 ml-1">(throttled)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {alerts.botsExceedingThreshold.length > 0 && (
            <div className="p-2">
              <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1.5 px-1">
                Bot Cost Alerts (threshold: ${threshold})
              </p>
              {alerts.botsExceedingThreshold.map((alert) => (
                <div 
                  key={alert.botId}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50"
                >
                  <DollarSign className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">
                        {alert.botName}
                      </span>
                      <span className="text-xs font-mono text-amber-400">
                        ${alert.monthlyCostUsd.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {alert.symbol} - exceeded by ${alert.exceededBy.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
