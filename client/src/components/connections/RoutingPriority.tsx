import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  GitBranch, 
  Database, 
  Building2, 
  ArrowRight, 
  AlertTriangle,
  CheckCircle,
  Play
} from "lucide-react";
import { useIntegrations } from "@/hooks/useIntegrations";

export function RoutingPriority() {
  const { data: integrations = [] } = useIntegrations();
  
  const marketData = integrations.filter(i => i.kind === 'MARKET_DATA' && i.is_enabled);
  const brokers = integrations.filter(i => i.kind === 'BROKER' && i.is_enabled);

  const hasMarketData = marketData.length > 0;
  const hasBroker = brokers.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Routing & Priority</CardTitle>
          </div>
          <Button variant="outline" size="sm" disabled>
            <Play className="w-3 h-3 mr-1" />
            Dry Run
          </Button>
        </div>
        <CardDescription>
          Configure data source priority and failover policies
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Routing Matrix */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Backtest Data */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px]">BACKTEST_DATA</Badge>
              <span className="text-xs text-muted-foreground">Historical data source</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Primary:</span>
                {hasMarketData ? (
                  <div className="flex items-center gap-1">
                    <Database className="w-3 h-3 text-primary" />
                    <span className="font-medium">{marketData[0]?.label}</span>
                  </div>
                ) : (
                  <span className="text-warning text-xs">Not configured</span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Backup:</span>
                {marketData.length > 1 ? (
                  <span className="text-xs">{marketData[1]?.label}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">None</span>
                )}
              </div>
            </div>
          </div>

          {/* Live Data */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px]">LIVE_DATA</Badge>
              <span className="text-xs text-muted-foreground">Real-time data source</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Primary:</span>
                {hasMarketData ? (
                  <div className="flex items-center gap-1">
                    <Database className="w-3 h-3 text-primary" />
                    <span className="font-medium">{marketData[0]?.label}</span>
                  </div>
                ) : (
                  <span className="text-warning text-xs">Not configured</span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Max Staleness:</span>
                <span className="text-xs font-mono">5000ms</span>
              </div>
            </div>
          </div>

          {/* Internal Sim */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px]">INTERNAL_SIM_FILLS</Badge>
              <span className="text-xs text-muted-foreground">Paper trading engine</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="w-4 h-4 text-profit" />
              <span>Built-in • Always available</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Used for BACKTEST, SIM, and SHADOW modes
            </p>
          </div>

          {/* Broker Execution */}
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px]">BROKER_FILLS</Badge>
              <span className="text-xs text-muted-foreground">Live execution</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Primary:</span>
                {hasBroker ? (
                  <div className="flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-primary" />
                    <span className="font-medium">{brokers[0]?.label}</span>
                  </div>
                ) : (
                  <span className="text-warning text-xs">Not configured</span>
                )}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Failover:</span>
                <Badge variant="secondary" className="text-[9px]">STRICT_FAIL</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Mode Routing Flow */}
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <p className="text-xs font-medium mb-3">Execution Mode Routing</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[9px]">BACKTEST</Badge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>HISTORICAL_DATA</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>INTERNAL_SIM_FILLS</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[9px]">SIM</Badge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>LIVE_DATA</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>INTERNAL_SIM_FILLS</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[9px]">SHADOW</Badge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>LIVE_DATA</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>INTERNAL_SIM_FILLS</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-[9px]">LIVE</Badge>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span>LIVE_DATA</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="font-medium">BROKER_FILLS</span>
              {!hasBroker && <AlertTriangle className="w-3 h-3 text-warning" />}
            </div>
          </div>
        </div>

        {/* Status Summary */}
        <div className="flex items-center justify-between p-3 rounded-lg border border-border">
          <span className="text-sm text-muted-foreground">System Readiness</span>
          <div className="flex items-center gap-2">
            {hasMarketData && hasBroker ? (
              <>
                <CheckCircle className="w-4 h-4 text-profit" />
                <span className="text-sm font-medium text-profit">Ready for LIVE</span>
              </>
            ) : hasMarketData ? (
              <>
                <AlertTriangle className="w-4 h-4 text-warning" />
                <span className="text-sm font-medium text-warning">Paper Trading Only</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4 text-loss" />
                <span className="text-sm font-medium text-loss">Connections Required</span>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
