import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { PnlDisplay } from "@/components/ui/pnl-display";
import { useBacktests, useRunBacktest } from "@/hooks/useBacktests";
import { useBots } from "@/hooks/useBots";
import { 
  useSchedulerState, 
  useUpdateSchedulerState, 
  useInitializeSchedulerStates,
  formatRelativeTime,
  formatFrequency 
} from "@/hooks/useSchedulerState";
import { CreateBacktestDialog } from "@/components/backtests/CreateBacktestDialog";
import { format } from "date-fns";
import {
  Settings2,
  Play,
  Pause,
  Clock,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Zap,
  Plus,
  Loader2,
  Calendar,
  LineChart,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function BacktestsTab() {
  const [subtab, setSubtab] = useState<"autonomy" | "manual">("autonomy");
  const [expandedBacktest, setExpandedBacktest] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: backtests, isLoading } = useBacktests();
  const { data: bots } = useBots();
  const runBacktest = useRunBacktest();
  
  // Use real scheduler state from DB
  const { data: schedulerState, isLoading: loadingScheduler } = useSchedulerState('BACKTEST');
  const updateScheduler = useUpdateSchedulerState();
  const initSchedulers = useInitializeSchedulerStates();

  // Initialize scheduler states on first load if none exist
  useEffect(() => {
    if (!loadingScheduler && !schedulerState) {
      initSchedulers.mutate();
    }
  }, [loadingScheduler, schedulerState]);

  // Filter backtests by type based on name patterns
  const autonomyBacktests = backtests?.filter(bt => 
    bt.name?.toLowerCase().includes('autonomy') || 
    bt.name?.toLowerCase().includes('scheduled') ||
    bt.name?.toLowerCase().includes('auto')
  ) || [];

  const manualBacktests = backtests?.filter(bt => 
    bt.name?.toLowerCase().includes('manual') ||
    (bt.name && !bt.name.toLowerCase().includes('autonomy') && !bt.name.toLowerCase().includes('scheduled'))
  ) || [];

  const currentBacktests = subtab === "autonomy" ? autonomyBacktests : manualBacktests;

  // Derive scheduler status from real DB state
  const schedulerStatus = {
    enabled: schedulerState?.enabled ?? false,
    frequency: schedulerState ? formatFrequency(schedulerState.frequency_minutes) : "Not configured",
    nextRun: schedulerState?.next_run_at ? formatRelativeTime(schedulerState.next_run_at) : "N/A",
    lastRun: schedulerState?.last_run_at ? formatRelativeTime(schedulerState.last_run_at) : "Never",
    runningJobs: schedulerState?.running_jobs ?? 0,
    queueDepth: schedulerState?.queue_depth ?? 0,
    lastError: schedulerState?.last_error,
  };

  const handleToggleScheduler = () => {
    updateScheduler.mutate({
      scheduler_type: 'BACKTEST',
      enabled: !schedulerStatus.enabled,
    });
  };

  return (
    <div className="space-y-4">
      {/* Scheduler Panel */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Backtest Scheduler
            </CardTitle>
            <Badge variant={schedulerStatus.enabled ? "default" : "secondary"} className="text-xs">
              {loadingScheduler ? "..." : schedulerStatus.enabled ? "ON" : "OFF"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-muted-foreground">Frequency</p>
              <p className="font-medium">{schedulerStatus.frequency}</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-muted-foreground">Next Run</p>
              <p className="font-medium flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {schedulerStatus.nextRun}
              </p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-muted-foreground">Running</p>
              <p className="font-medium">{schedulerStatus.runningJobs} jobs</p>
            </div>
            <div className="p-2 rounded-lg bg-muted/50">
              <p className="text-muted-foreground">Queue</p>
              <p className="font-medium">{schedulerStatus.queueDepth} pending</p>
            </div>
          </div>
          {schedulerStatus.lastError && (
            <div className="mt-2 p-2 bg-destructive/10 text-destructive text-xs rounded flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              {schedulerStatus.lastError}
            </div>
          )}
          <div className="flex gap-2 mt-3">
            <Button 
              size="sm" 
              variant="outline"
              className="flex-1"
              disabled={runBacktest.isPending}
            >
              {runBacktest.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-1.5" />
              )}
              Run Autonomy Backtests Now
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={handleToggleScheduler}
              disabled={updateScheduler.isPending}
            >
              {schedulerStatus.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sub-tabs: Autonomy vs Manual */}
      <Tabs value={subtab} onValueChange={(v) => setSubtab(v as "autonomy" | "manual")}>
        <div className="flex items-center justify-between">
          <TabsList className="h-8">
            <TabsTrigger value="autonomy" className="text-xs px-3 h-7">
              <Zap className="w-3 h-3 mr-1" />
              Autonomy
            </TabsTrigger>
            <TabsTrigger value="manual" className="text-xs px-3 h-7">
              <Play className="w-3 h-3 mr-1" />
              Manual
            </TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} disabled={!bots || bots.length === 0}>
            <Plus className="w-4 h-4 mr-1.5" />
            New Backtest
          </Button>
        </div>

        <TabsContent value="autonomy" className="mt-3">
          <BacktestList 
            backtests={autonomyBacktests} 
            isLoading={isLoading} 
            emptyMessage="No autonomy backtests yet. The scheduler will run backtests automatically."
            showSchedulerInfo
            schedulerNextRun={schedulerStatus.nextRun}
          />
        </TabsContent>

        <TabsContent value="manual" className="mt-3">
          <BacktestList 
            backtests={manualBacktests} 
            isLoading={isLoading} 
            emptyMessage="No manual backtests yet. Click 'New Backtest' to run one."
          />
        </TabsContent>
      </Tabs>

      <CreateBacktestDialog 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen}
        bots={bots || []}
      />
    </div>
  );
}

interface BacktestListProps {
  backtests: any[];
  isLoading: boolean;
  emptyMessage: string;
  showSchedulerInfo?: boolean;
  schedulerNextRun?: string;
}

function BacktestList({ backtests, isLoading, emptyMessage, showSchedulerInfo, schedulerNextRun }: BacktestListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-5 w-24 mb-1.5" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (!backtests || backtests.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <LineChart className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="text-base font-semibold mb-1">No backtests</h3>
          <p className="text-sm text-muted-foreground mb-3 text-center max-w-xs">
            {emptyMessage}
          </p>
          {showSchedulerInfo && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>Scheduler ON · Next run {schedulerNextRun || "N/A"}</span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {backtests.map((bt: any) => (
        <Card key={bt.id} className="hover:border-primary/50 transition-colors">
          <CardContent className="p-3">
            {/* Top Row */}
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
                <LineChart className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <Link 
                  to={`/backtests/${bt.id}`}
                  className="font-semibold text-sm hover:text-primary transition-colors block truncate"
                >
                  {bt.name || `Backtest ${bt.instrument}`}
                </Link>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground truncate">{bt.bot?.name || "—"}</span>
                  <StatusBadge status={bt.status as any} />
                </div>
              </div>
            </div>
            
            {/* Stats Row */}
            <div className="grid grid-cols-4 gap-2 text-center bg-muted/30 rounded-lg p-2">
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">P&L</p>
                {bt.net_pnl !== null ? (
                  <PnlDisplay value={Number(bt.net_pnl)} size="sm" className="justify-center" />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Win%</p>
                <p className="font-mono text-xs font-semibold">
                  {bt.win_rate !== null ? `${Number(bt.win_rate).toFixed(0)}%` : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">Sharpe</p>
                <p className="font-mono text-xs font-semibold">
                  {bt.sharpe_ratio !== null ? Number(bt.sharpe_ratio).toFixed(1) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-muted-foreground">DD</p>
                <p className="font-mono text-xs font-semibold text-loss">
                  {bt.max_drawdown_pct !== null ? `-${Number(bt.max_drawdown_pct).toFixed(0)}%` : "—"}
                </p>
              </div>
            </div>
            
            {/* Date Range */}
            <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {bt.start_date} → {bt.end_date}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
