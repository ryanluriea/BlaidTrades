import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBots } from "@/hooks/useBots";
import { useSystemEvents } from "@/hooks/useTrading";
import { useGraduationEvaluate, useRebalancePortfolio, usePromotionLogs } from "@/hooks/useEvolution";
import { ArchetypeCertificationPanel } from "@/components/training/ArchetypeCertificationPanel";
import { FleetActivityPanel } from "@/components/training/FleetActivityPanel";
import { 
  GraduationCap,
  TrendingUp,
  Zap,
  RefreshCw,
  CheckCircle,
  Loader2,
  Scale,
  Clock,
  Play,
} from "lucide-react";

export function PipelineTab() {
  const { data: bots = [], isLoading: botsLoading } = useBots();
  const { data: systemEvents = [] } = useSystemEvents();
  const { data: promotionLogs = [] } = usePromotionLogs();
  const graduationEvaluate = useGraduationEvaluate();
  const rebalancePortfolio = useRebalancePortfolio();

  // Calculate stats by STAGE (not mode) - using the new stage column
  const botsByStage = {
    TRIALS: bots.filter(b => b.stage === 'TRIALS' || b.mode === 'BACKTEST_ONLY').length,
    PAPER: bots.filter(b => b.stage === 'PAPER' || b.mode === 'SIM_LIVE').length,
    SHADOW: bots.filter(b => b.stage === 'SHADOW' || b.mode === 'SHADOW').length,
    LIVE: bots.filter(b => b.stage === 'LIVE' || b.mode === 'LIVE').length,
  };

  const totalBots = bots.length;
  const promotedThisWeek = promotionLogs.filter(
    p => p.allowed && new Date(p.created_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  ).length;

  const evolutionEvents = systemEvents.filter(e => 
    e.event_type === 'evolution_generated' || 
    e.event_type === 'promotion_evaluation' ||
    e.event_type === 'graduation_evaluation'
  );

  // Fixed stage labels: TRIALS / PAPER / SHADOW / LIVE
  const graduationLadder = [
    { stage: "TRIALS", count: botsByStage.TRIALS, label: "Trials" },
    { stage: "PAPER", count: botsByStage.PAPER, label: "Paper" },
    { stage: "SHADOW", count: botsByStage.SHADOW, label: "Shadow" },
    { stage: "LIVE", count: botsByStage.LIVE, label: "Live" },
  ];

  if (botsLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - Mobile optimized */}
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Evolution and graduation pipeline
        </p>
        <div className="flex gap-2">
          <Button 
            variant="outline"
            size="sm"
            onClick={() => graduationEvaluate.mutate(undefined)}
            disabled={graduationEvaluate.isPending}
            className="flex-1"
          >
            {graduationEvaluate.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <GraduationCap className="w-4 h-4 mr-1.5" />}
            Evaluate
          </Button>
          <Button 
            variant="outline"
            size="sm"
            onClick={() => rebalancePortfolio.mutate({ maxPerBot: 25 })}
            disabled={rebalancePortfolio.isPending}
            className="flex-1"
          >
            {rebalancePortfolio.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Scale className="w-4 h-4 mr-1.5" />}
            Rebalance
          </Button>
        </div>
      </div>

      {/* Scheduler Status Chip */}
      <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-profit animate-pulse" />
          <span className="font-medium">Scheduler</span>
          <Badge variant="outline" className="text-[10px] h-5">ON</Badge>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>Next: in 4m 32s</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Play className="w-3 h-3" />
          <span>Queue: 0</span>
        </div>
      </div>

      {/* Stats - 2x2 grid on mobile */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <GraduationCap className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold font-mono">{totalBots}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-warning/10">
              <Zap className="w-4 h-4 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Paper/Shadow</p>
              <p className="text-lg font-bold font-mono">{botsByStage.PAPER + botsByStage.SHADOW}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-profit/10">
              <TrendingUp className="w-4 h-4 text-profit" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Promoted</p>
              <p className="text-lg font-bold font-mono">{promotedThisWeek}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-profit/10">
              <CheckCircle className="w-4 h-4 text-profit" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Live</p>
              <p className="text-lg font-bold font-mono">{botsByStage.LIVE}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Graduation Ladder - Full width on mobile */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">Graduation Ladder</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="space-y-3">
            {graduationLadder.map((stage) => (
              <div key={stage.stage} className="flex items-center gap-2">
                <div className="w-16 text-xs text-muted-foreground font-medium">{stage.label}</div>
                <div className="flex-1">
                  <Progress 
                    value={totalBots > 0 ? (stage.count / totalBots) * 100 : 0} 
                    className="h-2"
                  />
                </div>
                <div className="w-6 text-right font-mono text-sm font-bold">{stage.count}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted/50 text-xs">
            <h4 className="font-medium mb-2">Promotion Rules</h4>
            <ul className="text-muted-foreground space-y-1">
              <li className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-profit mt-0.5 flex-shrink-0" />
                <span>TRIALS→PAPER: 20+ trades, 45%+ win, PF {">"} 1.1</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-profit mt-0.5 flex-shrink-0" />
                <span>PAPER→SHADOW: 50+ trades, 48%+ win, 5+ days</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle className="w-3 h-3 text-warning mt-0.5 flex-shrink-0" />
                <span>SHADOW→LIVE: 100+ trades, manual approval</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Evolution Activity */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">Evolution Activity</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          {evolutionEvents.length > 0 ? (
            <div className="space-y-2">
              {evolutionEvents.slice(0, 4).map((event) => (
                <div 
                  key={event.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-muted/30"
                >
                  {event.event_type === 'promotion_evaluation' ? (
                    <TrendingUp className="w-4 h-4 text-profit mt-0.5 flex-shrink-0" />
                  ) : event.event_type === 'graduation_evaluation' ? (
                    <GraduationCap className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  ) : (
                    <Zap className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{event.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{event.message}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No activity yet</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fleet Activity Panel */}
      <FleetActivityPanel />

      {/* Archetype Certification Panel */}
      <ArchetypeCertificationPanel />
    </div>
  );
}
