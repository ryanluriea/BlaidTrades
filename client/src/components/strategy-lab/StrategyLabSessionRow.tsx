import { useState } from "react";
import { 
  ChevronDown, ChevronRight, Play, Pause, Square, Compass, Globe, Lock, Zap,
  Clock, DollarSign, Microscope, CheckCircle2, XCircle, RefreshCw, Brain,
  Target, Award, BarChart3, BookOpen, ExternalLink, Dna, Users, TrendingUp
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { 
  useStrategyLabSession,
  useSessionControl,
  useExportCandidate,
  computeCostStats,
  type StrategyLabSession 
} from "@/hooks/useStrategyLab";
import { useGeneticsPool, useRunGeneticsGeneration } from "@/hooks/useGeneticsSession";
import { StrategyLabAICostBadge } from "@/components/bots/views/StrategyLabAICostBar";
import { StrategyCandidateList } from "@/components/strategy-lab";
import { SessionNameEdit } from "./SessionNameEdit";

interface StrategyLabSessionRowProps {
  session: StrategyLabSession;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ago`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ago`;
  return `${Math.floor(diffSecs / 86400)}d ago`;
}

const STATUS_CONFIG: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
  IDLE: { color: "bg-muted text-muted-foreground", icon: Clock },
  RUNNING: { color: "bg-blue-500/20 text-blue-400", icon: RefreshCw },
  PAUSED: { color: "bg-amber-500/20 text-amber-400", icon: Pause },
  COMPLETED: { color: "bg-emerald-500/20 text-emerald-400", icon: CheckCircle2 },
  FAILED: { color: "bg-destructive/20 text-destructive", icon: XCircle },
  DRAFT: { color: "bg-muted text-muted-foreground", icon: Microscope },
};

export function StrategyLabSessionRow({ session, isExpanded, onToggleExpanded }: StrategyLabSessionRowProps) {
  const { data: sessionData, isLoading } = useStrategyLabSession(isExpanded ? session.id : null);
  const { data: geneticsPool } = useGeneticsPool(isExpanded && session.session_mode === 'GENETICS' ? session.id : null);
  const sessionControl = useSessionControl();
  const exportCandidate = useExportCandidate();
  const runGeneration = useRunGeneticsGeneration();

  const statusConfig = STATUS_CONFIG[session.status] || STATUS_CONFIG.IDLE;
  const StatusIcon = statusConfig.icon;
  const isRunning = session.status === 'RUNNING';
  const isPaused = session.status === 'PAUSED';
  const isGenetics = session.session_mode === 'GENETICS';

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    const action = isRunning ? 'PAUSE' : 'PLAY';
    sessionControl.mutate({ session_id: session.id, action });
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    sessionControl.mutate({ session_id: session.id, action: 'STOP' });
  };

  const handleExport = (candidateId: string) => {
    exportCandidate.mutate({ session_id: session.id, candidate_id: candidateId });
  };

  const handleRunGeneration = (e: React.MouseEvent) => {
    e.stopPropagation();
    runGeneration.mutate({ session_id: session.id, generations: 1 });
  };

  const costStats = computeCostStats(sessionData?.costs);
  const candidatesCount = sessionData?.candidates?.length || 0;
  const tasksCompleted = sessionData?.tasks?.filter(t => t.status === 'SUCCEEDED').length || 0;
  const totalTasks = sessionData?.tasks?.length || 0;

  return (
    <Card className={cn("transition-colors", isExpanded && "border-primary/50")}>
      {/* Row Header - Always Visible */}
      <div
        onClick={onToggleExpanded}
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
      >
        {/* Expand Icon */}
        <div className="flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
        </div>

        {/* Session Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <SessionNameEdit 
              sessionId={session.id} 
              currentName={session.name} 
            />
            {isGenetics && (
              <Badge variant="outline" className="text-[9px] h-4 gap-0.5 border-emerald-500/50 text-emerald-500 bg-emerald-500/10">
                <Dna className="h-2.5 w-2.5" />
                Genetics
              </Badge>
            )}
            <Badge variant="outline" className={cn("text-[9px] h-4 gap-0.5", statusConfig.color)}>
              <StatusIcon className={cn("h-2.5 w-2.5", isRunning && "animate-spin")} />
              {session.status}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {isGenetics && session.current_generation > 0 && (
              <Badge variant="secondary" className="text-[9px] h-4 gap-0.5 bg-emerald-500/10 text-emerald-500">
                Gen {session.current_generation}
              </Badge>
            )}
            {session.discovery_enabled ? (
              <>
                <Badge variant="secondary" className="text-[9px] h-4 gap-0.5">
                  <Compass className="h-2.5 w-2.5" />
                  Discovery
                </Badge>
                <Badge variant="outline" className="text-[9px] h-4">{session.universe || 'CME'}</Badge>
              </>
            ) : (
              <>
                <Badge variant="outline" className="text-[9px] h-4">{session.symbol}</Badge>
              </>
            )}
            <Badge variant="outline" className="text-[9px] h-4">
              {session.research_mode === 'OPEN' && <Globe className="h-2.5 w-2.5 mr-0.5" />}
              {session.research_mode === 'CLOSED' && <Lock className="h-2.5 w-2.5 mr-0.5" />}
              {session.research_mode === 'HYBRID' && <Zap className="h-2.5 w-2.5 mr-0.5" />}
              {session.research_mode}
            </Badge>
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
          {isGenetics && geneticsPool && (
            <span className="flex items-center gap-1 text-emerald-500">
              <Users className="h-3 w-3" />
              {geneticsPool.pool_size}
            </span>
          )}
          {session.best_fitness_ever && (
            <span className="flex items-center gap-1 text-emerald-400">
              <TrendingUp className="h-3 w-3" />
              {session.best_fitness_ever.toFixed(1)}
            </span>
          )}
          {session.total_ai_cost_usd > 0 && (
            <Badge variant="outline" className="text-[10px] h-5 gap-1 border-emerald-500/30">
              <Brain className="h-3 w-3 text-emerald-400" />
              ${session.total_ai_cost_usd.toFixed(2)}
            </Badge>
          )}
          {session.last_activity_at && (
            <span>{formatTimeAgo(session.last_activity_at)}</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {isGenetics && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] px-2"
              onClick={handleRunGeneration}
              disabled={runGeneration.isPending || isRunning}
            >
              <Dna className="h-3 w-3 mr-1" />
              Cycle
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handlePlayPause}
            disabled={sessionControl.isPending}
          >
            {isRunning ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
          {(isRunning || isPaused) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleStop}
              disabled={sessionControl.isPending}
            >
              <Square className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Running Step Indicator */}
      {isRunning && session.current_step && !isExpanded && (
        <div className="px-3 pb-2 -mt-1">
          <p className="text-[10px] text-blue-400 truncate animate-pulse pl-7">
            → {session.current_step.replace(/_/g, ' ')}
          </p>
        </div>
      )}

      {/* Expanded Details */}
      {isExpanded && (
        <CardContent className="pt-0 pb-3 px-3">
          <div className="border-t border-border pt-3 space-y-3">
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : sessionData ? (
              <>
                {/* Quick Stats Row */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-muted/30 rounded p-2 text-center">
                    <p className="text-lg font-bold">{candidatesCount}</p>
                    <p className="text-[10px] text-muted-foreground">Candidates</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2 text-center">
                    <p className="text-lg font-bold">{tasksCompleted}/{totalTasks}</p>
                    <p className="text-[10px] text-muted-foreground">Tasks</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2 text-center">
                    <p className="text-lg font-bold">{sessionData.sources?.length || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Sources</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2 text-center">
                    <p className="text-lg font-bold text-emerald-400">
                      ${costStats.totalCost.toFixed(2)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Cost</p>
                  </div>
                </div>

                {/* Current Step */}
                {isRunning && sessionData.session.current_step && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />
                      <span className="text-xs text-blue-400">
                        {sessionData.session.current_step.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                )}

                {/* AI Cost Breakdown */}
                {costStats.totalCost > 0 && (
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-[10px] text-muted-foreground mb-1.5">AI Costs by Provider</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(costStats.byProvider).map(([provider, data]) => (
                        data.cost > 0 && (
                          <Badge key={provider} variant="outline" className="text-[9px] h-5">
                            {provider}: ${data.cost.toFixed(3)}
                          </Badge>
                        )
                      ))}
                    </div>
                  </div>
                )}

                {/* Candidates */}
                {sessionData.candidates && sessionData.candidates.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5" />
                      Strategy Candidates
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                      {sessionData.candidates.slice(0, 8).map((candidate) => (
                        <div 
                          key={candidate.id}
                          className="bg-muted/30 rounded p-2 aspect-square flex flex-col items-center justify-center text-center cursor-pointer hover:bg-muted/50 transition-colors group relative"
                          onClick={() => handleExport(candidate.id)}
                        >
                          <Badge variant="outline" className="text-[8px] h-4 mb-1">
                            {candidate.blueprint?.symbol_candidates?.[0] || '—'}
                          </Badge>
                          <p className="text-[10px] font-medium leading-tight line-clamp-2">
                            {candidate.name || candidate.blueprint?.name || 'Unnamed'}
                          </p>
                          {candidate.scores?.viability_score && (
                            <p className="text-[9px] text-emerald-400 mt-1">
                              {Math.round(candidate.scores.viability_score)}%
                            </p>
                          )}
                          <ExternalLink className="h-3 w-3 absolute top-1 right-1 opacity-0 group-hover:opacity-50 transition-opacity" />
                        </div>
                      ))}
                      {sessionData.candidates.length > 8 && (
                        <div className="bg-muted/20 rounded aspect-square flex items-center justify-center">
                          <span className="text-[10px] text-muted-foreground">
                            +{sessionData.candidates.length - 8}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Recent Tasks */}
                {sessionData.tasks && sessionData.tasks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Recent Tasks
                    </p>
                    <div className="space-y-1">
                      {sessionData.tasks.slice(0, 4).map((task) => (
                        <div 
                          key={task.id}
                          className="flex items-center gap-2 text-[11px]"
                        >
                          {task.status === 'SUCCEEDED' && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                          {task.status === 'RUNNING' && <RefreshCw className="h-3 w-3 text-blue-400 animate-spin" />}
                          {task.status === 'FAILED' && <XCircle className="h-3 w-3 text-destructive" />}
                          {task.status === 'QUEUED' && <Clock className="h-3 w-3 text-muted-foreground" />}
                          {task.status === 'CANCELED' && <XCircle className="h-3 w-3 text-muted-foreground" />}
                          <span className="truncate flex-1">{task.task_type.replace(/_/g, ' ')}</span>
                          <Badge variant="outline" className={cn(
                            "text-[9px] h-4",
                            task.status === 'SUCCEEDED' && "bg-emerald-500/20 text-emerald-400",
                            task.status === 'RUNNING' && "bg-blue-500/20 text-blue-400",
                            task.status === 'FAILED' && "bg-destructive/20 text-destructive"
                          )}>
                            {task.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources Summary */}
                {sessionData.sources && sessionData.sources.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5" />
                      Research Sources ({sessionData.sources.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {sessionData.sources.slice(0, 6).map((source) => (
                        <Badge key={source.id} variant="outline" className="text-[9px] h-5 max-w-[120px] truncate">
                          {source.title || source.url?.slice(0, 30)}
                        </Badge>
                      ))}
                      {sessionData.sources.length > 6 && (
                        <Badge variant="secondary" className="text-[9px] h-5">
                          +{sessionData.sources.length - 6} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                Failed to load session details
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
