import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { useBotInstances } from "@/hooks/useBotDetails";
import { useAccount } from "@/hooks/useAccounts";
import { 
  getExecutionRouting, 
  getDataFeedMode, 
  EXECUTION_MODE_INFO,
  ACCOUNT_TYPE_INFO,
  PROVIDER_INFO,
  type AccountType,
  type ExecutionMode,
  type DataFeedMode,
} from "@/lib/executionRouting";
import { 
  Radio, 
  Zap, 
  Database, 
  Server, 
  AlertTriangle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotExecutionStatusProps {
  botId: string;
}

export function BotExecutionStatus({ botId }: BotExecutionStatusProps) {
  const { data: instances, isLoading, isError } = useBotInstances(botId);
  
  const isDegraded = isError || (!isLoading && instances === undefined);
  
  // Get the first active instance for display
  const activeInstance = instances?.find(i => i.status === 'running') || instances?.[0];
  const accountId = activeInstance?.accountId;
  const { data: account } = useAccount(accountId);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            Execution Status
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            Execution Status
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <DegradedBanner message="Execution status unavailable" />
        </CardContent>
      </Card>
    );
  }

  if (!activeInstance) {
    return (
      <Card>
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            Execution Status
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <p className="text-xs text-muted-foreground">No active instance</p>
        </CardContent>
      </Card>
    );
  }

  const executionMode = (activeInstance.mode || "BACKTEST_ONLY") as ExecutionMode;
  const accountType = (account?.accountType || "SIM") as AccountType;
  const provider = (account as any)?.provider || "INTERNAL";
  const dataFeedOverride = (account as any)?.data_feed_mode_override as DataFeedMode | null;
  
  const routing = getExecutionRouting(accountType, executionMode);
  const dataFeedMode = executionMode && EXECUTION_MODE_INFO[executionMode] 
    ? getDataFeedMode(executionMode, dataFeedOverride)
    : "HISTORICAL_DATA";
  
  const isLiveData = dataFeedMode === "LIVE_DATA";
  const isBrokerRouting = routing === "BROKER_FILLS";
  
  return (
    <Card>
      <CardHeader className="py-2 px-3">
        <CardTitle className="text-xs font-medium flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5" />
          Execution Status
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Status Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={executionMode} />
          <StatusBadge status={accountType} />
          {provider !== "INTERNAL" && (
            <StatusBadge status={provider.toLowerCase() as any} />
          )}
        </div>

        {/* Execution Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Data Feed */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 p-2 rounded-md bg-muted/50">
                  {isLiveData ? (
                    <Zap className="w-3.5 h-3.5 text-profit" />
                  ) : (
                    <Database className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Data Feed</p>
                    <p className="font-medium">{isLiveData ? "Live" : "Historical"}</p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {isLiveData 
                    ? "Receiving real-time market data" 
                    : "Using historical/recorded data"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Execution Routing */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 p-2 rounded-md bg-muted/50">
                  {isBrokerRouting ? (
                    <Server className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-profit" />
                  )}
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Routing</p>
                    <p className="font-medium">{isBrokerRouting ? "Broker" : "Internal"}</p>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">
                  {isBrokerRouting 
                    ? "Orders sent to live broker for execution" 
                    : "Orders executed internally (paper trading)"}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Live Warning */}
        {isBrokerRouting && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-destructive">Live Execution Active</p>
              <p className="text-muted-foreground">
                Orders are being sent to {PROVIDER_INFO[provider as keyof typeof PROVIDER_INFO]?.label || provider}
              </p>
            </div>
          </div>
        )}

        {/* Paper Trading with Live Data Info */}
        {isLiveData && !isBrokerRouting && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-primary/10 border border-primary/20">
            <Zap className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-primary">Live Data, Internal Execution</p>
              <p className="text-muted-foreground">
                Trading on real-time data but orders execute in simulation
              </p>
            </div>
          </div>
        )}

        {/* Instance Status */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
          <span className="text-muted-foreground">Instance Status</span>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={activeInstance.status as any} className="text-[10px]" />
            {activeInstance.started_at && (
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(activeInstance.started_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}