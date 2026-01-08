/**
 * P&L Attribution Service
 * 
 * INSTITUTIONAL STANDARD: Decompose returns by signal source, session, and regime.
 * - Attribution by signal source (e.g., which model/indicator generated the trade)
 * - Session attribution (London, NYC, Asia, overnight)
 * - Market regime attribution (trending, ranging, volatile)
 * - Time-weighted and trade-weighted breakdowns
 * 
 * Used by: Performance analytics, Strategy refinement, Risk reporting
 */

import { db } from "./db";
import { 
  paperTrades, 
  bots,
} from "@shared/schema";
import { eq, sql, desc, and, gte, lte, or } from "drizzle-orm";
import { logImmutableAuditEvent } from "./institutional-governance";

export interface AttributionPeriod {
  startDate: Date;
  endDate: Date;
}

export interface SignalSourceAttribution {
  source: string;
  tradeCount: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  winRate: number;
  profitFactor: number;
  contributionPct: number;
}

export interface SessionAttribution {
  session: "ASIA" | "LONDON" | "NYC" | "OVERNIGHT";
  tradeCount: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  winRate: number;
  contributionPct: number;
  timeRangeUTC: string;
}

export interface RegimeAttribution {
  regime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN";
  tradeCount: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  winRate: number;
  contributionPct: number;
}

export interface DayOfWeekAttribution {
  day: "MON" | "TUE" | "WED" | "THU" | "FRI";
  tradeCount: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  winRate: number;
  contributionPct: number;
}

export interface FullPnLAttribution {
  period: AttributionPeriod;
  totalPnl: number;
  totalTrades: number;
  bySignalSource: SignalSourceAttribution[];
  bySession: SessionAttribution[];
  byRegime: RegimeAttribution[];
  byDayOfWeek: DayOfWeekAttribution[];
  byBot: Array<{
    botId: string;
    botName: string;
    totalPnl: number;
    tradeCount: number;
    contributionPct: number;
  }>;
}

function getSessionFromHourUTC(hour: number): "ASIA" | "LONDON" | "NYC" | "OVERNIGHT" {
  if (hour >= 0 && hour < 8) return "ASIA";
  if (hour >= 8 && hour < 13) return "LONDON";
  if (hour >= 13 && hour < 21) return "NYC";
  return "OVERNIGHT";
}

function getSessionTimeRange(session: "ASIA" | "LONDON" | "NYC" | "OVERNIGHT"): string {
  switch (session) {
    case "ASIA": return "00:00-08:00 UTC";
    case "LONDON": return "08:00-13:00 UTC";
    case "NYC": return "13:00-21:00 UTC";
    case "OVERNIGHT": return "21:00-00:00 UTC";
  }
}

function getDayOfWeek(date: Date): "MON" | "TUE" | "WED" | "THU" | "FRI" | null {
  const day = date.getUTCDay();
  switch (day) {
    case 1: return "MON";
    case 2: return "TUE";
    case 3: return "WED";
    case 4: return "THU";
    case 5: return "FRI";
    default: return null;
  }
}

function calculateProfitFactor(winners: number, losers: number): number {
  if (losers === 0) return winners > 0 ? Infinity : 0;
  return winners / Math.abs(losers);
}

export async function getFullPnLAttribution(
  period: AttributionPeriod,
  botId?: string
): Promise<FullPnLAttribution> {
  const whereConditions = [
    eq(paperTrades.status, "CLOSED"),
    gte(paperTrades.exitTime, period.startDate),
    lte(paperTrades.exitTime, period.endDate),
  ];
  
  if (botId) {
    whereConditions.push(eq(paperTrades.botId, botId));
  }

  const trades = await db
    .select({
      id: paperTrades.id,
      botId: paperTrades.botId,
      symbol: paperTrades.symbol,
      side: paperTrades.side,
      pnl: paperTrades.pnl,
      entryTime: paperTrades.entryTime,
      exitTime: paperTrades.exitTime,
      entryReasonCode: paperTrades.entryReasonCode,
      botName: bots.name,
    })
    .from(paperTrades)
    .leftJoin(bots, eq(paperTrades.botId, bots.id))
    .where(and(...whereConditions));

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalTrades = trades.length;

  const bySignalSource = attributeBySignalSource(trades, totalPnl);
  const bySession = attributeBySession(trades, totalPnl);
  const byRegime = attributeByRegime(trades, totalPnl);
  const byDayOfWeek = attributeByDayOfWeek(trades, totalPnl);
  const byBot = attributeByBot(trades, totalPnl);

  return {
    period,
    totalPnl,
    totalTrades,
    bySignalSource,
    bySession,
    byRegime,
    byDayOfWeek,
    byBot,
  };
}

function attributeBySignalSource(
  trades: Array<{ pnl: number | null; entryReasonCode: string | null }>,
  totalPnl: number
): SignalSourceAttribution[] {
  const sourceMap = new Map<string, { pnl: number; wins: number; losses: number; count: number }>();

  for (const trade of trades) {
    const source = extractSignalSource(trade.entryReasonCode);
    if (!sourceMap.has(source)) {
      sourceMap.set(source, { pnl: 0, wins: 0, losses: 0, count: 0 });
    }
    const entry = sourceMap.get(source)!;
    entry.pnl += trade.pnl || 0;
    entry.count++;
    if ((trade.pnl || 0) > 0) {
      entry.wins += trade.pnl || 0;
    } else {
      entry.losses += Math.abs(trade.pnl || 0);
    }
  }

  return Array.from(sourceMap.entries())
    .map(([source, data]) => ({
      source,
      tradeCount: data.count,
      totalPnl: data.pnl,
      avgPnlPerTrade: data.count > 0 ? data.pnl / data.count : 0,
      winRate: data.count > 0 ? (data.wins > 0 ? 1 : 0) * 100 : 0,
      profitFactor: calculateProfitFactor(data.wins, data.losses),
      contributionPct: totalPnl !== 0 ? (data.pnl / totalPnl) * 100 : 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

function extractSignalSource(entryReason: string | null): string {
  if (!entryReason) return "UNKNOWN";
  
  const lowerReason = entryReason.toLowerCase();
  
  if (lowerReason.includes("momentum")) return "MOMENTUM";
  if (lowerReason.includes("mean_reversion") || lowerReason.includes("mean reversion")) return "MEAN_REVERSION";
  if (lowerReason.includes("breakout")) return "BREAKOUT";
  if (lowerReason.includes("trend")) return "TREND_FOLLOWING";
  if (lowerReason.includes("ml") || lowerReason.includes("machine learning")) return "ML_ALPHA";
  if (lowerReason.includes("rl") || lowerReason.includes("reinforcement")) return "RL_AGENT";
  if (lowerReason.includes("fusion") || lowerReason.includes("ensemble")) return "SIGNAL_FUSION";
  if (lowerReason.includes("sentiment")) return "SENTIMENT";
  if (lowerReason.includes("flow") || lowerReason.includes("options")) return "OPTIONS_FLOW";
  
  return "OTHER";
}

function attributeBySession(
  trades: Array<{ pnl: number | null; entryTime: Date | null }>,
  totalPnl: number
): SessionAttribution[] {
  const sessions: Array<"ASIA" | "LONDON" | "NYC" | "OVERNIGHT"> = ["ASIA", "LONDON", "NYC", "OVERNIGHT"];
  const sessionMap = new Map<string, { pnl: number; count: number; wins: number }>();

  for (const session of sessions) {
    sessionMap.set(session, { pnl: 0, count: 0, wins: 0 });
  }

  for (const trade of trades) {
    if (!trade.entryTime) continue;
    const hour = trade.entryTime.getUTCHours();
    const session = getSessionFromHourUTC(hour);
    const entry = sessionMap.get(session)!;
    entry.pnl += trade.pnl || 0;
    entry.count++;
    if ((trade.pnl || 0) > 0) entry.wins++;
  }

  return sessions.map(session => {
    const data = sessionMap.get(session)!;
    return {
      session,
      tradeCount: data.count,
      totalPnl: data.pnl,
      avgPnlPerTrade: data.count > 0 ? data.pnl / data.count : 0,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
      contributionPct: totalPnl !== 0 ? (data.pnl / totalPnl) * 100 : 0,
      timeRangeUTC: getSessionTimeRange(session),
    };
  });
}

function attributeByRegime(
  trades: Array<{ pnl: number | null; entryReasonCode: string | null }>,
  totalPnl: number
): RegimeAttribution[] {
  const regimes: Array<"TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN"> = 
    ["TRENDING_UP", "TRENDING_DOWN", "RANGING", "VOLATILE", "UNKNOWN"];
  const regimeMap = new Map<string, { pnl: number; count: number; wins: number }>();

  for (const regime of regimes) {
    regimeMap.set(regime, { pnl: 0, count: 0, wins: 0 });
  }

  for (const trade of trades) {
    const regime = extractRegime(trade.entryReasonCode);
    const entry = regimeMap.get(regime)!;
    entry.pnl += trade.pnl || 0;
    entry.count++;
    if ((trade.pnl || 0) > 0) entry.wins++;
  }

  return regimes.map(regime => {
    const data = regimeMap.get(regime)!;
    return {
      regime,
      tradeCount: data.count,
      totalPnl: data.pnl,
      avgPnlPerTrade: data.count > 0 ? data.pnl / data.count : 0,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
      contributionPct: totalPnl !== 0 ? (data.pnl / totalPnl) * 100 : 0,
    };
  });
}

function extractRegime(entryReason: string | null): "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "VOLATILE" | "UNKNOWN" {
  if (!entryReason) return "UNKNOWN";
  
  const lowerReason = entryReason.toLowerCase();
  
  if (lowerReason.includes("trending_up") || lowerReason.includes("uptrend") || lowerReason.includes("bullish")) {
    return "TRENDING_UP";
  }
  if (lowerReason.includes("trending_down") || lowerReason.includes("downtrend") || lowerReason.includes("bearish")) {
    return "TRENDING_DOWN";
  }
  if (lowerReason.includes("ranging") || lowerReason.includes("range") || lowerReason.includes("sideways")) {
    return "RANGING";
  }
  if (lowerReason.includes("volatile") || lowerReason.includes("high_volatility")) {
    return "VOLATILE";
  }
  
  return "UNKNOWN";
}

function attributeByDayOfWeek(
  trades: Array<{ pnl: number | null; entryTime: Date | null }>,
  totalPnl: number
): DayOfWeekAttribution[] {
  const days: Array<"MON" | "TUE" | "WED" | "THU" | "FRI"> = ["MON", "TUE", "WED", "THU", "FRI"];
  const dayMap = new Map<string, { pnl: number; count: number; wins: number }>();

  for (const day of days) {
    dayMap.set(day, { pnl: 0, count: 0, wins: 0 });
  }

  for (const trade of trades) {
    if (!trade.entryTime) continue;
    const day = getDayOfWeek(trade.entryTime);
    if (!day) continue;
    const entry = dayMap.get(day)!;
    entry.pnl += trade.pnl || 0;
    entry.count++;
    if ((trade.pnl || 0) > 0) entry.wins++;
  }

  return days.map(day => {
    const data = dayMap.get(day)!;
    return {
      day,
      tradeCount: data.count,
      totalPnl: data.pnl,
      avgPnlPerTrade: data.count > 0 ? data.pnl / data.count : 0,
      winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
      contributionPct: totalPnl !== 0 ? (data.pnl / totalPnl) * 100 : 0,
    };
  });
}

function attributeByBot(
  trades: Array<{ pnl: number | null; botId: string; botName: string | null }>,
  totalPnl: number
): Array<{ botId: string; botName: string; totalPnl: number; tradeCount: number; contributionPct: number }> {
  const botMap = new Map<string, { name: string; pnl: number; count: number }>();

  for (const trade of trades) {
    if (!botMap.has(trade.botId)) {
      botMap.set(trade.botId, { name: trade.botName || "Unknown", pnl: 0, count: 0 });
    }
    const entry = botMap.get(trade.botId)!;
    entry.pnl += trade.pnl || 0;
    entry.count++;
  }

  return Array.from(botMap.entries())
    .map(([botId, data]) => ({
      botId,
      botName: data.name,
      totalPnl: data.pnl,
      tradeCount: data.count,
      contributionPct: totalPnl !== 0 ? (data.pnl / totalPnl) * 100 : 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

export async function getDailyPnLAttribution(): Promise<FullPnLAttribution> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);

  return getFullPnLAttribution({
    startDate: startOfDay,
    endDate: now,
  });
}

export async function getWeeklyPnLAttribution(): Promise<FullPnLAttribution> {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 7);
  startOfWeek.setUTCHours(0, 0, 0, 0);

  return getFullPnLAttribution({
    startDate: startOfWeek,
    endDate: now,
  });
}

export async function getMonthlyPnLAttribution(): Promise<FullPnLAttribution> {
  const now = new Date();
  const startOfMonth = new Date(now);
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  return getFullPnLAttribution({
    startDate: startOfMonth,
    endDate: now,
  });
}
