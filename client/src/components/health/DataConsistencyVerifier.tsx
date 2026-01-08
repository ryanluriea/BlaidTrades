import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  Database,
  Shield
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DeterminismTest {
  name: string;
  passed: boolean;
  runs: number;
  matchRate: number;
  firstResultHash: string;
}

interface DeterminismResult {
  success: boolean;
  trace_id: string;
  timestamp: string;
  overall_status: "PASS" | "FAIL";
  consistency_score: number;
  tests: DeterminismTest[];
  institutional_note: string;
}

export function DataConsistencyVerifier() {
  const [isRunning, setIsRunning] = useState(false);
  
  const { data, isLoading, refetch } = useQuery<DeterminismResult>({
    queryKey: ["/api/health/determinism-test"],
    queryFn: async () => {
      const response = await fetch("/api/health/determinism-test", { credentials: "include" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      return result;
    },
    enabled: false,
    staleTime: 0,
  });

  const handleRunTest = async () => {
    setIsRunning(true);
    try {
      await refetch();
    } finally {
      setIsRunning(false);
    }
  };

  const testNameLabels: Record<string, string> = {
    backtest_sessions_order: "Backtest Sessions",
    integration_usage_order: "Integration Usage",
    generation_metrics_order: "Generation Metrics",
    bot_jobs_order: "Bot Jobs Queue",
  };

  return (
    <Card className="p-4" data-testid="card-data-consistency-verifier">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Query Determinism</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunTest}
          disabled={isRunning || isLoading}
          data-testid="button-run-determinism-test"
        >
          {isRunning || isLoading ? (
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1" />
          )}
          Test
        </Button>
      </div>

      {!data && !isLoading && (
        <p className="text-xs text-muted-foreground">
          Run test to verify query ordering consistency
        </p>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {data.overall_status === "PASS" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={cn(
                "text-sm font-medium",
                data.overall_status === "PASS" ? "text-emerald-400" : "text-red-400"
              )} data-testid="text-determinism-status">
                {data.overall_status === "PASS" ? "All Queries Deterministic" : "Inconsistency Detected"}
              </span>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs",
                data.consistency_score === 100 
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-red-500/10 text-red-400 border-red-500/30"
              )}
              data-testid="badge-consistency-score"
            >
              {data.consistency_score}%
            </Badge>
          </div>

          <div className="space-y-1">
            {data.tests.map((test) => (
              <div 
                key={test.name} 
                className="flex items-center justify-between text-xs"
                data-testid={`row-test-${test.name}`}
              >
                <div className="flex items-center gap-1.5">
                  {test.passed ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-400" />
                  )}
                  <span className="text-muted-foreground">
                    {testNameLabels[test.name] || test.name}
                  </span>
                </div>
                <span className={cn(
                  test.passed ? "text-emerald-400" : "text-red-400"
                )}>
                  {test.matchRate}%
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-1.5 pt-2 border-t border-border">
            <Shield className="w-3 h-3 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              {data.institutional_note}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
