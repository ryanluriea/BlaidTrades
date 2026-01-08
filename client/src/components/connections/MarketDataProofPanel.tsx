import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Activity,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Database,
} from "lucide-react";
import { useMarketDataTest } from "@/hooks/useMarketDataTest";
import { format } from "date-fns";

export function MarketDataProofPanel() {
  const { testLive, testHistorical, isLoading, liveResult, historicalResult } = useMarketDataTest();
  const [symbol, setSymbol] = useState("AAPL");

  const getStatusBadge = (ok: boolean | undefined) => {
    if (ok === undefined) return null;
    return ok ? (
      <Badge className="bg-profit/10 text-profit border-profit/20">
        <CheckCircle className="w-3 h-3 mr-1" />
        PASS
      </Badge>
    ) : (
      <Badge className="bg-loss/10 text-loss border-loss/20">
        <XCircle className="w-3 h-3 mr-1" />
        FAIL
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Market Data Proof</CardTitle>
          </div>
        </div>
        <CardDescription>
          Verify real market data is flowing from configured providers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Symbol Input */}
        <div className="flex items-center gap-2">
          <Label htmlFor="symbol" className="text-sm">Symbol:</Label>
          <Input
            id="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-24 h-8"
            placeholder="AAPL"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => testLive(symbol)}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Test Live
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => testHistorical(symbol)}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Database className="w-3 h-3 mr-1" />}
            Test Historical
          </Button>
        </div>

        {/* Live Result */}
        {liveResult && (
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Live Data Test</span>
              {getStatusBadge(liveResult.ok)}
            </div>
            {liveResult.ok ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>Provider:</span>
                  <Badge variant="outline" className="text-[10px]">{liveResult.provider}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  <span>Age: {(liveResult.proof_json as any)?.age_seconds ?? "--"}s</span>
                </div>
                <div className="flex items-center gap-2">
                  <Activity className="w-3 h-3" />
                  <span>Price: ${(liveResult.proof_json as any)?.sample_price ?? (liveResult.data as any)?.close ?? "--"}</span>
                </div>
                <div className="font-mono text-[10px] mt-2 p-2 bg-background rounded">
                  {JSON.stringify(liveResult.proof_json, null, 2).slice(0, 300)}...
                </div>
              </div>
            ) : (
              <p className="text-xs text-loss">{liveResult.error}</p>
            )}
          </div>
        )}

        {/* Historical Result */}
        {historicalResult && (
          <div className="p-3 rounded-lg border border-border bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Historical Data Test</span>
              {getStatusBadge(historicalResult.ok)}
            </div>
            {historicalResult.ok ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span>Provider:</span>
                  <Badge variant="outline" className="text-[10px]">{historicalResult.provider}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="w-3 h-3" />
                  <span>Bars returned: {(historicalResult.proof_json as any)?.bars_returned ?? "--"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>Range: {(historicalResult.proof_json as any)?.range_days ?? "--"} days</span>
                </div>
                <div className="font-mono text-[10px] mt-2 p-2 bg-background rounded">
                  {JSON.stringify(historicalResult.proof_json, null, 2).slice(0, 300)}...
                </div>
              </div>
            ) : (
              <p className="text-xs text-loss">{historicalResult.error}</p>
            )}
          </div>
        )}

        {!liveResult && !historicalResult && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Run a test to verify market data connectivity</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
