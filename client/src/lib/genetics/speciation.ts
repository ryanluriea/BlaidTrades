// Speciation System for Genetic Diversity
// Groups genomes into species and enforces diversity

import { Genome, getTimeframeBucket } from './genomeSchema';
import { calculateGeneticDistance } from './recombinationEngine';

export interface Species {
  id: string;
  key: string; // e.g., "TREND_VWAP_SCALP"
  memberCount: number;
  bestFitness: number;
  avgFitness: number;
  generationBorn: number;
  lastImprovementGen: number;
  isStagnant: boolean;
  representativeGenomeId?: string;
}

export interface SpeciesAssignment {
  genomeId: string;
  speciesId: string;
  speciesKey: string;
}

export interface DiversityMetrics {
  totalSpecies: number;
  avgSpeciesSize: number;
  diversityScore: number; // 0-1
  dominantSpeciesRatio: number; // Largest species / total
  stagnantSpecies: number;
}

export interface DiversityConfig {
  minSpecies: number;
  maxSpeciesRatio: number; // Max fraction for single species
  stagnationThreshold: number; // Generations without improvement
  immigrationTriggerDiversity: number; // Diversity below this triggers immigration
}

const DEFAULT_CONFIG: DiversityConfig = {
  minSpecies: 3,
  maxSpeciesRatio: 0.40,
  stagnationThreshold: 5,
  immigrationTriggerDiversity: 0.3,
};

/**
 * Generate species key from genome characteristics
 */
export function getSpeciesKey(genome: Genome): string {
  const lane = genome.lane;
  const entryFamily = genome.entryModule.family;
  const timeframeBucket = getTimeframeBucket(genome.instrument.timeframe);
  
  return `${lane}_${entryFamily}_${timeframeBucket}`;
}

/**
 * Generate unique species ID
 */
export function generateSpeciesId(sessionId: string, speciesKey: string): string {
  return `${sessionId.slice(0, 8)}_${speciesKey}_${Date.now().toString(36)}`;
}

/**
 * Assign genomes to species based on their characteristics
 */
export function assignSpecies(
  genomes: Array<{ id: string; genome: Genome; fitness?: number }>,
  sessionId: string
): {
  assignments: SpeciesAssignment[];
  species: Species[];
} {
  const speciesMap = new Map<string, {
    id: string;
    key: string;
    members: Array<{ id: string; fitness: number }>;
  }>();

  // Assign each genome to a species
  const assignments: SpeciesAssignment[] = [];

  for (const { id, genome, fitness = 0 } of genomes) {
    const speciesKey = getSpeciesKey(genome);
    
    if (!speciesMap.has(speciesKey)) {
      speciesMap.set(speciesKey, {
        id: generateSpeciesId(sessionId, speciesKey),
        key: speciesKey,
        members: [],
      });
    }

    const species = speciesMap.get(speciesKey)!;
    species.members.push({ id, fitness });
    
    assignments.push({
      genomeId: id,
      speciesId: species.id,
      speciesKey,
    });
  }

  // Build species objects
  const species: Species[] = Array.from(speciesMap.values()).map(s => ({
    id: s.id,
    key: s.key,
    memberCount: s.members.length,
    bestFitness: Math.max(...s.members.map(m => m.fitness), 0),
    avgFitness: s.members.length > 0 
      ? s.members.reduce((sum, m) => sum + m.fitness, 0) / s.members.length 
      : 0,
    generationBorn: 1, // Will be updated by caller
    lastImprovementGen: 1,
    isStagnant: false,
    representativeGenomeId: s.members[0]?.id,
  }));

  return { assignments, species };
}

/**
 * Calculate diversity metrics for a population
 */
export function calculateDiversityMetrics(
  species: Species[],
  totalPopulation: number
): DiversityMetrics {
  if (species.length === 0 || totalPopulation === 0) {
    return {
      totalSpecies: 0,
      avgSpeciesSize: 0,
      diversityScore: 0,
      dominantSpeciesRatio: 1,
      stagnantSpecies: 0,
    };
  }

  const totalSpecies = species.length;
  const avgSpeciesSize = totalPopulation / totalSpecies;
  
  // Find dominant species
  const maxMembers = Math.max(...species.map(s => s.memberCount));
  const dominantSpeciesRatio = maxMembers / totalPopulation;

  // Calculate diversity score using Shannon entropy
  const entropy = species.reduce((sum, s) => {
    const p = s.memberCount / totalPopulation;
    return p > 0 ? sum - p * Math.log2(p) : sum;
  }, 0);
  
  // Normalize entropy to 0-1 (max entropy is log2(n))
  const maxEntropy = Math.log2(totalSpecies);
  const diversityScore = maxEntropy > 0 ? entropy / maxEntropy : 0;

  const stagnantSpecies = species.filter(s => s.isStagnant).length;

  return {
    totalSpecies,
    avgSpeciesSize,
    diversityScore,
    dominantSpeciesRatio,
    stagnantSpecies,
  };
}

/**
 * Update species stagnation status
 */
export function updateStagnation(
  species: Species[],
  currentGeneration: number,
  previousBestFitness: Map<string, number>,
  config: Partial<DiversityConfig> = {}
): Species[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return species.map(s => {
    const prevBest = previousBestFitness.get(s.id) || 0;
    const improved = s.bestFitness > prevBest;

    return {
      ...s,
      lastImprovementGen: improved ? currentGeneration : s.lastImprovementGen,
      isStagnant: (currentGeneration - s.lastImprovementGen) >= cfg.stagnationThreshold,
    };
  });
}

/**
 * Check if immigration should be triggered
 */
export function shouldTriggerImmigration(
  metrics: DiversityMetrics,
  config: Partial<DiversityConfig> = {}
): {
  trigger: boolean;
  reasons: string[];
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];

  if (metrics.diversityScore < cfg.immigrationTriggerDiversity) {
    reasons.push(`Low diversity: ${(metrics.diversityScore * 100).toFixed(1)}%`);
  }

  if (metrics.totalSpecies < cfg.minSpecies) {
    reasons.push(`Too few species: ${metrics.totalSpecies} < ${cfg.minSpecies}`);
  }

  if (metrics.dominantSpeciesRatio > cfg.maxSpeciesRatio) {
    reasons.push(`Dominant species too large: ${(metrics.dominantSpeciesRatio * 100).toFixed(1)}%`);
  }

  if (metrics.stagnantSpecies > metrics.totalSpecies / 2) {
    reasons.push(`Too many stagnant species: ${metrics.stagnantSpecies}/${metrics.totalSpecies}`);
  }

  return {
    trigger: reasons.length > 0,
    reasons,
  };
}

/**
 * Enforce diversity constraints during selection
 * Returns indices of genomes to include/exclude
 */
export function enforceDiversityConstraints(
  rankedGenomes: Array<{ id: string; speciesId: string; fitness: number }>,
  targetSize: number,
  config: Partial<DiversityConfig> = {}
): {
  selected: string[];
  excluded: string[];
  adjustments: string[];
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const selected: string[] = [];
  const excluded: string[] = [];
  const adjustments: string[] = [];

  // Count members per species
  const speciesCounts = new Map<string, number>();
  const maxPerSpecies = Math.ceil(targetSize * cfg.maxSpeciesRatio);

  // First pass: select top genomes respecting diversity
  for (const genome of rankedGenomes) {
    const currentCount = speciesCounts.get(genome.speciesId) || 0;

    if (selected.length >= targetSize) {
      excluded.push(genome.id);
      continue;
    }

    if (currentCount >= maxPerSpecies) {
      // Species cap reached, skip unless we need more
      excluded.push(genome.id);
      adjustments.push(`Capped ${genome.speciesId} at ${maxPerSpecies}`);
      continue;
    }

    selected.push(genome.id);
    speciesCounts.set(genome.speciesId, currentCount + 1);
  }

  // Second pass: ensure minimum species representation
  const representedSpecies = new Set(
    rankedGenomes
      .filter(g => selected.includes(g.id))
      .map(g => g.speciesId)
  );

  // If we have fewer species than minimum, try to include representatives
  if (representedSpecies.size < cfg.minSpecies) {
    const missingSpecies = rankedGenomes
      .filter(g => !representedSpecies.has(g.speciesId) && excluded.includes(g.id))
      .reduce((map, g) => {
        if (!map.has(g.speciesId)) {
          map.set(g.speciesId, g);
        }
        return map;
      }, new Map<string, typeof rankedGenomes[0]>());

    for (const [speciesId, genome] of missingSpecies) {
      if (selected.length >= targetSize) break;
      
      // Swap in this genome for the worst selected genome from an over-represented species
      const overRepresented = Array.from(speciesCounts.entries())
        .filter(([_, count]) => count > 1)
        .sort((a, b) => b[1] - a[1])[0];

      if (overRepresented) {
        const toRemove = selected.findIndex(id => {
          const g = rankedGenomes.find(x => x.id === id);
          return g?.speciesId === overRepresented[0];
        });

        if (toRemove >= 0) {
          const removedId = selected[toRemove];
          selected.splice(toRemove, 1);
          excluded.push(removedId);
          
          selected.push(genome.id);
          excluded.splice(excluded.indexOf(genome.id), 1);
          
          speciesCounts.set(overRepresented[0], overRepresented[1] - 1);
          speciesCounts.set(speciesId, 1);
          
          adjustments.push(`Added ${speciesId} for diversity`);
        }
      }
    }
  }

  return { selected, excluded, adjustments };
}

/**
 * Calculate average genetic distance for a population
 */
export function calculatePopulationDiversity(
  genomes: Array<{ id: string; genome: Genome }>
): number {
  if (genomes.length < 2) return 0;

  let totalDistance = 0;
  let pairs = 0;

  for (let i = 0; i < genomes.length; i++) {
    for (let j = i + 1; j < genomes.length; j++) {
      totalDistance += calculateGeneticDistance(genomes[i].genome, genomes[j].genome);
      pairs++;
    }
  }

  return pairs > 0 ? totalDistance / pairs : 0;
}
