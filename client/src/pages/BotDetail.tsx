import { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBot, useExportBotpack, useImportBotpack } from "@/hooks/useBots";
import { useBotGenerations, usePromoteBot, useEvolutionEngine } from "@/hooks/useEvolution";
import { useBiasFeedEvents, useSignals } from "@/hooks/useTrading";
import { AttachToAccountDialog } from "@/components/bots/AttachToAccountDialog";
import { BotActivityPanel } from "@/components/bots/dropdown/BotActivityPanel";
import { BotHistoryPanel } from "@/components/bots/dropdown/BotHistoryPanel";
import { BotGenerationsPanel } from "@/components/bots/dropdown/BotGenerationsPanel";
import { BotBrainHealthRing } from "@/components/bots/BotBrainHealthRing";
import { InstitutionalMetricsGrid } from "@/components/bots/InstitutionalMetricsGrid";
import { BotRulesTab } from "@/components/bots/BotRulesTab";
import { BotDecisionTraces } from "@/components/bots/BotDecisionTraces";
import { BotAutonomyScore } from "@/components/bots/BotAutonomyScore";
import { 
  Download,
  Upload,
  TrendingUp,
  TrendingDown,
  Brain,
  History,
  ArrowUp,
  Zap,
  Loader2,
  ChevronLeft,
  LinkIcon,
  Dna,
  BookOpen,
  Shield,
} from "lucide-react";

export default function BotDetail() {
  const { id } = useParams();
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: bot, isLoading } = useBot(id);
  const { data: generations = [] } = useBotGenerations(id);
  const { data: biasEvents = [] } = useBiasFeedEvents(id);
  const { data: signals = [] } = useSignals(id);
  const promoteBot = usePromoteBot();
  const evolveBot = useEvolutionEngine();
  const exportBotpack = useExportBotpack();
  const importBotpack = useImportBotpack();

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const botpack = JSON.parse(e.target?.result as string);
        importBotpack.mutate({ botpack });
      } catch {
        console.error("Invalid botpack file");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  if (isLoading) {
    return (
      <AppLayout title="Loading...">
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!bot) {
    return (
      <AppLayout title="Bot Not Found">
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">Bot not found</p>
          <Button asChild><Link to="/bots">Back to Bots</Link></Button>
        </div>
      </AppLayout>
    );
  }

  const strategyConfig = bot.strategy_config as Record<string, any> || {};
  const riskConfig = bot.risk_config as Record<string, any> || {};

  const getNextMode = (): 'SIM_LIVE' | 'SHADOW' | 'LIVE' | null => {
    if (bot.mode === 'BACKTEST_ONLY') return 'SIM_LIVE';
    if (bot.mode === 'SIM_LIVE') return 'SHADOW';
    if (bot.mode === 'SHADOW') return 'LIVE';
    return null;
  };

  const nextMode = getNextMode();

  return (
    <AppLayout title={bot.name}>
      <div className="space-y-6">
        {/* Back link */}
        <Link to="/bots" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Bots
        </Link>

        {/* Header with Bot Brain Health Ring */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {/* Bot Brain Health Ring - PRIMARY HEALTH SIGNAL */}
            <BotBrainHealthRing
              score={bot.bqs_latest ?? 50}
              state={(bot.health_state as 'OK' | 'WARN' | 'DEGRADED') ?? 'OK'}
              components={{
                runner_reliability: 80,
                backtest_success: bot.backtest_win_rate ? Math.min(100, (bot.backtest_win_rate / 60) * 100) : 50,
                evolution_stability: 70,
                promotion_readiness: bot.graduation_status === 'PROMOTED' ? 100 : bot.graduation_status === 'KEEP' ? 75 : 50,
                drawdown_discipline: 85,
                error_frequency: 90,
              }}
              size="lg"
              showLabel
            />
            
            <div>
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={bot.mode as any} />
                <StatusBadge status={bot.status as any} />
                {bot.graduation_score && (
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                    Score: {Number(bot.graduation_score).toFixed(0)}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground">{bot.description || "No description"}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {nextMode && (
              <Button 
                variant="outline"
                onClick={() => promoteBot.mutate({ botId: bot.id, targetMode: nextMode })}
                disabled={promoteBot.isPending}
              >
                {promoteBot.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowUp className="w-4 h-4 mr-2" />}
                Promote to {nextMode}
              </Button>
            )}
            <Button 
              variant="outline"
              onClick={() => evolveBot.mutate({ botId: bot.id })}
              disabled={evolveBot.isPending || bot.evolution_mode === 'locked'}
            >
              {evolveBot.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
              Evolve
            </Button>
            <Button 
              variant="outline"
              onClick={() => setAttachDialogOpen(true)}
            >
              <LinkIcon className="w-4 h-4 mr-2" />
              Attach to Account
            </Button>
            <Button 
              variant="outline"
              onClick={() => bot && exportBotpack.mutate(bot.id)}
              disabled={exportBotpack.isPending}
            >
              {exportBotpack.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Export
            </Button>
            <Button 
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importBotpack.isPending}
            >
              {importBotpack.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.botpack.json"
              onChange={handleFileImport}
              className="hidden"
            />
          </div>
        </div>

        {/* Institutional Metrics Grid */}
        <InstitutionalMetricsGrid
          totalPnl={(bot as any).botNow?.lastBacktest?.netPnl ?? (Number((bot as any).total_pnl) || 0)}
          winRate={(bot as any).botNow?.lastBacktest?.winRate ?? ((bot as any).win_rate ? Number((bot as any).win_rate) : null)}
          totalTrades={(bot as any).botNow?.lastBacktest?.trades ?? ((bot as any).total_trades || 0)}
          profitFactor={(bot as any).botNow?.lastBacktest?.profitFactor ?? ((bot as any).profit_factor ? Number((bot as any).profit_factor) : null)}
          sharpe={(bot as any).botNow?.lastBacktest?.sharpeRatio ?? (bot as any).sharpe_ratio ?? (bot as any).backtest_sharpe ?? null}
          sortino={(bot as any).sortino_ratio ?? null}
          calmar={(bot as any).calmar_ratio ?? null}
          maxDrawdownPct={(bot as any).botNow?.lastBacktest?.maxDrawdownPct ?? (bot as any).max_drawdown_pct ?? (bot as any).backtest_max_dd_pct ?? null}
          maxDrawdownDollars={(bot as any).max_drawdown ?? (bot as any).backtest_max_dd ?? null}
          sharpeConfidence={(bot as any).sharpe_confidence}
          statisticallySignificant={(bot as any).metrics_statistically_significant}
          showAllMetrics={true}
        />

        {/* Activity Panel at top */}
        <BotActivityPanel botId={bot.id} />

        {/* Tabs */}
        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList className="flex-wrap">
            <TabsTrigger value="rules">
              <BookOpen className="w-4 h-4 mr-2" />
              Rules
            </TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">
              <History className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger value="generations">
              <Dna className="w-4 h-4 mr-2" />
              Generations
            </TabsTrigger>
            <TabsTrigger value="mind-console">
              <Brain className="w-4 h-4 mr-2" />
              Mind
            </TabsTrigger>
            <TabsTrigger value="bias-feed">
              <TrendingUp className="w-4 h-4 mr-2" />
              Bias
            </TabsTrigger>
            <TabsTrigger value="autonomy">
              <Shield className="w-4 h-4 mr-2" />
              Autonomy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules">
              <BotRulesTab bot={{
                ...bot,
                strategy_config: (typeof bot.strategy_config === 'object' && bot.strategy_config !== null ? bot.strategy_config : {}) as Record<string, any>,
                risk_config: (typeof bot.risk_config === 'object' && bot.risk_config !== null ? bot.risk_config : {}) as Record<string, any>,
              }} />
          </TabsContent>

          <TabsContent value="overview">
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Strategy Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(strategyConfig).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-sm">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                    </div>
                  ))}
                  {Object.keys(strategyConfig).length === 0 && (
                    <p className="text-muted-foreground text-sm">No strategy config</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Risk Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(riskConfig).map(([key, value]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="font-mono">{typeof value === 'number' ? value : String(value)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <BotHistoryPanel botId={bot.id} />
          </TabsContent>

          <TabsContent value="generations">
            <BotGenerationsPanel bot={bot} />
          </TabsContent>

          <TabsContent value="mind-console">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Signals</CardTitle>
              </CardHeader>
              <CardContent>
                {signals.length > 0 ? (
                  <div className="space-y-3">
                    {signals.slice(0, 10).map((signal: any) => (
                      <div key={signal.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        {signal.direction === 'BUY' ? (
                          <TrendingUp className="w-4 h-4 text-profit" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-loss" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{signal.signal_type}</span>
                            <StatusBadge status={signal.direction || 'neutral'} />
                          </div>
                          <p className="text-sm text-muted-foreground">{signal.reasoning || 'No reasoning'}</p>
                          <p className="text-xs text-muted-foreground">{new Date(signal.created_at).toLocaleString()}</p>
                        </div>
                        {signal.strength && (
                          <span className="font-mono text-sm">{(signal.strength * 100).toFixed(0)}%</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No signals recorded yet
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bias-feed">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Bias Visualization Feed</CardTitle>
              </CardHeader>
              <CardContent>
                {biasEvents.length > 0 ? (
                  <div className="space-y-3">
                    {biasEvents.slice(0, 10).map((event: any) => (
                      <div key={event.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        <div className={`w-3 h-3 rounded-full ${
                          event.bias_type === 'bullish' ? 'bg-profit' :
                          event.bias_type === 'bearish' ? 'bg-loss' : 'bg-warning'
                        }`} />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium capitalize">{event.bias_type}</span>
                            {event.confidence && (
                              <span className="text-xs text-muted-foreground">
                                {(event.confidence * 100).toFixed(0)}% confidence
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{event.reasoning || 'No reasoning'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    No bias events recorded yet
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="autonomy">
            <div className="grid gap-6 md:grid-cols-2">
              <BotAutonomyScore botId={bot.id} />
              <BotDecisionTraces botId={bot.id} />
            </div>
          </TabsContent>

        </Tabs>
      </div>
      {bot && (
        <AttachToAccountDialog 
          open={attachDialogOpen} 
          onOpenChange={setAttachDialogOpen}
          bot={bot}
        />
      )}
    </AppLayout>
  );
}
