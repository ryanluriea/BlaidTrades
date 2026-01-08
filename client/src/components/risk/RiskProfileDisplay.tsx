import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, AlertTriangle } from "lucide-react";
import { parseRiskProfile, formatRiskPercent, RISK_TIER_PRESETS, type RiskProfile } from "@/hooks/useRiskEngine";

interface RiskProfileDisplayProps {
  riskTier: string;
  riskProfileJson?: Record<string, unknown>;
  accountEquity: number;
}

export function RiskProfileDisplay({ riskTier, riskProfileJson, accountEquity }: RiskProfileDisplayProps) {
  const profile = parseRiskProfile(riskProfileJson, riskTier);
  
  const maxDailyLossPercent = profile.max_daily_loss_percent * accountEquity;
  const maxDailyLoss = profile.max_daily_loss_dollars 
    ? Math.min(maxDailyLossPercent, profile.max_daily_loss_dollars)
    : maxDailyLossPercent;

  const maxRiskPerTradePercent = profile.risk_percent_per_trade * accountEquity;
  const maxRiskPerTrade = profile.max_risk_dollars_per_trade
    ? Math.min(maxRiskPerTradePercent, profile.max_risk_dollars_per_trade)
    : maxRiskPerTradePercent;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Dynamic Risk Profile
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground">Risk / Trade</p>
            <p className="text-lg font-bold font-mono">{formatRiskPercent(profile.risk_percent_per_trade)}</p>
            <p className="text-xs text-muted-foreground">${maxRiskPerTrade.toFixed(0)} max</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground">Max Daily Loss</p>
            <p className="text-lg font-bold font-mono">{formatRiskPercent(profile.max_daily_loss_percent)}</p>
            <p className="text-xs text-muted-foreground">${maxDailyLoss.toFixed(0)} max</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground">Max Contracts/Trade</p>
            <p className="text-lg font-bold font-mono">{profile.max_contracts_per_trade}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground">Max Contracts/Symbol</p>
            <p className="text-lg font-bold font-mono">{profile.max_contracts_per_symbol}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 col-span-2">
            <p className="text-xs text-muted-foreground">Max Total Exposure</p>
            <p className="text-lg font-bold font-mono">{profile.max_total_exposure_contracts} contracts</p>
          </div>
        </div>
        <div className="mt-3 p-2 bg-primary/10 rounded text-xs flex items-center gap-2">
          <AlertTriangle className="w-3 h-3 text-primary" />
          Position sizes scale automatically with account equity
        </div>
      </CardContent>
    </Card>
  );
}
