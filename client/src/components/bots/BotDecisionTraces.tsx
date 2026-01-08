import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  TrendingDown,
  XCircle,
  Info,
  Clock,
  Zap,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface DecisionTrace {
  id: string;
  bot_id: string;
  trade_log_id: string | null;
  decision_type: string;
  reasoning: string;
  confidence_score: number | null;
  market_context: Record<string, unknown>;
  variables_snapshot: Record<string, unknown>;
  created_at: string;
  trace_id: string;
}

interface NoTradeTrace {
  id: string;
  bot_id: string;
  check_timestamp: string;
  suppression_reason: string;
  market_context: Record<string, unknown>;
  risk_state: Record<string, unknown>;
  would_have_signal: string | null;
  created_at: string;
  trace_id: string;
}

interface BotDecisionTracesProps {
  botId: string;
}

export function BotDecisionTraces({ botId }: BotDecisionTracesProps) {
  const [activeTab, setActiveTab] = useState<"decisions" | "suppressed">("decisions");
  const [selectedDecision, setSelectedDecision] = useState<DecisionTrace | null>(null);
  const [selectedNoTrade, setSelectedNoTrade] = useState<NoTradeTrace | null>(null);

  const { data: decisionsData, isLoading: decisionsLoading, isError: decisionsError, refetch: refetchDecisions } = useQuery<{
    success: boolean;
    data: DecisionTrace[];
    count: number;
    error?: string;
    trace_id: string;
  }>({
    queryKey: [`/api/bots/${botId}/decision-traces`],
  });

  const { data: noTradesData, isLoading: noTradesLoading, isError: noTradesError, refetch: refetchNoTrades } = useQuery<{
    success: boolean;
    data: NoTradeTrace[];
    count: number;
    error?: string;
    trace_id: string;
  }>({
    queryKey: [`/api/bots/${botId}/no-trade-traces`],
  });

  const decisionsSuccess = decisionsData?.success !== false && !decisionsError;
  const noTradesSuccess = noTradesData?.success !== false && !noTradesError;
  const decisions = decisionsSuccess && Array.isArray(decisionsData?.data) ? decisionsData.data : [];
  const noTrades = noTradesSuccess && Array.isArray(noTradesData?.data) ? noTradesData.data : [];
  const hasDecisionError = decisionsError || decisionsData?.success === false;
  const hasNoTradeError = noTradesError || noTradesData?.success === false;

  const getDecisionIcon = (type: string) => {
    switch (type) {
      case "LONG_ENTRY":
      case "BUY":
        return <TrendingUp className="w-3 h-3 text-profit" />;
      case "SHORT_ENTRY":
      case "SELL":
        return <TrendingDown className="w-3 h-3 text-loss" />;
      case "EXIT":
        return <XCircle className="w-3 h-3 text-muted-foreground" />;
      default:
        return <Zap className="w-3 h-3" />;
    }
  };

  const getSuppressionBadgeColor = (reason: string): "destructive" | "secondary" | "outline" => {
    if (reason.includes("RISK") || reason.includes("LIMIT")) return "destructive";
    if (reason.includes("FILTER") || reason.includes("TIME")) return "secondary";
    return "outline";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="w-4 h-4" />
          Decision Audit Trail
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            refetchDecisions();
            refetchNoTrades();
          }}
          data-testid="button-refresh-decision-traces"
        >
          <RefreshCw className="w-3 h-3" />
        </Button>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "decisions" | "suppressed")}>
          <TabsList className="w-full">
            <TabsTrigger value="decisions" className="flex-1">
              Why Traded
              {decisions.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">{decisions.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="suppressed" className="flex-1">
              Why Not
              {noTrades.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-xs">{noTrades.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="decisions" className="mt-3">
            {decisionsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : hasDecisionError ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                Unable to load decision traces. Check bot permissions.
              </div>
            ) : decisions.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                No decision traces recorded yet. Traces are logged when the bot makes trading decisions.
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {decisions.map((decision) => (
                    <div
                      key={decision.id}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded hover-elevate cursor-pointer"
                      onClick={() => setSelectedDecision(decision)}
                      data-testid={`row-decision-${decision.id}`}
                    >
                      <div className="flex items-center gap-2">
                        {getDecisionIcon(decision.decision_type)}
                        <div>
                          <div className="text-sm font-medium">{decision.decision_type}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-48">
                            {decision.reasoning.substring(0, 50)}...
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {decision.confidence_score && (
                          <Badge variant="outline" className="text-xs">
                            {Math.round(decision.confidence_score * 100)}%
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(decision.created_at), { addSuffix: true })}
                        </div>
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="suppressed" className="mt-3">
            {noTradesLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : hasNoTradeError ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                Unable to load suppression traces. Check bot permissions.
              </div>
            ) : noTrades.length === 0 ? (
              <div className="text-center text-muted-foreground py-6 text-sm">
                No suppressed trades recorded. Traces are logged when a potential signal is blocked.
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {noTrades.map((noTrade) => (
                    <div
                      key={noTrade.id}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded hover-elevate cursor-pointer"
                      onClick={() => setSelectedNoTrade(noTrade)}
                      data-testid={`row-notrade-${noTrade.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3 h-3 text-warning" />
                        <div>
                          <Badge variant={getSuppressionBadgeColor(noTrade.suppression_reason)} className="text-xs">
                            {noTrade.suppression_reason}
                          </Badge>
                          {noTrade.would_have_signal && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Would have: {noTrade.would_have_signal}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(noTrade.check_timestamp), { addSuffix: true })}
                        </div>
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <Dialog open={!!selectedDecision} onOpenChange={() => setSelectedDecision(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedDecision && getDecisionIcon(selectedDecision.decision_type)}
              Decision Details
            </DialogTitle>
          </DialogHeader>
          {selectedDecision && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Type</div>
                  <div className="font-medium">{selectedDecision.decision_type}</div>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Confidence</div>
                  <div className="font-medium">
                    {selectedDecision.confidence_score 
                      ? `${Math.round(selectedDecision.confidence_score * 100)}%`
                      : 'N/A'}
                  </div>
                </Card>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Reasoning</div>
                <div className="bg-muted/30 p-3 rounded text-sm">
                  {selectedDecision.reasoning}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Market Context</div>
                <ScrollArea className="h-32">
                  <pre className="bg-muted/30 p-2 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedDecision.market_context, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Variables Snapshot</div>
                <ScrollArea className="h-32">
                  <pre className="bg-muted/30 p-2 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedDecision.variables_snapshot, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                <span>Trace ID: {selectedDecision.trace_id}</span>
                <span>{new Date(selectedDecision.created_at).toLocaleString()}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedNoTrade} onOpenChange={() => setSelectedNoTrade(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-warning" />
              Suppressed Trade Details
            </DialogTitle>
          </DialogHeader>
          {selectedNoTrade && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Suppression Reason</div>
                  <Badge variant={getSuppressionBadgeColor(selectedNoTrade.suppression_reason)} className="mt-1">
                    {selectedNoTrade.suppression_reason}
                  </Badge>
                </Card>
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Would Have Signal</div>
                  <div className="font-medium mt-1">
                    {selectedNoTrade.would_have_signal || 'Unknown'}
                  </div>
                </Card>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Market Context</div>
                <ScrollArea className="h-32">
                  <pre className="bg-muted/30 p-2 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedNoTrade.market_context, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <div>
                <div className="text-sm font-medium mb-1">Risk State</div>
                <ScrollArea className="h-32">
                  <pre className="bg-muted/30 p-2 rounded text-xs overflow-auto">
                    {JSON.stringify(selectedNoTrade.risk_state, null, 2)}
                  </pre>
                </ScrollArea>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                <span>Trace ID: {selectedNoTrade.trace_id}</span>
                <span>{new Date(selectedNoTrade.check_timestamp).toLocaleString()}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
