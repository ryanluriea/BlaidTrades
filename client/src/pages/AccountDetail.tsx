import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AccountAttemptsDropdown } from "@/components/accounts/AccountAttemptsDropdown";
import { 
  Wallet,
  TrendingUp,
  BarChart3,
  List,
  Shield,
  Bot,
  ExternalLink,
  Play,
  Square,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount } from "@/hooks/useAccounts";
import { useTradeLogs, useOpenPositions } from "@/hooks/useTrading";
import { useLinkedBots } from "@/hooks/useLinkedBots";
import { useStartBotInstance, useStopBotInstance } from "@/hooks/useBotInstances";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { RiskProfileDisplay } from "@/components/risk/RiskProfileDisplay";
import { SizingPreviewCard } from "@/components/risk/SizingPreviewCard";

export default function AccountDetail() {
  const { id } = useParams();
  const { data: account, isLoading } = useAccount(id);
  const { data: tradeLogs = [] } = useTradeLogs(id, 100);
  const { data: openPositions = [] } = useOpenPositions(id);
  const { data: linkedBotsResult } = useLinkedBots(id);
  // Extract linked bots from wrapper - useLinkedBots returns { data: LinkedBot[], degraded, ... }
  const linkedBots = linkedBotsResult?.data ?? [];
  const startInstance = useStartBotInstance();
  const stopInstance = useStopBotInstance();

  if (isLoading) {
    return (
      <AppLayout title="Account">
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!account) {
    return (
      <AppLayout title="Account Not Found">
        <p className="text-muted-foreground">This account does not exist.</p>
      </AppLayout>
    );
  }

  // Use computed balance (initial + bot P&L) if available, else fall back to current balance
  const computedBalance = account.computedBalance ?? account.currentBalance;
  const totalBotPnl = account.totalBotPnl ?? 0;
  const botsPnl = account.botsPnl ?? [];
  
  const pnl = computedBalance - account.initialBalance;
  const returnPct = account.initialBalance > 0 ? (pnl / account.initialBalance) * 100 : 0;

  // Build equity curve from trade logs
  const closedTrades = tradeLogs.filter(t => !t.isOpen && t.pnl !== null);
  let runningBalance = account.initialBalance;
  const equityCurve = [{ date: "Start", balance: runningBalance }];
  
  closedTrades.reverse().forEach((trade) => {
    runningBalance += (trade.pnl || 0);
    equityCurve.push({
      date: new Date(trade.exitTime || trade.createdAt).toLocaleDateString(),
      balance: runningBalance,
    });
  });

  // Calculate today's PnL
  const today = new Date().toDateString();
  const todayPnl = closedTrades
    .filter(t => new Date(t.exitTime || t.createdAt).toDateString() === today)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  const riskProfile = account.riskProfile as { max_drawdown_pct?: number; max_position_pct?: number; max_daily_loss_pct?: number } | null;

  return (
    <AppLayout title={account.name}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Wallet className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status={account.accountType as "SIM" | "LIVE" | "VIRTUAL"} />
                <StatusBadge status={account.riskTier as "conservative" | "moderate" | "aggressive"} />
                {account.isActive && (
                  <span className="flex items-center gap-1 text-xs text-profit">
                    <span className="status-dot status-dot-connected" />
                    Active
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">
                {account.broker ? account.broker.toUpperCase() : "INTERNAL"} Provider
              </p>
            </div>
          </div>
          <AccountAttemptsDropdown
            accountId={account.id}
            currentBalance={computedBalance}
            initialBalance={account.initialBalance}
            currentAttemptNumber={account.currentAttemptNumber}
            consecutiveBlownCount={account.consecutiveBlownCount}
            totalBlownCount={account.totalBlownCount}
          />
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Current Balance</p>
              <p className="text-2xl font-bold font-mono">
                ${computedBalance.toLocaleString()}
              </p>
              {totalBotPnl !== 0 && (
                <p className={`text-xs mt-1 ${totalBotPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {totalBotPnl >= 0 ? '+' : ''}${totalBotPnl.toFixed(2)} from bots
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Initial Balance</p>
              <p className="text-2xl font-bold font-mono">
                ${account.initialBalance.toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Total P&L</p>
              <PnlDisplay value={pnl} size="lg" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Today P&L</p>
              <PnlDisplay value={todayPnl} size="lg" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Return</p>
              <p className={`text-2xl font-bold font-mono ${pnl >= 0 ? "text-profit" : "text-loss"}`}>
                {pnl >= 0 ? "+" : ""}{returnPct.toFixed(2)}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground mb-1">Max Drawdown</p>
              <p className="text-2xl font-bold font-mono text-loss">
                {account.maxDrawdown ? `-$${account.maxDrawdown.toLocaleString()}` : "$0"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="linked-bots" className="space-y-4">
          <TabsList>
            <TabsTrigger value="linked-bots">
              <Bot className="w-4 h-4 mr-2" />
              Linked Bots ({linkedBots.length})
            </TabsTrigger>
            <TabsTrigger value="positions">
              <BarChart3 className="w-4 h-4 mr-2" />
              Open Positions
            </TabsTrigger>
            <TabsTrigger value="trades">
              <List className="w-4 h-4 mr-2" />
              Trade History
            </TabsTrigger>
            <TabsTrigger value="equity">
              <TrendingUp className="w-4 h-4 mr-2" />
              Equity Curve
            </TabsTrigger>
            <TabsTrigger value="risk">
              <Shield className="w-4 h-4 mr-2" />
              Risk Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="linked-bots">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Linked Bots</CardTitle>
              </CardHeader>
              <CardContent>
                {linkedBots.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bot</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Position</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">Win%</TableHead>
                        <TableHead className="text-right">Net P&L</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkedBots.map((instance) => {
                        const botPnlRecord = botsPnl.find((bp) => bp.botId === instance.botId);
                        const netPnl = botPnlRecord?.netPnl ?? 0;
                        const totalTrades = botPnlRecord?.totalTrades ?? 0;
                        const winningTrades = botPnlRecord?.winningTrades ?? 0;
                        const winPct = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
                        
                        return (
                          <TableRow key={instance.id}>
                            <TableCell className="font-medium">
                              <Link 
                                to={`/bots/${instance.botId}`}
                                className="hover:text-primary transition-colors flex items-center gap-2"
                              >
                                {instance.bot?.name || "Unknown Bot"}
                                <ExternalLink className="w-3 h-3 opacity-50" />
                              </Link>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={instance.mode as any} />
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={instance.status as any} />
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {instance.currentPosition}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {totalTrades > 0 ? totalTrades : '--'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {totalTrades > 0 ? (
                                <span className={winPct >= 50 ? 'text-profit' : 'text-loss'}>
                                  {winPct.toFixed(0)}%
                                </span>
                              ) : '--'}
                            </TableCell>
                            <TableCell className="text-right">
                              {totalTrades > 0 ? (
                                <PnlDisplay value={netPnl} size="sm" />
                              ) : (
                                <span className="text-muted-foreground">--</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {instance.status === "running" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => stopInstance.mutate(instance.id)}
                                  disabled={stopInstance.isPending}
                                >
                                  <Square className="w-3 h-3 mr-1" />
                                  Stop
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startInstance.mutate(instance.id)}
                                  disabled={startInstance.isPending}
                                >
                                  <Play className="w-3 h-3 mr-1" />
                                  Start
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No bots linked to this account yet.</p>
                    <p className="text-sm mt-1">Go to a bot's page and attach it to this account.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="positions">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Open Positions</CardTitle>
              </CardHeader>
              <CardContent>
                {openPositions.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Instrument</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Entry Price</TableHead>
                        <TableHead className="text-right">Entry Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {openPositions.map((pos) => (
                        <TableRow key={pos.id}>
                          <TableCell className="font-medium">{pos.symbol}</TableCell>
                          <TableCell>
                            <span className={pos.side === "BUY" ? "text-profit" : "text-loss"}>
                              {pos.side}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{pos.entryPrice}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {new Date(pos.entryTime).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No open positions</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="trades">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Trade History</CardTitle>
              </CardHeader>
              <CardContent>
                {closedTrades.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Instrument</TableHead>
                        <TableHead>Side</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Entry</TableHead>
                        <TableHead className="text-right">Exit</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {closedTrades.slice().reverse().slice(0, 50).map((trade) => (
                        <TableRow key={trade.id}>
                          <TableCell className="font-medium">{trade.symbol}</TableCell>
                          <TableCell>
                            <span className={trade.side === "BUY" ? "text-profit" : "text-loss"}>
                              {trade.side}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{trade.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{trade.entryPrice}</TableCell>
                          <TableCell className="text-right font-mono">{trade.exitPrice}</TableCell>
                          <TableCell className="text-right">
                            <PnlDisplay value={trade.pnl || 0} size="sm" />
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs">
                            {new Date(trade.exitTime || trade.createdAt).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-center text-muted-foreground py-8">No closed trades yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="equity">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equity Curve</CardTitle>
              </CardHeader>
              <CardContent>
                {equityCurve.length > 1 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, 'Balance']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="balance" 
                        stroke="hsl(var(--primary))" 
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground border border-dashed border-border rounded-lg">
                    No trade data for equity curve
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="risk">
            <div className="space-y-4">
              <RiskProfileDisplay 
                riskTier={account.riskTier}
                riskProfileJson={account.riskProfile as Record<string, unknown>}
                accountEquity={account.currentBalance}
              />
              
              <SizingPreviewCard
                accountEquity={account.currentBalance}
                accountRiskTier={account.riskTier}
                accountRiskProfile={account.riskProfile as Record<string, unknown>}
                instrumentSymbol="ES"
                defaultStopTicks={20}
              />

              <Card>
                <CardContent className="pt-6">
                  <h4 className="font-medium mb-2">Risk Tier: {account.riskTier}</h4>
                  <p className="text-sm text-muted-foreground">
                    {account.riskTier === 'conservative' && 'Conservative tier: 0.25% risk per trade, 1 contract max, slower promotion path.'}
                    {account.riskTier === 'moderate' && 'Moderate tier: 0.5% risk per trade, 3 contracts max, standard promotion.'}
                    {account.riskTier === 'aggressive' && 'Aggressive tier: 1% risk per trade, 5 contracts max, faster promotion.'}
                  </p>
                  <div className="mt-4 p-3 rounded-lg border border-border">
                    <h5 className="text-sm font-medium mb-1">Shared Account Policy</h5>
                    <p className="text-xs text-muted-foreground">
                      Multiple bots can share this account. Risk limits are enforced at the account level - 
                      orders breaching limits will be blocked regardless of which bot submitted them.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}