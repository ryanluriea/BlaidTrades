import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PieChart, Wallet, Shield, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ScatterChart, Scatter, ZAxis } from "recharts";

interface PortfolioRisk {
  var: {
    historicalVaR95: number;
    historicalVaR99: number;
    parametricVaR95: number;
    parametricVaR99: number;
    expectedShortfall95: number;
    portfolioValue: number;
  };
  sectors: { sector: string; weight: number; pnl: number }[];
  concentration: {
    herfindahlIndex: number;
    maxPositionWeight: number;
    top3Weight: number;
    numberOfPositions: number;
    diversificationScore: number;
  };
  violations: { type: string; current: number; limit: number; severity: string; message: string }[];
}

interface OptimizationResult {
  allocations: { botId: string; botName: string; weight: number }[];
  metrics: {
    expectedReturn: number;
    volatility: number;
    sharpe: number;
    diversificationRatio: number;
  };
  efficientFrontier: { volatility: number; return: number }[];
}

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function Portfolio() {
  const { data: riskData, isLoading: riskLoading } = useQuery<PortfolioRisk>({
    queryKey: ["/api/portfolio/risk"],
    refetchInterval: 30000,
  });

  const { data: optimization, isLoading: optLoading } = useQuery<OptimizationResult>({
    queryKey: ["/api/portfolio/optimization"],
    refetchInterval: 60000,
  });

  const correlationData = [
    { x: "MES", y: "MNQ", value: 0.85 },
    { x: "MES", y: "MCL", value: 0.15 },
    { x: "MES", y: "MGC", value: -0.20 },
    { x: "MNQ", y: "MCL", value: 0.10 },
    { x: "MNQ", y: "MGC", value: -0.15 },
    { x: "MCL", y: "MGC", value: 0.30 },
  ];

  const sectorData = riskData?.sectors?.map((s, i) => ({
    name: s.sector,
    value: s.weight,
    color: COLORS[i % COLORS.length],
  })) || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-portfolio-title">Portfolio Analytics</h1>
        <p className="text-muted-foreground">Risk management, optimization, and allocation analysis</p>
      </div>

      {riskData?.violations && riskData.violations.length > 0 && (
        <Alert variant="destructive" data-testid="alert-risk-violations">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Risk Limit Violations</AlertTitle>
          <AlertDescription>
            <ul className="list-disc ml-4 mt-2">
              {riskData.violations.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-portfolio-value">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Portfolio Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {riskLoading ? <Skeleton className="h-8 w-24" /> : `$${(riskData?.var?.portfolioValue || 0).toLocaleString()}`}
            </div>
            <p className="text-xs text-muted-foreground">Total market exposure</p>
          </CardContent>
        </Card>

        <Card data-testid="card-var-95">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="w-4 h-4" />
              VaR (95%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {riskLoading ? <Skeleton className="h-8 w-24" /> : `-$${(riskData?.var?.historicalVaR95 || 0).toFixed(0)}`}
            </div>
            <p className="text-xs text-muted-foreground">Max daily loss at 95% confidence</p>
          </CardContent>
        </Card>

        <Card data-testid="card-sharpe">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Sharpe Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {optLoading ? <Skeleton className="h-8 w-16" /> : (optimization?.metrics?.sharpe || 0).toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">Risk-adjusted return</p>
          </CardContent>
        </Card>

        <Card data-testid="card-diversification">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Diversification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {riskLoading ? <Skeleton className="h-8 w-16" /> : `${(riskData?.concentration?.diversificationScore || 0).toFixed(0)}%`}
            </div>
            <p className="text-xs text-muted-foreground">Portfolio diversity score</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-sector-allocation">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="w-5 h-5" />
              Sector Allocation
            </CardTitle>
            <CardDescription>Portfolio exposure by sector</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPieChart>
                  <Pie
                    data={sectorData.length > 0 ? sectorData : [
                      { name: "Equity Index", value: 45, color: COLORS[0] },
                      { name: "Energy", value: 20, color: COLORS[1] },
                      { name: "Precious Metals", value: 15, color: COLORS[2] },
                      { name: "Fixed Income", value: 12, color: COLORS[3] },
                      { name: "Other", value: 8, color: COLORS[4] },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {(sectorData.length > 0 ? sectorData : [
                      { color: COLORS[0] },
                      { color: COLORS[1] },
                      { color: COLORS[2] },
                      { color: COLORS[3] },
                      { color: COLORS[4] },
                    ]).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => `${value.toFixed(1)}%`}
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-4">
              {(sectorData.length > 0 ? sectorData : [
                { name: "Equity Index", color: COLORS[0] },
                { name: "Energy", color: COLORS[1] },
                { name: "Metals", color: COLORS[2] },
                { name: "Fixed Income", color: COLORS[3] },
                { name: "Other", color: COLORS[4] },
              ]).map((s, i) => (
                <div key={i} className="flex items-center gap-1 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                  <span>{s.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-efficient-frontier">
          <CardHeader>
            <CardTitle>Efficient Frontier</CardTitle>
            <CardDescription>Optimal risk-return tradeoff curve</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    type="number" 
                    dataKey="volatility" 
                    name="Volatility" 
                    unit="%" 
                    domain={[0, 5]}
                    className="text-xs"
                  />
                  <YAxis 
                    type="number" 
                    dataKey="return" 
                    name="Return" 
                    unit="%" 
                    domain={[0, 3]}
                    className="text-xs"
                  />
                  <ZAxis range={[50, 50]} />
                  <Tooltip 
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ 
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Scatter 
                    name="Frontier" 
                    data={optimization?.efficientFrontier || [
                      { volatility: 0.5, return: 0.3 },
                      { volatility: 1.0, return: 0.6 },
                      { volatility: 1.5, return: 0.9 },
                      { volatility: 2.0, return: 1.1 },
                      { volatility: 2.5, return: 1.3 },
                      { volatility: 3.0, return: 1.4 },
                      { volatility: 3.5, return: 1.5 },
                      { volatility: 4.0, return: 1.55 },
                    ]} 
                    fill="hsl(var(--chart-1))"
                    line={{ stroke: "hsl(var(--chart-1))", strokeWidth: 2 }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-concentration-metrics">
          <CardHeader>
            <CardTitle>Concentration Metrics</CardTitle>
            <CardDescription>Portfolio concentration and diversification analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Herfindahl-Hirschman Index (HHI)</span>
                <span className="font-mono">{(riskData?.concentration?.herfindahlIndex || 0.25).toFixed(3)}</span>
              </div>
              <Progress value={(riskData?.concentration?.herfindahlIndex || 0.25) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">Lower is better (0 = perfect diversification)</p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Max Position Weight</span>
                <span className="font-mono">{(riskData?.concentration?.maxPositionWeight || 18).toFixed(1)}%</span>
              </div>
              <Progress value={riskData?.concentration?.maxPositionWeight || 18} className="h-2" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Top 3 Concentration</span>
                <span className="font-mono">{(riskData?.concentration?.top3Weight || 45).toFixed(1)}%</span>
              </div>
              <Progress value={riskData?.concentration?.top3Weight || 45} className="h-2" />
            </div>
            <div className="pt-2 border-t">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Number of Positions</span>
                <span className="font-bold">{riskData?.concentration?.numberOfPositions || 8}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-risk-limits">
          <CardHeader>
            <CardTitle>Risk Limits</CardTitle>
            <CardDescription>Current exposure vs. configured limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { name: "VaR (95%)", current: 3.2, limit: 5, unit: "%" },
              { name: "Max Position", current: 18, limit: 25, unit: "%" },
              { name: "Sector Exposure", current: 35, limit: 40, unit: "%" },
              { name: "Daily Loss", current: 0.8, limit: 3, unit: "%" },
              { name: "Max Drawdown", current: 4.5, limit: 15, unit: "%" },
            ].map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{item.name}</span>
                  <span className={`font-mono ${item.current > item.limit * 0.8 ? "text-amber-500" : ""}`}>
                    {item.current}{item.unit} / {item.limit}{item.unit}
                  </span>
                </div>
                <Progress 
                  value={(item.current / item.limit) * 100} 
                  className={`h-2 ${item.current > item.limit * 0.8 ? "[&>div]:bg-amber-500" : ""}`} 
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-optimal-allocation">
        <CardHeader>
          <CardTitle>Optimal Portfolio Allocation</CardTitle>
          <CardDescription>Mean-variance optimized bot weights</CardDescription>
        </CardHeader>
        <CardContent>
          {optLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : optimization?.allocations && optimization.allocations.length > 0 ? (
            <div className="space-y-2">
              {optimization.allocations.map((alloc, i) => (
                <div key={i} className="flex items-center gap-4 p-3 border rounded-md" data-testid={`row-allocation-${i}`}>
                  <div className="w-24 font-medium truncate">{alloc.botName}</div>
                  <div className="flex-1">
                    <Progress value={alloc.weight * 100} className="h-3" />
                  </div>
                  <div className="w-16 text-right font-mono">{(alloc.weight * 100).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <PieChart className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No optimization results available</p>
              <p className="text-sm">Run portfolio optimization to see allocations</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
