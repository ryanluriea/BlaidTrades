import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DegradedBanner } from "@/components/ui/degraded-banner";
import { TrendingDown, TrendingUp, Clock, Target, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { useBotDemotions } from "@/hooks/useBotDemotions";
import { useBotImprovementState } from "@/hooks/useImprovementState";
import { usePromotionEvaluation } from "@/hooks/usePromotionEvaluations";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { BOT_STAGES, STAGE_ORDER } from "@/lib/constants";

interface RecoveryJourneyPanelProps {
  botId: string;
  currentStage: string;
}

function getStageIndex(stage: string): number {
  return STAGE_ORDER[stage as keyof typeof STAGE_ORDER] ?? -1;
}

export function RecoveryJourneyPanel({ botId, currentStage }: RecoveryJourneyPanelProps) {
  const { data: demotions, isLoading: demotionsLoading } = useBotDemotions(botId, 5);
  const { data: improvementState, isLoading: improvementLoading } = useBotImprovementState(botId);
  const { data: promotionEvalResult, isLoading: evalLoading } = usePromotionEvaluation(botId);

  const isLoading = demotionsLoading || improvementLoading || evalLoading;
  
  const promotionEval = promotionEvalResult?.data;
  const isPromotionDataDegraded = promotionEvalResult?.degraded ?? false;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            Recovery Journey
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Find most recent demotion
  const latestDemotion = demotions?.[0];
  const wasRecentlyDemoted = latestDemotion?.to_stage === currentStage;

  // No recovery journey if never demoted
  if (!latestDemotion || !wasRecentlyDemoted) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            No Demotions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            This bot has not been demoted recently. It's progressing normally through the stages.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Calculate recovery progress
  const targetStage = latestDemotion.from_stage;
  const currentIndex = getStageIndex(currentStage);
  const targetIndex = getStageIndex(targetStage);
  const stageGap = targetIndex - currentIndex;
  
  // Get gate progress from promotion evaluation (handle degraded)
  const gateProgress = !isPromotionDataDegraded ? (promotionEval?.progress_percent ?? 0) : 0;
  const gates = !isPromotionDataDegraded ? (promotionEval?.gates_json ?? {}) : {};
  const gateEntries = Object.entries(gates);
  const passedGates = gateEntries.filter(([, g]) => (g as any).pass).length;
  const totalGates = gateEntries.length;

  // Improvement state info
  const isImproving = improvementState?.status === 'IMPROVING';
  const attemptsMade = improvementState?.attempts_used ?? 0;
  const consecutiveFailures = improvementState?.consecutive_failures ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <RotateCcw className={cn("w-4 h-4", isImproving && "animate-spin text-amber-400")} style={{ animationDuration: "3s" }} />
          Recovery Journey
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Timeline header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
              <TrendingDown className="w-3 h-3 mr-1" />
              {currentStage}
            </Badge>
            <span className="text-xs text-muted-foreground">→</span>
            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
              <Target className="w-3 h-3 mr-1" />
              {targetStage}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {stageGap} stage{stageGap > 1 ? 's' : ''} to recover
          </span>
        </div>

        {/* Demotion reason card */}
        <div className="p-2 rounded-md bg-destructive/10 border border-destructive/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-destructive">
                Demoted: {latestDemotion.reason_code.replace(/_/g, ' ')}
              </p>
              {latestDemotion.reason_detail && (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {latestDemotion.reason_detail}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(latestDemotion.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>

        {/* Gate progress */}
        <div className="space-y-2">
          {isPromotionDataDegraded ? (
            <DegradedBanner
              message={promotionEvalResult?.message || "Gate progress unavailable"}
              error_code={promotionEvalResult?.error_code || undefined}
              trace_id={promotionEvalResult?.trace_id}
              compact
            />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Promotion Gates</span>
                <span className="font-medium">
                  {passedGates}/{totalGates} passed • {gateProgress.toFixed(0)}%
                </span>
              </div>
              <Progress value={gateProgress} className="h-2" />
            </>
          )}
          
          {/* Gate breakdown - show failing gates only */}
          {gateEntries.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {gateEntries
                .filter(([, g]) => !(g as any).pass)
                .slice(0, 4) // Show max 4 failing gates
                .map(([key, gate]) => {
                  const g = gate as { value: number; required: number; pass: boolean; label: string };
                  return (
                    <div
                      key={key}
                      className="p-1.5 rounded bg-muted/50 flex items-center justify-between"
                    >
                      <span className="text-[10px] text-muted-foreground truncate">
                        {g.label || key}
                      </span>
                      <span className="text-[10px] text-red-400 font-mono">
                        {typeof g.value === 'number' ? g.value.toFixed(1) : g.value}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Improvement status */}
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
          <div className="flex items-center gap-2">
            {isImproving ? (
              <>
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-xs text-amber-400">Actively improving</span>
              </>
            ) : improvementState?.status === 'PAUSED' ? (
              <>
                <div className="w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-xs text-yellow-400">Improvement paused</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                <span className="text-xs text-muted-foreground">Idle</span>
              </>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {attemptsMade} attempts • {consecutiveFailures} failures
          </span>
        </div>

        {/* Demotion history (if multiple) */}
        {demotions && demotions.length > 1 && (
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground mb-1.5">Previous demotions:</p>
            <div className="space-y-1">
              {demotions.slice(1, 3).map((d) => (
                <div key={d.id} className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    {d.from_stage} → {d.to_stage}
                  </span>
                  <span className="text-muted-foreground/70">
                    {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
