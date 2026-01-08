/**
 * Evolution Engine - Real Strategy Mutation
 * 
 * This module implements actual genetic evolution of trading strategies.
 * NO cosmetic changes - only material mutations that change behavior.
 * 
 * Evolution types:
 * - Parameter mutation (TP/SL ticks, EMA periods, etc.)
 * - Rule variation (add/remove confirmations)
 * - Risk tuning (position size, daily loss limits)
 * - Session optimization (trading hours, no-trade windows)
 */

import { 
  type StrategyRules, 
  type EntryCondition,
  type TakeProfitRule,
  type StopLossRule,
  createStrategyRules,
  getStrategyDiff,
  isMaterialChange,
} from "./strategy-rules";
import { storage } from "./storage";
import { db } from "./db";
import { botGenerations } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import * as crypto from "crypto";

export interface EvolutionResult {
  evolved: boolean;
  newRules: StrategyRules;
  oldRules: StrategyRules;
  changes: { field: string; oldValue: any; newValue: any }[];
  reason: string;
  newGeneration?: number;
}

/**
 * Generate human-readable markdown description of strategy rules
 */
function strategyToMarkdown(rules: StrategyRules): string {
  const lines: string[] = [];
  
  lines.push(`## ${rules.archetype.replace(/_/g, ' ')}`);
  lines.push(`Version: ${rules.version}`);
  lines.push('');
  
  lines.push('### Entry Conditions');
  const entry = rules.entry;
  if (entry.condition) {
    const cond = entry.condition;
    lines.push(`- Type: ${cond.type}`);
    if (cond.params) {
      const params = Object.entries(cond.params)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (params) lines.push(`- Parameters: ${params}`);
    }
  }
  if (entry.confirmations?.length) {
    lines.push(`- Confirmations: ${entry.confirmations.join(', ')}`);
  }
  lines.push('');
  
  lines.push('### Exit Rules');
  if (rules.exit.takeProfit?.length) {
    const tp = rules.exit.takeProfit[0];
    lines.push(`- Take Profit: ${tp.ticks || tp.percent || tp.atrMultiple} ${tp.ticks ? 'ticks' : tp.percent ? '%' : 'ATR'}`);
  }
  if (rules.exit.stopLoss?.length) {
    const sl = rules.exit.stopLoss[0];
    lines.push(`- Stop Loss: ${sl.ticks || sl.percent || sl.atrMultiple} ${sl.ticks ? 'ticks' : sl.percent ? '%' : 'ATR'}`);
  }
  if (rules.exit.trailingStop) {
    lines.push(`- Trailing Stop: Active`);
  }
  if (rules.exit.timeStop) {
    lines.push(`- Time Stop: ${rules.exit.timeStop.maxBarsInTrade} bars max`);
  }
  lines.push('');
  
  lines.push('### Risk Management');
  lines.push(`- Risk Per Trade: ${rules.risk.riskPerTrade}%`);
  lines.push(`- Max Daily Loss: ${rules.risk.maxDailyLoss}%`);
  lines.push(`- Max Positions: ${rules.risk.maxPositions}`);
  lines.push('');
  
  lines.push('### Session');
  lines.push(`- Type: ${rules.session.sessionType}`);
  if (rules.session.tradingDays?.length) {
    lines.push(`- Trading Days: ${rules.session.tradingDays.join(', ')}`);
  }
  
  return lines.join('\n');
}

/**
 * Generate mutation objective description based on evolution direction
 * Note: winRate is stored as 0-1 ratio, need to multiply by 100 for display
 */
function getMutationObjective(direction: string, metrics: PerformanceMetrics): string {
  // Convert winRate from 0-1 ratio to percentage for display
  const winRatePct = metrics.winRate <= 1 ? metrics.winRate * 100 : metrics.winRate;
  
  switch (direction) {
    case 'IMPROVE_WIN_RATE':
      return `Improve win rate from ${winRatePct.toFixed(1)}% toward 50%+ target through tighter entry conditions and better confirmation signals.`;
    case 'REDUCE_DRAWDOWN':
      return `Reduce max drawdown from ${metrics.maxDrawdownPct.toFixed(1)}% toward 15% target through tighter stops and position sizing adjustments.`;
    case 'INCREASE_REWARD':
      return `Improve profit factor from ${metrics.profitFactor.toFixed(2)}x toward 1.5x+ target by optimizing take-profit levels and reward-to-risk ratios.`;
    case 'REDUCE_RISK':
      return `Reduce overall risk exposure by adjusting position sizes, tightening daily loss limits, and adding protective filters.`;
    case 'OPTIMIZE_TIMING':
      return `Optimize entry/exit timing through session adjustments, no-trade windows, and time-based filters.`;
    default:
      return `Evolve strategy parameters to improve overall performance metrics.`;
  }
}

export interface PerformanceMetrics {
  winRate: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  totalTrades: number;
  netPnl: number;
}

// Evolution parameters
const MUTATION_RANGES = {
  // Entry parameters
  breakoutBars: { min: 5, max: 20, step: 1 },
  breakoutThreshold: { min: 4, max: 16, step: 2 },
  deviationBands: { min: 1.5, max: 3.0, step: 0.25 },
  rsiOversold: { min: 20, max: 35, step: 5 },
  rsiOverbought: { min: 65, max: 80, step: 5 },
  vwapDeviation: { min: 0.25, max: 1.0, step: 0.25 },
  emaShort: { min: 5, max: 13, step: 2 },
  emaLong: { min: 15, max: 30, step: 3 },
  
  // Exit parameters
  takeProfitTicks: { min: 6, max: 30, step: 2 },
  stopLossTicks: { min: 4, max: 20, step: 2 },
  riskMultiple: { min: 1.5, max: 4.0, step: 0.5 },
  atrMultiple: { min: 1.0, max: 3.0, step: 0.5 },
  maxBarsInTrade: { min: 8, max: 30, step: 4 },
  
  // Risk parameters
  riskPerTrade: { min: 0.5, max: 2.0, step: 0.25 },
  maxDailyLoss: { min: 1.5, max: 5.0, step: 0.5 },
};

/**
 * Evolve a bot's strategy based on performance metrics
 */
export async function evolveStrategy(
  botId: string,
  currentRules: StrategyRules,
  metrics: PerformanceMetrics,
  traceId: string
): Promise<EvolutionResult> {
  const bot = await storage.getBot(botId);
  if (!bot) {
    return {
      evolved: false,
      newRules: currentRules,
      oldRules: currentRules,
      changes: [],
      reason: "Bot not found",
    };
  }

  // Analyze performance to determine evolution direction
  const evolutionDirection = analyzePerformance(metrics);
  
  if (evolutionDirection === "HOLD") {
    console.log(`[EVOLUTION] trace_id=${traceId} bot_id=${botId} direction=HOLD reason=metrics_acceptable`);
    return {
      evolved: false,
      newRules: currentRules,
      oldRules: currentRules,
      changes: [],
      reason: "Performance within acceptable range - no evolution needed",
    };
  }

  // Create mutated rules based on performance direction
  const newRules = mutateStrategy(currentRules, evolutionDirection, metrics);
  
  // Check if changes are material
  const changes = getStrategyDiff(currentRules, newRules);
  const isMaterial = isMaterialChange(changes);
  
  if (!isMaterial || changes.length === 0) {
    console.log(`[EVOLUTION] trace_id=${traceId} bot_id=${botId} direction=${evolutionDirection} changes=0 material=false`);
    return {
      evolved: false,
      newRules: currentRules,
      oldRules: currentRules,
      changes: [],
      reason: "No material changes produced",
    };
  }

  // Update version and timestamp
  const versionParts = currentRules.version.split(".");
  const newPatch = parseInt(versionParts[2] || "0") + 1;
  newRules.version = `${versionParts[0]}.${versionParts[1]}.${newPatch}`;
  newRules.lastModifiedAt = new Date().toISOString();
  newRules.changeReason = `Evolution: ${evolutionDirection} - ${changes.map(c => c.field).join(", ")}`;

  // INSTITUTIONAL: Source generation from authoritative bots.currentGeneration field
  const currentGen = bot.currentGeneration || 1;
  const newGeneration = currentGen + 1;

  // INSTITUTIONAL: Snapshot performance before evolution for audit trail
  const preEvolutionSnapshot = {
    generation: currentGen,
    snapshotAt: new Date().toISOString(),
    performanceMetrics: metrics,
    strategyVersion: currentRules.version,
  };

  // Generate ID and pass it to insert so we can reference it in bot update
  const generationId = crypto.randomUUID();

  // Generate human-readable mutation objective and strategy rules
  const mutationObjective = getMutationObjective(evolutionDirection, metrics);
  const humanRulesMd = strategyToMarkdown(newRules);
  
  // Format changes for summaryDiff display
  const summaryDiffText = changes
    .map(c => `${c.field}: ${JSON.stringify(c.oldValue)} → ${JSON.stringify(c.newValue)}`)
    .join('\n');

  // INSTITUTIONAL: Extract timeframe from strategy config for generation immutability
  // CRITICAL: timeframe MUST never be null - use fallback chain with sensible default
  const generationTimeframe = (newRules as any)?.timeframe || 
                               (bot.strategyConfig as any)?.timeframe || 
                               '5m'; // Default to 5m if no timeframe found (should never happen post-reset)

  await db.insert(botGenerations).values({
    id: generationId,  // Explicitly set ID so we can use it in bot update
    botId,
    generationNumber: newGeneration,
    strategyConfig: newRules,
    riskConfig: {
      riskPerTrade: newRules.risk.riskPerTrade,
      maxDailyLoss: newRules.risk.maxDailyLoss,
      maxPositionSize: newRules.risk.maxPositionSize,
    },
    parentGenerationId: bot.currentGenerationId || null,
    parentGenerationNumber: currentGen,
    mutationReasonCode: evolutionDirection,
    mutationObjective,  // Human-readable evolution goal
    humanRulesMd,       // Markdown strategy rules for audit
    summaryTitle: `Evolution: ${evolutionDirection}`,
    summaryDiff: summaryDiffText,  // Text format for UI display
    mutationsSummary: {
      direction: evolutionDirection,
      changeCount: changes.length,
      fields: changes.map(c => c.field),
    },
    // INSTITUTIONAL: New generation starts with null performance - metrics populated after backtest
    // Parent's pre-evolution snapshot stored in parentSnapshot for audit trail, NOT as this gen's metrics
    performanceSnapshot: null,
    parentSnapshot: preEvolutionSnapshot,  // Audit: parent's state at evolution time
    // Record stage at time of generation creation for institutional audit
    stage: bot.stage || "TRIALS",
    // INSTITUTIONAL: Record timeframe at generation creation for immutability enforcement
    timeframe: generationTimeframe,
  });

  // INSTITUTIONAL: Update bot with new generation + P&L reset for baseline
  // Reset sim metrics (used as session proxy) while preserving lifetime totals (livePnl, liveTotalTrades)
  await storage.updateBot(botId, {
    currentGenerationId: generationId,
    currentGeneration: newGeneration,
    strategyConfig: newRules,
    updatedAt: new Date(),
    // P&L Reset on generation change - use schema fields that exist
    metricsResetAt: new Date(),
    metricsResetReasonCode: "GENERATION_EVOLUTION",
    metricsResetBy: "EVOLUTION_ENGINE",
    metricsResetScope: "SESSION",
    // Reset sim metrics (simPnl/simTotalTrades are the session metrics proxy)
    simPnl: 0,
    simTotalTrades: 0,
  });

  // Log evolution event
  await logActivityEvent({
    botId,
    eventType: "EVOLUTION_COMPLETED",
    severity: "INFO",
    title: `Evolution: Gen ${currentGen} → Gen ${newGeneration}`,
    summary: `${changes.length} parameter changes: ${changes.map(c => c.field).slice(0, 3).join(", ")}`,
    payload: {
      oldGeneration: currentGen,
      newGeneration,
      evolutionDirection,
      changes,
      oldVersion: currentRules.version,
      newVersion: newRules.version,
      metrics,
    },
    traceId,
  });

  console.log(`[EVOLUTION] trace_id=${traceId} bot_id=${botId} gen=${currentGen}->${newGeneration} direction=${evolutionDirection} changes=${changes.length}`);

  return {
    evolved: true,
    newRules,
    oldRules: currentRules,
    changes,
    reason: `Evolved: ${evolutionDirection}`,
    newGeneration,
  };
}

/**
 * Analyze performance to determine evolution direction
 */
function analyzePerformance(metrics: PerformanceMetrics): "IMPROVE_WIN_RATE" | "REDUCE_DRAWDOWN" | "INCREASE_REWARD" | "REDUCE_RISK" | "OPTIMIZE_TIMING" | "HOLD" {
  // Check if already performing well
  if (
    metrics.winRate >= 55 &&
    metrics.sharpeRatio >= 1.5 &&
    metrics.maxDrawdownPct <= 10 &&
    metrics.profitFactor >= 1.5
  ) {
    return "HOLD";
  }

  // Priority 1: Fix excessive drawdown
  if (metrics.maxDrawdownPct > 20) {
    return "REDUCE_DRAWDOWN";
  }

  // Priority 2: Fix low win rate
  if (metrics.winRate < 40) {
    return "IMPROVE_WIN_RATE";
  }

  // Priority 3: Fix poor risk/reward
  if (metrics.profitFactor < 1.2 || (metrics.avgWin && metrics.avgLoss && Math.abs(metrics.avgWin / metrics.avgLoss) < 1.5)) {
    return "INCREASE_REWARD";
  }

  // Priority 4: Reduce risk if losing money
  if (metrics.netPnl < 0) {
    return "REDUCE_RISK";
  }

  // Priority 5: Optimize timing for marginal improvement
  if (metrics.totalTrades < 10) {
    return "OPTIMIZE_TIMING";
  }

  return "HOLD";
}

/**
 * Mutate strategy based on evolution direction
 */
function mutateStrategy(
  rules: StrategyRules,
  direction: string,
  metrics: PerformanceMetrics
): StrategyRules {
  // Deep clone rules
  const newRules: StrategyRules = JSON.parse(JSON.stringify(rules));

  switch (direction) {
    case "IMPROVE_WIN_RATE":
      mutateForWinRate(newRules);
      break;
      
    case "REDUCE_DRAWDOWN":
      mutateForDrawdown(newRules);
      break;
      
    case "INCREASE_REWARD":
      mutateForReward(newRules);
      break;
      
    case "REDUCE_RISK":
      mutateForRisk(newRules);
      break;
      
    case "OPTIMIZE_TIMING":
      mutateForTiming(newRules);
      break;
  }

  return newRules;
}

function mutateForWinRate(rules: StrategyRules): void {
  // Tighten entry conditions to be more selective
  const entry = rules.entry.condition;
  
  if (entry.breakoutBars) {
    entry.breakoutBars = Math.min(entry.breakoutBars + 2, MUTATION_RANGES.breakoutBars.max);
  }
  
  if (entry.breakoutThreshold) {
    entry.breakoutThreshold = Math.min(entry.breakoutThreshold + 2, MUTATION_RANGES.breakoutThreshold.max);
  }
  
  if (entry.deviationBands) {
    entry.deviationBands = Math.min(entry.deviationBands + 0.25, MUTATION_RANGES.deviationBands.max);
  }
  
  // Widen stops slightly to avoid getting stopped out prematurely
  for (const sl of rules.exit.stopLoss) {
    if (sl.ticks) {
      sl.ticks = Math.min(sl.ticks + 2, MUTATION_RANGES.stopLossTicks.max);
    }
  }
  
  // Add volume confirmation if not present
  if (!rules.entry.confirmations.find(c => c.type === "VOLUME")) {
    rules.entry.confirmations.push({ type: "VOLUME", volumeMultiplier: 1.3 });
  }
}

function mutateForDrawdown(rules: StrategyRules): void {
  // Reduce position size
  rules.risk.maxPositionSize = Math.max(1, rules.risk.maxPositionSize - 1);
  
  // Reduce risk per trade
  rules.risk.riskPerTrade = Math.max(
    MUTATION_RANGES.riskPerTrade.min,
    rules.risk.riskPerTrade - 0.25
  );
  
  // Tighten max daily loss
  rules.risk.maxDailyLoss = Math.max(
    MUTATION_RANGES.maxDailyLoss.min,
    rules.risk.maxDailyLoss - 0.5
  );
  
  // Tighten stops
  for (const sl of rules.exit.stopLoss) {
    if (sl.ticks) {
      sl.ticks = Math.max(MUTATION_RANGES.stopLossTicks.min, sl.ticks - 2);
    }
  }
  
  // Add time stop if not present
  if (!rules.exit.timeStop) {
    rules.exit.timeStop = { maxBarsInTrade: 15 };
  } else if (rules.exit.timeStop.maxBarsInTrade) {
    rules.exit.timeStop.maxBarsInTrade = Math.max(8, rules.exit.timeStop.maxBarsInTrade - 4);
  }
}

function mutateForReward(rules: StrategyRules): void {
  // Increase take profit targets
  for (const tp of rules.exit.takeProfit) {
    if (tp.ticks) {
      tp.ticks = Math.min(tp.ticks + 4, MUTATION_RANGES.takeProfitTicks.max);
    }
    if (tp.riskMultiple) {
      tp.riskMultiple = Math.min(tp.riskMultiple + 0.5, MUTATION_RANGES.riskMultiple.max);
    }
  }
  
  // Add trailing stop if not present
  if (!rules.exit.trailingStop) {
    rules.exit.trailingStop = {
      activationTicks: 10,
      trailDistance: 6,
      stepSize: 2,
    };
  } else if (rules.exit.trailingStop.trailDistance) {
    // Tighten trailing stop to lock in more profit
    rules.exit.trailingStop.trailDistance = Math.max(4, rules.exit.trailingStop.trailDistance - 2);
  }
}

function mutateForRisk(rules: StrategyRules): void {
  // Reduce position size
  rules.risk.maxPositionSize = Math.max(1, rules.risk.maxPositionSize - 1);
  
  // Reduce risk per trade
  rules.risk.riskPerTrade = Math.max(
    MUTATION_RANGES.riskPerTrade.min,
    rules.risk.riskPerTrade * 0.75
  );
  
  // Tighten daily loss limit
  rules.risk.maxDailyLoss = Math.max(
    MUTATION_RANGES.maxDailyLoss.min,
    rules.risk.maxDailyLoss * 0.8
  );
  
  // Tighten stops
  for (const sl of rules.exit.stopLoss) {
    if (sl.ticks) {
      sl.ticks = Math.max(MUTATION_RANGES.stopLossTicks.min, Math.round(sl.ticks * 0.8));
    }
    if (sl.atrMultiple) {
      sl.atrMultiple = Math.max(0.75, sl.atrMultiple - 0.25);
    }
  }
}

function mutateForTiming(rules: StrategyRules): void {
  // Adjust session times
  if (rules.session.rthStart === "09:30") {
    rules.session.rthStart = "09:40"; // Wait for opening volatility to settle
  }
  
  if (rules.session.rthEnd === "16:00") {
    rules.session.rthEnd = "15:45"; // Avoid closing volatility
  }
  
  // Add lunch hour no-trade window if not present
  const hasLunchWindow = rules.session.noTradeWindows.some(
    w => w.start === "12:00" || w.reason.toLowerCase().includes("lunch")
  );
  
  if (!hasLunchWindow) {
    rules.session.noTradeWindows.push({
      reason: "Lunch hours - low volatility",
      start: "12:00",
      end: "13:00",
    });
  }
  
  // Adjust entry timing parameters
  const entry = rules.entry.condition;
  if (entry.breakoutBars) {
    // Try fewer bars for faster entry
    entry.breakoutBars = Math.max(MUTATION_RANGES.breakoutBars.min, entry.breakoutBars - 1);
  }
}

/**
 * Get evolution history for a bot
 */
export async function getEvolutionHistory(
  botId: string,
  limit: number = 10
): Promise<{
  generation: number;
  evolutionType: string | null;
  mutationDetails: any;
  createdAt: Date;
}[]> {
  const generations = await db.query.botGenerations.findMany({
    where: eq(botGenerations.botId, botId),
    orderBy: [desc(botGenerations.generationNumber)],
    limit,
  });

  return generations.map(g => ({
    generation: g.generationNumber,
    evolutionType: g.mutationReasonCode,
    mutationDetails: g.summaryDiff,
    createdAt: g.createdAt,
  }));
}

/**
 * Compare two generations and return performance delta
 */
export async function compareGenerations(
  botId: string,
  gen1: number,
  gen2: number
): Promise<{
  ruleChanges: { field: string; oldValue: any; newValue: any }[];
  performanceDelta: {
    winRate: number;
    sharpe: number;
    maxDrawdown: number;
    pnl: number;
  } | null;
} | null> {
  const generations = await db.query.botGenerations.findMany({
    where: eq(botGenerations.botId, botId),
  });

  const g1 = generations.find(g => g.generationNumber === gen1);
  const g2 = generations.find(g => g.generationNumber === gen2);

  if (!g1 || !g2) {
    return null;
  }

  const rules1 = g1.strategyConfig as StrategyRules;
  const rules2 = g2.strategyConfig as StrategyRules;

  const ruleChanges = getStrategyDiff(rules1, rules2);

  // Performance delta would need backtest results - return null for now
  return {
    ruleChanges,
    performanceDelta: null,
  };
}
