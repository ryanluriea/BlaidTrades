import { useState } from "react";
import { 
  Sparkles, 
  Play, 
  Pause, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  ChevronDown,
  ChevronRight,
  Dna,
  Trophy,
  GitBranch
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  useBotImprovementState, 
  useBotBacktestFailures, 
  useBotMutationEvents,
  useBotTournaments,
  useToggleImprovement,
  useForceEvolve,
} from "@/hooks/useImprovementState";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

interface BotEvolutionPanelProps {
  botId: string;
}

const FAILURE_CATEGORY_CONFIG: Record<string, { color: string; icon: typeof AlertTriangle; description: string }> = {
  PASS: { color: 'text-green-500', icon: CheckCircle, description: 'Backtest passed all gates' },
  NO_TRADES: { color: 'text-yellow-500', icon: AlertTriangle, description: 'Strategy never triggered' },
  OVERTRADING: { color: 'text-orange-500', icon: AlertTriangle, description: 'Too many trades / too frequent' },
  LOSS_DOMINATED: { color: 'text-red-500', icon: XCircle, description: 'Negative expectancy or low PF' },
  DRAWDOWN_BREACH: { color: 'text-red-500', icon: XCircle, description: 'Max drawdown exceeded threshold' },
  SLIPPAGE_SENSITIVITY: { color: 'text-yellow-500', icon: AlertTriangle, description: 'Edge disappears with costs' },
  REGIME_FRAGILE: { color: 'text-orange-500', icon: AlertTriangle, description: 'Works only in one market regime' },
  DATA_GAP: { color: 'text-blue-500', icon: AlertTriangle, description: 'Provider/instrument mismatch' },
  EXECUTION_RULE_BREACH: { color: 'text-red-500', icon: XCircle, description: 'Risk engine blocks constantly' },
};

export function BotEvolutionPanel({ botId }: BotEvolutionPanelProps) {
  const { data: state, isLoading: stateLoading } = useBotImprovementState(botId);
  const { data: failures, isLoading: failuresLoading } = useBotBacktestFailures(botId, 10);
  const { data: mutations, isLoading: mutationsLoading } = useBotMutationEvents(botId, 10);
  const { data: tournaments, isLoading: tournamentsLoading } = useBotTournaments(botId, 5);
  
  const toggleMutation = useToggleImprovement();
  const evolveMutation = useForceEvolve();

  const [failuresOpen, setFailuresOpen] = useState(true);
  const [mutationsOpen, setMutationsOpen] = useState(false);
  const [tournamentsOpen, setTournamentsOpen] = useState(false);

  if (stateLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isPaused = state?.status === 'PAUSED';
  const isImproving = state?.status === 'IMPROVING';
  const isReady = state?.status === 'GRADUATED_READY';
  const attemptsProgress = state ? (state.attempts_used / state.attempts_limit) * 100 : 0;

  const handleTogglePause = () => {
    toggleMutation.mutate({ botId, pause: !isPaused });
  };

  const handleForceEvolve = () => {
    evolveMutation.mutate({ botId, failureCategory: state?.last_failure_category || undefined });
  };

  return (
    <div className="space-y-3">
      {/* Status Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Improvement Loop
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={isPaused ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={handleTogglePause}
                disabled={toggleMutation.isPending}
              >
                {isPaused ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                {isPaused ? "Resume" : "Pause"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={handleForceEvolve}
                disabled={evolveMutation.isPending || isPaused}
              >
                <Dna className="h-3 w-3 mr-1" />
                {evolveMutation.isPending ? "Evolving..." : "Force Evolve"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status Badge */}
          <div className="flex items-center gap-3">
            <Badge 
              variant="outline"
              className={cn(
                "text-xs",
                isImproving && "bg-blue-500/20 text-blue-400 border-blue-500/30",
                isPaused && "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
                isReady && "bg-green-500/20 text-green-400 border-green-500/30",
              )}
            >
              {state?.status || 'IDLE'}
            </Badge>
            {state?.last_failure_category && (
              <span className="text-xs text-muted-foreground">
                Last: <span className="font-mono">{state.last_failure_category}</span>
              </span>
            )}
          </div>

          {/* Attempts Progress */}
          {state && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Attempts Used</span>
                <span className="font-mono">{state.attempts_used} / {state.attempts_limit}</span>
              </div>
              <Progress value={attemptsProgress} className="h-2" />
            </div>
          )}

          {/* Next Action */}
          {state?.next_action && (
            <p className="text-xs text-muted-foreground">
              Next action: <span className="font-medium">{state.next_action.replace(/_/g, ' ')}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Backtest Failures */}
      <Collapsible open={failuresOpen} onOpenChange={setFailuresOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Backtest Outcomes
                  {failures && (
                    <Badge variant="secondary" className="text-[10px]">{failures.length}</Badge>
                  )}
                </div>
                {failuresOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {failuresLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : failures && failures.length > 0 ? (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {failures.map((failure) => {
                      const config = FAILURE_CATEGORY_CONFIG[failure.failure_category] || {
                        color: 'text-muted-foreground',
                        icon: AlertTriangle,
                        description: failure.failure_category,
                      };
                      const Icon = config.icon;
                      
                      return (
                        <div
                          key={failure.id}
                          className="p-2 rounded-lg border bg-muted/30 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon className={cn("h-3.5 w-3.5", config.color)} />
                              <span className={cn("font-medium", config.color)}>
                                {failure.failure_category}
                              </span>
                            </div>
                            <span className="text-muted-foreground text-[10px]">
                              {formatDistanceToNow(new Date(failure.created_at), { addSuffix: true })}
                            </span>
                          </div>
                          <p className="text-muted-foreground mt-1">{config.description}</p>
                          {failure.evidence_json && (
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground grid grid-cols-3 gap-2">
                              {failure.evidence_json.trades !== undefined && (
                                <span>Trades: {failure.evidence_json.trades}</span>
                              )}
                              {failure.evidence_json.profit_factor !== undefined && (
                                <span>PF: {failure.evidence_json.profit_factor?.toFixed(2)}</span>
                              )}
                              {failure.evidence_json.max_drawdown_pct !== undefined && (
                                <span>DD: {failure.evidence_json.max_drawdown_pct?.toFixed(1)}%</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No backtest outcomes recorded yet
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Mutation Events */}
      <Collapsible open={mutationsOpen} onOpenChange={setMutationsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Mutations Applied
                  {mutations && (
                    <Badge variant="secondary" className="text-[10px]">{mutations.length}</Badge>
                  )}
                </div>
                {mutationsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {mutationsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : mutations && mutations.length > 0 ? (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {mutations.map((mutation) => (
                      <div
                        key={mutation.id}
                        className="p-2 rounded-lg border bg-muted/30 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-primary">
                            {mutation.mutation_plan.replace(/_/g, ' ')}
                          </span>
                          <span className="text-muted-foreground text-[10px]">
                            {formatDistanceToNow(new Date(mutation.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1">
                          Triggered by: <span className="font-mono">{mutation.failure_category}</span>
                        </p>
                        {mutation.diff_json && Object.keys(mutation.diff_json).length > 0 && (
                          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                            Changes: {Object.entries(mutation.diff_json).map(([key, value]) => (
                              <span key={key} className="mr-2">
                                {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No mutations applied yet
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Tournaments */}
      <Collapsible open={tournamentsOpen} onOpenChange={setTournamentsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 cursor-pointer hover:bg-muted/50 transition-colors">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4" />
                  Evolution Tournaments
                  {tournaments && (
                    <Badge variant="secondary" className="text-[10px]">{tournaments.length}</Badge>
                  )}
                </div>
                {tournamentsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {tournamentsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : tournaments && tournaments.length > 0 ? (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {tournaments.map((tournament) => (
                      <div
                        key={tournament.id}
                        className="p-2 rounded-lg border bg-muted/30 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <Badge 
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              tournament.status === 'COMPLETED' && "bg-green-500/20 text-green-400",
                              tournament.status === 'RUNNING' && "bg-blue-500/20 text-blue-400",
                              tournament.status === 'FAILED' && "bg-red-500/20 text-red-400",
                            )}
                          >
                            {tournament.status}
                          </Badge>
                          <span className="text-muted-foreground text-[10px]">
                            {formatDistanceToNow(new Date(tournament.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {tournament.status === 'COMPLETED' && tournament.improvement_delta !== null && (
                          <p className="mt-1">
                            <span className="text-muted-foreground">Improvement: </span>
                            <span className={cn(
                              "font-mono font-medium",
                              tournament.improvement_delta > 0 ? "text-green-500" : "text-red-500"
                            )}>
                              {tournament.improvement_delta > 0 ? '+' : ''}{(tournament.improvement_delta * 100).toFixed(1)}%
                            </span>
                          </p>
                        )}
                        {tournament.scores_json && Object.keys(tournament.scores_json).length > 0 && (
                          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                            Best score: {Math.max(...(Object.values(tournament.scores_json) as number[])).toFixed(2)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No tournaments run yet
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
