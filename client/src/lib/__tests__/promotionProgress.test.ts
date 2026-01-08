import { describe, it, expect } from 'vitest';
import { computePromotionProgress, getMissingGates } from '../promotionProgress';
import { DEFAULT_PROMOTION_RULES, MetricsRollup } from '../promotionEngine';

function createBaseMetrics(): MetricsRollup {
  return {
    trades: 20,
    winRate: 55,
    sharpe: 0.5,
    profitFactor: 1.0,
    expectancy: 10,
    maxDdPct: 5,
    activeDays: 5,
    lastTradeAt: new Date().toISOString(),
  };
}

describe('promotionProgress', () => {
  describe('computePromotionProgress', () => {
    it('returns null target for LIVE stage', () => {
      const result = computePromotionProgress({
        currentStage: 'LIVE',
        healthState: 'OK',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: null,
        lastBacktestStatus: null,
      });
      
      expect(result.targetStage).toBeNull();
    });

    it('returns PAPER as target for LAB stage', () => {
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      expect(result.targetStage).toBe('PAPER');
    });

    it('blocks progress when health is DEGRADED', () => {
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'DEGRADED',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: null,
        lastBacktestStatus: null,
      });
      
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('Health');
      expect(result.percent).toBe(0);
    });

    it('progress increases when trades increase', () => {
      const lowTrades = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: { ...createBaseMetrics(), trades: 10 },
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      const highTrades = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: { ...createBaseMetrics(), trades: 30 },
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      expect(highTrades.percent).toBeGreaterThan(lowTrades.percent);
    });

    it('progress decreases when drawdown rises past cap', () => {
      const lowDD = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: { ...createBaseMetrics(), maxDdPct: 3 },
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      const highDD = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: { ...createBaseMetrics(), maxDdPct: 10 },
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      expect(highDD.percent).toBeLessThan(lowDD.percent);
    });

    it('WARN health applies multiplier and reduces progress', () => {
      const okHealth = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      const warnHealth = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'WARN',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      expect(warnHealth.percent).toBeLessThan(okHealth.percent);
      // Should be roughly 70% of OK health progress
      expect(warnHealth.percent).toBeCloseTo(okHealth.percent * 0.7, 0);
    });

    it('missing backtest coverage sets g_bt=0 and reduces score', () => {
      const withBacktest = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      const withoutBacktest = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: null,
        lastBacktestStatus: null,
      });
      
      expect(withoutBacktest.gates.backtest.score).toBe(0);
      expect(withoutBacktest.percent).toBeLessThan(withBacktest.percent);
    });

    it('progress never hits 100 unless all gates pass', () => {
      // Create metrics that pass all gates
      const perfectMetrics: MetricsRollup = {
        trades: 50,
        winRate: 60,
        sharpe: 1.0,
        profitFactor: 1.5,
        expectancy: 20,
        maxDdPct: 3,
        activeDays: 10,
        lastTradeAt: new Date().toISOString(),
      };
      
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: perfectMetrics,
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      // All gates should pass
      expect(result.gates.trades.pass).toBe(true);
      expect(result.gates.sharpe.pass).toBe(true);
      expect(result.gates.pf.pass).toBe(true);
      expect(result.gates.dd.pass).toBe(true);
      expect(result.gates.backtest.pass).toBe(true);
      expect(result.gates.health.pass).toBe(true);
      
      // Should be 100%
      expect(result.percent).toBe(100);
    });

    it('partial metrics result in partial progress', () => {
      // Some gates pass, some don't
      const partialMetrics: MetricsRollup = {
        trades: 15, // < 30 required
        winRate: 55,
        sharpe: 0.7, // > 0.6 required ✓
        profitFactor: 1.2, // > 1.1 required ✓
        expectancy: 5,
        maxDdPct: 4, // < 8% required ✓
        activeDays: 2, // < 3 required
        lastTradeAt: new Date().toISOString(),
      };
      
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: partialMetrics,
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      expect(result.percent).toBeGreaterThan(0);
      expect(result.percent).toBeLessThan(100);
      expect(result.gates.trades.pass).toBe(false);
      expect(result.gates.sharpe.pass).toBe(true);
      expect(result.gates.pf.pass).toBe(true);
    });
  });

  describe('getMissingGates', () => {
    it('returns block reason when blocked', () => {
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'DEGRADED',
        rollup30: createBaseMetrics(),
        lastBacktestCompletedAt: null,
        lastBacktestStatus: null,
      });
      
      const missing = getMissingGates(result);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toContain('Health');
    });

    it('lists all failing gates', () => {
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: { ...createBaseMetrics(), trades: 10, sharpe: 0.3 },
        lastBacktestCompletedAt: null,
        lastBacktestStatus: null,
      });
      
      const missing = getMissingGates(result);
      expect(missing.some(m => m.includes('Trades'))).toBe(true);
      expect(missing.some(m => m.includes('Sharpe'))).toBe(true);
      expect(missing.some(m => m.includes('Backtest'))).toBe(true);
    });

    it('returns empty array when all gates pass', () => {
      const perfectMetrics: MetricsRollup = {
        trades: 50,
        winRate: 60,
        sharpe: 1.0,
        profitFactor: 1.5,
        expectancy: 20,
        maxDdPct: 3,
        activeDays: 10,
        lastTradeAt: new Date().toISOString(),
      };
      
      const result = computePromotionProgress({
        currentStage: 'TRIALS',
        healthState: 'OK',
        rollup30: perfectMetrics,
        lastBacktestCompletedAt: new Date().toISOString(),
        lastBacktestStatus: 'completed',
      });
      
      const missing = getMissingGates(result);
      expect(missing).toHaveLength(0);
    });
  });
});
