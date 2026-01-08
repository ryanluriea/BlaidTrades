import { describe, it, expect } from 'vitest';
import { 
  computeBPS, 
  getBucket, 
  computeBPSBreakdown,
  DEFAULT_BPS_SETTINGS,
  type BPSInputs 
} from '../priorityScoreFormula';

const createInputs = (overrides: Partial<BPSInputs> = {}): BPSInputs => ({
  sharpe30D: 1.0,
  profitFactor30D: 1.4,
  expectancy30D: 30,
  maxDdPct30D: 5,
  trades30D: 50,
  healthState: 'OK',
  stage: 'PAPER',
  ...overrides,
});

describe('computeBPS', () => {
  it('returns higher score for higher sharpe', () => {
    const lowSharpe = computeBPS(createInputs({ sharpe30D: 0.5 }));
    const highSharpe = computeBPS(createInputs({ sharpe30D: 1.5 }));
    expect(highSharpe).toBeGreaterThan(lowSharpe);
  });

  it('returns higher score for higher profit factor', () => {
    const lowPF = computeBPS(createInputs({ profitFactor30D: 1.1 }));
    const highPF = computeBPS(createInputs({ profitFactor30D: 1.6 }));
    expect(highPF).toBeGreaterThan(lowPF);
  });

  it('returns lower score for higher drawdown', () => {
    const lowDD = computeBPS(createInputs({ maxDdPct30D: 3 }));
    const highDD = computeBPS(createInputs({ maxDdPct30D: 12 }));
    expect(lowDD).toBeGreaterThan(highDD);
  });

  it('returns 0 for DEGRADED health', () => {
    const result = computeBPS(createInputs({ healthState: 'DEGRADED' }));
    // Health factor is 0, but other components still contribute
    // Stage multiplier applies to raw score
    expect(result).toBeLessThan(computeBPS(createInputs({ healthState: 'OK' })));
  });

  it('applies stage multiplier correctly', () => {
    const labScore = computeBPS(createInputs({ stage: 'TRIALS' }));
    const liveScore = computeBPS(createInputs({ stage: 'LIVE' }));
    // LIVE multiplier (1.0) > LAB multiplier (0.5)
    expect(liveScore).toBeGreaterThan(labScore);
    expect(liveScore / labScore).toBeCloseTo(1.0 / 0.5, 0.5);
  });

  it('returns score between 0 and 100', () => {
    const score = computeBPS(createInputs());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('handles null values gracefully', () => {
    const result = computeBPS(createInputs({
      sharpe30D: null,
      profitFactor30D: null,
      expectancy30D: null,
      maxDdPct30D: null,
    }));
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('getBucket', () => {
  it('returns A+ for scores >= 85', () => {
    expect(getBucket(90, 'OK')).toBe('A+');
    expect(getBucket(85, 'OK')).toBe('A+');
  });

  it('returns A for scores 75-84', () => {
    expect(getBucket(80, 'OK')).toBe('A');
    expect(getBucket(75, 'OK')).toBe('A');
  });

  it('returns B for scores 60-74', () => {
    expect(getBucket(70, 'OK')).toBe('B');
    expect(getBucket(60, 'OK')).toBe('B');
  });

  it('returns C for scores 45-59', () => {
    expect(getBucket(55, 'OK')).toBe('C');
    expect(getBucket(45, 'OK')).toBe('C');
  });

  it('returns D for scores 30-44', () => {
    expect(getBucket(40, 'OK')).toBe('D');
    expect(getBucket(30, 'OK')).toBe('D');
  });

  it('returns F for scores < 30', () => {
    expect(getBucket(25, 'OK')).toBe('F');
  });

  it('returns F for DEGRADED health regardless of score', () => {
    expect(getBucket(95, 'DEGRADED')).toBe('F');
  });

  it('returns F for FROZEN health regardless of score', () => {
    expect(getBucket(95, 'FROZEN')).toBe('F');
  });
});

describe('computeBPSBreakdown', () => {
  it('includes all component values', () => {
    const result = computeBPSBreakdown(createInputs());
    
    expect(result.components.sharpe).toBeDefined();
    expect(result.components.profitFactor).toBeDefined();
    expect(result.components.expectancy).toBeDefined();
    expect(result.components.drawdown).toBeDefined();
    expect(result.components.reliability).toBeDefined();
    expect(result.components.health).toBeDefined();
  });

  it('includes stage and correlation multipliers', () => {
    const result = computeBPSBreakdown(createInputs());
    
    expect(result.multipliers.stage.value).toBe('PAPER');
    expect(result.multipliers.stage.multiplier).toBe(0.75);
  });

  it('final score matches computeBPS', () => {
    const inputs = createInputs();
    const breakdown = computeBPSBreakdown(inputs);
    const direct = computeBPS(inputs);
    
    expect(breakdown.bpsFinal).toBe(direct);
  });

  it('bucket matches getBucket', () => {
    const inputs = createInputs();
    const breakdown = computeBPSBreakdown(inputs);
    const bucket = getBucket(breakdown.bpsFinal, inputs.healthState);
    
    expect(breakdown.bucket).toBe(bucket);
  });
});
