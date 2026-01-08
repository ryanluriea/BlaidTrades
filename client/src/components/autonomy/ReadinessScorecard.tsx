import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Zap,
  Activity,
  Database,
  GitBranch,
  Shield,
  Layout,
  Lock
} from "lucide-react";
import { useLatestReadinessRun, useRunReadinessAudit, useAutoFixAction } from "@/hooks/useReadinessAudit";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const COMPONENT_ICONS: Record<string, any> = {
  'Runner Reliability': Activity,
  'Job Queue Health': Zap,
  'Data Integrity': Database,
  'Evolution Integrity': GitBranch,
  'Promotion Correctness': Shield,
  'UI Consistency': Layout,
  'Security Hygiene': Lock,
};

function getScoreColor(score: number, max: number): string {
  const pct = (score / max) * 100;
  if (pct >= 90) return 'text-profit';
  if (pct >= 70) return 'text-chart-4';
  if (pct >= 50) return 'text-warning';
  return 'text-destructive';
}

function getOverallStatus(score: number): { label: string; color: string; icon: any } {
  if (score >= 90) return { label: 'READY', color: 'text-profit', icon: CheckCircle2 };
  if (score >= 70) return { label: 'GOOD', color: 'text-chart-4', icon: CheckCircle2 };
  if (score >= 50) return { label: 'WARN', color: 'text-warning', icon: AlertTriangle };
  return { label: 'CRITICAL', color: 'text-destructive', icon: XCircle };
}

export function ReadinessScorecard() {
  const { data: run, isLoading } = useLatestReadinessRun();
  const runAudit = useRunReadinessAudit();
  const autoFix = useAutoFixAction();

  const handleRunAudit = async () => {
    try {
      await runAudit.mutateAsync();
      toast.success('Readiness audit completed');
    } catch (e) {
      toast.error('Audit failed');
    }
  };

  const handleAutoFix = async (actionCode: string) => {
    try {
      await autoFix.mutateAsync(actionCode);
      toast.success('Auto-fix applied');
    } catch (e) {
      toast.error('Auto-fix failed');
    }
  };

  if (isLoading) {
    return (
      <Card className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
      </Card>
    );
  }

  if (!run) {
    return (
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Production Readiness</h3>
          <Button size="sm" onClick={handleRunAudit} disabled={runAudit.isPending}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runAudit.isPending ? 'animate-spin' : ''}`} />
            Run Audit
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">No audit has been run yet. Click to run your first audit.</p>
      </Card>
    );
  }

  const status = getOverallStatus(run.score);
  const StatusIcon = status.icon;
  const components = run.metricsJson?.components || [];

  return (
    <Card className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Production Readiness</h3>
        <Button size="sm" variant="outline" onClick={handleRunAudit} disabled={runAudit.isPending}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${runAudit.isPending ? 'animate-spin' : ''}`} />
          Run Now
        </Button>
      </div>

      {/* Score */}
      <div className="flex items-center gap-4">
        <div className={`text-4xl font-bold tabular-nums ${status.color}`}>
          {run.score}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon className={`w-4 h-4 ${status.color}`} />
            <span className={`text-sm font-medium ${status.color}`}>{status.label}</span>
          </div>
          <Progress value={run.score} className="h-2" />
        </div>
      </div>

      {/* Last run time */}
      <p className="text-xs text-muted-foreground">
        Last run: {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
        {run.runType === 'SCHEDULED' && ' (scheduled)'}
      </p>

      {/* Component breakdown */}
      <div className="space-y-2">
        {components.map((c: any) => {
          const Icon = COMPONENT_ICONS[c.name] || Activity;
          return (
            <div key={c.name} className="flex items-center gap-2 text-xs">
              <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className={getScoreColor(c.score, c.maxScore)}>
                {c.score}/{c.maxScore}
              </span>
            </div>
          );
        })}
      </div>

      {/* Failures */}
      {run.failuresJson.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground">Top Issues</p>
          {run.failuresJson.slice(0, 3).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className={`text-[10px] ${f.severity === 'error' ? 'border-destructive/50 text-destructive' : 'border-warning/50 text-warning'}`}
              >
                {f.code}
              </Badge>
              <span className="text-xs text-muted-foreground">×{f.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Auto-fix actions */}
      {run.recommendedActions.filter((a: any) => a.auto_fix_available).length > 0 && (
        <div className="pt-2 border-t border-border space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Auto-Fix Available</p>
          {run.recommendedActions
            .filter((a: any) => a.auto_fix_available)
            .map((a: any) => (
              <Button
                key={a.action_code}
                size="sm"
                variant="secondary"
                className="w-full text-xs h-7"
                onClick={() => handleAutoFix(a.action_code)}
                disabled={autoFix.isPending}
              >
                <Zap className="w-3 h-3 mr-1.5" />
                {a.description}
              </Button>
            ))}
        </div>
      )}
    </Card>
  );
}
