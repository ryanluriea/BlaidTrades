import { Card } from "@/components/ui/card";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { TrendingUp, Activity, Target, Trophy, Zap, Play, Rocket, FlaskConical } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface BotsSummaryMetricsProps {
  totalPnl: number;
  tradesCount: number;
  winRate: number | null;
  activeBots: number;
  topBot?: { name: string; pnl: number } | null;
  onTopBotClick?: () => void;
  botCount?: number;
  runningCount?: number;
  readyCount?: number;
  backtestingCount?: number;
  onFilterActive?: () => void;
  onFilterRunning?: () => void;
  onFilterReady?: () => void;
  onFilterBacktesting?: () => void;
}

export function BotsSummaryMetrics({
  totalPnl,
  tradesCount,
  winRate,
  activeBots,
  topBot,
  onTopBotClick,
  runningCount = 0,
  readyCount = 0,
  backtestingCount = 0,
  onFilterActive,
  onFilterRunning,
  onFilterReady,
  onFilterBacktesting,
}: BotsSummaryMetricsProps) {
  return (
    <div className="flex items-stretch gap-2 w-full">
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="p-2 flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1 rounded bg-primary/10 flex-shrink-0">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">P&L</p>
              <PnlDisplay value={totalPnl} size="sm" compact />
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Total trading P&L</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="p-2 flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1 rounded bg-blue-500/10 flex-shrink-0">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Trades</p>
              <p className="font-mono text-sm font-semibold">{tradesCount}</p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Live trades executed</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="p-2 flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1 rounded bg-emerald-500/10 flex-shrink-0">
              <Target className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Win%</p>
              <p className="font-mono text-sm font-semibold">
                {winRate !== null ? `${winRate.toFixed(0)}%` : "—"}
              </p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Average win rate</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card 
            className="p-2 flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={onFilterActive}
          >
            <div className="p-1 rounded bg-amber-500/10 flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Active</p>
              <p className="font-mono text-sm font-semibold">{activeBots}</p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Click to filter active bots</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card 
            className="p-2 flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={onFilterRunning}
          >
            <div className="p-1 rounded bg-green-500/10 relative flex-shrink-0">
              <Play className="w-3.5 h-3.5 text-green-400" />
              {runningCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Running</p>
              <p className="font-mono text-sm font-semibold">{runningCount}</p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Click to filter running bots</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card 
            className="p-2 flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={onFilterReady}
          >
            <div className="p-1 rounded bg-teal-500/10 flex-shrink-0">
              <Rocket className="w-3.5 h-3.5 text-teal-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Ready</p>
              <p className="font-mono text-sm font-semibold">{readyCount}</p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Click to filter promotion-ready bots</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Card 
            className="p-2 flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={onFilterBacktesting}
          >
            <div className="p-1 rounded bg-cyan-500/10 flex-shrink-0">
              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase text-muted-foreground leading-none">Backtesting</p>
              <p className="font-mono text-sm font-semibold">{backtestingCount}</p>
            </div>
          </Card>
        </TooltipTrigger>
        <TooltipContent>Click to view backtesting bots</TooltipContent>
      </Tooltip>

      {topBot && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Card 
              className="p-2 flex items-center gap-2 flex-1 min-w-0 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={onTopBotClick}
            >
              <div className="p-1 rounded bg-purple-500/10 flex-shrink-0">
                <Trophy className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[9px] uppercase text-muted-foreground leading-none">Top</p>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs font-medium whitespace-nowrap">{topBot.name}</span>
                  <PnlDisplay value={topBot.pnl} size="sm" compact />
                </div>
              </div>
            </Card>
          </TooltipTrigger>
          <TooltipContent>Click to scroll to {topBot.name}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
