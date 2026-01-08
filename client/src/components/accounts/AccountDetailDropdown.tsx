import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TrendingUp,
  BarChart3,
  List,
  Shield,
  Bot,
  Play,
  Square,
  FileText,
  Activity,
  Plus,
  Trash2,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTradeLogs, useOpenPositions } from "@/hooks/useTrading";
import { useLinkedBots } from "@/hooks/useLinkedBots";
import { useStartBotInstance, useStopBotInstance, useDeleteBotInstance } from "@/hooks/useBotInstances";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { RiskProfileDisplay } from "@/components/risk/RiskProfileDisplay";
import { AttachBotToAccountDialog } from "./AttachBotToAccountDialog";
import { useLivePnLContext } from "@/contexts/LivePnLContext";
import type { Account } from "@/hooks/useAccounts";

interface AccountDetailDropdownProps {
  account: Account;
  isExpanded: boolean;
  initialTab?: string;
}

export function AccountDetailDropdown({ account, isExpanded, initialTab = "overview" }: AccountDetailDropdownProps) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  
  const { data: tradeLogs = [] } = useTradeLogs(isExpanded ? account.id : undefined, 100);
  const { data: openPositions = [] } = useOpenPositions(isExpanded ? account.id : undefined);
  const { data: linkedBotsResult } = useLinkedBots(isExpanded ? account.id : undefined);
  const livePnLContext = useLivePnLContext();
  
  // Extract bots array from result wrapper (useLinkedBots returns { data, degraded, ... })
  const linkedBots = linkedBotsResult?.data ?? [];
  const startInstance = useStartBotInstance();
  const stopInstance = useStopBotInstance();
  const deleteInstance = useDeleteBotInstance();
  
  // Subscribe to live P&L updates for all linked bots
  useEffect(() => {
    if (linkedBots.length > 0 && livePnLContext) {
      const botIds = linkedBots.map(b => b.botId);
      livePnLContext.subscribe(botIds);
      return () => livePnLContext.unsubscribe(botIds);
    }
  }, [linkedBots.length, livePnLContext]);

  // Sync activeTab when initialTab changes (e.g., clicking on Bots stat)
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  if (!isExpanded) return null;

  const handleDetach = (instanceId: string) => {
    setSelectedInstanceId(instanceId);
    setDetachDialogOpen(true);
  };

  const confirmDetach = () => {
    if (selectedInstanceId) {
      deleteInstance.mutate(selectedInstanceId);
    }
    setDetachDialogOpen(false);
    setSelectedInstanceId(null);
  };

  const closedTrades = tradeLogs.filter((t: any) => !(t.isOpen ?? t.is_open) && t.pnl !== null);
  
  // Build equity curve
  // Handle both camelCase (API) and snake_case (legacy) field names
  const initialBalance = Number((account as any).initialBalance ?? (account as any).initial_balance ?? 50000);
  const currentBalance = Number((account as any).currentBalance ?? (account as any).current_balance ?? initialBalance);
  let runningBalance = initialBalance;
  const equityCurve = [{ date: "Start", balance: runningBalance }];
  
  closedTrades.slice().reverse().forEach((trade: any) => {
    runningBalance += (trade.pnl || 0);
    equityCurve.push({
      date: new Date(trade.exitTime ?? trade.exit_time ?? trade.createdAt ?? trade.created_at).toLocaleDateString(),
      balance: runningBalance,
    });
  });

  // Today's PnL
  const today = new Date().toDateString();
  const todayPnl = closedTrades
    .filter((t: any) => new Date(t.exitTime ?? t.exit_time ?? t.createdAt ?? t.created_at).toDateString() === today)
    .reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);

  const pnl = currentBalance - initialBalance;

  return (
    <div className="border-t border-border bg-muted/30 p-3 space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start overflow-x-auto flex-nowrap bg-background/50 h-8">
          <TabsTrigger value="overview" className="text-xs px-2">
            <Activity className="w-3 h-3 mr-1" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="bots" className="text-xs px-2">
            <Bot className="w-3 h-3 mr-1" />
            Bots
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs px-2">
            <BarChart3 className="w-3 h-3 mr-1" />
            Positions
          </TabsTrigger>
          <TabsTrigger value="trades" className="text-xs px-2">
            <List className="w-3 h-3 mr-1" />
            Trades
          </TabsTrigger>
          <TabsTrigger value="risk" className="text-xs px-2">
            <Shield className="w-3 h-3 mr-1" />
            Risk
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs px-2">
            <FileText className="w-3 h-3 mr-1" />
            Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-3">
          {/* Activity Stats */}
          <div className="grid grid-cols-4 gap-2">
            <Card className="p-2 text-center">
              <p className="text-[9px] uppercase text-muted-foreground">Today P&L</p>
              <PnlDisplay value={todayPnl} size="sm" className="justify-center" />
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[9px] uppercase text-muted-foreground">Max DD</p>
              <p className="text-sm font-mono text-loss">
                {(() => {
                  const maxDD = (account as any).maxDrawdown ?? (account as any).max_drawdown;
                  return maxDD ? `-$${Number(maxDD).toLocaleString()}` : "—";
                })()}
              </p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[9px] uppercase text-muted-foreground">Open Pos</p>
              <p className="text-sm font-mono">{openPositions.length}</p>
            </Card>
            <Card className="p-2 text-center">
              <p className="text-[9px] uppercase text-muted-foreground">Trades</p>
              <p className="text-sm font-mono">{closedTrades.length}</p>
            </Card>
          </div>

          {/* Mini Equity Curve */}
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Equity Curve
                </p>
              </div>
              {equityCurve.length > 1 ? (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={['dataMin - 1000', 'dataMax + 1000']} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                        fontSize: '12px'
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
                <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground border border-dashed border-border rounded">
                  No trade data
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bots" className="mt-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              {linkedBots.length} bot{linkedBots.length !== 1 ? "s" : ""} attached
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 text-xs"
              onClick={() => setAttachDialogOpen(true)}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Bot
            </Button>
          </div>
{linkedBots.length > 0 ? (
            <div className="space-y-1">
              {linkedBots.map((instance) => {
                const botName = instance.bot?.name || "Unknown";
                // Use symbol from API, fall back to parsing from name
                const botSymbol = instance.bot?.symbol || (() => {
                  const match = botName.match(/^(MES|MNQ|ES|NQ|RTY|YM|GC|CL|SI)/i);
                  return match ? match[1].toUpperCase() : "—";
                })();
                
                // Get live P&L from WebSocket, fall back to persisted value
                const liveUpdate = livePnLContext?.getUpdate(instance.botId);
                const unrealizedPnl = liveUpdate?.unrealizedPnl ?? instance.currentPnl ?? 0;
                // Check for open position: non-zero quantity (absolute value) or has persisted side or has live update
                const hasPosition = Math.abs(instance.currentPosition ?? 0) > 0 || 
                                   instance.positionSide != null || 
                                   liveUpdate != null;
                
                return (
                <div 
                  key={instance.id} 
                  className="flex items-center gap-3 px-2 py-1.5 rounded-md hover-elevate"
                  data-testid={`bot-instance-row-${instance.id}`}
                >
                  <Link 
                    to={`/bots/${instance.botId}`}
                    className="text-sm font-medium hover:text-primary transition-colors min-w-0 truncate flex-shrink-0"
                    data-testid={`link-bot-${instance.botId}`}
                  >
                    {botName}
                  </Link>
                  <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded flex-shrink-0">
                    {botSymbol}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <StatusBadge status={instance.mode as any} />
                    <StatusBadge status={instance.status as any} />
                  </div>
                  <div className="flex items-center gap-3 flex-1 justify-end text-xs font-mono">
                    <div className="text-center text-muted-foreground">
                      ${currentBalance.toLocaleString()}
                    </div>
                    <div className="text-center" title={hasPosition ? `Position: ${instance.positionSide || 'LONG'} @ ${instance.entryPrice?.toFixed(2) || '—'}` : "No position"}>
                      {hasPosition && <span className="text-[9px] text-muted-foreground mr-1">LIVE</span>}
                      <PnlDisplay value={unrealizedPnl} size="sm" />
                    </div>
                    <div className="text-center">
                      <PnlDisplay value={instance.bot?.totalPnl ?? 0} size="sm" />
                    </div>
                    <div className="text-center text-muted-foreground w-10">
                      {instance.bot?.winRate != null ? `${(instance.bot.winRate * 100).toFixed(0)}%` : "—"}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0"
                        data-testid={`button-bot-menu-${instance.id}`}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {instance.status === "running" ? (
                        <DropdownMenuItem 
                          onClick={() => stopInstance.mutate(instance.id)}
                          disabled={stopInstance.isPending}
                          data-testid={`menu-stop-${instance.id}`}
                        >
                          <Square className="w-4 h-4 mr-2" />
                          Stop
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem 
                          onClick={() => startInstance.mutate(instance.id)}
                          disabled={startInstance.isPending}
                          data-testid={`menu-start-${instance.id}`}
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Start
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem 
                        onClick={() => handleDetach(instance.id)}
                        className="text-destructive focus:text-destructive"
                        data-testid={`menu-detach-${instance.id}`}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Detach
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );})}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-6">
              <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No bots linked</p>
              <p className="text-xs mt-1">Add a bot to start trading on this account</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="positions" className="mt-3">
          {openPositions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {openPositions.map((pos: any) => (
                  <TableRow key={pos.id}>
                    <TableCell className="font-mono text-sm">{pos.symbol ?? pos.instrument}</TableCell>
                    <TableCell>
                      <span className={pos.side === "BUY" ? "text-profit" : "text-loss"}>
                        {pos.side}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
                    <TableCell className="text-right font-mono">{pos.entryPrice ?? pos.entry_price}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No open positions</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="trades" className="mt-3">
          {closedTrades.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {closedTrades.slice(0, 20).map((trade: any) => (
                  <TableRow key={trade.id}>
                    <TableCell className="font-mono text-sm">{trade.symbol ?? trade.instrument}</TableCell>
                    <TableCell>
                      <span className={trade.side === "BUY" ? "text-profit" : "text-loss"}>
                        {trade.side}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <PnlDisplay value={trade.pnl || 0} size="sm" />
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(trade.exitTime ?? trade.exit_time ?? trade.createdAt ?? trade.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              <List className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No closed trades</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="risk" className="mt-3">
          <RiskProfileDisplay 
            riskTier={(account as any).risk_tier ?? (account as any).riskTier}
            riskProfileJson={(account as any).risk_profile ?? (account as any).riskProfile as Record<string, unknown>}
            accountEquity={currentBalance}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-3">
          <div className="text-center text-muted-foreground py-8">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Audit log coming soon</p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Attach Bot Dialog */}
      <AttachBotToAccountDialog
        account={account}
        open={attachDialogOpen}
        onOpenChange={setAttachDialogOpen}
      />

      {/* Detach Confirmation */}
      <AlertDialog open={detachDialogOpen} onOpenChange={setDetachDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Bot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to detach this bot from the account? 
              This will stop any active trading and remove the instance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDetach}
              className="bg-destructive text-destructive-foreground"
            >
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
