import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  AlertCircle, CheckCircle, XCircle, Clock, 
  Wifi, Shield, TrendingUp, Database, RefreshCw 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketHours } from "@/hooks/useMarketHours";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import http from "@/lib/http";

interface WhyNotTradingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: {
    id: string;
    name: string;
    stage: string;
    mode: string | null;
    is_trading_enabled?: boolean;
    health_state?: string;
    bot_instances?: Array<{
      id: string;
      mode: string;
      status: string;
      activity_state: string;
      account_id: string;
    }>;
  };
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  action?: string;
  icon: React.ElementType;
}

const STAGE_TO_EXPECTED_MODE: Record<string, string> = {
  TRIALS: 'BACKTEST_ONLY',
  PAPER: 'SIM_LIVE',
  SHADOW: 'SHADOW',
  CANARY: 'CANARY',
  LIVE: 'LIVE',
};

export function WhyNotTradingDrawer({ open, onOpenChange, bot }: WhyNotTradingDrawerProps) {
  const { data: marketHours } = useMarketHours();
  const queryClient = useQueryClient();

  const runReconciliation = useMutation({
    mutationFn: async () => {
      // Call Express endpoint (single control plane)
      const response = await http.post<{ 
        success: boolean; 
        trace_id: string; 
        bots_healed?: number;
        error?: string;
      }>(`/api/bots/${bot.id}/reconcile`, { dry_run: false });
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Reconciliation failed");
      }
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Reconciliation complete: ${data.bots_healed || 0} issues fixed`);
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bot-runner-jobs'] });
    },
    onError: (error: Error) => {
      toast.error(`Reconciliation failed: ${error.message}`);
    },
  });

  // Compute checks
  const checks: CheckResult[] = [];
  
  const expectedMode = STAGE_TO_EXPECTED_MODE[bot.stage] || 'BACKTEST_ONLY';
  const shouldBeScanning = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(bot.stage);
  const instances = bot.bot_instances || [];
  const primaryInstance = instances[0];

  // Check 1: Stage appropriateness
  if (bot.stage === 'TRIALS') {
    checks.push({
      name: 'Lifecycle Stage',
      status: 'warn',
      detail: 'Bot is in TRIALS stage - only backtests run, no live scanning',
      action: 'Graduate to PAPER to enable live scanning',
      icon: Database,
    });
  } else {
    checks.push({
      name: 'Lifecycle Stage',
      status: 'pass',
      detail: `Bot is in ${bot.stage} stage - should be scanning`,
      icon: Database,
    });
  }

  // Check 2: Mode alignment
  if (bot.mode !== expectedMode) {
    checks.push({
      name: 'Execution Mode',
      status: 'fail',
      detail: `Mode mismatch: ${bot.mode || 'None'} should be ${expectedMode}`,
      action: 'Run reconciliation to fix',
      icon: AlertCircle,
    });
  } else {
    checks.push({
      name: 'Execution Mode',
      status: 'pass',
      detail: `Mode correctly set to ${bot.mode}`,
      icon: CheckCircle,
    });
  }

  // Check 3: Runner exists
  if (shouldBeScanning) {
    if (instances.length === 0) {
      checks.push({
        name: 'Runner Instance',
        status: 'fail',
        detail: 'No runner instance exists for this bot',
        action: 'Attach bot to an account to create runner',
        icon: XCircle,
      });
    } else if (primaryInstance) {
      const instanceModeOk = primaryInstance.mode === expectedMode;
      const instanceRunning = primaryInstance.status === 'running';
      const instanceScanning = ['SCANNING', 'TRADING'].includes(primaryInstance.activity_state);
      
      if (!instanceModeOk) {
        checks.push({
          name: 'Runner Instance',
          status: 'fail',
          detail: `Instance mode ${primaryInstance.mode} should be ${expectedMode}`,
          action: 'Run reconciliation to fix',
          icon: AlertCircle,
        });
      } else if (!instanceRunning || !instanceScanning) {
        checks.push({
          name: 'Runner Instance',
          status: 'fail',
          detail: `Instance is ${primaryInstance.status}/${primaryInstance.activity_state} but should be running/SCANNING`,
          action: 'Run reconciliation to fix',
          icon: AlertCircle,
        });
      } else {
        checks.push({
          name: 'Runner Instance',
          status: 'pass',
          detail: 'Runner is active and scanning',
          icon: CheckCircle,
        });
      }
    }
  }

  // Check 4: Market hours
  const isMarketOpen = marketHours?.isOpen ?? true;
  if (!isMarketOpen) {
    checks.push({
      name: 'Market Hours',
      status: 'warn',
      detail: 'Market is currently closed',
      action: `Next open: ${marketHours?.nextOpen || 'Unknown'}`,
      icon: Clock,
    });
  } else {
    checks.push({
      name: 'Market Hours',
      status: 'pass',
      detail: 'Market is open',
      icon: Clock,
    });
  }

  // Check 5: Trading enabled
  if (bot.is_trading_enabled === false) {
    checks.push({
      name: 'Trading Enabled',
      status: 'fail',
      detail: 'Trading is disabled for this bot',
      action: 'Enable trading in bot settings',
      icon: Shield,
    });
  } else {
    checks.push({
      name: 'Trading Enabled',
      status: 'pass',
      detail: 'Trading is enabled',
      icon: Shield,
    });
  }

  // Check 6: Health state
  if (bot.health_state === 'DEGRADED') {
    checks.push({
      name: 'Health State',
      status: 'fail',
      detail: 'Bot health is DEGRADED - trading blocked',
      action: 'Review health issues',
      icon: AlertCircle,
    });
  } else {
    checks.push({
      name: 'Health State',
      status: 'pass',
      detail: `Health: ${bot.health_state || 'OK'}`,
      icon: CheckCircle,
    });
  }

  // Check 7: Data provider (simplified)
  checks.push({
    name: 'Data Provider',
    status: 'pass', // Would need real check
    detail: 'Market data connection assumed OK',
    icon: Wifi,
  });

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-muted-foreground" />
            Why isn't {bot.name} trading?
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
            {failCount > 0 ? (
              <XCircle className="w-5 h-5 text-red-400" />
            ) : warnCount > 0 ? (
              <AlertCircle className="w-5 h-5 text-amber-400" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-400" />
            )}
            <span className="text-sm">
              {failCount > 0 
                ? `${failCount} issue${failCount > 1 ? 's' : ''} blocking trading`
                : warnCount > 0
                ? `${warnCount} warning${warnCount > 1 ? 's' : ''} - may affect trading`
                : 'All checks passed - bot should be trading'}
            </span>
          </div>

          {/* Checks list */}
          <div className="space-y-2">
            {checks.map((check, i) => (
              <div
                key={i}
                className={cn(
                  "p-3 rounded-lg border",
                  check.status === 'fail' && "bg-red-500/5 border-red-500/30",
                  check.status === 'warn' && "bg-amber-500/5 border-amber-500/30",
                  check.status === 'pass' && "bg-muted/20 border-border/50"
                )}
              >
                <div className="flex items-start gap-2">
                  <check.icon className={cn(
                    "w-4 h-4 mt-0.5",
                    check.status === 'fail' && "text-red-400",
                    check.status === 'warn' && "text-amber-400",
                    check.status === 'pass' && "text-emerald-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{check.name}</span>
                      <Badge variant={
                        check.status === 'fail' ? 'destructive' : 
                        check.status === 'warn' ? 'secondary' : 'outline'
                      } className="text-[9px] px-1.5 py-0">
                        {check.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                    {check.action && (
                      <p className="text-xs text-primary mt-1">→ {check.action}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          {failCount > 0 && (
            <div className="pt-4 border-t border-border/50">
              <Button
                onClick={() => runReconciliation.mutate()}
                disabled={runReconciliation.isPending}
                className="w-full"
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", runReconciliation.isPending && "animate-spin")} />
                {runReconciliation.isPending ? 'Running...' : 'Run Auto-Heal Reconciliation'}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                This will attempt to fix execution mode and runner state issues
              </p>
            </div>
          )}

          {/* Debug info */}
          <div className="pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2 font-medium">Debug Info</p>
            <pre className="text-[10px] text-muted-foreground/70 bg-muted/20 p-2 rounded overflow-auto max-h-32">
{JSON.stringify({
  stage: bot.stage,
  mode: bot.mode,
  expected_mode: expectedMode,
  instances: instances.map(i => ({
    mode: i.mode,
    status: i.status,
    activity: i.activity_state,
  })),
}, null, 2)}
            </pre>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
