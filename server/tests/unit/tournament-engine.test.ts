/**
 * Tournament Engine Unit Tests
 * 
 * Tests for fitness scoring calculations, action determination,
 * and threshold validation.
 */

import { describe, it, expect } from 'vitest';

// Replicate fitness weights from tournament-engine.ts
const FITNESS_WEIGHTS = {
  sharpe: 0.30,
  profitFactor: 0.25,
  winRate: 0.20,
  drawdown: 0.15,
  consistency: 0.10,
};

// Replicate thresholds from tournament-engine.ts
const INCREMENTAL_THRESHOLDS = {
  minSharpeRatio: 0.5,
  minProfitFactor: 1.2,
  minWinRate: 0.45,
  maxDrawdownPct: 0.15,
};

const DAILY_MAJOR_THRESHOLDS = {
  minSharpeRatio: 0.8,
  minProfitFactor: 1.5,
  minWinRate: 0.50,
  maxDrawdownPct: 0.10,
};

interface FitnessMetrics {
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  maxDrawdownPct: number;
  consistencyScore: number;
}

function calculateFitnessV2(metrics: Partial<FitnessMetrics>): number {
  const sharpe = Math.max(0, Math.min(3, metrics.sharpeRatio || 0));
  const profitFactor = Math.max(0, Math.min(5, metrics.profitFactor || 1));
  const winRate = Math.max(0, Math.min(1, metrics.winRate || 0.5));
  const maxDrawdown = Math.max(0, Math.min(1, metrics.maxDrawdownPct || 0.1));
  const consistency = Math.max(0, Math.min(1, metrics.consistencyScore || 0.5));
  
  const sharpeNorm = sharpe / 3;
  const pfNorm = Math.min(1, Math.max(0, (profitFactor - 1) / 4));
  const winRateNorm = winRate;
  const drawdownNorm = Math.max(0, Math.min(1, 1 - maxDrawdown));
  const consistencyNorm = consistency;
  
  const fitness = 
    (sharpeNorm * FITNESS_WEIGHTS.sharpe) +
    (pfNorm * FITNESS_WEIGHTS.profitFactor) +
    (winRateNorm * FITNESS_WEIGHTS.winRate) +
    (drawdownNorm * FITNESS_WEIGHTS.drawdown) +
    (consistencyNorm * FITNESS_WEIGHTS.consistency);
  
  return Math.max(0, Math.min(1, Math.round(fitness * 10000) / 10000));
}

function checkThresholds(
  metrics: FitnessMetrics, 
  thresholds: typeof INCREMENTAL_THRESHOLDS
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  
  if (metrics.sharpeRatio < thresholds.minSharpeRatio) {
    failures.push(`Sharpe ${metrics.sharpeRatio.toFixed(2)} < ${thresholds.minSharpeRatio}`);
  }
  if (metrics.profitFactor < thresholds.minProfitFactor) {
    failures.push(`PF ${metrics.profitFactor.toFixed(2)} < ${thresholds.minProfitFactor}`);
  }
  if (metrics.winRate < thresholds.minWinRate) {
    failures.push(`WR ${(metrics.winRate * 100).toFixed(1)}% < ${thresholds.minWinRate * 100}%`);
  }
  if (metrics.maxDrawdownPct > thresholds.maxDrawdownPct) {
    failures.push(`DD ${(metrics.maxDrawdownPct * 100).toFixed(1)}% > ${thresholds.maxDrawdownPct * 100}%`);
  }
  
  return { passed: failures.length === 0, failures };
}

describe('Fitness Score Calculation', () => {
  describe('calculateFitnessV2', () => {
    it('should return value between 0 and 1 for normal inputs', () => {
      const fitness = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 0.08,
        consistencyScore: 0.7,
      });
      
      expect(fitness).toBeGreaterThanOrEqual(0);
      expect(fitness).toBeLessThanOrEqual(1);
    });

    it('should return low score for worst case inputs', () => {
      const fitness = calculateFitnessV2({
        sharpeRatio: 0,
        profitFactor: 0,
        winRate: 0,
        maxDrawdownPct: 1.0,
        consistencyScore: 0,
      });
      
      expect(fitness).toBeGreaterThanOrEqual(0);
      expect(fitness).toBeLessThanOrEqual(0.2);
    });

    it('should return high value for excellent metrics', () => {
      const fitness = calculateFitnessV2({
        sharpeRatio: 3.0,
        profitFactor: 5.0,
        winRate: 1.0,
        maxDrawdownPct: 0.0,
        consistencyScore: 1.0,
      });
      
      expect(fitness).toBeGreaterThanOrEqual(0.9);
      expect(fitness).toBeLessThanOrEqual(1);
    });

    it('should clamp negative sharpe ratio to 0', () => {
      const fitnessNegative = calculateFitnessV2({
        sharpeRatio: -2.0,
        profitFactor: 2.0,
        winRate: 0.6,
        maxDrawdownPct: 0.05,
        consistencyScore: 0.8,
      });

      const fitnessZero = calculateFitnessV2({
        sharpeRatio: 0,
        profitFactor: 2.0,
        winRate: 0.6,
        maxDrawdownPct: 0.05,
        consistencyScore: 0.8,
      });

      expect(fitnessNegative).toBe(fitnessZero);
    });

    it('should clamp profit factor below 1 correctly', () => {
      const fitness = calculateFitnessV2({
        sharpeRatio: 1.0,
        profitFactor: 0.5,
        winRate: 0.5,
        maxDrawdownPct: 0.1,
        consistencyScore: 0.5,
      });

      expect(fitness).toBeGreaterThanOrEqual(0);
      expect(fitness).toBeLessThanOrEqual(1);
    });

    it('should handle extreme drawdown values', () => {
      const fitnessHighDD = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 1.5,
        consistencyScore: 0.7,
      });

      expect(fitnessHighDD).toBeGreaterThanOrEqual(0);
      expect(fitnessHighDD).toBeLessThanOrEqual(1);
    });

    it('should handle missing metrics with defaults', () => {
      const fitness = calculateFitnessV2({});
      
      expect(fitness).toBeGreaterThanOrEqual(0);
      expect(fitness).toBeLessThanOrEqual(1);
    });

    it('should give higher score to better drawdown', () => {
      const lowDD = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 0.02,
        consistencyScore: 0.7,
      });

      const highDD = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 0.25,
        consistencyScore: 0.7,
      });

      expect(lowDD).toBeGreaterThan(highDD);
    });

    it('should give higher score to better sharpe ratio', () => {
      const highSharpe = calculateFitnessV2({
        sharpeRatio: 2.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 0.1,
        consistencyScore: 0.7,
      });

      const lowSharpe = calculateFitnessV2({
        sharpeRatio: 0.5,
        profitFactor: 2.0,
        winRate: 0.55,
        maxDrawdownPct: 0.1,
        consistencyScore: 0.7,
      });

      expect(highSharpe).toBeGreaterThan(lowSharpe);
    });

    it('should give higher score to better profit factor', () => {
      const highPF = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 4.0,
        winRate: 0.55,
        maxDrawdownPct: 0.1,
        consistencyScore: 0.7,
      });

      const lowPF = calculateFitnessV2({
        sharpeRatio: 1.5,
        profitFactor: 1.1,
        winRate: 0.55,
        maxDrawdownPct: 0.1,
        consistencyScore: 0.7,
      });

      expect(highPF).toBeGreaterThan(lowPF);
    });
  });
});

describe('Tournament Thresholds', () => {
  describe('Incremental tournament thresholds', () => {
    it('should pass bot with good metrics', () => {
      const result = checkThresholds({
        sharpeRatio: 1.0,
        profitFactor: 1.5,
        winRate: 0.55,
        maxDrawdownPct: 0.08,
        consistencyScore: 0.7,
      }, INCREMENTAL_THRESHOLDS);

      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should fail bot with low sharpe', () => {
      const result = checkThresholds({
        sharpeRatio: 0.3,
        profitFactor: 1.5,
        winRate: 0.55,
        maxDrawdownPct: 0.08,
        consistencyScore: 0.7,
      }, INCREMENTAL_THRESHOLDS);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Sharpe'))).toBe(true);
    });

    it('should fail bot with high drawdown', () => {
      const result = checkThresholds({
        sharpeRatio: 1.0,
        profitFactor: 1.5,
        winRate: 0.55,
        maxDrawdownPct: 0.20,
        consistencyScore: 0.7,
      }, INCREMENTAL_THRESHOLDS);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('DD'))).toBe(true);
    });

    it('should fail bot with low profit factor', () => {
      const result = checkThresholds({
        sharpeRatio: 1.0,
        profitFactor: 1.0,
        winRate: 0.55,
        maxDrawdownPct: 0.08,
        consistencyScore: 0.7,
      }, INCREMENTAL_THRESHOLDS);

      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('PF'))).toBe(true);
    });

    it('should accumulate multiple failures', () => {
      const result = checkThresholds({
        sharpeRatio: 0.2,
        profitFactor: 0.8,
        winRate: 0.30,
        maxDrawdownPct: 0.25,
        consistencyScore: 0.7,
      }, INCREMENTAL_THRESHOLDS);

      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Daily major tournament thresholds', () => {
    it('should be stricter than incremental thresholds', () => {
      expect(DAILY_MAJOR_THRESHOLDS.minSharpeRatio).toBeGreaterThan(INCREMENTAL_THRESHOLDS.minSharpeRatio);
      expect(DAILY_MAJOR_THRESHOLDS.minProfitFactor).toBeGreaterThan(INCREMENTAL_THRESHOLDS.minProfitFactor);
      expect(DAILY_MAJOR_THRESHOLDS.minWinRate).toBeGreaterThan(INCREMENTAL_THRESHOLDS.minWinRate);
      expect(DAILY_MAJOR_THRESHOLDS.maxDrawdownPct).toBeLessThan(INCREMENTAL_THRESHOLDS.maxDrawdownPct);
    });

    it('should fail bot that passes incremental but not daily', () => {
      const metrics: FitnessMetrics = {
        sharpeRatio: 0.6,
        profitFactor: 1.3,
        winRate: 0.47,
        maxDrawdownPct: 0.12,
        consistencyScore: 0.7,
      };

      const incrementalResult = checkThresholds(metrics, INCREMENTAL_THRESHOLDS);
      const dailyResult = checkThresholds(metrics, DAILY_MAJOR_THRESHOLDS);

      expect(incrementalResult.passed).toBe(true);
      expect(dailyResult.passed).toBe(false);
    });
  });
});

describe('Fitness Weight Distribution', () => {
  it('should have weights that sum to 1.0', () => {
    const totalWeight = 
      FITNESS_WEIGHTS.sharpe +
      FITNESS_WEIGHTS.profitFactor +
      FITNESS_WEIGHTS.winRate +
      FITNESS_WEIGHTS.drawdown +
      FITNESS_WEIGHTS.consistency;

    expect(totalWeight).toBeCloseTo(1.0, 4);
  });

  it('should prioritize sharpe ratio as highest weight', () => {
    expect(FITNESS_WEIGHTS.sharpe).toBeGreaterThan(FITNESS_WEIGHTS.profitFactor);
    expect(FITNESS_WEIGHTS.sharpe).toBeGreaterThan(FITNESS_WEIGHTS.winRate);
    expect(FITNESS_WEIGHTS.sharpe).toBeGreaterThan(FITNESS_WEIGHTS.drawdown);
    expect(FITNESS_WEIGHTS.sharpe).toBeGreaterThan(FITNESS_WEIGHTS.consistency);
  });
});
