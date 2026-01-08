import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  HelpCircle, 
  TrendingUp, 
  XCircle, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Zap,
  Shield,
  Users,
  Database,
  ChevronDown,
  Route,
  Wifi,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useMarketHours } from "@/hooks/useMarketHours";
import { toast } from "sonner";
import http from "@/lib/http";

interface WhyBotDrawerProps {
  bot: {
    id: string;
    name: string;
    stage: string;
    mode: string | null;
    is_trading_enabled?: boolean;
    health_state?: string;
    total_trades?: number;
  };
}

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  action?: string;
  icon: React.ElementType;
}

interface ArbiterDecision {
  id: string;
  created_at: string;
  symbol: string;
  decision: string;
  reason_codes: string[];
  priority_score: number;
  candidate_score: number;
  competing_bots_json: any[];
  risk_snapshot_json: Record<string, any>;
  signal_snapshot_json: Record<string, any>;
  execution_route: string | null;
  contracts_allocated: number | null;
}

const STAGE_TO_EXPECTED_MODE: Record<string, string> = {
  TRIALS: 'BACKTEST_ONLY',
  PAPER: 'SIM_LIVE',
  SHADOW: 'SHADOW',
  CANARY: 'CANARY',
  LIVE: 'LIVE',
};

export function WhyBotDrawer({ bot }: WhyBotDrawerProps) {
  const [open, setOpen] = useState(false);
  const hasTrades = (bot.total_trades || 0) > 0;
  const defaultTab = hasTrades ? "decisions" : "status";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <button className="flex items-center justify-center w-6 h-6 rounded border border-muted/50 bg-muted/30 hover:bg-muted/50 transition-colors">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Why? (status & decisions)
        </TooltipContent>
      </Tooltip>
      
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            {bot.name}
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue={defaultTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="status" className="text-xs">
              Status Checks
            </TabsTrigger>
            <TabsTrigger value="decisions" className="text-xs">
              Trade Decisions {hasTrades && `(${bot.total_trades})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="mt-4">
            <StatusChecksTab bot={bot} />
          </TabsContent>

          <TabsContent value="decisions" className="mt-4">
            <TradeDecisionsTab botId={bot.id} botName={bot.name} isOpen={open} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// Status Checks Tab (Why isn't trading)
function StatusChecksTab({ bot }: { bot: WhyBotDrawerProps['bot'] }) {
  const { data: marketHours } = useMarketHours();
  const queryClient = useQueryClient();

  // Fetch bot instances for status checks via Express (single control plane)
  const { data: instances } = useQuery({
    queryKey: ["bot_instances_for_status", bot.id],
    queryFn: async () => {
      const response = await http.get<any[]>(`/api/bot-instances?bot_id=${bot.id}`);
      if (!response.ok) throw new Error(response.error || "Failed to fetch instances");
      return response.data || [];
    },
  });

  const runReconciliation = useMutation({
    mutationFn: async () => {
      // Call Express endpoint (single control plane)
      const response = await http.post<{ 
        success: boolean; 
        trace_id: string; 
        bots_healed?: number;
        error?: string;
      }>(`/api/bots/${bot.id}/reconcile`, { dry_run: false });
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Reconciliation failed");
      }
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Reconciliation complete: ${data.bots_healed || 0} issues fixed`);
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bot-runner-jobs'] });
    },
    onError: (error: Error) => {
      toast.error(`Reconciliation failed: ${error.message}`);
    },
  });

  // Compute checks
  const checks: CheckResult[] = [];
  
  const expectedMode = STAGE_TO_EXPECTED_MODE[bot.stage] || 'BACKTEST_ONLY';
  const shouldBeScanning = ['PAPER', 'SHADOW', 'CANARY', 'LIVE'].includes(bot.stage);
  const primaryInstance = instances?.[0];

  // Check 1: Stage appropriateness
  if (bot.stage === 'TRIALS') {
    checks.push({
      name: 'Lifecycle Stage',
      status: 'warn',
      detail: 'Bot is in TRIALS stage - only backtests run, no live scanning',
      action: 'Graduate to PAPER to enable live scanning',
      icon: Database,
    });
  } else {
    checks.push({
      name: 'Lifecycle Stage',
      status: 'pass',
      detail: `Bot is in ${bot.stage} stage - should be scanning`,
      icon: Database,
    });
  }

  // Check 2: Mode alignment
  if (bot.mode !== expectedMode) {
    checks.push({
      name: 'Execution Mode',
      status: 'fail',
      detail: `Mode mismatch: ${bot.mode || 'None'} should be ${expectedMode}`,
      action: 'Run reconciliation to fix',
      icon: AlertCircle,
    });
  } else {
    checks.push({
      name: 'Execution Mode',
      status: 'pass',
      detail: `Mode correctly set to ${bot.mode}`,
      icon: CheckCircle,
    });
  }

  // Check 3: Runner exists
  if (shouldBeScanning) {
    if (!instances || instances.length === 0) {
      checks.push({
        name: 'Runner Instance',
        status: 'fail',
        detail: 'No runner instance exists for this bot',
        action: 'Attach bot to an account to create runner',
        icon: XCircle,
      });
    } else if (primaryInstance) {
      const instanceModeOk = primaryInstance.mode === expectedMode;
      const instanceRunning = primaryInstance.status === 'running';
      const instanceScanning = ['SCANNING', 'TRADING'].includes(primaryInstance.activity_state);
      
      if (!instanceModeOk) {
        checks.push({
          name: 'Runner Instance',
          status: 'fail',
          detail: `Instance mode ${primaryInstance.mode} should be ${expectedMode}`,
          action: 'Run reconciliation to fix',
          icon: AlertCircle,
        });
      } else if (!instanceRunning || !instanceScanning) {
        checks.push({
          name: 'Runner Instance',
          status: 'fail',
          detail: `Instance is ${primaryInstance.status}/${primaryInstance.activity_state} but should be running/SCANNING`,
          action: 'Run reconciliation to fix',
          icon: AlertCircle,
        });
      } else {
        checks.push({
          name: 'Runner Instance',
          status: 'pass',
          detail: 'Runner is active and scanning',
          icon: CheckCircle,
        });
      }
    }
  }

  // Check 4: Market hours
  const isMarketOpen = marketHours?.isOpen ?? true;
  if (!isMarketOpen) {
    checks.push({
      name: 'Market Hours',
      status: 'warn',
      detail: 'Market is currently closed',
      action: `Next open: ${marketHours?.nextOpen || 'Unknown'}`,
      icon: Clock,
    });
  } else {
    checks.push({
      name: 'Market Hours',
      status: 'pass',
      detail: 'Market is open',
      icon: Clock,
    });
  }

  // Check 5: Trading enabled
  if (bot.is_trading_enabled === false) {
    checks.push({
      name: 'Trading Enabled',
      status: 'fail',
      detail: 'Trading is disabled for this bot',
      action: 'Enable trading in bot settings',
      icon: Shield,
    });
  } else {
    checks.push({
      name: 'Trading Enabled',
      status: 'pass',
      detail: 'Trading is enabled',
      icon: Shield,
    });
  }

  // Check 6: Health state
  if (bot.health_state === 'DEGRADED') {
    checks.push({
      name: 'Health State',
      status: 'fail',
      detail: 'Bot health is DEGRADED - trading blocked',
      action: 'Review health issues',
      icon: AlertCircle,
    });
  } else {
    checks.push({
      name: 'Health State',
      status: 'pass',
      detail: `Health: ${bot.health_state || 'OK'}`,
      icon: CheckCircle,
    });
  }

  // Check 7: Data provider
  checks.push({
    name: 'Data Provider',
    status: 'pass',
    detail: 'Market data connection assumed OK',
    icon: Wifi,
  });

  const failCount = checks.filter(c => c.status === 'fail').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-4 pr-4">
        {/* Summary */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
          {failCount > 0 ? (
            <XCircle className="w-5 h-5 text-red-400" />
          ) : warnCount > 0 ? (
            <AlertCircle className="w-5 h-5 text-amber-400" />
          ) : (
            <CheckCircle className="w-5 h-5 text-emerald-400" />
          )}
          <span className="text-sm">
            {failCount > 0 
              ? `${failCount} issue${failCount > 1 ? 's' : ''} blocking trading`
              : warnCount > 0
              ? `${warnCount} warning${warnCount > 1 ? 's' : ''} - may affect trading`
              : 'All checks passed - bot should be trading'}
          </span>
        </div>

        {/* Checks list */}
        <div className="space-y-2">
          {checks.map((check, i) => (
            <div
              key={i}
              className={cn(
                "p-3 rounded-lg border",
                check.status === 'fail' && "bg-red-500/5 border-red-500/30",
                check.status === 'warn' && "bg-amber-500/5 border-amber-500/30",
                check.status === 'pass' && "bg-muted/20 border-border/50"
              )}
            >
              <div className="flex items-start gap-2">
                <check.icon className={cn(
                  "w-4 h-4 mt-0.5",
                  check.status === 'fail' && "text-red-400",
                  check.status === 'warn' && "text-amber-400",
                  check.status === 'pass' && "text-emerald-400"
                )} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{check.name}</span>
                    <Badge variant={
                      check.status === 'fail' ? 'destructive' : 
                      check.status === 'warn' ? 'secondary' : 'outline'
                    } className="text-[9px] px-1.5 py-0">
                      {check.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                  {check.action && (
                    <p className="text-xs text-primary mt-1">→ {check.action}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        {failCount > 0 && (
          <div className="pt-4 border-t border-border/50">
            <Button
              onClick={() => runReconciliation.mutate()}
              disabled={runReconciliation.isPending}
              className="w-full"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", runReconciliation.isPending && "animate-spin")} />
              {runReconciliation.isPending ? 'Running...' : 'Run Auto-Heal Reconciliation'}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              This will attempt to fix execution mode and runner state issues
            </p>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// Trade Decisions Tab (Why did it trade)
function TradeDecisionsTab({ botId, botName, isOpen }: { botId: string; botName: string; isOpen: boolean }) {
  // Fetch arbiter decisions via Express (single control plane)
  const { data: decisions, isLoading } = useQuery({
    queryKey: ["arbiter_decisions", botId],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data?: ArbiterDecision[] }>(`/api/arbiter/decisions?botId=${botId}&limit=20`);
      if (!response.ok) throw new Error(response.error || "Failed to fetch decisions");
      return response.data?.data || [];
    },
    enabled: isOpen,
  });

  // Fetch decision traces via Express (single control plane)
  const { data: traces } = useQuery({
    queryKey: ["trade_decision_traces", botId],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data?: any[] }>(`/api/trade-decision-trace?botId=${botId}&limit=20`);
      if (!response.ok) throw new Error(response.error || "Failed to fetch traces");
      return response.data?.data || [];
    },
    enabled: isOpen,
  });

  // Fetch decision sources via Express (single control plane) - filtered by bot
  const { data: sources } = useQuery({
    queryKey: ["trade_decision_sources", botId],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data?: any[] }>(`/api/trade-decision-sources?botId=${botId}&limit=100`);
      if (!response.ok) throw new Error(response.error || "Failed to fetch sources");
      return response.data?.data || [];
    },
    enabled: isOpen,
  });

  const executedCount = decisions?.filter(d => d.decision === "EXECUTED").length ?? 0;
  const blockedCount = decisions?.filter(d => d.decision === "BLOCKED").length ?? 0;

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading decisions...</div>;
  }

  if (!decisions?.length && !traces?.length) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="w-12 h-12 rounded-full bg-muted/50 mx-auto flex items-center justify-center">
          <HelpCircle className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No trade decisions yet</p>
          <p className="text-xs text-muted-foreground">
            When this bot evaluates trading opportunities,<br />
            decisions will appear here with explanations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-4 pr-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-2">
          <Card className="bg-emerald-500/10 border-emerald-500/20">
            <CardContent className="p-3 flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <div>
                <p className="text-lg font-semibold">{executedCount}</p>
                <p className="text-[10px] text-muted-foreground">Executed</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-red-500/10 border-red-500/20">
            <CardContent className="p-3 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-lg font-semibold">{blockedCount}</p>
                <p className="text-[10px] text-muted-foreground">Blocked</p>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Trade Decision Traces */}
        {traces && traces.length > 0 && (
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                Decision Traces ({traces.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2">
              {traces.slice(0, 5).map((trace: any) => (
                <TraceCard key={trace.id} trace={trace} sources={sources?.filter((s: any) => s.trace_id === trace.id) || []} />
              ))}
            </CardContent>
          </Card>
        )}

        {decisions?.map((decision) => (
          <DecisionCard key={decision.id} decision={decision} />
        ))}
      </div>
    </ScrollArea>
  );
}

function TraceCard({ trace, sources }: { trace: any; sources: any[] }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="p-2 rounded border bg-muted/30">
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Route className={cn(
                "h-3.5 w-3.5",
                trace.routing_result === "BROKER_FILLS" ? "text-emerald-500" : "text-blue-500"
              )} />
              <span className="text-xs font-medium">{trace.symbol}</span>
              <Badge variant="outline" className="text-[9px]">
                {trace.final_action}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(trace.created_at), "HH:mm:ss")}
              </span>
              <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent className="pt-2 space-y-2">
          <div className="text-xs">
            <span className="text-muted-foreground">Routing: </span>
            <Badge variant={trace.routing_result === "BROKER_FILLS" ? "default" : "secondary"} className="text-[9px]">
              {trace.routing_result}
            </Badge>
          </div>
          
          {trace.metrics_json && (
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              {trace.metrics_json.confidence !== undefined && (
                <div>Confidence: {(trace.metrics_json.confidence * 100).toFixed(0)}%</div>
              )}
              {trace.metrics_json.freshness !== undefined && (
                <div>Freshness: {trace.metrics_json.freshness}ms</div>
              )}
            </div>
          )}
          
          {sources.length > 0 && (
            <div>
              <p className="text-[10px] uppercase text-muted-foreground mb-1">Sources Used</p>
              <div className="space-y-1">
                {sources.map((src: any) => (
                  <div key={src.id} className="flex items-center justify-between text-[10px] p-1 rounded bg-muted/50">
                    <div className="flex items-center gap-1">
                      <Database className="h-3 w-3 text-muted-foreground" />
                      <span>{src.source_type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Weight: {(src.weight_used * 100).toFixed(0)}%</span>
                      {src.was_decisive && <Badge className="text-[8px] h-4">Decisive</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {trace.reason_codes && trace.reason_codes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {trace.reason_codes.map((code: string, i: number) => (
                <Badge key={i} variant="outline" className="text-[9px]">{code}</Badge>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function DecisionCard({ decision }: { decision: ArbiterDecision }) {
  const isExecuted = decision.decision === "EXECUTED";
  const isBlocked = decision.decision === "BLOCKED";

  const competingBots = decision.competing_bots_json || [];
  const riskSnapshot = decision.risk_snapshot_json || {};

  return (
    <Card className={cn(
      "bg-muted/30",
      isExecuted && "border-emerald-500/20",
      isBlocked && "border-red-500/20"
    )}>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExecuted ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
            <CardTitle className="text-sm font-medium">
              {decision.decision} · {decision.symbol}
            </CardTitle>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {format(new Date(decision.created_at), "MMM d, HH:mm")}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0 space-y-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">Priority:</span>
            <span className="text-xs font-mono font-medium">{decision.priority_score.toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Candidate:</span>
            <span className="text-xs font-mono font-medium">{decision.candidate_score.toFixed(2)}</span>
          </div>
        </div>

        {decision.reason_codes.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
              {isBlocked ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
              {isBlocked ? "Block Reasons" : "Pass Reasons"}
            </p>
            <div className="flex flex-wrap gap-1">
              {decision.reason_codes.map((code, i) => (
                <Badge 
                  key={i}
                  variant={isBlocked ? "destructive" : "outline"}
                  className="text-[9px] font-mono"
                >
                  {code.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {competingBots.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
              <Users className="h-3 w-3" />
              Competition ({competingBots.length} bots)
            </p>
            <div className="space-y-1">
              {competingBots.slice(0, 5).map((c: any, i: number) => (
                <div
                  key={c.bot_id || i}
                  className={cn(
                    "flex items-center justify-between text-xs p-1.5 rounded",
                    c.won ? "bg-emerald-500/10" : "bg-muted/50"
                  )}
                >
                  <span className="font-medium truncate max-w-[180px]">
                    {i + 1}. {c.bot_name || c.bot_id?.slice(0, 8)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">
                      {(c.score ?? 0).toFixed(0)}
                    </span>
                    {c.blocked && (
                      <Badge variant="secondary" className="text-[9px]">
                        {c.block_reason || "blocked"}
                      </Badge>
                    )}
                    {c.won && (
                      <Badge variant="default" className="text-[9px]">Winner</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator className="my-2" />

        {Object.keys(riskSnapshot).length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
              <Shield className="h-3 w-3" />
              Risk Snapshot
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {riskSnapshot.daily_headroom !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Daily Headroom:</span>
                  <span className="font-mono">${riskSnapshot.daily_headroom?.toFixed(0)}</span>
                </div>
              )}
              {riskSnapshot.max_contracts !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Contracts:</span>
                  <span className="font-mono">{riskSnapshot.max_contracts}</span>
                </div>
              )}
              {riskSnapshot.exposure_used !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Exposure Used:</span>
                  <span className="font-mono">{riskSnapshot.exposure_used}</span>
                </div>
              )}
              {riskSnapshot.account_balance !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Balance:</span>
                  <span className="font-mono">${riskSnapshot.account_balance?.toFixed(0)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {isExecuted && (
          <div className="flex items-center gap-4 text-xs pt-1">
            {decision.execution_route && (
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Route:</span>
                <Badge variant="outline" className="text-[9px] font-mono">
                  {decision.execution_route}
                </Badge>
              </div>
            )}
            {decision.contracts_allocated !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Contracts:</span>
                <span className="font-mono font-medium">{decision.contracts_allocated}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
