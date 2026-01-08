// Canonical Genome Schema for Strategy Lab Genetics System
// All strategy/model candidates must conform to this schema

export interface GenomeInstrument {
  symbol: string;
  market: 'CME' | 'FOREX' | 'CRYPTO' | 'EQUITY';
  contractType?: 'MICRO' | 'MINI' | 'FULL';
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
}

export interface RegimeGateModule {
  regimeModel: 'RULED' | 'ML_PROXY' | 'HYBRID';
  outputs: ('TREND' | 'RANGE' | 'AVOID')[];
  thresholds: {
    minTrendConf: number;
    minRangeConf: number;
    avoidVolatility: number;
  };
  features: {
    atrWindow: number;
    trendSlopeWindow: number;
    compressionWindow: number;
    [key: string]: number;
  };
}

export interface EntryModule {
  family: 'VWAP_RECLAIM' | 'ORB' | 'PULLBACK' | 'BREAKOUT' | 'MEAN_REVERT' | 'LIQUIDITY_SWEEP' | 'CUSTOM';
  rules: Record<string, unknown>;
  confirmations: {
    minConfluence: number;
    momentumCheck?: boolean;
    volumeCheck?: boolean;
    [key: string]: unknown;
  };
  customComponentId?: string;
}

export interface ExitModule {
  family: 'BRACKET' | 'TRAIL' | 'TIME_EXIT' | 'HYBRID' | 'CUSTOM';
  rules: {
    stopLossTicks: number;
    profitTargetTicks: number;
    trailTicks?: number;
    timeStopMins?: number;
    invalidationExit?: boolean;
    [key: string]: unknown;
  };
  customComponentId?: string;
}

export interface RiskModule {
  sizingModel: 'FIXED' | 'VOL_ADJ' | 'RISK_PARITY' | 'CUSTOM';
  rules: {
    maxTradesPerDay: number;
    dailyLossLock: number;
    maxConcurrent: number;
    cooldownMins: number;
    [key: string]: unknown;
  };
  customComponentId?: string;
}

export interface TimeWindow {
  start: string; // HH:mm
  end: string;   // HH:mm
  tz: string;    // e.g., 'America/New_York'
}

export interface FiltersModule {
  timeWindows: TimeWindow[];
  volatilityBand: {
    atrMinPct: number;
    atrMaxPct: number;
  };
  newsFilter: {
    enabled: boolean;
    minutesBefore: number;
    minutesAfter: number;
  };
  spreadSlippageGuard: {
    maxSpread: number;
    maxSlipTicks: number;
  };
}

export interface ExecutionAssumptions {
  slippageModel: 'FIXED' | 'VARIABLE' | 'REALISTIC';
  latencyBucket: 'LOW' | 'MEDIUM' | 'HIGH';
  fillModel: 'IMMEDIATE' | 'QUEUE' | 'PARTIAL';
}

export interface GenomeConstraints {
  noMartingale: boolean;
  maxLeverage: number;
  maxRiskPerTrade: number;
}

export interface GenomeMetadata {
  name: string;
  description?: string;
  tags: string[];
  createdBy: 'AI' | 'USER' | 'RECOMBINATION' | 'MUTATION';
  customComponents?: {
    id: string;
    name: string;
    type: string;
    version: number;
  }[];
}

export interface Genome {
  version: string;
  instrument: GenomeInstrument;
  lane: 'TREND' | 'RANGE';
  regimeGate: RegimeGateModule;
  entryModule: EntryModule;
  exitModule: ExitModule;
  riskModule: RiskModule;
  filters: FiltersModule;
  executionAssumptions: ExecutionAssumptions;
  constraints: GenomeConstraints;
  metadata: GenomeMetadata;
}

// Parameter bounds for validation and mutation
export const GENOME_BOUNDS = {
  regimeGate: {
    minTrendConf: { min: 0.3, max: 0.9, step: 0.05 },
    minRangeConf: { min: 0.3, max: 0.9, step: 0.05 },
    avoidVolatility: { min: 0.5, max: 3.0, step: 0.1 },
    atrWindow: { min: 5, max: 50, step: 1 },
    trendSlopeWindow: { min: 5, max: 30, step: 1 },
    compressionWindow: { min: 10, max: 50, step: 1 },
  },
  entryModule: {
    minConfluence: { min: 1, max: 5, step: 1 },
  },
  exitModule: {
    stopLossTicks: { min: 4, max: 40, step: 1 },
    profitTargetTicks: { min: 4, max: 80, step: 1 },
    trailTicks: { min: 2, max: 20, step: 1 },
    timeStopMins: { min: 5, max: 120, step: 5 },
  },
  riskModule: {
    maxTradesPerDay: { min: 1, max: 20, step: 1 },
    dailyLossLock: { min: 100, max: 2000, step: 50 },
    maxConcurrent: { min: 1, max: 5, step: 1 },
    cooldownMins: { min: 0, max: 60, step: 5 },
  },
  filters: {
    atrMinPct: { min: 0.1, max: 1.0, step: 0.05 },
    atrMaxPct: { min: 1.0, max: 5.0, step: 0.1 },
    maxSpread: { min: 1, max: 10, step: 0.5 },
    maxSlipTicks: { min: 1, max: 8, step: 1 },
  },
  constraints: {
    maxLeverage: { min: 1, max: 10, step: 1 },
    maxRiskPerTrade: { min: 0.5, max: 5.0, step: 0.25 },
  },
} as const;

export interface GenomeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  autoRepairs?: { field: string; oldValue: unknown; newValue: unknown }[];
}

/**
 * Validate a genome against the canonical schema
 */
export function validateGenome(genome: Partial<Genome>, autoRepair = false): GenomeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const autoRepairs: { field: string; oldValue: unknown; newValue: unknown }[] = [];

  // Required fields check
  if (!genome.version) errors.push('Missing version');
  if (!genome.instrument?.symbol) errors.push('Missing instrument.symbol');
  if (!genome.instrument?.timeframe) errors.push('Missing instrument.timeframe');
  if (!genome.lane) errors.push('Missing lane (TREND or RANGE)');
  if (!genome.entryModule?.family) errors.push('Missing entryModule.family');
  if (!genome.exitModule?.family) errors.push('Missing exitModule.family');

  // Bounds validation
  if (genome.regimeGate?.thresholds) {
    const { minTrendConf, minRangeConf } = genome.regimeGate.thresholds;
    if (minTrendConf !== undefined) {
      const bounds = GENOME_BOUNDS.regimeGate.minTrendConf;
      if (minTrendConf < bounds.min || minTrendConf > bounds.max) {
        if (autoRepair) {
          const newValue = Math.max(bounds.min, Math.min(bounds.max, minTrendConf));
          autoRepairs.push({ field: 'regimeGate.thresholds.minTrendConf', oldValue: minTrendConf, newValue });
        } else {
          errors.push(`regimeGate.thresholds.minTrendConf out of bounds [${bounds.min}, ${bounds.max}]`);
        }
      }
    }
    if (minRangeConf !== undefined) {
      const bounds = GENOME_BOUNDS.regimeGate.minRangeConf;
      if (minRangeConf < bounds.min || minRangeConf > bounds.max) {
        if (autoRepair) {
          const newValue = Math.max(bounds.min, Math.min(bounds.max, minRangeConf));
          autoRepairs.push({ field: 'regimeGate.thresholds.minRangeConf', oldValue: minRangeConf, newValue });
        } else {
          errors.push(`regimeGate.thresholds.minRangeConf out of bounds [${bounds.min}, ${bounds.max}]`);
        }
      }
    }
  }

  // Exit module bounds
  if (genome.exitModule?.rules) {
    const { stopLossTicks, profitTargetTicks } = genome.exitModule.rules;
    if (stopLossTicks !== undefined) {
      const bounds = GENOME_BOUNDS.exitModule.stopLossTicks;
      if (stopLossTicks < bounds.min || stopLossTicks > bounds.max) {
        if (autoRepair) {
          const newValue = Math.max(bounds.min, Math.min(bounds.max, stopLossTicks));
          autoRepairs.push({ field: 'exitModule.rules.stopLossTicks', oldValue: stopLossTicks, newValue });
        } else {
          errors.push(`exitModule.rules.stopLossTicks out of bounds [${bounds.min}, ${bounds.max}]`);
        }
      }
    }
    if (profitTargetTicks !== undefined) {
      const bounds = GENOME_BOUNDS.exitModule.profitTargetTicks;
      if (profitTargetTicks < bounds.min || profitTargetTicks > bounds.max) {
        if (autoRepair) {
          const newValue = Math.max(bounds.min, Math.min(bounds.max, profitTargetTicks));
          autoRepairs.push({ field: 'exitModule.rules.profitTargetTicks', oldValue: profitTargetTicks, newValue });
        } else {
          errors.push(`exitModule.rules.profitTargetTicks out of bounds [${bounds.min}, ${bounds.max}]`);
        }
      }
    }
  }

  // Safety checks
  if (genome.constraints) {
    if (!genome.constraints.noMartingale) {
      warnings.push('Martingale strategies are risky - consider enabling noMartingale constraint');
    }
    if (genome.constraints.maxLeverage && genome.constraints.maxLeverage > 5) {
      warnings.push('High leverage detected - consider reducing maxLeverage');
    }
  }

  // Dependency validation
  if (genome.filters?.newsFilter?.enabled) {
    warnings.push('News filter enabled - ensure economic calendar integration is configured');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    autoRepairs: autoRepair ? autoRepairs : undefined,
  };
}

/**
 * Create a default genome with sensible defaults
 */
export function createDefaultGenome(overrides: Partial<Genome> = {}): Genome {
  return {
    version: '1.0',
    instrument: {
      symbol: 'MES',
      market: 'CME',
      contractType: 'MICRO',
      timeframe: '5m',
    },
    lane: 'TREND',
    regimeGate: {
      regimeModel: 'RULED',
      outputs: ['TREND', 'RANGE', 'AVOID'],
      thresholds: {
        minTrendConf: 0.6,
        minRangeConf: 0.6,
        avoidVolatility: 2.0,
      },
      features: {
        atrWindow: 14,
        trendSlopeWindow: 20,
        compressionWindow: 20,
      },
    },
    entryModule: {
      family: 'VWAP_RECLAIM',
      rules: {},
      confirmations: {
        minConfluence: 2,
        momentumCheck: true,
        volumeCheck: false,
      },
    },
    exitModule: {
      family: 'BRACKET',
      rules: {
        stopLossTicks: 12,
        profitTargetTicks: 24,
        invalidationExit: true,
      },
    },
    riskModule: {
      sizingModel: 'FIXED',
      rules: {
        maxTradesPerDay: 5,
        dailyLossLock: 500,
        maxConcurrent: 1,
        cooldownMins: 15,
      },
    },
    filters: {
      timeWindows: [{ start: '09:30', end: '16:00', tz: 'America/New_York' }],
      volatilityBand: {
        atrMinPct: 0.3,
        atrMaxPct: 2.5,
      },
      newsFilter: {
        enabled: false,
        minutesBefore: 15,
        minutesAfter: 15,
      },
      spreadSlippageGuard: {
        maxSpread: 4,
        maxSlipTicks: 2,
      },
    },
    executionAssumptions: {
      slippageModel: 'REALISTIC',
      latencyBucket: 'MEDIUM',
      fillModel: 'QUEUE',
    },
    constraints: {
      noMartingale: true,
      maxLeverage: 2,
      maxRiskPerTrade: 1.5,
    },
    metadata: {
      name: 'Unnamed Genome',
      tags: [],
      createdBy: 'AI',
    },
    ...overrides,
  };
}

/**
 * Get the timeframe bucket for speciation (groups adjacent timeframes)
 */
export function getTimeframeBucket(timeframe: string): string {
  const buckets: Record<string, string> = {
    '1m': 'SCALP',
    '5m': 'SCALP',
    '15m': 'INTRADAY',
    '1h': 'INTRADAY',
    '4h': 'SWING',
    '1d': 'SWING',
  };
  return buckets[timeframe] || 'UNKNOWN';
}
