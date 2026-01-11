/**
 * REGRESSION TESTS: Promotion Gate Validation
 * 
 * These tests ensure that:
 * 1. Promotions with NULL critical metrics are BLOCKED (fail-closed)
 * 2. SEV-0 errors halt promotions
 * 3. SEV-2 warnings (like expectancy) do NOT block promotions
 * 4. Expectancy computation handles both decimal and percentage winRate
 */

import { describe, it, expect } from "vitest";
import { 
  validatePromotionGate, 
  validateRiskConfig,
  validateArchetype,
  validateSessionMode,
  validateTimeframe,
  classifyBacktestError,
  recordBatchMetrics,
  getFallbackMetrics,
  type PromotionGateMetrics,
} from "../fail-fast-validators";

describe("Promotion Gate Validation", () => {
  describe("NULL Metric Blocking (SEV-0)", () => {
    it("should BLOCK promotion when sharpeRatio is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: null,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 100,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "PAPER",
        toStage: "SHADOW",
        botId: "test-bot-123",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "SHARPE_RATIO_NULL")).toBe(true);
      expect(result.errors[0].severity).toBe("SEV-0");
    });

    it("should BLOCK promotion when maxDrawdownPercent is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: null,
          winRate: 55,
          totalTrades: 100,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "SHADOW",
        toStage: "CANARY",
        botId: "test-bot-456",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "MAX_DRAWDOWN_NULL")).toBe(true);
    });

    it("should BLOCK promotion when winRate is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: null,
          totalTrades: 100,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "TRIALS",
        toStage: "PAPER",
        botId: "test-bot-789",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "WIN_RATE_NULL")).toBe(true);
    });

    it("should BLOCK promotion when totalTrades is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: null,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "PAPER",
        toStage: "SHADOW",
        botId: "test-bot-abc",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "TOTAL_TRADES_NULL")).toBe(true);
    });

    it("should BLOCK promotion when profitFactor is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 100,
          profitFactor: null,
          expectancy: 10,
        },
        fromStage: "SHADOW",
        toStage: "CANARY",
        botId: "test-bot-def",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "PROFIT_FACTOR_NULL")).toBe(true);
    });

    it("should BLOCK promotion when totalTrades is below minimum (10)", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 5,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "TRIALS",
        toStage: "PAPER",
        botId: "test-bot-low-trades",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "INSUFFICIENT_TRADES")).toBe(true);
    });

    it("should BLOCK LIVE promotion when totalTrades is below 50", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 30,
          profitFactor: 1.5,
          expectancy: 10,
        },
        fromStage: "CANARY",
        toStage: "LIVE",
        botId: "test-bot-live",
      });
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === "INSUFFICIENT_TRADES_FOR_LIVE")).toBe(true);
    });
  });

  describe("Expectancy Warning (SEV-2) - Should NOT Block", () => {
    it("should ALLOW promotion when only expectancy is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 100,
          profitFactor: 1.5,
          expectancy: null,
        },
        fromStage: "PAPER",
        toStage: "SHADOW",
        botId: "test-bot-no-expectancy",
      });
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === "EXPECTANCY_NULL")).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("should ALLOW CANARY→LIVE promotion when expectancy is NULL", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 2.0,
          maxDrawdownPercent: 3,
          winRate: 60,
          totalTrades: 200,
          profitFactor: 2.0,
          expectancy: null,
        },
        fromStage: "CANARY",
        toStage: "LIVE",
        botId: "test-bot-canary-live",
      });
      
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.code === "EXPECTANCY_NULL")).toBe(true);
    });
  });

  describe("Valid Promotions", () => {
    it("should ALLOW promotion with all valid metrics including expectancy", () => {
      const result = validatePromotionGate({
        metrics: {
          sharpeRatio: 1.5,
          maxDrawdownPercent: 5,
          winRate: 55,
          totalTrades: 100,
          profitFactor: 1.5,
          expectancy: 25.5,
        },
        fromStage: "PAPER",
        toStage: "SHADOW",
        botId: "test-bot-valid",
      });
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.warnings.length).toBe(0);
    });
  });
});

describe("Risk Config Validation", () => {
  it("should BLOCK when riskConfig is missing", () => {
    const result = validateRiskConfig({
      riskConfig: null,
      maxContractsPerTrade: 5,
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "RISK_CONFIG_MISSING")).toBe(true);
  });

  it("should BLOCK when stopLossTicks is missing", () => {
    const result = validateRiskConfig({
      riskConfig: { takeProfitTicks: 10 },
      maxContractsPerTrade: 5,
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "STOP_LOSS_MISSING")).toBe(true);
  });

  it("should BLOCK when maxContractsPerTrade is missing", () => {
    const result = validateRiskConfig({
      riskConfig: { stopLossTicks: 10, takeProfitTicks: 20 },
      maxContractsPerTrade: null,
      stage: "TRIALS",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "MAX_CONTRACTS_PER_TRADE_MISSING")).toBe(true);
  });

  it("should ALLOW valid risk config", () => {
    const result = validateRiskConfig({
      riskConfig: { 
        stopLossTicks: 10, 
        takeProfitTicks: 20,
        maxDailyTrades: 5,
        maxDrawdownPercent: 5,
        maxPositionSize: 10, // Required - SEV-0
      },
      maxContractsPerTrade: 5,
      maxContractsPerSymbol: 10, // Required for PAPER+ stages
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(true);
  });
});

describe("Archetype Validation", () => {
  it("should validate explicit archetype", () => {
    const result = validateArchetype({
      archetypeName: "gap_fade",
      strategyName: "Test Strategy",
    });
    
    expect(result.valid).toBe(true);
    expect(result.inferredArchetype).toBe("gap_fade");
  });

  it("should infer archetype from strategy name", () => {
    const result = validateArchetype({
      archetypeName: null,
      strategyName: "MES Gap Fade Strategy",
    });
    
    expect(result.valid).toBe(true);
    expect(result.inferredArchetype).toBe("gap_fade");
  });

  it("should BLOCK when archetype cannot be determined", () => {
    const result = validateArchetype({
      archetypeName: null,
      strategyName: "Unknown Strategy XYZ123",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "ARCHETYPE_UNDETERMINABLE")).toBe(true);
  });
});

describe("Session Mode Validation", () => {
  it("should warn when session mode defaults to 24x5", () => {
    const result = validateSessionMode({
      sessionMode: null,
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(true);
    expect(result.normalizedMode).toBe("FULL_24x5");
    expect(result.warnings.some(w => w.code === "SESSION_MODE_IMPLICIT_DEFAULT")).toBe(true);
  });

  it("should validate explicit session mode", () => {
    const result = validateSessionMode({
      sessionMode: "RTH",
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(true);
    expect(result.normalizedMode).toBe("RTH");
    expect(result.warnings.length).toBe(0);
  });

  it("should BLOCK invalid session mode (fail-closed)", () => {
    const result = validateSessionMode({
      sessionMode: "INVALID_MODE",
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "SESSION_MODE_INVALID")).toBe(true);
    expect(result.normalizedMode).toBeUndefined();
  });

  it("should BLOCK incomplete CUSTOM session config", () => {
    const result = validateSessionMode({
      sessionMode: "CUSTOM",
      sessionConfig: { startTime: "09:30" }, // Missing endTime
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "CUSTOM_SESSION_INCOMPLETE")).toBe(true);
  });

  it("should ALLOW valid CUSTOM session config", () => {
    const result = validateSessionMode({
      sessionMode: "CUSTOM",
      sessionConfig: { startTime: "09:30", endTime: "16:00", timezone: "America/New_York" },
      stage: "PAPER",
    });
    
    expect(result.valid).toBe(true);
    expect(result.normalizedMode).toBe("CUSTOM");
    expect(result.errors.length).toBe(0);
  });
});

describe("Timeframe Validation", () => {
  it("should validate standard timeframes", () => {
    const result = validateTimeframe("5m");
    expect(result.valid).toBe(true);
    expect(result.normalizedTimeframe).toBe("5m");
  });

  it("should warn when timeframe is missing", () => {
    const result = validateTimeframe(null);
    expect(result.valid).toBe(true);
    expect(result.normalizedTimeframe).toBe("5m");
    expect(result.warnings.some(w => w.code === "TIMEFRAME_MISSING")).toBe(true);
  });

  it("should reject invalid timeframe", () => {
    const result = validateTimeframe("invalid");
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === "TIMEFRAME_INVALID")).toBe(true);
  });
});

describe("Backtest Error Classification", () => {
  it("should classify no data as CRITICAL", () => {
    const result = classifyBacktestError("No historical data available");
    expect(result.severity).toBe("CRITICAL");
    expect(result.shouldHalt).toBe(true);
    expect(result.code).toBe("NO_DATA");
  });

  it("should classify bar validation failure as CRITICAL", () => {
    const result = classifyBacktestError("Bar validation failed: invalid OHLC");
    expect(result.severity).toBe("CRITICAL");
    expect(result.shouldHalt).toBe(true);
    expect(result.code).toBe("CORRUPT_DATA");
  });

  it("should classify timeout as RECOVERABLE", () => {
    const result = classifyBacktestError("Request timeout after 30s");
    expect(result.severity).toBe("RECOVERABLE");
    expect(result.shouldHalt).toBe(false);
    expect(result.code).toBe("TRANSIENT_ERROR");
  });

  it("should classify no signals as WARNING", () => {
    const result = classifyBacktestError("No trades generated during session");
    expect(result.severity).toBe("WARNING");
    expect(result.shouldHalt).toBe(false);
    expect(result.code).toBe("NO_SIGNALS");
  });

  it("should classify unknown errors as CRITICAL (fail-closed)", () => {
    const result = classifyBacktestError("Some random unexpected error");
    expect(result.severity).toBe("CRITICAL");
    expect(result.shouldHalt).toBe(true);
    expect(result.code).toBe("UNKNOWN_ERROR");
  });
});

describe("Variance Detector", () => {
  it("should alert when all batch values are identical", () => {
    const result = recordBatchMetrics("test-batch", "sharpe", [1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(result.variance).toBe(0);
    expect(result.alert).toBe(true);
    expect(result.message).toContain("VARIANCE_ALERT");
  });

  it("should NOT alert when batch has normal variance", () => {
    const result = recordBatchMetrics("test-batch-2", "sharpe", [1.2, 1.5, 1.8, 2.1, 1.6]);
    expect(result.variance).toBeGreaterThan(0.001);
    expect(result.alert).toBe(false);
  });

  it("should NOT alert for small batches", () => {
    const result = recordBatchMetrics("test-batch-3", "pf", [1.5, 1.5]);
    expect(result.alert).toBe(false);
  });
});

describe("Fallback Metrics", () => {
  it("should track fallback counts", () => {
    const metrics = getFallbackMetrics();
    expect(metrics).toHaveProperty("archetypeFallbacks");
    expect(metrics).toHaveProperty("totalValidations");
    expect(metrics).toHaveProperty("rates");
  });
});
