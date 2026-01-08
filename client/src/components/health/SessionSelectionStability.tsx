import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2,
  AlertTriangle,
  RefreshCw, 
  Activity,
  Shield,
  Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface SessionPattern {
  botId: string;
  name: string;
  stage: string;
  totalSessions: number;
  collisionCount: number;
  latestSessionId: string | null;
  latestSessionAt: string | null;
  latestPnl: number | null;
  latestTrades: number | null;
  stability: "STABLE" | "UNSTABLE";
  note: string | null;
}

interface SessionStabilityResult {
  success: boolean;
  trace_id: string;
  timestamp: string;
  stability_score: number;
  total_bots_analyzed: number;
  stable_bots: number;
  unstable_bots: number;
  patterns: SessionPattern[];
  institutional_note: string;
}

export function SessionSelectionStability() {
  const [isRunning, setIsRunning] = useState(false);
  
  const { data, isLoading, refetch } = useQuery<SessionStabilityResult>({
    queryKey: ["/api/health/session-stability"],
    queryFn: async () => {
      const response = await fetch("/api/health/session-stability", { credentials: "include" });
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

  const formatPnl = (pnl: number | null) => {
    if (pnl === null) return "-";
    const formatted = Math.abs(pnl).toFixed(2);
    return pnl >= 0 ? `+$${formatted}` : `-$${formatted}`;
  };

  const stageBadgeColor = (stage: string) => {
    switch (stage) {
      case 'TRIALS': return "bg-purple-500/10 text-purple-400 border-purple-500/30";
      case "PAPER": return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "SHADOW": return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
      case "CANARY": return "bg-orange-500/10 text-orange-400 border-orange-500/30";
      case "LIVE": return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card className="p-4" data-testid="card-session-stability">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Session Stability</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRunTest}
          disabled={isRunning || isLoading}
          data-testid="button-run-stability-test"
        >
          {isRunning || isLoading ? (
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3 mr-1" />
          )}
          Analyze
        </Button>
      </div>

      {!data && !isLoading && (
        <p className="text-xs text-muted-foreground">
          Analyze session selection patterns across bots
        </p>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {data.unstable_bots === 0 ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              )}
              <span className={cn(
                "text-sm font-medium",
                data.unstable_bots === 0 ? "text-emerald-400" : "text-yellow-400"
              )} data-testid="text-stability-status">
                {data.stable_bots}/{data.total_bots_analyzed} Stable
                {data.unstable_bots > 0 && ` (${data.unstable_bots} collision${data.unstable_bots > 1 ? 's' : ''})`}
              </span>
            </div>
            <Badge 
              variant="outline" 
              className={cn(
                "text-xs",
                data.stability_score === 100 
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : data.stability_score >= 80
                    ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                    : "bg-red-500/10 text-red-400 border-red-500/30"
              )}
              data-testid="badge-stability-score"
            >
              {data.stability_score}%
            </Badge>
          </div>

          {data.patterns.length > 0 && (
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {data.patterns.slice(0, 5).map((pattern) => (
                <div 
                  key={pattern.botId} 
                  className={cn(
                    "flex items-center justify-between text-xs border-b border-border pb-1.5 last:border-0",
                    pattern.stability === "UNSTABLE" && "bg-yellow-500/5 -mx-1 px-1 rounded"
                  )}
                  data-testid={`row-pattern-${pattern.botId}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className={cn("text-[9px] shrink-0", stageBadgeColor(pattern.stage))}>
                      {pattern.stage}
                    </Badge>
                    <span className="text-muted-foreground truncate">
                      {pattern.name}
                    </span>
                    {pattern.stability === "UNSTABLE" && (
                      <Badge variant="outline" className="text-[9px] bg-yellow-500/10 text-yellow-400 border-yellow-500/30 shrink-0">
                        {pattern.collisionCount} collision{pattern.collisionCount > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-muted-foreground">
                      {pattern.totalSessions} sess
                    </span>
                    <span className={cn(
                      pattern.latestPnl !== null && pattern.latestPnl >= 0 
                        ? "text-emerald-400" 
                        : "text-red-400"
                    )}>
                      {formatPnl(pattern.latestPnl)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.patterns.length > 5 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{data.patterns.length - 5} more bots analyzed
            </p>
          )}

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
