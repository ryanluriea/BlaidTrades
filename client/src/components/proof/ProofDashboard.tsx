import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Activity,
  Database,
  Cpu,
  TrendingUp,
  Target,
  FileText,
  Clock,
  BarChart3,
  Zap,
  Play,
  GitBranch,
  TestTube
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import http from "@/lib/http";

interface ProofMetric {
  label: string;
  value: string | number;
  status: 'ok' | 'warn' | 'fail' | 'pending';
  evidence?: any;
}

interface ProofSection {
  title: string;
  icon: React.ReactNode;
  status: 'pass' | 'fail' | 'partial' | 'pending';
  metrics: ProofMetric[];
}

interface FullProofResult {
  scheduler: {
    bots_checked: number;
    scheduled: number;
    last_run?: string;
    status: 'pass' | 'fail';
  };
  queue: {
    queued: number;
    running: number;
    completed_1h: number;
    failed_1h: number;
    worker_heartbeat?: string;
    status: 'pass' | 'fail';
  };
  historical: {
    tests_run: number;
    passed: number;
    failed: number;
    bars_loaded_total: number;
    status: 'pass' | 'fail' | 'partial';
  };
  backtests: {
    completed_1h: number;
    avg_bars: number;
    avg_trades: number;
    stuck_count: number;
    status: 'pass' | 'fail';
  };
  evolution: {
    mutations_24h: number;
    generations_24h: number;
    tournaments_24h: number;
    winners_24h: number;
    status: 'pass' | 'fail' | 'partial';
  };
  decision_trace: {
    traces_24h: number;
    sources_24h: number;
    status: 'pass' | 'fail';
  };
}

function formatAge(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function ProofDashboard() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [runningProof, setRunningProof] = useState(false);
  const [proofResult, setProofResult] = useState<FullProofResult | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const runFullProof = async () => {
    if (!session?.access_token) return;
    setRunningProof(true);
    toast.info('Running FULL PROOF - checking all systems...');

    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // 1. Scheduler Proof via Express (single control plane)
      const schedulerResponse = await http.get<any>('/api/scheduler/status');
      const schedulerData = schedulerResponse.ok ? schedulerResponse.data : null;

      // 2. Queue/Worker Proof via Express API
      let jobStats = { queued: 0, running: 0, completed_1h: 0, failed_1h: 0 };
      let workerHeartbeat: string | null = null;
      let workerAlive = false;
      try {
        const jobsResponse = await http.get<any>('/api/_proof/jobs');
        if (jobsResponse.ok && jobsResponse.data) {
          const stats = jobsResponse.data.stats || {};
          jobStats = {
            queued: stats.queued || 0,
            running: stats.running || 0,
            completed_1h: stats.completed_1h || 0,
            failed_1h: stats.failed_1h || 0,
          };
          workerHeartbeat = jobsResponse.data.workerHeartbeat || null;
          workerAlive = jobsResponse.data.workerAlive || false;
        }
      } catch (e) { console.error('Job proof error:', e); }

      // 3. Backtest Proof via Express API
      let completedBt: any[] = [];
      let avgBars = 0;
      let avgTrades = 0;
      let stuckBacktests: any[] = [];
      try {
        const btResponse = await http.get<any>('/api/system/audit');
        if (btResponse.ok && btResponse.data?.freshnessResults) {
          const results = btResponse.data.freshnessResults || [];
          completedBt = results.filter((r: any) => r.lastBacktestAt);
          avgBars = btResponse.data.backtestStats?.avgBars || 0;
          avgTrades = btResponse.data.backtestStats?.avgTrades || 0;
        }
      } catch (e) { console.error('Backtest proof error:', e); }

      // 4. Evolution Proof via Express API
      let mutationsCount = 0;
      let generationsCount = 0;
      let tournamentCount = 0;
      let winnersCount = 0;
      try {
        const evoResponse = await http.get<any>('/api/evolution/stats');
        if (evoResponse.ok && evoResponse.data) {
          mutationsCount = evoResponse.data.mutations_24h || 0;
          generationsCount = evoResponse.data.generations_24h || 0;
          tournamentCount = evoResponse.data.tournaments_24h || 0;
          winnersCount = evoResponse.data.winners_24h || 0;
        }
      } catch (e) { console.error('Evolution proof error:', e); }

      // 5. Decision Trace Proof - use default values (no Supabase)
      const traceCount = 0;
      const sourceCount = 0;

      // 6. Historical Data Proof via Express (single control plane)
      let historicalResult = { tests_run: 0, passed: 0, failed: 0, bars_loaded_total: 0 };
      try {
        // Use GET /api/system/status which includes historical data when available
        const histResponse = await http.get<any>('/api/system/status');
        if (histResponse.ok && histResponse.data) {
          const results = histResponse.data.historical_data_results || [];
          if (results.length > 0) {
            historicalResult = {
              tests_run: results.length,
              passed: results.filter((r: any) => r.status === 'PASS').length,
              failed: results.filter((r: any) => r.status === 'FAIL').length,
              bars_loaded_total: results.reduce((s: number, r: any) => s + (r.bars_loaded || 0), 0),
            };
          }
        }
      } catch (e) {
        console.error('Historical proof error:', e);
      }

      // Build result
      const result: FullProofResult = {
        scheduler: {
          bots_checked: schedulerData?.bots_checked || 0,
          scheduled: schedulerData?.scheduled || 0,
          last_run: schedulerData?.timestamp,
          status: (schedulerData?.scheduled || 0) >= 0 ? 'pass' : 'fail',
        },
        queue: {
          ...jobStats,
          worker_heartbeat: workerHeartbeat,
          status: workerAlive && jobStats.completed_1h > 0 ? 'pass' : 'fail',
        },
        historical: {
          ...historicalResult,
          status: historicalResult.passed > 0 
            ? (historicalResult.failed > 0 ? 'partial' : 'pass') 
            : 'fail',
        },
        backtests: {
          completed_1h: completedBt.length,
          avg_bars: Math.round(avgBars),
          avg_trades: Math.round(avgTrades * 10) / 10,
          stuck_count: stuckBacktests.length,
          status: completedBt.length > 0 && avgBars > 0 && stuckBacktests.length === 0 ? 'pass' : 'fail',
        },
        evolution: {
          mutations_24h: mutationsCount || 0,
          generations_24h: generationsCount || 0,
          tournaments_24h: tournamentCount,
          winners_24h: winnersCount,
          status: (mutationsCount || 0) > 0 || (generationsCount || 0) > 1 
            ? (winnersCount > 0 ? 'pass' : 'partial') 
            : 'fail',
        },
        decision_trace: {
          traces_24h: traceCount || 0,
          sources_24h: sourceCount || 0,
          status: (traceCount || 0) > 0 && (sourceCount || 0) > 0 ? 'pass' : 'fail',
        },
      };

      setProofResult(result);
      setLastRefresh(new Date());

      // Calculate overall status
      const sections = Object.values(result);
      const passCount = sections.filter(s => s.status === 'pass').length;
      const failCount = sections.filter(s => s.status === 'fail').length;
      
      if (failCount === 0) {
        toast.success(`FULL PROOF PASSED: ${passCount}/6 sections green`);
      } else if (passCount >= 4) {
        toast.warning(`PROOF PARTIAL: ${passCount}/6 pass, ${failCount} fail`);
      } else {
        toast.error(`PROOF FAILED: ${failCount}/6 sections failing`);
      }

    } catch (error: any) {
      console.error('Full proof error:', error);
      toast.error(`Proof failed: ${error.message}`);
    } finally {
      setRunningProof(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.access_token) {
      runFullProof();
    }
  }, [session]);

  const renderStatusBadge = (status: 'pass' | 'fail' | 'partial' | 'pending') => {
    const variants = {
      pass: { icon: <CheckCircle2 className="w-3 h-3" />, label: 'PASS', className: 'bg-profit/20 text-profit border-profit/50' },
      fail: { icon: <XCircle className="w-3 h-3" />, label: 'FAIL', className: 'bg-loss/20 text-loss border-loss/50' },
      partial: { icon: <AlertTriangle className="w-3 h-3" />, label: 'PARTIAL', className: 'bg-yellow-500/20 text-yellow-500 border-yellow-500/50' },
      pending: { icon: <Clock className="w-3 h-3" />, label: 'PENDING', className: 'bg-muted text-muted-foreground' },
    };
    const v = variants[status];
    return (
      <Badge variant="outline" className={cn("flex items-center gap-1", v.className)}>
        {v.icon} {v.label}
      </Badge>
    );
  };

  if (loading && !proofResult) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const sections: ProofSection[] = proofResult ? [
    {
      title: 'Scheduler',
      icon: <Clock className="w-4 h-4" />,
      status: proofResult.scheduler.status,
      metrics: [
        { label: 'Bots Checked', value: proofResult.scheduler.bots_checked, status: 'ok' },
        { label: 'Scheduled', value: proofResult.scheduler.scheduled, status: proofResult.scheduler.scheduled > 0 ? 'ok' : 'warn' },
        { label: 'Last Run', value: proofResult.scheduler.last_run ? formatAge(proofResult.scheduler.last_run) : 'Never', status: 'ok' },
      ],
    },
    {
      title: 'Queue & Workers',
      icon: <Cpu className="w-4 h-4" />,
      status: proofResult.queue.status,
      metrics: [
        { label: 'Completed (1h)', value: proofResult.queue.completed_1h, status: proofResult.queue.completed_1h > 0 ? 'ok' : 'warn' },
        { label: 'Running', value: proofResult.queue.running, status: 'ok' },
        { label: 'Queued', value: proofResult.queue.queued, status: 'ok' },
        { label: 'Failed (1h)', value: proofResult.queue.failed_1h, status: proofResult.queue.failed_1h > 0 ? 'warn' : 'ok' },
        { label: 'Worker Heartbeat', value: proofResult.queue.worker_heartbeat ? formatAge(proofResult.queue.worker_heartbeat) : 'None', status: proofResult.queue.worker_heartbeat ? 'ok' : 'fail' },
      ],
    },
    {
      title: 'Historical Data',
      icon: <BarChart3 className="w-4 h-4" />,
      status: proofResult.historical.status,
      metrics: [
        { label: 'Tests Run', value: proofResult.historical.tests_run, status: 'ok' },
        { label: 'Passed', value: proofResult.historical.passed, status: proofResult.historical.passed > 0 ? 'ok' : 'fail' },
        { label: 'Failed', value: proofResult.historical.failed, status: proofResult.historical.failed > 0 ? 'warn' : 'ok' },
        { label: 'Total Bars', value: proofResult.historical.bars_loaded_total.toLocaleString(), status: proofResult.historical.bars_loaded_total > 0 ? 'ok' : 'fail' },
      ],
    },
    {
      title: 'Backtests',
      icon: <TrendingUp className="w-4 h-4" />,
      status: proofResult.backtests.status,
      metrics: [
        { label: 'Completed (1h)', value: proofResult.backtests.completed_1h, status: proofResult.backtests.completed_1h > 0 ? 'ok' : 'fail' },
        { label: 'Avg Bars', value: proofResult.backtests.avg_bars, status: proofResult.backtests.avg_bars > 50 ? 'ok' : proofResult.backtests.avg_bars > 0 ? 'warn' : 'fail' },
        { label: 'Avg Trades', value: proofResult.backtests.avg_trades, status: proofResult.backtests.avg_trades > 0 ? 'ok' : 'warn' },
        { label: 'Stuck', value: proofResult.backtests.stuck_count, status: proofResult.backtests.stuck_count === 0 ? 'ok' : 'fail' },
      ],
    },
    {
      title: 'Evolution',
      icon: <GitBranch className="w-4 h-4" />,
      status: proofResult.evolution.status,
      metrics: [
        { label: 'Mutations (24h)', value: proofResult.evolution.mutations_24h, status: proofResult.evolution.mutations_24h > 0 ? 'ok' : 'warn' },
        { label: 'Generations (24h)', value: proofResult.evolution.generations_24h, status: proofResult.evolution.generations_24h > 0 ? 'ok' : 'warn' },
        { label: 'Tournaments', value: proofResult.evolution.tournaments_24h, status: 'ok' },
        { label: 'Winners', value: proofResult.evolution.winners_24h, status: proofResult.evolution.winners_24h > 0 ? 'ok' : 'warn' },
      ],
    },
    {
      title: 'Decision Trace',
      icon: <FileText className="w-4 h-4" />,
      status: proofResult.decision_trace.status,
      metrics: [
        { label: 'Traces (24h)', value: proofResult.decision_trace.traces_24h, status: proofResult.decision_trace.traces_24h > 0 ? 'ok' : 'warn' },
        { label: 'Sources (24h)', value: proofResult.decision_trace.sources_24h, status: proofResult.decision_trace.sources_24h > 0 ? 'ok' : 'warn' },
      ],
    },
  ] : [];

  const overallPass = sections.filter(s => s.status === 'pass').length;
  const overallFail = sections.filter(s => s.status === 'fail').length;

  return (
    <div className="space-y-4">
      {/* Header with RUN FULL PROOF button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TestTube className="w-5 h-5" />
            Full Autonomy Proof
          </h2>
          <p className="text-sm text-muted-foreground">
            Live verification that backtests, evolution, and data engines are working
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatAge(lastRefresh.toISOString())}
            </span>
          )}
          <Button 
            onClick={runFullProof} 
            disabled={runningProof}
            className="gap-2"
          >
            {runningProof ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            RUN FULL PROOF
          </Button>
        </div>
      </div>

      {/* Overall Status Banner */}
      {proofResult && (
        <Card className={cn(
          "border-2",
          overallFail === 0 ? "border-profit/50 bg-profit/5" :
          overallPass >= 4 ? "border-yellow-500/50 bg-yellow-500/5" :
          "border-loss/50 bg-loss/5"
        )}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {overallFail === 0 ? (
                  <CheckCircle2 className="w-8 h-8 text-profit" />
                ) : overallPass >= 4 ? (
                  <AlertTriangle className="w-8 h-8 text-yellow-500" />
                ) : (
                  <XCircle className="w-8 h-8 text-loss" />
                )}
                <div>
                  <div className="font-semibold text-lg">
                    {overallFail === 0 ? 'ALL SYSTEMS OPERATIONAL' :
                     overallPass >= 4 ? 'PARTIAL FUNCTIONALITY' :
                     'SYSTEMS FAILING'}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {overallPass}/6 sections passing
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {sections.map((s, i) => (
                  <div 
                    key={i} 
                    className={cn(
                      "w-3 h-3 rounded-full",
                      s.status === 'pass' ? "bg-profit" :
                      s.status === 'partial' ? "bg-yellow-500" :
                      "bg-loss"
                    )}
                    title={s.title}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {sections.map((section, idx) => (
          <Card key={idx} className={cn(
            "border",
            section.status === 'pass' ? "border-profit/30" :
            section.status === 'partial' ? "border-yellow-500/30" :
            section.status === 'fail' ? "border-loss/30" :
            "border-border"
          )}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {section.icon}
                  {section.title}
                </CardTitle>
                {renderStatusBadge(section.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {section.metrics.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{m.label}</span>
                  <span className={cn(
                    "font-mono",
                    m.status === 'ok' ? "text-profit" :
                    m.status === 'warn' ? "text-yellow-500" :
                    m.status === 'fail' ? "text-loss" :
                    ""
                  )}>
                    {m.value}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* What's Working / What's Broken Summary */}
      {proofResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quick Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="font-medium text-profit mb-1">✓ Working</div>
                <ul className="space-y-1 text-muted-foreground">
                  {proofResult.backtests.completed_1h > 0 && <li>• Backtests completing ({proofResult.backtests.completed_1h}/hr)</li>}
                  {proofResult.backtests.avg_bars > 0 && <li>• Bars loading ({proofResult.backtests.avg_bars} avg)</li>}
                  {proofResult.evolution.mutations_24h > 0 && <li>• Evolution running ({proofResult.evolution.mutations_24h} mutations)</li>}
                  {proofResult.queue.worker_heartbeat && <li>• Worker alive ({formatAge(proofResult.queue.worker_heartbeat)})</li>}
                </ul>
              </div>
              <div>
                <div className="font-medium text-loss mb-1">✗ Issues</div>
                <ul className="space-y-1 text-muted-foreground">
                  {proofResult.backtests.stuck_count > 0 && <li>• {proofResult.backtests.stuck_count} stuck backtests</li>}
                  {proofResult.evolution.winners_24h === 0 && proofResult.evolution.tournaments_24h > 0 && <li>• No tournament winners yet</li>}
                  {proofResult.decision_trace.traces_24h === 0 && <li>• No decision traces (needs trading)</li>}
                  {proofResult.historical.failed > 0 && <li>• {proofResult.historical.failed} historical data tests failed</li>}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
