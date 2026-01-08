// Targeted Mutation Engine
// Applies intelligent mutations based on failure archetypes

import { Genome, GENOME_BOUNDS, validateGenome } from './genomeSchema';

export type FailureArchetype =
  | 'CHOP_ADDICTION'      // High chop rate
  | 'REGIME_CONFUSION'    // Low regime match
  | 'OVERFIT_VALIDATION'  // High validation gap
  | 'STOP_TOO_WIDE'       // Stops too wide
  | 'STOP_TOO_TIGHT'      // Stops too tight
  | 'LATE_ENTRY'          // Poor R:R ratio
  | 'SLIPPAGE_SENSITIVE'  // High slippage impact
  | 'TOO_FEW_TRADES'      // Insufficient signals
  | 'TOO_MANY_TRADES'     // Overtrading
  | 'LOW_WIN_RATE'        // Win rate below threshold
  | 'LOW_PROFIT_FACTOR'   // PF below threshold
  | 'HIGH_DRAWDOWN'       // Max DD too high
  | 'RANDOM';             // Random mutation

export interface MutationManifest {
  mutatedFields: string[];
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
  reasonArchetype: FailureArchetype;
  mutationStrength: number; // 0-1
}

export interface MutationConfig {
  strength: number; // 0-1, how aggressive the mutation
  maxFieldsToMutate: number;
  respectBounds: boolean;
  seed?: number; // For deterministic mutations
}

const DEFAULT_CONFIG: MutationConfig = {
  strength: 0.15, // 15% change by default
  maxFieldsToMutate: 3,
  respectBounds: true,
};

// Mapping from failure archetypes to targeted mutations
const ARCHETYPE_MUTATIONS: Record<FailureArchetype, Array<{
  field: string;
  direction: 'INCREASE' | 'DECREASE' | 'TIGHTEN' | 'LOOSEN' | 'TOGGLE';
  priority: number;
}>> = {
  CHOP_ADDICTION: [
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'INCREASE', priority: 1 },
    { field: 'regimeGate.thresholds.minRangeConf', direction: 'INCREASE', priority: 1 },
    { field: 'filters.volatilityBand.atrMinPct', direction: 'INCREASE', priority: 2 },
    { field: 'entryModule.confirmations.minConfluence', direction: 'INCREASE', priority: 2 },
    { field: 'riskModule.rules.cooldownMins', direction: 'INCREASE', priority: 3 },
  ],
  REGIME_CONFUSION: [
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'INCREASE', priority: 1 },
    { field: 'regimeGate.thresholds.minRangeConf', direction: 'INCREASE', priority: 1 },
    { field: 'regimeGate.thresholds.avoidVolatility', direction: 'DECREASE', priority: 2 },
    { field: 'regimeGate.features.trendSlopeWindow', direction: 'INCREASE', priority: 3 },
  ],
  OVERFIT_VALIDATION: [
    { field: 'entryModule.confirmations.minConfluence', direction: 'DECREASE', priority: 1 },
    { field: 'filters.volatilityBand.atrMinPct', direction: 'DECREASE', priority: 2 },
    { field: 'filters.volatilityBand.atrMaxPct', direction: 'INCREASE', priority: 2 },
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'DECREASE', priority: 3 },
  ],
  STOP_TOO_WIDE: [
    { field: 'exitModule.rules.stopLossTicks', direction: 'DECREASE', priority: 1 },
    { field: 'exitModule.rules.invalidationExit', direction: 'TOGGLE', priority: 2 },
    { field: 'riskModule.rules.dailyLossLock', direction: 'DECREASE', priority: 3 },
  ],
  STOP_TOO_TIGHT: [
    { field: 'exitModule.rules.stopLossTicks', direction: 'INCREASE', priority: 1 },
    { field: 'filters.volatilityBand.atrMinPct', direction: 'INCREASE', priority: 2 },
    { field: 'riskModule.rules.maxTradesPerDay', direction: 'DECREASE', priority: 3 },
  ],
  LATE_ENTRY: [
    { field: 'entryModule.confirmations.minConfluence', direction: 'DECREASE', priority: 1 },
    { field: 'exitModule.rules.profitTargetTicks', direction: 'INCREASE', priority: 2 },
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'DECREASE', priority: 3 },
  ],
  SLIPPAGE_SENSITIVE: [
    { field: 'filters.spreadSlippageGuard.maxSlipTicks', direction: 'DECREASE', priority: 1 },
    { field: 'filters.spreadSlippageGuard.maxSpread', direction: 'DECREASE', priority: 1 },
    { field: 'exitModule.rules.stopLossTicks', direction: 'INCREASE', priority: 2 },
    { field: 'exitModule.rules.profitTargetTicks', direction: 'INCREASE', priority: 2 },
  ],
  TOO_FEW_TRADES: [
    { field: 'entryModule.confirmations.minConfluence', direction: 'DECREASE', priority: 1 },
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'DECREASE', priority: 2 },
    { field: 'regimeGate.thresholds.minRangeConf', direction: 'DECREASE', priority: 2 },
    { field: 'filters.volatilityBand.atrMinPct', direction: 'DECREASE', priority: 3 },
    { field: 'filters.volatilityBand.atrMaxPct', direction: 'INCREASE', priority: 3 },
  ],
  TOO_MANY_TRADES: [
    { field: 'riskModule.rules.maxTradesPerDay', direction: 'DECREASE', priority: 1 },
    { field: 'riskModule.rules.cooldownMins', direction: 'INCREASE', priority: 1 },
    { field: 'entryModule.confirmations.minConfluence', direction: 'INCREASE', priority: 2 },
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'INCREASE', priority: 3 },
  ],
  LOW_WIN_RATE: [
    { field: 'entryModule.confirmations.minConfluence', direction: 'INCREASE', priority: 1 },
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'INCREASE', priority: 2 },
    { field: 'exitModule.rules.stopLossTicks', direction: 'DECREASE', priority: 3 },
  ],
  LOW_PROFIT_FACTOR: [
    { field: 'exitModule.rules.profitTargetTicks', direction: 'INCREASE', priority: 1 },
    { field: 'exitModule.rules.stopLossTicks', direction: 'DECREASE', priority: 2 },
    { field: 'riskModule.rules.dailyLossLock', direction: 'DECREASE', priority: 3 },
  ],
  HIGH_DRAWDOWN: [
    { field: 'riskModule.rules.maxTradesPerDay', direction: 'DECREASE', priority: 1 },
    { field: 'riskModule.rules.dailyLossLock', direction: 'DECREASE', priority: 1 },
    { field: 'exitModule.rules.stopLossTicks', direction: 'DECREASE', priority: 2 },
    { field: 'riskModule.rules.maxConcurrent', direction: 'DECREASE', priority: 3 },
  ],
  RANDOM: [
    { field: 'regimeGate.thresholds.minTrendConf', direction: 'TIGHTEN', priority: 1 },
    { field: 'exitModule.rules.stopLossTicks', direction: 'TIGHTEN', priority: 1 },
    { field: 'exitModule.rules.profitTargetTicks', direction: 'TIGHTEN', priority: 1 },
    { field: 'riskModule.rules.maxTradesPerDay', direction: 'TIGHTEN', priority: 2 },
  ],
};

/**
 * Apply targeted mutation based on failure archetype
 */
export function mutate(
  genome: Genome,
  archetype: FailureArchetype,
  config: Partial<MutationConfig> = {}
): { genome: Genome; manifest: MutationManifest } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const mutatedGenome = JSON.parse(JSON.stringify(genome)) as Genome;
  const manifest: MutationManifest = {
    mutatedFields: [],
    changes: [],
    reasonArchetype: archetype,
    mutationStrength: cfg.strength,
  };

  // Get mutations for this archetype
  const mutations = ARCHETYPE_MUTATIONS[archetype] || ARCHETYPE_MUTATIONS.RANDOM;
  
  // Sort by priority and take top N
  const sortedMutations = [...mutations].sort((a, b) => a.priority - b.priority);
  const toApply = sortedMutations.slice(0, cfg.maxFieldsToMutate);

  // Apply each mutation
  for (const mutation of toApply) {
    const result = applyMutation(
      mutatedGenome,
      mutation.field,
      mutation.direction,
      cfg.strength,
      cfg.respectBounds,
      cfg.seed
    );
    
    if (result.changed) {
      manifest.mutatedFields.push(mutation.field);
      manifest.changes.push({
        field: mutation.field,
        oldValue: result.oldValue,
        newValue: result.newValue,
        reason: `${archetype} → ${mutation.direction}`,
      });
    }
  }

  // Update metadata
  mutatedGenome.metadata.createdBy = 'MUTATION';
  mutatedGenome.metadata.tags = [...new Set([...genome.metadata.tags, `mutated:${archetype.toLowerCase()}`])];
  mutatedGenome.metadata.name = `${genome.metadata.name}_M${Date.now().toString(36).slice(-3).toUpperCase()}`;

  // Validate and auto-repair if needed
  const validation = validateGenome(mutatedGenome, true);
  if (validation.autoRepairs) {
    for (const repair of validation.autoRepairs) {
      setNestedValue(mutatedGenome as unknown as Record<string, unknown>, repair.field, repair.newValue);
      manifest.changes.push({
        field: repair.field,
        oldValue: repair.oldValue,
        newValue: repair.newValue,
        reason: 'AUTO_REPAIR (bounds)',
      });
    }
  }

  return { genome: mutatedGenome, manifest };
}

/**
 * Apply a single mutation to a field
 */
function applyMutation(
  genome: Genome,
  field: string,
  direction: 'INCREASE' | 'DECREASE' | 'TIGHTEN' | 'LOOSEN' | 'TOGGLE',
  strength: number,
  respectBounds: boolean,
  seed?: number
): { changed: boolean; oldValue: unknown; newValue: unknown } {
  const oldValue = getNestedValue(genome as unknown as Record<string, unknown>, field);
  let newValue: unknown = oldValue;

  // Handle numeric values
  if (typeof oldValue === 'number') {
    const bounds = getBoundsForField(field);
    const range = bounds ? bounds.max - bounds.min : oldValue;
    const delta = range * strength;

    switch (direction) {
      case 'INCREASE':
        newValue = oldValue + delta;
        break;
      case 'DECREASE':
        newValue = oldValue - delta;
        break;
      case 'TIGHTEN':
      case 'LOOSEN':
        // Random direction based on seed or random
        const rand = seed !== undefined ? seededRandom(seed) : Math.random();
        newValue = rand > 0.5 ? oldValue + delta : oldValue - delta;
        break;
    }

    // Apply bounds if requested
    if (respectBounds && bounds) {
      newValue = Math.max(bounds.min, Math.min(bounds.max, newValue as number));
    }

    // Round to appropriate precision
    if (bounds?.step && bounds.step >= 1) {
      newValue = Math.round(newValue as number);
    } else {
      newValue = Math.round((newValue as number) * 100) / 100;
    }
  }

  // Handle boolean values
  if (typeof oldValue === 'boolean' && direction === 'TOGGLE') {
    newValue = !oldValue;
  }

  setNestedValue(genome as unknown as Record<string, unknown>, field, newValue);

  return {
    changed: oldValue !== newValue,
    oldValue,
    newValue,
  };
}

/**
 * Get bounds for a field path
 */
function getBoundsForField(field: string): { min: number; max: number; step: number } | null {
  const parts = field.split('.');
  const module = parts[0] as keyof typeof GENOME_BOUNDS;
  const param = parts[parts.length - 1];

  if (module in GENOME_BOUNDS) {
    const moduleBounds = GENOME_BOUNDS[module] as Record<string, { min: number; max: number; step: number }>;
    if (param in moduleBounds) {
      return moduleBounds[param];
    }
  }

  return null;
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value in an object using dot notation
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
 * Simple seeded random number generator
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Detect failure archetypes from fitness metrics
 */
export function detectFailureArchetypes(metrics: {
  profitFactor?: number;
  winRate?: number;
  maxDrawdown?: number;
  tradeCount?: number;
  chopRate?: number;
  regimeMatch?: number;
  validationGap?: number;
  avgSlippage?: number;
}): FailureArchetype[] {
  const archetypes: FailureArchetype[] = [];

  if (metrics.chopRate !== undefined && metrics.chopRate > 0.3) {
    archetypes.push('CHOP_ADDICTION');
  }
  if (metrics.regimeMatch !== undefined && metrics.regimeMatch < 0.6) {
    archetypes.push('REGIME_CONFUSION');
  }
  if (metrics.validationGap !== undefined && metrics.validationGap > 0.2) {
    archetypes.push('OVERFIT_VALIDATION');
  }
  if (metrics.winRate !== undefined && metrics.winRate < 0.38) {
    archetypes.push('LOW_WIN_RATE');
  }
  if (metrics.profitFactor !== undefined && metrics.profitFactor < 1.1) {
    archetypes.push('LOW_PROFIT_FACTOR');
  }
  if (metrics.maxDrawdown !== undefined && metrics.maxDrawdown > 0.15) {
    archetypes.push('HIGH_DRAWDOWN');
  }
  if (metrics.tradeCount !== undefined && metrics.tradeCount < 30) {
    archetypes.push('TOO_FEW_TRADES');
  }
  if (metrics.tradeCount !== undefined && metrics.tradeCount > 200) {
    archetypes.push('TOO_MANY_TRADES');
  }
  if (metrics.avgSlippage !== undefined && metrics.avgSlippage > 2) {
    archetypes.push('SLIPPAGE_SENSITIVE');
  }

  // If no specific archetypes detected, use RANDOM
  if (archetypes.length === 0) {
    archetypes.push('RANDOM');
  }

  return archetypes;
}

/**
 * Apply multiple targeted mutations based on detected archetypes
 */
export function applyTargetedMutations(
  genome: Genome,
  metrics: Parameters<typeof detectFailureArchetypes>[0],
  config?: Partial<MutationConfig>
): { genome: Genome; manifests: MutationManifest[] } {
  const archetypes = detectFailureArchetypes(metrics);
  let currentGenome = genome;
  const manifests: MutationManifest[] = [];

  // Apply mutation for the primary (first) archetype
  // Additional archetypes are informational
  const primaryArchetype = archetypes[0];
  const result = mutate(currentGenome, primaryArchetype, config);
  currentGenome = result.genome;
  manifests.push(result.manifest);

  return { genome: currentGenome, manifests };
}
