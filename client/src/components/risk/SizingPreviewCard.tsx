import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Calculator, AlertTriangle, CheckCircle } from "lucide-react";
import { useSizingPreview, formatRiskPercent, type RiskProfile } from "@/hooks/useRiskEngine";

interface SizingPreviewCardProps {
  accountEquity: number;
  accountRiskTier: string;
  accountRiskProfile?: RiskProfile | Record<string, unknown>;
  botRiskConfig?: Record<string, unknown>;
  instrumentSymbol: string;
  defaultStopTicks?: number;
}

export function SizingPreviewCard({
  accountEquity,
  accountRiskTier,
  accountRiskProfile,
  botRiskConfig,
  instrumentSymbol,
  defaultStopTicks = 20,
}: SizingPreviewCardProps) {
  const [stopTicks, setStopTicks] = useState(defaultStopTicks);

  const sizing = useSizingPreview({
    accountEquity,
    accountRiskTier,
    accountRiskProfile,
    botRiskConfig,
    instrumentSymbol,
    stopDistanceTicks: stopTicks,
  });

  const isBlocked = sizing?.contracts === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Position Sizing Preview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="stop-ticks" className="text-xs">Stop Distance (ticks)</Label>
          <Input
            id="stop-ticks"
            type="number"
            min={1}
            max={100}
            value={stopTicks}
            onChange={(e) => setStopTicks(parseInt(e.target.value) || 20)}
            className="h-8"
          />
        </div>

        {sizing && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account Equity</span>
              <span className="font-mono">${accountEquity.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Risk %</span>
              <span className="font-mono">{formatRiskPercent(sizing.calculation_details.risk_percent_used)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Risk $</span>
              <span className="font-mono">${sizing.risk_dollars.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">$/Contract at Stop</span>
              <span className="font-mono">${sizing.dollars_per_contract_at_stop.toFixed(2)}</span>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex justify-between items-center">
                <span className="font-medium">Contracts</span>
                <span className={`text-lg font-bold font-mono ${isBlocked ? "text-loss" : "text-profit"}`}>
                  {sizing.contracts}
                </span>
              </div>
            </div>
            {sizing.capped_by && (
              <div className="flex items-center gap-1 text-xs text-warning">
                <AlertTriangle className="w-3 h-3" />
                Capped by {sizing.capped_by.replace(/_/g, " ")}
              </div>
            )}
            {isBlocked && sizing.reason_if_blocked && (
              <div className="p-2 bg-destructive/10 rounded text-xs text-destructive">
                {sizing.reason_if_blocked}
              </div>
            )}
            {!isBlocked && (
              <div className="flex items-center gap-1 text-xs text-profit">
                <CheckCircle className="w-3 h-3" />
                Order would be allowed
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
