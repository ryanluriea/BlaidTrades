import { useState } from "react";
import { useAlphaDecayScan, useAlphaDecayHistory, getDecayLevelColor, getRecommendationColor } from "@/hooks/useAlphaDecay";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, AlertTriangle, TrendingDown, Shield, RefreshCw, 
  Bot, ChevronRight, BarChart3, Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const STAGES = ["PAPER", "SHADOW", "CANARY", "LIVE"];

export default function AlphaDecay() {
  const [selectedStages, setSelectedStages] = useState<string[]>(["PAPER", "SHADOW", "CANARY", "LIVE"]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  
  const { data: scanData, isLoading, refetch, isFetching } = useAlphaDecayScan(selectedStages);
  const { data: historyData, isLoading: historyLoading } = useAlphaDecayHistory(selectedBotId || "", 90);

  const results = scanData?.results || [];
  const decayingBots = results.filter(r => r.decayDetected);
  const stableBots = results.filter(r => !r.decayDetected);

  const toggleStage = (stage: string) => {
    if (selectedStages.includes(stage)) {
      setSelectedStages(selectedStages.filter(s => s !== stage));
    } else {
      setSelectedStages([...selectedStages, stage]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Alpha Decay Monitor
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track strategy performance decay across your bot fleet
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => refetch()} 
          disabled={isFetching}
          data-testid="button-refresh-decay"
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", isFetching && "animate-spin")} />
          Refresh Scan
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-muted-foreground">Filter by stage:</span>
        {STAGES.map(stage => (
          <Button
            key={stage}
            size="sm"
            variant={selectedStages.includes(stage) ? "default" : "outline"}
            onClick={() => toggleStage(stage)}
            data-testid={`button-filter-${stage.toLowerCase()}`}
          >
            {stage}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Total Scanned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-total-scanned">
              {isLoading ? <Skeleton className="h-9 w-16" /> : scanData?.totalScanned || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-400">
              <TrendingDown className="w-4 h-4" />
              Decaying
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400" data-testid="text-decaying-count">
              {isLoading ? <Skeleton className="h-9 w-16" /> : scanData?.decayingCount || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-green-400">
              <Shield className="w-4 h-4" />
              Stable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400" data-testid="text-stable-count">
              {isLoading ? <Skeleton className="h-9 w-16" /> : stableBots.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              Bots with Decay
            </CardTitle>
            <CardDescription>
              Strategies showing performance degradation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : decayingBots.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                  <Shield className="w-8 h-8 mb-2 text-green-400" />
                  <p className="text-sm">All bots are performing within normal parameters</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {decayingBots.map(bot => (
                    <div
                      key={bot.botId}
                      onClick={() => setSelectedBotId(bot.botId)}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors hover-elevate",
                        selectedBotId === bot.botId ? "border-primary bg-primary/5" : "border-border"
                      )}
                      role="button"
                      tabIndex={0}
                      data-testid={`row-decay-bot-${bot.botId}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{bot.botName}</span>
                          <Badge variant="outline" className="text-[10px]">{bot.stage}</Badge>
                        </div>
                        <Badge className={cn("text-[10px]", getDecayLevelColor(bot.decayLevel))}>
                          {bot.decayLevel}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span className="text-muted-foreground">
                          Sharpe: <span className="font-mono">{(bot.metrics.sharpeDecay * 100).toFixed(0)}%</span> decay
                        </span>
                        <span className="text-muted-foreground">
                          WR: <span className="font-mono">{(bot.metrics.winRateDecay * 100).toFixed(0)}%</span> decay
                        </span>
                      </div>
                      <div className={cn("text-xs mt-1", getRecommendationColor(bot.recommendation))}>
                        {bot.recommendation.replace("_", " ")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Decay Details
            </CardTitle>
            <CardDescription>
              {selectedBotId ? "Detailed analysis" : "Select a bot to view details"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedBotId ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Target className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">Click on a bot to view decay details</p>
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const bot = results.find(r => r.botId === selectedBotId);
                  if (!bot) return null;
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{bot.botName}</h3>
                          <p className="text-xs text-muted-foreground">{bot.stage}</p>
                        </div>
                        <Link to={`/bots/${bot.botId}`} data-testid="link-view-bot-detail">
                          <Button variant="outline" size="sm" data-testid="button-view-bot">
                            View Bot <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </Link>
                      </div>

                      <div className={cn("p-3 rounded-md border", getDecayLevelColor(bot.decayLevel))} data-testid="text-decay-level-panel">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Decay Level</span>
                          <Badge className={cn(getDecayLevelColor(bot.decayLevel))} data-testid="badge-decay-level">
                            {bot.decayLevel}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3" data-testid="grid-decay-metrics">
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Current Sharpe</div>
                          <div className="font-mono text-sm" data-testid="text-current-sharpe">{bot.metrics.currentSharpe.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Baseline Sharpe</div>
                          <div className="font-mono text-sm" data-testid="text-baseline-sharpe">{bot.metrics.baselineSharpe.toFixed(2)}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Rolling Win Rate</div>
                          <div className="font-mono text-sm" data-testid="text-rolling-wr">{(bot.metrics.rollingWinRate * 100).toFixed(1)}%</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Baseline Win Rate</div>
                          <div className="font-mono text-sm" data-testid="text-baseline-wr">{(bot.metrics.baselineWinRate * 100).toFixed(1)}%</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Consec. Losses</div>
                          <div className="font-mono text-sm" data-testid="text-consec-losses">{bot.metrics.consecLosses}</div>
                        </div>
                        <div className="p-2 rounded-md bg-muted/30">
                          <div className="text-[10px] text-muted-foreground">Trade Density</div>
                          <div className="font-mono text-sm" data-testid="text-trade-density">{(bot.metrics.tradeDensity * 100).toFixed(0)}%</div>
                        </div>
                      </div>

                      <div className={cn("p-2 rounded-md", getRecommendationColor(bot.recommendation).replace("text-", "bg-").replace("-400", "-500/10"))} data-testid="text-recommendation-panel">
                        <div className="text-xs text-muted-foreground mb-1">Recommendation</div>
                        <div className={cn("font-medium", getRecommendationColor(bot.recommendation))} data-testid="text-recommendation">
                          {bot.recommendation.replace("_", " ")}
                        </div>
                      </div>

                      {bot.reasons.length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Reasons</div>
                          <ul className="text-xs space-y-1">
                            {bot.reasons.map((r, i) => (
                              <li key={i} className="flex items-start gap-1">
                                <span className="text-muted-foreground/60">-</span>
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-green-400" />
            Stable Bots
          </CardTitle>
          <CardDescription>
            {stableBots.length} bots with no detected decay
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : stableBots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stable bots in selected stages</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {stableBots.map(bot => (
                <Link key={bot.botId} to={`/bots/${bot.botId}`} data-testid={`link-stable-bot-${bot.botId}`}>
                  <div 
                    className="p-2 rounded-md border border-green-500/20 bg-green-500/5 hover-elevate cursor-pointer"
                  >
                    <div className="text-sm font-medium truncate">{bot.botName}</div>
                    <div className="text-[10px] text-muted-foreground">{bot.stage}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
