import { db } from "./db";
import { 
  tcaRecords, 
  bestExecutionReports,
  paperTrades,
  bots,
  type TcaRecord,
  type BestExecutionReport
} from "@shared/schema";
import { eq, sql, desc, and, gte, lte, count, avg } from "drizzle-orm";
import { logImmutableAuditEvent } from "./institutional-governance";

interface TradeForTCA {
  id: string;
  botId: string;
  instanceId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: string;
  limitPrice?: number;
  filledPrice: number;
  arrivalPrice: number;
  decisionPrice?: number;
  vwapPrice?: number;
  twapPrice?: number;
  orderTimestamp: Date;
  fillTimestamp?: Date;
  spreadAtOrder?: number;
  spreadAtFill?: number;
}

function calculateSlippageBps(filledPrice: number, arrivalPrice: number, side: "BUY" | "SELL"): number {
  if (arrivalPrice === 0) return 0;
  
  const priceDiff = filledPrice - arrivalPrice;
  const signedSlippage = side === "BUY" ? priceDiff : -priceDiff;
  
  return (signedSlippage / arrivalPrice) * 10000;
}

function calculateSlippageDollars(
  slippageBps: number, 
  filledPrice: number, 
  quantity: number, 
  symbol: string
): number {
  const multipliers: Record<string, number> = {
    MES: 5, MNQ: 2, ES: 50, NQ: 20, MYM: 0.5, M2K: 5
  };
  const multiplier = multipliers[symbol] || 5;
  return (slippageBps / 10000) * filledPrice * quantity * multiplier;
}

function calculateImplementationShortfall(
  filledPrice: number,
  decisionPrice: number,
  side: "BUY" | "SELL"
): number {
  if (decisionPrice === 0) return 0;
  
  const priceDiff = filledPrice - decisionPrice;
  const signedShortfall = side === "BUY" ? priceDiff : -priceDiff;
  
  return (signedShortfall / decisionPrice) * 10000;
}

function calculateExecutionQualityScore(params: {
  slippageBps: number;
  benchmarkVsVwap: number;
  executionLatencyMs: number;
  spreadAtOrder?: number;
  spreadAtFill?: number;
}): number {
  let score = 100;
  
  if (params.slippageBps > 0) {
    score -= Math.min(30, params.slippageBps * 3);
  } else {
    score += Math.min(10, Math.abs(params.slippageBps));
  }
  
  if (params.benchmarkVsVwap > 0) {
    score -= Math.min(20, params.benchmarkVsVwap * 2);
  } else {
    score += Math.min(10, Math.abs(params.benchmarkVsVwap));
  }
  
  if (params.executionLatencyMs > 1000) {
    score -= Math.min(20, (params.executionLatencyMs - 1000) / 100);
  }
  
  if (params.spreadAtFill && params.spreadAtOrder) {
    const spreadWidening = params.spreadAtFill - params.spreadAtOrder;
    if (spreadWidening > 0) {
      score -= Math.min(10, spreadWidening * 5);
    }
  }
  
  return Math.max(0, Math.min(100, score));
}

export async function recordTCA(trade: TradeForTCA): Promise<TcaRecord> {
  const slippageBps = calculateSlippageBps(trade.filledPrice, trade.arrivalPrice, trade.side);
  const slippageDollars = calculateSlippageDollars(slippageBps, trade.filledPrice, trade.quantity, trade.symbol);
  
  const implSlippage = trade.decisionPrice 
    ? calculateImplementationShortfall(trade.filledPrice, trade.decisionPrice, trade.side)
    : null;
  
  const benchmarkVsVwap = trade.vwapPrice
    ? calculateSlippageBps(trade.filledPrice, trade.vwapPrice, trade.side)
    : null;
  
  const benchmarkVsTwap = trade.twapPrice
    ? calculateSlippageBps(trade.filledPrice, trade.twapPrice, trade.side)
    : null;
  
  const executionLatencyMs = trade.fillTimestamp && trade.orderTimestamp
    ? trade.fillTimestamp.getTime() - trade.orderTimestamp.getTime()
    : null;
  
  const executionQualityScore = calculateExecutionQualityScore({
    slippageBps,
    benchmarkVsVwap: benchmarkVsVwap || 0,
    executionLatencyMs: executionLatencyMs || 0,
    spreadAtOrder: trade.spreadAtOrder,
    spreadAtFill: trade.spreadAtFill,
  });
  
  const marketImpactBps = trade.spreadAtFill && trade.spreadAtOrder
    ? (trade.spreadAtFill - trade.spreadAtOrder) / trade.arrivalPrice * 10000
    : null;
  
  const [record] = await db.insert(tcaRecords).values({
    tradeId: trade.id,
    botId: trade.botId,
    instanceId: trade.instanceId,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    orderType: trade.orderType,
    limitPrice: trade.limitPrice,
    filledPrice: trade.filledPrice,
    arrivalPrice: trade.arrivalPrice,
    decisionPrice: trade.decisionPrice,
    closePrice: null,
    twapPrice: trade.twapPrice,
    vwapPrice: trade.vwapPrice,
    slippageBps,
    slippageDollars,
    implSlippage,
    spreadAtOrder: trade.spreadAtOrder,
    spreadAtFill: trade.spreadAtFill,
    marketImpactBps,
    orderTimestamp: trade.orderTimestamp,
    fillTimestamp: trade.fillTimestamp,
    executionLatencyMs,
    executionQualityScore,
    benchmarkVsVwap,
    benchmarkVsTwap,
  }).returning();
  
  console.log(`[TCA] trade=${trade.id.slice(0,8)} slippage=${slippageBps.toFixed(2)}bps ($${slippageDollars.toFixed(2)}) quality=${executionQualityScore.toFixed(0)}`);
  
  return record;
}

export async function generateBestExecutionReport(params: {
  reportType: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY";
  periodStart: Date;
  periodEnd: Date;
  botId?: string;
  symbol?: string;
}): Promise<BestExecutionReport> {
  const conditions = [
    gte(tcaRecords.orderTimestamp, params.periodStart),
    lte(tcaRecords.orderTimestamp, params.periodEnd),
  ];
  
  if (params.botId) {
    conditions.push(eq(tcaRecords.botId, params.botId));
  }
  if (params.symbol) {
    conditions.push(eq(tcaRecords.symbol, params.symbol));
  }
  
  const records = await db
    .select()
    .from(tcaRecords)
    .where(and(...conditions));
  
  if (records.length === 0) {
    throw new Error("No TCA records found for the specified period");
  }
  
  const totalTrades = records.length;
  const totalVolume = records.reduce((sum, r) => sum + r.quantity, 0);
  
  const multipliers: Record<string, number> = {
    MES: 5, MNQ: 2, ES: 50, NQ: 20, MYM: 0.5, M2K: 5
  };
  const totalNotional = records.reduce((sum, r) => {
    const mult = multipliers[r.symbol] || 5;
    return sum + r.quantity * r.filledPrice * mult;
  }, 0);
  
  const avgSlippageBps = records.reduce((sum, r) => sum + r.slippageBps, 0) / totalTrades;
  const totalSlippageDollars = records.reduce((sum, r) => sum + r.slippageDollars, 0);
  const worstSlippageBps = Math.max(...records.map(r => r.slippageBps));
  
  const slippageValues = records.map(r => r.slippageBps);
  const slippageMean = avgSlippageBps;
  const slippageVariance = slippageValues.reduce((sum, v) => sum + Math.pow(v - slippageMean, 2), 0) / totalTrades;
  const slippageStdDev = Math.sqrt(slippageVariance);
  
  const vwapComparisons = records.filter(r => r.benchmarkVsVwap !== null);
  const avgVwapPerformance = vwapComparisons.length > 0
    ? vwapComparisons.reduce((sum, r) => sum + (r.benchmarkVsVwap || 0), 0) / vwapComparisons.length
    : null;
  
  const tradesBeatingVwap = vwapComparisons.filter(r => (r.benchmarkVsVwap || 0) < 0).length;
  const tradesBehindVwap = vwapComparisons.filter(r => (r.benchmarkVsVwap || 0) > 0).length;
  
  const latencies = records.filter(r => r.executionLatencyMs !== null);
  const avgExecutionLatencyMs = latencies.length > 0
    ? latencies.reduce((sum, r) => sum + (r.executionLatencyMs || 0), 0) / latencies.length
    : null;
  const maxExecutionLatencyMs = latencies.length > 0
    ? Math.max(...latencies.map(r => r.executionLatencyMs || 0))
    : null;
  
  const qualityScores = records.filter(r => r.executionQualityScore !== null);
  const overallExecutionScore = qualityScores.length > 0
    ? qualityScores.reduce((sum, r) => sum + (r.executionQualityScore || 0), 0) / qualityScores.length
    : null;
  
  const recommendations: string[] = [];
  
  if (avgSlippageBps > 5) {
    recommendations.push("Consider using limit orders instead of market orders to reduce slippage");
  }
  if (avgSlippageBps > 10) {
    recommendations.push("High slippage detected - review order sizing and timing");
  }
  if (slippageStdDev > 10) {
    recommendations.push("High slippage variance - execution quality is inconsistent");
  }
  if (avgVwapPerformance && avgVwapPerformance > 5) {
    recommendations.push("Trades consistently underperforming VWAP - consider VWAP algorithm");
  }
  if (avgExecutionLatencyMs && avgExecutionLatencyMs > 2000) {
    recommendations.push("High execution latency - review network connectivity and order routing");
  }
  if (overallExecutionScore && overallExecutionScore < 70) {
    recommendations.push("Overall execution quality below target - comprehensive review recommended");
  }
  
  const [report] = await db.insert(bestExecutionReports).values({
    reportType: params.reportType,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    botId: params.botId,
    symbol: params.symbol,
    totalTrades,
    totalVolume,
    totalNotional,
    avgSlippageBps,
    totalSlippageDollars,
    worstSlippageBps,
    slippageStdDev,
    avgVwapPerformance,
    tradesBeatingVwap,
    tradesBehindVwap,
    avgExecutionLatencyMs,
    maxExecutionLatencyMs,
    avgFillRate: 100,
    cancelRate: 0,
    rejectRate: 0,
    overallExecutionScore,
    recommendations,
  }).returning();
  
  await logImmutableAuditEvent({
    eventType: "BEST_EXECUTION_REPORT",
    entityType: "SYSTEM",
    entityId: "TCA",
    actorType: "SYSTEM",
    eventPayload: {
      reportId: report.id,
      reportType: params.reportType,
      periodStart: params.periodStart.toISOString(),
      periodEnd: params.periodEnd.toISOString(),
      totalTrades,
      avgSlippageBps,
      overallExecutionScore,
    },
  });
  
  console.log(`[TCA_REPORT] type=${params.reportType} trades=${totalTrades} avgSlippage=${avgSlippageBps.toFixed(2)}bps score=${overallExecutionScore?.toFixed(0)}`);
  
  return report;
}

export async function getExecutionSummary(botId?: string, days: number = 30): Promise<{
  totalTrades: number;
  avgSlippageBps: number;
  totalSlippageDollars: number;
  avgExecutionScore: number;
  vwapBeatingPct: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const conditions = [gte(tcaRecords.orderTimestamp, cutoff)];
  if (botId) {
    conditions.push(eq(tcaRecords.botId, botId));
  }
  
  const records = await db
    .select()
    .from(tcaRecords)
    .where(and(...conditions));
  
  if (records.length === 0) {
    return {
      totalTrades: 0,
      avgSlippageBps: 0,
      totalSlippageDollars: 0,
      avgExecutionScore: 0,
      vwapBeatingPct: 0,
    };
  }
  
  const totalTrades = records.length;
  const avgSlippageBps = records.reduce((sum, r) => sum + r.slippageBps, 0) / totalTrades;
  const totalSlippageDollars = records.reduce((sum, r) => sum + r.slippageDollars, 0);
  
  const qualityScores = records.filter(r => r.executionQualityScore !== null);
  const avgExecutionScore = qualityScores.length > 0
    ? qualityScores.reduce((sum, r) => sum + (r.executionQualityScore || 0), 0) / qualityScores.length
    : 0;
  
  const vwapComparisons = records.filter(r => r.benchmarkVsVwap !== null);
  const tradesBeatingVwap = vwapComparisons.filter(r => (r.benchmarkVsVwap || 0) < 0).length;
  const vwapBeatingPct = vwapComparisons.length > 0 ? (tradesBeatingVwap / vwapComparisons.length) * 100 : 0;
  
  return {
    totalTrades,
    avgSlippageBps,
    totalSlippageDollars,
    avgExecutionScore,
    vwapBeatingPct,
  };
}
