import { detectMarketRegime, type RegimeResult, type RegimeMetrics } from "./regime-detector";
import { fetchMacroSnapshot, getMacroTradingBias, type MacroSnapshot } from "./fred-client";
import { logActivityEvent } from "./activity-logger";
import crypto from "crypto";

export type UnifiedRegime = 
  | "BULL_EXPANSION"
  | "BULL_CONTRACTION"
  | "BEAR_EXPANSION"
  | "BEAR_RECESSION"
  | "SIDEWAYS_STABLE"
  | "HIGH_VOL_CRISIS"
  | "LOW_VOL_COMPRESSION"
  | "TRANSITION"
  | "UNKNOWN";

export interface RegimeState {
  unifiedRegime: UnifiedRegime;
  marketRegime: RegimeResult;
  macroSnapshot: MacroSnapshot | null;
  confidence: number;
  positionSizeMultiplier: number;
  strategyRecommendations: StrategyRecommendation[];
  riskAdjustments: RiskAdjustment[];
  lastUpdated: Date;
  traceId: string;
}

export interface StrategyRecommendation {
  archetype: string;
  suitability: "OPTIMAL" | "ACCEPTABLE" | "AVOID";
  reason: string;
}

export interface RiskAdjustment {
  parameter: string;
  adjustment: number;
  reason: string;
}

export interface RegimeOverride {
  symbol: string;
  positionSizeMultiplier: number;
  maxPositions: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
  allowedArchetypes: string[];
  blockedArchetypes: string[];
}

const regimeCache: Map<string, RegimeState> = new Map();
const REGIME_CACHE_TTL_MS = 5 * 60 * 1000;

const REGIME_STRATEGY_MATRIX: Record<UnifiedRegime, {
  optimalArchetypes: string[];
  acceptableArchetypes: string[];
  avoidArchetypes: string[];
  positionMultiplier: number;
  stopLossMultiplier: number;
  takeProfitMultiplier: number;
}> = {
  BULL_EXPANSION: {
    optimalArchetypes: ["momentum", "trend_following", "breakout"],
    acceptableArchetypes: ["mean_reversion", "swing"],
    avoidArchetypes: ["counter_trend", "volatility_short"],
    positionMultiplier: 1.0,
    stopLossMultiplier: 1.0,
    takeProfitMultiplier: 1.2,
  },
  BULL_CONTRACTION: {
    optimalArchetypes: ["momentum", "swing"],
    acceptableArchetypes: ["breakout", "range_trading"],
    avoidArchetypes: ["buy_and_hold", "aggressive_long"],
    positionMultiplier: 0.8,
    stopLossMultiplier: 0.9,
    takeProfitMultiplier: 1.0,
  },
  BEAR_EXPANSION: {
    optimalArchetypes: ["counter_trend", "mean_reversion"],
    acceptableArchetypes: ["swing", "range_trading"],
    avoidArchetypes: ["momentum", "aggressive_long"],
    positionMultiplier: 0.7,
    stopLossMultiplier: 0.85,
    takeProfitMultiplier: 0.9,
  },
  BEAR_RECESSION: {
    optimalArchetypes: ["volatility_long", "hedging", "defensive"],
    acceptableArchetypes: ["counter_trend", "mean_reversion"],
    avoidArchetypes: ["momentum", "breakout", "aggressive_long"],
    positionMultiplier: 0.4,
    stopLossMultiplier: 0.7,
    takeProfitMultiplier: 0.8,
  },
  SIDEWAYS_STABLE: {
    optimalArchetypes: ["mean_reversion", "range_trading", "grid"],
    acceptableArchetypes: ["swing", "scalping"],
    avoidArchetypes: ["momentum", "trend_following", "breakout"],
    positionMultiplier: 0.9,
    stopLossMultiplier: 0.95,
    takeProfitMultiplier: 0.9,
  },
  HIGH_VOL_CRISIS: {
    optimalArchetypes: ["volatility_long", "defensive", "hedging"],
    acceptableArchetypes: ["scalping"],
    avoidArchetypes: ["momentum", "breakout", "mean_reversion", "swing"],
    positionMultiplier: 0.25,
    stopLossMultiplier: 0.5,
    takeProfitMultiplier: 0.6,
  },
  LOW_VOL_COMPRESSION: {
    optimalArchetypes: ["breakout", "range_trading", "volatility_long"],
    acceptableArchetypes: ["mean_reversion", "scalping"],
    avoidArchetypes: ["momentum", "trend_following"],
    positionMultiplier: 0.85,
    stopLossMultiplier: 0.9,
    takeProfitMultiplier: 0.85,
  },
  TRANSITION: {
    optimalArchetypes: ["swing", "mean_reversion"],
    acceptableArchetypes: ["range_trading", "scalping"],
    avoidArchetypes: ["momentum", "trend_following", "aggressive_long"],
    positionMultiplier: 0.6,
    stopLossMultiplier: 0.8,
    takeProfitMultiplier: 0.85,
  },
  UNKNOWN: {
    optimalArchetypes: [],
    acceptableArchetypes: ["swing", "mean_reversion", "range_trading"],
    avoidArchetypes: ["aggressive_long", "momentum"],
    positionMultiplier: 0.5,
    stopLossMultiplier: 0.75,
    takeProfitMultiplier: 0.8,
  },
};

function combineRegimes(
  marketRegime: RegimeResult,
  macroSnapshot: MacroSnapshot | null
): { unified: UnifiedRegime; confidence: number } {
  const market = marketRegime.regime;
  const macro = macroSnapshot?.regime || "UNKNOWN";
  const marketConfidence = marketRegime.confidence;
  const macroRisk = macroSnapshot?.riskLevel || "MEDIUM";
  
  if (market === "HIGH_VOLATILITY" && macroRisk === "EXTREME") {
    return { unified: "HIGH_VOL_CRISIS", confidence: Math.min(1, marketConfidence * 1.2) };
  }
  
  if (market === "HIGH_VOLATILITY" && macroRisk === "HIGH") {
    return { unified: "HIGH_VOL_CRISIS", confidence: marketConfidence };
  }
  
  if (market === "LOW_VOLATILITY") {
    return { unified: "LOW_VOL_COMPRESSION", confidence: marketConfidence };
  }
  
  if (market === "BULL") {
    if (macro === "EXPANSION" || macro === "RECOVERY") {
      return { unified: "BULL_EXPANSION", confidence: Math.min(1, (marketConfidence + 0.8) / 2) };
    }
    if (macro === "CONTRACTION") {
      return { unified: "BULL_CONTRACTION", confidence: Math.min(1, (marketConfidence + 0.6) / 2) };
    }
    return { unified: "BULL_EXPANSION", confidence: marketConfidence * 0.8 };
  }
  
  if (market === "BEAR") {
    if (macro === "RECESSION") {
      return { unified: "BEAR_RECESSION", confidence: Math.min(1, (marketConfidence + 0.9) / 2) };
    }
    if (macro === "EXPANSION" || macro === "RECOVERY") {
      return { unified: "BEAR_EXPANSION", confidence: Math.min(1, (marketConfidence + 0.5) / 2) };
    }
    return { unified: "BEAR_RECESSION", confidence: marketConfidence * 0.7 };
  }
  
  if (market === "SIDEWAYS") {
    if (macroRisk === "LOW" || macroRisk === "MEDIUM") {
      return { unified: "SIDEWAYS_STABLE", confidence: marketConfidence };
    }
    return { unified: "TRANSITION", confidence: marketConfidence * 0.7 };
  }
  
  return { unified: "UNKNOWN", confidence: 0.3 };
}

function generateStrategyRecommendations(
  unified: UnifiedRegime,
  botArchetype?: string
): StrategyRecommendation[] {
  const matrix = REGIME_STRATEGY_MATRIX[unified];
  const recommendations: StrategyRecommendation[] = [];
  
  for (const archetype of matrix.optimalArchetypes) {
    recommendations.push({
      archetype,
      suitability: "OPTIMAL",
      reason: `${archetype} strategies thrive in ${unified.replace(/_/g, " ")} conditions`,
    });
  }
  
  for (const archetype of matrix.acceptableArchetypes) {
    recommendations.push({
      archetype,
      suitability: "ACCEPTABLE",
      reason: `${archetype} strategies can work in ${unified.replace(/_/g, " ")} with proper risk management`,
    });
  }
  
  for (const archetype of matrix.avoidArchetypes) {
    recommendations.push({
      archetype,
      suitability: "AVOID",
      reason: `${archetype} strategies typically underperform in ${unified.replace(/_/g, " ")} conditions`,
    });
  }
  
  return recommendations;
}

function generateRiskAdjustments(
  unified: UnifiedRegime,
  metrics: RegimeMetrics
): RiskAdjustment[] {
  const matrix = REGIME_STRATEGY_MATRIX[unified];
  const adjustments: RiskAdjustment[] = [];
  
  adjustments.push({
    parameter: "positionSize",
    adjustment: matrix.positionMultiplier,
    reason: `${unified.replace(/_/g, " ")} regime suggests ${Math.round(matrix.positionMultiplier * 100)}% position sizing`,
  });
  
  adjustments.push({
    parameter: "stopLoss",
    adjustment: matrix.stopLossMultiplier,
    reason: `Tighten stops to ${Math.round(matrix.stopLossMultiplier * 100)}% of normal in current conditions`,
  });
  
  adjustments.push({
    parameter: "takeProfit",
    adjustment: matrix.takeProfitMultiplier,
    reason: `Adjust targets to ${Math.round(matrix.takeProfitMultiplier * 100)}% given regime volatility`,
  });
  
  if (metrics.volatility > 0.03) {
    adjustments.push({
      parameter: "entryThreshold",
      adjustment: 1.3,
      reason: "Increase entry threshold requirements due to elevated volatility",
    });
  }
  
  if (metrics.volumeProfile < 0.6) {
    adjustments.push({
      parameter: "maxSlippage",
      adjustment: 1.5,
      reason: "Widen slippage tolerance due to thin liquidity",
    });
  }
  
  return adjustments;
}

export async function detectUnifiedRegime(
  symbol: string,
  options?: { 
    forceRefresh?: boolean;
    includeMacro?: boolean;
    traceId?: string;
  }
): Promise<RegimeState> {
  const traceId = options?.traceId || crypto.randomUUID();
  const now = new Date();
  const lookbackDays = 30;
  const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  
  const cached = regimeCache.get(symbol);
  if (!options?.forceRefresh && cached) {
    const age = now.getTime() - cached.lastUpdated.getTime();
    if (age < REGIME_CACHE_TTL_MS) {
      return cached;
    }
  }
  
  console.log(`[REGIME_ENGINE] trace_id=${traceId} detecting unified regime for ${symbol}`);
  
  const marketRegime = await detectMarketRegime(symbol, startDate, now, traceId);
  
  let macroSnapshot: MacroSnapshot | null = null;
  if (options?.includeMacro !== false) {
    const macroResult = await fetchMacroSnapshot(traceId);
    if (macroResult.success && macroResult.data) {
      macroSnapshot = macroResult.data;
    }
  }
  
  const { unified, confidence } = combineRegimes(marketRegime, macroSnapshot);
  const matrix = REGIME_STRATEGY_MATRIX[unified];
  
  const state: RegimeState = {
    unifiedRegime: unified,
    marketRegime,
    macroSnapshot,
    confidence,
    positionSizeMultiplier: matrix.positionMultiplier,
    strategyRecommendations: generateStrategyRecommendations(unified),
    riskAdjustments: generateRiskAdjustments(unified, marketRegime.metrics),
    lastUpdated: now,
    traceId,
  };
  
  regimeCache.set(symbol, state);
  
  await logActivityEvent({
    eventType: "INTEGRATION_PROOF",
    severity: "INFO",
    title: `Unified Regime: ${unified}`,
    summary: `${symbol}: ${unified} (confidence ${(confidence * 100).toFixed(0)}%), position multiplier ${matrix.positionMultiplier}x`,
    payload: {
      category: "REGIME_DETECTION",
      symbol,
      unifiedRegime: unified,
      marketRegime: marketRegime.regime,
      macroRegime: macroSnapshot?.regime || "N/A",
      confidence,
      positionMultiplier: matrix.positionMultiplier,
      stopLossMultiplier: matrix.stopLossMultiplier,
      takeProfitMultiplier: matrix.takeProfitMultiplier,
    },
    traceId,
  });
  
  console.log(`[REGIME_ENGINE] trace_id=${traceId} symbol=${symbol} unified=${unified} confidence=${(confidence * 100).toFixed(0)}% position_mult=${matrix.positionMultiplier}`);
  
  return state;
}

export function getRegimeOverride(
  regimeState: RegimeState,
  baseConfig: { maxPositions: number; stopLossTicks: number; takeProfitTicks: number }
): RegimeOverride {
  const matrix = REGIME_STRATEGY_MATRIX[regimeState.unifiedRegime];
  
  const adjustedMaxPositions = Math.max(1, Math.round(baseConfig.maxPositions * matrix.positionMultiplier));
  
  return {
    symbol: "MES",
    positionSizeMultiplier: matrix.positionMultiplier,
    maxPositions: adjustedMaxPositions,
    stopLossMultiplier: matrix.stopLossMultiplier,
    takeProfitMultiplier: matrix.takeProfitMultiplier,
    allowedArchetypes: [...matrix.optimalArchetypes, ...matrix.acceptableArchetypes],
    blockedArchetypes: matrix.avoidArchetypes,
  };
}

export function shouldBotTrade(
  botArchetype: string,
  regimeState: RegimeState
): { allowed: boolean; reason: string; confidence: number } {
  const matrix = REGIME_STRATEGY_MATRIX[regimeState.unifiedRegime];
  const archetypeLower = botArchetype.toLowerCase().replace(/[^a-z_]/g, "_");
  
  if (matrix.avoidArchetypes.some(a => archetypeLower.includes(a) || a.includes(archetypeLower))) {
    return {
      allowed: false,
      reason: `${botArchetype} strategy type is not recommended in ${regimeState.unifiedRegime} regime`,
      confidence: regimeState.confidence,
    };
  }
  
  if (regimeState.unifiedRegime === "HIGH_VOL_CRISIS" && regimeState.confidence > 0.7) {
    if (!matrix.optimalArchetypes.some(a => archetypeLower.includes(a))) {
      return {
        allowed: false,
        reason: "Crisis conditions detected - only defensive/hedging strategies allowed",
        confidence: regimeState.confidence,
      };
    }
  }
  
  if (matrix.optimalArchetypes.some(a => archetypeLower.includes(a) || a.includes(archetypeLower))) {
    return {
      allowed: true,
      reason: `${botArchetype} is optimal for ${regimeState.unifiedRegime} conditions`,
      confidence: regimeState.confidence,
    };
  }
  
  return {
    allowed: true,
    reason: `${botArchetype} is acceptable in ${regimeState.unifiedRegime} conditions`,
    confidence: regimeState.confidence * 0.8,
  };
}

export function getRegimeSummary(): {
  cachedRegimes: { symbol: string; regime: UnifiedRegime; age: number }[];
  cacheSize: number;
} {
  const now = Date.now();
  const regimes: { symbol: string; regime: UnifiedRegime; age: number }[] = [];
  
  for (const [symbol, state] of regimeCache.entries()) {
    regimes.push({
      symbol,
      regime: state.unifiedRegime,
      age: Math.round((now - state.lastUpdated.getTime()) / 1000),
    });
  }
  
  return {
    cachedRegimes: regimes,
    cacheSize: regimeCache.size,
  };
}

export function clearRegimeCache(symbol?: string): void {
  if (symbol) {
    regimeCache.delete(symbol);
  } else {
    regimeCache.clear();
  }
}

export function getUnifiedRegimeDescription(regime: UnifiedRegime): string {
  const descriptions: Record<UnifiedRegime, string> = {
    BULL_EXPANSION: "Strong uptrend with favorable macro conditions - momentum strategies optimal",
    BULL_CONTRACTION: "Uptrend with economic headwinds - use tighter risk management",
    BEAR_EXPANSION: "Downtrend despite economic growth - potential rotation, use caution",
    BEAR_RECESSION: "Downtrend with recession signals - defensive positioning critical",
    SIDEWAYS_STABLE: "Range-bound with stable macro - mean reversion strategies optimal",
    HIGH_VOL_CRISIS: "Elevated volatility with crisis signals - reduce exposure significantly",
    LOW_VOL_COMPRESSION: "Compressed volatility - breakout setups building",
    TRANSITION: "Regime transitioning - reduce position sizes until clarity",
    UNKNOWN: "Insufficient data for regime classification",
  };
  return descriptions[regime];
}
