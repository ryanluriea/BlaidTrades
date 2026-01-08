import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemEvents } from "@/hooks/useTrading";
import { usePromotionLogs } from "@/hooks/useEvolution";
import { useBots } from "@/hooks/useBots";
import { useRecentArbiterDecisions } from "@/hooks/useArbiterDecisions";
import { formatDistanceToNow } from "date-fns";
import { 
  GraduationCap,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ShieldAlert,
  TestTube,
  CheckCircle,
  XCircle,
  Minus,
  FileText,
  Zap,
  HelpCircle,
} from "lucide-react";

export function RunsLogsTab() {
  const { data: systemEvents = [], isLoading: eventsLoading } = useSystemEvents(50);
  const { data: promotionLogs = [], isLoading: promoLoading } = usePromotionLogs();
  const { data: bots = [] } = useBots();
  const { data: arbiterDecisions = [], isLoading: arbiterLoading } = useRecentArbiterDecisions({ limit: 20 });

  const botNameMap = new Map(bots.map(b => [b.id, b.name]));

  // Filter relevant events
  const evaluationEvents = systemEvents.filter(e => 
    e.event_type === 'graduation_evaluation' ||
    e.event_type === 'promotion_evaluation'
  );

  const backtestEvents = systemEvents.filter(e => 
    e.event_type === 'backtest_started' ||
    e.event_type === 'backtest_completed' ||
    e.event_type === 'backtest_failed'
  );

  const riskEvents = systemEvents.filter(e => 
    e.event_type === 'risk_block' ||
    e.event_type === 'daily_loss_exceeded' ||
    e.event_type === 'exposure_exceeded'
  );

  // Split arbiter decisions
  const blockedDecisions = arbiterDecisions.filter(d => d.decision === 'BLOCKED');
  const executedDecisions = arbiterDecisions.filter(d => d.decision === 'EXECUTED');

  const isLoading = eventsLoading || promoLoading || arbiterLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Evaluation Runs */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="w-4 h-4" />
            Evaluation Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {promotionLogs.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {promotionLogs.slice(0, 10).map((log) => (
                <div 
                  key={log.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 text-xs"
                >
                  {log.allowed ? (
                    <TrendingUp className="w-4 h-4 text-profit mt-0.5 flex-shrink-0" />
                  ) : (
                    <Minus className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {botNameMap.get(log.entity_id) || log.entity_id.slice(0, 8)}
                      </span>
                      <Badge variant={log.allowed ? "default" : "secondary"} className="text-[10px] h-4">
                        {log.allowed ? "PROMOTE" : "KEEP"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground truncate">
                      {log.from_mode} → {log.to_mode}
                    </p>
                  </div>
                  <span className="text-muted-foreground flex-shrink-0">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={GraduationCap} message="No evaluation runs yet" />
          )}
        </CardContent>
      </Card>

      {/* Backtest Jobs */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <TestTube className="w-4 h-4" />
            Backtest Jobs
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {backtestEvents.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {backtestEvents.slice(0, 10).map((event) => (
                <div 
                  key={event.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 text-xs"
                >
                  {event.event_type === 'backtest_completed' ? (
                    <CheckCircle className="w-4 h-4 text-profit mt-0.5 flex-shrink-0" />
                  ) : event.event_type === 'backtest_failed' ? (
                    <XCircle className="w-4 h-4 text-loss mt-0.5 flex-shrink-0" />
                  ) : (
                    <TestTube className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{event.title}</p>
                    <p className="text-muted-foreground truncate">{event.message}</p>
                  </div>
                  <span className="text-muted-foreground flex-shrink-0">
                    {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={TestTube} message="No backtest jobs recorded" />
          )}
        </CardContent>
      </Card>

      {/* Arbiter Decisions - Blocked */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Arbitration Blocks
            {blockedDecisions.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {blockedDecisions.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {blockedDecisions.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {blockedDecisions.slice(0, 10).map((decision) => (
                <div 
                  key={decision.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/10 text-xs"
                >
                  <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {decision.bots?.name || decision.bot_id.slice(0, 8)}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground font-mono">{decision.symbol}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {decision.reason_codes.slice(0, 3).map((code, i) => (
                        <Badge key={i} variant="secondary" className="text-[9px] h-4 font-mono">
                          {code.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end flex-shrink-0">
                    <span className="font-mono text-muted-foreground text-[10px]">
                      Score: {decision.priority_score.toFixed(0)}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {formatDistanceToNow(new Date(decision.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={AlertTriangle} message="No arbiter blocks — all trades passing" />
          )}
        </CardContent>
      </Card>

      {/* Arbiter Decisions - Executed (Why did they trade?) */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <HelpCircle className="w-4 h-4" />
            Trade Decisions
            {executedDecisions.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {executedDecisions.length} executed
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {executedDecisions.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {executedDecisions.slice(0, 10).map((decision) => (
                <div 
                  key={decision.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-xs"
                >
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {decision.bots?.name || decision.bot_id.slice(0, 8)}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground font-mono">{decision.symbol}</span>
                      {decision.contracts_allocated && (
                        <Badge variant="outline" className="text-[9px] h-4">
                          {decision.contracts_allocated} contracts
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-muted-foreground">
                        Priority: <span className="font-mono">{decision.priority_score.toFixed(0)}</span>
                      </span>
                      {decision.execution_route && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground font-mono text-[10px]">
                            {decision.execution_route}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-muted-foreground flex-shrink-0 text-[10px]">
                    {formatDistanceToNow(new Date(decision.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Zap} message="No trade decisions recorded yet" />
          )}
        </CardContent>
      </Card>

      {/* Risk Blocks */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Risk Blocks
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {riskEvents.length > 0 ? (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {riskEvents.slice(0, 10).map((event) => (
                <div 
                  key={event.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 text-xs"
                >
                  <ShieldAlert className="w-4 h-4 text-loss mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{event.title}</p>
                    <p className="text-muted-foreground truncate">{event.message}</p>
                  </div>
                  <Badge variant="destructive" className="text-[10px] h-4 flex-shrink-0">
                    {event.severity}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={ShieldAlert} message="No risk blocks — within limits" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="text-center py-6 text-muted-foreground">
      <Icon className="w-6 h-6 mx-auto mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
