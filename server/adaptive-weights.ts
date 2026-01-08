import { db } from "./db";
import { signalWeightHistory, backtestSessions, bots } from "@shared/schema";
import { eq, desc, and, gte, isNotNull } from "drizzle-orm";
import crypto from "crypto";
import { SourceId } from "@shared/strategy-types";
import type { SourcePerformanceSnapshot } from "./source-selection-governor";

export interface AdaptiveWeightConfig {
  minWeight: number;
  maxWeight: number;
  lookbackDays: number;
  decayFactor: number;
  rebalanceIntervalMs: number;
}

export interface SignalWeights {
  options_flow: number;
  macro_indicators: number;
  news_sentiment: number;
  economic_calendar: number;
}

export interface WeightAdjustment {
  sourceId: string;
  previousWeight: number;
  newWeight: number;
  reason: string;
  performanceScore: number;
  confidence: number;
}

export interface AdaptiveWeightResult {
  weights: SignalWeights;
  adjustments: WeightAdjustment[];
  lastOptimized: Date;
  confidence: number;
  regime: "TRENDING" | "RANGING" | "VOLATILE" | "UNKNOWN";
}

const DEFAULT_CONFIG: AdaptiveWeightConfig = {
  minWeight: 0.05,
  maxWeight: 0.70,
  lookbackDays: 30,
  decayFactor: 0.95,
  rebalanceIntervalMs: 3600000,
};

const DEFAULT_WEIGHTS: SignalWeights = {
  options_flow: 0.40,
  macro_indicators: 0.35,
  news_sentiment: 0.25,
  economic_calendar: 0.00,
};

const cachedWeightsMap: Map<string, { result: AdaptiveWeightResult; timestamp: Date }> = new Map();
const GLOBAL_CACHE_KEY = "__global__";

export async function getAdaptiveWeights(
  botId?: string,
  traceId?: string,
  config: AdaptiveWeightConfig = DEFAULT_CONFIG
): Promise<AdaptiveWeightResult> {
  const now = new Date();
  const cacheKey = botId || GLOBAL_CACHE_KEY;
  const cached = cachedWeightsMap.get(cacheKey);
  
  if (
    cached &&
    now.getTime() - cached.timestamp.getTime() < config.rebalanceIntervalMs
  ) {
    return cached.result;
  }

  const result = await optimizeWeights(botId, traceId, config);
  cachedWeightsMap.set(cacheKey, { result, timestamp: now });
  
  return result;
}

export async function optimizeWeights(
  botId?: string,
  traceId?: string,
  config: AdaptiveWeightConfig = DEFAULT_CONFIG
): Promise<AdaptiveWeightResult> {
  const tid = traceId || crypto.randomUUID().slice(0, 8);
  
  try {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.lookbackDays);

    const whereConditions = [
      eq(backtestSessions.status, "COMPLETED"),
      gte(backtestSessions.createdAt, lookbackDate),
      isNotNull(backtestSessions.profitFactor)
    ];
    
    if (botId) {
      whereConditions.push(eq(backtestSessions.botId, botId));
    }

    const recentBacktests = await db
      .select({
        botId: backtestSessions.botId,
        profitFactor: backtestSessions.profitFactor,
        winRate: backtestSessions.winRate,
        totalTrades: backtestSessions.totalTrades,
        completedAt: backtestSessions.completedAt,
      })
      .from(backtestSessions)
      .where(and(...whereConditions))
      .orderBy(desc(backtestSessions.completedAt))
      .limit(botId ? 50 : 100);

    const scope = botId ? `bot_id=${botId}` : "global";
    
    if (recentBacktests.length < 3) {
      console.log(`[ADAPTIVE_WEIGHTS] trace_id=${tid} ${scope} insufficient_data sessions=${recentBacktests.length} using_defaults`);
      return {
        weights: { ...DEFAULT_WEIGHTS },
        adjustments: [],
        lastOptimized: new Date(),
        confidence: 30,
        regime: "UNKNOWN",
      };
    }

    const sourcePerformance: Record<string, { totalScore: number; count: number; decayedScore: number }> = {
      options_flow: { totalScore: 0, count: 0, decayedScore: 0 },
      macro_indicators: { totalScore: 0, count: 0, decayedScore: 0 },
      news_sentiment: { totalScore: 0, count: 0, decayedScore: 0 },
      economic_calendar: { totalScore: 0, count: 0, decayedScore: 0 },
    };

    const now = new Date();
    for (let i = 0; i < recentBacktests.length; i++) {
      const session = recentBacktests[i];
      
      const profitFactor = Number(session.profitFactor) || 1.0;
      const winRate = Number(session.winRate) || 0.5;
      const performanceScore = (profitFactor - 1) * 100 + (winRate - 0.5) * 50;
      
      const daysSinceCompletion = session.completedAt 
        ? (now.getTime() - new Date(session.completedAt).getTime()) / (1000 * 60 * 60 * 24)
        : config.lookbackDays;
      const decayMultiplier = Math.pow(config.decayFactor, daysSinceCompletion);

      const enabledSources = ["options_flow", "macro_indicators", "news_sentiment"];

      for (const sourceId of enabledSources) {
        if (sourcePerformance[sourceId]) {
          sourcePerformance[sourceId].totalScore += performanceScore;
          sourcePerformance[sourceId].count += 1;
          sourcePerformance[sourceId].decayedScore += performanceScore * decayMultiplier;
        }
      }
    }

    const rawWeights: Record<string, number> = {};
    let totalRawWeight = 0;
    
    for (const [sourceId, perf] of Object.entries(sourcePerformance)) {
      if (perf.count > 0) {
        const avgScore = perf.decayedScore / perf.count;
        const normalizedScore = Math.max(0, avgScore + 50);
        rawWeights[sourceId] = normalizedScore;
        totalRawWeight += normalizedScore;
      } else {
        rawWeights[sourceId] = 25;
        totalRawWeight += 25;
      }
    }

    const newWeights: SignalWeights = { ...DEFAULT_WEIGHTS };
    const adjustments: WeightAdjustment[] = [];
    
    if (totalRawWeight > 0) {
      for (const [sourceId, rawWeight] of Object.entries(rawWeights)) {
        const normalizedWeight = rawWeight / totalRawWeight;
        const sourceKey = sourceId as keyof SignalWeights;
        newWeights[sourceKey] = normalizedWeight;
      }
    }

    const activeSourceIds = Object.keys(newWeights).filter(
      id => newWeights[id as keyof SignalWeights] > 0
    );
    const numActiveSources = activeSourceIds.length;
    
    if (numActiveSources > 0) {
      const totalMinRequired = numActiveSources * config.minWeight;
      const totalMaxAllowed = numActiveSources * config.maxWeight;
      
      if (totalMinRequired > 1.0) {
        const equalWeight = 1.0 / numActiveSources;
        for (const sourceId of activeSourceIds) {
          newWeights[sourceId as keyof SignalWeights] = equalWeight;
        }
      } else {
        for (let iteration = 0; iteration < 10; iteration++) {
          let deficit = 0;
          let surplus = 0;
          let adjustableWeight = 0;
          
          for (const sourceId of activeSourceIds) {
            const weight = newWeights[sourceId as keyof SignalWeights];
            if (weight < config.minWeight) {
              deficit += config.minWeight - weight;
              newWeights[sourceId as keyof SignalWeights] = config.minWeight;
            } else if (weight > config.maxWeight) {
              surplus += weight - config.maxWeight;
              newWeights[sourceId as keyof SignalWeights] = config.maxWeight;
            } else {
              adjustableWeight += weight;
            }
          }
          
          const netAdjustment = surplus - deficit;
          if (Math.abs(netAdjustment) < 0.001) break;
          
          if (adjustableWeight > 0.01) {
            for (const sourceId of activeSourceIds) {
              const weight = newWeights[sourceId as keyof SignalWeights];
              if (weight > config.minWeight && weight < config.maxWeight) {
                const proportion = weight / adjustableWeight;
                const adjustment = netAdjustment * proportion;
                newWeights[sourceId as keyof SignalWeights] = Math.max(
                  config.minWeight,
                  Math.min(config.maxWeight, weight + adjustment)
                );
              }
            }
          } else {
            break;
          }
        }
        
        const currentTotal = activeSourceIds.reduce(
          (sum, id) => sum + newWeights[id as keyof SignalWeights],
          0
        );
        
        if (Math.abs(currentTotal - 1.0) > 0.001 && currentTotal > 0) {
          const scale = 1.0 / currentTotal;
          for (const sourceId of activeSourceIds) {
            newWeights[sourceId as keyof SignalWeights] = Math.max(
              config.minWeight,
              Math.min(config.maxWeight, newWeights[sourceId as keyof SignalWeights] * scale)
            );
          }
        }
      }
    }

    for (const [sourceId, weight] of Object.entries(newWeights)) {
      const sourceKey = sourceId as keyof SignalWeights;
      const previousWeight = DEFAULT_WEIGHTS[sourceKey] || 0;
      
      if (Math.abs(weight - previousWeight) > 0.02) {
        adjustments.push({
          sourceId,
          previousWeight,
          newWeight: weight,
          reason: `Performance-based adjustment (${sourcePerformance[sourceId]?.count || 0} samples, ${scope})`,
          performanceScore: sourcePerformance[sourceId]?.decayedScore || 0,
          confidence: Math.min(100, (sourcePerformance[sourceId]?.count || 0) * 10),
        });
      }
    }

    const regime = detectMarketRegime(recentBacktests);
    const confidence = Math.min(100, 30 + recentBacktests.length * 0.7);

    if (adjustments.length > 0) {
      await logWeightChange(botId || null, newWeights, adjustments, regime, tid);
    }

    console.log(`[ADAPTIVE_WEIGHTS] trace_id=${tid} ${scope} optimized sessions=${recentBacktests.length} adjustments=${adjustments.length} confidence=${confidence.toFixed(0)}% regime=${regime}`);

    return {
      weights: newWeights,
      adjustments,
      lastOptimized: new Date(),
      confidence,
      regime,
    };
  } catch (error) {
    console.error(`[ADAPTIVE_WEIGHTS] trace_id=${tid} error:`, error);
    return {
      weights: { ...DEFAULT_WEIGHTS },
      adjustments: [],
      lastOptimized: new Date(),
      confidence: 0,
      regime: "UNKNOWN",
    };
  }
}

function detectMarketRegime(
  backtests: Array<{ winRate: number | null; profitFactor: number | null }>
): "TRENDING" | "RANGING" | "VOLATILE" | "UNKNOWN" {
  if (backtests.length < 5) return "UNKNOWN";
  
  const winRates = backtests
    .map(b => Number(b.winRate))
    .filter(w => !isNaN(w) && w > 0);
  
  if (winRates.length < 3) return "UNKNOWN";
  
  const avgWinRate = winRates.reduce((a, b) => a + b, 0) / winRates.length;
  const variance = winRates.reduce((sum, w) => sum + Math.pow(w - avgWinRate, 2), 0) / winRates.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev > 0.15) return "VOLATILE";
  if (avgWinRate > 0.55) return "TRENDING";
  return "RANGING";
}

async function logWeightChange(
  botId: string | null,
  weights: SignalWeights,
  adjustments: WeightAdjustment[],
  regime: string,
  traceId: string
): Promise<void> {
  try {
    await db.insert(signalWeightHistory).values({
      id: crypto.randomUUID(),
      botId: botId || null,
      weights,
      adjustments,
      regime,
      confidence: adjustments.length > 0 ? adjustments[0].confidence : 50,
      reason: adjustments.map(a => a.reason).join("; ") || "Scheduled rebalance",
      createdAt: new Date(),
    });
    
    console.log(`[ADAPTIVE_WEIGHTS] trace_id=${traceId} weight_change_logged bot_id=${botId || "global"}`);
  } catch (error) {
    console.error(`[ADAPTIVE_WEIGHTS] trace_id=${traceId} failed to log weight change:`, error);
  }
}

export async function getWeightHistory(
  botId?: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  weights: SignalWeights;
  adjustments: WeightAdjustment[];
  regime: string;
  confidence: number;
  createdAt: Date;
}>> {
  const baseQuery = db.select().from(signalWeightHistory);
  const query = botId
    ? baseQuery.where(eq(signalWeightHistory.botId, botId))
    : baseQuery;
  
  const results = await query.orderBy(desc(signalWeightHistory.createdAt)).limit(limit);
  
  return results.map(r => ({
    id: r.id,
    weights: r.weights as SignalWeights,
    adjustments: (r.adjustments || []) as WeightAdjustment[],
    regime: r.regime,
    confidence: r.confidence || 50,
    createdAt: r.createdAt || new Date(),
  }));
}

export async function lockWeightsOverride(
  botId: string,
  weights: SignalWeights,
  expiresAt: Date,
  reason: string,
  traceId: string
): Promise<void> {
  await db.insert(signalWeightHistory).values({
    id: crypto.randomUUID(),
    botId,
    weights,
    adjustments: [],
    regime: "MANUAL_OVERRIDE",
    confidence: 100,
    reason: `Manual override: ${reason}`,
    expiresAt,
    createdAt: new Date(),
  });
  
  console.log(`[ADAPTIVE_WEIGHTS] trace_id=${traceId} manual_override bot_id=${botId} expires_at=${expiresAt.toISOString()}`);
}

export function clearWeightCache(botId?: string): void {
  if (botId) {
    cachedWeightsMap.delete(botId);
  } else {
    cachedWeightsMap.clear();
  }
}

// Track consecutive cycles at floor per source per bot
const floorCycleTracker: Map<string, Map<string, number>> = new Map();
const WEIGHT_FLOOR = 0.08; // 8% floor threshold

// Re-export for convenience
export type { SourcePerformanceSnapshot };

export async function buildPerformanceSnapshots(
  botId: string,
  traceId?: string
): Promise<SourcePerformanceSnapshot[]> {
  const tid = traceId || crypto.randomUUID().slice(0, 8);
  
  try {
    // Get current adaptive weights
    const weightsResult = await getAdaptiveWeights(botId, tid);
    const weights = weightsResult.weights;
    
    // Get recent backtests for this bot
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - 30);
    
    const recentBacktests = await db
      .select({
        profitFactor: backtestSessions.profitFactor,
        winRate: backtestSessions.winRate,
      })
      .from(backtestSessions)
      .where(and(
        eq(backtestSessions.botId, botId),
        eq(backtestSessions.status, "COMPLETED"),
        gte(backtestSessions.createdAt, lookbackDate)
      ))
      .limit(50);
    
    // Calculate average performance score
    const perfScores = recentBacktests.map(b => {
      const pf = Number(b.profitFactor) || 1.0;
      const wr = Number(b.winRate) || 0.5;
      return (pf - 1) * 100 + (wr - 0.5) * 50;
    });
    const avgScore = perfScores.length > 0 
      ? perfScores.reduce((a, b) => a + b, 0) / perfScores.length 
      : 0;
    
    // Get or create floor cycle tracker for this bot
    if (!floorCycleTracker.has(botId)) {
      floorCycleTracker.set(botId, new Map());
    }
    const botTracker = floorCycleTracker.get(botId)!;
    
    const sourceIds: SourceId[] = ["options_flow", "macro_indicators", "news_sentiment", "economic_calendar"];
    const snapshots: SourcePerformanceSnapshot[] = [];
    
    for (const sourceId of sourceIds) {
      const weight = weights[sourceId as keyof SignalWeights];
      const atFloor = weight <= WEIGHT_FLOOR;
      
      // Track consecutive cycles at floor
      let consecutiveCycles = botTracker.get(sourceId) || 0;
      if (atFloor) {
        consecutiveCycles += 1;
      } else {
        consecutiveCycles = 0;
      }
      botTracker.set(sourceId, consecutiveCycles);
      
      snapshots.push({
        sourceId,
        weight,
        performanceScore: avgScore,
        contributingBacktests: recentBacktests.length,
        atWeightFloor: atFloor,
        consecutiveCyclesAtFloor: consecutiveCycles,
      });
    }
    
    console.log(`[ADAPTIVE_WEIGHTS] trace_id=${tid} bot_id=${botId} built_snapshots count=${snapshots.length} avg_score=${avgScore.toFixed(1)} backtests=${recentBacktests.length}`);
    
    return snapshots;
  } catch (error) {
    console.error(`[ADAPTIVE_WEIGHTS] trace_id=${tid} bot_id=${botId} snapshot_error:`, error);
    return [];
  }
}

export function resetFloorCycleTracker(botId?: string): void {
  if (botId) {
    floorCycleTracker.delete(botId);
  } else {
    floorCycleTracker.clear();
  }
}
