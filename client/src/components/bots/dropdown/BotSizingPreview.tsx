import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Calculator, AlertTriangle, CheckCircle, Plus, TrendingUp, TrendingDown, Minus, Wallet } from "lucide-react";
import { useBotInstances } from "@/hooks/useBotDetails";
import { useAccount } from "@/hooks/useAccounts";
import { useSizingPreview, formatRiskPercent } from "@/hooks/useRiskEngine";
import { AttachToAccountDialog } from "../AttachToAccountDialog";
import { useBot } from "@/hooks/useBots";
import { useBotsMetrics } from "@/hooks/useBotsMetrics";
import { PromotionProgressBar } from "../PromotionProgressBar";
import { DegradedBanner } from "@/components/ui/degraded-banner";

interface BotSizingPreviewProps {
  botId: string;
  botRiskConfig?: Record<string, unknown>;
  instrumentSymbol?: string;
  previousContracts?: number;
}

export function BotSizingPreview({ 
  botId, 
  botRiskConfig, 
  instrumentSymbol = "ES",
  previousContracts 
}: BotSizingPreviewProps) {
  const { data: instances, isError: instancesError, isLoading: instancesLoading } = useBotInstances(botId);
  const { data: bot, isError: botError, isLoading: botLoading } = useBot(botId);
  const { data: metricsMap } = useBotsMetrics(bot ? [bot.id] : []);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  
  const isDegraded = (instancesError || (!instancesLoading && instances === undefined)) || 
                     (botError || (!botLoading && bot === undefined));
  const [stopTicks, setStopTicks] = useState(
    (botRiskConfig?.stop_loss_ticks as number) || 
    (botRiskConfig?.default_stop_ticks as number) || 
    20
  );

  // Get the first linked account
  const firstInstance = instances?.[0];
  const { data: account } = useAccount(firstInstance?.accountId);
  
  // Get metrics for progress bar
  const metrics = bot ? metricsMap?.get(bot.id) : null;

  const sizing = useSizingPreview({
    accountEquity: account?.currentBalance || 0,
    accountRiskTier: account?.riskTier || "moderate",
    account: account ? {
      risk_tier: account.riskTier,
      risk_percent_per_trade: account.riskPercentPerTrade,
      max_risk_dollars_per_trade: account.maxRiskDollarsPerTrade,
      max_contracts_per_trade: account.maxContractsPerTrade,
      max_contracts_per_symbol: account.maxContractsPerSymbol,
      max_total_exposure_contracts: account.maxTotalExposureContracts,
      max_daily_loss_percent: account.maxDailyLossPercent,
      max_daily_loss_dollars: account.maxDailyLossDollars,
    } : undefined,
    botRiskConfig,
    instrumentSymbol,
    stopDistanceTicks: stopTicks,
  });

  // Calculate contract trend
  const contractDelta = previousContracts !== undefined && sizing 
    ? sizing.contracts - previousContracts 
    : null;

  // No account attached - offer to attach one
  if (!account) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Sizing Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            No account attached. Attach an account to see position sizing.
          </p>
          <Button 
            size="sm" 
            variant="outline" 
            className="w-full gap-2"
            onClick={() => setAttachDialogOpen(true)}
          >
            <Plus className="w-3 h-3" />
            Attach Account
          </Button>
          
          {/* Still show progress even without account */}
          {bot && (
            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Graduation Progress</span>
                <PromotionProgressBar
                  stage={bot.stage}
                  healthState={(bot.healthState || 'OK') as 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN'}
                  rollup30={metrics ? {
                    trades: metrics.trades ?? 0,
                    winRate: metrics.winRate ?? null,
                    sharpe: metrics.sharpe ?? null,
                    profitFactor: metrics.profitFactor ?? null,
                    expectancy: metrics.expectancy ?? null,
                    maxDdPct: metrics.maxDrawdownPct ?? null,
                    activeDays: 0,
                    lastTradeAt: null,
                  } : null}
                  lastBacktestCompletedAt={bot.lastBacktestAt?.toString()}
                  lastBacktestStatus={null}
                  totalTrades={bot.simTotalTrades}
                />
              </div>
            </div>
          )}
          
          {bot && (
            <AttachToAccountDialog
              open={attachDialogOpen}
              onOpenChange={setAttachDialogOpen}
              bot={bot as any}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Sizing Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="Sizing data unavailable" />
        </CardContent>
      </Card>
    );
  }

  if (!sizing) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Sizing Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading sizing...</p>
        </CardContent>
      </Card>
    );
  }

  const isBlocked = sizing.contracts === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Calculator className="w-4 h-4" />
            Sizing Preview
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Account badge - prominent display */}
        <div className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{account.name}</p>
              <p className="text-[10px] text-muted-foreground uppercase">{account.accountType}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {account.riskTier}
          </Badge>
        </div>

        {/* Progress bar */}
        {bot && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Progress → {bot.stage === 'TRIALS' ? 'PAPER' : bot.stage === 'PAPER' ? 'SHADOW' : bot.stage === 'SHADOW' ? 'CANARY' : bot.stage === 'CANARY' ? 'LIVE' : 'MAX'}</span>
            <PromotionProgressBar
              stage={bot.stage}
              healthState={(bot.healthState || 'OK') as 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN'}
              rollup30={metrics ? {
                trades: metrics.trades ?? 0,
                winRate: metrics.winRate ?? null,
                sharpe: metrics.sharpe ?? null,
                profitFactor: metrics.profitFactor ?? null,
                expectancy: metrics.expectancy ?? null,
                maxDdPct: metrics.maxDrawdownPct ?? null,
                activeDays: 0,
                lastTradeAt: null,
              } : null}
              lastBacktestCompletedAt={bot.lastBacktestAt?.toString()}
              lastBacktestStatus={null}
              totalTrades={bot.simTotalTrades}
            />
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="stop-ticks" className="text-xs">Stop (ticks)</Label>
          <Input
            id="stop-ticks"
            type="number"
            min={1}
            max={100}
            value={stopTicks}
            onChange={(e) => setStopTicks(parseInt(e.target.value) || 20)}
            className="h-7 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-muted/30">
            <p className="text-muted-foreground">Equity</p>
            <p className="font-mono font-medium">${account.currentBalance.toLocaleString()}</p>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <p className="text-muted-foreground">Risk %</p>
            <p className="font-mono font-medium">{formatRiskPercent(sizing.calculation_details.risk_percent_used)}</p>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <p className="text-muted-foreground">Risk $</p>
            <p className="font-mono font-medium">${sizing.risk_dollars.toFixed(0)}</p>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <p className="text-muted-foreground">$/Contract</p>
            <p className="font-mono font-medium">${sizing.dollars_per_contract_at_stop.toFixed(0)}</p>
          </div>
        </div>

        <div className="p-2 rounded bg-primary/10 border border-primary/20">
          <div className="flex justify-between items-center">
            <span className="text-xs font-medium">Contracts</span>
            <div className="flex items-center gap-2">
              {contractDelta !== null && contractDelta !== 0 && (
                <span className={`text-xs font-mono flex items-center gap-0.5 ${contractDelta > 0 ? "text-profit" : "text-loss"}`}>
                  {contractDelta > 0 ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  {contractDelta > 0 ? "+" : ""}{contractDelta}
                </span>
              )}
              {contractDelta === 0 && previousContracts !== undefined && (
                <span className="text-xs font-mono flex items-center gap-0.5 text-muted-foreground">
                  <Minus className="w-3 h-3" />
                </span>
              )}
              <span className={`text-lg font-bold font-mono ${isBlocked ? "text-loss" : "text-profit"}`}>
                {sizing.contracts}
              </span>
            </div>
          </div>
          {sizing.capped_by && (
            <div className="flex items-center gap-1 text-xs text-warning mt-1">
              <AlertTriangle className="w-3 h-3" />
              Capped: {sizing.capped_by.replace(/_/g, " ")}
            </div>
          )}
          {!isBlocked && (
            <div className="flex items-center gap-1 text-xs text-profit mt-1">
              <CheckCircle className="w-3 h-3" />
              Order allowed
            </div>
          )}
        </div>

        {isBlocked && sizing.reason_if_blocked && (
          <div className="p-2 bg-destructive/10 rounded text-xs text-destructive">
            {sizing.reason_if_blocked}
          </div>
        )}
      </CardContent>
    </Card>
  );
}