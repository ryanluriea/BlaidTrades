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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  Bot,
  Route
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import http from "@/lib/http";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTradeDecisionTrace } from "@/hooks/useTradeDecisionTrace";

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

interface WhyDrawerProps {
  botId: string;
  botName: string;
}

export function WhyDrawer({ botId, botName }: WhyDrawerProps) {
  const [open, setOpen] = useState(false);

  const { data: decisions, isLoading } = useQuery({
    queryKey: ["arbiter_decisions", botId],
    queryFn: async (): Promise<ArbiterDecision[]> => {
      // Use Express API for arbiter decisions
      const response = await http.get<any>(`/api/bots/${botId}/arbiter-decisions`);
      if (!response.ok || !response.data) return [];
      return response.data as ArbiterDecision[];
    },
    enabled: open,
  });

  // Also fetch trade decision traces for source attribution
  const { data: traces } = useQuery({
    queryKey: ["trade_decision_traces", botId],
    queryFn: async () => {
      // Use Express API for decision traces
      const response = await http.get<any>(`/api/bots/${botId}/decision-traces`);
      if (!response.ok || !response.data) return [];
      return response.data;
    },
    enabled: open,
  });

  // Fetch trade decision sources for each trace
  const { data: sources } = useQuery({
    queryKey: ["trade_decision_sources", botId],
    queryFn: async () => {
      // Use Express API for decision sources
      const response = await http.get<any>(`/api/bots/${botId}/decision-sources`);
      if (!response.ok || !response.data) return [];
      return response.data;
    },
    enabled: open,
  });

  const executedCount = decisions?.filter(d => d.decision === "EXECUTED").length ?? 0;
  const blockedCount = decisions?.filter(d => d.decision === "BLOCKED").length ?? 0;

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
          Why did this bot trade?
        </TooltipContent>
      </Tooltip>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Why did {botName} trade?
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4 pr-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading decisions...</div>
          ) : decisions?.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-2 mb-4">
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
              
              {/* Trade Decision Traces Section */}
              {traces && traces.length > 0 && (
                <Card className="bg-primary/5 border-primary/20 mb-4">
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
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function EmptyState() {
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
          {/* Routing */}
          <div className="text-xs">
            <span className="text-muted-foreground">Routing: </span>
            <Badge variant={trace.routing_result === "BROKER_FILLS" ? "default" : "secondary"} className="text-[9px]">
              {trace.routing_result}
            </Badge>
          </div>
          
          {/* Metrics */}
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
          
          {/* Sources Used */}
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
          
          {/* Reason Codes */}
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
  const signalSnapshot = decision.signal_snapshot_json || {};

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
        {/* Priority & Candidate Scores */}
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

        {/* Reason Codes */}
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

        {/* Competing Bots */}
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

        {/* Risk Snapshot */}
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

        {/* Execution Route */}
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
