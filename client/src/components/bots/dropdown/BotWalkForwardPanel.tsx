import { useLatestWalkForward, useWalkForwardRuns } from "@/hooks/useWalkForward";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, CheckCircle2, XCircle, Clock, AlertTriangle,
  TrendingUp, TrendingDown, Target, BarChart3, Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface BotWalkForwardPanelProps {
  botId: string;
}

export function BotWalkForwardPanel({ botId }: BotWalkForwardPanelProps) {
  const { data: latestRun, isLoading: loadingLatest } = useLatestWalkForward(botId);
  const { data: allRuns, isLoading: loadingRuns } = useWalkForwardRuns(botId);

  const isLoading = loadingLatest || loadingRuns;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Walk-Forward Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!latestRun && (!allRuns || allRuns.length === 0)) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Walk-Forward Analysis
          </CardTitle>
          <CardDescription>Out-of-sample validation results</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
            <Target className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No walk-forward runs yet</p>
            <p className="text-xs mt-1">Walk-forward validation runs automatically during evolution</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const run = latestRun || (allRuns && allRuns[0]);
  if (!run) return null;

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "COMPLETED":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30" data-testid="badge-wf-status"><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
      case "IN_PROGRESS":
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30" data-testid="badge-wf-status"><Activity className="w-3 h-3 mr-1 animate-pulse" />Running</Badge>;
      case "FAILED":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30" data-testid="badge-wf-status"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline" data-testid="badge-wf-status"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const getValidationBadge = (passed: boolean | null) => {
    if (passed === null) return null;
    return passed ? (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30" data-testid="badge-wf-validation">
        <CheckCircle2 className="w-3 h-3 mr-1" />Passed
      </Badge>
    ) : (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30" data-testid="badge-wf-validation">
        <XCircle className="w-3 h-3 mr-1" />Failed
      </Badge>
    );
  };

  const getOverfitColor = (ratio: number | null) => {
    if (ratio === null) return "text-muted-foreground";
    if (ratio <= 1.2) return "text-green-400";
    if (ratio <= 1.5) return "text-yellow-400";
    return "text-red-400";
  };

  const getConsistencyColor = (score: number | null) => {
    if (score === null) return "text-muted-foreground";
    if (score >= 0.8) return "text-green-400";
    if (score >= 0.6) return "text-yellow-400";
    return "text-red-400";
  };

  const progress = run.totalSegments 
    ? ((run.completedSegments || 0) / run.totalSegments) * 100 
    : 0;

  return (
    <Card data-testid="panel-walk-forward">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Walk-Forward Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            {getStatusBadge(run.status)}
            {run.status === "COMPLETED" && getValidationBadge(run.passedValidation)}
          </div>
        </div>
        <CardDescription>
          {run.totalSegments} segments, {run.trainingWindowDays}d train / {run.testingWindowDays}d test
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.status === "IN_PROGRESS" && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{run.completedSegments || 0} / {run.totalSegments} segments</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {run.status === "COMPLETED" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-2 rounded-md bg-muted/30">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Train Sharpe
                </div>
                <div className="font-mono text-sm" data-testid="text-train-sharpe">
                  {run.trainingAvgSharpe?.toFixed(2) ?? "N/A"}
                </div>
              </div>
              <div className="p-2 rounded-md bg-muted/30">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Test Sharpe
                </div>
                <div className="font-mono text-sm" data-testid="text-test-sharpe">
                  {run.testingAvgSharpe?.toFixed(2) ?? "N/A"}
                </div>
              </div>
              <div className="p-2 rounded-md bg-muted/30">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Validation
                </div>
                <div className="font-mono text-sm" data-testid="text-validation-sharpe">
                  {run.validationSharpe?.toFixed(2) ?? "N/A"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 rounded-md bg-muted/30">
                <div className="text-[10px] text-muted-foreground">Consistency Score</div>
                <div className={cn("font-mono text-sm", getConsistencyColor(run.consistencyScore))} data-testid="text-consistency">
                  {run.consistencyScore !== null ? `${(run.consistencyScore * 100).toFixed(0)}%` : "N/A"}
                </div>
              </div>
              <div className="p-2 rounded-md bg-muted/30">
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Overfit Ratio
                </div>
                <div className={cn("font-mono text-sm", getOverfitColor(run.overfitRatio))} data-testid="text-overfit">
                  {run.overfitRatio?.toFixed(2) ?? "N/A"}x
                </div>
              </div>
            </div>

            {run.errorMessage && (
              <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {run.errorMessage}
              </div>
            )}
          </>
        )}

        {run.status === "FAILED" && run.errorMessage && (
          <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            {run.errorMessage}
          </div>
        )}

        {allRuns && allRuns.length > 1 && (
          <div className="pt-2 border-t">
            <div className="text-xs text-muted-foreground mb-2">Previous Runs ({allRuns.length - 1})</div>
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {allRuns.slice(1, 5).map((r) => (
                  <div 
                    key={r.id} 
                    className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/20"
                    data-testid={`row-wf-history-${r.id}`}
                  >
                    <div className="flex items-center gap-2">
                      {r.passedValidation ? (
                        <CheckCircle2 className="w-3 h-3 text-green-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-400" />
                      )}
                      <span className="text-muted-foreground">
                        {r.createdAt ? format(new Date(r.createdAt), "MMM d, HH:mm") : "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span>Test: {r.testingAvgSharpe?.toFixed(2) ?? "?"}</span>
                      <span className={getOverfitColor(r.overfitRatio)}>
                        {r.overfitRatio?.toFixed(1) ?? "?"}x
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
