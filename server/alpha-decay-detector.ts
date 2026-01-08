import { db } from "./db";
import { bots, backtestSessions, activityEvents, type Bot } from "@shared/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";

export interface DecayMetrics {
  currentSharpe: number;
  baselineSharpe: number;
  sharpeDecay: number;
  rollingWinRate: number;
  baselineWinRate: number;
  winRateDecay: number;
  rollingPnL: number;
  baselinePnL: number;
  pnlDecay: number;
  consecLosses: number;
  tradeDensity: number;
}

export interface DecayAssessment {
  botId: string;
  botName: string;
  stage: string;
  decayDetected: boolean;
  decayLevel: "NONE" | "MILD" | "MODERATE" | "SEVERE" | "CRITICAL";
  metrics: DecayMetrics;
  recommendation: "CONTINUE" | "MONITOR" | "REDUCE_SIZE" | "PAUSE" | "EMERGENCY_STOP";
  reasons: string[];
  autoActionTaken: boolean;
  actionDetails?: string;
}

export interface DecayThresholds {
  mildSharpeDrop: number;
  moderateSharpeDrop: number;
  severeSharpeDrop: number;
  criticalSharpeDrop: number;
  minWinRateDrop: number;
  maxConsecLosses: number;
  minTradeDensity: number;
  rollingWindowDays: number;
}

const DEFAULT_THRESHOLDS: DecayThresholds = {
  mildSharpeDrop: 0.3,
  moderateSharpeDrop: 0.5,
  severeSharpeDrop: 0.7,
  criticalSharpeDrop: 1.0,
  minWinRateDrop: 0.15,
  maxConsecLosses: 7,
  minTradeDensity: 0.1,
  rollingWindowDays: 30,
};

const STAGE_MULTIPLIERS: Record<string, number> = {
  LAB: 0.0,
  PAPER: 0.5,
  SHADOW: 0.8,
  CANARY: 1.0,
  LIVE: 1.2,
};

export async function assessAlphaDecay(
  botId: string,
  thresholds: Partial<DecayThresholds> = {}
): Promise<DecayAssessment> {
  const traceId = Math.random().toString(36).substring(2, 10);
  console.log(`[ALPHA_DECAY] trace_id=${traceId} assessing bot_id=${botId}`);

  const config = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);

  if (!bot) {
    return {
      botId,
      botName: "Unknown",
      stage: "UNKNOWN",
      decayDetected: false,
      decayLevel: "NONE",
      metrics: createEmptyMetrics(),
      recommendation: "CONTINUE",
      reasons: ["Bot not found"],
      autoActionTaken: false,
    };
  }

  const metrics = await calculateDecayMetrics(botId, config.rollingWindowDays);
  const stageMultiplier = STAGE_MULTIPLIERS[bot.stage || "LAB"] || 1.0;
  const { decayLevel, reasons } = classifyDecay(metrics, config, stageMultiplier);

  const recommendation = determineRecommendation(decayLevel, bot.stage || "LAB");
  let autoActionTaken = false;
  let actionDetails: string | undefined;

  if (recommendation === "PAUSE" || recommendation === "EMERGENCY_STOP") {
    const shouldAuto = shouldAutoAction(bot.stage || "LAB");
    if (shouldAuto) {
      await db
        .update(bots)
        .set({
          status: "paused",
          updatedAt: new Date(),
        })
        .where(eq(bots.id, botId));

      autoActionTaken = true;
      actionDetails = `Bot auto-paused due to ${decayLevel} alpha decay`;

      await logActivityEvent({
        eventType: "BOT_STAGNANT",
        severity: "WARN",
        title: `Alpha Decay: ${bot.name} auto-paused`,
        payload: {
          botId,
          botName: bot.name,
          decayLevel,
          metrics,
          reasons,
        },
        botId,
        traceId,
      });

      console.log(`[ALPHA_DECAY] trace_id=${traceId} AUTO_PAUSE bot=${bot.name} level=${decayLevel}`);
    }
  }

  console.log(`[ALPHA_DECAY] trace_id=${traceId} result level=${decayLevel} recommendation=${recommendation}`);

  return {
    botId,
    botName: bot.name || "Unnamed",
    stage: bot.stage || "LAB",
    decayDetected: decayLevel !== "NONE",
    decayLevel,
    metrics,
    recommendation,
    reasons,
    autoActionTaken,
    actionDetails,
  };
}

async function calculateDecayMetrics(botId: string, windowDays: number): Promise<DecayMetrics> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  const recentSessions = await db
    .select()
    .from(backtestSessions)
    .where(
      and(
        eq(backtestSessions.botId, botId),
        eq(backtestSessions.status, "completed"),
        gte(backtestSessions.createdAt, windowStart)
      )
    )
    .orderBy(desc(backtestSessions.createdAt))
    .limit(50);

  const baselineSessions = await db
    .select()
    .from(backtestSessions)
    .where(
      and(
        eq(backtestSessions.botId, botId),
        eq(backtestSessions.status, "completed")
      )
    )
    .orderBy(desc(backtestSessions.createdAt))
    .limit(100);

  const olderSessions = baselineSessions.slice(Math.min(20, baselineSessions.length));

  const recentMetrics = aggregateSessionMetrics(recentSessions);
  const baselineMetrics = aggregateSessionMetrics(olderSessions);

  const consecLosses = calculateConsecutiveLosses(recentSessions);
  const tradeDensity = calculateTradeDensity(recentSessions, windowDays);

  return {
    currentSharpe: recentMetrics.sharpe,
    baselineSharpe: baselineMetrics.sharpe,
    sharpeDecay: baselineMetrics.sharpe > 0 
      ? (baselineMetrics.sharpe - recentMetrics.sharpe) / baselineMetrics.sharpe 
      : 0,
    rollingWinRate: recentMetrics.winRate,
    baselineWinRate: baselineMetrics.winRate,
    winRateDecay: baselineMetrics.winRate > 0 
      ? (baselineMetrics.winRate - recentMetrics.winRate) / baselineMetrics.winRate 
      : 0,
    rollingPnL: recentMetrics.totalPnL,
    baselinePnL: baselineMetrics.totalPnL,
    pnlDecay: baselineMetrics.totalPnL > 0 
      ? (baselineMetrics.totalPnL - recentMetrics.totalPnL) / Math.abs(baselineMetrics.totalPnL) 
      : 0,
    consecLosses,
    tradeDensity,
  };
}

function aggregateSessionMetrics(sessions: any[]): { sharpe: number; winRate: number; totalPnL: number } {
  if (sessions.length === 0) {
    return { sharpe: 0, winRate: 0, totalPnL: 0 };
  }

  let totalPnL = 0;
  let totalWins = 0;
  let totalTrades = 0;
  const pnlValues: number[] = [];

  for (const session of sessions) {
    const pnl = typeof session.totalPnl === "number" ? session.totalPnl : 0;
    const trades = typeof session.totalTrades === "number" ? session.totalTrades : 0;
    const winRate = typeof session.winRate === "number" ? session.winRate : 0;

    totalPnL += pnl;
    totalTrades += trades;
    totalWins += trades * (winRate / 100);
    pnlValues.push(pnl);
  }

  const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  const mean = pnlValues.length > 0 ? pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length : 0;
  const variance = pnlValues.length > 1
    ? pnlValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (pnlValues.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  return {
    sharpe,
    winRate: avgWinRate,
    totalPnL,
  };
}

function calculateConsecutiveLosses(sessions: any[]): number {
  let maxConsec = 0;
  let currentConsec = 0;

  for (const session of sessions.reverse()) {
    const pnl = typeof session.totalPnl === "number" ? session.totalPnl : 0;
    if (pnl < 0) {
      currentConsec++;
      maxConsec = Math.max(maxConsec, currentConsec);
    } else {
      currentConsec = 0;
    }
  }

  return maxConsec;
}

function calculateTradeDensity(sessions: any[], windowDays: number): number {
  const totalTrades = sessions.reduce((sum, s) => {
    return sum + (typeof s.totalTrades === "number" ? s.totalTrades : 0);
  }, 0);
  return windowDays > 0 ? totalTrades / windowDays : 0;
}

function classifyDecay(
  metrics: DecayMetrics,
  config: DecayThresholds,
  stageMultiplier: number
): { decayLevel: DecayAssessment["decayLevel"]; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const adjustedSharpeDrop = metrics.sharpeDecay * stageMultiplier;

  if (adjustedSharpeDrop >= config.criticalSharpeDrop) {
    score += 4;
    reasons.push(`Critical Sharpe decay: ${(adjustedSharpeDrop * 100).toFixed(1)}%`);
  } else if (adjustedSharpeDrop >= config.severeSharpeDrop) {
    score += 3;
    reasons.push(`Severe Sharpe decay: ${(adjustedSharpeDrop * 100).toFixed(1)}%`);
  } else if (adjustedSharpeDrop >= config.moderateSharpeDrop) {
    score += 2;
    reasons.push(`Moderate Sharpe decay: ${(adjustedSharpeDrop * 100).toFixed(1)}%`);
  } else if (adjustedSharpeDrop >= config.mildSharpeDrop) {
    score += 1;
    reasons.push(`Mild Sharpe decay: ${(adjustedSharpeDrop * 100).toFixed(1)}%`);
  }

  if (metrics.winRateDecay >= config.minWinRateDrop) {
    score += 1;
    reasons.push(`Win rate dropped: ${(metrics.winRateDecay * 100).toFixed(1)}%`);
  }

  if (metrics.consecLosses >= config.maxConsecLosses) {
    score += 2;
    reasons.push(`Consecutive losses: ${metrics.consecLosses}`);
  }

  if (metrics.tradeDensity < config.minTradeDensity) {
    score += 0.5;
    reasons.push(`Low trade density: ${metrics.tradeDensity.toFixed(2)} trades/day`);
  }

  if (metrics.currentSharpe < 0 && metrics.baselineSharpe > 0) {
    score += 2;
    reasons.push("Sharpe turned negative");
  }

  let decayLevel: DecayAssessment["decayLevel"];
  if (score >= 5) {
    decayLevel = "CRITICAL";
  } else if (score >= 4) {
    decayLevel = "SEVERE";
  } else if (score >= 2.5) {
    decayLevel = "MODERATE";
  } else if (score >= 1) {
    decayLevel = "MILD";
  } else {
    decayLevel = "NONE";
    reasons.push("No significant decay detected");
  }

  return { decayLevel, reasons };
}

function determineRecommendation(
  decayLevel: DecayAssessment["decayLevel"],
  stage: string
): DecayAssessment["recommendation"] {
  const isLive = stage === "LIVE" || stage === "CANARY";

  switch (decayLevel) {
    case "CRITICAL":
      return isLive ? "EMERGENCY_STOP" : "PAUSE";
    case "SEVERE":
      return "PAUSE";
    case "MODERATE":
      return isLive ? "REDUCE_SIZE" : "MONITOR";
    case "MILD":
      return "MONITOR";
    default:
      return "CONTINUE";
  }
}

function shouldAutoAction(stage: string): boolean {
  return stage === "LAB" || stage === "PAPER" || stage === "SHADOW";
}

function createEmptyMetrics(): DecayMetrics {
  return {
    currentSharpe: 0,
    baselineSharpe: 0,
    sharpeDecay: 0,
    rollingWinRate: 0,
    baselineWinRate: 0,
    winRateDecay: 0,
    rollingPnL: 0,
    baselinePnL: 0,
    pnlDecay: 0,
    consecLosses: 0,
    tradeDensity: 0,
  };
}

export async function scanAllBotsForDecay(
  stageFilter?: string[]
): Promise<DecayAssessment[]> {
  const traceId = Math.random().toString(36).substring(2, 10);
  console.log(`[ALPHA_DECAY] trace_id=${traceId} scanning all bots stage_filter=${stageFilter?.join(",") || "all"}`);

  const allBots = await db
    .select()
    .from(bots)
    .where(sql`${bots.status} = 'running'`);

  const filteredBots = stageFilter
    ? allBots.filter((b) => stageFilter.includes(b.stage || ""))
    : allBots;

  const assessments: DecayAssessment[] = [];

  for (const bot of filteredBots) {
    try {
      const assessment = await assessAlphaDecay(bot.id);
      assessments.push(assessment);
    } catch (e) {
      console.error(`[ALPHA_DECAY] trace_id=${traceId} error assessing bot=${bot.id}: ${e}`);
    }
  }

  const decayingBots = assessments.filter((a) => a.decayDetected);
  console.log(`[ALPHA_DECAY] trace_id=${traceId} scan_complete total=${filteredBots.length} decaying=${decayingBots.length}`);

  return assessments;
}

export async function getDecayHistory(
  botId: string,
  limitDays: number = 90
): Promise<{
  events: any[];
  trend: "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";
  avgDecayLevel: number;
}> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - limitDays);

  const decayEvents = await db
    .select()
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.botId, botId),
        sql`${activityEvents.eventType} = 'BOT_STAGNANT'`,
        gte(activityEvents.createdAt, cutoffDate)
      )
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(50);

  const alphaDecayEvents = decayEvents.filter((e) => {
    const title = e.title || "";
    return title.includes("Alpha Decay");
  });

  if (alphaDecayEvents.length < 2) {
    return {
      events: alphaDecayEvents,
      trend: "INSUFFICIENT_DATA",
      avgDecayLevel: 0,
    };
  }

  const levelMap: Record<string, number> = {
    MILD: 1,
    MODERATE: 2,
    SEVERE: 3,
    CRITICAL: 4,
  };

  const levels = alphaDecayEvents.map((e) => {
    const payload = e.payload as any;
    return levelMap[payload?.decayLevel] || 0;
  });

  const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length;

  const recentAvg = levels.slice(0, Math.floor(levels.length / 2)).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(levels.length / 2));
  const olderAvg = levels.slice(Math.floor(levels.length / 2)).reduce((a, b) => a + b, 0) / Math.max(1, levels.length - Math.floor(levels.length / 2));

  let trend: "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";
  if (recentAvg < olderAvg - 0.5) {
    trend = "IMPROVING";
  } else if (recentAvg > olderAvg + 0.5) {
    trend = "DECLINING";
  } else {
    trend = "STABLE";
  }

  return {
    events: alphaDecayEvents,
    trend,
    avgDecayLevel: avgLevel,
  };
}

export async function setDecayThresholds(
  botId: string,
  thresholds: Partial<DecayThresholds>
): Promise<boolean> {
  try {
    const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
    if (!bot) return false;

    const currentConfig = (bot.strategyConfig as any) || {};
    const updatedConfig = {
      ...currentConfig,
      alphaDecayThresholds: {
        ...(currentConfig.alphaDecayThresholds || {}),
        ...thresholds,
      },
    };

    await db
      .update(bots)
      .set({
        strategyConfig: updatedConfig,
        updatedAt: new Date(),
      })
      .where(eq(bots.id, botId));

    return true;
  } catch (e) {
    console.error(`[ALPHA_DECAY] failed to set thresholds for bot=${botId}: ${e}`);
    return false;
  }
}

export async function runAlphaDecayTests(): Promise<{
  passed: number;
  failed: number;
  tests: Array<{ name: string; passed: boolean; details: string }>;
}> {
  const tests: Array<{ name: string; passed: boolean; details: string }> = [];

  tests.push({
    name: "Decay classification - MILD",
    passed: (() => {
      const metrics: DecayMetrics = {
        currentSharpe: 1.2,
        baselineSharpe: 1.5,
        sharpeDecay: 0.2,
        rollingWinRate: 52,
        baselineWinRate: 55,
        winRateDecay: 0.055,
        rollingPnL: 500,
        baselinePnL: 600,
        pnlDecay: 0.17,
        consecLosses: 2,
        tradeDensity: 2.5,
      };
      const { decayLevel } = classifyDecay(metrics, DEFAULT_THRESHOLDS, 1.0);
      return decayLevel === "NONE" || decayLevel === "MILD";
    })(),
    details: "Mild metrics should classify as MILD or less",
  });

  tests.push({
    name: "Decay classification - CRITICAL",
    passed: (() => {
      const metrics: DecayMetrics = {
        currentSharpe: -0.5,
        baselineSharpe: 1.5,
        sharpeDecay: 1.33,
        rollingWinRate: 35,
        baselineWinRate: 55,
        winRateDecay: 0.36,
        rollingPnL: -1000,
        baselinePnL: 500,
        pnlDecay: 3.0,
        consecLosses: 10,
        tradeDensity: 0.05,
      };
      const { decayLevel } = classifyDecay(metrics, DEFAULT_THRESHOLDS, 1.0);
      return decayLevel === "CRITICAL" || decayLevel === "SEVERE";
    })(),
    details: "Severe degradation should classify as CRITICAL/SEVERE",
  });

  tests.push({
    name: "Recommendation mapping - LIVE stage",
    passed: (() => {
      const rec1 = determineRecommendation("CRITICAL", "LIVE");
      const rec2 = determineRecommendation("MODERATE", "LIVE");
      return rec1 === "EMERGENCY_STOP" && rec2 === "REDUCE_SIZE";
    })(),
    details: "LIVE stage should get stricter recommendations",
  });

  tests.push({
    name: "Recommendation mapping - LAB stage",
    passed: (() => {
      const rec1 = determineRecommendation("CRITICAL", "LAB");
      const rec2 = determineRecommendation("MODERATE", "LAB");
      return rec1 === "PAUSE" && rec2 === "MONITOR";
    })(),
    details: "LAB stage should get less strict recommendations",
  });

  tests.push({
    name: "Auto-action gating by stage",
    passed: (() => {
      const lab = shouldAutoAction("LAB");
      const paper = shouldAutoAction("PAPER");
      const shadow = shouldAutoAction("SHADOW");
      const canary = shouldAutoAction("CANARY");
      const live = shouldAutoAction("LIVE");
      return lab && paper && shadow && !canary && !live;
    })(),
    details: "Auto-pause should only work on LAB/PAPER/SHADOW",
  });

  tests.push({
    name: "Empty metrics handling",
    passed: (() => {
      const empty = createEmptyMetrics();
      return empty.currentSharpe === 0 && empty.consecLosses === 0;
    })(),
    details: "Empty metrics should have zero values",
  });

  tests.push({
    name: "Consecutive loss calculation",
    passed: (() => {
      const sessions = [
        { totalPnl: -100 },
        { totalPnl: -50 },
        { totalPnl: -75 },
        { totalPnl: 100 },
        { totalPnl: -20 },
      ];
      const consec = calculateConsecutiveLosses(sessions);
      return consec === 3;
    })(),
    details: "Should correctly count max consecutive losses",
  });

  const passed = tests.filter((t) => t.passed).length;
  const failed = tests.filter((t) => !t.passed).length;

  console.log(`[ALPHA_DECAY_TESTS] passed=${passed} failed=${failed}`);

  return { passed, failed, tests };
}
