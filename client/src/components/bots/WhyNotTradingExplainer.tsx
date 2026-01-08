/**
 * Why Not Trading Explainer - Single primary reason with drawer
 * RULE: If a bot is not trading, return EXACTLY ONE PRIMARY REASON
 * Now includes Trade Decisions tab for unified experience
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  HelpCircle, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  Activity,
  Shield,
  Wifi,
  RefreshCw,
  Pause,
  Zap,
  TrendingDown,
  CheckCircle,
  ChevronDown,
  Database
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanonicalBotState } from "@/hooks/useCanonicalBotState";
import { useMarketHours } from "@/hooks/useMarketHours";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import http from "@/lib/http";

interface WhyNotTradingExplainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
}

// Priority-ordered reasons - first match wins
type ReasonCode = 
  | 'KILLED_SOFT'
  | 'KILLED_HARD'
  | 'QUARANTINED'
  | 'RUNNER_UNAVAILABLE'
  | 'HEALTH_DEGRADED'
  | 'RISK_BLOCKED'
  | 'MARKET_CLOSED'
  | 'NO_VALID_SIGNALS'
  | 'AWAITING_EVOLUTION'
  | 'CAPITAL_NOT_ALLOCATED'
  | 'USER_PAUSED'
  | 'TRIALS_STAGE';

interface PrimaryReason {
  code: ReasonCode;
  headline: string;
  explanation: string;
  what_system_doing: string;
  what_user_can_do: string;
  icon: React.ElementType;
  severity: 'critical' | 'warning' | 'info';
  auto_fix_available: boolean;
  expected_resolution?: string;
}

const REASON_DETAILS: Record<ReasonCode, Omit<PrimaryReason, 'code'>> = {
  KILLED_SOFT: {
    headline: 'Bot Soft-Killed',
    explanation: 'The bot was automatically soft-killed due to a recoverable issue. Trading is temporarily halted while auto-remediation attempts recovery.',
    what_system_doing: 'The kill-engine is attempting auto-resurrection. Once conditions clear, trading will resume automatically.',
    what_user_can_do: 'Check the kill reason below. Most soft-kills resolve automatically within minutes.',
    icon: AlertTriangle,
    severity: 'warning',
    auto_fix_available: true,
    expected_resolution: '1-5 minutes',
  },
  KILLED_HARD: {
    headline: 'Bot Hard-Killed',
    explanation: 'The bot was demoted and hard-killed due to a serious issue (e.g., execution rejects, drawdown breach). A cooldown period is required.',
    what_system_doing: 'Cooldown enforced. The bot will be resurrected after cooldown expires and proof gates pass.',
    what_user_can_do: 'Wait for cooldown, then ensure the underlying issue is resolved. Review kill events for details.',
    icon: XCircle,
    severity: 'critical',
    auto_fix_available: false,
    expected_resolution: '60+ minutes',
  },
  QUARANTINED: {
    headline: 'Bot Quarantined',
    explanation: 'The bot was quarantined to TRIALS due to invalid configuration or persistent data issues. Evolution is blocked.',
    what_system_doing: 'Awaiting manual config patch or data provider fix. No auto-resurrection until root cause resolved.',
    what_user_can_do: 'Review and fix config issues. Check data provider health. Re-run backtests once fixed.',
    icon: Shield,
    severity: 'critical',
    auto_fix_available: false,
  },
  RUNNER_UNAVAILABLE: {
    headline: 'Runner Not Available',
    explanation: 'The bot runner process is not active or has stalled. Without a runner, the bot cannot scan for signals or execute trades.',
    what_system_doing: 'Auto-restart has been queued. The system will attempt to restart the runner with exponential backoff.',
    what_user_can_do: 'Wait for auto-restart, or manually trigger a restart if it persists.',
    icon: XCircle,
    severity: 'critical',
    auto_fix_available: true,
    expected_resolution: '30-90 seconds',
  },
  HEALTH_DEGRADED: {
    headline: 'Bot Health Degraded',
    explanation: 'The bot health score has fallen below the minimum threshold. Trading is blocked to prevent losses from a poorly-performing strategy.',
    what_system_doing: 'The system will continue backtesting to improve metrics. If health improves, trading will resume automatically.',
    what_user_can_do: 'Review the bot brain panel for specific health issues. Consider demoting to TRIALS for more evolution cycles.',
    icon: TrendingDown,
    severity: 'critical',
    auto_fix_available: false,
  },
  RISK_BLOCKED: {
    headline: 'Risk Limits Reached',
    explanation: 'Daily loss limits or position limits have been reached. Trading is paused to protect capital.',
    what_system_doing: 'Limits will reset at market open tomorrow. No further trades today.',
    what_user_can_do: 'Review account risk settings. Limits protect you from excessive drawdown.',
    icon: Shield,
    severity: 'warning',
    auto_fix_available: false,
    expected_resolution: 'Next market open',
  },
  MARKET_CLOSED: {
    headline: 'Market Closed',
    explanation: 'The market is currently closed. The bot will resume scanning when the market opens.',
    what_system_doing: 'Runner is idle, waiting for market hours. Backtesting continues in background.',
    what_user_can_do: 'No action needed. This is normal outside market hours.',
    icon: Clock,
    severity: 'info',
    auto_fix_available: false,
  },
  NO_VALID_SIGNALS: {
    headline: 'No Valid Signals',
    explanation: 'The bot is actively scanning but has not found signals that meet entry criteria. This is normal during low-volatility periods.',
    what_system_doing: 'Continuously scanning market data. Will trade when conditions align with strategy rules.',
    what_user_can_do: 'No action needed. The bot is working as designed.',
    icon: Activity,
    severity: 'info',
    auto_fix_available: false,
  },
  AWAITING_EVOLUTION: {
    headline: 'Evolution In Progress',
    explanation: 'The bot is currently evolving or awaiting backtest results. Trading is paused during this process.',
    what_system_doing: 'Running backtests on new parameter mutations. Best performer will be selected.',
    what_user_can_do: 'Wait for evolution to complete. This typically takes 3-10 minutes.',
    icon: Zap,
    severity: 'info',
    auto_fix_available: false,
    expected_resolution: '3-10 minutes',
  },
  CAPITAL_NOT_ALLOCATED: {
    headline: 'No Capital Allocated',
    explanation: 'The bot has not been allocated risk capital. It needs to prove edge before receiving allocation.',
    what_system_doing: 'Running backtests to prove edge. Capital will be allocated when PROVEN status is achieved.',
    what_user_can_do: 'Ensure the bot completes enough backtests with positive metrics.',
    icon: AlertTriangle,
    severity: 'warning',
    auto_fix_available: false,
  },
  USER_PAUSED: {
    headline: 'Paused By User',
    explanation: 'You have manually paused this bot. It will not trade until resumed.',
    what_system_doing: 'Nothing - waiting for user action.',
    what_user_can_do: 'Click "Resume" to restart the bot.',
    icon: Pause,
    severity: 'info',
    auto_fix_available: false,
  },
  TRIALS_STAGE: {
    headline: 'TRIALS Stage Only',
    explanation: 'This bot is in TRIALS stage which only supports backtesting. Live trading requires graduation to PAPER or higher.',
    what_system_doing: 'Running backtests and evolution to improve metrics. Will auto-promote when gates pass.',
    what_user_can_do: 'Wait for auto-promotion, or manually promote if metrics are satisfactory.',
    icon: RefreshCw,
    severity: 'info',
    auto_fix_available: false,
  },
};

export function WhyNotTradingExplainer({ 
  open, 
  onOpenChange, 
  botId, 
  botName 
}: WhyNotTradingExplainerProps) {
  const { data: state, isLoading } = useCanonicalBotState(botId);
  const { data: marketHours } = useMarketHours();
  const queryClient = useQueryClient();

  const runAutoHeal = useMutation({
    mutationFn: async () => {
      // Call Express endpoint (single control plane)
      const response = await http.post<{ 
        success: boolean; 
        trace_id: string; 
        bots_healed?: number;
        error?: string;
      }>(`/api/bots/${botId}/reconcile`, { dry_run: false });
      
      if (!response.ok || !response.data?.success) {
        throw new Error(response.error || response.data?.error || "Reconciliation failed");
      }
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Auto-heal complete: ${data.bots_healed || 0} issues fixed`);
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['canonical-bot-state', botId] });
    },
    onError: (error: Error) => {
      toast.error(`Auto-heal failed: ${error.message}`);
    },
  });

  // Determine PRIMARY reason (first match wins)
  const getPrimaryReason = (): PrimaryReason => {
    if (!state) {
      return { code: 'RUNNER_UNAVAILABLE', ...REASON_DETAILS.RUNNER_UNAVAILABLE };
    }

    // Priority 0: Kill states (highest priority)
    const killState = state._context?.kill_state;
    if (killState === 'QUARANTINED') {
      return { code: 'QUARANTINED', ...REASON_DETAILS.QUARANTINED };
    }
    if (killState === 'HARD_KILLED') {
      return { code: 'KILLED_HARD', ...REASON_DETAILS.KILLED_HARD };
    }
    if (killState === 'SOFT_KILLED') {
      return { code: 'KILLED_SOFT', ...REASON_DETAILS.KILLED_SOFT };
    }

    // Priority 1: Runner issues
    if (['STALLED', 'ERROR', 'CIRCUIT_BREAK', 'NO_RUNNER'].includes(state.runner_state) && 
        state._context?.stage !== 'TRIALS') {
      return { code: 'RUNNER_UNAVAILABLE', ...REASON_DETAILS.RUNNER_UNAVAILABLE };
    }

    // Priority 2: Health degraded
    if (state.health_state === 'DEGRADED' || state.health_score < 40) {
      return { code: 'HEALTH_DEGRADED', ...REASON_DETAILS.HEALTH_DEGRADED };
    }

    // Priority 3: User paused
    if (state.runner_state === 'PAUSED') {
      return { code: 'USER_PAUSED', ...REASON_DETAILS.USER_PAUSED };
    }

    // Priority 4: TRIALS stage
    if (state._context?.stage === 'TRIALS') {
      return { code: 'TRIALS_STAGE', ...REASON_DETAILS.LAB_STAGE };
    }

    // Priority 5: Evolution in progress
    if (state.evolution_state !== 'IDLE' || 
        state.job_state === 'EVOLVING' || 
        state.job_state === 'EVALUATING') {
      return { code: 'AWAITING_EVOLUTION', ...REASON_DETAILS.AWAITING_EVOLUTION };
    }

    // Priority 6: Market closed
    if (!marketHours?.isOpen) {
      return { code: 'MARKET_CLOSED', ...REASON_DETAILS.MARKET_CLOSED };
    }

    // Priority 7: Check blockers for risk
    const hasRiskBlocker = state.blockers.some(b => 
      b.code.includes('RISK') || b.code.includes('DAILY_LOSS')
    );
    if (hasRiskBlocker) {
      return { code: 'RISK_BLOCKED', ...REASON_DETAILS.RISK_BLOCKED };
    }

    // Default: No valid signals (bot is working correctly)
    return { code: 'NO_VALID_SIGNALS', ...REASON_DETAILS.NO_VALID_SIGNALS };
  };

  const reason = getPrimaryReason();
  const Icon = reason.icon;

  // Fetch trade decision traces
  const { data: traces, isLoading: tracesLoading } = useQuery({
    queryKey: ["trade_decision_traces_explainer", botId],
    queryFn: async () => {
      const response = await http.get<{ success: boolean; data?: any[] }>(`/api/trade-decision-trace?botId=${botId}&limit=30`);
      if (!response.ok) return [];
      return response.data?.data || [];
    },
    enabled: open,
  });

  const decisionCount = traces?.length ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[70vh] rounded-t-xl">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
            Why isn't {botName} trading?
          </SheetTitle>
        </SheetHeader>

        <Tabs defaultValue="status" className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="status" className="text-xs" data-testid="tab-status-checks">
              Status Checks
            </TabsTrigger>
            <TabsTrigger value="decisions" className="text-xs" data-testid="tab-trade-decisions">
              Trade Decisions {decisionCount > 0 && `(${decisionCount})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="status" className="mt-4">
            <ScrollArea className="h-[calc(70vh-180px)]">
              <div className="space-y-6 pr-2">
          {/* Primary Reason - BIG */}
          <div className={cn(
            "p-6 rounded-xl border-2",
            reason.severity === 'critical' && "bg-red-500/5 border-red-500/40",
            reason.severity === 'warning' && "bg-amber-500/5 border-amber-500/40",
            reason.severity === 'info' && "bg-blue-500/5 border-blue-500/40"
          )}>
            <div className="flex items-start gap-4">
              <div className={cn(
                "p-3 rounded-full",
                reason.severity === 'critical' && "bg-red-500/10",
                reason.severity === 'warning' && "bg-amber-500/10",
                reason.severity === 'info' && "bg-blue-500/10"
              )}>
                <Icon className={cn(
                  "w-6 h-6",
                  reason.severity === 'critical' && "text-red-400",
                  reason.severity === 'warning' && "text-amber-400",
                  reason.severity === 'info' && "text-blue-400"
                )} />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold">{reason.headline}</h3>
                <p className="text-sm text-muted-foreground mt-2">{reason.explanation}</p>
                {reason.expected_resolution && (
                  <Badge variant="outline" className="mt-3 text-xs">
                    Expected resolution: {reason.expected_resolution}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* What's happening */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs uppercase text-muted-foreground font-medium mb-2">
                What the system is doing
              </p>
              <p className="text-sm">{reason.what_system_doing}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs uppercase text-muted-foreground font-medium mb-2">
                What you can do
              </p>
              <p className="text-sm">{reason.what_user_can_do}</p>
            </div>
          </div>

          {/* Auto-heal button */}
          {reason.auto_fix_available && (
            <div className="pt-4 border-t border-border/50">
              <Button
                onClick={() => runAutoHeal.mutate()}
                disabled={runAutoHeal.isPending}
                className="w-full"
              >
                <RefreshCw className={cn(
                  "w-4 h-4 mr-2", 
                  runAutoHeal.isPending && "animate-spin"
                )} />
                {runAutoHeal.isPending ? 'Running Auto-Heal...' : 'Run Auto-Heal'}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                This will attempt to automatically fix the issue
              </p>
            </div>
          )}

          {/* Supporting facts */}
          {state && state.why_not_trading.length > 0 && (
            <div className="pt-4 border-t border-border/50">
              <p className="text-xs uppercase text-muted-foreground font-medium mb-2">
                Additional factors
              </p>
              <div className="flex flex-wrap gap-2">
                {state.why_not_trading.map((fact, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {fact}
                  </Badge>
                ))}
              </div>
            </div>
          )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="decisions" className="mt-4">
            <TradeDecisionsContent traces={traces || []} isLoading={tracesLoading} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Trade Decisions Content Component
 */
function TradeDecisionsContent({ traces, isLoading }: { traces: any[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!traces?.length) {
    return (
      <div className="text-center py-12 space-y-3">
        <div className="w-14 h-14 rounded-full bg-muted/50 mx-auto flex items-center justify-center">
          <HelpCircle className="w-7 h-7 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No trade decisions yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            When this bot evaluates trading opportunities,<br />
            decisions will appear here with explanations.
          </p>
        </div>
      </div>
    );
  }

  const executedCount = traces.filter((t: any) => t.final_action === 'EXECUTED' || t.routing_result === 'EXECUTED').length;
  const blockedCount = traces.filter((t: any) => t.final_action === 'BLOCKED' || t.routing_result === 'BLOCKED').length;
  const skippedCount = traces.filter((t: any) => t.final_action === 'SKIPPED' || t.routing_result === 'NO_SIGNAL').length;

  return (
    <ScrollArea className="h-[calc(70vh-180px)]">
      <div className="space-y-4 pr-2">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-2">
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
          <Card className="bg-muted/50 border-border">
            <CardContent className="p-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-lg font-semibold">{skippedCount}</p>
                <p className="text-[10px] text-muted-foreground">Skipped</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Decision List */}
        <div className="space-y-2">
          {traces.slice(0, 20).map((trace: any) => (
            <DecisionCard key={trace.id} trace={trace} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

/**
 * Single Decision Card
 */
function DecisionCard({ trace }: { trace: any }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const action = trace.final_action || trace.routing_result || 'UNKNOWN';
  const isExecuted = action === 'EXECUTED';
  const isBlocked = action === 'BLOCKED';
  
  const reasonCodes = Array.isArray(trace.reason_codes) 
    ? trace.reason_codes 
    : typeof trace.reason_codes === 'string' 
      ? [trace.reason_codes]
      : [];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full">
        <Card className={cn(
          "hover-elevate transition-colors",
          isExecuted && "border-emerald-500/30",
          isBlocked && "border-red-500/30"
        )}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isExecuted ? (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                ) : isBlocked ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <Clock className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{trace.symbol || 'Unknown'}</span>
                <Badge variant="outline" className="text-[10px]">
                  {action}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {trace.timestamp ? format(new Date(trace.timestamp), 'MMM d, HH:mm') : 'Unknown'}
                </span>
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isOpen && "rotate-180"
                )} />
              </div>
            </div>
          </CardContent>
        </Card>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-1 border-l-2 border-l-primary/20">
          <CardContent className="p-3 space-y-2">
            {/* Reason Codes */}
            {reasonCodes.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Reasons</p>
                <div className="flex flex-wrap gap-1">
                  {reasonCodes.map((code: string, i: number) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">
                      {code}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {/* Risk Checks */}
            {trace.risk_checks && Object.keys(trace.risk_checks).length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Risk Checks</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(trace.risk_checks).map(([key, value]: [string, any]) => (
                    <Badge 
                      key={key} 
                      variant={value === true || value === 'PASS' ? 'outline' : 'destructive'}
                      className="text-[10px]"
                    >
                      {key}: {String(value)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Sources Used */}
            {trace.sources_used && (
              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-1">Sources</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {Array.isArray(trace.sources_used) 
                    ? trace.sources_used.join(', ')
                    : JSON.stringify(trace.sources_used)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Small trigger button to show next to bot status
 */
export function WhyNotTradingTrigger({ 
  onClick,
  isTrading = false 
}: { 
  onClick: () => void;
  isTrading?: boolean;
}) {
  if (isTrading) return null;
  
  return (
    <button
      onClick={onClick}
      className="p-1 rounded hover:bg-muted/50 transition-colors"
      title="Why isn't this bot trading?"
    >
      <HelpCircle className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
    </button>
  );
}
