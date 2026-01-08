// Genetics System - Main Export
// Strategy Lab Genetic Evolution

export * from './genomeSchema';
export * from './compatibilityScorer';
export * from './recombinationEngine';
export * from './targetedMutation';
export * from './paretoRanking';
export * from './speciation';

// Re-export commonly used types
export type {
  Genome,
  GenomeInstrument,
  EntryModule,
  ExitModule,
  RiskModule,
  FiltersModule,
  RegimeGateModule,
  GenomeMetadata,
  GenomeValidationResult,
} from './genomeSchema';

export type {
  CompatibilityResult,
  CompatibilityConfig,
} from './compatibilityScorer';

export type {
  GeneticTraits,
  RecombinationResult,
  RecombinationConfig,
} from './recombinationEngine';

export type {
  FailureArchetype,
  MutationManifest,
  MutationConfig,
} from './targetedMutation';

export type {
  FitnessVector,
  RankedGenome,
} from './paretoRanking';

export type {
  Species,
  SpeciesAssignment,
  DiversityMetrics,
  DiversityConfig,
} from './speciation';
