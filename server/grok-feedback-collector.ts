import { db } from "./db";
import { grokFeedback, grokInjections, bots, strategyCandidates } from "@shared/schema";
import { eq, sql, desc, and, isNotNull } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { runGrokResearch, type GrokResearchContext } from "./grok-research-engine";

export interface GrokPerformanceSnapshot {
  sharpe?: number | null;
  winRate?: number | null;
  maxDrawdownPct?: number | null;
  profitFactor?: number | null;
  tradeCount?: number | null;
  netPnl?: number | null;
}

export interface GrokGateContext {
  gateName?: string;
  gateThreshold?: number;
  gateActualValue?: number;
  gatePassed?: boolean;
}

export interface GrokFeedbackEvent {
  botId: string;
  eventType: "PROMOTION" | "DEMOTION" | "GATE_PASSED" | "GATE_FAILED" | "MILESTONE" | "EVOLUTION_TRIGGERED" | "STRATEGY_RETIRED" | "LIVE_PERFORMANCE";
  previousStage?: string;
  currentStage?: string;
  performance: GrokPerformanceSnapshot;
  gateContext?: GrokGateContext;
  failureReason?: string;
  successPatterns?: Record<string, any>;
  improvementSuggestions?: Record<string, any>;
  traceId?: string;
}

export async function logGrokFeedback(event: GrokFeedbackEvent): Promise<string | null> {
  try {
    const grokInjection = await db
      .select({ id: grokInjections.id, strategyName: grokInjections.strategyName })
      .from(grokInjections)
      .where(eq(grokInjections.botId, event.botId))
      .limit(1);

    if (grokInjection.length === 0) {
      return null;
    }

    const injectionId = grokInjection[0].id;
    const strategyName = grokInjection[0].strategyName;

    const [feedback] = await db.insert(grokFeedback).values({
      injectionId,
      botId: event.botId,
      eventType: event.eventType,
      previousStage: event.previousStage,
      currentStage: event.currentStage,
      sharpe: event.performance.sharpe,
      winRate: event.performance.winRate,
      maxDrawdownPct: event.performance.maxDrawdownPct,
      profitFactor: event.performance.profitFactor,
      tradeCount: event.performance.tradeCount,
      netPnl: event.performance.netPnl,
      gateName: event.gateContext?.gateName,
      gateThreshold: event.gateContext?.gateThreshold,
      gateActualValue: event.gateContext?.gateActualValue,
      gatePassed: event.gateContext?.gatePassed,
      failureReason: event.failureReason,
      successPatterns: event.successPatterns || {},
      improvementSuggestions: event.improvementSuggestions || {},
    }).returning({ id: grokFeedback.id });

    console.log(`[GROK_FEEDBACK] Logged ${event.eventType} for bot ${event.botId.slice(0,8)} strategy="${strategyName}" feedback_id=${feedback.id.slice(0,8)}`);

    return feedback.id;
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to log feedback:", error);
    return null;
  }
}

export async function getRecentGrokFeedback(limit: number = 20): Promise<{
  successes: Array<{ strategyName: string; stage: string; sharpe: number; patterns: Record<string, any> }>;
  failures: Array<{ strategyName: string; stage: string; failureReason: string; suggestions: Record<string, any> }>;
  performanceTrends: Record<string, any>;
}> {
  try {
    const feedbackRows = await db.execute(sql`
      SELECT 
        gf.*,
        gi.strategy_name,
        gi.archetype_name,
        gi.hypothesis,
        gi.confidence_score,
        gi.evolution_generation
      FROM grok_feedback gf
      JOIN grok_injections gi ON gf.injection_id = gi.id
      WHERE gf.created_at > NOW() - INTERVAL '7 days'
      ORDER BY gf.created_at DESC
      LIMIT ${limit}
    `);

    const rows = feedbackRows.rows as any[];

    const successes = rows
      .filter(r => r.event_type === "PROMOTION" || r.event_type === "GATE_PASSED" || r.event_type === "MILESTONE")
      .map(r => ({
        strategyName: r.strategy_name,
        stage: r.current_stage,
        sharpe: r.sharpe || 0,
        patterns: r.success_patterns || {},
        archetypeName: r.archetype_name,
        hypothesis: r.hypothesis,
      }));

    const failures = rows
      .filter(r => r.event_type === "DEMOTION" || r.event_type === "GATE_FAILED" || r.event_type === "STRATEGY_RETIRED")
      .map(r => ({
        strategyName: r.strategy_name,
        stage: r.current_stage,
        failureReason: r.failure_reason || "Unknown",
        suggestions: r.improvement_suggestions || {},
        archetypeName: r.archetype_name,
        hypothesis: r.hypothesis,
      }));

    const avgSharpeByArchetype: Record<string, { sum: number; count: number }> = {};
    rows.forEach(r => {
      if (r.archetype_name && r.sharpe) {
        if (!avgSharpeByArchetype[r.archetype_name]) {
          avgSharpeByArchetype[r.archetype_name] = { sum: 0, count: 0 };
        }
        avgSharpeByArchetype[r.archetype_name].sum += r.sharpe;
        avgSharpeByArchetype[r.archetype_name].count++;
      }
    });

    const performanceTrends: Record<string, any> = {
      archetypePerformance: Object.fromEntries(
        Object.entries(avgSharpeByArchetype).map(([k, v]) => [k, v.sum / v.count])
      ),
      successCount: successes.length,
      failureCount: failures.length,
      successRate: successes.length / Math.max(successes.length + failures.length, 1),
    };

    return { successes, failures, performanceTrends };
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to get recent feedback:", error);
    return { successes: [], failures: [], performanceTrends: {} };
  }
}

export function buildFeedbackContextForGrok(feedback: Awaited<ReturnType<typeof getRecentGrokFeedback>>): string {
  const lines: string[] = [];

  lines.push("=== RECENT PERFORMANCE FEEDBACK FROM YOUR STRATEGIES ===");
  lines.push("");

  if (feedback.performanceTrends.successRate !== undefined) {
    const successPct = (feedback.performanceTrends.successRate * 100).toFixed(0);
    lines.push(`Overall Success Rate: ${successPct}% (${feedback.performanceTrends.successCount} wins, ${feedback.performanceTrends.failureCount} failures)`);
    lines.push("");
  }

  if (Object.keys(feedback.performanceTrends.archetypePerformance || {}).length > 0) {
    lines.push("ARCHETYPE PERFORMANCE (avg Sharpe):");
    for (const [archetype, avgSharpe] of Object.entries(feedback.performanceTrends.archetypePerformance)) {
      const sharpeStr = (avgSharpe as number).toFixed(2);
      const rating = (avgSharpe as number) > 1.0 ? "STRONG" : (avgSharpe as number) > 0.5 ? "OK" : "WEAK";
      lines.push(`  - ${archetype}: ${sharpeStr} (${rating})`);
    }
    lines.push("");
  }

  if (feedback.successes.length > 0) {
    lines.push("WINNING STRATEGIES (replicate these patterns):");
    for (const s of feedback.successes.slice(0, 5)) {
      lines.push(`  - "${s.strategyName}" reached ${s.stage} with Sharpe ${s.sharpe?.toFixed(2) || 'N/A'}`);
      if (Object.keys(s.patterns).length > 0) {
        lines.push(`    Patterns: ${JSON.stringify(s.patterns)}`);
      }
    }
    lines.push("");
  }

  if (feedback.failures.length > 0) {
    lines.push("FAILED STRATEGIES (avoid these patterns):");
    for (const f of feedback.failures.slice(0, 5)) {
      lines.push(`  - "${f.strategyName}" failed at ${f.stage}: ${f.failureReason}`);
      if (Object.keys(f.suggestions).length > 0) {
        lines.push(`    Improvement suggestions: ${JSON.stringify(f.suggestions)}`);
      }
    }
    lines.push("");
  }

  if (feedback.successes.length === 0 && feedback.failures.length === 0) {
    lines.push("No recent feedback available. Generate diverse strategies across different archetypes.");
    lines.push("");
  }

  lines.push("=== END FEEDBACK ===");
  lines.push("");
  lines.push("Use this feedback to improve your next batch of strategy candidates.");
  lines.push("Focus on archetypes that are performing well and avoid patterns that led to failures.");

  return lines.join("\n");
}

export async function checkGrokBotAndLogPromotion(
  botId: string,
  previousStage: string,
  newStage: string,
  performance: GrokPerformanceSnapshot,
  traceId?: string
): Promise<void> {
  const isGrokBot = await db
    .select({ id: grokInjections.id })
    .from(grokInjections)
    .where(eq(grokInjections.botId, botId))
    .limit(1);

  if (isGrokBot.length === 0) {
    return;
  }

  const stageOrder = ["LAB", "TRIALS", "PAPER", "SHADOW", "CANARY", "LIVE"];
  const prevIndex = stageOrder.indexOf(previousStage);
  const newIndex = stageOrder.indexOf(newStage);

  if (newIndex > prevIndex) {
    await logGrokFeedback({
      botId,
      eventType: "PROMOTION",
      previousStage,
      currentStage: newStage,
      performance,
      successPatterns: {
        promoted_at: new Date().toISOString(),
        stage_jump: `${previousStage}->${newStage}`,
      },
      traceId,
    });

    await db.update(grokInjections)
      .set({
        promotedAt: new Date(),
        promotedToStage: newStage,
        updatedAt: new Date(),
      })
      .where(eq(grokInjections.botId, botId));

  } else if (newIndex < prevIndex) {
    await logGrokFeedback({
      botId,
      eventType: "DEMOTION",
      previousStage,
      currentStage: newStage,
      performance,
      failureReason: `Demoted from ${previousStage} to ${newStage}`,
      improvementSuggestions: {
        review_gates: true,
        consider_archetype_change: performance.sharpe && performance.sharpe < 0.5,
      },
      traceId,
    });

    await db.update(grokInjections)
      .set({
        failedAt: new Date(),
        failureReason: `Demoted from ${previousStage} to ${newStage}`,
        updatedAt: new Date(),
      })
      .where(eq(grokInjections.botId, botId));
  }
}

export async function logGrokGateResult(
  botId: string,
  gateName: string,
  threshold: number,
  actualValue: number,
  passed: boolean,
  currentStage: string,
  performance: GrokPerformanceSnapshot,
  traceId?: string
): Promise<void> {
  const isGrokBot = await db
    .select({ id: grokInjections.id })
    .from(grokInjections)
    .where(eq(grokInjections.botId, botId))
    .limit(1);

  if (isGrokBot.length === 0) {
    return;
  }

  await logGrokFeedback({
    botId,
    eventType: passed ? "GATE_PASSED" : "GATE_FAILED",
    currentStage,
    performance,
    gateContext: {
      gateName,
      gateThreshold: threshold,
      gateActualValue: actualValue,
      gatePassed: passed,
    },
    failureReason: passed ? undefined : `Gate ${gateName} failed: ${actualValue.toFixed(2)} vs threshold ${threshold.toFixed(2)}`,
    traceId,
  });
}

export async function triggerGrokEvolution(
  botId: string,
  failureContext: {
    failureReasonCodes: string[];
    performanceDeltas: Record<string, number>;
    regimeAtFailure?: string;
  },
  performance: GrokPerformanceSnapshot,
  traceId?: string
): Promise<string | null> {
  const grokInjection = await db
    .select()
    .from(grokInjections)
    .where(eq(grokInjections.botId, botId))
    .limit(1);

  if (grokInjection.length === 0) {
    return null;
  }

  const injection = grokInjection[0];

  await logGrokFeedback({
    botId,
    eventType: "EVOLUTION_TRIGGERED",
    performance,
    failureReason: failureContext.failureReasonCodes.join(", "),
    improvementSuggestions: {
      ...failureContext.performanceDeltas,
      regime: failureContext.regimeAtFailure,
    },
    traceId,
  });

  console.log(`[GROK_FEEDBACK] Evolution triggered for bot ${botId.slice(0,8)} strategy="${injection.strategyName}" gen=${injection.evolutionGeneration}`);

  return injection.id;
}

export async function requestGrokEvolution(
  botId: string,
  failureReasons: string[],
  performance: GrokPerformanceSnapshot,
  currentRegime: string,
  traceId?: string
): Promise<{ success: boolean; message: string }> {
  try {
    const grokInjection = await db
      .select({
        id: grokInjections.id,
        strategyName: grokInjections.strategyName,
        evolutionGeneration: grokInjections.evolutionGeneration,
      })
      .from(grokInjections)
      .where(eq(grokInjections.botId, botId))
      .limit(1);

    if (grokInjection.length === 0) {
      return { success: false, message: "Bot is not a Grok-generated bot" };
    }

    const injection = grokInjection[0];
    const nextGen = (injection.evolutionGeneration || 1) + 1;

    console.log(`[GROK_EVOLUTION] Requesting evolution for strategy="${injection.strategyName}" gen=${injection.evolutionGeneration} → ${nextGen}`);
    
    // Log EVOLUTION_TRIGGERED feedback for autonomous learning loop
    await logGrokFeedback({
      botId,
      eventType: "EVOLUTION_TRIGGERED",
      performance,
      failureReason: failureReasons.join(", "),
      improvementSuggestions: {
        regime: currentRegime,
        targetedFixes: failureReasons,
      },
      traceId,
    });

    const context: GrokResearchContext = {
      grokDepth: "DEEP_REASONING",
      currentRegime,
      sourceLabBotId: botId,
      sourceLabFailure: {
        failureReasonCodes: failureReasons,
        performanceDeltas: {
          sharpe: performance.sharpe || 0,
          winRate: performance.winRate || 0,
          maxDrawdown: performance.maxDrawdownPct || 0,
          trades: performance.tradeCount || 0,
        },
        regimeAtFailure: currentRegime,
      },
      customFocus: `EVOLVE STRATEGY: "${injection.strategyName}" failed because: ${failureReasons.join(", ")}. 
Current metrics: Sharpe=${performance.sharpe?.toFixed(2) || 'N/A'}, WinRate=${performance.winRate?.toFixed(1) || 'N/A'}%, MaxDD=${performance.maxDrawdownPct?.toFixed(1) || 'N/A'}%.
Create an EVOLVED version that addresses these weaknesses while preserving the core edge.`,
    };

    const result = await runGrokResearch(context, "system");

    if (result.success && result.candidates.length > 0) {
      await logActivityEvent({
        botId,
        eventType: "STRATEGY_EVOLVED",
        severity: "INFO",
        title: `Grok Evolution: ${injection.strategyName}`,
        summary: `Generated ${result.candidates.length} evolved candidates from gen ${injection.evolutionGeneration} failure`,
        payload: {
          originalStrategy: injection.strategyName,
          fromGeneration: injection.evolutionGeneration,
          failureReasons,
          newCandidates: result.candidates.map(c => c.strategyName),
          costUsd: result.usage?.costUsd,
        },
        traceId,
      });

      console.log(`[GROK_EVOLUTION] SUCCESS strategy="${injection.strategyName}" generated=${result.candidates.length} candidates`);
      return { 
        success: true, 
        message: `Generated ${result.candidates.length} evolved candidates` 
      };
    }

    return { 
      success: false, 
      message: result.error || "No candidates generated" 
    };
  } catch (error) {
    console.error("[GROK_EVOLUTION] Failed:", error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

export async function logGrokSuccessPatterns(
  botId: string,
  fromStage: string,
  toStage: string,
  performance: GrokPerformanceSnapshot,
  traceId?: string
): Promise<void> {
  try {
    const grokInjection = await db
      .select({
        id: grokInjections.id,
        strategyName: grokInjections.strategyName,
        archetypeName: grokInjections.archetypeName,
        rulesJson: grokInjections.rulesJson,
        candidateId: grokInjections.candidateId,
      })
      .from(grokInjections)
      .where(eq(grokInjections.botId, botId))
      .limit(1);

    if (grokInjection.length === 0) {
      return; // Not a Grok bot
    }

    const injection = grokInjection[0];
    const rules = injection.rulesJson as Record<string, any> || {};

    // Null-safe helper to check if any rule contains a keyword
    const ruleContains = (ruleArray: unknown, keyword: string): boolean => {
      if (!Array.isArray(ruleArray)) return false;
      return ruleArray.some((r) => typeof r === "string" && r.toLowerCase().includes(keyword));
    };

    const successPatterns = {
      archetype: injection.archetypeName,
      entryRulesCount: Array.isArray(rules.entry) ? rules.entry.length : 0,
      exitRulesCount: Array.isArray(rules.exit) ? rules.exit.length : 0,
      riskRulesCount: Array.isArray(rules.risk) ? rules.risk.length : 0,
      hasFilters: Array.isArray(rules.filters) && rules.filters.length > 0,
      hasInvalidation: Array.isArray(rules.invalidation) && rules.invalidation.length > 0,
      timeframeSensitivity: ruleContains(rules.entry, "timeframe"),
      usesVWAP: ruleContains(rules.entry, "vwap"),
      usesORB: ruleContains(rules.entry, "orb") || ruleContains(rules.entry, "opening range"),
      usesMomentum: ruleContains(rules.entry, "momentum") || ruleContains(rules.entry, "rsi"),
      usesMeanReversion: ruleContains(rules.entry, "deviation") || ruleContains(rules.entry, "reversion"),
      promotionPath: `${fromStage} → ${toStage}`,
      metricsAtPromotion: {
        sharpe: performance.sharpe,
        winRate: performance.winRate,
        maxDrawdown: performance.maxDrawdownPct,
        tradeCount: performance.tradeCount,
        netPnl: performance.netPnl,
      },
    };

    await logGrokFeedback({
      botId,
      eventType: "MILESTONE",
      previousStage: fromStage,
      currentStage: toStage,
      performance,
      successPatterns,
      traceId,
    });

    console.log(`[GROK_FEEDBACK] SUCCESS_PATTERNS logged for "${injection.strategyName}" at ${fromStage} → ${toStage}`);
    console.log(`[GROK_FEEDBACK] Patterns: archetype=${injection.archetypeName} vwap=${successPatterns.usesVWAP} orb=${successPatterns.usesORB} momentum=${successPatterns.usesMomentum}`);
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to log success patterns:", error);
  }
}

export async function getGrokBotPerformanceSummary(): Promise<Array<{
  botId: string;
  botName: string;
  strategyName: string;
  currentStage: string;
  sharpe: number | null;
  winRate: number | null;
  maxDrawdownPct: number | null;
  tradeCount: number | null;
  daysInStage: number;
  needsEvolution: boolean;
}>> {
  try {
    const result = await db.execute(sql`
      SELECT 
        b.id as bot_id,
        b.name as bot_name,
        gi.strategy_name,
        b.stage as current_stage,
        b.cached_sharpe as sharpe,
        b.cached_win_rate as win_rate,
        b.cached_max_drawdown_pct as max_drawdown_pct,
        (SELECT COUNT(*) FROM paper_trades pt WHERE pt.bot_id = b.id AND pt.status = 'CLOSED') as trade_count,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(
          (SELECT created_at FROM bot_stage_events WHERE bot_id = b.id ORDER BY created_at DESC LIMIT 1),
          b.created_at
        ))) / 86400 as days_in_stage
      FROM bots b
      JOIN grok_injections gi ON gi.bot_id = b.id
      WHERE b.archived_at IS NULL
        AND b.killed_at IS NULL
      ORDER BY b.stage DESC, gi.created_at DESC
    `);

    return (result.rows as any[]).map(r => ({
      botId: r.bot_id,
      botName: r.bot_name,
      strategyName: r.strategy_name,
      currentStage: r.current_stage,
      sharpe: r.sharpe,
      winRate: r.win_rate,
      maxDrawdownPct: r.max_drawdown_pct,
      tradeCount: parseInt(r.trade_count || "0"),
      daysInStage: parseFloat(r.days_in_stage || "0"),
      needsEvolution: (r.sharpe || 0) < 0.5 || (r.max_drawdown_pct || 0) > 20,
    }));
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to get bot summary:", error);
    return [];
  }
}

export interface TradePerformanceMetrics {
  tradeId: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  entryReasonCode?: string;
  exitReasonCode?: string;
  signalContext?: Record<string, any>;
  entryTime: Date;
  exitTime: Date;
  isWin: boolean;
}

export async function logBotPerformance(
  botId: string,
  metrics: TradePerformanceMetrics
): Promise<string | null> {
  try {
    const grokInjection = await db
      .select({ id: grokInjections.id, strategyName: grokInjections.strategyName })
      .from(grokInjections)
      .where(eq(grokInjections.botId, botId))
      .limit(1);

    if (grokInjection.length === 0) {
      return null;
    }

    const injectionId = grokInjection[0].id;
    const strategyName = grokInjection[0].strategyName;

    const performance: GrokPerformanceSnapshot = {
      netPnl: metrics.pnl,
      winRate: metrics.isWin ? 100 : 0,
      tradeCount: 1,
    };

    const successPatterns = metrics.isWin ? {
      entryReason: metrics.entryReasonCode,
      exitReason: metrics.exitReasonCode,
      signalContext: metrics.signalContext,
      symbol: metrics.symbol,
      side: metrics.side,
      pnlPercent: metrics.pnlPercent,
    } : undefined;

    const improvementSuggestions = !metrics.isWin ? {
      entryReason: metrics.entryReasonCode,
      exitReason: metrics.exitReasonCode,
      signalContext: metrics.signalContext,
      symbol: metrics.symbol,
      side: metrics.side,
      pnlPercent: metrics.pnlPercent,
      lossMagnitude: Math.abs(metrics.pnl),
    } : undefined;

    const [feedback] = await db.insert(grokFeedback).values({
      injectionId,
      botId,
      eventType: metrics.isWin ? "LIVE_PERFORMANCE" : "GATE_FAILED",
      performance,
      successPatterns: successPatterns || {},
      improvementSuggestions: improvementSuggestions || {},
    }).returning({ id: grokFeedback.id });

    console.log(`[GROK_FEEDBACK] Trade ${metrics.isWin ? "WIN" : "LOSS"} logged for bot ${botId.slice(0,8)} strategy="${strategyName}" pnl=${metrics.pnl.toFixed(2)}`);

    return feedback.id;
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to log trade performance:", error);
    return null;
  }
}

export interface WinningPattern {
  entryReasonCode: string;
  exitReasonCode: string;
  frequency: number;
  avgPnl: number;
  avgPnlPercent: number;
  winRate: number;
  tradeCount: number;
  avgHoldingMinutes: number;
  commonSignals: Record<string, number>;
}

export async function extractWinningPatterns(botId: string, lookbackDays: number = 30): Promise<{
  patterns: WinningPattern[];
  topSignals: Array<{ signal: string; winRate: number; count: number }>;
  bestTimeOfDay: string | null;
  statisticalSignificance: number;
}> {
  try {
    const result = await db.execute(sql`
      SELECT 
        pt.entry_reason_code,
        pt.exit_reason_code,
        pt.signal_context,
        pt.pnl,
        pt.pnl_percent,
        pt.entry_time,
        pt.exit_time,
        EXTRACT(EPOCH FROM (pt.exit_time - pt.entry_time)) / 60 as holding_minutes
      FROM paper_trades pt
      WHERE pt.bot_id = ${botId}
        AND pt.status = 'CLOSED'
        AND pt.pnl > 0
        AND pt.exit_time > NOW() - INTERVAL '${lookbackDays} days'
      ORDER BY pt.exit_time DESC
      LIMIT 200
    `);

    const trades = result.rows as any[];
    if (trades.length < 5) {
      return { patterns: [], topSignals: [], bestTimeOfDay: null, statisticalSignificance: 0 };
    }

    const patternMap = new Map<string, {
      count: number;
      totalPnl: number;
      totalPnlPercent: number;
      holdingMinutes: number[];
      signals: Record<string, number>;
    }>();

    const signalWins = new Map<string, { wins: number; total: number }>();
    const hourCounts = new Map<number, number>();

    for (const trade of trades) {
      const key = `${trade.entry_reason_code || 'UNKNOWN'}::${trade.exit_reason_code || 'UNKNOWN'}`;
      const existing = patternMap.get(key) || { count: 0, totalPnl: 0, totalPnlPercent: 0, holdingMinutes: [], signals: {} };
      
      existing.count++;
      existing.totalPnl += trade.pnl || 0;
      existing.totalPnlPercent += trade.pnl_percent || 0;
      existing.holdingMinutes.push(trade.holding_minutes || 0);

      const signalContext = trade.signal_context || {};
      for (const [signal, value] of Object.entries(signalContext)) {
        if (value) {
          existing.signals[signal] = (existing.signals[signal] || 0) + 1;
          const sigStat = signalWins.get(signal) || { wins: 0, total: 0 };
          sigStat.wins++;
          sigStat.total++;
          signalWins.set(signal, sigStat);
        }
      }

      patternMap.set(key, existing);

      const hour = new Date(trade.entry_time).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    const patterns: WinningPattern[] = Array.from(patternMap.entries())
      .filter(([_, data]) => data.count >= 3)
      .map(([key, data]) => {
        const [entryReason, exitReason] = key.split('::');
        const avgHolding = data.holdingMinutes.reduce((a, b) => a + b, 0) / data.holdingMinutes.length;
        return {
          entryReasonCode: entryReason,
          exitReasonCode: exitReason,
          frequency: data.count / trades.length,
          avgPnl: data.totalPnl / data.count,
          avgPnlPercent: data.totalPnlPercent / data.count,
          winRate: 100,
          tradeCount: data.count,
          avgHoldingMinutes: avgHolding,
          commonSignals: data.signals,
        };
      })
      .sort((a, b) => b.avgPnl - a.avgPnl)
      .slice(0, 10);

    const topSignals = Array.from(signalWins.entries())
      .map(([signal, stats]) => ({
        signal,
        winRate: (stats.wins / stats.total) * 100,
        count: stats.total,
      }))
      .filter(s => s.count >= 3)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 5);

    let bestTimeOfDay: string | null = null;
    let maxHourCount = 0;
    for (const [hour, count] of hourCounts.entries()) {
      if (count > maxHourCount) {
        maxHourCount = count;
        bestTimeOfDay = `${hour.toString().padStart(2, '0')}:00`;
      }
    }

    const statisticalSignificance = Math.min(1, trades.length / 50);

    return { patterns, topSignals, bestTimeOfDay, statisticalSignificance };
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to extract winning patterns:", error);
    return { patterns: [], topSignals: [], bestTimeOfDay: null, statisticalSignificance: 0 };
  }
}

export interface LosingPattern {
  entryReasonCode: string;
  exitReasonCode: string;
  frequency: number;
  avgLoss: number;
  avgLossPercent: number;
  tradeCount: number;
  avgHoldingMinutes: number;
  antiSignals: Record<string, number>;
}

export async function extractLosingPatterns(botId: string, lookbackDays: number = 30): Promise<{
  patterns: LosingPattern[];
  worstSignals: Array<{ signal: string; lossRate: number; count: number; avgLoss: number }>;
  worstTimeOfDay: string | null;
  commonExitReasons: Array<{ reason: string; count: number; avgLoss: number }>;
}> {
  try {
    const result = await db.execute(sql`
      SELECT 
        pt.entry_reason_code,
        pt.exit_reason_code,
        pt.signal_context,
        pt.pnl,
        pt.pnl_percent,
        pt.entry_time,
        pt.exit_time,
        EXTRACT(EPOCH FROM (pt.exit_time - pt.entry_time)) / 60 as holding_minutes
      FROM paper_trades pt
      WHERE pt.bot_id = ${botId}
        AND pt.status = 'CLOSED'
        AND pt.pnl < 0
        AND pt.exit_time > NOW() - INTERVAL '${lookbackDays} days'
      ORDER BY pt.pnl ASC
      LIMIT 200
    `);

    const trades = result.rows as any[];
    if (trades.length < 3) {
      return { patterns: [], worstSignals: [], worstTimeOfDay: null, commonExitReasons: [] };
    }

    const patternMap = new Map<string, {
      count: number;
      totalLoss: number;
      totalLossPercent: number;
      holdingMinutes: number[];
      antiSignals: Record<string, number>;
    }>();

    const signalLosses = new Map<string, { losses: number; total: number; totalLoss: number }>();
    const hourCounts = new Map<number, { count: number; totalLoss: number }>();
    const exitReasonCounts = new Map<string, { count: number; totalLoss: number }>();

    for (const trade of trades) {
      const key = `${trade.entry_reason_code || 'UNKNOWN'}::${trade.exit_reason_code || 'UNKNOWN'}`;
      const existing = patternMap.get(key) || { count: 0, totalLoss: 0, totalLossPercent: 0, holdingMinutes: [], antiSignals: {} };
      
      existing.count++;
      existing.totalLoss += Math.abs(trade.pnl || 0);
      existing.totalLossPercent += Math.abs(trade.pnl_percent || 0);
      existing.holdingMinutes.push(trade.holding_minutes || 0);

      const signalContext = trade.signal_context || {};
      for (const [signal, value] of Object.entries(signalContext)) {
        if (value) {
          existing.antiSignals[signal] = (existing.antiSignals[signal] || 0) + 1;
          const sigStat = signalLosses.get(signal) || { losses: 0, total: 0, totalLoss: 0 };
          sigStat.losses++;
          sigStat.total++;
          sigStat.totalLoss += Math.abs(trade.pnl || 0);
          signalLosses.set(signal, sigStat);
        }
      }

      patternMap.set(key, existing);

      const hour = new Date(trade.entry_time).getHours();
      const hourData = hourCounts.get(hour) || { count: 0, totalLoss: 0 };
      hourData.count++;
      hourData.totalLoss += Math.abs(trade.pnl || 0);
      hourCounts.set(hour, hourData);

      const exitReason = trade.exit_reason_code || 'UNKNOWN';
      const exitData = exitReasonCounts.get(exitReason) || { count: 0, totalLoss: 0 };
      exitData.count++;
      exitData.totalLoss += Math.abs(trade.pnl || 0);
      exitReasonCounts.set(exitReason, exitData);
    }

    const patterns: LosingPattern[] = Array.from(patternMap.entries())
      .filter(([_, data]) => data.count >= 2)
      .map(([key, data]) => {
        const [entryReason, exitReason] = key.split('::');
        const avgHolding = data.holdingMinutes.reduce((a, b) => a + b, 0) / data.holdingMinutes.length;
        return {
          entryReasonCode: entryReason,
          exitReasonCode: exitReason,
          frequency: data.count / trades.length,
          avgLoss: data.totalLoss / data.count,
          avgLossPercent: data.totalLossPercent / data.count,
          tradeCount: data.count,
          avgHoldingMinutes: avgHolding,
          antiSignals: data.antiSignals,
        };
      })
      .sort((a, b) => b.avgLoss - a.avgLoss)
      .slice(0, 10);

    const worstSignals = Array.from(signalLosses.entries())
      .map(([signal, stats]) => ({
        signal,
        lossRate: (stats.losses / stats.total) * 100,
        count: stats.total,
        avgLoss: stats.totalLoss / stats.losses,
      }))
      .filter(s => s.count >= 3)
      .sort((a, b) => b.avgLoss - a.avgLoss)
      .slice(0, 5);

    let worstTimeOfDay: string | null = null;
    let maxHourLoss = 0;
    for (const [hour, data] of hourCounts.entries()) {
      if (data.totalLoss > maxHourLoss) {
        maxHourLoss = data.totalLoss;
        worstTimeOfDay = `${hour.toString().padStart(2, '0')}:00`;
      }
    }

    const commonExitReasons = Array.from(exitReasonCounts.entries())
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        avgLoss: data.totalLoss / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { patterns, worstSignals, worstTimeOfDay, commonExitReasons };
  } catch (error) {
    console.error("[GROK_FEEDBACK] Failed to extract losing patterns:", error);
    return { patterns: [], worstSignals: [], worstTimeOfDay: null, commonExitReasons: [] };
  }
}

export interface EvolutionRecommendation {
  strategyName: string;
  archetypeName: string;
  hypothesis: string;
  rulesJson: Record<string, any>;
  confidenceScore: number;
  reasoning: string;
  parentBotId?: string;
  evolutionGeneration: number;
}

export async function applyGrokEvolution(
  botId: string,
  evolution: EvolutionRecommendation
): Promise<{ success: boolean; candidateId?: string; message: string }> {
  try {
    const grokInjection = await db
      .select({
        id: grokInjections.id,
        strategyName: grokInjections.strategyName,
        evolutionGeneration: grokInjections.evolutionGeneration,
        candidateId: grokInjections.candidateId,
      })
      .from(grokInjections)
      .where(eq(grokInjections.botId, botId))
      .limit(1);

    if (grokInjection.length === 0) {
      return { success: false, message: "Bot is not a Grok-generated bot" };
    }

    const injection = grokInjection[0];
    const newGeneration = (injection.evolutionGeneration || 1) + 1;

    const bot = await db
      .select({ userId: bots.userId, archetypeId: bots.archetypeId })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1);

    if (bot.length === 0) {
      return { success: false, message: "Parent bot not found" };
    }

    const rulesHash = generateRulesHash(evolution.rulesJson);

    const [newCandidate] = await db.insert(strategyCandidates).values({
      userId: bot[0].userId,
      candidateSource: "GROK_EVOLUTION",
      strategyName: `${evolution.strategyName} G${newGeneration}`,
      archetypeName: evolution.archetypeName,
      hypothesis: evolution.hypothesis,
      instrumentUniverse: ["MES", "MNQ"],
      timeframePreferences: ["5m"],
      sessionModePreference: "RTH",
      rulesJson: evolution.rulesJson,
      rulesHash,
      confidenceScore: evolution.confidenceScore,
      aiProviderUsed: "GROK",
      aiModelUsed: "grok-4.1-fast",
      researchDepth: "DEEP_REASONING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({ id: strategyCandidates.id });

    await db.update(grokInjections)
      .set({
        evolutionGeneration: newGeneration,
        lastEvolutionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(grokInjections.id, injection.id));

    await logActivityEvent({
      botId,
      eventType: "STRATEGY_EVOLVED",
      severity: "INFO",
      title: `Grok Evolution Applied: G${newGeneration}`,
      summary: `Created evolved candidate "${evolution.strategyName} G${newGeneration}" from parent strategy`,
      payload: {
        parentBotId: botId,
        newCandidateId: newCandidate.id,
        generation: newGeneration,
        confidenceScore: evolution.confidenceScore,
        reasoning: evolution.reasoning,
      },
    });

    console.log(`[GROK_EVOLUTION] Applied evolution for bot ${botId.slice(0,8)} → candidate ${newCandidate.id.slice(0,8)} gen=${newGeneration}`);

    return { 
      success: true, 
      candidateId: newCandidate.id,
      message: `Created evolved candidate G${newGeneration}` 
    };
  } catch (error) {
    console.error("[GROK_EVOLUTION] Failed to apply evolution:", error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

function generateRulesHash(rulesJson: Record<string, any>): string {
  const str = JSON.stringify(rulesJson, Object.keys(rulesJson).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export interface FeedbackWorkerSummary {
  botsScanned: number;
  patternsExtracted: number;
  evolutionsTriggered: number;
  candidatesCreated: number;
  errors: string[];
  timestamp: Date;
}

export async function runGrokFeedbackWorker(): Promise<FeedbackWorkerSummary> {
  const summary: FeedbackWorkerSummary = {
    botsScanned: 0,
    patternsExtracted: 0,
    evolutionsTriggered: 0,
    candidatesCreated: 0,
    errors: [],
    timestamp: new Date(),
  };

  try {
    console.log("[GROK_FEEDBACK_WORKER] Starting feedback collection cycle...");

    const grokBots = await getGrokBotPerformanceSummary();
    summary.botsScanned = grokBots.length;

    if (grokBots.length === 0) {
      console.log("[GROK_FEEDBACK_WORKER] No Grok bots found");
      return summary;
    }

    const botsNeedingEvolution = grokBots.filter(b => b.needsEvolution && b.tradeCount >= 10);

    for (const bot of botsNeedingEvolution) {
      try {
        const [winPatterns, losePatterns] = await Promise.all([
          extractWinningPatterns(bot.botId, 30),
          extractLosingPatterns(bot.botId, 30),
        ]);

        if (winPatterns.patterns.length > 0 || losePatterns.patterns.length > 0) {
          summary.patternsExtracted++;
        }

        const failureReasons: string[] = [];
        if ((bot.sharpe || 0) < 0.5) failureReasons.push("LOW_SHARPE");
        if ((bot.maxDrawdownPct || 0) > 15) failureReasons.push("HIGH_DRAWDOWN");
        if ((bot.winRate || 0) < 45) failureReasons.push("LOW_WIN_RATE");

        if (losePatterns.patterns.length > 0) {
          const topLossPattern = losePatterns.patterns[0];
          failureReasons.push(`PATTERN:${topLossPattern.entryReasonCode}->${topLossPattern.exitReasonCode}`);
        }

        if (failureReasons.length > 0) {
          const performance: GrokPerformanceSnapshot = {
            sharpe: bot.sharpe,
            winRate: bot.winRate,
            maxDrawdownPct: bot.maxDrawdownPct,
            tradeCount: bot.tradeCount,
          };

          const evolutionResult = await requestGrokEvolution(
            bot.botId,
            failureReasons,
            performance,
            "UNKNOWN",
          );

          if (evolutionResult.success) {
            summary.evolutionsTriggered++;
            console.log(`[GROK_FEEDBACK_WORKER] Evolution triggered for "${bot.strategyName}"`);
          }
        }
      } catch (botError) {
        const errorMsg = `Failed to process bot ${bot.botId.slice(0,8)}: ${botError instanceof Error ? botError.message : 'Unknown error'}`;
        summary.errors.push(errorMsg);
        console.error(`[GROK_FEEDBACK_WORKER] ${errorMsg}`);
      }
    }

    const promotedBots = grokBots.filter(b => !b.needsEvolution && b.currentStage !== "LAB" && b.tradeCount >= 20);
    for (const bot of promotedBots.slice(0, 3)) {
      try {
        const winPatterns = await extractWinningPatterns(bot.botId, 30);
        if (winPatterns.patterns.length > 0 && winPatterns.statisticalSignificance > 0.5) {
          await logGrokSuccessPatterns(
            bot.botId,
            bot.currentStage,
            bot.currentStage,
            {
              sharpe: bot.sharpe,
              winRate: bot.winRate,
              maxDrawdownPct: bot.maxDrawdownPct,
              tradeCount: bot.tradeCount,
            },
          );
          summary.patternsExtracted++;
        }
      } catch (error) {
        console.error(`[GROK_FEEDBACK_WORKER] Failed to log success patterns:`, error);
      }
    }

    console.log(`[GROK_FEEDBACK_WORKER] Completed: scanned=${summary.botsScanned} patterns=${summary.patternsExtracted} evolutions=${summary.evolutionsTriggered}`);

    return summary;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    summary.errors.push(errorMsg);
    console.error("[GROK_FEEDBACK_WORKER] Worker failed:", error);
    return summary;
  }
}
