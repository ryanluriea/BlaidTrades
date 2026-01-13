import { db } from "./db";
import { bots, botStageChanges } from "@shared/schema";
import { eq, and, sql, gte, lt, count } from "drizzle-orm";
import { detectMarketRegime, type RegimeResult } from "./regime-detector";
import { logActivityEvent } from "./activity-logger";

export type MarketRegime = "VOLATILITY_SPIKE" | "VOLATILITY_COMPRESSION" | "TRENDING_STRONG" | "RANGE_BOUND" | "NONE";

export interface ArchetypeRegimeAffinity {
  archetype: string;
  favorableRegimes: MarketRegime[];
  unfavorableRegimes: MarketRegime[];
  description: string;
}

export const ARCHETYPE_REGIME_AFFINITIES: ArchetypeRegimeAffinity[] = [
  {
    archetype: "breakout",
    favorableRegimes: ["VOLATILITY_SPIKE", "TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "Breakouts thrive in volatile, trending markets with strong directional moves"
  },
  {
    archetype: "orb_breakout",
    favorableRegimes: ["VOLATILITY_SPIKE", "TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "Opening range breakouts need volatility and trend continuation"
  },
  {
    archetype: "rth_breakout",
    favorableRegimes: ["VOLATILITY_SPIKE", "TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND"],
    description: "RTH breakouts perform in active trending sessions"
  },
  {
    archetype: "breakout_retest",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "Breakout retests need sustained trends for confirmation"
  },
  {
    archetype: "mean_reversion",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["TRENDING_STRONG", "VOLATILITY_SPIKE"],
    description: "Mean reversion excels in low-volatility ranging markets"
  },
  {
    archetype: "exhaustion_fade",
    favorableRegimes: ["VOLATILITY_SPIKE", "RANGE_BOUND"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "Exhaustion fades work when moves overextend but not in strong trends"
  },
  {
    archetype: "gap_fade",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "Gap fades expect mean reversion - fail in trending markets"
  },
  {
    archetype: "gap_fill",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "Gap fills rely on price returning to previous levels"
  },
  {
    archetype: "gap_and_go",
    favorableRegimes: ["TRENDING_STRONG", "VOLATILITY_SPIKE"],
    unfavorableRegimes: ["RANGE_BOUND"],
    description: "Gap and go needs momentum continuation after the gap"
  },
  {
    archetype: "reversal",
    favorableRegimes: ["VOLATILITY_SPIKE"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "Reversals catch overextended moves - fail in sustained trends"
  },
  {
    archetype: "reversal_hunter",
    favorableRegimes: ["VOLATILITY_SPIKE"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "Reversal hunting needs extreme moves to fade"
  },
  {
    archetype: "vwap",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "VWAP strategies work when price oscillates around VWAP"
  },
  {
    archetype: "vwap_bounce",
    favorableRegimes: ["RANGE_BOUND"],
    unfavorableRegimes: ["TRENDING_STRONG", "VOLATILITY_SPIKE"],
    description: "VWAP bounces need orderly mean-reverting price action"
  },
  {
    archetype: "vwap_reclaim",
    favorableRegimes: ["VOLATILITY_COMPRESSION", "RANGE_BOUND"],
    unfavorableRegimes: ["TRENDING_STRONG"],
    description: "VWAP reclaims work in consolidating markets"
  },
  {
    archetype: "vwap_scalper",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["VOLATILITY_SPIKE"],
    description: "VWAP scalping needs tight ranges around VWAP"
  },
  {
    archetype: "trend",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "Trend strategies need directional markets"
  },
  {
    archetype: "trend_following",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "Trend following requires sustained directional moves"
  },
  {
    archetype: "trend_ema_cross",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND"],
    description: "EMA crosses generate false signals in ranging markets"
  },
  {
    archetype: "trend_macd",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    description: "MACD trend signals work best in trending markets"
  },
  {
    archetype: "trend_rider",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND"],
    description: "Trend riders need extended directional moves"
  },
  {
    archetype: "momentum_surge",
    favorableRegimes: ["VOLATILITY_SPIKE", "TRENDING_STRONG"],
    unfavorableRegimes: ["VOLATILITY_COMPRESSION", "RANGE_BOUND"],
    description: "Momentum surges need high volatility and directional conviction"
  },
  {
    archetype: "scalping",
    favorableRegimes: ["VOLATILITY_SPIKE", "TRENDING_STRONG"],
    unfavorableRegimes: ["VOLATILITY_COMPRESSION"],
    description: "Scalping needs movement - fails in dead markets"
  },
  {
    archetype: "micro_pullback",
    favorableRegimes: ["TRENDING_STRONG"],
    unfavorableRegimes: ["RANGE_BOUND"],
    description: "Micro pullbacks need trend context to work"
  },
  {
    archetype: "range_scalper",
    favorableRegimes: ["RANGE_BOUND", "VOLATILITY_COMPRESSION"],
    unfavorableRegimes: ["TRENDING_STRONG", "VOLATILITY_SPIKE"],
    description: "Range scalping needs defined ranges - fails in trending or volatile markets"
  }
];

function getAffinityForArchetype(archetype: string): ArchetypeRegimeAffinity | null {
  const normalized = archetype.toLowerCase().trim().replace(/\s+/g, "_").replace(/-/g, "_");
  return ARCHETYPE_REGIME_AFFINITIES.find(a => a.archetype === normalized) || null;
}

function isArchetypeFavorableInRegime(archetype: string, regime: MarketRegime): boolean {
  const affinity = getAffinityForArchetype(archetype);
  if (!affinity) return false;
  return affinity.favorableRegimes.includes(regime);
}

export interface ResurrectionCandidate {
  id: string;
  name: string;
  archetype: string;
  symbol: string;
  archivedAt: Date | null;
  reason: string;
}

export interface ResurrectionResult {
  scannedCount: number;
  resurrectedCount: number;
  skippedDueToCooldown: number;
  skippedDueToCapLimits: number;
  currentRegime: MarketRegime;
  candidates: ResurrectionCandidate[];
  errors: string[];
}

async function getFleetGovernorLimits(): Promise<{ enabled: boolean; trialsCap: number; globalCap: number }> {
  try {
    const { getStrategyLabState } = await import("./strategy-lab-engine");
    const state = getStrategyLabState();
    return {
      enabled: state.fleetGovernorEnabled ?? true,
      trialsCap: state.fleetGovernorTrialsCap ?? 50,
      globalCap: state.fleetGovernorGlobalCap ?? 100
    };
  } catch {
    return { enabled: true, trialsCap: 50, globalCap: 100 };
  }
}

async function getCurrentBotCounts(): Promise<{ trialsCount: number; totalActive: number }> {
  const [trialsResult, activeResult] = await Promise.all([
    db.select({ count: count() })
      .from(bots)
      .where(and(
        eq(bots.stage, "TRIALS"),
        sql`${bots.status} NOT IN ('archived', 'disabled')`
      )),
    db.select({ count: count() })
      .from(bots)
      .where(sql`${bots.status} NOT IN ('archived', 'disabled')`)
  ]);
  
  return {
    trialsCount: trialsResult[0]?.count ?? 0,
    totalActive: activeResult[0]?.count ?? 0
  };
}

async function recordStageChange(
  botId: string, 
  fromStage: string, 
  toStage: string, 
  reason: string,
  traceId: string
): Promise<void> {
  try {
    await db.insert(botStageChanges).values({
      botId,
      fromStage,
      toStage,
      reason,
      triggeredBy: "RESURRECTION_DETECTOR",
      metadata: { traceId, regime: reason }
    });
  } catch (err) {
    console.error(`[RESURRECTION_DETECTOR] Failed to record stage change for bot ${botId}:`, err);
  }
}

export async function runResurrectionScan(traceId: string): Promise<ResurrectionResult> {
  const result: ResurrectionResult = {
    scannedCount: 0,
    resurrectedCount: 0,
    skippedDueToCooldown: 0,
    skippedDueToCapLimits: 0,
    currentRegime: "NONE",
    candidates: [],
    errors: []
  };
  
  console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Starting archived bot resurrection scan...`);
  
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const regimeResult = await detectMarketRegime("MES", thirtyDaysAgo, now, traceId);
    
    let currentRegime: MarketRegime = "NONE";
    if (regimeResult.regime === "HIGH_VOLATILITY") {
      currentRegime = "VOLATILITY_SPIKE";
    } else if (regimeResult.regime === "LOW_VOLATILITY") {
      currentRegime = "VOLATILITY_COMPRESSION";
    } else if (regimeResult.regime === "BULL" || regimeResult.regime === "BEAR") {
      currentRegime = regimeResult.confidence > 0.6 ? "TRENDING_STRONG" : "RANGE_BOUND";
    } else if (regimeResult.regime === "SIDEWAYS") {
      currentRegime = "RANGE_BOUND";
    }
    
    result.currentRegime = currentRegime;
    console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Current regime: ${currentRegime} (confidence: ${(regimeResult.confidence * 100).toFixed(1)}%)`);
    
    if (currentRegime === "NONE") {
      console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} No clear regime detected, skipping resurrection scan`);
      return result;
    }
    
    const fleetLimits = await getFleetGovernorLimits();
    if (!fleetLimits.enabled) {
      console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Fleet Governor disabled, skipping resurrection to avoid uncontrolled growth`);
      return result;
    }
    
    const currentCounts = await getCurrentBotCounts();
    const availableTrialsSlots = Math.max(0, fleetLimits.trialsCap - currentCounts.trialsCount);
    const availableGlobalSlots = Math.max(0, fleetLimits.globalCap - currentCounts.totalActive);
    const maxResurrections = Math.min(availableTrialsSlots, availableGlobalSlots, 5);
    
    console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Fleet capacity: trials=${currentCounts.trialsCount}/${fleetLimits.trialsCap} total=${currentCounts.totalActive}/${fleetLimits.globalCap} max_resurrections=${maxResurrections}`);
    
    if (maxResurrections <= 0) {
      console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} No capacity for resurrections, fleet at limit`);
      result.skippedDueToCapLimits = 1;
      return result;
    }
    
    const archivedBots = await db.select({
      id: bots.id,
      name: bots.name,
      archetype: bots.strategyArchetype,
      symbol: bots.symbol,
      archivedAt: bots.archivedAt,
      stage: bots.stage,
      userId: bots.userId,
    })
    .from(bots)
    .where(
      and(
        eq(bots.status, "archived"),
        sql`${bots.strategyArchetype} IS NOT NULL`,
        sql`${bots.strategyArchetype} != ''`
      )
    )
    .limit(100);
    
    result.scannedCount = archivedBots.length;
    console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Found ${archivedBots.length} archived bots to evaluate`);
    
    const favorableCandidates: (ResurrectionCandidate & { userId: string; previousStage: string })[] = [];
    
    for (const bot of archivedBots) {
      if (!bot.archetype) continue;
      
      if (bot.archivedAt && bot.archivedAt > sevenDaysAgo) {
        result.skippedDueToCooldown++;
        continue;
      }
      
      const affinity = getAffinityForArchetype(bot.archetype);
      if (!affinity) {
        continue;
      }
      
      if (isArchetypeFavorableInRegime(bot.archetype, currentRegime)) {
        favorableCandidates.push({
          id: bot.id,
          name: bot.name,
          archetype: bot.archetype,
          symbol: bot.symbol || "MES",
          archivedAt: bot.archivedAt,
          reason: `${affinity.description} - current regime (${currentRegime}) is favorable`,
          userId: bot.userId,
          previousStage: bot.stage || "ARCHIVED"
        });
      }
    }
    
    console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Found ${favorableCandidates.length} candidates favorable for current regime (${result.skippedDueToCooldown} skipped due to 7-day cooldown)`);
    
    const toResurrect = favorableCandidates.slice(0, maxResurrections);
    
    for (const candidate of toResurrect) {
      try {
        await db.update(bots)
          .set({
            status: "idle",
            stage: "TRIALS",
            archivedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(bots.id, candidate.id));
        
        await recordStageChange(
          candidate.id,
          candidate.previousStage,
          "TRIALS",
          `Resurrected by regime detector: ${currentRegime} favors ${candidate.archetype}`,
          traceId
        );
        
        result.resurrectedCount++;
        result.candidates.push(candidate);
        
        console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} RESURRECTED bot=${candidate.name} archetype=${candidate.archetype} regime=${currentRegime}`);
        
        await logActivityEvent({
          type: "BOT_RESURRECTED",
          severity: "INFO",
          title: `Resurrected ${candidate.name} for ${currentRegime} regime`,
          description: candidate.reason,
          traceId,
          userId: candidate.userId,
          botId: candidate.id,
          metadata: {
            archetype: candidate.archetype,
            regime: currentRegime,
            archivedAt: candidate.archivedAt?.toISOString()
          }
        });
        
      } catch (err) {
        const errorMsg = `Failed to resurrect bot ${candidate.id}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(errorMsg);
        console.error(`[RESURRECTION_DETECTOR] trace_id=${traceId} ${errorMsg}`);
      }
    }
    
    if (result.resurrectedCount > 0) {
      console.log(`[RESURRECTION_DETECTOR] trace_id=${traceId} Complete: scanned=${result.scannedCount} resurrected=${result.resurrectedCount} regime=${currentRegime}`);
    }
    
    return result;
    
  } catch (err) {
    const errorMsg = `Resurrection scan failed: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(errorMsg);
    console.error(`[RESURRECTION_DETECTOR] trace_id=${traceId} ${errorMsg}`);
    return result;
  }
}

export function getArchetypeAffinities(): ArchetypeRegimeAffinity[] {
  return ARCHETYPE_REGIME_AFFINITIES;
}

export function getFavorableArchetypesForRegime(regime: MarketRegime): string[] {
  return ARCHETYPE_REGIME_AFFINITIES
    .filter(a => a.favorableRegimes.includes(regime))
    .map(a => a.archetype);
}

export function getUnfavorableArchetypesForRegime(regime: MarketRegime): string[] {
  return ARCHETYPE_REGIME_AFFINITIES
    .filter(a => a.unfavorableRegimes.includes(regime))
    .map(a => a.archetype);
}
