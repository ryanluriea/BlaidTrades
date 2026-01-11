import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteBot } from "@/hooks/useBots";
import { useBotsTableColumns } from "@/hooks/useBotsTableColumns";
import { useBotsOverview, toBot, toMetrics, toEnriched, toRunner, toJobs, toImprovement } from "@/hooks/useBotsOverview";
import { useExecutionProof } from "@/hooks/useExecutionProof";
import { useBotRunnerAndJobs } from "@/hooks/useBotRunnerAndJobs";
import { useLabStarvation, getLabIdleInfo } from "@/hooks/useLabStarvation";
import { useMarketHours } from "@/hooks/useMarketHours";
import { CreateBotDialog } from "@/components/bots/CreateBotDialog";
import { BotTableRow } from "@/components/bots/BotTableRow";
import { AutonomyPipeline } from "@/components/bots/AutonomyPipeline";
import { PipelineActions } from "@/components/bots/PipelineActions";
import { FleetView } from "@/components/bots/views/FleetView";
import { ComingSoonView } from "@/components/bots/views/ComingSoonView";
import { TournamentsView } from "@/components/bots/views/TournamentsView";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBanner } from "@/components/ui/error-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Plus, Bot, RefreshCw, Moon, Clock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Stage priority for sorting (LIVE at top, TRIALS at bottom)
const STAGE_PRIORITY: Record<string, number> = {
  LIVE: 5,
  CANARY: 4,
  SHADOW: 3,
  PAPER: 2,
  TRIALS: 1,
  DEGRADED: 0,
};

// Get graduation readiness score (higher = closer to graduating)
// Uses candidate_score (0-100) from overview data
function getGraduationReadiness(bot: any, perBot: any): number {
  // Higher stages are already "graduated" - give them max readiness
  const stage = bot.stage || 'TRIALS';
  if (stage === 'LIVE') return 1000;
  if (stage === 'CANARY') return 900;
  if (stage === 'SHADOW') return 800;
  if (stage === 'PAPER') return 700;
  
  // For TRIALS bots, use candidate_score (0-100) which measures graduation readiness
  const candidateScore = perBot?.improvementState?.candidateScore ?? 0;
  
  // Also factor in backtest quality metrics if available
  const pf = bot.session_profit_factor ?? 0;
  const wr = bot.session_win_rate ?? 0;
  const trades = bot.session_total_trades ?? 0;
  
  // Composite score: candidateScore is primary (0-100), add bonuses for good metrics
  let score = candidateScore;
  
  // Bonus for meeting graduation thresholds (PF >= 1.15, WR >= 40%, trades >= 60)
  if (pf >= 1.15) score += 15;
  if (wr >= 40) score += 15;
  if (trades >= 60) score += 10;
  
  return score;
}

/**
 * /bots page - Uses ONLY useBotsOverview for all data
 * 
 * NO per-row hooks, NO N+1 queries, NO REST dependencies
 * Single batched edge function call returns everything needed
 */
export default function Bots() {
  // SINGLE DATA SOURCE - everything comes from bots-overview
  const { data: overview, isLoading, error, refetch, isFetching, dataUpdatedAt } = useBotsOverview();
  
  // Execution proof for PAPER/SHADOW/LIVE bots
  const botIds = useMemo(() => overview?.bots?.map(b => b.id) || [], [overview?.bots]);
  const { data: executionProofResult } = useExecutionProof(botIds);
  const executionProofData = executionProofResult?.data;
  const isExecutionProofDegraded = executionProofResult?.degraded ?? false;
  
  // Fetch actual runner and jobs data for all bots (replaces hardcoded zeros)
  const { data: runnerJobsData, isLoading: runnerJobsLoading } = useBotRunnerAndJobs(botIds);
  
  // Fetch LAB starvation data for idle reason + next run display
  const { data: labStarvationData } = useLabStarvation();
  
  // Market hours for maintenance detection
  const { data: marketHours } = useMarketHours();
  const isMaintenanceWindow = marketHours?.sessionType === 'MAINTENANCE';
  
  const deleteBot = useDeleteBot();
  const botListRef = useRef<HTMLDivElement>(null);
  const botRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { visibleColumns } = useBotsTableColumns();
  
  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [expandedBots, setExpandedBots] = useState<Set<string>>(new Set());

  // Filter state
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [symbolFilter, setSymbolFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  
  // Sort state - default to stage priority
  const [sortBy, setSortBy] = useState("stage");
  
  // Pinned bots (persisted to localStorage)
  const [pinnedBots, setPinnedBots] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("pinnedBots");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  
  // Recently updated bots (for flash-on-change animation)
  // Track ALL key metrics: PnL, trades, generation, Sharpe, Win%, Max DD, live metrics
  const prevBotsRef = useRef<Map<string, { 
    updated_at: string; 
    session_pnl: number | null; 
    session_trades: number | null; 
    session_sharpe: number | null;
    session_win_rate: number | null;
    session_max_dd: number | null;
    live_pnl: number | null;
    live_trades: number | null;
    live_win_rate: number | null;
    gen: number | null;
  }>>(new Map());
  const [recentlyUpdated, setRecentlyUpdated] = useState<Set<string>>(new Set());
  
  // Track bot updates for flash-on-change animation
  useEffect(() => {
    if (!overview?.bots) return;
    const newlyUpdated = new Set<string>();
    
    overview.bots.forEach(bot => {
      const prev = prevBotsRef.current.get(bot.id);
      const current = {
        updated_at: bot.updated_at,
        session_pnl: bot.session_pnl_usd,
        session_trades: bot.session_trades,
        session_sharpe: bot.session_sharpe,
        session_win_rate: bot.session_win_rate_pct,
        session_max_dd: bot.session_max_dd_pct,
        live_pnl: bot.live_pnl,
        live_trades: bot.live_total_trades,
        live_win_rate: bot.live_win_rate,
        gen: bot.generation,
      };
      
      // Flash if any key metric changed (comprehensive coverage)
      if (prev && (
        prev.updated_at !== current.updated_at ||
        prev.session_pnl !== current.session_pnl ||
        prev.session_trades !== current.session_trades ||
        prev.session_sharpe !== current.session_sharpe ||
        prev.session_win_rate !== current.session_win_rate ||
        prev.session_max_dd !== current.session_max_dd ||
        prev.live_pnl !== current.live_pnl ||
        prev.live_trades !== current.live_trades ||
        prev.live_win_rate !== current.live_win_rate ||
        prev.gen !== current.gen
      )) {
        newlyUpdated.add(bot.id);
      }
      prevBotsRef.current.set(bot.id, current);
    });
    
    if (newlyUpdated.size > 0) {
      setRecentlyUpdated(prev => new Set([...prev, ...newlyUpdated]));
      // Clear flash after 800ms for institutional feel
      setTimeout(() => {
        setRecentlyUpdated(prev => {
          const next = new Set(prev);
          newlyUpdated.forEach(id => next.delete(id));
          return next;
        });
      }, 800);
    }
  }, [overview?.bots]);
  
  // Toggle pin for a bot
  const togglePin = (botId: string) => {
    setPinnedBots(prev => {
      const next = new Set(prev);
      if (next.has(botId)) {
        next.delete(botId);
      } else {
        next.add(botId);
      }
      localStorage.setItem("pinnedBots", JSON.stringify([...next]));
      return next;
    });
  };
  
  // Sub-nav state
  const [activeTab, setActiveTab] = useState("individual");

  // Get available symbols from bots
  const availableSymbols = useMemo(() => {
    const symbols = new Set<string>();
    overview?.bots?.forEach((bot) => {
      if (bot.symbol) symbols.add(bot.symbol);
    });
    return Array.from(symbols);
  }, [overview?.bots]);

  // Filter and sort bots
  const filteredBots = useMemo(() => {
    if (!overview?.bots) return [];
    
    return overview.bots
      .filter((bot) => {
        // Stage filter (normalize both filter and bot.stage to uppercase; treat null, "ALL", or invalid as no filter)
        const normalizedFilter = stageFilter?.toUpperCase();
        const normalizedBotStage = (bot.stage || "TRIALS").toUpperCase(); // Default missing stage to TRIALS
        const isValidStage = normalizedFilter && normalizedFilter !== "ALL" && STAGE_PRIORITY[normalizedFilter] !== undefined;
        if (isValidStage && normalizedBotStage !== normalizedFilter) return false;
        
        // Status filter
        if (statusFilter !== "all" && bot.status !== statusFilter) return false;
        
        // Symbol filter
        if (symbolFilter !== "all" && bot.symbol !== symbolFilter) return false;
        
        return true;
      })
      .sort((a, b) => {
        // 1. Pinned bots always first
        const aPinned = pinnedBots.has(a.id) ? 1 : 0;
        const bPinned = pinnedBots.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        
        // Helper: get effective P&L based on stage (session for TRIALS, live for others)
        const getPnl = (bot: typeof a) => {
          if (bot.stage === 'TRIALS') {
            return Number(bot.session_pnl_usd) || 0;
          }
          return Number(bot.live_pnl) || 0;
        };
        
        // Helper: get effective Sharpe based on stage
        const getSharpe = (bot: typeof a) => {
          if (bot.stage === 'TRIALS') {
            return Number(bot.session_sharpe) || 0;
          }
          // For non-TRIALS, use session sharpe as proxy (live sharpe not always available)
          return Number(bot.session_sharpe) || 0;
        };
        
        // Helper: get effective trades based on stage
        const getTrades = (bot: typeof a) => {
          if (bot.stage === 'TRIALS') {
            return Number(bot.session_trades) || 0;
          }
          return Number(bot.live_total_trades) || 0;
        };
        
        // 2. Apply user-selected sort
        switch (sortBy) {
          case "stage": {
            // Primary: Stage priority (LIVE → LAB)
            const stageA = STAGE_PRIORITY[a.stage] || 0;
            const stageB = STAGE_PRIORITY[b.stage] || 0;
            if (stageA !== stageB) return stageB - stageA;
            
            // Secondary: Performance (Sharpe ratio, higher is better)
            const sharpeA = getSharpe(a);
            const sharpeB = getSharpe(b);
            if (sharpeA !== sharpeB) return sharpeB - sharpeA;
            
            // Tertiary: P&L as tiebreaker
            const pnlA = getPnl(a);
            const pnlB = getPnl(b);
            if (pnlA !== pnlB) return pnlB - pnlA;
            
            // Final: Stable sort by name
            return a.name.localeCompare(b.name);
          }
          case "updated":
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          case "name":
            return a.name.localeCompare(b.name);
          case "name-desc":
            return b.name.localeCompare(a.name);
          case "pnl":
            return getPnl(b) - getPnl(a);
          case "pnl-asc":
            return getPnl(a) - getPnl(b);
          case "trades":
            return getTrades(b) - getTrades(a);
          case "created":
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          default:
            return 0;
        }
      });
  }, [overview?.bots, stageFilter, statusFilter, symbolFilter, sortBy, pinnedBots]);

  // Compute per-stage metrics for AutonomyPipeline tabs
  const stageMetrics = useMemo(() => {
    const defaultMetric = () => ({ count: 0, pnl: 0, trades: 0, winRate: null as number | null, running: 0 });
    const metrics: Record<string, { count: number; pnl: number; trades: number; winRate: number | null; running: number }> = {
      ALL: defaultMetric(),
      'TRIALS': defaultMetric(),
      PAPER: defaultMetric(),
      SHADOW: defaultMetric(),
      CANARY: defaultMetric(),
      LIVE: defaultMetric(),
      DEGRADED: defaultMetric(),
    };
    
    const defaultWinRate = () => ({ sum: 0, count: 0 });
    const winRateSums: Record<string, { sum: number; count: number }> = {
      ALL: defaultWinRate(),
      'TRIALS': defaultWinRate(),
      PAPER: defaultWinRate(),
      SHADOW: defaultWinRate(),
      CANARY: defaultWinRate(),
      LIVE: defaultWinRate(),
      DEGRADED: defaultWinRate(),
    };
    
    if (!overview?.bots) return metrics;
    
    overview.bots.forEach((bot) => {
      const stage = bot.stage || 'TRIALS';
      const isTrials = stage === 'TRIALS';
      
      // Ensure we have a bucket for this stage (defensive for unknown stages)
      if (!metrics[stage]) {
        metrics[stage] = { count: 0, pnl: 0, trades: 0, winRate: null, running: 0 };
        winRateSums[stage] = { sum: 0, count: 0 };
      }
      
      // Use session (backtest) metrics for TRIALS, live metrics for others
      const pnl = isTrials ? Number(bot.session_pnl_usd ?? 0) : Number(bot.live_pnl ?? 0);
      const trades = isTrials ? Number(bot.session_trades ?? 0) : Number(bot.live_total_trades ?? 0);
      const winRate = isTrials ? bot.session_win_rate_pct : bot.live_win_rate;
      
      // Check if bot is running (match prior logic: RUNNING/TRADING/SCANNING states)
      const perBot = overview.perBot?.[bot.id];
      const activityState = perBot?.instanceStatus?.activityState;
      const isRunning = (activityState === 'RUNNING' || activityState === 'TRADING' || activityState === 'SCANNING') ? 1 : 0;
      
      // Update stage-specific metrics
      metrics[stage].count++;
      metrics[stage].pnl += pnl;
      metrics[stage].trades += trades;
      metrics[stage].running += isRunning;
      if (winRate !== null && winRate !== undefined) {
        winRateSums[stage].sum += Number(winRate);
        winRateSums[stage].count++;
      }
      
      // Update ALL totals
      metrics.ALL.count++;
      metrics.ALL.pnl += pnl;
      metrics.ALL.trades += trades;
      metrics.ALL.running += isRunning;
      if (winRate !== null && winRate !== undefined) {
        winRateSums.ALL.sum += Number(winRate);
        winRateSums.ALL.count++;
      }
    });
    
    // Calculate average win rates
    Object.keys(metrics).forEach((key) => {
      if (winRateSums[key].count > 0) {
        metrics[key].winRate = winRateSums[key].sum / winRateSums[key].count;
      }
    });
    
    return metrics;
  }, [overview?.bots, overview?.perBot]);

  // Determine if there are active filters (normalize stage to check validity)
  const normalizedStageForCheck = stageFilter?.toUpperCase();
  const hasValidStageFilter = normalizedStageForCheck && normalizedStageForCheck !== "ALL" && STAGE_PRIORITY[normalizedStageForCheck] !== undefined;
  const hasActiveFilters = hasValidStageFilter || statusFilter !== "all" || symbolFilter !== "all" || timeFilter !== "all";

  const resetFilters = () => {
    setStageFilter(null);
    setStatusFilter("all");
    setSymbolFilter("all");
    setTimeFilter("all");
  };

  const handleDelete = (id: string) => {
    setSelectedBotId(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (selectedBotId) {
      deleteBot.mutate(selectedBotId);
    }
    setDeleteDialogOpen(false);
    setSelectedBotId(null);
  };

  const toggleExpanded = (botId: string) => {
    setExpandedBots(prev => {
      const next = new Set(prev);
      if (next.has(botId)) {
        next.delete(botId);
      } else {
        next.add(botId);
      }
      return next;
    });
  };

  const scrollToBot = (botId: string) => {
    const el = botRefs.current.get(botId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setExpandedBots(prev => new Set(prev).add(botId));
    }
  };

  // Render content based on active tab
  const renderTabContent = () => {
    switch (activeTab) {
      case "fleet":
        return <FleetView />;
      case "tournaments":
        return <TournamentsView />;
      case "rankings":
        return <ComingSoonView title="Rankings" />;
      default:
        return renderBotList();
    }
  };

  const renderBotList = () => {
    // Error state with fallback to previous data
    if (error && !overview?.bots?.length) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return (
        <div className="space-y-4">
          <ErrorBanner
            endpoint="bots-overview"
            message={errorMessage}
            onRetry={() => refetch()}
          />
        </div>
      );
    }

    // Loading state (only on initial load)
    const hasBots = overview && overview.bots && overview.bots.length > 0;
    if (isLoading && !hasBots) {
      return (
        <div ref={botListRef} className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            </Card>
          ))}
        </div>
      );
    }

    // Empty state
    if (!filteredBots || filteredBots.length === 0) {
      return (
        <EmptyState
          icon={Bot}
          title={hasActiveFilters ? "No bots match filters" : "No bots yet"}
          description={
            hasActiveFilters
              ? "Try adjusting your filters or create a new bot"
              : "Create your first trading bot to get started"
          }
          action={
            !hasActiveFilters
              ? {
                  label: "Create Bot",
                  onClick: () => setCreateDialogOpen(true),
                  icon: Plus,
                }
              : undefined
          }
        >
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters} className="mt-3">
              Reset Filters
            </Button>
          )}
        </EmptyState>
      );
    }

    // Normal bot list - all data comes from overview
    return (
      <div ref={botListRef} className="space-y-2">
        {/* Show stale indicator if using cached data */}
        {overview && overview.source === "stale" && (
          <div className="text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
            Showing cached data • <button onClick={() => refetch()} className="underline">Refresh</button>
          </div>
        )}
        
        <AnimatePresence mode="popLayout">
        {filteredBots.map((overviewBot, index) => {
          const isExpanded = expandedBots.has(overviewBot.id);
          const perBot = overview?.perBot?.[overviewBot.id];
          
          // Convert overview data to formats expected by BotTableRow
          const bot = {
            ...toBot(overviewBot),
            // Add fields needed for Fresh badge logic (using guaranteed overview fields)
            simTotalTrades: overviewBot.session_trades + overviewBot.live_total_trades,
            lastBacktestAt: overviewBot.session_completed_at,
          };
          const metrics = toMetrics(overviewBot);
          const enrichedData = toEnriched(overviewBot, perBot);
          
          // Use actual runner/jobs data from API if available, fallback to overview
          const actualRunnerJobs = runnerJobsData?.[overviewBot.id];
          const runner = actualRunnerJobs?.runner ?? toRunner(perBot);
          const jobs = actualRunnerJobs?.jobs ?? toJobs(perBot);
          const improvementState = toImprovement(perBot);

          return (
            <motion.div
              key={overviewBot.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20, scale: 0.98 }}
              transition={{ 
                layout: { type: "spring", stiffness: 300, damping: 30 },
                opacity: { duration: 0.15 },
                y: { duration: 0.15 },
              }}
              ref={(el) => {
                if (el) botRefs.current.set(overviewBot.id, el);
              }}
              className="relative"
            >
              {/* Row number in left gutter - positioned absolutely so bot content aligns with elements above */}
              <span className="absolute -left-6 top-3 text-xs text-muted-foreground w-5 text-right">
                {index + 1}
              </span>
              <BotTableRow
                  bot={bot as any}
                  stage={overviewBot.stage}
                  symbol={overviewBot.symbol || "—"}
                  isExpanded={isExpanded}
                  onToggleExpanded={() => toggleExpanded(overviewBot.id)}
                  metrics={metrics}
                  enrichedData={enrichedData}
                  visibleColumns={visibleColumns}
                  onDelete={() => handleDelete(overviewBot.id)}
                  priorityScore={overviewBot.priority_score}
                  priorityBucket={overviewBot.priority_bucket as any}
                  priorityComputedAt={null}
                  runner={runner}
                  jobs={jobs}
                  runnerJobsLoading={runnerJobsLoading}
                  improvementState={improvementState}
                  latestDemotion={null}
                  candidateEval={null}
                  isPinned={pinnedBots.has(overviewBot.id)}
                  onTogglePin={() => togglePin(overviewBot.id)}
                  isRecentlyUpdated={recentlyUpdated.has(overviewBot.id)}
                  updatedAt={overviewBot.updated_at}
                  executionProof={executionProofData?.[overviewBot.id]}
                  executionProofDegraded={isExecutionProofDegraded}
                  // Backtest freshness data (industry-standard)
                  backtestStatus={overviewBot.backtest_status}
                  sessionCompletedAt={overviewBot.session_completed_at}
                  sessionAgeSeconds={overviewBot.session_age_seconds}
                  lastFailedAt={overviewBot.last_failed_at}
                  lastFailedReason={overviewBot.last_failed_reason}
                  failedSinceLastSuccess={overviewBot.failed_since_last_success}
                  strategyType={overviewBot.strategy_type}
                  lastDataSource={overviewBot.last_data_source}
                  labIdleInfo={overviewBot.stage === 'TRIALS' ? getLabIdleInfo(labStarvationData, overviewBot.id) : null}
                  matrixAggregate={overviewBot.matrix_aggregate}
                  matrixBestCell={overviewBot.matrix_best_cell}
                  matrixWorstCell={overviewBot.matrix_worst_cell}
                  lastMatrixCompletedAt={overviewBot.last_matrix_completed_at}
                  idleReason={overviewBot.idleReason}
                  queuedJobType={overviewBot.queuedJobType}
                  hasRunningJob={overviewBot.hasRunningJob}
                  displayAllowed={overview?.freshnessContract?.displayAllowed}
                  dataSource={overview?.freshnessContract?.dataSource}
                  isMaintenanceWindow={isMaintenanceWindow}
                />
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <AppLayout title="Bots">
      <TooltipProvider>
        <div className="space-y-2">

          {/* Stage Pipeline with integrated metrics and actions */}
          <AutonomyPipeline 
            selectedStage={stageFilter} 
            onStageSelect={(stage) => {
              setStageFilter(stage);
              setActiveTab("individual");
            }}
            onNewBotClick={() => setCreateDialogOpen(true)}
            stageMetrics={stageMetrics}
            actions={
              <>
                <PipelineActions
                  timeFilter={timeFilter}
                  onTimeChange={setTimeFilter}
                  statusFilter={statusFilter}
                  onStatusChange={setStatusFilter}
                  symbolFilter={symbolFilter}
                  onSymbolChange={setSymbolFilter}
                  availableSymbols={availableSymbols}
                  showArchived={showArchived}
                  onShowArchivedChange={setShowArchived}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                />
              </>
            }
          />

          {/* Row 3: Tab Content */}
          {renderTabContent()}
        </div>
      </TooltipProvider>

      <CreateBotDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bot</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this bot? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
