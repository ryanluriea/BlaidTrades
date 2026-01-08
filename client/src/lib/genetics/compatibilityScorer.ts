// Compatibility scoring for genetic recombination
// Determines whether two genomes can be successfully combined

import { Genome, getTimeframeBucket } from './genomeSchema';

export interface CompatibilityResult {
  score: number; // 0-100
  compatible: boolean;
  reasons: string[];
  warnings: string[];
  recommendedRecombinationType: 'FULL' | 'PARTIAL' | 'MUTATION_ONLY';
}

export interface CompatibilityConfig {
  requireLaneMatch: boolean;
  requireTimeframeAdjacent: boolean;
  requireInstrumentFamily: boolean;
  minScore: number;
}

const DEFAULT_CONFIG: CompatibilityConfig = {
  requireLaneMatch: true,
  requireTimeframeAdjacent: true,
  requireInstrumentFamily: true,
  minScore: 40,
};

/**
 * Calculate compatibility score between two genomes for recombination
 */
export function calculateCompatibility(
  genomeA: Genome,
  genomeB: Genome,
  config: Partial<CompatibilityConfig> = {}
): CompatibilityResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // Lane compatibility (most important)
  if (genomeA.lane !== genomeB.lane) {
    if (cfg.requireLaneMatch) {
      score -= 50;
      reasons.push(`Lane mismatch: ${genomeA.lane} vs ${genomeB.lane}`);
    } else {
      score -= 20;
      warnings.push(`Lane mismatch may produce inconsistent offspring`);
    }
  }

  // Timeframe compatibility
  const tfBucketA = getTimeframeBucket(genomeA.instrument.timeframe);
  const tfBucketB = getTimeframeBucket(genomeB.instrument.timeframe);
  if (tfBucketA !== tfBucketB) {
    if (cfg.requireTimeframeAdjacent) {
      score -= 30;
      reasons.push(`Timeframe bucket mismatch: ${tfBucketA} vs ${tfBucketB}`);
    } else {
      score -= 15;
      warnings.push(`Different timeframe buckets may produce unstable offspring`);
    }
  }

  // Instrument family compatibility
  const instrumentFamilyA = getInstrumentFamily(genomeA.instrument.symbol);
  const instrumentFamilyB = getInstrumentFamily(genomeB.instrument.symbol);
  if (instrumentFamilyA !== instrumentFamilyB) {
    if (cfg.requireInstrumentFamily) {
      score -= 40;
      reasons.push(`Instrument family mismatch: ${instrumentFamilyA} vs ${instrumentFamilyB}`);
    } else {
      score -= 20;
      warnings.push(`Different instrument families may produce non-viable offspring`);
    }
  }

  // Entry/Exit module compatibility
  const entryExitScore = calculateModuleCompatibility(genomeA, genomeB);
  score -= (100 - entryExitScore) * 0.2;
  if (entryExitScore < 50) {
    warnings.push(`Entry/Exit module combination may be suboptimal`);
  }

  // Regime gate compatibility
  if (genomeA.regimeGate.regimeModel !== genomeB.regimeGate.regimeModel) {
    score -= 10;
    warnings.push(`Different regime models - offspring will inherit from Progenitor A`);
  }

  // Constraint compatibility
  if (genomeA.constraints.noMartingale !== genomeB.constraints.noMartingale) {
    score -= 5;
    warnings.push(`Conflicting martingale constraints - will use stricter setting`);
  }

  // Ensure score stays in bounds
  score = Math.max(0, Math.min(100, score));

  // Determine recommended recombination type
  let recommendedRecombinationType: 'FULL' | 'PARTIAL' | 'MUTATION_ONLY';
  if (score >= 70) {
    recommendedRecombinationType = 'FULL';
  } else if (score >= cfg.minScore) {
    recommendedRecombinationType = 'PARTIAL';
  } else {
    recommendedRecombinationType = 'MUTATION_ONLY';
  }

  return {
    score,
    compatible: score >= cfg.minScore,
    reasons,
    warnings,
    recommendedRecombinationType,
  };
}

/**
 * Get instrument family for grouping compatible instruments
 */
function getInstrumentFamily(symbol: string): string {
  const families: Record<string, string[]> = {
    SP500: ['ES', 'MES', 'SPY', 'SPX'],
    NASDAQ: ['NQ', 'MNQ', 'QQQ', 'NDX'],
    RUSSELL: ['RTY', 'M2K', 'IWM'],
    DOW: ['YM', 'MYM', 'DIA'],
    CRUDE: ['CL', 'MCL', 'USO'],
    GOLD: ['GC', 'MGC', 'GLD'],
    BONDS: ['ZN', 'ZB', 'TLT'],
    FOREX_MAJOR: ['EURUSD', 'GBPUSD', 'USDJPY'],
  };

  for (const [family, symbols] of Object.entries(families)) {
    if (symbols.some(s => symbol.toUpperCase().includes(s))) {
      return family;
    }
  }
  return 'OTHER';
}

/**
 * Calculate module-level compatibility between entry and exit strategies
 */
function calculateModuleCompatibility(genomeA: Genome, genomeB: Genome): number {
  let score = 100;

  // Some entry/exit combinations are better than others
  const goodCombinations: Array<[string, string]> = [
    ['VWAP_RECLAIM', 'BRACKET'],
    ['VWAP_RECLAIM', 'TRAIL'],
    ['ORB', 'BRACKET'],
    ['ORB', 'TIME_EXIT'],
    ['BREAKOUT', 'TRAIL'],
    ['PULLBACK', 'BRACKET'],
    ['MEAN_REVERT', 'BRACKET'],
    ['LIQUIDITY_SWEEP', 'BRACKET'],
  ];

  const badCombinations: Array<[string, string]> = [
    ['MEAN_REVERT', 'TRAIL'], // Trailing doesn't work well with mean reversion
    ['ORB', 'TRAIL'], // ORB needs defined targets
  ];

  // Check if the potential offspring combination is good/bad
  // Offspring gets entry from A and exit from B
  const entryFamily = genomeA.entryModule.family;
  const exitFamily = genomeB.exitModule.family;

  const isGoodCombo = goodCombinations.some(
    ([e, x]) => e === entryFamily && x === exitFamily
  );
  const isBadCombo = badCombinations.some(
    ([e, x]) => e === entryFamily && x === exitFamily
  );

  if (isGoodCombo) {
    score += 10; // Bonus for known good combinations
  }
  if (isBadCombo) {
    score -= 30; // Penalty for known bad combinations
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Find the most compatible partner for a genome from a pool
 */
export function findBestPartner(
  genome: Genome,
  pool: Genome[],
  config?: Partial<CompatibilityConfig>
): { genome: Genome; compatibility: CompatibilityResult } | null {
  if (pool.length === 0) return null;

  let bestMatch: { genome: Genome; compatibility: CompatibilityResult } | null = null;
  let bestScore = -1;

  for (const candidate of pool) {
    const compatibility = calculateCompatibility(genome, candidate, config);
    if (compatibility.compatible && compatibility.score > bestScore) {
      bestScore = compatibility.score;
      bestMatch = { genome: candidate, compatibility };
    }
  }

  return bestMatch;
}

/**
 * Check if two genomes are from the same species (can freely recombine)
 */
export function areSameSpecies(genomeA: Genome, genomeB: Genome): boolean {
  return (
    genomeA.lane === genomeB.lane &&
    genomeA.entryModule.family === genomeB.entryModule.family &&
    getTimeframeBucket(genomeA.instrument.timeframe) === getTimeframeBucket(genomeB.instrument.timeframe)
  );
}
