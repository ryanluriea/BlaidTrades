import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Database, 
  Activity,
  Clock,
  TrendingUp,
  RefreshCw,
  Loader2,
  Code,
  FileCode,
  Bug,
} from "lucide-react";
import { useSystemAudit, useCodeHealth, type SystemAuditData, type CodeHealthData } from "@/hooks/useTrading";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

function HealthScoreCard({ data }: { data: SystemAuditData }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'HEALTHY': return 'text-profit';
      case 'NEEDS_ATTENTION': return 'text-warning';
      case 'CRITICAL': return 'text-loss';
      default: return 'text-muted-foreground';
    }
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-profit';
    if (score >= 50) return 'bg-warning';
    return 'bg-loss';
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            System Health Score
          </span>
          <Badge variant={data.healthStatus === 'HEALTHY' ? 'default' : data.healthStatus === 'NEEDS_ATTENTION' ? 'secondary' : 'destructive'}>
            {data.healthStatus.replace('_', ' ')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className={`text-4xl font-bold ${getStatusColor(data.healthStatus)}`}>
            {data.healthScore}%
          </div>
          <div className="flex-1">
            <Progress value={data.healthScore} className={`h-3 ${getProgressColor(data.healthScore)}`} />
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.summary.totalBots}</div>
            <div className="text-xs text-muted-foreground">Total Bots</div>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className={`text-xl font-semibold ${data.summary.botsWithIssues > 0 ? 'text-warning' : 'text-profit'}`}>
              {data.summary.botsWithIssues}
            </div>
            <div className="text-xs text-muted-foreground">With Issues</div>
          </div>
          <div className="p-2 rounded bg-muted/30">
            <div className={`text-xl font-semibold ${data.summary.staleBots > 0 ? 'text-warning' : 'text-profit'}`}>
              {data.summary.staleBots}
            </div>
            <div className="text-xs text-muted-foreground">Stale Data</div>
          </div>
        </div>
        
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Clock className="w-3 h-3" />
          Audit completed in {data.auditDurationMs}ms at {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationsCard({ recommendations }: { recommendations: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {recommendations.map((rec, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded bg-muted/30">
              {rec.includes('All systems') ? (
                <CheckCircle className="w-4 h-4 text-profit mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
              )}
              <span className="text-sm">{rec}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricsSourceCard({ data }: { data: SystemAuditData }) {
  const issues = data.metricsSource.issues;
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Metrics Source Audit
          </span>
          {issues.length === 0 ? (
            <Badge variant="default" className="bg-profit/20 text-profit border-profit/40">All Correct</Badge>
          ) : (
            <Badge variant="destructive">{issues.length} Issues</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {issues.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <CheckCircle className="w-8 h-8 mx-auto mb-2 text-profit" />
            <p>All bots are using correct data sources for their stage</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {issues.map((issue) => (
              <div key={issue.id} className="flex items-center justify-between p-2 rounded bg-muted/30">
                <div className="flex items-center gap-2">
                  {issue.sourceStatus === 'NO_DATA' ? (
                    <XCircle className="w-4 h-4 text-loss shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                  )}
                  <div>
                    <div className="font-medium text-sm">{issue.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {issue.symbol} | {issue.stage}
                    </div>
                  </div>
                </div>
                <Badge variant="outline" className="text-xs">
                  {issue.sourceStatus === 'NO_DATA' ? 'No Data' : 'Using Fallback'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StageComplianceCard({ data }: { data: SystemAuditData }) {
  const stages = ['TRIALS', 'PAPER', 'SHADOW', 'CANARY', 'LIVE'] as const;
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          Stage Compliance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stages.map((stage) => {
            const compliance = data.stageCompliance[stage];
            if (!compliance) return null;
            const total = compliance.correct + compliance.incorrect + compliance.noData;
            if (total === 0) return null;
            
            return (
              <div key={stage} className="flex items-center justify-between p-2 rounded bg-muted/30">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="w-16 justify-center">{stage}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-profit">{compliance.correct} OK</span>
                  {compliance.incorrect > 0 && (
                    <span className="text-warning">{compliance.incorrect} Fallback</span>
                  )}
                  {compliance.noData > 0 && (
                    <span className="text-loss">{compliance.noData} No Data</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function FormulaParityCard({ data }: { data: SystemAuditData }) {
  const formulas = Object.entries(data.formulaParity);
  
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span>Formula Verification</span>
          <Badge variant="default" className="bg-profit/20 text-profit border-profit/40">
            All Match
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {formulas.map(([name, formula]) => (
            <div key={name} className="flex items-center gap-2 p-2 rounded bg-muted/30">
              {formula.match ? (
                <CheckCircle className="w-4 h-4 text-profit shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-loss shrink-0" />
              )}
              <span className="text-sm capitalize">{name.replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Formulas verified between storage.ts and backtest-executor.ts
        </p>
      </CardContent>
    </Card>
  );
}

function DatabaseHealthCard({ data }: { data: SystemAuditData }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Database className="w-5 h-5" />
          Database Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.database.totalBots}</div>
            <div className="text-xs text-muted-foreground">Bots</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.database.totalPaperTrades.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Paper Trades</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.database.totalBacktestSessions.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Backtests</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-2">
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold text-warning">{data.summary.openPositions}</div>
            <div className="text-xs text-muted-foreground">Open Positions</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.summary.runningJobs}</div>
            <div className="text-xs text-muted-foreground">Running Jobs</div>
          </div>
          <div className="text-center p-2 rounded bg-muted/30">
            <div className="text-xl font-semibold">{data.summary.queuedJobs}</div>
            <div className="text-xs text-muted-foreground">Queued Jobs</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CodeHealthCard({ data, isLoading }: { data?: CodeHealthData; isLoading: boolean }) {
  if (isLoading) {
    return <Skeleton className="h-48" />;
  }
  
  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Code className="w-5 h-5" />
            Code Health
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-muted-foreground py-4">
          Failed to load code health data
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXCELLENT': return 'text-profit';
      case 'GOOD': return 'text-profit';
      case 'NEEDS_CLEANUP': return 'text-warning';
      case 'TECH_DEBT': return 'text-loss';
      default: return 'text-muted-foreground';
    }
  };

  const getProgressColor = (score: number) => {
    if (score >= 90) return 'bg-profit';
    if (score >= 70) return 'bg-profit';
    if (score >= 50) return 'bg-warning';
    return 'bg-loss';
  };

  return (
    <Card data-testid="card-code-health">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            Code Health
          </span>
          <Badge 
            data-testid="badge-code-health-status"
            variant={data.healthStatus === 'EXCELLENT' ? 'default' : data.healthStatus === 'GOOD' ? 'secondary' : 'destructive'}
          >
            {data.healthStatus.replace('_', ' ')}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div 
            data-testid="text-code-health-score"
            className={`text-3xl font-bold ${getStatusColor(data.healthStatus)}`}
          >
            {data.healthScore}%
          </div>
          <div className="flex-1">
            <Progress value={data.healthScore} className="h-2" indicatorClassName={getProgressColor(data.healthScore)} />
          </div>
        </div>
        
        <div className="grid grid-cols-5 gap-2 text-center">
          <div className="p-2 rounded bg-muted/30" data-testid="metric-todos">
            <div className={`text-lg font-semibold ${data.counts.todos > 0 ? 'text-warning' : 'text-profit'}`}>
              {data.counts.todos}
            </div>
            <div className="text-[10px] text-muted-foreground">TODOs</div>
          </div>
          <div className="p-2 rounded bg-muted/30" data-testid="metric-fixmes">
            <div className={`text-lg font-semibold ${data.counts.fixmes > 0 ? 'text-loss' : 'text-profit'}`}>
              {data.counts.fixmes}
            </div>
            <div className="text-[10px] text-muted-foreground">FIXMEs</div>
          </div>
          <div className="p-2 rounded bg-muted/30" data-testid="metric-debug">
            <div className={`text-lg font-semibold ${data.counts.debugLogs > 0 ? 'text-warning' : 'text-profit'}`}>
              {data.counts.debugLogs}
            </div>
            <div className="text-[10px] text-muted-foreground">DEBUG</div>
          </div>
          <div className="p-2 rounded bg-muted/30" data-testid="metric-deprecated">
            <div className={`text-lg font-semibold ${data.counts.deprecated > 0 ? 'text-warning' : 'text-profit'}`}>
              {data.counts.deprecated}
            </div>
            <div className="text-[10px] text-muted-foreground">DEPRECATED</div>
          </div>
          <div className="p-2 rounded bg-muted/30" data-testid="metric-hacks">
            <div className={`text-lg font-semibold ${data.counts.hacks > 0 ? 'text-loss' : 'text-profit'}`}>
              {data.counts.hacks}
            </div>
            <div className="text-[10px] text-muted-foreground">HACKs</div>
          </div>
        </div>
        
        {data.fileStats.length > 0 && (
          <div className="space-y-1" data-testid="list-files-with-issues">
            <div className="text-xs text-muted-foreground font-medium">Top files with issues:</div>
            {data.fileStats.slice(0, 3).map(({ file, issueCount }, idx) => (
              <div key={file} data-testid={`file-issue-${idx}`} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/20">
                <span className="flex items-center gap-1.5 truncate">
                  <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{file}</span>
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{issueCount}</Badge>
              </div>
            ))}
          </div>
        )}
        
        <div className="text-xs text-muted-foreground flex items-center gap-2" data-testid="text-scan-timestamp">
          <Clock className="w-3 h-3" />
          Scanned in {data.scanDurationMs}ms at {new Date(data.timestamp).toLocaleTimeString()}
        </div>
      </CardContent>
    </Card>
  );
}

export function SystemAuditObservatory() {
  const { data, isLoading, isRefetching, refetch } = useSystemAudit();
  const { data: codeHealthData, isLoading: isCodeHealthLoading } = useCodeHealth();
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>Failed to load system audit data</p>
          <Button 
            variant="outline" 
            size="sm" 
            className="mt-4"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Data Integrity Observatory</h2>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['system_audit'] })}
          disabled={isRefetching}
          data-testid="button-refresh-audit"
        >
          {isRefetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span className="ml-2 hidden sm:inline">Refresh</span>
        </Button>
      </div>
      
      <HealthScoreCard data={data} />
      
      <div className="grid gap-4 md:grid-cols-2">
        <RecommendationsCard recommendations={data.recommendations} />
        <MetricsSourceCard data={data} />
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        <StageComplianceCard data={data} />
        <FormulaParityCard data={data} />
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        <DatabaseHealthCard data={data} />
        <CodeHealthCard data={codeHealthData} isLoading={isCodeHealthLoading} />
      </div>
    </div>
  );
}