/**
 * Trade Quality Analysis
 * Loss archetypes + chop detector for trade quality dashboard
 */

export type LossArchetype = 
  | 'CHOP_ENTRY'
  | 'REGIME_MISMATCH'
  | 'LATE_ENTRY'
  | 'STOP_TOO_WIDE'
  | 'STOP_TOO_TIGHT'
  | 'WINNER_CUT'
  | 'VOL_SHOCK'
  | 'SLIPPAGE'
  | 'NONE';

export interface TradeQualityInput {
  pnl: number;
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
  entryATRPercentile: number;
  entryRangeCompression: number;
  entryDirectionalStrength: number;
  botLane: 'TREND' | 'RANGE' | 'ALL';
  regimeAtEntry: 'TREND' | 'RANGE' | 'AVOID' | 'UNKNOWN';
  slippageTicks: number;
  stopDistance: number;
  entryToHighMove: number; // Price move from entry to session high
}

export interface ChopDetectorResult {
  isChopEntry: boolean;
  chopScore: number; // 0-1
  features: {
    lowVolatility: boolean;
    lowTrendConfidence: boolean;
    meanCrossing: boolean;
    rangeCompressed: boolean;
  };
}

export interface LossArchetypeResult {
  archetype: LossArchetype;
  confidence: number;
  explanation: string;
}

export interface SetupQualityResult {
  score: number; // 0-100
  components: {
    regimeAlignment: number;
    entryTiming: number;
    riskManagement: number;
    executionQuality: number;
  };
}

/**
 * Detect if entry was made in choppy conditions
 */
export function detectChopEntry(
  atrPercentile: number,
  rangeCompression: number,
  directionalStrength: number,
  meanCrossingFreq?: number
): ChopDetectorResult {
  const features = {
    lowVolatility: atrPercentile < 25,
    lowTrendConfidence: Math.abs(directionalStrength) < 0.2,
    meanCrossing: (meanCrossingFreq ?? 0) > 5,
    rangeCompressed: rangeCompression > 0.65,
  };

  // Count how many chop indicators are present
  const chopIndicators = Object.values(features).filter(Boolean).length;
  const chopScore = chopIndicators / 4;

  return {
    isChopEntry: chopScore >= 0.5,
    chopScore,
    features,
  };
}

/**
 * Classify a losing trade into an archetype
 */
export function classifyLossArchetype(input: TradeQualityInput): LossArchetypeResult {
  const {
    pnl,
    mae,
    mfe,
    entryATRPercentile,
    entryRangeCompression,
    entryDirectionalStrength,
    botLane,
    regimeAtEntry,
    slippageTicks,
    stopDistance,
  } = input;

  // Not a loss - no archetype
  if (pnl >= 0) {
    return { archetype: 'NONE', confidence: 1, explanation: 'Trade was profitable' };
  }

  // Check for chop entry first
  const chopResult = detectChopEntry(entryATRPercentile, entryRangeCompression, entryDirectionalStrength);
  if (chopResult.isChopEntry && chopResult.chopScore >= 0.6) {
    return {
      archetype: 'CHOP_ENTRY',
      confidence: chopResult.chopScore,
      explanation: 'Entered during choppy/ranging conditions without clear direction',
    };
  }

  // Check regime mismatch
  if (botLane !== 'ALL' && botLane !== regimeAtEntry && regimeAtEntry !== 'UNKNOWN') {
    return {
      archetype: 'REGIME_MISMATCH',
      confidence: 0.9,
      explanation: `${botLane} bot traded in ${regimeAtEntry} regime`,
    };
  }

  // Check if winner was cut (had significant MFE but exited at loss)
  if (mfe > 0 && Math.abs(mfe) > Math.abs(pnl) * 2) {
    return {
      archetype: 'WINNER_CUT',
      confidence: 0.85,
      explanation: `Trade had +${mfe.toFixed(0)} MFE but exited at ${pnl.toFixed(0)}`,
    };
  }

  // Check for late entry (small MFE relative to MAE)
  if (mfe < Math.abs(mae) * 0.3 && mae < 0) {
    return {
      archetype: 'LATE_ENTRY',
      confidence: 0.75,
      explanation: 'Entered after the move - poor R:R from start',
    };
  }

  // Check stop too wide (large loss relative to expected)
  if (Math.abs(pnl) > stopDistance * 1.5) {
    return {
      archetype: 'STOP_TOO_WIDE',
      confidence: 0.7,
      explanation: 'Loss exceeded expected stop by 50%+',
    };
  }

  // Check stop too tight (stopped out frequently with small losses)
  if (Math.abs(pnl) < stopDistance * 0.5 && mfe > stopDistance) {
    return {
      archetype: 'STOP_TOO_TIGHT',
      confidence: 0.7,
      explanation: 'Stopped out prematurely - price moved favorably after exit',
    };
  }

  // Check for volatility shock
  if (entryATRPercentile > 90) {
    return {
      archetype: 'VOL_SHOCK',
      confidence: 0.8,
      explanation: 'Entry during extreme volatility spike',
    };
  }

  // Check slippage
  if (slippageTicks > 2) {
    return {
      archetype: 'SLIPPAGE',
      confidence: 0.65,
      explanation: `${slippageTicks} ticks slippage on execution`,
    };
  }

  // Default - no clear archetype
  return {
    archetype: 'NONE',
    confidence: 0.5,
    explanation: 'No clear loss pattern identified',
  };
}

/**
 * Compute setup quality score for a set of trades
 */
export function computeSetupQuality(trades: {
  regimeMatch: boolean;
  chopScore: number;
  mfeToMaeRatio: number;
  slippageTicks: number;
}[]): SetupQualityResult {
  if (trades.length === 0) {
    return {
      score: 0,
      components: { regimeAlignment: 0, entryTiming: 0, riskManagement: 0, executionQuality: 0 },
    };
  }

  // Regime alignment: % of trades in correct regime
  const regimeMatches = trades.filter(t => t.regimeMatch).length;
  const regimeAlignment = (regimeMatches / trades.length) * 100;

  // Entry timing: inverse of chop score average
  const avgChop = trades.reduce((sum, t) => sum + t.chopScore, 0) / trades.length;
  const entryTiming = (1 - avgChop) * 100;

  // Risk management: good MFE/MAE ratio
  const avgMfeMae = trades.reduce((sum, t) => sum + Math.min(t.mfeToMaeRatio, 3), 0) / trades.length;
  const riskManagement = Math.min(100, (avgMfeMae / 2) * 100);

  // Execution quality: low slippage
  const avgSlippage = trades.reduce((sum, t) => sum + t.slippageTicks, 0) / trades.length;
  const executionQuality = Math.max(0, 100 - avgSlippage * 10);

  // Weighted score
  const score = (
    regimeAlignment * 0.35 +
    entryTiming * 0.30 +
    riskManagement * 0.25 +
    executionQuality * 0.10
  );

  return {
    score: Math.round(score),
    components: {
      regimeAlignment: Math.round(regimeAlignment),
      entryTiming: Math.round(entryTiming),
      riskManagement: Math.round(riskManagement),
      executionQuality: Math.round(executionQuality),
    },
  };
}

/**
 * Get display info for loss archetype
 */
export function getArchetypeDisplay(archetype: LossArchetype) {
  const displays: Record<LossArchetype, { label: string; color: string; icon: string }> = {
    CHOP_ENTRY: { label: 'Chop Entry', color: 'text-amber-500', icon: '🌊' },
    REGIME_MISMATCH: { label: 'Regime Mismatch', color: 'text-orange-500', icon: '🔀' },
    LATE_ENTRY: { label: 'Late Entry', color: 'text-yellow-500', icon: '⏰' },
    STOP_TOO_WIDE: { label: 'Wide Stop', color: 'text-red-500', icon: '📏' },
    STOP_TOO_TIGHT: { label: 'Tight Stop', color: 'text-pink-500', icon: '🎯' },
    WINNER_CUT: { label: 'Winner Cut', color: 'text-purple-500', icon: '✂️' },
    VOL_SHOCK: { label: 'Vol Shock', color: 'text-red-600', icon: '⚡' },
    SLIPPAGE: { label: 'Slippage', color: 'text-gray-500', icon: '📉' },
    NONE: { label: 'Unknown', color: 'text-muted-foreground', icon: '—' },
  };
  return displays[archetype];
}
