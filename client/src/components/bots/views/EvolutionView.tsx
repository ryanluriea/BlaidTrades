import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Sparkles, 
  Pause, 
  CheckCircle, 
  Clock, 
  AlertTriangle,
  Play,
  TrendingUp,
  FlaskConical,
  Trophy,
  RefreshCw,
  Activity,
  BarChart3,
  Timer
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBotsOverview } from "@/hooks/useBotsOverview";
import { useToggleImprovement, useForceEvolve } from "@/hooks/useImprovementState";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { DegradedBanner } from "@/components/ui/degraded-banner";

/**
 * EvolutionView - Uses ONLY useBotsOverview for bot data (NO per-bot REST calls)
 * 
 * Improvement state actions still use mutations but data comes from overview.
 */

const statusConfig = {
  IMPROVING: { icon: Sparkles, label: "Improving", color: "text-blue-400", bg: "bg-blue-500/10" },
  PAUSED: { icon: Pause, label: "Paused", color: "text-yellow-400", bg: "bg-yellow-500/10" },
  GRADUATED_READY: { icon: CheckCircle, label: "Ready", color: "text-green-400", bg: "bg-green-500/10" },
  IDLE: { icon: Clock, label: "Idle", color: "text-muted-foreground", bg: "bg-muted/30" },
};

export function EvolutionView() {
  const { data: overview, isLoading, isError } = useBotsOverview();
  const toggleImprovement = useToggleImprovement();
  const forceEvolve = useForceEvolve();

  const isDegraded = isError || (!isLoading && overview === undefined);

  // Derive stats from overview data
  const stats = {
    jobStats: {
      running: 0,
      queued: 0,
      completed: 0,
    },
    completedBacktests24h: 0,
    totalBars: 0,
    avgPnl: 0,
    totalFailures: 0,
    totalMutations: 0,
    totalGenerations: 0,
    totalTrades: 0,
  };

  // Count jobs from perBot data
  if (overview?.perBot) {
    Object.values(overview.perBot).forEach((pb) => {
      stats.jobStats.running += pb.jobs.backtestRunning + pb.jobs.evolveRunning;
      stats.jobStats.queued += pb.jobs.backtestQueued + pb.jobs.evolveQueued;
    });
  }

  // Calculate average PnL and totals from bots
  if (overview?.bots) {
    let totalPnl = 0;
    let pnlCount = 0;
    overview.bots.forEach((bot) => {
      if (bot.session_pnl_usd !== null) {
        totalPnl += bot.session_pnl_usd;
        pnlCount++;
      }
      stats.totalTrades += bot.session_trades;
      stats.completedBacktests24h += bot.backtests_completed;
    });
    stats.avgPnl = pnlCount > 0 ? totalPnl / pnlCount : 0;
  }

  // Group bots by improvement status from perBot data
  const groupedBots = {
    IMPROVING: [] as Array<{ id: string; name: string; state: any }>,
    GRADUATED_READY: [] as Array<{ id: string; name: string; state: any }>,
    PAUSED: [] as Array<{ id: string; name: string; state: any }>,
    IDLE: [] as Array<{ id: string; name: string; state: any }>,
  };

  overview?.bots?.forEach(bot => {
    const perBot = overview.perBot?.[bot.id];
    const status = perBot?.improvementState?.status || "IDLE";
    const group = groupedBots[status as keyof typeof groupedBots] || groupedBots.IDLE;
    group.push({ id: bot.id, name: bot.name, state: perBot?.improvementState });
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isDegraded) {
    return (
      <div className="space-y-4">
        <DegradedBanner message="Evolution data unavailable" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Live Activity Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className={cn(
          "border-2",
          stats.jobStats.running > 0 ? "border-blue-500/50 bg-blue-500/5" : "border-border"
        )}>
          <CardContent className="p-3 text-center">
            <Activity className={cn(
              "w-5 h-5 mx-auto mb-1",
              stats.jobStats.running > 0 ? "text-blue-400 animate-pulse" : "text-muted-foreground"
            )} />
            <p className="text-xl font-bold">{stats.jobStats.running}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Running Now</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Timer className="w-5 h-5 mx-auto text-amber-400 mb-1" />
            <p className="text-xl font-bold">{stats.jobStats.queued}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Queued</p>
          </CardContent>
        </Card>
        <Card className={cn(
          stats.completedBacktests24h > 0 ? "border-green-500/30" : ""
        )}>
          <CardContent className="p-3 text-center">
            <CheckCircle className="w-5 h-5 mx-auto text-green-400 mb-1" />
            <p className="text-xl font-bold">{stats.completedBacktests24h}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Backtests</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <BarChart3 className="w-5 h-5 mx-auto text-purple-400 mb-1" />
            <p className="text-xl font-bold">{stats.totalTrades.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Trades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <TrendingUp className={cn(
              "w-5 h-5 mx-auto mb-1",
              stats.avgPnl >= 0 ? "text-green-400" : "text-red-400"
            )} />
            <PnlDisplay value={stats.avgPnl} size="sm" className="justify-center" />
            <p className="text-[10px] text-muted-foreground uppercase">Avg PnL</p>
          </CardContent>
        </Card>
      </div>

      {/* Bots by Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Actively Improving */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              Actively Improving ({groupedBots.IMPROVING.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 max-h-64 overflow-y-auto">
            {groupedBots.IMPROVING.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No bots currently improving</p>
            ) : (
              groupedBots.IMPROVING.map(bot => (
                <BotEvolutionRow 
                  key={bot.id} 
                  bot={bot} 
                  onPause={() => toggleImprovement.mutate({ botId: bot.id, pause: true })}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Ready for Promotion */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-400" />
              Ready for Promotion ({groupedBots.GRADUATED_READY.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 max-h-64 overflow-y-auto">
            {groupedBots.GRADUATED_READY.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No bots ready yet</p>
            ) : (
              groupedBots.GRADUATED_READY.map(bot => (
                <BotEvolutionRow key={bot.id} bot={bot} />
              ))
            )}
          </CardContent>
        </Card>

        {/* Paused */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Pause className="w-4 h-4 text-yellow-400" />
              Paused ({groupedBots.PAUSED.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 max-h-64 overflow-y-auto">
            {groupedBots.PAUSED.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">No paused bots</p>
            ) : (
              groupedBots.PAUSED.map(bot => (
                <BotEvolutionRow 
                  key={bot.id} 
                  bot={bot}
                  onResume={() => toggleImprovement.mutate({ botId: bot.id, pause: false })}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Idle */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Idle ({groupedBots.IDLE.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 max-h-64 overflow-y-auto">
            {groupedBots.IDLE.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">All bots have improvement state</p>
            ) : (
              groupedBots.IDLE.slice(0, 10).map(bot => (
                <BotEvolutionRow 
                  key={bot.id} 
                  bot={bot}
                  onForceEvolve={() => forceEvolve.mutate({ botId: bot.id })}
                />
              ))
            )}
            {groupedBots.IDLE.length > 10 && (
              <p className="text-xs text-muted-foreground">+{groupedBots.IDLE.length - 10} more</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface BotEvolutionRowProps {
  bot: { id: string; name: string; state: any };
  onPause?: () => void;
  onResume?: () => void;
  onForceEvolve?: () => void;
}

function BotEvolutionRow({ bot, onPause, onResume, onForceEvolve }: BotEvolutionRowProps) {
  const state = bot.state;

  return (
    <div className="flex items-center justify-between p-2 rounded-md bg-muted/20 border border-border/50">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{bot.name}</p>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {state?.consecutiveFailures > 0 && (
            <span className="font-mono">{state.consecutiveFailures} failures</span>
          )}
          {state?.nextAction && (
            <Badge variant="outline" className="text-[9px] px-1">
              {state.nextAction}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onPause && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onPause}>
                <Pause className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Pause improvement</TooltipContent>
          </Tooltip>
        )}
        {onResume && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onResume}>
                <Play className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Resume improvement</TooltipContent>
          </Tooltip>
        )}
        {onForceEvolve && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onForceEvolve}>
                <RefreshCw className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Force evolution</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
