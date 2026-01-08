/**
 * Canonical Instrument Specification Registry
 * 
 * Single source of truth for all traded instruments.
 * Used by: backtest executor, paper sim, risk engine, PnL calc, UI
 * 
 * INSTITUTIONAL STANDARDS:
 * - Tick size and point value from CME specifications
 * - Session templates for RTH/ETH windows
 * - Commission and slippage defaults for realistic simulation
 * - Decimal.js for all P&L calculations to prevent floating-point drift
 */

import Decimal from "decimal.js";

Decimal.config({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface InstrumentSpec {
  symbol: string;
  fullName: string;
  exchange: string;
  assetClass: string;
  tickSize: number;
  pointValue: number;
  currency: string;
  tradingHours: {
    rth: { start: string; end: string }; // Regular Trading Hours (Eastern)
    eth: { start: string; end: string }; // Extended Trading Hours
    timezone: string;
  };
  minPriceIncrement: number;
  priceDecimals: number;
  commission: number; // Per contract default
  slippageTicks: number; // Default slippage assumption
  marginRequirement?: number;
  category: "equity_index" | "commodity" | "currency" | "bond";
  // Sanity bounds for price validation
  priceBounds: {
    min: number;
    max: number;
    maxDailyMove: number; // Max % move per day before flagging
  };
}

// CME E-mini and Micro futures specifications
export const INSTRUMENT_REGISTRY: Record<string, InstrumentSpec> = {
  // E-mini S&P 500
  ES: {
    symbol: "ES",
    fullName: "E-mini S&P 500 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.25,
    pointValue: 50,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" }, // Next day
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.25,
    priceDecimals: 2,
    commission: 2.25,
    slippageTicks: 1,
    marginRequirement: 15000,
    category: "equity_index",
    priceBounds: {
      min: 1000,
      max: 15000, // S&P 500 can reach 6000+ currently
      maxDailyMove: 0.10, // 10% circuit breaker
    },
  },

  // Micro E-mini S&P 500
  MES: {
    symbol: "MES",
    fullName: "Micro E-mini S&P 500 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.25,
    pointValue: 5,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.25,
    priceDecimals: 2,
    commission: 0.62,
    slippageTicks: 1,
    marginRequirement: 1500,
    category: "equity_index",
    priceBounds: {
      min: 1000,
      max: 15000, // S&P 500 can reach 6000+ currently
      maxDailyMove: 0.10,
    },
  },

  // E-mini Nasdaq-100
  NQ: {
    symbol: "NQ",
    fullName: "E-mini Nasdaq-100 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.25,
    pointValue: 20,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.25,
    priceDecimals: 2,
    commission: 2.25,
    slippageTicks: 1,
    marginRequirement: 20000,
    category: "equity_index",
    priceBounds: {
      min: 5000,
      max: 30000,
      maxDailyMove: 0.10,
    },
  },

  // Micro E-mini Nasdaq-100
  MNQ: {
    symbol: "MNQ",
    fullName: "Micro E-mini Nasdaq-100 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.25,
    pointValue: 2,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.25,
    priceDecimals: 2,
    commission: 0.62,
    slippageTicks: 1,
    marginRequirement: 2000,
    category: "equity_index",
    priceBounds: {
      min: 5000,
      max: 30000,
      maxDailyMove: 0.10,
    },
  },

  // E-mini Dow
  YM: {
    symbol: "YM",
    fullName: "E-mini Dow Futures",
    exchange: "CBOT",
    assetClass: "Equity Index",
    tickSize: 1.0,
    pointValue: 5,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 1.0,
    priceDecimals: 0,
    commission: 2.25,
    slippageTicks: 1,
    marginRequirement: 10000,
    category: "equity_index",
    priceBounds: {
      min: 15000,
      max: 50000,
      maxDailyMove: 0.10,
    },
  },

  // Micro E-mini Dow
  MYM: {
    symbol: "MYM",
    fullName: "Micro E-mini Dow Futures",
    exchange: "CBOT",
    assetClass: "Equity Index",
    tickSize: 1.0,
    pointValue: 0.50,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 1.0,
    priceDecimals: 0,
    commission: 0.62,
    slippageTicks: 1,
    marginRequirement: 1000,
    category: "equity_index",
    priceBounds: {
      min: 15000,
      max: 50000,
      maxDailyMove: 0.10,
    },
  },

  // E-mini Russell 2000
  RTY: {
    symbol: "RTY",
    fullName: "E-mini Russell 2000 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.10,
    pointValue: 50,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.10,
    priceDecimals: 1,
    commission: 2.25,
    slippageTicks: 1,
    marginRequirement: 8000,
    category: "equity_index",
    priceBounds: {
      min: 1000,
      max: 3000,
      maxDailyMove: 0.10,
    },
  },

  // Micro E-mini Russell 2000
  M2K: {
    symbol: "M2K",
    fullName: "Micro E-mini Russell 2000 Futures",
    exchange: "CME",
    assetClass: "Equity Index",
    tickSize: 0.10,
    pointValue: 5,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:30", end: "16:00" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.10,
    priceDecimals: 1,
    commission: 0.62,
    slippageTicks: 1,
    marginRequirement: 800,
    category: "equity_index",
    priceBounds: {
      min: 1000,
      max: 3000,
      maxDailyMove: 0.10,
    },
  },

  // Crude Oil
  CL: {
    symbol: "CL",
    fullName: "Crude Oil Futures",
    exchange: "NYMEX",
    assetClass: "Commodity",
    tickSize: 0.01,
    pointValue: 1000,
    currency: "USD",
    tradingHours: {
      rth: { start: "09:00", end: "14:30" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.01,
    priceDecimals: 2,
    commission: 2.50,
    slippageTicks: 1,
    marginRequirement: 8000,
    category: "commodity",
    priceBounds: {
      min: 20,
      max: 200,
      maxDailyMove: 0.15,
    },
  },

  // Gold
  GC: {
    symbol: "GC",
    fullName: "Gold Futures",
    exchange: "COMEX",
    assetClass: "Commodity",
    tickSize: 0.10,
    pointValue: 100,
    currency: "USD",
    tradingHours: {
      rth: { start: "08:20", end: "13:30" },
      eth: { start: "18:00", end: "17:00" },
      timezone: "America/New_York",
    },
    minPriceIncrement: 0.10,
    priceDecimals: 1,
    commission: 2.50,
    slippageTicks: 1,
    marginRequirement: 10000,
    category: "commodity",
    priceBounds: {
      min: 1000,
      max: 3500,
      maxDailyMove: 0.05,
    },
  },
};

/**
 * Get instrument spec by symbol (case-insensitive)
 * Returns null if not found
 */
export function getInstrumentSpec(symbol: string): InstrumentSpec | null {
  const normalized = symbol.toUpperCase().trim();
  return INSTRUMENT_REGISTRY[normalized] || null;
}

/**
 * Validate that a symbol is supported
 */
export function isValidSymbol(symbol: string): boolean {
  return getInstrumentSpec(symbol) !== null;
}

/**
 * Round a price to the instrument's tick size
 */
export function roundToTick(price: number, spec: InstrumentSpec): number {
  const ticks = Math.round(price / spec.tickSize);
  return Number((ticks * spec.tickSize).toFixed(spec.priceDecimals));
}

/**
 * Calculate PnL for a trade (institutional formula)
 * pnl = (exit_price - entry_price) * point_value * qty - commissions - slippage_cost
 * 
 * INSTITUTIONAL: Uses Decimal.js for all calculations to prevent floating-point drift
 * in financial calculations (IEEE 754 issues with 0.1 + 0.2 = 0.30000000000000004)
 */
export function calculateTradePnL(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: "BUY" | "SELL",
  spec: InstrumentSpec,
  options?: {
    commission?: number;
    slippageTicks?: number;
  }
): {
  grossPnl: number;
  commission: number;
  slippageCost: number;
  netPnl: number;
} {
  const dEntry = new Decimal(entryPrice);
  const dExit = new Decimal(exitPrice);
  const dQty = new Decimal(quantity);
  const dPointValue = new Decimal(spec.pointValue);
  const dTickSize = new Decimal(spec.tickSize);
  
  const commissionRate = new Decimal(options?.commission ?? spec.commission);
  const dCommission = commissionRate.times(dQty).times(2);
  
  const slippageTicksVal = new Decimal(options?.slippageTicks ?? spec.slippageTicks);
  const dSlippageCost = slippageTicksVal.times(dTickSize).times(dPointValue).times(dQty).times(2);

  const priceDiff = side === "BUY" ? dExit.minus(dEntry) : dEntry.minus(dExit);
  const dGrossPnl = priceDiff.times(dPointValue).times(dQty);
  const dNetPnl = dGrossPnl.minus(dCommission).minus(dSlippageCost);

  return {
    grossPnl: dGrossPnl.toDecimalPlaces(2).toNumber(),
    commission: dCommission.toDecimalPlaces(2).toNumber(),
    slippageCost: dSlippageCost.toDecimalPlaces(2).toNumber(),
    netPnl: dNetPnl.toDecimalPlaces(2).toNumber(),
  };
}

/**
 * Validate a bar is within sanity bounds
 */
export interface BarValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBar(
  bar: { open: number; high: number; low: number; close: number; time: Date },
  spec: InstrumentSpec,
  previousClose?: number
): BarValidationResult {
  const errors: string[] = [];

  // Check for NaN/null
  if (isNaN(bar.open) || isNaN(bar.high) || isNaN(bar.low) || isNaN(bar.close)) {
    errors.push("OHLC contains NaN values");
  }

  // Check high/low relationship
  if (bar.high < bar.low) {
    errors.push(`High (${bar.high}) is less than Low (${bar.low})`);
  }

  // Check open/close within high/low
  if (bar.open > bar.high || bar.open < bar.low) {
    errors.push(`Open (${bar.open}) outside high/low range`);
  }
  if (bar.close > bar.high || bar.close < bar.low) {
    errors.push(`Close (${bar.close}) outside high/low range`);
  }

  // Check price bounds
  if (bar.close < spec.priceBounds.min || bar.close > spec.priceBounds.max) {
    errors.push(`Close (${bar.close}) outside valid range [${spec.priceBounds.min}, ${spec.priceBounds.max}]`);
  }

  // Check tick alignment
  const roundedClose = roundToTick(bar.close, spec);
  if (Math.abs(bar.close - roundedClose) > 0.0001) {
    errors.push(`Close (${bar.close}) not aligned to tick size ${spec.tickSize}`);
  }

  // Check daily move limit if previous close provided
  if (previousClose && previousClose > 0) {
    const movePercent = Math.abs(bar.close - previousClose) / previousClose;
    if (movePercent > spec.priceBounds.maxDailyMove) {
      errors.push(`Daily move ${(movePercent * 100).toFixed(1)}% exceeds limit ${(spec.priceBounds.maxDailyMove * 100)}%`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a given time is within RTH for the instrument
 */
export function isWithinRTH(time: Date, spec: InstrumentSpec): boolean {
  // Simple implementation - real version would use timezone-aware checks
  const hours = time.getHours();
  const minutes = time.getMinutes();
  const timeNum = hours * 100 + minutes;

  const [startH, startM] = spec.tradingHours.rth.start.split(":").map(Number);
  const [endH, endM] = spec.tradingHours.rth.end.split(":").map(Number);

  const startNum = startH * 100 + startM;
  const endNum = endH * 100 + endM;

  return timeNum >= startNum && timeNum <= endNum;
}

/**
 * Get all supported symbols
 */
export function getSupportedSymbols(): string[] {
  return Object.keys(INSTRUMENT_REGISTRY);
}

/**
 * Get instrument spec as a diagnostic object (no secrets)
 */
export function getInstrumentDiagnostic(symbol: string): {
  found: boolean;
  spec: InstrumentSpec | null;
  tickRoundingExample: { input: number; rounded: number } | null;
  pnlExample: { entry: number; exit: number; qty: number; pnl: ReturnType<typeof calculateTradePnL> } | null;
} {
  const spec = getInstrumentSpec(symbol);
  if (!spec) {
    return { found: false, spec: null, tickRoundingExample: null, pnlExample: null };
  }

  const midPrice = (spec.priceBounds.min + spec.priceBounds.max) / 2;
  const testPrice = midPrice + 0.123; // Intentionally not tick-aligned

  return {
    found: true,
    spec,
    tickRoundingExample: {
      input: testPrice,
      rounded: roundToTick(testPrice, spec),
    },
    pnlExample: {
      entry: roundToTick(midPrice, spec),
      exit: roundToTick(midPrice + spec.tickSize * 10, spec),
      qty: 1,
      pnl: calculateTradePnL(
        roundToTick(midPrice, spec),
        roundToTick(midPrice + spec.tickSize * 10, spec),
        1,
        "BUY",
        spec
      ),
    },
  };
}
