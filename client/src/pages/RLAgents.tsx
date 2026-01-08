import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, Zap, Activity, TrendingUp, TrendingDown, Minus, LineChart } from "lucide-react";
import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

interface RLActionLog {
  botId: string;
  symbol: string;
  agentType: "DQN" | "PPO";
  action: string;
  positionSize: number;
  confidence: number;
  timestamp: string;
}

interface AgentStats {
  botId: string;
  botName: string;
  dqn: { memorySize: number; epsilon: number; trained: boolean } | null;
  ppo: { bufferSize: number; trained: boolean } | null;
}

export default function RLAgents() {
  const { data: actionLogs, isLoading: logsLoading } = useQuery<RLActionLog[]>({
    queryKey: ["/api/rl/action-logs"],
    refetchInterval: 5000,
  });

  const { data: agentStats, isLoading: statsLoading } = useQuery<AgentStats[]>({
    queryKey: ["/api/rl/agent-stats"],
    refetchInterval: 10000,
  });

  interface RewardHistoryPoint {
    episode: number;
    dqnReward: number;
    ppoReward: number;
  }

  const { data: rewardHistory } = useQuery<RewardHistoryPoint[]>({
    queryKey: ["/api/rl/reward-history"],
    refetchInterval: 60000,
  });

  const actionDistribution = actionLogs?.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const actionChartData = Object.entries(actionDistribution).map(([action, count]) => ({
    action,
    count,
    color: action === "BUY" ? "hsl(var(--chart-2))" : action === "SELL" ? "hsl(var(--chart-1))" : "hsl(var(--chart-3))",
  }));

  const getActionIcon = (action: string) => {
    switch (action) {
      case "BUY": return <TrendingUp className="w-3 h-3 text-green-500" />;
      case "SELL": return <TrendingDown className="w-3 h-3 text-red-500" />;
      default: return <Minus className="w-3 h-3 text-muted-foreground" />;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-rl-agents-title">Reinforcement Learning Agents</h1>
        <p className="text-muted-foreground">DQN and PPO agents for autonomous trading decisions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-agents">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Active Agents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsLoading ? <Skeleton className="h-8 w-16" /> : agentStats?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">DQN + PPO instances</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-actions">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Total Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {logsLoading ? <Skeleton className="h-8 w-16" /> : actionLogs?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">Decisions logged</p>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-confidence">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Avg Confidence
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {logsLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : actionLogs && actionLogs.length > 0 ? (
                ((actionLogs.reduce((a, b) => a + b.confidence, 0) / actionLogs.length) * 100).toFixed(1) + "%"
              ) : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">Average decision confidence</p>
          </CardContent>
        </Card>

        <Card data-testid="card-buy-sell-ratio">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <LineChart className="w-4 h-4" />
              Buy/Sell Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(actionDistribution.BUY || 0) + (actionDistribution.SELL || 0) > 0 
                ? ((actionDistribution.BUY || 0) / ((actionDistribution.BUY || 0) + (actionDistribution.SELL || 1))).toFixed(2)
                : "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">Long vs short bias</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance" data-testid="tab-performance">Performance</TabsTrigger>
          <TabsTrigger value="actions" data-testid="tab-actions">Action Distribution</TabsTrigger>
          <TabsTrigger value="logs" data-testid="tab-logs">Recent Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <Card data-testid="card-reward-curves">
            <CardHeader>
              <CardTitle>Training Reward Curves</CardTitle>
              <CardDescription>Cumulative episode rewards for DQN and PPO agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={rewardHistory}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="episode" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Line type="monotone" dataKey="dqnReward" stroke="hsl(var(--chart-1))" name="DQN" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ppoReward" stroke="hsl(var(--chart-2))" name="PPO" strokeWidth={2} dot={false} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card data-testid="card-dqn-stats">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="outline">DQN</Badge>
                  Deep Q-Network
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Exploration Rate (Epsilon)</span>
                    <span className="font-mono">0.10</span>
                  </div>
                  <Progress value={10} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Experience Replay Buffer</span>
                    <span className="font-mono">2,450 / 10,000</span>
                  </div>
                  <Progress value={24.5} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Avg Q-Value</p>
                    <p className="text-lg font-bold">0.847</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Training Loss</p>
                    <p className="text-lg font-bold">0.042</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-ppo-stats">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant="outline">PPO</Badge>
                  Proximal Policy Optimization
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Policy Entropy</span>
                    <span className="font-mono">1.24</span>
                  </div>
                  <Progress value={62} className="h-2" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Trajectory Buffer</span>
                    <span className="font-mono">128 / 2,048</span>
                  </div>
                  <Progress value={6.25} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Policy Loss</p>
                    <p className="text-lg font-bold">0.0003</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Value Loss</p>
                    <p className="text-lg font-bold">0.288</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="actions">
          <Card data-testid="card-action-distribution">
            <CardHeader>
              <CardTitle>Action Distribution</CardTitle>
              <CardDescription>Distribution of trading decisions across all agents</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={actionChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="action" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "var(--radius)",
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {actionChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card data-testid="card-action-logs">
            <CardHeader>
              <CardTitle>Recent Actions</CardTitle>
              <CardDescription>Latest RL agent trading decisions</CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : actionLogs && actionLogs.length > 0 ? (
                <div className="space-y-2">
                  {actionLogs.slice(-20).reverse().map((log, i) => (
                    <div key={i} className="flex items-center justify-between p-3 border rounded-md" data-testid={`row-action-${i}`}>
                      <div className="flex items-center gap-3">
                        {getActionIcon(log.action)}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{log.action}</span>
                            <Badge variant="outline" className="text-xs">{log.agentType}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {log.symbol} - Size: {log.positionSize}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">{(log.confidence * 100).toFixed(1)}%</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No RL actions logged yet</p>
                  <p className="text-sm">Actions will appear when agents make trading decisions</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
