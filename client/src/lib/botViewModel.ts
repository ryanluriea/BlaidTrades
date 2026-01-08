/**
 * BOT ROW VIEW MODEL - SINGLE COMPUTED VIEW
 * 
 * This is the ONLY shape the UI should render from.
 * Eliminates flicker, contradictions, and duplicate badges.
 */

import { CanonicalBotState, evaluateCanonicalState, BotContext, InstanceContext, JobsSummary, ImprovementContext } from './canonicalStateEvaluator';
import { getPrimaryBlocker, BlockerDefinition, BLOCKER_CODES } from './blockerCodes';
import { scoreToBucket, PRIORITY_BUCKET_DISPLAY, STAGE_DISPLAY, type BotStageWithDegraded, type PriorityBucket } from './constants';
import { getDisplayHealthState, HEALTH_DISPLAY_COLORS, type DisplayHealthState } from './healthConstants';

// =============================================
// VIEW MODEL TYPES
// =============================================

export interface BadgeConfig {
  label: string;
  color: string;
  bgColor?: string;
  tooltip?: string;
  icon?: string;
  count?: number;
}

export interface LaneState {
  runner?: BadgeConfig | null;
  jobs?: BadgeConfig | null;
  evolution?: BadgeConfig | null;
  health?: BadgeConfig | null;
}

export interface BotRowViewModel {
  // Identity
  bot_id: string;
  name: string;
  nickname?: string;
  symbol: string;
  archetype?: string;
  
  // Stage & Priority
  stage: BotStageWithDegraded;
  stageBadge: BadgeConfig;
  priorityScore: number;
  priorityBucket: PriorityBucket;
  priorityBadge: BadgeConfig;
  
  // Lanes (max 1 badge per lane)
  lanes: LaneState;
  
  // Metrics (source-isolated)
  statsSource: 'BACKTEST' | 'PAPER' | 'LIVE' | 'MIXED';
  metrics: {
    totalTrades: number;
    winRate: number | null;
    profitFactor: number | null;
    maxDrawdownPct: number | null;
    sharpeRatio: number | null;
    expectancy: number | null;
    netPnl: number | null;
  };
  
  // Primary blocker (ONE only)
  primaryBlocker: {
    code: string;
    message: string;
    remediation: string;
    severity: 'CRITICAL' | 'WARNING' | 'INFO';
    autoHealable: boolean;
    eta?: string;
  } | null;
  
  // Why not trading/promoted (deduplicated)
  whyNotTrading: string[];
  whyNotPromoted: string[];
  
  // Actions
  nextAction?: string;
  nextActionEta?: string;
  suggestedActions: string[];
  
  // Health display
  healthState: DisplayHealthState;
  healthScore: number;
  healthColors: typeof HEALTH_DISPLAY_COLORS['OK'];
  
  // Timestamps
  lastHeartbeatAt?: string | null;
  lastBacktestAt?: string | null;
  lastTradeAt?: string | null;
  
  // Raw canonical state (for debugging)
  _canonicalState: CanonicalBotState;
}

// =============================================
// VIEW MODEL BUILDER
// =============================================

export interface BotRowData {
  id: string;
  name: string;
  nickname?: string;
  symbol: string;
  archetype?: string;
  stage: string;
  mode: string;
  is_trading_enabled: boolean;
  health_state?: string;
  health_reason?: string;
  health_score?: number;
  evolution_mode?: string;
  kill_state?: string;
  kill_reason_code?: string;
  kill_until?: string;
  priority_score?: number;
  priority_bucket?: string;
  // Metrics
  backtest_total_trades?: number;
  backtest_pnl?: number;
  backtest_win_rate?: number;
  backtest_profit_factor?: number;
  backtest_max_drawdown?: number;
  backtest_sharpe?: number;
  live_total_trades?: number;
  live_pnl?: number;
  live_win_rate?: number;
  live_profit_factor?: number;
  // Timestamps
  last_backtest_completed_at?: string;
  last_trade_at?: string;
}

export function buildBotRowViewModel(
  bot: BotRowData,
  instance: InstanceContext | null,
  jobs: JobsSummary,
  improvement?: ImprovementContext
): BotRowViewModel {
  // Build context for canonical evaluator
  const botContext: BotContext = {
    bot_id: bot.id,
    stage: bot.stage,
    mode: bot.mode,
    is_trading_enabled: bot.is_trading_enabled,
    health_state: bot.health_state,
    health_reason: bot.health_reason,
    health_score: bot.health_score,
    evolution_mode: bot.evolution_mode,
    kill_state: bot.kill_state,
    kill_reason_code: bot.kill_reason_code,
    kill_until: bot.kill_until,
  };

  // Evaluate canonical state
  const canonical = evaluateCanonicalState(botContext, instance, jobs, improvement);

  // Determine stats source
  const statsSource = determineStatsSource(bot.stage, bot.backtest_total_trades, bot.live_total_trades);

  // Build metrics based on source
  const metrics = buildMetrics(bot, statsSource);

  // Build stage badge
  const stageDisplay = STAGE_DISPLAY[bot.stage as BotStageWithDegraded] || STAGE_DISPLAY.TRIALS;
  const stageBadge: BadgeConfig = {
    label: stageDisplay.label,
    color: stageDisplay.color,
    bgColor: stageDisplay.color.replace('text-', 'bg-').replace('-400', '-500/10'),
  };

  // Build priority badge
  const priorityScore = bot.priority_score ?? 0;
  const healthState = canonical.health_state;
  const priorityBucket = scoreToBucket(priorityScore, healthState);
  const bucketDisplay = PRIORITY_BUCKET_DISPLAY[priorityBucket];
  const priorityBadge: BadgeConfig = {
    label: bucketDisplay.label,
    color: bucketDisplay.color,
    bgColor: bucketDisplay.bgColor,
    tooltip: bucketDisplay.description,
  };

  // Build lanes (max 1 badge per lane)
  const lanes = buildLanes(canonical, jobs);

  // Get primary blocker
  const blockerResult = getPrimaryBlocker(canonical.blockers);
  const primaryBlocker = blockerResult ? {
    code: blockerResult.code,
    message: blockerResult.definition.message,
    remediation: blockerResult.definition.remediation,
    severity: blockerResult.definition.severity,
    autoHealable: blockerResult.definition.auto_healable,
  } : null;

  // Deduplicate why lists
  const whyNotTrading = [...new Set(canonical.why_not_trading)];
  const whyNotPromoted = [...new Set(canonical.why_not_promoted)];

  // Get health display
  const displayHealthState = getDisplayHealthState(
    canonical.health_state,
    canonical.health_score,
    canonical.blockers.some(b => b.severity === 'CRITICAL')
  );
  const healthColors = HEALTH_DISPLAY_COLORS[displayHealthState];

  return {
    bot_id: bot.id,
    name: bot.name,
    nickname: bot.nickname,
    symbol: bot.symbol,
    archetype: bot.archetype,
    stage: bot.stage as BotStageWithDegraded,
    stageBadge,
    priorityScore,
    priorityBucket,
    priorityBadge,
    lanes,
    statsSource,
    metrics,
    primaryBlocker,
    whyNotTrading,
    whyNotPromoted,
    nextAction: canonical.suggested_actions[0],
    nextActionEta: canonical.next_action_at || undefined,
    suggestedActions: canonical.suggested_actions,
    healthState: displayHealthState,
    healthScore: canonical.health_score,
    healthColors,
    lastHeartbeatAt: canonical.last_heartbeat_at,
    lastBacktestAt: bot.last_backtest_completed_at,
    lastTradeAt: bot.last_trade_at,
    _canonicalState: canonical,
  };
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function determineStatsSource(
  stage: string,
  _backtestTrades?: number,
  _liveTrades?: number
): 'BACKTEST' | 'PAPER' | 'LIVE' | 'MIXED' {
  // CRITICAL: Stats source is determined by STAGE, not by trade count
  // This prevents showing backtest metrics for PAPER bots with 0 paper trades
  
  // TRIALS always uses backtest
  if (stage === 'TRIALS') return 'BACKTEST';
  
  // PAPER/SHADOW always use PAPER stats (even if 0 trades - show "—" not backtest)
  if (['PAPER', 'SHADOW'].includes(stage)) return 'PAPER';
  
  // LIVE/CANARY use LIVE stats
  if (stage === 'LIVE' || stage === 'CANARY') return 'LIVE';
  
  // Default for unknown stages
  return 'BACKTEST';
}

function buildMetrics(bot: BotRowData, source: 'BACKTEST' | 'PAPER' | 'LIVE' | 'MIXED') {
  // Use source-appropriate metrics
  if (source === 'BACKTEST') {
    return {
      totalTrades: bot.backtest_total_trades ?? 0,
      winRate: bot.backtest_win_rate ?? null,
      profitFactor: bot.backtest_profit_factor ?? null,
      maxDrawdownPct: bot.backtest_max_drawdown ?? null,
      sharpeRatio: bot.backtest_sharpe ?? null,
      expectancy: null, // Calculate if needed
      netPnl: bot.backtest_pnl ?? null,
    };
  }
  
  // PAPER/LIVE use live_* fields
  return {
    totalTrades: bot.live_total_trades ?? 0,
    winRate: bot.live_win_rate ?? null,
    profitFactor: bot.live_profit_factor ?? null,
    maxDrawdownPct: null, // Live DD tracked differently
    sharpeRatio: null,
    expectancy: null,
    netPnl: bot.live_pnl ?? null,
  };
}

function buildLanes(canonical: CanonicalBotState, jobs: JobsSummary): LaneState {
  const lanes: LaneState = {};

  // Runner lane - only show if issue
  if (['STALLED', 'ERROR', 'CIRCUIT_BREAK', 'RESTARTING'].includes(canonical.runner_state)) {
    lanes.runner = {
      label: canonical.runner_state === 'RESTARTING' ? 'Restarting' : canonical.runner_state,
      color: canonical.runner_state === 'STALLED' ? 'text-amber-400' : 'text-red-400',
      bgColor: canonical.runner_state === 'STALLED' ? 'bg-amber-500/10' : 'bg-red-500/10',
      tooltip: canonical.runner_reason,
    };
  } else if (canonical.runner_state === 'SCANNING') {
    lanes.runner = {
      label: 'Scanning',
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    };
  } else if (canonical.runner_state === 'TRADING') {
    lanes.runner = {
      label: 'Trading',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    };
  }

  // Jobs lane - aggregate count if multiple
  if (canonical.job_state !== 'IDLE') {
    const totalJobs = jobs.total_queued + jobs.total_running;
    const isRunning = jobs.total_running > 0;
    
    let label = canonical.job_state.replace('_', ' ');
    if (totalJobs > 1) {
      label = `${totalJobs} jobs`;
    }
    
    lanes.jobs = {
      label,
      color: isRunning ? 'text-blue-400' : 'text-slate-400',
      bgColor: isRunning ? 'bg-blue-500/10' : 'bg-slate-500/10',
      tooltip: canonical.job_reason,
      count: totalJobs > 1 ? totalJobs : undefined,
    };
  }

  // Evolution lane - only show if active
  if (canonical.evolution_state !== 'IDLE') {
    lanes.evolution = {
      label: canonical.evolution_state === 'COOLDOWN' ? 'Cooldown' : 'Evolving',
      color: canonical.evolution_state === 'COOLDOWN' ? 'text-slate-400' : 'text-purple-400',
      bgColor: canonical.evolution_state === 'COOLDOWN' ? 'bg-slate-500/10' : 'bg-purple-500/10',
      tooltip: canonical.evolution_reason,
    };
  }

  // Health lane - only show if NOT OK
  if (canonical.health_state !== 'OK') {
    const healthDisplay = HEALTH_DISPLAY_COLORS[canonical.health_state as DisplayHealthState];
    lanes.health = {
      label: healthDisplay?.label || canonical.health_state,
      color: healthDisplay?.text || 'text-red-400',
      bgColor: healthDisplay?.bg || 'bg-red-500/10',
      tooltip: canonical.health_reason,
    };
  }

  return lanes;
}

// =============================================
// BATCH VIEW MODEL BUILDER
// =============================================

export function buildBotRowViewModels(
  bots: BotRowData[],
  instancesMap: Map<string, InstanceContext>,
  jobsMap: Map<string, JobsSummary>,
  improvementMap: Map<string, ImprovementContext>
): BotRowViewModel[] {
  return bots.map(bot => {
    const instance = instancesMap.get(bot.id) || null;
    const jobs = jobsMap.get(bot.id) || {
      backtest_queued: 0, backtest_running: 0,
      evaluate_queued: 0, evaluate_running: 0,
      evolve_queued: 0, evolve_running: 0,
      runner_start_queued: 0, runner_restart_queued: 0,
      priority_compute_queued: 0,
      total_queued: 0, total_running: 0,
    };
    const improvement = improvementMap.get(bot.id);
    
    return buildBotRowViewModel(bot, instance, jobs, improvement);
  });
}
