import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  DollarSign, Clock, TrendingUp, TrendingDown, Target,
  BarChart3, Activity, Zap, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TCARecord {
  id: string;
  botId: string;
  botName: string;
  tradeId: string;
  symbol: string;
  side: string;
  expectedPrice: number;
  executedPrice: number;
  slippage: number;
  slippageBps: number;
  fillTime: number;
  marketImpact: number;
  timestamp: string;
}

interface TCASummary {
  totalTrades: number;
  avgSlippageBps: number;
  avgFillTimeMs: number;
  favorableSlippageCount: number;
  adverseSlippageCount: number;
  totalSlippageCost: number;
}

export default function TradeCostAnalysis() {
  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ success: boolean; data: TCASummary }>({
    queryKey: ["/api/tca/summary"],
    queryFn: async () => {
      const res = await fetch("/api/tca/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch TCA summary");
      return res.json();
    },
    staleTime: 60000,
  });

  const { data: recordsData, isLoading: recordsLoading } = useQuery<{ success: boolean; data: TCARecord[] }>({
    queryKey: ["/api/tca/records"],
    queryFn: async () => {
      const res = await fetch("/api/tca/records", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch TCA records");
      return res.json();
    },
    staleTime: 60000,
  });

  const summary = summaryData?.data;
  const records = recordsData?.data || [];

  const isLoading = summaryLoading || recordsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <DollarSign className="w-6 h-6 text-primary" />
          Trade Cost Analysis
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Execution quality metrics: slippage, fill rates, and timing analysis
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Total Trades
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-trades">
              {isLoading ? <Skeleton className="h-9 w-20" /> : summary?.totalTrades || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4" />
              Avg Slippage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold font-mono",
              (summary?.avgSlippageBps || 0) > 5 ? "text-red-400" : 
              (summary?.avgSlippageBps || 0) < 0 ? "text-green-400" : "text-foreground"
            )} data-testid="text-avg-slippage">
              {isLoading ? <Skeleton className="h-9 w-20" /> : 
                `${(summary?.avgSlippageBps || 0).toFixed(1)} bps`}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Avg Fill Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono" data-testid="text-avg-fill">
              {isLoading ? <Skeleton className="h-9 w-20" /> : 
                `${(summary?.avgFillTimeMs || 0).toFixed(0)}ms`}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Total Slippage Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn(
              "text-3xl font-bold font-mono",
              (summary?.totalSlippageCost || 0) > 0 ? "text-red-400" : "text-green-400"
            )} data-testid="text-slippage-cost">
              {isLoading ? <Skeleton className="h-9 w-20" /> : 
                `$${Math.abs(summary?.totalSlippageCost || 0).toFixed(2)}`}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              Favorable Executions
            </CardTitle>
            <CardDescription>
              Trades with positive slippage (better than expected)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-green-400 mb-2" data-testid="text-favorable-count">
              {isLoading ? <Skeleton className="h-10 w-16" /> : summary?.favorableSlippageCount || 0}
            </div>
            <div className="text-sm text-muted-foreground">
              {summary && summary.totalTrades > 0 
                ? `${((summary.favorableSlippageCount / summary.totalTrades) * 100).toFixed(1)}% of all trades`
                : "No trades yet"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              Adverse Executions
            </CardTitle>
            <CardDescription>
              Trades with negative slippage (worse than expected)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-red-400 mb-2" data-testid="text-adverse-count">
              {isLoading ? <Skeleton className="h-10 w-16" /> : summary?.adverseSlippageCount || 0}
            </div>
            <div className="text-sm text-muted-foreground">
              {summary && summary.totalTrades > 0 
                ? `${((summary.adverseSlippageCount / summary.totalTrades) * 100).toFixed(1)}% of all trades`
                : "No trades yet"}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Recent Executions
          </CardTitle>
          <CardDescription>
            Detailed execution quality for recent trades
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Zap className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No trade execution data available</p>
                <p className="text-xs mt-1">Execution metrics will appear after trades are placed</p>
              </div>
            ) : (
              <div className="space-y-2">
                {records.map(record => (
                  <div 
                    key={record.id}
                    className="p-3 rounded-lg border border-border hover-elevate"
                    data-testid={`row-tca-record-${record.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{record.botName}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {record.symbol}
                        </Badge>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[10px]",
                            record.side === "BUY" ? "text-green-400" : "text-red-400"
                          )}
                        >
                          {record.side}
                        </Badge>
                      </div>
                      <Badge 
                        className={cn(
                          "text-[10px]",
                          record.slippageBps < 0 ? "bg-green-500/20 text-green-400" :
                          record.slippageBps > 5 ? "bg-red-500/20 text-red-400" :
                          "bg-yellow-500/20 text-yellow-400"
                        )}
                      >
                        {record.slippageBps >= 0 ? "+" : ""}{record.slippageBps.toFixed(1)} bps
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-4 mt-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Expected: </span>
                        <span className="font-mono">${record.expectedPrice.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Executed: </span>
                        <span className="font-mono">${record.executedPrice.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Fill: </span>
                        <span className="font-mono">{record.fillTime}ms</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Impact: </span>
                        <span className="font-mono">{record.marketImpact.toFixed(2)} bps</span>
                      </div>
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
