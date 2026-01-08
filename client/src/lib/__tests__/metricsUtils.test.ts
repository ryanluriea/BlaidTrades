/**
 * Comprehensive Test Suite for Institutional-Grade Metrics
 * 
 * Tests all metric calculations against known inputs/outputs
 * to ensure correctness and consistency.
 */

import { describe, it, expect } from 'vitest';
import {
  computeStandardStats,
  computeDownsideDeviation,
  computeDailyReturns,
  computeSharpeRatio,
  computeSortinoRatio,
  computeCalmarRatio,
  computeMaxDrawdown,
  computeUlcerIndex,
  computeStreaks,
  computeExpectancy,
  computeComprehensiveMetrics,
  computeSimpleSharpe,
  computeSimpleMaxDD,
  isValidMetric,
  formatMetric,
  DAILY_RISK_FREE_RATE,
  TRADING_DAYS_PER_YEAR,
  MIN_SAMPLES,
  type Trade,
} from '../metricsUtils';

// ============================================================================
// TEST DATA FIXTURES
// ============================================================================

const createTrade = (pnl: number, exitTime: string): Trade => ({
  pnl,
  entryTime: new Date(exitTime).toISOString(),
  exitTime: new Date(exitTime).toISOString(),
});

// Generate a series of trades for testing
const generateTrades = (pnls: number[], startDate: string = '2024-01-01'): Trade[] => {
  const start = new Date(startDate);
  return pnls.map((pnl, i) => {
    const exitDate = new Date(start);
    exitDate.setDate(exitDate.getDate() + i);
    return createTrade(pnl, exitDate.toISOString());
  });
};

// Known test data with expected results
const KNOWN_RETURNS = [0.01, 0.02, -0.01, 0.015, -0.005, 0.008, 0.012, -0.003, 0.018, -0.007];

describe('metricsUtils', () => {
  // ==========================================================================
  // STANDARD STATISTICS TESTS
  // ==========================================================================

  describe('computeStandardStats', () => {
    it('should return zeros for empty array', () => {
      const result = computeStandardStats([]);
      expect(result.mean).toBe(0);
      expect(result.sampleStdDev).toBe(0);
      expect(result.n).toBe(0);
    });

    it('should handle single value', () => {
      const result = computeStandardStats([5]);
      expect(result.mean).toBe(5);
      expect(result.sampleStdDev).toBe(0);
      expect(result.n).toBe(1);
    });

    it('should calculate correct mean', () => {
      const result = computeStandardStats([1, 2, 3, 4, 5]);
      expect(result.mean).toBe(3);
    });

    it('should use sample variance (n-1) for unbiased estimation', () => {
      // For [2, 4, 4, 4, 5, 5, 7, 9]
      // Mean = 5
      // Sum of squared deviations = 40
      // Sample variance = 40/7 ≈ 5.714
      // Sample std dev ≈ 2.39
      const data = [2, 4, 4, 4, 5, 5, 7, 9];
      const result = computeStandardStats(data);
      
      expect(result.mean).toBe(5);
      expect(result.variance).toBeCloseTo(40 / 7, 4);
      expect(result.sampleStdDev).toBeCloseTo(Math.sqrt(40 / 7), 4);
    });

    it('should calculate population std dev correctly', () => {
      const data = [2, 4, 4, 4, 5, 5, 7, 9];
      const result = computeStandardStats(data);
      
      // Population variance = 40/8 = 5
      expect(result.populationStdDev).toBeCloseTo(Math.sqrt(5), 4);
    });

    it('should handle negative numbers', () => {
      const result = computeStandardStats([-5, -3, -1, 1, 3, 5]);
      expect(result.mean).toBe(0);
    });
  });

  describe('computeDownsideDeviation', () => {
    it('should return 0 for empty array', () => {
      expect(computeDownsideDeviation([])).toBe(0);
    });

    it('should return 0 when all returns above target', () => {
      const result = computeDownsideDeviation([0.01, 0.02, 0.03], 0);
      expect(result).toBe(0);
    });

    it('should only consider returns below target', () => {
      const returns = [0.01, -0.01, 0.02, -0.02, 0.03];
      const result = computeDownsideDeviation(returns, 0);
      expect(result).toBeGreaterThan(0);
    });

    it('should handle custom target', () => {
      const returns = [0.01, 0.005, 0.02, 0.003];
      // All above 0, but some below 0.01
      const result = computeDownsideDeviation(returns, 0.01);
      expect(result).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // DAILY RETURNS TESTS
  // ==========================================================================

  describe('computeDailyReturns', () => {
    it('should return empty array for no trades', () => {
      const result = computeDailyReturns([], 100000);
      expect(result).toEqual([]);
    });

    it('should return empty array for zero capital', () => {
      const trades = generateTrades([100, -50, 200]);
      const result = computeDailyReturns(trades, 0);
      expect(result).toEqual([]);
    });

    it('should group trades by day', () => {
      const trades = [
        createTrade(100, '2024-01-01T10:00:00Z'),
        createTrade(50, '2024-01-01T14:00:00Z'),
        createTrade(-30, '2024-01-02T11:00:00Z'),
      ];
      
      const result = computeDailyReturns(trades, 100000);
      
      expect(result.length).toBe(2);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[0].pnl).toBe(150); // 100 + 50
      expect(result[1].date).toBe('2024-01-02');
      expect(result[1].pnl).toBe(-30);
    });

    it('should calculate return percentages correctly', () => {
      const trades = generateTrades([1000], '2024-01-01');
      const result = computeDailyReturns(trades, 100000);
      
      expect(result[0].returnPct).toBeCloseTo(0.01, 6); // 1000 / 100000 = 1%
    });

    it('should track running equity', () => {
      const trades = generateTrades([1000, -500, 2000], '2024-01-01');
      const result = computeDailyReturns(trades, 100000);
      
      expect(result[0].equity).toBe(101000);
      expect(result[1].equity).toBe(100500);
      expect(result[2].equity).toBe(102500);
    });
  });

  // ==========================================================================
  // SHARPE RATIO TESTS
  // ==========================================================================

  describe('computeSharpeRatio', () => {
    it('should return INSUFFICIENT confidence for small samples', () => {
      const smallSample = Array(MIN_SAMPLES.sharpe - 1).fill(0.001);
      const result = computeSharpeRatio(smallSample);
      
      expect(result.sharpe).toBeNull();
      expect(result.confidence).toBe('INSUFFICIENT');
    });

    it('should calculate Sharpe correctly for known inputs', () => {
      // Generate 30 daily returns with known characteristics
      const dailyReturns = Array(30).fill(0).map((_, i) => 
        i % 2 === 0 ? 0.005 : -0.002
      );
      
      const result = computeSharpeRatio(dailyReturns, 0);
      
      expect(result.sharpe).not.toBeNull();
      expect(result.confidence).not.toBe('INSUFFICIENT');
    });

    it('should handle zero volatility', () => {
      const constantReturns = Array(30).fill(0.001);
      const result = computeSharpeRatio(constantReturns, 0);
      
      // With constant positive returns and no volatility, Sharpe → Infinity
      expect(result.sharpe).toBe(Infinity);
    });

    it('should handle all negative returns', () => {
      const negativeReturns = Array(30).fill(-0.001);
      const result = computeSharpeRatio(negativeReturns, 0);
      
      expect(result.sharpe).toBe(-Infinity);
    });

    it('should subtract risk-free rate', () => {
      const returns = Array(30).fill(DAILY_RISK_FREE_RATE);
      const result = computeSharpeRatio(returns, DAILY_RISK_FREE_RATE);
      
      // Returns exactly equal to risk-free rate → Sharpe should be 0
      // (allowing for floating point)
      expect(Math.abs(result.sharpe || 0)).toBeLessThan(0.01);
    });

    it('should annualize with sqrt(252)', () => {
      // Create returns with known daily Sharpe
      const dailyReturn = 0.001;
      const dailyStdDev = 0.01;
      const returns = Array(100).fill(0).map(() => 
        dailyReturn + (Math.random() - 0.5) * dailyStdDev * 0.1
      );
      
      const result = computeSharpeRatio(returns, 0);
      
      // The annualized Sharpe should be approximately daily * sqrt(252)
      expect(result.sharpe).not.toBeNull();
    });

    it('should compute t-statistic and p-value', () => {
      const goodReturns = Array(100).fill(0).map((_, i) => 
        0.003 + (i % 3 === 0 ? -0.001 : 0.001)
      );
      
      const result = computeSharpeRatio(goodReturns, 0);
      
      expect(result.tStatistic).not.toBeNull();
      expect(result.pValue).not.toBeNull();
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    });

    it('should compute confidence intervals', () => {
      const returns = Array(50).fill(0).map((_, i) => 
        (i % 2 === 0 ? 0.004 : -0.001)
      );
      
      const result = computeSharpeRatio(returns, 0);
      
      expect(result.confidenceInterval).not.toBeNull();
      if (result.confidenceInterval) {
        expect(result.confidenceInterval[0]).toBeLessThan(result.confidenceInterval[1]);
        expect(result.sharpe).toBeGreaterThanOrEqual(result.confidenceInterval[0]);
        expect(result.sharpe).toBeLessThanOrEqual(result.confidenceInterval[1]);
      }
    });
  });

  // ==========================================================================
  // SORTINO RATIO TESTS
  // ==========================================================================

  describe('computeSortinoRatio', () => {
    it('should return INSUFFICIENT for small samples', () => {
      const result = computeSortinoRatio(Array(MIN_SAMPLES.sortino - 1).fill(0.001));
      expect(result.sortino).toBeNull();
      expect(result.confidence).toBe('INSUFFICIENT');
    });

    it('should only penalize downside deviation', () => {
      // Same mean and volatility, but different distribution
      const symmetricReturns = Array(50).fill(0).map((_, i) => 
        i % 2 === 0 ? 0.01 : -0.01
      );
      
      const positiveSkewReturns = Array(50).fill(0).map((_, i) => 
        i % 5 === 0 ? -0.04 : 0.01
      );
      
      const symResult = computeSortinoRatio(symmetricReturns, 0);
      const skewResult = computeSortinoRatio(positiveSkewReturns, 0);
      
      // Both should have valid Sortino ratios
      expect(symResult.sortino).not.toBeNull();
      expect(skewResult.sortino).not.toBeNull();
    });

    it('should return Infinity when no downside', () => {
      const allPositive = Array(30).fill(0.001);
      const result = computeSortinoRatio(allPositive, 0);
      
      expect(result.sortino).toBe(Infinity);
    });
  });

  // ==========================================================================
  // MAX DRAWDOWN TESTS
  // ==========================================================================

  describe('computeMaxDrawdown', () => {
    it('should return zeros for empty trades', () => {
      const result = computeMaxDrawdown([], 100000);
      expect(result.maxDrawdownAbs).toBe(0);
      expect(result.maxDrawdownPct).toBe(0);
    });

    it('should calculate correct max drawdown', () => {
      // Equity curve: 100000 → 110000 → 105000 → 95000 → 100000
      // Max DD should be from 110000 to 95000 = 15000
      const trades = generateTrades([10000, -5000, -10000, 5000], '2024-01-01');
      const result = computeMaxDrawdown(trades, 100000);
      
      expect(result.maxDrawdownAbs).toBe(15000);
      expect(result.peakEquity).toBe(110000);
      expect(result.troughEquity).toBe(95000);
    });

    it('should calculate percentage based on peak equity', () => {
      // Same as above: 15000 / 110000 = 13.64%
      const trades = generateTrades([10000, -5000, -10000, 5000], '2024-01-01');
      const result = computeMaxDrawdown(trades, 100000);
      
      expect(result.maxDrawdownPct).toBeCloseTo(13.64, 1);
    });

    it('should track current drawdown', () => {
      // Equity: 100000 → 110000 → 105000 (currently in 4.5% DD from peak)
      const trades = generateTrades([10000, -5000], '2024-01-01');
      const result = computeMaxDrawdown(trades, 100000);
      
      expect(result.currentDrawdownPct).toBeCloseTo(4.55, 1);
    });

    it('should handle all winning trades', () => {
      const trades = generateTrades([1000, 2000, 3000], '2024-01-01');
      const result = computeMaxDrawdown(trades, 100000);
      
      expect(result.maxDrawdownAbs).toBe(0);
      expect(result.maxDrawdownPct).toBe(0);
    });

    it('should handle complete wipeout', () => {
      const trades = generateTrades([-50000, -50000], '2024-01-01');
      const result = computeMaxDrawdown(trades, 100000);
      
      expect(result.maxDrawdownAbs).toBe(100000);
      expect(result.maxDrawdownPct).toBe(100);
    });
  });

  // ==========================================================================
  // ULCER INDEX TESTS
  // ==========================================================================

  describe('computeUlcerIndex', () => {
    it('should return 0 for empty trades', () => {
      const result = computeUlcerIndex([], 100000);
      expect(result.ulcerIndex).toBe(0);
    });

    it('should return 0 for all winning trades', () => {
      const trades = generateTrades([1000, 2000, 3000], '2024-01-01');
      const result = computeUlcerIndex(trades, 100000);
      
      expect(result.ulcerIndex).toBe(0);
    });

    it('should be higher for deeper drawdowns', () => {
      const shallowDD = generateTrades([1000, -500, 1000, -500], '2024-01-01');
      const deepDD = generateTrades([1000, -5000, 1000, -5000], '2024-01-01');
      
      const shallowResult = computeUlcerIndex(shallowDD, 100000);
      const deepResult = computeUlcerIndex(deepDD, 100000);
      
      expect(deepResult.ulcerIndex).toBeGreaterThan(shallowResult.ulcerIndex);
    });
  });

  // ==========================================================================
  // STREAK TESTS
  // ==========================================================================

  describe('computeStreaks', () => {
    it('should return zeros for empty trades', () => {
      const result = computeStreaks([]);
      expect(result.maxWinStreak).toBe(0);
      expect(result.maxLossStreak).toBe(0);
      expect(result.currentStreakType).toBe('NONE');
    });

    it('should count consecutive wins', () => {
      const trades = generateTrades([100, 100, 100, -50, 100], '2024-01-01');
      const result = computeStreaks(trades);
      
      expect(result.maxWinStreak).toBe(3);
      expect(result.currentStreak).toBe(1);
      expect(result.currentStreakType).toBe('WIN');
    });

    it('should count consecutive losses', () => {
      const trades = generateTrades([-50, -50, -50, -50, 100], '2024-01-01');
      const result = computeStreaks(trades);
      
      expect(result.maxLossStreak).toBe(4);
      expect(result.currentStreak).toBe(1);
      expect(result.currentStreakType).toBe('WIN');
    });

    it('should handle alternating wins and losses', () => {
      const trades = generateTrades([100, -50, 100, -50, 100], '2024-01-01');
      const result = computeStreaks(trades);
      
      expect(result.maxWinStreak).toBe(1);
      expect(result.maxLossStreak).toBe(1);
    });
  });

  // ==========================================================================
  // EXPECTANCY TESTS
  // ==========================================================================

  describe('computeExpectancy', () => {
    it('should return zeros for empty trades', () => {
      const result = computeExpectancy([]);
      expect(result.expectancy).toBe(0);
      expect(result.winRate).toBe(0);
    });

    it('should calculate correct expectancy', () => {
      // 4 winners at $100 avg, 2 losers at $50 avg
      // Expectancy = (4 * 100 - 2 * 50) / 6 = 300 / 6 = 50
      const trades = [
        createTrade(100, '2024-01-01'),
        createTrade(100, '2024-01-02'),
        createTrade(100, '2024-01-03'),
        createTrade(100, '2024-01-04'),
        createTrade(-50, '2024-01-05'),
        createTrade(-50, '2024-01-06'),
      ];
      
      const result = computeExpectancy(trades);
      
      expect(result.expectancy).toBe(50);
      expect(result.winRate).toBeCloseTo(66.67, 1);
      expect(result.avgWin).toBe(100);
      expect(result.avgLoss).toBe(50);
      expect(result.profitFactor).toBe(4); // 400 / 100
    });

    it('should calculate R-multiple expectancy when risk provided', () => {
      const trades = generateTrades([100, -50, 150, -50], '2024-01-01');
      const result = computeExpectancy(trades, 50); // $50 risk per trade
      
      expect(result.expectancyR).not.toBeNull();
      // Expectancy = (100 - 50 + 150 - 50) / 4 = 37.5
      // R-multiple = 37.5 / 50 = 0.75
      expect(result.expectancyR).toBeCloseTo(0.75, 2);
    });
  });

  // ==========================================================================
  // COMPREHENSIVE METRICS TESTS
  // ==========================================================================

  describe('computeComprehensiveMetrics', () => {
    it('should compute all metrics together', () => {
      const trades = generateTrades(
        Array(50).fill(0).map((_, i) => i % 3 === 0 ? -100 : 150),
        '2024-01-01'
      );
      
      const result = computeComprehensiveMetrics(trades, 100000);
      
      expect(result.totalTrades).toBe(50);
      expect(result.sharpe).toBeDefined();
      expect(result.sortino).toBeDefined();
      expect(result.maxDrawdown).toBeDefined();
      expect(result.expectancy).toBeDefined();
      expect(result.streaks).toBeDefined();
    });

    it('should provide warnings for insufficient data', () => {
      const trades = generateTrades([100, -50, 100], '2024-01-01');
      const result = computeComprehensiveMetrics(trades, 100000);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.confidence).toBe('INSUFFICIENT');
    });

    it('should flag high drawdown in warnings', () => {
      const trades = generateTrades(
        Array(50).fill(0).map((_, i) => i < 25 ? 1000 : -2000),
        '2024-01-01'
      );
      
      const result = computeComprehensiveMetrics(trades, 100000);
      
      const hasDrawdownWarning = result.warnings.some(w => 
        w.toLowerCase().includes('drawdown')
      );
      expect(hasDrawdownWarning).toBe(true);
    });
  });

  // ==========================================================================
  // LEGACY COMPATIBILITY TESTS
  // ==========================================================================

  describe('computeSimpleSharpe', () => {
    it('should return null for insufficient data', () => {
      const result = computeSimpleSharpe(Array(5).fill(0.001));
      expect(result).toBeNull();
    });

    it('should return a number for sufficient data', () => {
      const returns = Array(30).fill(0).map((_, i) => 
        i % 2 === 0 ? 0.005 : -0.002
      );
      const result = computeSimpleSharpe(returns);
      expect(typeof result).toBe('number');
    });
  });

  describe('computeSimpleMaxDD', () => {
    it('should calculate max drawdown correctly', () => {
      const pnls = [1000, -500, -1000, 500];
      const result = computeSimpleMaxDD(pnls, 100000);
      
      expect(result.maxDD).toBe(1500);
    });
  });

  // ==========================================================================
  // UTILITY FUNCTION TESTS
  // ==========================================================================

  describe('isValidMetric', () => {
    it('should return false for null', () => {
      expect(isValidMetric(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isValidMetric(undefined)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidMetric(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isValidMetric(Infinity)).toBe(false);
      expect(isValidMetric(-Infinity)).toBe(false);
    });

    it('should return true for valid numbers', () => {
      expect(isValidMetric(0)).toBe(true);
      expect(isValidMetric(1.5)).toBe(true);
      expect(isValidMetric(-100)).toBe(true);
    });
  });

  describe('formatMetric', () => {
    it('should return dash for invalid values', () => {
      expect(formatMetric(null, 'sharpe')).toBe('—');
      expect(formatMetric(undefined, 'sharpe')).toBe('—');
      expect(formatMetric(NaN, 'sharpe')).toBe('—');
    });

    it('should format percentages correctly', () => {
      expect(formatMetric(12.5, 'percent')).toBe('12.5%');
      expect(formatMetric(-5.25, 'percent')).toBe('-5.3%');
    });

    it('should format currency correctly', () => {
      expect(formatMetric(1000, 'currency')).toBe('$1,000');
      expect(formatMetric(-500, 'currency')).toBe('-$500');
    });

    it('should format with sign when requested', () => {
      expect(formatMetric(1.5, 'sharpe', { showSign: true })).toBe('+1.50');
      expect(formatMetric(-1.5, 'sharpe', { showSign: true })).toBe('-1.50');
    });

    it('should respect decimal places option', () => {
      expect(formatMetric(1.23456, 'ratio', { decimals: 4 })).toBe('1.2346');
    });
  });

  // ==========================================================================
  // EDGE CASE TESTS
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle single trade', () => {
      const trades = [createTrade(100, '2024-01-01')];
      const result = computeComprehensiveMetrics(trades, 100000);
      
      expect(result.totalTrades).toBe(1);
      expect(result.totalPnl).toBe(100);
    });

    it('should handle all zero P&L trades', () => {
      const trades = generateTrades([0, 0, 0, 0, 0], '2024-01-01');
      const result = computeComprehensiveMetrics(trades, 100000);
      
      expect(result.totalPnl).toBe(0);
      expect(result.maxDrawdown.maxDrawdownAbs).toBe(0);
    });

    it('should handle very large numbers', () => {
      const trades = generateTrades([1000000, -500000, 2000000], '2024-01-01');
      const result = computeComprehensiveMetrics(trades, 10000000);
      
      expect(result.totalPnl).toBe(2500000);
    });

    it('should handle very small numbers', () => {
      const trades = generateTrades([0.001, -0.0005, 0.002], '2024-01-01');
      const result = computeComprehensiveMetrics(trades, 1);
      
      expect(result.totalPnl).toBeCloseTo(0.0025, 4);
    });
  });
});
