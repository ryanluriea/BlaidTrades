import { getCachedBars, isCacheReady } from "./bar-cache";
import { type DatabentoBar } from "./databento-client";
import { getBarsCached } from "./market/barsCache";

export interface RegimeMetrics {
  volatility: number;
  avgReturn: number;
  trendStrength: number;
  priceRange: number;
  volumeProfile: number;
}

export interface RegimeResult {
  regime: "BULL" | "BEAR" | "SIDEWAYS" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "UNKNOWN";
  confidence: number;
  metrics: RegimeMetrics;
}

const VOLATILITY_THRESHOLD_HIGH = 0.025;
const VOLATILITY_THRESHOLD_LOW = 0.008;
const TREND_THRESHOLD = 0.6;
const RETURN_THRESHOLD = 0.02;

export async function detectMarketRegime(
  symbol: string,
  startDate: Date,
  endDate: Date,
  traceId: string
): Promise<RegimeResult> {
  console.log(`[REGIME_DETECTOR] trace_id=${traceId} detecting regime for ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  try {
    let bars: DatabentoBar[] = [];

    if (isCacheReady(symbol)) {
      const cached = await getCachedBars(symbol, traceId);
      if (cached && cached.length > 0) {
        const filteredBars = cached.filter(bar => {
          const barTime = bar.time.getTime();
          return barTime >= startDate.getTime() && barTime <= endDate.getTime();
        });
        bars = filteredBars as DatabentoBar[];
      }
    }

    if (bars.length === 0) {
      const cachedResult = await getBarsCached(
        {
          symbol,
          timeframe: "1d",
          sessionMode: "ALL",
          startTs: startDate.getTime(),
          endTs: endDate.getTime(),
        },
        traceId
      );
      bars = cachedResult.bars;
    }

    if (bars.length < 5) {
      console.log(`[REGIME_DETECTOR] trace_id=${traceId} insufficient data (${bars.length} bars), returning UNKNOWN`);
      return {
        regime: "UNKNOWN",
        confidence: 0,
        metrics: {
          volatility: 0,
          avgReturn: 0,
          trendStrength: 0,
          priceRange: 0,
          volumeProfile: 0,
        },
      };
    }

    const metrics = calculateRegimeMetrics(bars);
    const result = classifyRegime(metrics);

    console.log(`[REGIME_DETECTOR] trace_id=${traceId} detected regime=${result.regime} confidence=${result.confidence.toFixed(2)}`);

    return result;

  } catch (error) {
    console.error(`[REGIME_DETECTOR] trace_id=${traceId} error:`, error);
    return {
      regime: "UNKNOWN",
      confidence: 0,
      metrics: {
        volatility: 0,
        avgReturn: 0,
        trendStrength: 0,
        priceRange: 0,
        volumeProfile: 0,
      },
    };
  }
}

function calculateRegimeMetrics(bars: DatabentoBar[]): RegimeMetrics {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
    returns.push(ret);
  }

  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  const upDays = returns.filter(r => r > 0).length;
  const downDays = returns.filter(r => r < 0).length;
  const totalDays = upDays + downDays;
  const directionalBias = totalDays > 0 ? Math.abs(upDays - downDays) / totalDays : 0;

  let trendStrength = 0;
  if (bars.length >= 20) {
    const shortMA = calculateMA(bars.slice(-10).map(b => b.close));
    const longMA = calculateMA(bars.slice(-20).map(b => b.close));
    const currentPrice = bars[bars.length - 1].close;
    
    const shortDiff = (shortMA - longMA) / longMA;
    const priceDiff = (currentPrice - longMA) / longMA;
    trendStrength = (Math.abs(shortDiff) + Math.abs(priceDiff)) / 2;
  }

  const highestHigh = Math.max(...bars.map(b => b.high));
  const lowestLow = Math.min(...bars.map(b => b.low));
  const priceRange = (highestHigh - lowestLow) / lowestLow;

  const avgVolume = bars.reduce((sum, b) => sum + (b.volume || 0), 0) / bars.length;
  const recentVolume = bars.slice(-5).reduce((sum, b) => sum + (b.volume || 0), 0) / 5;
  const volumeProfile = avgVolume > 0 ? recentVolume / avgVolume : 1;

  return {
    volatility,
    avgReturn,
    trendStrength: Math.min(1, trendStrength * 10 + directionalBias),
    priceRange,
    volumeProfile,
  };
}

function calculateMA(prices: number[]): number {
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function classifyRegime(metrics: RegimeMetrics): RegimeResult {
  const { volatility, avgReturn, trendStrength, priceRange } = metrics;

  if (volatility > VOLATILITY_THRESHOLD_HIGH) {
    return {
      regime: "HIGH_VOLATILITY",
      confidence: Math.min(1, volatility / VOLATILITY_THRESHOLD_HIGH * 0.8),
      metrics,
    };
  }

  if (volatility < VOLATILITY_THRESHOLD_LOW) {
    return {
      regime: "LOW_VOLATILITY",
      confidence: Math.min(1, (VOLATILITY_THRESHOLD_LOW / volatility) * 0.8),
      metrics,
    };
  }

  if (trendStrength > TREND_THRESHOLD) {
    if (avgReturn > RETURN_THRESHOLD) {
      return {
        regime: "BULL",
        confidence: Math.min(1, (trendStrength * 0.5 + (avgReturn / RETURN_THRESHOLD) * 0.3)),
        metrics,
      };
    } else if (avgReturn < -RETURN_THRESHOLD) {
      return {
        regime: "BEAR",
        confidence: Math.min(1, (trendStrength * 0.5 + (Math.abs(avgReturn) / RETURN_THRESHOLD) * 0.3)),
        metrics,
      };
    }
  }

  if (priceRange < 0.1 && trendStrength < TREND_THRESHOLD) {
    return {
      regime: "SIDEWAYS",
      confidence: Math.min(1, (1 - trendStrength) * 0.7),
      metrics,
    };
  }

  if (avgReturn > RETURN_THRESHOLD * 0.5) {
    return {
      regime: "BULL",
      confidence: 0.5,
      metrics,
    };
  } else if (avgReturn < -RETURN_THRESHOLD * 0.5) {
    return {
      regime: "BEAR",
      confidence: 0.5,
      metrics,
    };
  }

  return {
    regime: "SIDEWAYS",
    confidence: 0.4,
    metrics,
  };
}

export function getRegimeDescription(regime: string): string {
  switch (regime) {
    case "BULL":
      return "Sustained uptrend with positive momentum";
    case "BEAR":
      return "Sustained downtrend with negative momentum";
    case "SIDEWAYS":
      return "Range-bound market with low directional bias";
    case "HIGH_VOLATILITY":
      return "Elevated volatility with potential crisis conditions";
    case "LOW_VOLATILITY":
      return "Compressed volatility with potential breakout setup";
    default:
      return "Market regime not yet classified";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGY LAB REGIME TRIGGERS - Maps market conditions to research bursts
// ═══════════════════════════════════════════════════════════════════════════

export type StrategyLabRegimeTrigger = 
  | "VOLATILITY_SPIKE"
  | "VOLATILITY_COMPRESSION"
  | "TRENDING_STRONG"
  | "RANGE_BOUND"
  | "LIQUIDITY_THIN"
  | "NEWS_SHOCK"
  | "MACRO_EVENT_CLUSTER"
  | "NONE";

export interface RegimeTriggerResult {
  trigger: StrategyLabRegimeTrigger;
  confidence: number;
  metrics: RegimeMetrics;
  shouldBurstResearch: boolean;
  reason: string;
}

interface RegimeHistory {
  regime: RegimeResult["regime"];
  timestamp: Date;
  metrics: RegimeMetrics;
}

const regimeHistoryCache: Map<string, RegimeHistory[]> = new Map();
const HISTORY_WINDOW = 10;
const BURST_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const lastBurstTimestamp: Map<string, number> = new Map();

export async function detectStrategyLabTrigger(
  symbol: string,
  traceId: string
): Promise<RegimeTriggerResult> {
  const now = new Date();
  const lookbackDays = 30;
  const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  
  const currentRegime = await detectMarketRegime(symbol, startDate, now, traceId);
  
  const history = regimeHistoryCache.get(symbol) || [];
  history.push({
    regime: currentRegime.regime,
    timestamp: now,
    metrics: currentRegime.metrics,
  });
  
  if (history.length > HISTORY_WINDOW) {
    history.shift();
  }
  regimeHistoryCache.set(symbol, history);
  
  const trigger = mapRegimeToTrigger(currentRegime, history);
  
  const lastBurst = lastBurstTimestamp.get(symbol) || 0;
  const cooldownPassed = (now.getTime() - lastBurst) > BURST_COOLDOWN_MS;
  const shouldBurst = trigger.trigger !== "NONE" && trigger.confidence >= 0.7 && cooldownPassed;
  
  if (shouldBurst) {
    lastBurstTimestamp.set(symbol, now.getTime());
    console.log(`[REGIME_TRIGGER] trace_id=${traceId} symbol=${symbol} trigger=${trigger.trigger} confidence=${trigger.confidence.toFixed(2)} BURST_RESEARCH_ACTIVATED`);
  }
  
  return {
    ...trigger,
    shouldBurstResearch: shouldBurst,
  };
}

function mapRegimeToTrigger(
  current: RegimeResult,
  history: RegimeHistory[]
): Omit<RegimeTriggerResult, "shouldBurstResearch"> {
  const { regime, confidence, metrics } = current;
  
  if (regime === "HIGH_VOLATILITY" && metrics.volatility > VOLATILITY_THRESHOLD_HIGH * 1.5) {
    return {
      trigger: "VOLATILITY_SPIKE",
      confidence: Math.min(1, confidence * 1.2),
      metrics,
      reason: `Volatility ${(metrics.volatility * 100).toFixed(1)}% exceeds spike threshold`,
    };
  }
  
  if (regime === "LOW_VOLATILITY" && metrics.volatility < VOLATILITY_THRESHOLD_LOW * 0.7) {
    return {
      trigger: "VOLATILITY_COMPRESSION",
      confidence: Math.min(1, confidence * 1.2),
      metrics,
      reason: `Volatility ${(metrics.volatility * 100).toFixed(1)}% in compression zone`,
    };
  }
  
  if ((regime === "BULL" || regime === "BEAR") && metrics.trendStrength > 0.8) {
    return {
      trigger: "TRENDING_STRONG",
      confidence: Math.min(1, confidence * 1.1),
      metrics,
      reason: `Strong ${regime.toLowerCase()} trend with strength ${(metrics.trendStrength * 100).toFixed(0)}%`,
    };
  }
  
  if (regime === "SIDEWAYS" && metrics.priceRange < 0.05) {
    return {
      trigger: "RANGE_BOUND",
      confidence,
      metrics,
      reason: `Price range ${(metrics.priceRange * 100).toFixed(1)}% indicates consolidation`,
    };
  }
  
  if (metrics.volumeProfile < 0.5) {
    return {
      trigger: "LIQUIDITY_THIN",
      confidence: Math.min(1, (1 - metrics.volumeProfile) * 0.8),
      metrics,
      reason: `Volume ${(metrics.volumeProfile * 100).toFixed(0)}% below average`,
    };
  }
  
  if (history.length >= 3) {
    const recentRegimes = history.slice(-3).map(h => h.regime);
    const uniqueRegimes = new Set(recentRegimes);
    if (uniqueRegimes.size >= 3) {
      return {
        trigger: "NEWS_SHOCK",
        confidence: 0.6,
        metrics,
        reason: "Rapid regime changes detected (potential news-driven)",
      };
    }
  }
  
  return {
    trigger: "NONE",
    confidence: 0,
    metrics,
    reason: "No significant regime shift detected",
  };
}

export function getStrategyLabTriggerDescription(trigger: StrategyLabRegimeTrigger): string {
  switch (trigger) {
    case "VOLATILITY_SPIKE":
      return "Market volatility has spiked significantly - research crisis-adapted strategies";
    case "VOLATILITY_COMPRESSION":
      return "Volatility compressed to low levels - research breakout anticipation strategies";
    case "TRENDING_STRONG":
      return "Strong directional trend detected - research momentum/trend-following strategies";
    case "RANGE_BOUND":
      return "Price consolidating in tight range - research mean reversion strategies";
    case "LIQUIDITY_THIN":
      return "Below-average volume detected - research low-liquidity-adapted strategies";
    case "NEWS_SHOCK":
      return "Rapid regime changes suggest news impact - research event-driven strategies";
    case "MACRO_EVENT_CLUSTER":
      return "Multiple macro events clustered - research macro-aware strategies";
    case "NONE":
      return "No significant regime trigger - continue scheduled research";
  }
}

export function clearRegimeHistory(symbol?: string): void {
  if (symbol) {
    regimeHistoryCache.delete(symbol);
    lastBurstTimestamp.delete(symbol);
  } else {
    regimeHistoryCache.clear();
    lastBurstTimestamp.clear();
  }
}
