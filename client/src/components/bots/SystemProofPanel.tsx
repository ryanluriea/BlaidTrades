import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Activity, 
  BarChart3, 
  Bot, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import http from "@/lib/http";

interface SystemProofResult {
  ok: boolean;
  timestamp: string;
  jobs: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
    stuckJobs: number;
  };
  backtests: {
    totalCompleted: number;
    avgTradesPerSession: number;
    medianTradesPerSession: number;
    sanityFailedCount: number;
    recentCompleted: number;
  };
  bots: {
    total: number;
    with30PlusTrades: number;
    eligibleForPromotion: number;
    byStage: Record<string, number>;
  };
  sources: {
    decisionsLast60Min: number;
    sourcesLast60Min: number;
  };
  promotions: {
    eligibleBots: { id: string; name: string; reason: string }[];
    blockedBots: { id: string; name: string; blockers: string[] }[];
  };
  health: {
    marketDataStatus: string;
    brokerStatus: string;
    redisStatus: string;
  };
}

function StatCard({ label, value, icon: Icon, status }: { 
  label: string; 
  value: string | number; 
  icon?: React.ElementType;
  status?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
      {Icon && (
        <Icon className={cn(
          "w-4 h-4",
          status === 'good' && "text-profit",
          status === 'warn' && "text-warning",
          status === 'bad' && "text-destructive",
          !status && "text-muted-foreground"
        )} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="font-mono text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export function SystemProofPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SystemProofResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runProof = async () => {
    setLoading(true);
    setError(null);
    try {
      // Call Express endpoint (single control plane)
      const response = await http.get<SystemProofResult>('/api/system/status');
      
      if (!response.ok || !response.data) {
        throw new Error(response.error || 'Failed to get system proof');
      }
      
      setResult(response.data);
      toast.success('System proof completed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to run proof';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4" />
            System Proof
          </CardTitle>
          <Button size="sm" variant="outline" onClick={runProof} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Run Proof
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded text-sm text-destructive">
            <XCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {result && !loading && (
          <div className="space-y-4">
            {/* Timestamp */}
            <p className="text-xs text-muted-foreground">
              Last run: {new Date(result.timestamp).toLocaleString()}
            </p>

            {/* Jobs */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Jobs (last 60 min)
              </h4>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                <StatCard label="Queued" value={result.jobs.queued} />
                <StatCard label="Running" value={result.jobs.running} />
                <StatCard 
                  label="Completed" 
                  value={result.jobs.completed} 
                  status={result.jobs.completed > 0 ? 'good' : undefined}
                />
                <StatCard 
                  label="Failed" 
                  value={result.jobs.failed}
                  status={result.jobs.failed > 0 ? 'bad' : 'good'}
                />
                <StatCard 
                  label="Stuck" 
                  value={result.jobs.stuckJobs}
                  status={result.jobs.stuckJobs > 0 ? 'bad' : 'good'}
                />
              </div>
            </div>

            {/* Backtests */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                Backtests
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard label="Completed" value={result.backtests.totalCompleted} />
                <StatCard 
                  label="Avg Trades/Session" 
                  value={result.backtests.avgTradesPerSession}
                  status={result.backtests.avgTradesPerSession >= 20 ? 'good' : 'warn'}
                />
                <StatCard label="Median Trades" value={result.backtests.medianTradesPerSession} />
                <StatCard 
                  label="Sanity Failed" 
                  value={result.backtests.sanityFailedCount}
                  status={result.backtests.sanityFailedCount > 0 ? 'warn' : 'good'}
                />
              </div>
            </div>

            {/* Bots */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
                <Bot className="w-3 h-3" />
                Bots
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard label="Total" value={result.bots.total} />
                <StatCard 
                  label="30+ Trades" 
                  value={result.bots.with30PlusTrades}
                  status={result.bots.with30PlusTrades > 0 ? 'good' : 'warn'}
                />
                <StatCard 
                  label="Eligible" 
                  value={result.bots.eligibleForPromotion}
                  status={result.bots.eligibleForPromotion > 0 ? 'good' : undefined}
                />
                <StatCard label="By Stage" value={Object.entries(result.bots.byStage).map(([k,v]) => `${k}:${v}`).join(' ')} />
              </div>
            </div>

            {/* Promotions */}
            <div>
              <h4 className="text-xs font-medium mb-2">Promotion Status</h4>
              {result.promotions.eligibleBots.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-profit mb-1">
                    <CheckCircle className="w-3 h-3 inline mr-1" />
                    Eligible ({result.promotions.eligibleBots.length}):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {result.promotions.eligibleBots.map(b => (
                      <Badge key={b.id} variant="outline" className="text-xs bg-profit/10 text-profit">
                        {b.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {result.promotions.blockedBots.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                    Blocked ({result.promotions.blockedBots.length}):
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {result.promotions.blockedBots.slice(0, 5).map(b => (
                      <div key={b.id} className="text-xs bg-muted/50 p-1 rounded">
                        <span className="font-medium">{b.name}:</span>{' '}
                        <span className="text-muted-foreground">{b.blockers.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Health */}
            <div>
              <h4 className="text-xs font-medium mb-2">Health</h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={cn(
                  "text-xs",
                  result.health.marketDataStatus === 'VERIFIED' && "bg-profit/10 text-profit",
                  result.health.marketDataStatus === 'NOT_CONFIGURED' && "bg-warning/10 text-warning"
                )}>
                  Data: {result.health.marketDataStatus}
                </Badge>
                <Badge variant="outline" className={cn(
                  "text-xs",
                  result.health.brokerStatus === 'VERIFIED' && "bg-profit/10 text-profit",
                  result.health.brokerStatus === 'NOT_CONFIGURED' && "bg-muted"
                )}>
                  Broker: {result.health.brokerStatus}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {!result && !loading && !error && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Click "Run Proof" to check system status
          </p>
        )}
      </CardContent>
    </Card>
  );
}
