import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  GitBranch, AlertTriangle, Shield, Activity,
  TrendingUp, TrendingDown, BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CorrelationPair {
  botAId: string;
  botAName: string;
  botBId: string;
  botBName: string;
  correlation: number;
  pValue: number;
  sampleSize: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

interface CorrelationSummary {
  totalPairs: number;
  highCorrelationPairs: number;
  avgCorrelation: number;
  portfolioDiversification: number;
}

function getCorrelationColor(correlation: number): string {
  const abs = Math.abs(correlation);
  if (abs >= 0.8) return "text-red-400 bg-red-500/10 border-red-500/30";
  if (abs >= 0.6) return "text-orange-400 bg-orange-500/10 border-orange-500/30";
  if (abs >= 0.4) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
  return "text-green-400 bg-green-500/10 border-green-500/30";
}

function getRiskColor(risk: string): string {
  switch (risk) {
    case "CRITICAL": return "text-red-500 bg-red-600/20";
    case "HIGH": return "text-red-400 bg-red-500/10";
    case "MEDIUM": return "text-orange-400 bg-orange-500/10";
    case "LOW": return "text-green-400 bg-green-500/10";
    default: return "text-muted-foreground bg-muted/50";
  }
}

export default function CorrelationAnalysis() {
  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ 
    success: boolean; 
    data: CorrelationSummary 
  }>({
    queryKey: ["/api/correlation/summary"],
    queryFn: async () => {
      const res = await fetch("/api/correlation/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch correlation summary");
      return res.json();
    },
    staleTime: 120000,
  });

  const { data: pairsData, isLoading: pairsLoading } = useQuery<{ 
    success: boolean; 
    data: CorrelationPair[] 
  }>({
    queryKey: ["/api/correlation/analyze"],
    queryFn: async () => {
      const res = await fetch("/api/correlation/analyze", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch correlation pairs");
      return res.json();
    },
    staleTime: 120000,
  });

  const summary = summaryData?.data;
  const pairs = pairsData?.data || [];
  const isLoading = summaryLoading || pairsLoading;

  const highRiskPairs = pairs.filter(p => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL");
  const lowRiskPairs = pairs.filter(p => p.riskLevel === "LOW");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-primary" />
          Correlation Analysis
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Bot correlation tracking and portfolio diversification metrics
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Total Pairs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-pairs">
              {isLoading ? <Skeleton className="h-9 w-16" /> : summary?.totalPairs || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4" />
              High Correlation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400" data-testid="text-high-corr">
              {isLoading ? <Skeleton className="h-9 w-16" /> : summary?.highCorrelationPairs || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Avg Correlation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold font-mono",
              (summary?.avgCorrelation || 0) > 0.5 ? "text-orange-400" : "text-foreground"
            )} data-testid="text-avg-corr">
              {isLoading ? <Skeleton className="h-9 w-16" /> : 
                (summary?.avgCorrelation || 0).toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-green-400">
              <Shield className="w-4 h-4" />
              Diversification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold font-mono",
              (summary?.portfolioDiversification || 0) >= 0.7 ? "text-green-400" :
              (summary?.portfolioDiversification || 0) >= 0.4 ? "text-yellow-400" : "text-red-400"
            )} data-testid="text-diversification">
              {isLoading ? <Skeleton className="h-9 w-16" /> : 
                `${((summary?.portfolioDiversification || 0) * 100).toFixed(0)}%`}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              High Risk Correlations
            </CardTitle>
            <CardDescription>
              Bot pairs with concerning correlation levels
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : highRiskPairs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Shield className="w-8 h-8 mb-2 text-green-400" />
                  <p className="text-sm">No high-risk correlations detected</p>
                  <p className="text-xs mt-1">Your portfolio is well diversified</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {highRiskPairs.map((pair, idx) => (
                    <div 
                      key={`${pair.botAId}-${pair.botBId}`}
                      className="p-3 rounded-lg border border-red-500/20 bg-red-500/5"
                      data-testid={`row-high-risk-pair-${idx}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{pair.botAName}</span>
                          <span className="text-muted-foreground">x</span>
                          <span className="font-medium truncate">{pair.botBName}</span>
                        </div>
                        <Badge className={cn("text-[10px]", getRiskColor(pair.riskLevel))}>
                          {pair.riskLevel}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <Badge className={cn("text-[10px] border", getCorrelationColor(pair.correlation))}>
                          r = {pair.correlation.toFixed(3)}
                        </Badge>
                        <span className="text-muted-foreground">
                          p-value: {pair.pValue.toFixed(4)}
                        </span>
                        <span className="text-muted-foreground">
                          n = {pair.sampleSize}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-400" />
              Low Correlation Pairs
            </CardTitle>
            <CardDescription>
              Well-diversified bot combinations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : lowRiskPairs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mb-2 text-orange-400" />
                  <p className="text-sm">No low-correlation pairs found</p>
                  <p className="text-xs mt-1">Consider diversifying your strategies</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lowRiskPairs.slice(0, 10).map((pair, idx) => (
                    <div 
                      key={`${pair.botAId}-${pair.botBId}`}
                      className="p-2 rounded-lg border border-green-500/20 bg-green-500/5"
                      data-testid={`row-low-risk-pair-${idx}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-sm min-w-0">
                          <span className="truncate">{pair.botAName}</span>
                          <span className="text-muted-foreground">x</span>
                          <span className="truncate">{pair.botBName}</span>
                        </div>
                        <Badge className="text-[10px] bg-green-500/20 text-green-400">
                          r = {pair.correlation.toFixed(2)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            All Correlation Pairs
          </CardTitle>
          <CardDescription>
            Complete correlation matrix for active bots
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : pairs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <GitBranch className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No correlation data available</p>
                <p className="text-xs mt-1">Correlation analysis requires multiple bots with trading history</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {pairs.map((pair, idx) => (
                  <div 
                    key={`all-${pair.botAId}-${pair.botBId}`}
                    className={cn(
                      "p-2 rounded-md border",
                      getCorrelationColor(pair.correlation)
                    )}
                    data-testid={`row-corr-pair-${idx}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="text-xs truncate">
                        {pair.botAName.slice(0, 10)} x {pair.botBName.slice(0, 10)}
                      </div>
                      <span className="font-mono text-xs font-medium">
                        {pair.correlation.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
