// Genetic Recombination Engine
// Handles combining two progenitor genomes into offspring

import { Genome, createDefaultGenome, validateGenome } from './genomeSchema';
import { calculateCompatibility, CompatibilityResult } from './compatibilityScorer';

export interface GeneticTraits {
  inheritedFromProgenitorA: string[];
  inheritedFromProgenitorB: string[];
  conflictsResolved: Array<{
    field: string;
    valueA: unknown;
    valueB: unknown;
    resolution: 'A' | 'B' | 'AVERAGE' | 'STRICTER';
    finalValue: unknown;
  }>;
  recombinationType: 'FULL' | 'PARTIAL' | 'MUTATION_ONLY';
}

export interface RecombinationResult {
  offspring: Genome;
  geneticTraits: GeneticTraits;
  compatibility: CompatibilityResult;
  success: boolean;
  errors: string[];
}

export interface RecombinationConfig {
  forceRecombination: boolean; // Bypass compatibility check
  preferStricter: boolean; // For conflict resolution
  inheritanceWeightA: number; // 0-1, weight for progenitor A traits
}

const DEFAULT_CONFIG: RecombinationConfig = {
  forceRecombination: false,
  preferStricter: true,
  inheritanceWeightA: 0.5,
};

/**
 * Perform genetic recombination between two progenitor genomes
 */
export function recombine(
  progenitorA: Genome,
  progenitorB: Genome,
  config: Partial<RecombinationConfig> = {}
): RecombinationResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const errors: string[] = [];
  const geneticTraits: GeneticTraits = {
    inheritedFromProgenitorA: [],
    inheritedFromProgenitorB: [],
    conflictsResolved: [],
    recombinationType: 'FULL',
  };

  // Check compatibility
  const compatibility = calculateCompatibility(progenitorA, progenitorB);
  
  if (!compatibility.compatible && !cfg.forceRecombination) {
    return {
      offspring: progenitorA, // Return original if incompatible
      geneticTraits,
      compatibility,
      success: false,
      errors: ['Progenitors are incompatible for recombination', ...compatibility.reasons],
    };
  }

  geneticTraits.recombinationType = compatibility.recommendedRecombinationType;

  // Start with base offspring
  const offspring = createDefaultGenome();
  offspring.version = '1.0';
  offspring.metadata.createdBy = 'RECOMBINATION';
  offspring.metadata.tags = [...new Set([...progenitorA.metadata.tags, ...progenitorB.metadata.tags])];

  // Instrument: prefer progenitor A, but must be same family
  offspring.instrument = { ...progenitorA.instrument };
  geneticTraits.inheritedFromProgenitorA.push('instrument');

  // Lane: must match (already validated in compatibility)
  offspring.lane = progenitorA.lane;
  geneticTraits.inheritedFromProgenitorA.push('lane');

  // Entry Module: inherit from Progenitor A
  offspring.entryModule = JSON.parse(JSON.stringify(progenitorA.entryModule));
  geneticTraits.inheritedFromProgenitorA.push('entryModule');

  // Exit Module: inherit from Progenitor B
  offspring.exitModule = JSON.parse(JSON.stringify(progenitorB.exitModule));
  geneticTraits.inheritedFromProgenitorB.push('exitModule');

  // Regime Gate: average thresholds, inherit structure from A
  offspring.regimeGate = {
    ...progenitorA.regimeGate,
    thresholds: {
      minTrendConf: averageWithWeight(
        progenitorA.regimeGate.thresholds.minTrendConf,
        progenitorB.regimeGate.thresholds.minTrendConf,
        cfg.inheritanceWeightA
      ),
      minRangeConf: averageWithWeight(
        progenitorA.regimeGate.thresholds.minRangeConf,
        progenitorB.regimeGate.thresholds.minRangeConf,
        cfg.inheritanceWeightA
      ),
      avoidVolatility: averageWithWeight(
        progenitorA.regimeGate.thresholds.avoidVolatility,
        progenitorB.regimeGate.thresholds.avoidVolatility,
        cfg.inheritanceWeightA
      ),
    },
    features: {
      ...progenitorA.regimeGate.features,
      atrWindow: Math.round(averageWithWeight(
        progenitorA.regimeGate.features.atrWindow,
        progenitorB.regimeGate.features.atrWindow,
        cfg.inheritanceWeightA
      )),
    },
  };
  geneticTraits.inheritedFromProgenitorA.push('regimeGate.structure');
  geneticTraits.conflictsResolved.push({
    field: 'regimeGate.thresholds',
    valueA: progenitorA.regimeGate.thresholds,
    valueB: progenitorB.regimeGate.thresholds,
    resolution: 'AVERAGE',
    finalValue: offspring.regimeGate.thresholds,
  });

  // Risk Module: use stricter values for safety
  offspring.riskModule = {
    sizingModel: progenitorA.riskModule.sizingModel,
    rules: {
      maxTradesPerDay: cfg.preferStricter
        ? Math.min(progenitorA.riskModule.rules.maxTradesPerDay, progenitorB.riskModule.rules.maxTradesPerDay)
        : Math.round(averageWithWeight(
            progenitorA.riskModule.rules.maxTradesPerDay,
            progenitorB.riskModule.rules.maxTradesPerDay,
            cfg.inheritanceWeightA
          )),
      dailyLossLock: cfg.preferStricter
        ? Math.min(progenitorA.riskModule.rules.dailyLossLock, progenitorB.riskModule.rules.dailyLossLock)
        : Math.round(averageWithWeight(
            progenitorA.riskModule.rules.dailyLossLock,
            progenitorB.riskModule.rules.dailyLossLock,
            cfg.inheritanceWeightA
          )),
      maxConcurrent: cfg.preferStricter
        ? Math.min(progenitorA.riskModule.rules.maxConcurrent, progenitorB.riskModule.rules.maxConcurrent)
        : Math.round(averageWithWeight(
            progenitorA.riskModule.rules.maxConcurrent,
            progenitorB.riskModule.rules.maxConcurrent,
            cfg.inheritanceWeightA
          )),
      cooldownMins: cfg.preferStricter
        ? Math.max(progenitorA.riskModule.rules.cooldownMins, progenitorB.riskModule.rules.cooldownMins)
        : Math.round(averageWithWeight(
            progenitorA.riskModule.rules.cooldownMins,
            progenitorB.riskModule.rules.cooldownMins,
            cfg.inheritanceWeightA
          )),
    },
  };
  geneticTraits.conflictsResolved.push({
    field: 'riskModule.rules',
    valueA: progenitorA.riskModule.rules,
    valueB: progenitorB.riskModule.rules,
    resolution: cfg.preferStricter ? 'STRICTER' : 'AVERAGE',
    finalValue: offspring.riskModule.rules,
  });

  // Filters: merge with stricter preference
  offspring.filters = mergeFilters(progenitorA.filters, progenitorB.filters, cfg.preferStricter);
  geneticTraits.conflictsResolved.push({
    field: 'filters',
    valueA: progenitorA.filters,
    valueB: progenitorB.filters,
    resolution: 'STRICTER',
    finalValue: offspring.filters,
  });

  // Execution Assumptions: inherit from A
  offspring.executionAssumptions = { ...progenitorA.executionAssumptions };
  geneticTraits.inheritedFromProgenitorA.push('executionAssumptions');

  // Constraints: use stricter
  offspring.constraints = {
    noMartingale: progenitorA.constraints.noMartingale || progenitorB.constraints.noMartingale,
    maxLeverage: Math.min(progenitorA.constraints.maxLeverage, progenitorB.constraints.maxLeverage),
    maxRiskPerTrade: Math.min(progenitorA.constraints.maxRiskPerTrade, progenitorB.constraints.maxRiskPerTrade),
  };
  geneticTraits.conflictsResolved.push({
    field: 'constraints',
    valueA: progenitorA.constraints,
    valueB: progenitorB.constraints,
    resolution: 'STRICTER',
    finalValue: offspring.constraints,
  });

  // Generate offspring name
  offspring.metadata.name = generateOffspringName(progenitorA, progenitorB);

  // Validate offspring
  const validation = validateGenome(offspring, true);
  if (!validation.valid) {
    errors.push(...validation.errors);
  }
  if (validation.autoRepairs && validation.autoRepairs.length > 0) {
    // Apply auto-repairs
    for (const repair of validation.autoRepairs) {
      setNestedValue(offspring as unknown as Record<string, unknown>, repair.field, repair.newValue);
    }
  }

  return {
    offspring,
    geneticTraits,
    compatibility,
    success: errors.length === 0,
    errors,
  };
}

/**
 * Calculate weighted average
 */
function averageWithWeight(a: number, b: number, weightA: number): number {
  return a * weightA + b * (1 - weightA);
}

/**
 * Merge filter modules with conflict resolution
 */
function mergeFilters(
  filtersA: Genome['filters'],
  filtersB: Genome['filters'],
  preferStricter: boolean
): Genome['filters'] {
  return {
    // Merge time windows (union)
    timeWindows: mergeTimeWindows(filtersA.timeWindows, filtersB.timeWindows),
    // Volatility band: use stricter (narrower) range
    volatilityBand: {
      atrMinPct: preferStricter
        ? Math.max(filtersA.volatilityBand.atrMinPct, filtersB.volatilityBand.atrMinPct)
        : (filtersA.volatilityBand.atrMinPct + filtersB.volatilityBand.atrMinPct) / 2,
      atrMaxPct: preferStricter
        ? Math.min(filtersA.volatilityBand.atrMaxPct, filtersB.volatilityBand.atrMaxPct)
        : (filtersA.volatilityBand.atrMaxPct + filtersB.volatilityBand.atrMaxPct) / 2,
    },
    // News filter: enabled if either is enabled
    newsFilter: {
      enabled: filtersA.newsFilter.enabled || filtersB.newsFilter.enabled,
      minutesBefore: Math.max(filtersA.newsFilter.minutesBefore, filtersB.newsFilter.minutesBefore),
      minutesAfter: Math.max(filtersA.newsFilter.minutesAfter, filtersB.newsFilter.minutesAfter),
    },
    // Spread/slippage: use stricter
    spreadSlippageGuard: {
      maxSpread: preferStricter
        ? Math.min(filtersA.spreadSlippageGuard.maxSpread, filtersB.spreadSlippageGuard.maxSpread)
        : (filtersA.spreadSlippageGuard.maxSpread + filtersB.spreadSlippageGuard.maxSpread) / 2,
      maxSlipTicks: preferStricter
        ? Math.min(filtersA.spreadSlippageGuard.maxSlipTicks, filtersB.spreadSlippageGuard.maxSlipTicks)
        : Math.round((filtersA.spreadSlippageGuard.maxSlipTicks + filtersB.spreadSlippageGuard.maxSlipTicks) / 2),
    },
  };
}

/**
 * Merge time windows (take intersection if overlapping, else union)
 */
function mergeTimeWindows(
  windowsA: Genome['filters']['timeWindows'],
  windowsB: Genome['filters']['timeWindows']
): Genome['filters']['timeWindows'] {
  // For simplicity, take the first window from A if same timezone, else union
  if (windowsA.length === 0) return windowsB;
  if (windowsB.length === 0) return windowsA;
  
  // If same timezone, try to find overlap
  if (windowsA[0].tz === windowsB[0].tz) {
    return [windowsA[0]]; // Simplified: just use A's window
  }
  
  return [...windowsA]; // Default to A's windows
}

/**
 * Generate a name for offspring genome
 */
function generateOffspringName(progenitorA: Genome, progenitorB: Genome): string {
  const entryFamily = progenitorA.entryModule.family.replace('_', '');
  const exitFamily = progenitorB.exitModule.family.replace('_', '');
  const symbol = progenitorA.instrument.symbol;
  const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
  
  return `${entryFamily}_${exitFamily}_${symbol}_${timestamp}`;
}

/**
 * Set a nested value in an object using dot notation path
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) {
      (current as Record<string, unknown>)[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Calculate genetic distance between two genomes (for diversity tracking)
 */
export function calculateGeneticDistance(genomeA: Genome, genomeB: Genome): number {
  let distance = 0;
  const maxDistance = 10; // Normalized to 0-10 scale

  // Lane difference
  if (genomeA.lane !== genomeB.lane) distance += 2;

  // Entry family difference
  if (genomeA.entryModule.family !== genomeB.entryModule.family) distance += 2;

  // Exit family difference
  if (genomeA.exitModule.family !== genomeB.exitModule.family) distance += 1.5;

  // Regime model difference
  if (genomeA.regimeGate.regimeModel !== genomeB.regimeGate.regimeModel) distance += 1;

  // Timeframe difference
  if (genomeA.instrument.timeframe !== genomeB.instrument.timeframe) distance += 1;

  // Parameter differences (normalized)
  const thresholdDiff = Math.abs(
    genomeA.regimeGate.thresholds.minTrendConf - genomeB.regimeGate.thresholds.minTrendConf
  );
  distance += thresholdDiff * 2;

  const stopDiff = Math.abs(
    genomeA.exitModule.rules.stopLossTicks - genomeB.exitModule.rules.stopLossTicks
  ) / 20;
  distance += stopDiff;

  return Math.min(maxDistance, distance);
}
