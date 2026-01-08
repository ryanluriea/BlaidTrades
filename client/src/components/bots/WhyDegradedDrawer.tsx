import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Play, Settings, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface WhyDegradedDrawerProps {
  botId: string;
  botName: string;
  healthState: "OK" | "WARN" | "DEGRADED" | "CRITICAL";
  healthReasonCode: string | null;
  healthReasonDetail: string | null;
  healthDegradedSince: string | null;
  stage: string;
  onRetryBacktest?: () => void;
  onRestartRunner?: () => void;
  children: React.ReactNode;
}

const REASON_CODE_LABELS: Record<string, { title: string; description: string; icon: string }> = {
  STALE_HEARTBEAT: {
    title: "Runner Heartbeat Stale",
    description: "The bot's runner process hasn't sent a heartbeat in over 5 minutes. It may have crashed or been stopped.",
    icon: "⏱️",
  },
  RUNNER_STOPPED: {
    title: "Runner Not Running",
    description: "No active runner instance exists for this bot. The runner needs to be started.",
    icon: "🛑",
  },
  RATE_LIMIT: {
    title: "Rate Limited",
    description: "The data provider is rate limiting requests. Trading is temporarily limited.",
    icon: "⚡",
  },
  EMPTY_BARS: {
    title: "No Market Data",
    description: "Backtests are receiving empty or insufficient bar data from the provider.",
    icon: "📊",
  },
  PROVIDER_DOWN: {
    title: "Provider Unavailable",
    description: "The market data provider is experiencing issues or is unreachable.",
    icon: "🔌",
  },
  EXECUTION_DESYNC: {
    title: "Execution Desync",
    description: "The bot's execution mode doesn't match its lifecycle stage. Auto-heal should fix this.",
    icon: "🔄",
  },
  POLICY_VIOLATION: {
    title: "Policy Violation",
    description: "The bot triggered a risk policy violation and may be in cooldown.",
    icon: "⚠️",
  },
  BACKTEST_FAIL_STREAK: {
    title: "Backtest Failures",
    description: "Multiple consecutive backtests have failed. Check strategy configuration.",
    icon: "❌",
  },
  NO_DATA: {
    title: "No Data Available",
    description: "Unable to fetch required data for this bot.",
    icon: "📭",
  },
  DEMOTION_COOLDOWN: {
    title: "Demotion Cooldown",
    description: "The bot was recently demoted and is in a cooldown period.",
    icon: "⏸️",
  },
  ERROR_STATE: {
    title: "Error State",
    description: "The runner encountered an error and is not operational.",
    icon: "🚨",
  },
  UNKNOWN: {
    title: "Unknown Issue",
    description: "An unidentified issue is affecting this bot.",
    icon: "❓",
  },
};

const TRADING_STATUS: Record<string, { label: string; color: string }> = {
  TRIALS: { label: "Backtest Only", color: "text-slate-400" },
  PAPER: { label: "Scanning Disabled", color: "text-amber-400" },
  SHADOW: { label: "Shadow Execution Disabled", color: "text-amber-400" },
  CANARY: { label: "Canary Trading Disabled", color: "text-red-400" },
  LIVE: { label: "Live Trading Disabled", color: "text-red-400" },
};

export function WhyDegradedDrawer({
  botId,
  botName,
  healthState,
  healthReasonCode,
  healthReasonDetail,
  healthDegradedSince,
  stage,
  onRetryBacktest,
  onRestartRunner,
  children,
}: WhyDegradedDrawerProps) {
  const reasonInfo = REASON_CODE_LABELS[healthReasonCode || "UNKNOWN"] || REASON_CODE_LABELS.UNKNOWN;
  const tradingStatus = TRADING_STATUS[stage] || TRADING_STATUS.TRIALS;
  
  const degradedDuration = healthDegradedSince 
    ? formatDistanceToNow(new Date(healthDegradedSince), { addSuffix: false })
    : null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-400" />
            Why is {botName} Degraded?
          </SheetTitle>
        </SheetHeader>
        
        <div className="mt-6 space-y-6">
          {/* Primary Reason Card */}
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{reasonInfo.icon}</span>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{reasonInfo.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{reasonInfo.description}</p>
                {healthReasonDetail && (
                  <p className="text-xs text-red-400 mt-2 font-mono bg-red-500/10 px-2 py-1 rounded">
                    {healthReasonDetail}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Duration */}
          {degradedDuration && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Degraded for:</span>
              <span className="font-medium text-amber-400">{degradedDuration}</span>
            </div>
          )}

          {/* Trading Impact */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Trading Impact</h4>
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", 
                healthState === "DEGRADED" ? "bg-red-400" : "bg-amber-400"
              )} />
              <span className={tradingStatus.color}>{tradingStatus.label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              While degraded, {stage === 'TRIALS' ? "backtests may fail" : "scanning and trading are paused"} until the issue is resolved.
            </p>
          </div>

          {/* Recommended Actions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Recommended Actions</h4>
            
            {(healthReasonCode === "STALE_HEARTBEAT" || healthReasonCode === "RUNNER_STOPPED") && (
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={onRestartRunner}
              >
                <Play className="w-4 h-4" />
                Restart Runner
              </Button>
            )}
            
            {(healthReasonCode === "BACKTEST_FAIL_STREAK" || healthReasonCode === "EMPTY_BARS") && (
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={onRetryBacktest}
              >
                <RefreshCw className="w-4 h-4" />
                Retry Backtest
              </Button>
            )}
            
            {healthReasonCode === "EXECUTION_DESYNC" && (
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Run Auto-Heal
              </Button>
            )}
            
            <Button 
              variant="ghost" 
              className="w-full justify-start gap-2 text-muted-foreground"
            >
              <Settings className="w-4 h-4" />
              View Bot Settings
            </Button>
          </div>

          {/* Technical Details */}
          <div className="pt-4 border-t border-border">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Technical Details</h4>
            <div className="space-y-1 text-xs font-mono text-muted-foreground">
              <div className="flex justify-between">
                <span>reason_code:</span>
                <span className="text-foreground">{healthReasonCode || "null"}</span>
              </div>
              <div className="flex justify-between">
                <span>health_state:</span>
                <span className="text-red-400">{healthState}</span>
              </div>
              <div className="flex justify-between">
                <span>stage:</span>
                <span className="text-foreground">{stage}</span>
              </div>
              <div className="flex justify-between">
                <span>bot_id:</span>
                <span className="text-foreground truncate max-w-[200px]">{botId}</span>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
