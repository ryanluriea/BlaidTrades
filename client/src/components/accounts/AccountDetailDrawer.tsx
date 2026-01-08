import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  Wallet,
  TrendingUp,
  BarChart3,
  List,
  Shield,
  Bot,
  ExternalLink,
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
import { useAccount } from "@/hooks/useAccounts";
import { useTradeLogs, useOpenPositions } from "@/hooks/useTrading";
import { useLinkedBots } from "@/hooks/useLinkedBots";
import { useStartBotInstance, useStopBotInstance, useDeleteBotInstance } from "@/hooks/useBotInstances";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { RiskProfileDisplay } from "@/components/risk/RiskProfileDisplay";
import { AttachBotToAccountDialog } from "./AttachBotToAccountDialog";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import type { Account } from "@/hooks/useAccounts";

interface AccountDetailDrawerProps {
  accountId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDetailDrawer({ accountId, open, onOpenChange }: AccountDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  
  const { data: account, isLoading: accountLoading, isError: accountError } = useAccount(accountId || undefined);
  const { data: tradeLogsRaw, isLoading: tradesLoading, isError: tradesError } = useTradeLogs(accountId || undefined, 100);
  const { data: positionsRaw, isLoading: positionsLoading, isError: positionsError } = useOpenPositions(accountId || undefined);
  const { data: linkedBotsRaw, isLoading: botsLoading, isError: botsError } = useLinkedBots(accountId || undefined);
  const startInstance = useStartBotInstance();
  const stopInstance = useStopBotInstance();
  const deleteInstance = useDeleteBotInstance();

  const tradeLogs = Array.isArray(tradeLogsRaw) ? tradeLogsRaw : [];
  const openPositions = Array.isArray(positionsRaw) ? positionsRaw : [];
  // Extract linked bots from wrapper - useLinkedBots returns { data: LinkedBot[], degraded, ... }
  const linkedBots = linkedBotsRaw?.data ?? [];

  const isAccountDegraded = accountError || (!accountLoading && !account);
  const isTradesDegraded = tradesError || (!tradesLoading && tradeLogsRaw === undefined);
  const isPositionsDegraded = positionsError || (!positionsLoading && positionsRaw === undefined);
  const isBotsDegraded = botsError || (!botsLoading && linkedBotsRaw === undefined);

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

  if (!accountId) return null;

  const closedTrades = tradeLogs.filter(t => !t.isOpen && t.pnl !== null);
  
  const runningBalance = account?.initialBalance || 50000;
  let balance = runningBalance;
  const equityCurve = [{ date: "Start", balance }];
  
  closedTrades.slice().reverse().forEach((trade) => {
    balance += (trade.pnl || 0);
    equityCurve.push({
      date: new Date(trade.exitTime || trade.createdAt).toLocaleDateString(),
      balance,
    });
  });

  const today = new Date().toDateString();
  const todayPnl = closedTrades
    .filter(t => new Date(t.exitTime || t.createdAt).toDateString() === today)
    .reduce((sum, t) => sum + (t.pnl || 0), 0);

  const pnl = account ? account.currentBalance - account.initialBalance : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0 pb-2 border-b border-border">
          {accountLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : isAccountDegraded ? (
            <DegradedBanner message="Account data unavailable" />
          ) : account ? (
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-left">{account.name}</SheetTitle>
                <div className="flex items-center gap-1.5 mt-1">
                  <StatusBadge status={account.accountType as any} />
                  <StatusBadge status={account.riskTier as any} />
                  {account.allowSharedBots && (
                    <StatusBadge status="shared" />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <SheetTitle>Account Not Found</SheetTitle>
          )}
        </SheetHeader>

        {accountLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : isAccountDegraded ? (
          <div className="flex-1 flex items-center justify-center">
            <DegradedBanner message="Cannot load account details" />
          </div>
        ) : account ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="py-4">
              <TabsList className="w-full grid grid-cols-6 h-auto">
                <TabsTrigger value="overview" className="text-xs px-2 py-1.5">
                  <Activity className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Overview</span>
                </TabsTrigger>
                <TabsTrigger value="bots" className="text-xs px-2 py-1.5">
                  <Bot className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Bots</span>
                </TabsTrigger>
                <TabsTrigger value="positions" className="text-xs px-2 py-1.5">
                  <BarChart3 className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Positions</span>
                </TabsTrigger>
                <TabsTrigger value="trades" className="text-xs px-2 py-1.5">
                  <List className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Trades</span>
                </TabsTrigger>
                <TabsTrigger value="risk" className="text-xs px-2 py-1.5">
                  <Shield className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Risk</span>
                </TabsTrigger>
                <TabsTrigger value="audit" className="text-xs px-2 py-1.5">
                  <FileText className="w-3 h-3 sm:mr-1" />
                  <span className="hidden sm:inline">Audit</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4 mt-4">
                <div className="grid grid-cols-3 gap-2">
                  <Card className="p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Balance</p>
                    <p className="text-lg font-bold font-mono">
                      ${(account.currentBalance / 1000).toFixed(1)}k
                    </p>
                  </Card>
                  <Card className="p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Today P&L</p>
                    {isTradesDegraded ? (
                      <span className="text-amber-500 text-sm">—</span>
                    ) : (
                      <PnlDisplay value={todayPnl} size="md" />
                    )}
                  </Card>
                  <Card className="p-3">
                    <p className="text-[10px] uppercase text-muted-foreground">Total P&L</p>
                    <PnlDisplay value={pnl} size="md" />
                  </Card>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Card className="p-2 text-center">
                    <p className="text-[9px] uppercase text-muted-foreground">Max DD</p>
                    <p className="text-sm font-mono text-loss">
                      {account.maxDrawdown ? `-$${Number(account.maxDrawdown).toLocaleString()}` : "—"}
                    </p>
                  </Card>
                  <Card className="p-2 text-center">
                    <p className="text-[9px] uppercase text-muted-foreground">Open Pos</p>
                    <p className="text-sm font-mono">
                      {isPositionsDegraded ? "—" : openPositions.length}
                    </p>
                  </Card>
                  <Card className="p-2 text-center">
                    <p className="text-[9px] uppercase text-muted-foreground">Bots</p>
                    <p className="text-sm font-mono">
                      {isBotsDegraded ? "—" : linkedBots.length}
                    </p>
                  </Card>
                  <Card className="p-2 text-center">
                    <p className="text-[9px] uppercase text-muted-foreground">Trades</p>
                    <p className="text-sm font-mono">
                      {isTradesDegraded ? "—" : closedTrades.length}
                    </p>
                  </Card>
                </div>

                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Equity Curve
                      </p>
                    </div>
                    {isTradesDegraded ? (
                      <DegradedBanner message="Trade data unavailable" />
                    ) : equityCurve.length > 1 ? (
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

              <TabsContent value="bots" className="mt-4">
                {isBotsDegraded ? (
                  <DegradedBanner message="Linked bots data unavailable" />
                ) : (
                  <>
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
                          const botSymbol = 'ES'; // Default symbol - full bot data not available in linked bots response
                          return (
                          <div 
                            key={instance.id} 
                            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover-elevate"
                            data-testid={`bot-instance-row-${instance.id}`}
                          >
                            <Link 
                              to={`/bots/${instance.botId}`}
                              className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-1 min-w-0 truncate"
                              data-testid={`link-bot-${instance.botId}`}
                            >
                              {instance.bot?.name || "Unknown"}
                              <ExternalLink className="w-3 h-3 opacity-50 flex-shrink-0" />
                            </Link>
                            <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded flex-shrink-0">
                              {botSymbol}
                            </span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <StatusBadge status={instance.mode as any} />
                              <StatusBadge status={instance.status as any} />
                            </div>
                            <div className="text-right font-mono text-xs flex-shrink-0">
                              <PnlDisplay value={instance.currentPnl ?? 0} size="sm" />
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
                  </>
                )}
              </TabsContent>

              <TabsContent value="positions" className="mt-4">
                {isPositionsDegraded ? (
                  <DegradedBanner message="Position data unavailable" />
                ) : openPositions.length > 0 ? (
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
                          <TableCell className="font-mono text-sm">{pos.symbol}</TableCell>
                          <TableCell>
                            <span className={pos.side === "BUY" ? "text-profit" : "text-loss"}>
                              {pos.side}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{pos.quantity}</TableCell>
                          <TableCell className="text-right font-mono">{pos.entryPrice}</TableCell>
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

              <TabsContent value="trades" className="mt-4">
                {isTradesDegraded ? (
                  <DegradedBanner message="Trade data unavailable" />
                ) : closedTrades.length > 0 ? (
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
                          <TableCell className="font-mono text-sm">{trade.symbol}</TableCell>
                          <TableCell>
                            <span className={trade.side === "BUY" ? "text-profit" : "text-loss"}>
                              {trade.side}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <PnlDisplay value={trade.pnl || 0} size="sm" />
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {new Date(trade.exitTime || trade.createdAt).toLocaleDateString()}
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

              <TabsContent value="risk" className="mt-4">
                <RiskProfileDisplay 
                  riskTier={account.riskTier}
                  riskProfileJson={account.riskProfile as Record<string, unknown>}
                  accountEquity={account.currentBalance}
                />
              </TabsContent>

              <TabsContent value="audit" className="mt-4">
                <div className="text-center text-muted-foreground py-8">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Audit log coming soon</p>
                  <p className="text-xs mt-1">System events and arbiter decisions</p>
                </div>
              </TabsContent>
            </Tabs>
          </ScrollArea>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Account not found
          </div>
        )}
      </SheetContent>

      {account && (
        <AttachBotToAccountDialog
          open={attachDialogOpen}
          onOpenChange={setAttachDialogOpen}
          account={account}
        />
      )}

      <AlertDialog open={detachDialogOpen} onOpenChange={setDetachDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach Bot from Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to detach this bot from the account? 
              This will stop any active trading and remove the bot instance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDetach} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
