/**
 * Bot Priority Score (BPS) Formula - Capital Precedence & Arbiter Weighting
 * 
 * This implements the exact formula for computing BPS (0-100) which determines:
 * - Capital allocation weights
 * - Trade arbiter candidate ranking
 * - Queue priority for runner cycles
 */

export interface BPSInputs {
  sharpe30D: number | null;
  profitFactor30D: number | null;
  expectancy30D: number | null;
  maxDdPct30D: number | null;
  trades30D: number;
  healthState: 'OK' | 'WARN' | 'DEGRADED' | 'FROZEN';
  stage: 'TRIALS' | 'PAPER' | 'SHADOW' | 'LIVE';
  correlationToPortfolio?: number;
}

export interface BPSSettings {
  expectancyTarget: number;
  ddCapPct: number;
  tradesTarget: number;
  weights: {
    sharpe: number;
    profitFactor: number;
    expectancy: number;
    drawdown: number;
    reliability: number;
    health: number;
  };
  stageMultipliers: {
    TRIALS: number;
    PAPER: number;
    SHADOW: number;
    LIVE: number;
  };
  bucketThresholds: {
    A_PLUS: number;
    A: number;
    B: number;
    C: number;
    D: number;
  };
}

export const DEFAULT_BPS_SETTINGS: BPSSettings = {
  expectancyTarget: 50,
  ddCapPct: 15,
  tradesTarget: 50,
  weights: {
    sharpe: 0.30,
    profitFactor: 0.20,
    expectancy: 0.15,
    drawdown: 0.15,
    reliability: 0.10,
    health: 0.10,
  },
  stageMultipliers: {
    TRIALS: 0.50,
    PAPER: 0.75,
    SHADOW: 0.90,
    LIVE: 1.00,
  },
  bucketThresholds: {
    A_PLUS: 85,
    A: 75,
    B: 60,
    C: 45,
    D: 30,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute the Bot Priority Score (BPS) using the canonical formula
 */
export function computeBPS(inputs: BPSInputs, settings: BPSSettings = DEFAULT_BPS_SETTINGS): number {
  const { weights, stageMultipliers, expectancyTarget, ddCapPct, tradesTarget } = settings;
  
  // Normalize each component to 0-1 range
  // S = clamp((sharpe + 1) / 3, 0, 1) - maps sharpe -1..2 to 0..1
  const sharpeNorm = clamp(((inputs.sharpe30D ?? 0) + 1) / 3, 0, 1);
  
  // P = clamp((profit_factor - 1) / 0.8, 0, 1) - PF 1..1.8 -> 0..1
  const pfNorm = clamp(((inputs.profitFactor30D ?? 1) - 1) / 0.8, 0, 1);
  
  // E = clamp(expectancy / expectancy_target, 0, 1)
  const expectancyNorm = clamp((inputs.expectancy30D ?? 0) / expectancyTarget, 0, 1);
  
  // D = clamp(1 - (max_dd_pct / dd_cap_pct), 0, 1)
  const ddNorm = clamp(1 - ((inputs.maxDdPct30D ?? 0) / ddCapPct), 0, 1);
  
  // R = clamp(trades / trades_target, 0, 1) - sample size reliability
  const reliabilityNorm = clamp(inputs.trades30D / tradesTarget, 0, 1);
  
  // H = health factor: OK=1.0, WARN=0.7, DEGRADED=0.0, FROZEN=0.0
  const healthFactor = inputs.healthState === 'OK' ? 1.0 
    : inputs.healthState === 'WARN' ? 0.7 
    : 0.0;
  
  // Stage multiplier (trust cap)
  const stageMultiplier = stageMultipliers[inputs.stage] ?? 0.5;
  
  // Correlation penalty (optional)
  const correlationPenalty = inputs.correlationToPortfolio !== undefined
    ? clamp(1 - inputs.correlationToPortfolio, 0.5, 1.0)
    : 1.0;
  
  // BPS_raw = 100 * weighted sum
  const bpsRaw = 100 * (
    weights.sharpe * sharpeNorm +
    weights.profitFactor * pfNorm +
    weights.expectancy * expectancyNorm +
    weights.drawdown * ddNorm +
    weights.reliability * reliabilityNorm +
    weights.health * healthFactor
  );
  
  // Apply multipliers
  const bps = bpsRaw * stageMultiplier * correlationPenalty;
  
  return Math.round(bps * 100) / 100; // Round to 2 decimal places
}

import { 
  PRIORITY_THRESHOLDS, 
  scoreToBucket as unifiedScoreToBucket,
  type PriorityBucket as UnifiedPriorityBucket 
} from './constants';

// Re-export for backward compatibility (map F -> FROZEN)
export type PriorityBucket = UnifiedPriorityBucket;

/**
 * Convert BPS score to bucket - uses unified constants
 */
export function getBucket(
  bps: number, 
  healthState: string,
  _thresholds?: BPSSettings['bucketThresholds'] // Kept for backward compat, ignored
): PriorityBucket {
  return unifiedScoreToBucket(bps, healthState);
}

/**
 * Compute BPS breakdown for display/debugging
 */
export function computeBPSBreakdown(inputs: BPSInputs, settings: BPSSettings = DEFAULT_BPS_SETTINGS) {
  const { weights, stageMultipliers, expectancyTarget, ddCapPct, tradesTarget } = settings;
  
  const sharpeNorm = clamp(((inputs.sharpe30D ?? 0) + 1) / 3, 0, 1);
  const pfNorm = clamp(((inputs.profitFactor30D ?? 1) - 1) / 0.8, 0, 1);
  const expectancyNorm = clamp((inputs.expectancy30D ?? 0) / expectancyTarget, 0, 1);
  const ddNorm = clamp(1 - ((inputs.maxDdPct30D ?? 0) / ddCapPct), 0, 1);
  const reliabilityNorm = clamp(inputs.trades30D / tradesTarget, 0, 1);
  const healthFactor = inputs.healthState === 'OK' ? 1.0 : inputs.healthState === 'WARN' ? 0.7 : 0.0;
  const stageMultiplier = stageMultipliers[inputs.stage] ?? 0.5;
  const correlationPenalty = inputs.correlationToPortfolio !== undefined
    ? clamp(1 - inputs.correlationToPortfolio, 0.5, 1.0)
    : 1.0;

  return {
    components: {
      sharpe: { raw: inputs.sharpe30D, normalized: sharpeNorm, weighted: weights.sharpe * sharpeNorm },
      profitFactor: { raw: inputs.profitFactor30D, normalized: pfNorm, weighted: weights.profitFactor * pfNorm },
      expectancy: { raw: inputs.expectancy30D, normalized: expectancyNorm, weighted: weights.expectancy * expectancyNorm },
      drawdown: { raw: inputs.maxDdPct30D, normalized: ddNorm, weighted: weights.drawdown * ddNorm },
      reliability: { raw: inputs.trades30D, normalized: reliabilityNorm, weighted: weights.reliability * reliabilityNorm },
      health: { raw: inputs.healthState, normalized: healthFactor, weighted: weights.health * healthFactor },
    },
    multipliers: {
      stage: { value: inputs.stage, multiplier: stageMultiplier },
      correlation: { value: inputs.correlationToPortfolio, multiplier: correlationPenalty },
    },
    bpsRaw: 100 * (
      weights.sharpe * sharpeNorm +
      weights.profitFactor * pfNorm +
      weights.expectancy * expectancyNorm +
      weights.drawdown * ddNorm +
      weights.reliability * reliabilityNorm +
      weights.health * healthFactor
    ),
    bpsFinal: computeBPS(inputs, settings),
    bucket: getBucket(computeBPS(inputs, settings), inputs.healthState, settings.bucketThresholds),
  };
}
