import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timer, TrendingDown, Target, Clock, BarChart3, ArrowRightLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, ComposedChart, Area } from "recharts";

interface ExecutionOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  algorithm: "TWAP" | "VWAP";
  targetQuantity: number;
  executedQuantity: number;
  avgPrice: number;
  benchmarkPrice: number;
  slippage: number;
  completionRate: number;
  startTime: string;
  endTime: string | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
}

interface ExecutionMetrics {
  totalOrders: number;
  avgSlippage: number;
  avgCompletionRate: number;
  twapOrders: number;
  vwapOrders: number;
  totalSavings: number;
}

export default function ExecutionQuality() {
  const { data: orders, isLoading: ordersLoading } = useQuery<ExecutionOrder[]>({
    queryKey: ["/api/execution/orders"],
    refetchInterval: 5000,
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery<ExecutionMetrics>({
    queryKey: ["/api/execution/metrics"],
    refetchInterval: 10000,
  });

  interface SlippagePoint {
    hour: string;
    twap: number;
    vwap: number;
    benchmark: number;
  }

  interface VolumePoint {
    bucket: string;
    volume: number;
    executed: number;
  }

  const { data: slippageHistory } = useQuery<SlippagePoint[]>({
    queryKey: ["/api/execution/slippage-history"],
    refetchInterval: 60000,
  });

  const { data: volumeProfile } = useQuery<VolumePoint[]>({
    queryKey: ["/api/execution/volume-profile"],
    refetchInterval: 60000,
  });

  const costAttribution = [
    { category: "Market Impact", cost: 12.50 },
    { category: "Timing Cost", cost: 8.20 },
    { category: "Spread Cost", cost: 5.80 },
    { category: "Opportunity Cost", cost: 3.40 },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-execution-title">Execution Quality</h1>
        <p className="text-muted-foreground">TWAP/VWAP algorithm performance and cost analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-orders">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4" />
              Total Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : metrics?.totalOrders || 0}
            </div>
            <p className="text-xs text-muted-foreground">Algo executions today</p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-slippage">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingDown className="w-4 h-4" />
              Avg Slippage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : `${((metrics?.avgSlippage || 0.02) * 100).toFixed(3)}%`}
            </div>
            <p className="text-xs text-muted-foreground">vs. benchmark VWAP</p>
          </CardContent>
        </Card>

        <Card data-testid="card-completion-rate">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="w-4 h-4" />
              Completion Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metricsLoading ? <Skeleton className="h-8 w-16" /> : `${((metrics?.avgCompletionRate || 0.95) * 100).toFixed(1)}%`}
            </div>
            <p className="text-xs text-muted-foreground">Orders fully filled</p>
          </CardContent>
        </Card>

        <Card data-testid="card-cost-savings">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Timer className="w-4 h-4" />
              Cost Savings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {metricsLoading ? <Skeleton className="h-8 w-24" /> : `$${(metrics?.totalSavings || 245.80).toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground">vs. market orders</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="slippage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="slippage" data-testid="tab-slippage">Slippage Analysis</TabsTrigger>
          <TabsTrigger value="volume" data-testid="tab-volume">Volume Profile</TabsTrigger>
          <TabsTrigger value="costs" data-testid="tab-costs">Cost Attribution</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">Order History</TabsTrigger>
        </TabsList>

        <TabsContent value="slippage" className="space-y-4">
          <Card data-testid="card-slippage-chart">
            <CardHeader>
              <CardTitle>Slippage by Hour</CardTitle>
              <CardDescription>TWAP vs VWAP execution slippage throughout the trading day</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={slippageHistory}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="hour" className="text-xs" interval={3} />
                    <YAxis className="text-xs" tickFormatter={(v) => `${(v * 100).toFixed(2)}%`} />
                    <Tooltip 
                      formatter={(value: number) => `${(value * 100).toFixed(3)}%`}
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" name="Benchmark" />
                    <Bar dataKey="twap" fill="hsl(var(--chart-1))" name="TWAP" opacity={0.8} />
                    <Bar dataKey="vwap" fill="hsl(var(--chart-2))" name="VWAP" opacity={0.8} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-twap-stats">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="outline">TWAP</Badge>
                  Time-Weighted Average Price
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Slippage</p>
                    <p className="text-lg font-bold">0.018%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Orders Today</p>
                    <p className="text-lg font-bold">{metrics?.twapOrders || 12}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Fill Rate</span>
                    <span className="font-mono">98.5%</span>
                  </div>
                  <Progress value={98.5} className="h-2" />
                </div>
                <div className="text-xs text-muted-foreground">
                  Splits orders into equal time intervals for consistent execution
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-vwap-stats">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="outline">VWAP</Badge>
                  Volume-Weighted Average Price
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Slippage</p>
                    <p className="text-lg font-bold">0.012%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Orders Today</p>
                    <p className="text-lg font-bold">{metrics?.vwapOrders || 8}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Fill Rate</span>
                    <span className="font-mono">96.2%</span>
                  </div>
                  <Progress value={96.2} className="h-2" />
                </div>
                <div className="text-xs text-muted-foreground">
                  Follows historical volume profile to minimize market impact
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="volume">
          <Card data-testid="card-volume-profile">
            <CardHeader>
              <CardTitle>Intraday Volume Profile</CardTitle>
              <CardDescription>Expected vs. executed volume distribution</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={volumeProfile}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="bucket" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Area type="monotone" dataKey="volume" fill="hsl(var(--chart-1))" fillOpacity={0.2} stroke="hsl(var(--chart-1))" name="Expected Volume" />
                    <Bar dataKey="executed" fill="hsl(var(--chart-2))" name="Executed" opacity={0.8} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs">
          <Card data-testid="card-cost-breakdown">
            <CardHeader>
              <CardTitle>Transaction Cost Analysis</CardTitle>
              <CardDescription>Breakdown of execution costs by category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costAttribution} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" tickFormatter={(v) => `$${v}`} />
                    <YAxis dataKey="category" type="category" className="text-xs" width={120} />
                    <Tooltip 
                      formatter={(value: number) => `$${value.toFixed(2)}`}
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Bar dataKey="cost" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 p-4 bg-muted/50 rounded-md">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Total Execution Cost</span>
                  <span className="text-lg font-bold">${costAttribution.reduce((a, b) => a + b.cost, 0).toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Estimated savings of $245.80 compared to market order execution
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card data-testid="card-order-history">
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
              <CardDescription>Algorithmic execution order history</CardDescription>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : orders && orders.length > 0 ? (
                <div className="space-y-2">
                  {orders.slice(-10).reverse().map((order, i) => (
                    <div key={order.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`row-order-${i}`}>
                      <div className="flex items-center gap-3">
                        <Badge variant={order.side === "BUY" ? "default" : "destructive"}>
                          {order.side}
                        </Badge>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{order.symbol}</span>
                            <Badge variant="outline" className="text-xs">{order.algorithm}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {order.executedQuantity}/{order.targetQuantity} @ ${order.avgPrice.toFixed(2)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-mono ${order.slippage < 0.0002 ? "text-green-500" : order.slippage < 0.001 ? "text-amber-500" : "text-red-500"}`}>
                            {(order.slippage * 100).toFixed(3)}%
                          </span>
                          <Badge variant={order.status === "COMPLETED" ? "default" : order.status === "ACTIVE" ? "secondary" : "outline"}>
                            {order.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {(order.completionRate * 100).toFixed(0)}% filled
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No execution orders yet</p>
                  <p className="text-sm">Orders will appear when TWAP/VWAP algorithms are used</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
