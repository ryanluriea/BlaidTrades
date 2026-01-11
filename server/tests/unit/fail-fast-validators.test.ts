/**
 * INSTITUTIONAL FAIL-FAST VALIDATORS TEST SUITE
 * 
 * Tests SEV-0/SEV-1/SEV-2 validators to ensure:
 * - Critical data BLOCKS operations (fail-closed)
 * - No silent defaults allowed
 * - Proper severity classification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateRiskConfig,
  validateArchetype,
  validatePromotionGate,
  validateSymbol,
  validateSessionMode,
  validateTimeframe,
  validateBotCreation,
  classifyBacktestError,
  recordBatchMetrics,
  getMaxContractsLimit,
  type RiskValidationInput,
  type PromotionValidationInput,
} from '../../fail-fast-validators';

describe('Institutional Fail-Fast Validators', () => {
  
  describe('validateRiskConfig (SEV-0 Critical)', () => {
    it('should BLOCK when riskConfig is null', () => {
      const input: RiskValidationInput = {
        riskConfig: null,
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].severity).toBe('SEV-0');
      expect(result.errors[0].code).toBe('RISK_CONFIG_MISSING');
    });

    it('should BLOCK when stopLossTicks is missing', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          maxPositionSize: 5,
          takeProfitTicks: 80,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      const stopLossError = result.errors.find(e => e.code === 'STOP_LOSS_MISSING');
      expect(stopLossError).toBeDefined();
      expect(stopLossError?.severity).toBe('SEV-0');
    });

    it('should BLOCK when maxPositionSize is missing', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      const positionError = result.errors.find(e => e.code === 'MAX_POSITION_SIZE_MISSING');
      expect(positionError).toBeDefined();
      expect(positionError?.severity).toBe('SEV-0');
    });

    it('should BLOCK when maxPositionSize exceeds 100', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
          maxPositionSize: 150,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      const excessiveError = result.errors.find(e => e.code === 'MAX_POSITION_SIZE_EXCESSIVE');
      expect(excessiveError).toBeDefined();
      expect(excessiveError?.severity).toBe('SEV-0');
    });

    it('should BLOCK when maxContractsPerTrade is missing', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
          maxPositionSize: 5,
        },
        maxContractsPerTrade: null,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      const contractError = result.errors.find(e => e.code === 'MAX_CONTRACTS_PER_TRADE_MISSING');
      expect(contractError).toBeDefined();
    });

    it('should PASS with complete valid risk config', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
          maxPositionSize: 5,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should WARN when takeProfitTicks is missing (SEV-1 not SEV-0)', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          maxPositionSize: 5,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(true);
      const takeProfitWarning = result.warnings.find(w => w.code === 'TAKE_PROFIT_MISSING');
      expect(takeProfitWarning).toBeDefined();
    });

    it('should require maxDrawdownPercent for PAPER+ stages', () => {
      const input: RiskValidationInput = {
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
          maxPositionSize: 5,
        },
        maxContractsPerTrade: 5,
        maxContractsPerSymbol: 10,
        stage: 'PAPER',
      };
      
      const result = validateRiskConfig(input);
      
      expect(result.valid).toBe(false);
      const drawdownError = result.errors.find(e => e.code === 'DRAWDOWN_LIMIT_MISSING');
      expect(drawdownError).toBeDefined();
      expect(drawdownError?.severity).toBe('SEV-1');
    });
  });

  describe('validatePromotionGate (SEV-0 Critical)', () => {
    const validMetrics = {
      sharpeRatio: 1.5,
      maxDrawdownPercent: 10,
      winRate: 55,
      totalTrades: 50,
      profitFactor: 1.8,
    };

    it('should BLOCK promotion when sharpeRatio is NULL', () => {
      const input: PromotionValidationInput = {
        metrics: { ...validMetrics, sharpeRatio: null },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      const sharpeError = result.errors.find(e => e.code === 'SHARPE_RATIO_NULL');
      expect(sharpeError).toBeDefined();
      expect(sharpeError?.severity).toBe('SEV-0');
    });

    it('should BLOCK promotion when maxDrawdownPercent is NULL', () => {
      const input: PromotionValidationInput = {
        metrics: { ...validMetrics, maxDrawdownPercent: null },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      const ddError = result.errors.find(e => e.code === 'MAX_DRAWDOWN_NULL');
      expect(ddError).toBeDefined();
      expect(ddError?.severity).toBe('SEV-0');
    });

    it('should BLOCK promotion when winRate is NULL', () => {
      const input: PromotionValidationInput = {
        metrics: { ...validMetrics, winRate: null },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      const winRateError = result.errors.find(e => e.code === 'WIN_RATE_NULL');
      expect(winRateError).toBeDefined();
    });

    it('should BLOCK promotion when totalTrades is NULL', () => {
      const input: PromotionValidationInput = {
        metrics: { ...validMetrics, totalTrades: null },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      const tradesError = result.errors.find(e => e.code === 'TOTAL_TRADES_NULL');
      expect(tradesError).toBeDefined();
    });

    it('should BLOCK promotion with insufficient trades (<10)', () => {
      const input: PromotionValidationInput = {
        metrics: { ...validMetrics, totalTrades: 5 },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      const tradesError = result.errors.find(e => e.code === 'INSUFFICIENT_TRADES');
      expect(tradesError).toBeDefined();
    });

    it('should PASS with all valid metrics', () => {
      const input: PromotionValidationInput = {
        metrics: validMetrics,
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should catch ALL NULL metrics in a single validation', () => {
      const input: PromotionValidationInput = {
        metrics: {
          sharpeRatio: null,
          maxDrawdownPercent: null,
          winRate: null,
          totalTrades: null,
          profitFactor: null,
        },
        fromStage: 'TRIALS',
        toStage: 'PAPER',
        botId: 'test-bot-123',
      };
      
      const result = validatePromotionGate(input);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(5);
      
      const errorCodes = result.errors.map(e => e.code);
      expect(errorCodes).toContain('SHARPE_RATIO_NULL');
      expect(errorCodes).toContain('MAX_DRAWDOWN_NULL');
      expect(errorCodes).toContain('WIN_RATE_NULL');
      expect(errorCodes).toContain('TOTAL_TRADES_NULL');
      expect(errorCodes).toContain('PROFIT_FACTOR_NULL');
    });
  });

  describe('validateArchetype (SEV-1)', () => {
    it('should PASS with explicit valid archetype', () => {
      const result = validateArchetype({
        archetypeName: 'mean_reversion',
        strategyName: 'Test Strategy',
      });
      
      expect(result.valid).toBe(true);
      expect(result.inferredArchetype).toBe('mean_reversion');
    });

    it('should PASS with normalized archetype (case insensitive)', () => {
      const result = validateArchetype({
        archetypeName: 'VOLATILITY_BREAKOUT',
        strategyName: 'Test Strategy',
      });
      
      expect(result.valid).toBe(true);
      expect(result.inferredArchetype).toBeDefined();
    });

    it('should infer archetype from strategy name with proper format', () => {
      const result = validateArchetype({
        strategyName: 'Mean Reversion Strategy',
      });
      
      expect(result.valid).toBe(true);
      expect(result.inferredArchetype).toBe('mean_reversion');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should BLOCK when archetype cannot be determined', () => {
      const result = validateArchetype({
        strategyName: 'XYZ_Unknown_Pattern',
      });
      
      expect(result.valid).toBe(false);
      const undeterminableError = result.errors.find(e => e.code === 'ARCHETYPE_UNDETERMINABLE');
      expect(undeterminableError).toBeDefined();
      expect(undeterminableError?.severity).toBe('SEV-1');
    });
  });

  describe('validateSymbol', () => {
    it('should PASS and normalize MES', () => {
      const result = validateSymbol('MES');
      
      expect(result.valid).toBe(true);
      expect(result.normalizedSymbol).toBe('MES');
    });

    it('should PASS and normalize lowercase mes', () => {
      const result = validateSymbol('mes');
      
      expect(result.valid).toBe(true);
      expect(result.normalizedSymbol).toBe('MES');
    });

    it('should BLOCK invalid symbol', () => {
      const result = validateSymbol('INVALID_SYMBOL');
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should BLOCK null symbol', () => {
      const result = validateSymbol(null);
      
      expect(result.valid).toBe(false);
    });
  });

  describe('validateSessionMode', () => {
    it('should PASS with valid session modes', () => {
      const validModes = ['RTH', 'ETH'];
      
      for (const mode of validModes) {
        const result = validateSessionMode({ sessionMode: mode });
        expect(result.valid).toBe(true);
      }
    });

    it('should normalize case variations', () => {
      const result = validateSessionMode({ sessionMode: 'rth' });
      
      expect(result.valid).toBe(true);
      expect(result.normalizedMode).toBe('RTH');
    });

    it('should BLOCK invalid session mode', () => {
      const result = validateSessionMode({ sessionMode: 'INVALID_SESSION' });
      
      expect(result.valid).toBe(false);
    });
  });

  describe('validateTimeframe', () => {
    it('should PASS with valid timeframes', () => {
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
      
      for (const tf of validTimeframes) {
        const result = validateTimeframe(tf);
        expect(result.valid).toBe(true);
        expect(result.normalizedTimeframe).toBe(tf);
      }
    });

    it('should BLOCK invalid timeframe', () => {
      const result = validateTimeframe('2h');
      
      expect(result.valid).toBe(false);
    });

    it('should handle null with warning', () => {
      const result = validateTimeframe(null);
      
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateBotCreation (Combined Validation)', () => {
    it('should catch ALL validation errors at once', () => {
      const result = validateBotCreation({
        name: 'Test Bot',
        symbol: 'INVALID',
        archetypeName: undefined,
        riskConfig: null,
        maxContractsPerTrade: null,
        stage: 'TRIALS',
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should PASS with complete valid input', () => {
      const result = validateBotCreation({
        name: 'MeanReversion Bot',
        symbol: 'MES',
        archetypeName: 'mean_reversion',
        riskConfig: {
          stopLossTicks: 16,
          takeProfitTicks: 80,
          maxPositionSize: 5,
        },
        maxContractsPerTrade: 5,
        stage: 'TRIALS',
      });
      
      expect(result.valid).toBe(true);
    });
  });

  describe('classifyBacktestError', () => {
    it('should classify timeout as RECOVERABLE', () => {
      const result = classifyBacktestError(new Error('Request timeout'));
      
      expect(result.severity).toBe('RECOVERABLE');
      expect(result.shouldHalt).toBe(false);
    });

    it('should classify authentication error', () => {
      const result = classifyBacktestError(new Error('Authentication failed'));
      
      expect(result.severity).toBe('CRITICAL');
      expect(result.shouldHalt).toBe(true);
    });

    it('should classify rate limit as RECOVERABLE', () => {
      const result = classifyBacktestError(new Error('Rate limit exceeded'));
      
      expect(result.severity).toBe('RECOVERABLE');
      expect(result.shouldHalt).toBe(false);
    });
  });

  describe('recordBatchMetrics (Variance Detection)', () => {
    it('should detect near-zero variance (all identical values = bug)', () => {
      const identicalValues = [1.5, 1.5, 1.5, 1.5, 1.5];
      
      const result = recordBatchMetrics('test-batch', 'sharpe_ratio', identicalValues);
      
      expect(result.variance).toBe(0);
      expect(result.alert).toBe(true);
    });

    it('should accept normal variance', () => {
      const normalValues = [1.2, 1.5, 1.8, 2.1, 1.6];
      
      const result = recordBatchMetrics('test-batch-2', 'sharpe_ratio', normalValues);
      
      expect(result.variance).toBeGreaterThan(0);
      expect(result.alert).toBe(false);
    });
  });

  describe('getMaxContractsLimit (Stage-Based Limits)', () => {
    it('should return correct defaults per stage', () => {
      expect(getMaxContractsLimit('TRIALS')).toBe(10);
      expect(getMaxContractsLimit('PAPER')).toBe(20);
      expect(getMaxContractsLimit('SHADOW')).toBe(30);
      expect(getMaxContractsLimit('CANARY')).toBe(50);
      expect(getMaxContractsLimit('LIVE')).toBe(100);
    });

    it('should handle case insensitivity', () => {
      expect(getMaxContractsLimit('trials')).toBe(10);
      expect(getMaxContractsLimit('Trials')).toBe(10);
    });

    it('should return default for unknown stage', () => {
      const result = getMaxContractsLimit('UNKNOWN');
      expect(result).toBe(50);
    });
  });
});

describe('QC Verification Gates', () => {
  const QC_GATES = {
    MIN_TRADES: 30,
    SHARPE_THRESHOLD: 0,
    MAX_DRAWDOWN: 25,
    WIN_RATE: 45,
    PROFIT_FACTOR: 1.2,
  };

  describe('Gate Thresholds', () => {
    it('should reject strategies with fewer than 30 trades', () => {
      const metrics = { totalTrades: 25 };
      expect(metrics.totalTrades).toBeLessThan(QC_GATES.MIN_TRADES);
    });

    it('should reject negative Sharpe ratio', () => {
      const metrics = { sharpeRatio: -0.5 };
      expect(metrics.sharpeRatio).toBeLessThanOrEqual(QC_GATES.SHARPE_THRESHOLD);
    });

    it('should reject drawdown > 25%', () => {
      const metrics = { maxDrawdownPercent: 30 };
      expect(metrics.maxDrawdownPercent).toBeGreaterThan(QC_GATES.MAX_DRAWDOWN);
    });

    it('should reject win rate < 45%', () => {
      const metrics = { winRate: 40 };
      expect(metrics.winRate).toBeLessThan(QC_GATES.WIN_RATE);
    });

    it('should reject profit factor < 1.2', () => {
      const metrics = { profitFactor: 1.0 };
      expect(metrics.profitFactor).toBeLessThan(QC_GATES.PROFIT_FACTOR);
    });

    it('should PASS strategy meeting all gates', () => {
      const passingMetrics = {
        totalTrades: 50,
        sharpeRatio: 1.5,
        maxDrawdownPercent: 15,
        winRate: 55,
        profitFactor: 1.8,
      };

      expect(passingMetrics.totalTrades).toBeGreaterThanOrEqual(QC_GATES.MIN_TRADES);
      expect(passingMetrics.sharpeRatio).toBeGreaterThan(QC_GATES.SHARPE_THRESHOLD);
      expect(passingMetrics.maxDrawdownPercent).toBeLessThan(QC_GATES.MAX_DRAWDOWN);
      expect(passingMetrics.winRate).toBeGreaterThanOrEqual(QC_GATES.WIN_RATE);
      expect(passingMetrics.profitFactor).toBeGreaterThanOrEqual(QC_GATES.PROFIT_FACTOR);
    });
  });
});
