import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePaperReadinessAudit } from "@/hooks/useProductionScorecard";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  RefreshCw,
  Activity,
  Database,
  GitBranch,
  DollarSign,
} from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

export function ExecutionProofPanel() {
  const { data, isLoading, refetch, isFetching, isError } = usePaperReadinessAudit('24h');

  const isDegraded = isError || (!isLoading && data === undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Execution Proof (PAPER)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Execution Proof (PAPER)</CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="Execution proof data unavailable" />
        </CardContent>
      </Card>
    );
  }

  const StatusIcon = ({ pass }: { pass: boolean }) => 
    pass ? <CheckCircle className="w-5 h-5 text-profit" /> : <XCircle className="w-5 h-5 text-loss" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">Execution Proof (PAPER)</CardTitle>
          <Badge variant={data?.go_paper ? "default" : "destructive"}>
            {data?.go_paper ? 'GO' : 'NO-GO'}
          </Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Runners */}
        <div className="p-4 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Active Runners</span>
            <StatusIcon pass={(data?.active_runners.heartbeat_fresh_pct ?? 0) >= 80} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Paper Bots</p>
              <p className="font-mono text-lg">{data?.active_runners.count_paper_bots ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">With Runner</p>
              <p className="font-mono text-lg">{data?.active_runners.count_with_runner ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fresh Heartbeat</p>
              <p className="font-mono text-lg">{(data?.active_runners.heartbeat_fresh_pct ?? 0).toFixed(0)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Missing</p>
              <p className="font-mono text-lg text-loss">{data?.active_runners.missing_runners?.length ?? 0}</p>
            </div>
          </div>
          {data?.active_runners.missing_runners && data.active_runners.missing_runners.length > 0 && (
            <div className="text-xs text-loss mt-2">
              Missing: {data.active_runners.missing_runners.slice(0, 3).join(', ')}
              {data.active_runners.missing_runners.length > 3 && ` +${data.active_runners.missing_runners.length - 3} more`}
            </div>
          )}
        </div>

        {/* Market Data Continuity */}
        <div className="p-4 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Market Data Continuity</span>
            <StatusIcon pass={(data?.market_data.max_gap_seconds ?? 999) < 300} />
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Bars Ingested</p>
              <p className="font-mono text-lg">{data?.market_data.bars_ingested?.toLocaleString() ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Max Gap</p>
              <p className="font-mono text-lg">{data?.market_data.max_gap_seconds ?? 0}s</p>
            </div>
            <div>
              <p className="text-muted-foreground">Provider</p>
              <p className="font-mono text-lg">{data?.market_data.provider ?? 'N/A'}</p>
            </div>
          </div>
        </div>

        {/* Order Lifecycle Integrity */}
        <div className="p-4 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">Order Lifecycle</span>
            <StatusIcon pass={(data?.order_lifecycle.orphan_orders ?? 0) === 0 && (data?.order_lifecycle.orphan_fills ?? 0) === 0} />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Decisions</p>
              <p className="font-mono">{data?.order_lifecycle.decisions_count ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Orders</p>
              <p className="font-mono">{data?.order_lifecycle.orders_submitted ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Fills</p>
              <p className="font-mono">{data?.order_lifecycle.fills_count ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Trades</p>
              <p className="font-mono">{data?.order_lifecycle.trades_closed ?? 0}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Orphan Orders</p>
              <p className={`font-mono ${(data?.order_lifecycle.orphan_orders ?? 0) > 0 ? 'text-loss' : ''}`}>
                {data?.order_lifecycle.orphan_orders ?? 0}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Orphan Fills</p>
              <p className={`font-mono ${(data?.order_lifecycle.orphan_fills ?? 0) > 0 ? 'text-loss' : ''}`}>
                {data?.order_lifecycle.orphan_fills ?? 0}
              </p>
            </div>
          </div>
        </div>

        {/* PnL Reconciliation */}
        <div className="p-4 rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium">PnL Reconciliation (3-Way)</span>
            <StatusIcon pass={data?.pnl_reconciliation.delta_tolerance_ok ?? false} />
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">From Trades</p>
              <p className={`font-mono text-lg ${(data?.pnl_reconciliation.from_trades ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${(data?.pnl_reconciliation.from_trades ?? 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">From Fills</p>
              <p className={`font-mono text-lg ${(data?.pnl_reconciliation.from_fills ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${(data?.pnl_reconciliation.from_fills ?? 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">From Ledger</p>
              <p className={`font-mono text-lg ${(data?.pnl_reconciliation.from_ledger ?? 0) >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${(data?.pnl_reconciliation.from_ledger ?? 0).toFixed(2)}
              </p>
            </div>
          </div>
          {!data?.pnl_reconciliation.delta_tolerance_ok && (
            <div className="flex items-center gap-2 text-xs text-loss mt-2">
              <AlertTriangle className="w-3 h-3" />
              PnL mismatch detected - reconciliation required
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
