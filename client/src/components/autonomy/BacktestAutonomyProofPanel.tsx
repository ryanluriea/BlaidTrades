import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Activity,
  Clock,
  Play,
  Zap,
  Server,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBacktestAutonomyProof, useLatestProof, useTriggerScheduler } from "@/hooks/useBacktestAutonomyProof";
import { formatDistanceToNow } from "date-fns";

interface ProofCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'PENDING';
  message: string;
  evidence?: any;
}

export function BacktestAutonomyProofPanel() {
  const { data: proofRow, isLoading, refetch } = useLatestProof();
  const runProof = useBacktestAutonomyProof();
  const triggerScheduler = useTriggerScheduler();

  const handleRunProof = async () => {
    await runProof.mutateAsync();
    refetch();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  // Parse the stored proof data from the database row
  const proof = proofRow ? {
    now_utc: proofRow.now_utc,
    now_et: proofRow.now_et,
    market_session: proofRow.market_session,
    is_market_open: proofRow.is_market_open,
    overall_status: proofRow.overall_status,
    blockers_found: proofRow.blockers_found || [],
    bot_state_counts: proofRow.bot_state_counts as Record<string, number> || {},
    job_queue_stats: proofRow.job_queue_stats as any || {},
    worker_status: proofRow.worker_status as any || {},
    backtest_stats_24h: proofRow.backtest_stats_24h as any || {},
    stall_reasons: proofRow.stall_reasons as Record<string, number> || {},
    proof_timestamp: proofRow.proof_timestamp,
  } : null;

  if (!proof) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Backtest Autonomy Proof
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-muted-foreground">
            <p className="text-sm mb-3">No proof data yet</p>
            <div className="flex justify-center gap-2">
              <Button onClick={handleRunProof} disabled={runProof.isPending} size="sm">
                <Zap className="w-4 h-4 mr-1" />
                {runProof.isPending ? "Running..." : "Run Proof"}
              </Button>
              <Button onClick={() => triggerScheduler.mutate()} disabled={triggerScheduler.isPending} size="sm" variant="outline">
                <Play className="w-4 h-4 mr-1" />
                {triggerScheduler.isPending ? "Running..." : "Trigger Scheduler"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallPass = proof.overall_status === 'PASS';
  const blockers = proof.blockers_found || [];

  // Build proof checks from the proof data
  const checks: ProofCheck[] = [];

  // Worker check
  const workerOnline = (proof.worker_status?.online_count || 0) > 0;
  const lastHeartbeatAge = proof.worker_status?.last_heartbeat_age_seconds || 999;
  checks.push({
    name: "Worker Heartbeat",
    status: workerOnline && lastHeartbeatAge < 120 ? 'PASS' : 'FAIL',
    message: workerOnline 
      ? `${proof.worker_status.online_count} online, last heartbeat ${lastHeartbeatAge}s ago`
      : "No active workers detected",
    evidence: proof.worker_status,
  });

  // Job queue check
  const queuedJobs = proof.job_queue_stats?.by_status?.QUEUED || 0;
  const oldestQueuedAge = proof.job_queue_stats?.oldest_queued_age_minutes || 0;
  const queueHealthy = queuedJobs === 0 || oldestQueuedAge < 5;
  checks.push({
    name: "Job Queue Health",
    status: queueHealthy ? 'PASS' : 'WARN',
    message: queuedJobs === 0 
      ? "No jobs queued"
      : `${queuedJobs} queued, oldest ${oldestQueuedAge?.toFixed(1)} min`,
    evidence: proof.job_queue_stats,
  });

  // Backtest activity check (24h)
  const bt24h = proof.backtest_stats_24h;
  const completed24h = bt24h?.by_status?.completed || 0;
  const hasRecentBacktests = completed24h > 0;
  checks.push({
    name: "Backtest Activity (24h)",
    status: hasRecentBacktests ? 'PASS' : 'WARN',
    message: hasRecentBacktests
      ? `${completed24h} completed, ${bt24h?.by_status?.running || 0} running, median ${bt24h?.median_total_trades || 0} trades`
      : "No backtests completed in 24h",
    evidence: bt24h,
  });

  // Backtest quality check
  const medianTrades = bt24h?.median_total_trades || 0;
  checks.push({
    name: "Backtest Quality (Trades)",
    status: medianTrades >= 20 ? 'PASS' : medianTrades >= 5 ? 'WARN' : 'FAIL',
    message: `Median ${medianTrades} trades/session (target: ≥20)`,
  });

  // Bot state distribution
  const botCounts = proof.bot_state_counts || {};
  const idleCount = botCounts.IDLE || 0;
  const runningCount = botCounts.RUNNING || 0;
  const stalledCount = botCounts.STALLED || 0;
  checks.push({
    name: "Bot States",
    status: stalledCount > 0 ? 'WARN' : 'PASS',
    message: `${runningCount} running, ${idleCount} idle, ${stalledCount} stalled`,
    evidence: botCounts,
  });

  // Stall reasons
  if (proof.stall_reasons && Object.keys(proof.stall_reasons).length > 0) {
    Object.entries(proof.stall_reasons).forEach(([reason, count]) => {
      checks.push({
        name: `Stall: ${reason}`,
        status: 'WARN',
        message: `${count} bot(s) stalled`,
      });
    });
  }

  return (
    <Card className={cn(
      "border-2",
      overallPass ? "border-profit/30" : "border-loss/30"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Backtest Autonomy Proof
            <Badge variant={overallPass ? "default" : "destructive"}>
              {proof.overall_status || 'UNKNOWN'}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatAge(proof.proof_timestamp)}
            </span>
            <Button variant="outline" size="sm" onClick={() => triggerScheduler.mutate()} disabled={triggerScheduler.isPending}>
              <Play className={cn("w-4 h-4 mr-1", triggerScheduler.isPending && "animate-pulse")} />
              Scheduler
            </Button>
            <Button variant="outline" size="sm" onClick={handleRunProof} disabled={runProof.isPending}>
              <Zap className={cn("w-4 h-4 mr-1", runProof.isPending && "animate-pulse")} />
              Proof
            </Button>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-xs">
          {proof.now_et} ET • {proof.market_session || 'Unknown'} • Market {proof.is_market_open ? 'Open' : 'Closed'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Blockers Banner */}
        {blockers.length > 0 && (
          <div className="p-3 rounded-lg bg-loss/10 border border-loss/30">
            <div className="flex items-center gap-2 text-loss font-medium text-sm mb-2">
              <XCircle className="w-4 h-4" />
              {blockers.length} Blocker(s) Detected
            </div>
            <div className="flex flex-wrap gap-2">
              {blockers.map((blocker: string, idx: number) => (
                <Badge key={idx} variant="outline" className="text-xs bg-loss/5 border-loss/30 text-loss">
                  {blocker}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Proof Checks Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {checks.map((check, idx) => (
            <ProofCheckRow key={idx} check={check} />
          ))}
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-3">
          <QuickStat 
            icon={<Server className="w-4 h-4" />}
            label="Workers"
            value={proof.worker_status?.online_count || 0}
            status={(proof.worker_status?.online_count || 0) > 0 ? 'ok' : 'fail'}
          />
          <QuickStat 
            icon={<Database className="w-4 h-4" />}
            label="Queued"
            value={proof.job_queue_stats?.by_status?.QUEUED || 0}
            status="ok"
          />
          <QuickStat 
            icon={<Play className="w-4 h-4" />}
            label="Running"
            value={proof.job_queue_stats?.by_status?.RUNNING || 0}
            status="ok"
          />
          <QuickStat 
            icon={<CheckCircle2 className="w-4 h-4" />}
            label="Done (24h)"
            value={proof.backtest_stats_24h?.by_status?.completed || 0}
            status={(proof.backtest_stats_24h?.by_status?.completed || 0) > 0 ? 'ok' : 'warn'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ProofCheckRow({ check }: { check: ProofCheck }) {
  const statusIcon = {
    PASS: <CheckCircle2 className="w-4 h-4 text-profit" />,
    FAIL: <XCircle className="w-4 h-4 text-loss" />,
    WARN: <AlertTriangle className="w-4 h-4 text-warning" />,
    PENDING: <Clock className="w-4 h-4 text-muted-foreground" />,
  }[check.status];

  return (
    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/50">
      {statusIcon}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{check.name}</p>
        <p className="text-[10px] text-muted-foreground truncate">{check.message}</p>
      </div>
    </div>
  );
}

function QuickStat({ icon, label, value, status }: { 
  icon: React.ReactNode; 
  label: string; 
  value: number | string; 
  status: 'ok' | 'warn' | 'fail';
}) {
  return (
    <div className="text-center p-2 rounded-md bg-muted/30">
      <div className={cn(
        "flex justify-center mb-1",
        status === 'ok' && "text-profit",
        status === 'warn' && "text-warning",
        status === 'fail' && "text-loss",
      )}>
        {icon}
      </div>
      <p className="text-lg font-bold font-mono">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

function formatAge(timestamp: string | null | undefined): string {
  if (!timestamp) return 'Never';
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return 'Invalid';
  }
}
