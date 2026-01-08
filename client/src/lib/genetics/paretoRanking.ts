// Pareto Ranking for Multi-Objective Optimization
// Implements NSGA-II style non-dominated sorting

export interface FitnessVector {
  profitFactor: number;      // Higher is better
  winRate: number;           // Higher is better (0-1)
  maxDrawdown: number;       // Lower is better (as positive number)
  sharpe: number;            // Higher is better
  tradeCount: number;        // Must meet minimum, then higher is better to a point
  validationGap: number;     // Lower is better (train vs validation difference)
  regimeMatch: number;       // Higher is better (0-1)
  chopRate: number;          // Lower is better (0-1)
}

export interface RankedGenome {
  id: string;
  fitness: FitnessVector;
  paretoRank: number;        // 1 = Pareto front, 2 = second front, etc.
  crowdingDistance: number;  // For diversity preservation
  scalarFitness: number;     // Single number for display (0-100)
}

// Weights for scalar fitness calculation
const FITNESS_WEIGHTS = {
  profitFactor: 0.25,
  winRate: 0.20,
  maxDrawdown: 0.15,
  sharpe: 0.15,
  tradeCount: 0.05,
  validationGap: 0.10,
  regimeMatch: 0.05,
  chopRate: 0.05,
};

// Thresholds for fitness normalization
const FITNESS_THRESHOLDS = {
  profitFactor: { min: 0.8, max: 2.5, optimal: 1.5 },
  winRate: { min: 0.30, max: 0.70, optimal: 0.50 },
  maxDrawdown: { min: 0.02, max: 0.20, optimal: 0.05 },
  sharpe: { min: 0.0, max: 3.0, optimal: 1.5 },
  tradeCount: { min: 20, max: 200, optimal: 80 },
  validationGap: { min: 0.0, max: 0.30, optimal: 0.05 },
  regimeMatch: { min: 0.4, max: 1.0, optimal: 0.8 },
  chopRate: { min: 0.0, max: 0.5, optimal: 0.1 },
};

/**
 * Check if genome A dominates genome B (A is better in all objectives)
 */
function dominates(a: FitnessVector, b: FitnessVector): boolean {
  let dominated = false;
  let dominatesInAny = false;

  // For each objective, check if A is at least as good as B
  // and strictly better in at least one

  // Profit Factor: higher is better
  if (a.profitFactor < b.profitFactor) return false;
  if (a.profitFactor > b.profitFactor) dominatesInAny = true;

  // Win Rate: higher is better
  if (a.winRate < b.winRate) return false;
  if (a.winRate > b.winRate) dominatesInAny = true;

  // Max Drawdown: lower is better
  if (a.maxDrawdown > b.maxDrawdown) return false;
  if (a.maxDrawdown < b.maxDrawdown) dominatesInAny = true;

  // Sharpe: higher is better
  if (a.sharpe < b.sharpe) return false;
  if (a.sharpe > b.sharpe) dominatesInAny = true;

  // Validation Gap: lower is better
  if (a.validationGap > b.validationGap) return false;
  if (a.validationGap < b.validationGap) dominatesInAny = true;

  // Regime Match: higher is better
  if (a.regimeMatch < b.regimeMatch) return false;
  if (a.regimeMatch > b.regimeMatch) dominatesInAny = true;

  // Chop Rate: lower is better
  if (a.chopRate > b.chopRate) return false;
  if (a.chopRate < b.chopRate) dominatesInAny = true;

  return dominatesInAny;
}

/**
 * Perform non-dominated sorting (NSGA-II style)
 * Returns array of fronts, where front[0] is the Pareto front
 */
export function nonDominatedSort(
  population: Array<{ id: string; fitness: FitnessVector }>
): Array<Array<{ id: string; fitness: FitnessVector }>> {
  const n = population.length;
  const dominatedBy: Map<string, Set<string>> = new Map();
  const dominatesCount: Map<string, number> = new Map();
  const fronts: Array<Array<{ id: string; fitness: FitnessVector }>> = [];

  // Initialize
  for (const p of population) {
    dominatedBy.set(p.id, new Set());
    dominatesCount.set(p.id, 0);
  }

  // Calculate domination relationships
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = population[i];
      const q = population[j];

      if (dominates(p.fitness, q.fitness)) {
        dominatedBy.get(p.id)!.add(q.id);
        dominatesCount.set(q.id, (dominatesCount.get(q.id) || 0) + 1);
      } else if (dominates(q.fitness, p.fitness)) {
        dominatedBy.get(q.id)!.add(p.id);
        dominatesCount.set(p.id, (dominatesCount.get(p.id) || 0) + 1);
      }
    }
  }

  // Find first front (non-dominated solutions)
  let currentFront: Array<{ id: string; fitness: FitnessVector }> = [];
  for (const p of population) {
    if ((dominatesCount.get(p.id) || 0) === 0) {
      currentFront.push(p);
    }
  }
  fronts.push(currentFront);

  // Find subsequent fronts
  while (currentFront.length > 0) {
    const nextFront: Array<{ id: string; fitness: FitnessVector }> = [];
    
    for (const p of currentFront) {
      for (const qId of dominatedBy.get(p.id) || []) {
        const newCount = (dominatesCount.get(qId) || 0) - 1;
        dominatesCount.set(qId, newCount);
        
        if (newCount === 0) {
          const q = population.find(x => x.id === qId);
          if (q) nextFront.push(q);
        }
      }
    }
    
    if (nextFront.length > 0) {
      fronts.push(nextFront);
    }
    currentFront = nextFront;
  }

  return fronts;
}

/**
 * Calculate crowding distance for diversity preservation
 */
export function calculateCrowdingDistance(
  front: Array<{ id: string; fitness: FitnessVector }>
): Map<string, number> {
  const distances = new Map<string, number>();
  const n = front.length;

  if (n === 0) return distances;

  // Initialize distances
  for (const p of front) {
    distances.set(p.id, 0);
  }

  if (n <= 2) {
    // Boundary points get infinite distance
    for (const p of front) {
      distances.set(p.id, Infinity);
    }
    return distances;
  }

  // Calculate crowding distance for each objective
  const objectives: (keyof FitnessVector)[] = [
    'profitFactor', 'winRate', 'maxDrawdown', 'sharpe',
    'validationGap', 'regimeMatch', 'chopRate'
  ];

  for (const obj of objectives) {
    // Sort by this objective
    const sorted = [...front].sort((a, b) => a.fitness[obj] - b.fitness[obj]);
    
    // Boundary points get infinite distance
    distances.set(sorted[0].id, Infinity);
    distances.set(sorted[n - 1].id, Infinity);

    // Calculate range
    const range = sorted[n - 1].fitness[obj] - sorted[0].fitness[obj];
    if (range === 0) continue;

    // Add normalized distance contribution for middle points
    for (let i = 1; i < n - 1; i++) {
      const current = distances.get(sorted[i].id) || 0;
      const contribution = (sorted[i + 1].fitness[obj] - sorted[i - 1].fitness[obj]) / range;
      distances.set(sorted[i].id, current + contribution);
    }
  }

  return distances;
}

/**
 * Calculate scalar fitness score (0-100) from fitness vector
 */
export function calculateScalarFitness(fitness: FitnessVector): number {
  let score = 0;

  // Normalize each metric and apply weight
  // Profit Factor
  const pfNorm = normalizeMetric(
    fitness.profitFactor,
    FITNESS_THRESHOLDS.profitFactor.min,
    FITNESS_THRESHOLDS.profitFactor.max,
    true
  );
  score += pfNorm * FITNESS_WEIGHTS.profitFactor * 100;

  // Win Rate
  const wrNorm = normalizeMetric(
    fitness.winRate,
    FITNESS_THRESHOLDS.winRate.min,
    FITNESS_THRESHOLDS.winRate.max,
    true
  );
  score += wrNorm * FITNESS_WEIGHTS.winRate * 100;

  // Max Drawdown (lower is better)
  const ddNorm = normalizeMetric(
    fitness.maxDrawdown,
    FITNESS_THRESHOLDS.maxDrawdown.min,
    FITNESS_THRESHOLDS.maxDrawdown.max,
    false
  );
  score += ddNorm * FITNESS_WEIGHTS.maxDrawdown * 100;

  // Sharpe
  const sharpeNorm = normalizeMetric(
    fitness.sharpe,
    FITNESS_THRESHOLDS.sharpe.min,
    FITNESS_THRESHOLDS.sharpe.max,
    true
  );
  score += sharpeNorm * FITNESS_WEIGHTS.sharpe * 100;

  // Trade Count (diminishing returns after optimal)
  const tcNorm = normalizeTradeCount(
    fitness.tradeCount,
    FITNESS_THRESHOLDS.tradeCount.min,
    FITNESS_THRESHOLDS.tradeCount.optimal,
    FITNESS_THRESHOLDS.tradeCount.max
  );
  score += tcNorm * FITNESS_WEIGHTS.tradeCount * 100;

  // Validation Gap (lower is better)
  const vgNorm = normalizeMetric(
    fitness.validationGap,
    FITNESS_THRESHOLDS.validationGap.min,
    FITNESS_THRESHOLDS.validationGap.max,
    false
  );
  score += vgNorm * FITNESS_WEIGHTS.validationGap * 100;

  // Regime Match
  const rmNorm = normalizeMetric(
    fitness.regimeMatch,
    FITNESS_THRESHOLDS.regimeMatch.min,
    FITNESS_THRESHOLDS.regimeMatch.max,
    true
  );
  score += rmNorm * FITNESS_WEIGHTS.regimeMatch * 100;

  // Chop Rate (lower is better)
  const crNorm = normalizeMetric(
    fitness.chopRate,
    FITNESS_THRESHOLDS.chopRate.min,
    FITNESS_THRESHOLDS.chopRate.max,
    false
  );
  score += crNorm * FITNESS_WEIGHTS.chopRate * 100;

  // Apply hard penalties
  // If PF < 1.0, heavily penalize
  if (fitness.profitFactor < 1.0) {
    score *= 0.5;
  }
  // If win rate < 35%, penalize
  if (fitness.winRate < 0.35) {
    score *= 0.7;
  }
  // If trade count too low, cap score
  if (fitness.tradeCount < 20) {
    score = Math.min(score, 40);
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Normalize a metric to 0-1 range
 */
function normalizeMetric(value: number, min: number, max: number, higherIsBetter: boolean): number {
  const clamped = Math.max(min, Math.min(max, value));
  const normalized = (clamped - min) / (max - min);
  return higherIsBetter ? normalized : 1 - normalized;
}

/**
 * Normalize trade count with diminishing returns
 */
function normalizeTradeCount(value: number, min: number, optimal: number, max: number): number {
  if (value < min) return 0;
  if (value <= optimal) {
    return (value - min) / (optimal - min);
  }
  // Diminishing returns after optimal
  const overOptimal = value - optimal;
  const maxOver = max - optimal;
  return 1.0 - 0.2 * (overOptimal / maxOver); // Slight penalty for overtrading
}

/**
 * Rank entire population with Pareto ranking and crowding distance
 */
export function rankPopulation(
  population: Array<{ id: string; fitness: FitnessVector }>
): RankedGenome[] {
  const fronts = nonDominatedSort(population);
  const ranked: RankedGenome[] = [];

  for (let frontIndex = 0; frontIndex < fronts.length; frontIndex++) {
    const front = fronts[frontIndex];
    const crowdingDistances = calculateCrowdingDistance(front);

    for (const genome of front) {
      ranked.push({
        id: genome.id,
        fitness: genome.fitness,
        paretoRank: frontIndex + 1,
        crowdingDistance: crowdingDistances.get(genome.id) || 0,
        scalarFitness: calculateScalarFitness(genome.fitness),
      });
    }
  }

  // Sort by Pareto rank, then by crowding distance (descending)
  ranked.sort((a, b) => {
    if (a.paretoRank !== b.paretoRank) {
      return a.paretoRank - b.paretoRank;
    }
    return b.crowdingDistance - a.crowdingDistance;
  });

  return ranked;
}

/**
 * Create empty/default fitness vector
 */
export function createDefaultFitnessVector(): FitnessVector {
  return {
    profitFactor: 1.0,
    winRate: 0.5,
    maxDrawdown: 0.10,
    sharpe: 0.0,
    tradeCount: 0,
    validationGap: 0.0,
    regimeMatch: 0.5,
    chopRate: 0.2,
  };
}

/**
 * Check if fitness meets viable export threshold
 */
export function meetsExportThreshold(fitness: FitnessVector): {
  viable: boolean;
  failedCriteria: string[];
} {
  const failedCriteria: string[] = [];

  if (fitness.profitFactor < 1.15) {
    failedCriteria.push(`PF ${fitness.profitFactor.toFixed(2)} < 1.15`);
  }
  if (fitness.winRate < 0.40) {
    failedCriteria.push(`WR ${(fitness.winRate * 100).toFixed(1)}% < 40%`);
  }
  if (fitness.maxDrawdown > 0.15) {
    failedCriteria.push(`DD ${(fitness.maxDrawdown * 100).toFixed(1)}% > 15%`);
  }
  if (fitness.sharpe < 0.8) {
    failedCriteria.push(`Sharpe ${fitness.sharpe.toFixed(2)} < 0.8`);
  }
  if (fitness.tradeCount < 30) {
    failedCriteria.push(`Trades ${fitness.tradeCount} < 30`);
  }

  return {
    viable: failedCriteria.length === 0,
    failedCriteria,
  };
}
