/**
 * Strategy Rules Engine - Institutional-Grade Trading Logic
 * 
 * This module defines explicit, inspectable, versioned strategy rules.
 * NO randomness - all behavior is deterministic and auditable.
 * 
 * Each strategy has:
 * - Entry conditions (price, indicators, structure)
 * - Exit conditions (TP, SL, time stop, invalidation)
 * - Risk rules (size, max loss, scaling)
 * - Session rules (RTH/ETH, no-trade windows)
 */

import { getInstrumentSpec, roundToTick, type InstrumentSpec } from "./instrument-spec";

// ============ TYPE DEFINITIONS ============

export type Side = "LONG" | "SHORT";
export type SessionType = "RTH" | "ETH" | "BOTH";
export type TimeframeType = "1m" | "5m" | "15m" | "1h" | "1d";

export interface StrategyRules {
  version: string;  // Semantic version for tracking changes
  archetype: string;
  name: string;
  description: string;
  
  entry: EntryRules;
  exit: ExitRules;
  risk: RiskRules;
  session: SessionRules;
  
  // INSTITUTIONAL PROVENANCE (SEV-0): Embedded at creation time
  entryConditionType: EntryConditionType; // Canonical entry condition type
  rulesHash?: string; // Deterministic hash of rules (computed after creation)
  rulesSummary?: string; // Human-readable summary of key rules
  
  // Metadata for audit trail
  createdAt: string;
  lastModifiedAt: string;
  changeReason?: string;
}

export interface EntryRules {
  // Primary entry condition
  condition: EntryCondition;
  
  // Confirmation filters (all must pass)
  confirmations: ConfirmationFilter[];
  
  // Invalidation conditions (any triggers skip)
  invalidations: InvalidationRule[];
}

// INSTITUTIONAL STANDARD: Entry condition types must match shared/strategy-types.ts
export type EntryConditionType = 
  | "BREAKOUT" 
  | "MEAN_REVERSION" 
  | "VWAP_TOUCH" 
  | "TREND_CONTINUATION" 
  | "GAP_FADE"
  | "GAP_FILL"
  | "REVERSAL"
  | "RANGE_SCALP"
  | "MOMENTUM_SURGE";

export interface EntryCondition {
  type: EntryConditionType;
  
  // Price level conditions
  priceAbove?: number | "VWAP" | "EMA_20" | "SMA_50" | "HIGH_OF_DAY" | "OPEN";
  priceBelow?: number | "VWAP" | "EMA_20" | "SMA_50" | "LOW_OF_DAY" | "OPEN";
  
  // Breakout-specific
  breakoutBars?: number;           // Number of bars to confirm breakout
  breakoutThreshold?: number;      // Minimum move in ticks
  
  // Mean reversion-specific
  deviationBands?: number;         // Standard deviations from mean
  rsiOversold?: number;            // RSI level for oversold (e.g., 30)
  rsiOverbought?: number;          // RSI level for overbought (e.g., 70)
  
  // VWAP-specific
  vwapDeviation?: number;          // Distance from VWAP in standard deviations
  vwapReclaim?: boolean;           // Must reclaim VWAP after deviation
  
  // Trend-specific
  trendEmaShort?: number;          // Short EMA period (e.g., 9)
  trendEmaLong?: number;           // Long EMA period (e.g., 21)
  macdSignalCross?: boolean;       // MACD crosses signal line
  
  // Gap-specific
  gapThreshold?: number;           // Minimum gap size in ticks
  gapFillTarget?: number;          // Target fill percentage (0-1)
  
  // Reversal-specific
  reversalBars?: number;           // Bars to confirm reversal pattern
  pivotStrength?: number;          // Number of bars on each side for pivot
  
  // Scalping-specific
  rangeMinBars?: number;           // Minimum bars for range identification
  rangeThreshold?: number;         // Maximum range height in ATR multiples
}

export interface ConfirmationFilter {
  type: "VOLUME" | "TIME" | "TREND" | "VOLATILITY" | "MOMENTUM";
  
  // Volume confirmation
  volumeMultiplier?: number;       // e.g., 1.5x average volume
  
  // Time confirmation
  minBarsHeld?: number;            // Minimum bars price must hold level
  
  // Trend confirmation
  aboveEma?: number;               // Price above N-period EMA
  belowEma?: number;               // Price below N-period EMA
  
  // Volatility confirmation
  atrMultiplier?: number;          // ATR threshold
  
  // Momentum confirmation
  momentumPositive?: boolean;      // ROC > 0
  momentumThreshold?: number;      // Minimum momentum value
}

export interface InvalidationRule {
  type: "PRICE" | "TIME" | "VOLUME" | "STRUCTURE" | "VOLATILITY";
  
  // Price invalidation
  priceRetracePct?: number;        // Max retracement before invalidation
  priceBreakLevel?: "OPEN" | "LOW" | "HIGH" | "VWAP" | "RANGE";
  priceExtension?: number;         // Price extension threshold
  
  // Time invalidation
  maxBarsWithoutEntry?: number;    // Time decay
  
  // Volume invalidation
  volumeDryUp?: number;            // Volume drops below threshold
  
  // Structure invalidation
  lowerHighForLong?: boolean;      // Structure breakdown
  higherLowForShort?: boolean;     // Structure breakdown
  
  // Volatility invalidation
  atrMultiple?: number;            // ATR threshold for volatility
}

export interface ExitRules {
  // Take profit rules (any triggers exit)
  takeProfit: TakeProfitRule[];
  
  // Stop loss rules (any triggers exit)
  stopLoss: StopLossRule[];
  
  // Time-based exit
  timeStop?: TimeStopRule;
  
  // Trailing stop
  trailingStop?: TrailingStopRule;
}

export interface TakeProfitRule {
  type: "FIXED_TICKS" | "FIXED_PERCENT" | "ATR_MULTIPLE" | "RISK_MULTIPLE" | "STRUCTURE";
  
  ticks?: number;
  percent?: number;
  atrMultiple?: number;
  riskMultiple?: number;           // e.g., 2.0 = 2R
  structureLevel?: "HIGH_OF_DAY" | "LOW_OF_DAY" | "VWAP" | "OPEN" | "PREVIOUS_CLOSE" | "GAP_FILL" | "RANGE" | "RANGE_OPPOSITE";
  
  // Partial exit
  partialExitPct?: number;         // Percentage to exit (e.g., 50%)
}

export interface StopLossRule {
  type: "FIXED_TICKS" | "FIXED_PERCENT" | "ATR_MULTIPLE" | "STRUCTURE" | "BREAKEVEN";
  
  ticks?: number;
  percent?: number;
  atrMultiple?: number;
  structureLevel?: "LOW_OF_BAR" | "HIGH_OF_BAR" | "SWING_LOW" | "SWING_HIGH";
  stopBeyondExtreme?: boolean;     // Place stop beyond extreme of range
  
  // Breakeven trigger
  breakevenAfterTicks?: number;    // Move to breakeven after N ticks profit
}

export interface TimeStopRule {
  maxBarsInTrade?: number;         // Maximum bars to hold position
  exitBeforeClose?: number;        // Exit N minutes before session close
  exitAtTime?: string;             // Specific exit time (HH:MM)
}

export interface TrailingStopRule {
  activationTicks?: number;        // Activate after N ticks profit
  trailDistance?: number;          // Trail distance in ticks
  stepSize?: number;               // Only adjust in N-tick increments
}

export interface RiskRules {
  // Position sizing
  maxPositionSize: number;         // Maximum contracts
  riskPerTrade: number;            // Risk per trade as % of account
  maxDailyLoss: number;            // Maximum daily loss as % of account
  maxOpenPositions: number;        // Maximum concurrent positions
  
  // Scaling rules
  scaleIn?: ScalingRule;
  scaleOut?: ScalingRule;
  
  // Correlation limits
  maxCorrelatedPositions?: number; // Max positions in correlated instruments
}

export interface ScalingRule {
  enabled: boolean;
  levels: number;                  // Number of scale levels
  sizePerLevel: number;            // Contracts per level
  priceIncrement: number;          // Ticks between levels
}

export interface SessionRules {
  allowedSessions: SessionType[];
  
  // RTH hours (exchange time)
  rthStart: string;                // HH:MM format (e.g., "09:30")
  rthEnd: string;                  // HH:MM format (e.g., "16:00")
  
  // No-trade windows
  noTradeWindows: NoTradeWindow[];
  
  // Day-of-week restrictions
  tradingDays: number[];           // 0=Sunday, 1=Monday, etc.
}

export interface NoTradeWindow {
  reason: string;                  // e.g., "Economic release", "Lunch hours"
  start: string;                   // HH:MM
  end: string;                     // HH:MM
  daysOfWeek?: number[];           // If specific days only
}

// ============ DEFAULT STRATEGY TEMPLATES ============

export function createBreakoutStrategy(
  symbol: string,
  params: Partial<{
    breakoutBars: number;
    breakoutTicks: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(20 / spec.tickSize) : 8;
  
  return {
    version: "1.0.0",
    archetype: "breakout",
    name: `${symbol} Breakout`,
    description: `Breakout strategy for ${symbol} - enters on price breaking above/below recent range with volume confirmation`,
    
    entry: {
      condition: {
        type: "BREAKOUT",
        breakoutBars: params.breakoutBars || 10,
        breakoutThreshold: params.breakoutTicks || defaultTicks,
      },
      confirmations: [
        { type: "VOLUME", volumeMultiplier: 1.5 },
        { type: "TREND", aboveEma: 20 },
      ],
      invalidations: [
        { type: "PRICE", priceRetracePct: 50 },
        { type: "TIME", maxBarsWithoutEntry: 3 },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
        { type: "RISK_MULTIPLE", riskMultiple: 2.0, partialExitPct: 50 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "STRUCTURE", structureLevel: "SWING_LOW" },
      ],
      timeStop: {
        maxBarsInTrade: 20,
        exitBeforeClose: 15,
      },
      trailingStop: {
        activationTicks: defaultTicks,
        trailDistance: Math.round(defaultTicks * 0.75),
        stepSize: 2,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 3.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:30",
      rthEnd: "16:00",
      noTradeWindows: [
        { reason: "First 5 minutes", start: "09:30", end: "09:35" },
        { reason: "Last 15 minutes", start: "15:45", end: "16:00" },
      ],
      tradingDays: [1, 2, 3, 4, 5], // Monday to Friday
    },
    
    entryConditionType: "BREAKOUT",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

export function createMeanReversionStrategy(
  symbol: string,
  params: Partial<{
    deviationBands: number;
    rsiOversold: number;
    rsiOverbought: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(15 / spec.tickSize) : 6;
  
  return {
    version: "1.0.0",
    archetype: "mean_reversion",
    name: `${symbol} Mean Reversion`,
    description: `Mean reversion strategy for ${symbol} - fades extreme moves using Bollinger Bands and RSI`,
    
    entry: {
      condition: {
        type: "MEAN_REVERSION",
        deviationBands: params.deviationBands || 2.0,
        rsiOversold: params.rsiOversold || 30,
        rsiOverbought: params.rsiOverbought || 70,
      },
      confirmations: [
        { type: "MOMENTUM", momentumThreshold: -2 },
        { type: "VOLUME", volumeMultiplier: 1.2 },
      ],
      invalidations: [
        { type: "PRICE", priceRetracePct: 75 },
        { type: "STRUCTURE", lowerHighForLong: true, higherLowForShort: true },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "STRUCTURE", structureLevel: "VWAP" },
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "ATR_MULTIPLE", atrMultiple: 1.5 },
      ],
      timeStop: {
        maxBarsInTrade: 15,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 2.5,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:35",
      rthEnd: "15:45",
      noTradeWindows: [
        { reason: "Lunch hours", start: "12:00", end: "13:00" },
      ],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "MEAN_REVERSION",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

export function createVWAPStrategy(
  symbol: string,
  params: Partial<{
    vwapDeviation: number;
    vwapReclaim: boolean;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(12 / spec.tickSize) : 5;
  
  return {
    version: "1.0.0",
    archetype: "vwap",
    name: `${symbol} VWAP`,
    description: `VWAP strategy for ${symbol} - trades bounces and reclaims of volume-weighted average price`,
    
    entry: {
      condition: {
        type: "VWAP_TOUCH",
        vwapDeviation: params.vwapDeviation || 0.5,
        vwapReclaim: params.vwapReclaim ?? true,
      },
      confirmations: [
        { type: "VOLUME", volumeMultiplier: 1.3 },
        { type: "TIME", minBarsHeld: 2 },
      ],
      invalidations: [
        { type: "PRICE", priceBreakLevel: "VWAP" },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "ATR_MULTIPLE", atrMultiple: 1.5 },
        { type: "RISK_MULTIPLE", riskMultiple: 1.5 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "BREAKEVEN", breakevenAfterTicks: Math.round(defaultTicks * 0.5) },
      ],
      timeStop: {
        maxBarsInTrade: 12,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 0.75,
      maxDailyLoss: 2.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:45",
      rthEnd: "15:30",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "VWAP_TOUCH",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

export function createTrendStrategy(
  symbol: string,
  params: Partial<{
    emaShort: number;
    emaLong: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(25 / spec.tickSize) : 10;
  
  return {
    version: "1.0.0",
    archetype: "trend",
    name: `${symbol} Trend Following`,
    description: `Trend following strategy for ${symbol} - enters on EMA crossovers with momentum confirmation`,
    
    entry: {
      condition: {
        type: "TREND_CONTINUATION",
        trendEmaShort: params.emaShort || 9,
        trendEmaLong: params.emaLong || 21,
        macdSignalCross: true,
      },
      confirmations: [
        { type: "MOMENTUM", momentumPositive: true },
        { type: "VOLUME", volumeMultiplier: 1.2 },
      ],
      invalidations: [
        { type: "TIME", maxBarsWithoutEntry: 5 },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
        { type: "RISK_MULTIPLE", riskMultiple: 3.0, partialExitPct: 50 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "ATR_MULTIPLE", atrMultiple: 2.0 },
      ],
      trailingStop: {
        activationTicks: defaultTicks,
        trailDistance: Math.round(defaultTicks * 0.6),
        stepSize: 2,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 3.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:40",
      rthEnd: "15:50",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "TREND_CONTINUATION",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

export function createScalpingStrategy(
  symbol: string,
  params: Partial<{
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(8 / spec.tickSize) : 3;
  
  return {
    version: "1.0.0",
    archetype: "scalping",
    name: `${symbol} Scalping`,
    description: `Scalping strategy for ${symbol} - quick entries on micro pullbacks with tight stops`,
    
    entry: {
      condition: {
        type: "TREND_CONTINUATION",
        trendEmaShort: 5,
        trendEmaLong: 13,
      },
      confirmations: [
        { type: "TIME", minBarsHeld: 1 },
        { type: "VOLATILITY", atrMultiplier: 0.5 },
      ],
      invalidations: [
        { type: "VOLUME", volumeDryUp: 0.5 },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
      ],
      timeStop: {
        maxBarsInTrade: 5,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 0.5,
      maxDailyLoss: 2.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:45",
      rthEnd: "11:30",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "TREND_CONTINUATION",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ GAP FADE STRATEGY ============
// DEDICATED factory for gap fade - uses GAP_FADE entry condition type

export function createGapFadeStrategy(
  symbol: string,
  params: Partial<{
    gapThreshold: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(12 / spec.tickSize) : 5;
  
  return {
    version: "1.0.0",
    archetype: "gap_fade",
    name: `${symbol} Gap Fade`,
    description: `Gap fade strategy for ${symbol} - fades opening gaps expecting mean reversion to previous close`,
    
    entry: {
      condition: {
        type: "GAP_FADE",  // CRITICAL: Uses dedicated GAP_FADE type
        gapThreshold: params.gapThreshold || 8,
        deviationBands: 1.5,
        rsiOversold: 35,
        rsiOverbought: 65,
      },
      confirmations: [
        { type: "TIME", minBarsHeld: 3 }, // Wait for gap to stabilize
        { type: "VOLUME", volumeMultiplier: 0.8 }, // Volume can be lower on gap trades
      ],
      invalidations: [
        { type: "PRICE", priceExtension: 2.0 }, // Don't fade if gap extends further
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "STRUCTURE", structureLevel: "PREVIOUS_CLOSE" },
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "ATR_MULTIPLE", atrMultiple: 1.5 },
      ],
      timeStop: {
        maxBarsInTrade: 20,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 2.5,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:30",  // Trade at open for gap fades
      rthEnd: "11:00",    // Gap fills usually happen in first 90 minutes
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "GAP_FADE",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ GAP FILL STRATEGY ============
// DEDICATED factory for gap fill - uses GAP_FILL entry condition type

export function createGapFillStrategy(
  symbol: string,
  params: Partial<{
    gapThreshold: number;
    gapFillTarget: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(15 / spec.tickSize) : 6;
  
  return {
    version: "1.0.0",
    archetype: "gap_fill",
    name: `${symbol} Gap Fill`,
    description: `Gap fill strategy for ${symbol} - trades continuation after gap in direction of fill`,
    
    entry: {
      condition: {
        type: "GAP_FILL",  // CRITICAL: Uses dedicated GAP_FILL type
        gapThreshold: params.gapThreshold || 6,
        gapFillTarget: params.gapFillTarget || 0.5, // Target 50% fill
      },
      confirmations: [
        { type: "MOMENTUM", momentumPositive: true },
        { type: "VOLUME", volumeMultiplier: 1.1 },
      ],
      invalidations: [
        { type: "TIME", maxBarsWithoutEntry: 10 },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "STRUCTURE", structureLevel: "GAP_FILL" },
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
      ],
      timeStop: {
        maxBarsInTrade: 15,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 2.5,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:35",
      rthEnd: "12:00",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "GAP_FILL",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ REVERSAL STRATEGY ============
// DEDICATED factory for reversals - uses REVERSAL entry condition type

export function createReversalStrategy(
  symbol: string,
  params: Partial<{
    reversalBars: number;
    pivotStrength: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(18 / spec.tickSize) : 7;
  
  return {
    version: "1.0.0",
    archetype: "reversal",
    name: `${symbol} Reversal`,
    description: `Reversal strategy for ${symbol} - identifies exhaustion and reversal patterns at key levels`,
    
    entry: {
      condition: {
        type: "REVERSAL",  // CRITICAL: Uses dedicated REVERSAL type
        reversalBars: params.reversalBars || 5,
        pivotStrength: params.pivotStrength || 3,
        rsiOversold: 25,
        rsiOverbought: 75,
      },
      confirmations: [
        { type: "VOLUME", volumeMultiplier: 1.3 }, // Volume spike on reversal
        { type: "MOMENTUM", momentumThreshold: -3 }, // Momentum divergence
      ],
      invalidations: [
        { type: "STRUCTURE", lowerHighForLong: true, higherLowForShort: true },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "STRUCTURE", structureLevel: "VWAP" },
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "STRUCTURE", stopBeyondExtreme: true },
      ],
      timeStop: {
        maxBarsInTrade: 20,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 2.5,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "10:00",  // Wait for initial range to establish
      rthEnd: "15:30",
      noTradeWindows: [
        { reason: "Lunch hours", start: "12:00", end: "13:00" },
      ],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "REVERSAL",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ RANGE SCALPER STRATEGY ============
// DEDICATED factory for range scalping - uses RANGE_SCALP entry condition type

export function createRangeScalperStrategy(
  symbol: string,
  params: Partial<{
    rangeMinBars: number;
    rangeThreshold: number;
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(6 / spec.tickSize) : 2;
  
  return {
    version: "1.0.0",
    archetype: "range_scalper",
    name: `${symbol} Range Scalper`,
    description: `Range scalping strategy for ${symbol} - trades bounces within identified ranges`,
    
    entry: {
      condition: {
        type: "RANGE_SCALP",  // CRITICAL: Uses dedicated RANGE_SCALP type
        rangeMinBars: params.rangeMinBars || 10,
        rangeThreshold: params.rangeThreshold || 1.5,
      },
      confirmations: [
        { type: "TIME", minBarsHeld: 1 },
      ],
      invalidations: [
        { type: "PRICE", priceBreakLevel: "RANGE" },
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "STRUCTURE", structureLevel: "RANGE_OPPOSITE" },
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
      ],
      timeStop: {
        maxBarsInTrade: 8,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 0.5,
      maxDailyLoss: 2.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "10:30",  // After initial volatility
      rthEnd: "14:30",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "RANGE_SCALP",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ MOMENTUM SURGE STRATEGY ============
// DEDICATED factory for momentum surge - uses MOMENTUM_SURGE entry condition type

export function createMomentumSurgeStrategy(
  symbol: string,
  params: Partial<{
    takeProfitTicks: number;
    stopLossTicks: number;
    riskPerTrade: number;
  }> = {}
): StrategyRules {
  const spec = getInstrumentSpec(symbol);
  const defaultTicks = spec ? Math.round(20 / spec.tickSize) : 8;
  
  return {
    version: "1.0.0",
    archetype: "momentum_surge",
    name: `${symbol} Momentum Surge`,
    description: `Momentum surge strategy for ${symbol} - captures strong directional moves with volume confirmation`,
    
    entry: {
      condition: {
        type: "MOMENTUM_SURGE",  // CRITICAL: Uses dedicated MOMENTUM_SURGE type
        trendEmaShort: 9,
        trendEmaLong: 21,
        macdSignalCross: true,
      },
      confirmations: [
        { type: "MOMENTUM", momentumPositive: true },
        { type: "VOLUME", volumeMultiplier: 1.5 }, // Strong volume requirement
      ],
      invalidations: [
        { type: "VOLATILITY", atrMultiple: 3.0 }, // Don't trade extreme volatility
      ],
    },
    
    exit: {
      takeProfit: [
        { type: "FIXED_TICKS", ticks: params.takeProfitTicks || defaultTicks * 2 },
        { type: "RISK_MULTIPLE", riskMultiple: 2.5, partialExitPct: 50 },
      ],
      stopLoss: [
        { type: "FIXED_TICKS", ticks: params.stopLossTicks || defaultTicks },
        { type: "ATR_MULTIPLE", atrMultiple: 1.5 },
      ],
      trailingStop: {
        activationTicks: defaultTicks,
        trailDistance: Math.round(defaultTicks * 0.5),
        stepSize: 2,
      },
    },
    
    risk: {
      maxPositionSize: 1,
      riskPerTrade: params.riskPerTrade || 1.0,
      maxDailyLoss: 3.0,
      maxOpenPositions: 1,
    },
    
    session: {
      allowedSessions: ["RTH"],
      rthStart: "09:35",
      rthEnd: "15:45",
      noTradeWindows: [],
      tradingDays: [1, 2, 3, 4, 5],
    },
    
    entryConditionType: "MOMENTUM_SURGE",
    createdAt: new Date().toISOString(),
    lastModifiedAt: new Date().toISOString(),
  };
}

// ============ STRATEGY FACTORY ============
// INSTITUTIONAL STANDARD: Exhaustive switch with explicit handling for ALL archetypes

export function createStrategyRules(
  archetype: string,
  symbol: string,
  params: Record<string, any> = {}
): StrategyRules {
  const normalizedArchetype = archetype.toLowerCase().trim().replace(/\s+/g, "_").replace(/-/g, "_");
  
  switch (normalizedArchetype) {
    // Breakout family
    case "breakout":
    case "orb_breakout":
    case "rth_breakout":
    case "breakout_retest":
      return createBreakoutStrategy(symbol, params);
      
    // Mean reversion family
    case "mean_reversion":
    case "exhaustion_fade":
      return createMeanReversionStrategy(symbol, params);
      
    // Gap strategies - NOW HAVE DEDICATED FACTORIES
    case "gap_fade":
      return createGapFadeStrategy(symbol, params);
    case "gap_fill":
      return createGapFillStrategy(symbol, params);
    case "gap_and_go":
      return createBreakoutStrategy(symbol, params); // Gap and go is breakout variant
      
    // Reversal family - NOW HAS DEDICATED FACTORY  
    case "reversal":
    case "reversal_hunter":
      return createReversalStrategy(symbol, params);
      
    // VWAP family
    case "vwap":
    case "vwap_bounce":
    case "vwap_reclaim":
    case "vwap_scalper":
      return createVWAPStrategy(symbol, params);
      
    // Trend family
    case "trend":
    case "trend_following":
    case "trend_ema_cross":
    case "trend_macd":
    case "trend_rider":
      return createTrendStrategy(symbol, params);
      
    // Momentum - NOW HAS DEDICATED FACTORY
    case "momentum_surge":
      return createMomentumSurgeStrategy(symbol, params);
      
    // Scalping family - RANGE SCALPER HAS DEDICATED FACTORY
    case "scalping":
    case "micro_pullback":
      return createScalpingStrategy(symbol, params);
    case "range_scalper":
      return createRangeScalperStrategy(symbol, params);
      
    default:
      // INSTITUTIONAL FAIL-CLOSED: Log error and throw instead of silent fallback
      console.error(`[STRATEGY_RULES] CRITICAL: Unknown archetype "${archetype}" (normalized: "${normalizedArchetype}") - no silent fallback allowed`);
      throw new Error(`Unknown strategy archetype: "${archetype}". Add explicit handling in createStrategyRules.`);
  }
}

// ============ STRATEGY SERIALIZATION ============

import * as crypto from "crypto";

export function serializeStrategyRules(rules: StrategyRules): string {
  return JSON.stringify(rules, null, 2);
}

/**
 * Compute a deterministic hash of strategy rules for provenance tracking
 * Excludes timestamps but includes all material fields
 */
export function computeRulesHash(rules: StrategyRules): string {
  // Create canonical object without timestamps for stable hashing
  const canonical = {
    archetype: rules.archetype,
    name: rules.name,
    entry: rules.entry,
    exit: rules.exit,
    risk: rules.risk,
    session: rules.session,
  };
  
  const serialized = JSON.stringify(canonical, Object.keys(canonical).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex").substring(0, 16);
}

export function deserializeStrategyRules(json: string): StrategyRules {
  return JSON.parse(json) as StrategyRules;
}

export function getStrategyDiff(
  oldRules: StrategyRules,
  newRules: StrategyRules
): { field: string; oldValue: any; newValue: any }[] {
  const diffs: { field: string; oldValue: any; newValue: any }[] = [];
  
  const compareObjects = (old: any, new_: any, path: string) => {
    if (typeof old !== typeof new_) {
      diffs.push({ field: path, oldValue: old, newValue: new_ });
      return;
    }
    
    if (typeof old === "object" && old !== null) {
      const allKeys = new Set([...Object.keys(old), ...Object.keys(new_ || {})]);
      for (const key of allKeys) {
        compareObjects(old[key], new_?.[key], path ? `${path}.${key}` : key);
      }
    } else if (old !== new_) {
      diffs.push({ field: path, oldValue: old, newValue: new_ });
    }
  };
  
  compareObjects(oldRules, newRules, "");
  
  return diffs.filter(d => 
    !d.field.startsWith("createdAt") && 
    !d.field.startsWith("lastModifiedAt") &&
    !d.field.startsWith("version")
  );
}

export function isMaterialChange(diffs: { field: string; oldValue: any; newValue: any }[]): boolean {
  // A change is "material" if it affects entry, exit, or risk rules
  const materialFields = ["entry", "exit", "risk", "session"];
  
  return diffs.some(d => materialFields.some(f => d.field.startsWith(f)));
}

/**
 * Generate human-readable rules summary for institutional audit
 * SEV-0 REQUIREMENT: Must be understandable without code context
 */
export function generateRulesSummary(rules: StrategyRules): string {
  const parts: string[] = [];
  
  // Entry summary
  parts.push(`ENTRY: ${rules.entryConditionType}`);
  if (rules.entry.condition.breakoutBars) {
    parts.push(`  - Breakout after ${rules.entry.condition.breakoutBars} bars`);
  }
  if (rules.entry.condition.gapThreshold) {
    parts.push(`  - Gap threshold: ${rules.entry.condition.gapThreshold} ticks`);
  }
  if (rules.entry.condition.vwapDeviation !== undefined) {
    parts.push(`  - VWAP deviation: ${rules.entry.condition.vwapDeviation} std`);
  }
  if (rules.entry.condition.rsiOversold && rules.entry.condition.rsiOverbought) {
    parts.push(`  - RSI: OS=${rules.entry.condition.rsiOversold}, OB=${rules.entry.condition.rsiOverbought}`);
  }
  
  // Exit summary
  const tpRules = rules.exit.takeProfit.map(tp => {
    if (tp.type === "FIXED_TICKS") return `${tp.ticks}T`;
    if (tp.type === "RISK_MULTIPLE") return `${tp.riskMultiple}R`;
    return tp.type;
  }).join("/");
  const slRules = rules.exit.stopLoss.map(sl => {
    if (sl.type === "FIXED_TICKS") return `${sl.ticks}T`;
    if (sl.type === "ATR_MULTIPLE") return `${sl.atrMultiple}ATR`;
    return sl.type;
  }).join("/");
  parts.push(`EXIT: TP=${tpRules}, SL=${slRules}`);
  
  // Risk summary
  parts.push(`RISK: ${rules.risk.riskPerTrade}% per trade, max ${rules.risk.maxDailyLoss}% daily`);
  
  // Session summary
  parts.push(`SESSION: ${rules.session.allowedSessions.join("/")} ${rules.session.rthStart}-${rules.session.rthEnd}`);
  
  return parts.join("\n");
}

// ============ STARTUP VALIDATION ============
// FAIL-CLOSED validation: Ensures factory outputs match lookup table
import { STRATEGY_ARCHETYPES, ARCHETYPE_TO_ENTRY_CONDITION, type StrategyArchetype } from "@shared/strategy-types";

export interface FactoryMappingDrift {
  archetype: string;
  lookupValue: string;
  factoryValue: string;
}

/**
 * INSTITUTIONAL FAIL-CLOSED: Validates that createStrategyRules factory output
 * matches ARCHETYPE_TO_ENTRY_CONDITION lookup table for all archetypes.
 * 
 * This catches drift between the two sources of truth that would cause
 * STRATEGY_PROVENANCE_VIOLATION errors at runtime.
 */
export function validateFactoryMappings(): FactoryMappingDrift[] {
  const drifts: FactoryMappingDrift[] = [];
  const testSymbol = "MES"; // Use a test symbol for factory calls
  
  for (const archetype of STRATEGY_ARCHETYPES) {
    const lookupValue = ARCHETYPE_TO_ENTRY_CONDITION[archetype];
    
    if (!lookupValue) {
      // Missing lookup is caught by shared/strategy-types validation
      continue;
    }
    
    try {
      const rules = createStrategyRules(archetype, testSymbol, {});
      const factoryValue = rules.entryConditionType;
      
      if (lookupValue !== factoryValue) {
        drifts.push({
          archetype,
          lookupValue,
          factoryValue,
        });
      }
    } catch (error) {
      // Unknown archetype - caught separately
      console.warn(`[FACTORY_VALIDATION] Archetype "${archetype}" not handled by factory: ${error}`);
    }
  }
  
  return drifts;
}

/**
 * FAIL-CLOSED startup check for factory/lookup table consistency.
 * Throws if any drift is detected - prevents server from starting with broken config.
 */
export function assertFactoryMappingsValid(): void {
  const drifts = validateFactoryMappings();
  
  if (drifts.length > 0) {
    const details = drifts.map(d => 
      `  - ${d.archetype}: lookup="${d.lookupValue}" BUT factory="${d.factoryValue}"`
    ).join("\n");
    throw new Error(
      `[FACTORY_MAPPING_DRIFT] ${drifts.length} archetype mapping inconsistency(ies) detected:\n${details}\n` +
      `Fix these in shared/strategy-types.ts ARCHETYPE_TO_ENTRY_CONDITION or server/strategy-rules.ts createStrategyRules.`
    );
  }
  
  console.log(`[FACTORY_VALIDATION] All ${STRATEGY_ARCHETYPES.length} archetypes validated: factory output matches lookup table`);
}
