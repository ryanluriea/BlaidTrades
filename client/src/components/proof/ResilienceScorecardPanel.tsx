import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useChaosTest, useChaosTestResults } from "@/hooks/useProductionScorecard";
import { 
  CheckCircle, 
  XCircle, 
  Play,
  Shield,
  Zap,
  Activity,
  Database,
  Loader2,
} from "lucide-react";
import { DegradedBanner } from "@/components/ui/degraded-banner";

const categoryIcons: Record<string, React.ReactNode> = {
  provider: <Zap className="w-4 h-4" />,
  network: <Activity className="w-4 h-4" />,
  execution: <Shield className="w-4 h-4" />,
  data: <Database className="w-4 h-4" />,
};

export function ResilienceScorecardPanel() {
  const { data, isLoading, isError } = useChaosTestResults();
  const runChaosTest = useChaosTest();

  const isDegraded = isError;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Resilience Scorecard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isDegraded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Resilience Scorecard</CardTitle>
        </CardHeader>
        <CardContent>
          <DegradedBanner message="Resilience data unavailable" />
        </CardContent>
      </Card>
    );
  }

  const verdictColors: Record<string, string> = {
    RESILIENT: 'bg-profit/20 text-profit',
    ACCEPTABLE: 'bg-warning/20 text-warning',
    FRAGILE: 'bg-loss/20 text-loss',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">Resilience Scorecard</CardTitle>
          {data && (
            <Badge className={verdictColors[data.verdict] || ''}>
              {data.verdict}
            </Badge>
          )}
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => runChaosTest.mutate('all')}
          disabled={runChaosTest.isPending}
        >
          {runChaosTest.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          Run Chaos Tests
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {data ? (
          <>
            {/* Overall Score */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Overall Resilience</span>
                <span className="font-mono text-lg">{data.resilience_score}%</span>
              </div>
              <Progress 
                value={data.resilience_score} 
                className="h-3"
              />
              <p className="text-xs text-muted-foreground">
                {data.tests_passed}/{data.tests_total} tests passed
              </p>
            </div>

            {/* Test Results */}
            <div className="space-y-2">
              {data.results.map((result, idx) => (
                <div 
                  key={idx}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                >
                  <div className="mt-0.5">
                    {result.passed ? (
                      <CheckCircle className="w-4 h-4 text-profit" />
                    ) : (
                      <XCircle className="w-4 h-4 text-loss" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {categoryIcons[result.category]}
                      <span className="font-medium text-sm">{result.test_name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{result.details}</p>
                    {result.recovery_time_ms && (
                      <p className="text-xs text-muted-foreground">
                        Recovery: {result.recovery_time_ms}ms
                      </p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {result.category}
                  </Badge>
                </div>
              ))}
            </div>

            {/* Evidence Summary */}
            {data.results.some(r => r.evidence) && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  View Evidence Details
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify(
                    data.results.map(r => ({ test: r.test_name, evidence: r.evidence })),
                    null,
                    2
                  )}
                </pre>
              </details>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No chaos test results yet</p>
            <p className="text-sm">Run chaos tests to evaluate system resilience</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
