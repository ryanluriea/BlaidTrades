/**
 * Regime Router
 * Routes trades to correct lanes (TREND vs RANGE) based on market regime
 */

export type RegimeType = 'TREND' | 'RANGE' | 'AVOID' | 'UNKNOWN';
export type BotLane = 'TREND' | 'RANGE' | 'ALL';

export interface RegimeSignals {
  atrPercentile: number; // 0-100 volatility percentile
  directionalStrength: number; // -1 to 1, negative = bearish trend, positive = bullish trend
  rangeCompression: number; // 0-1, higher = more compressed/ranging
  sessionSegment: 'OPEN' | 'MIDDAY' | 'CLOSE' | 'OVERNIGHT';
  meanCrossingFreq?: number; // How often price crosses MA (higher = choppier)
}

export interface RegimeResult {
  regime: RegimeType;
  confidence: number; // 0-1
  features: {
    volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
    trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    rangeQuality: 'CLEAN' | 'CHOPPY' | 'BREAKOUT';
  };
  shouldTrade: boolean;
  blockReason?: string;
}

export interface RegimeRouterConfig {
  minTrendConfidence: number;
  minRangeConfidence: number;
  avoidVolatilityThreshold: number;
  avoidChopThreshold: number;
}

export const DEFAULT_REGIME_CONFIG: RegimeRouterConfig = {
  minTrendConfidence: 0.6,
  minRangeConfidence: 0.55,
  avoidVolatilityThreshold: 95, // ATR percentile
  avoidChopThreshold: 0.7, // Range compression
};

/**
 * Classify the current market regime
 */
export function classifyRegime(
  signals: RegimeSignals,
  config: RegimeRouterConfig = DEFAULT_REGIME_CONFIG
): RegimeResult {
  const { atrPercentile, directionalStrength, rangeCompression, sessionSegment } = signals;

  // Determine volatility level
  let volatilityLevel: RegimeResult['features']['volatilityLevel'];
  if (atrPercentile >= 95) volatilityLevel = 'EXTREME';
  else if (atrPercentile >= 75) volatilityLevel = 'HIGH';
  else if (atrPercentile >= 25) volatilityLevel = 'NORMAL';
  else volatilityLevel = 'LOW';

  // Determine trend strength
  const absDirection = Math.abs(directionalStrength);
  let trendStrength: RegimeResult['features']['trendStrength'];
  if (absDirection >= 0.7) trendStrength = 'STRONG';
  else if (absDirection >= 0.4) trendStrength = 'MODERATE';
  else if (absDirection >= 0.2) trendStrength = 'WEAK';
  else trendStrength = 'NONE';

  // Determine range quality
  let rangeQuality: RegimeResult['features']['rangeQuality'];
  if (rangeCompression <= 0.3) rangeQuality = 'BREAKOUT';
  else if (rangeCompression >= 0.7 && absDirection < 0.3) rangeQuality = 'CHOPPY';
  else rangeQuality = 'CLEAN';

  // Check for AVOID conditions first
  if (atrPercentile >= config.avoidVolatilityThreshold) {
    return {
      regime: 'AVOID',
      confidence: 0.9,
      features: { volatilityLevel, trendStrength, rangeQuality },
      shouldTrade: false,
      blockReason: 'Extreme volatility - avoid trading',
    };
  }

  if (rangeCompression >= config.avoidChopThreshold && absDirection < 0.2) {
    return {
      regime: 'AVOID',
      confidence: 0.85,
      features: { volatilityLevel, trendStrength, rangeQuality },
      shouldTrade: false,
      blockReason: 'Choppy/consolidating market - avoid entries',
    };
  }

  // Calculate trend confidence
  const trendConfidence = Math.min(1, (absDirection + (1 - rangeCompression)) / 2);

  // Calculate range confidence
  const rangeConfidence = Math.min(1, (rangeCompression + (1 - absDirection)) / 2);

  // Determine primary regime
  let regime: RegimeType;
  let confidence: number;

  if (trendConfidence > rangeConfidence && trendConfidence >= config.minTrendConfidence) {
    regime = 'TREND';
    confidence = trendConfidence;
  } else if (rangeConfidence >= config.minRangeConfidence) {
    regime = 'RANGE';
    confidence = rangeConfidence;
  } else {
    regime = 'UNKNOWN';
    confidence = Math.max(trendConfidence, rangeConfidence);
  }

  // Session-specific adjustments
  if (sessionSegment === 'OPEN') {
    // Opening range: favor range/breakout strategies
    if (regime === 'TREND') {
      confidence *= 0.9; // Slightly reduce trend confidence during open
    }
  } else if (sessionSegment === 'CLOSE') {
    // End of day: reduce confidence overall
    confidence *= 0.85;
  }

  return {
    regime,
    confidence: Math.round(confidence * 100) / 100,
    features: { volatilityLevel, trendStrength, rangeQuality },
    shouldTrade: regime !== 'UNKNOWN' && confidence >= 0.5,
  };
}

/**
 * Check if a bot can trade given its lane and current regime
 */
export function canBotTrade(
  botLane: BotLane,
  regimeResult: RegimeResult,
  config: RegimeRouterConfig = DEFAULT_REGIME_CONFIG
): { allowed: boolean; reason?: string } {
  // ALL lane bots can trade in any regime except AVOID
  if (botLane === 'ALL') {
    if ((regimeResult.regime as RegimeType) === 'AVOID') {
      return { allowed: false, reason: regimeResult.blockReason };
    }
    return { allowed: true };
  }

  // Check lane-regime match
  if (botLane === 'TREND') {
    if (regimeResult.regime !== 'TREND' && regimeResult.regime !== 'UNKNOWN') {
      return { 
        allowed: false, 
        reason: `Trend bot blocked: regime is ${regimeResult.regime}` 
      };
    }
    if (regimeResult.regime !== 'TREND' || regimeResult.confidence < config.minTrendConfidence) {
      return { 
        allowed: false,
        reason: `Trend confidence too low: ${(regimeResult.confidence * 100).toFixed(0)}% < ${(config.minTrendConfidence * 100).toFixed(0)}%` 
      };
    }
  }

  if (botLane === 'RANGE') {
    if (regimeResult.regime !== 'RANGE') {
      return { 
        allowed: false, 
        reason: `Range bot blocked: regime is ${regimeResult.regime}` 
      };
    }
    if (regimeResult.confidence < config.minRangeConfidence) {
      return { 
        allowed: false, 
        reason: `Range confidence too low: ${(regimeResult.confidence * 100).toFixed(0)}% < ${(config.minRangeConfidence * 100).toFixed(0)}%` 
      };
    }
  }

  return { allowed: true };
}

/**
 * Get display info for regime
 */
export function getRegimeDisplay(regime: RegimeType) {
  switch (regime) {
    case 'TREND':
      return { label: 'Trending', color: 'text-blue-500', bgColor: 'bg-blue-500/10', icon: '📈' };
    case 'RANGE':
      return { label: 'Ranging', color: 'text-purple-500', bgColor: 'bg-purple-500/10', icon: '↔️' };
    case 'AVOID':
      return { label: 'Avoid', color: 'text-destructive', bgColor: 'bg-destructive/10', icon: '⚠️' };
    case 'UNKNOWN':
      return { label: 'Unknown', color: 'text-muted-foreground', bgColor: 'bg-muted', icon: '❓' };
  }
}
