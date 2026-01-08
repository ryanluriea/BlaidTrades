import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutonomyLoopStatus } from "@/hooks/useProductionScorecard";
import { formatDistanceToNow } from "date-fns";
import { 
  CheckCircle, 
  XCircle, 
  Clock,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

export function AutonomyLoopsPanel() {
  const { data: loops, isLoading, isError } = useAutonomyLoopStatus();

  const isDegraded = isError || (!isLoading && loops === undefined);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Autonomy Loops</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Autonomy Loops
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="Autonomy loop data unavailable" />
        </CardContent>
      </Card>
    );
  }

  const getLoopStatus = (loop: any) => {
    if (!loop.is_enabled) return 'disabled';
    if (!loop.last_success_at) return 'never_run';
    const age = Date.now() - new Date(loop.last_success_at).getTime();
    if (age > 10 * 60 * 1000) return 'stale'; // 10 minutes
    return 'healthy';
  };

  const statusColors: Record<string, string> = {
    healthy: 'bg-profit/20 text-profit',
    stale: 'bg-warning/20 text-warning',
    never_run: 'bg-muted text-muted-foreground',
    disabled: 'bg-muted text-muted-foreground',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    healthy: <CheckCircle className="w-4 h-4 text-profit" />,
    stale: <AlertTriangle className="w-4 h-4 text-warning" />,
    never_run: <Clock className="w-4 h-4 text-muted-foreground" />,
    disabled: <XCircle className="w-4 h-4 text-muted-foreground" />,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          Autonomy Loops
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loops && loops.length > 0 ? (
          <div className="space-y-3">
            {loops.map((loop) => {
              const status = getLoopStatus(loop);
              return (
                <div 
                  key={loop.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
                >
                  {statusIcons[status]}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{loop.loop_name}</span>
                      <Badge variant="outline" className="text-xs">
                        {loop.mechanism}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                      <span>Schedule: {loop.schedule}</span>
                      <span>Runs: {loop.run_count || 0}</span>
                      {loop.error_count > 0 && (
                        <span className="text-loss">Errors: {loop.error_count}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge className={statusColors[status]}>
                      {status.replace('_', ' ')}
                    </Badge>
                    {loop.last_success_at && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(loop.last_success_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No autonomy loops configured</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
