/**
 * Strategy Executor - Deterministic Trade Generation
 * 
 * This module executes strategy rules against historical bars to generate trades.
 * NO randomness - all decisions are based on explicit rules and price action.
 * 
 * Produces:
 * - Entry signals based on rule conditions
 * - Exit signals based on TP/SL/time rules
 * - Accurate PnL with slippage and fees
 */

import { 
  type StrategyRules, 
  type EntryCondition,
  type EntryConditionType,
  type Side 
} from "./strategy-rules";
import { 
  type InstrumentSpec, 
  roundToTick, 
  calculateTradePnL 
} from "./instrument-spec";
import { assertNever } from "@shared/strategy-types";

/**
 * Convert UTC Date to Eastern Time components
 * CME futures use Eastern Time for RTH (Regular Trading Hours)
 * RTH: 9:30 AM - 4:00 PM ET
 */
export function getEasternTimeComponents(utcDate: Date): { hours: number; minutes: number; dayOfWeek: number } {
  const etString = utcDate.toLocaleString("en-US", { 
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  });
  
  const [weekday, time] = etString.includes(",") 
    ? etString.split(", ") 
    : [etString.slice(0, 3), etString.slice(4)];
  
  const [hours, minutes] = time.split(":").map(Number);
  
  const dayMap: Record<string, number> = {
    "Sun": 0, "Mon": 1, "Tue": 2, "Wed": 3, "Thu": 4, "Fri": 5, "Sat": 6
  };
  
  // Normalize hour 24 to 0 (JavaScript locale sometimes returns "24:00" for midnight)
  const normalizedHours = isNaN(hours) ? 0 : hours % 24;
  
  return {
    hours: normalizedHours,
    minutes: isNaN(minutes) ? 0 : minutes,
    dayOfWeek: dayMap[weekday] ?? utcDate.getDay()
  };
}

// Diagnostic logging for entry rejections
interface EntryDiagnostic {
  barIndex: number;
  time: Date;
  conditionType: EntryConditionType;
  primarySignal: Side | null;
  rejectionReason: string | null;
  indicators: {
    rsi: number;
    vwap: number;
    ema9: number;
    ema21: number;
    momentum: number;
    close: number;
  };
}

let entryDiagnostics: EntryDiagnostic[] = [];
let diagnosticsEnabled = false;

// LAB mode relaxation - reduces entry strictness to generate baseline trades
let labModeRelaxation = false;
// SEV-1: Session bypass for FULL_24x5 mode - no hidden session filtering
let sessionBypassEnabled = false;

export function setLabModeRelaxation(enabled: boolean) {
  labModeRelaxation = enabled;
}

export function isLabModeRelaxed(): boolean {
  return labModeRelaxation;
}

// SEV-1: Control session filtering bypass (for FULL_24x5 mode)
export function setSessionBypass(enabled: boolean) {
  sessionBypassEnabled = enabled;
}

export function getSessionBypass(): boolean {
  return sessionBypassEnabled;
}

export function enableDiagnostics(enabled: boolean = true) {
  diagnosticsEnabled = enabled;
  if (enabled) {
    entryDiagnostics = [];
  }
}

export function getDiagnostics(): EntryDiagnostic[] {
  return entryDiagnostics;
}

export function clearDiagnostics() {
  entryDiagnostics = [];
}

export interface Bar {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Trade {
  entryTime: Date;
  exitTime: Date;
  side: Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  grossPnl: number;
  fees: number;
  slippage: number;
  entryReason: string;
  exitReason: string;
  ruleVersion: string;
}

interface Position {
  side: Side;
  entryPrice: number;
  entryTime: Date;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  entryReason: string;
  barsHeld: number;
  highestPrice: number;
  lowestPrice: number;
  trailingStop?: number;
}

interface IndicatorState {
  ema9: number;
  ema20: number;
  ema21: number;
  sma50: number;
  vwap: number;
  vwapSum: number;
  volumeSum: number;
  rsi: number;
  rsiGain: number;
  rsiLoss: number;
  atr: number;
  atrValues: number[];
  momentum: number;
  highOfDay: number;
  lowOfDay: number;
  openOfDay: number;
  avgVolume: number;
  volumeHistory: number[];
  priceHistory: number[];
}

export interface ExecutionResult {
  trades: Trade[];
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalBars: number;
  tradingBars: number;
}

/**
 * Execute strategy rules against historical bars
 */
export function executeStrategy(
  bars: Bar[],
  rules: StrategyRules,
  spec: InstrumentSpec,
  initialCapital: number = 10000
): ExecutionResult {
  if (bars.length < 50) {
    return {
      trades: [],
      totalPnl: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      totalBars: bars.length,
      tradingBars: 0,
    };
  }

  const trades: Trade[] = [];
  let position: Position | null = null;
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  const equityHistory: number[] = [];
  
  // Validate and ensure bars have proper Date objects
  const validBars = bars.filter(b => {
    if (!(b.time instanceof Date) || isNaN(b.time.getTime())) {
      return false;
    }
    return true;
  });
  
  if (validBars.length < 50) {
    console.log(`[STRATEGY_EXECUTOR] Insufficient valid bars: ${validBars.length} (original: ${bars.length})`);
    return {
      trades: [],
      totalPnl: 0,
      winRate: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      totalBars: bars.length,
      tradingBars: 0,
    };
  }
  
  // Initialize indicators
  const indicators = initializeIndicators(validBars.slice(0, 50), spec);
  let currentDay = validBars[0].time.toDateString();
  
  // Debug counters
  let outsideSessionCount = 0;
  let inNoTradeWindowCount = 0;
  let tradingBarCount = 0;
  let entrySignalCount = 0;
  
  // Reset session diagnostic flag for this execution
  sessionDiagLogged = false;
  
  // Process bars
  for (let i = 50; i < validBars.length; i++) {
    const bar = validBars[i];
    const prevBar = validBars[i - 1];
    
    // Check for day change - reset daily indicators
    if (bar.time.toDateString() !== currentDay) {
      currentDay = bar.time.toDateString();
      indicators.highOfDay = bar.high;
      indicators.lowOfDay = bar.low;
      indicators.openOfDay = bar.open;
      indicators.vwap = bar.close;
      indicators.vwapSum = bar.close * bar.volume;
      indicators.volumeSum = bar.volume;
    }
    
    // Update indicators
    updateIndicators(indicators, bar, prevBar);
    
    // Check session rules
    if (!isWithinTradingSession(bar.time, rules.session)) {
      outsideSessionCount++;
      // If in position and outside session, close it
      if (position) {
        const trade = closePosition(position, bar, "SESSION_END", rules, spec);
        trades.push(trade);
        equity += trade.pnl;
        position = null;
      }
      continue;
    }
    
    // Check no-trade windows
    if (isInNoTradeWindow(bar.time, rules.session.noTradeWindows)) {
      inNoTradeWindowCount++;
      continue;
    }
    
    tradingBarCount++;
    
    // If in position, check exits
    if (position) {
      position.barsHeld++;
      position.highestPrice = Math.max(position.highestPrice, bar.high);
      position.lowestPrice = Math.min(position.lowestPrice, bar.low);
      
      // Update trailing stop if active
      if (rules.exit.trailingStop && position.trailingStop) {
        position.trailingStop = updateTrailingStop(position, bar, rules.exit.trailingStop);
      }
      
      const exitSignal = checkExitConditions(position, bar, rules, indicators, spec);
      
      if (exitSignal) {
        const trade = closePosition(position, bar, exitSignal.reason, rules, spec);
        trades.push(trade);
        equity += trade.pnl;
        position = null;
      }
    }
    
    // If not in position, check entries
    if (!position) {
      const entrySignal = checkEntryConditions(validBars, i, rules, indicators, spec);
      
      if (entrySignal) {
        entrySignalCount++;
        position = openPosition(entrySignal, bar, rules, indicators, spec);
      }
    }
    
    // Track equity and drawdown
    equityHistory.push(equity);
    peakEquity = Math.max(peakEquity, equity);
    const currentDrawdown = (peakEquity - equity) / peakEquity * 100;
    maxDrawdown = Math.max(maxDrawdown, currentDrawdown);
  }
  
  // Close any remaining position at end
  if (position && validBars.length > 0) {
    const lastBar = validBars[validBars.length - 1];
    const trade = closePosition(position, lastBar, "END_OF_DATA", rules, spec);
    trades.push(trade);
    equity += trade.pnl;
  }
  
  // Log debug info for trade generation analysis
  console.log(`[STRATEGY_EXECUTOR] bars=${bars.length} valid_bars=${validBars.length} session_bars=${tradingBarCount} outside_session=${outsideSessionCount} no_trade_window=${inNoTradeWindowCount} entry_signals=${entrySignalCount} trades=${trades.length}`);
  
  // Calculate metrics
  const winners = trades.filter(t => t.pnl > 0);
  const winRate = trades.length > 0 ? (winners.length / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const sharpeRatio = calculateSharpeRatio(trades, initialCapital);
  
  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    sharpeRatio,
    totalBars: bars.length,
    tradingBars: tradingBarCount,
  };
}

function initializeIndicators(bars: Bar[], spec: InstrumentSpec): IndicatorState {
  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);
  
  return {
    ema9: calculateEMA(closes, 9),
    ema20: calculateEMA(closes, 20),
    ema21: calculateEMA(closes, 21),
    sma50: closes.reduce((a, b) => a + b, 0) / closes.length,
    vwap: closes[closes.length - 1],
    vwapSum: closes.reduce((sum, c, i) => sum + c * volumes[i], 0),
    volumeSum: volumes.reduce((a, b) => a + b, 0),
    rsi: 50,
    rsiGain: 0,
    rsiLoss: 0,
    atr: calculateATR(bars),
    atrValues: [],
    momentum: 0,
    highOfDay: Math.max(...bars.map(b => b.high)),
    lowOfDay: Math.min(...bars.map(b => b.low)),
    openOfDay: bars[0].open,
    avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
    volumeHistory: volumes.slice(-20),
    priceHistory: closes.slice(-20),
  };
}

function updateIndicators(indicators: IndicatorState, bar: Bar, prevBar: Bar): void {
  // Update EMAs
  const ema9Mult = 2 / (9 + 1);
  const ema20Mult = 2 / (20 + 1);
  const ema21Mult = 2 / (21 + 1);
  
  indicators.ema9 = bar.close * ema9Mult + indicators.ema9 * (1 - ema9Mult);
  indicators.ema20 = bar.close * ema20Mult + indicators.ema20 * (1 - ema20Mult);
  indicators.ema21 = bar.close * ema21Mult + indicators.ema21 * (1 - ema21Mult);
  
  // Update VWAP
  indicators.vwapSum += bar.close * bar.volume;
  indicators.volumeSum += bar.volume;
  indicators.vwap = indicators.volumeSum > 0 ? indicators.vwapSum / indicators.volumeSum : bar.close;
  
  // Update RSI
  const change = bar.close - prevBar.close;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  const rsiPeriod = 14;
  const rsiMult = 1 / rsiPeriod;
  
  indicators.rsiGain = gain * rsiMult + indicators.rsiGain * (1 - rsiMult);
  indicators.rsiLoss = loss * rsiMult + indicators.rsiLoss * (1 - rsiMult);
  
  if (indicators.rsiLoss > 0) {
    const rs = indicators.rsiGain / indicators.rsiLoss;
    indicators.rsi = 100 - (100 / (1 + rs));
  }
  
  // Update ATR
  const tr = Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevBar.close),
    Math.abs(bar.low - prevBar.close)
  );
  indicators.atrValues.push(tr);
  if (indicators.atrValues.length > 14) {
    indicators.atrValues.shift();
  }
  indicators.atr = indicators.atrValues.reduce((a, b) => a + b, 0) / indicators.atrValues.length;
  
  // Update momentum
  indicators.priceHistory.push(bar.close);
  if (indicators.priceHistory.length > 20) {
    indicators.priceHistory.shift();
  }
  if (indicators.priceHistory.length >= 10) {
    indicators.momentum = bar.close - indicators.priceHistory[indicators.priceHistory.length - 10];
  }
  
  // Update high/low of day
  indicators.highOfDay = Math.max(indicators.highOfDay, bar.high);
  indicators.lowOfDay = Math.min(indicators.lowOfDay, bar.low);
  
  // Update volume history
  indicators.volumeHistory.push(bar.volume);
  if (indicators.volumeHistory.length > 20) {
    indicators.volumeHistory.shift();
  }
  indicators.avgVolume = indicators.volumeHistory.reduce((a, b) => a + b, 0) / indicators.volumeHistory.length;
}

function checkEntryConditions(
  bars: Bar[],
  index: number,
  rules: StrategyRules,
  indicators: IndicatorState,
  spec: InstrumentSpec
): { side: Side; reason: string } | null {
  const bar = bars[index];
  const entry = rules.entry;
  const condition = entry.condition;
  
  // Check based on entry type - INSTITUTIONAL EXHAUSTIVE SWITCH
  let signalSide: Side | null = null;
  let signalReason = "";
  let rejectionReason: string | null = null;
  
  switch (condition.type) {
    case "BREAKOUT":
      signalSide = checkBreakoutEntry(bars, index, condition, indicators);
      signalReason = "BREAKOUT";
      if (!signalSide) rejectionReason = "No breakout signal";
      break;
      
    case "MEAN_REVERSION":
      signalSide = checkMeanReversionEntry(bar, condition, indicators);
      signalReason = "MEAN_REVERSION";
      if (!signalSide) rejectionReason = "RSI/VWAP deviation not extreme";
      break;
      
    case "VWAP_TOUCH":
      signalSide = checkVWAPEntry(bar, condition, indicators);
      signalReason = "VWAP_TOUCH";
      if (!signalSide) rejectionReason = "VWAP touch conditions not met";
      break;
      
    case "TREND_CONTINUATION":
      signalSide = checkTrendEntry(bar, condition, indicators);
      signalReason = "TREND_CONTINUATION";
      if (!signalSide) rejectionReason = "EMA crossover not confirmed";
      break;
      
    case "GAP_FADE":
      signalSide = checkGapFadeEntry(bar, condition, indicators);
      signalReason = "GAP_FADE";
      if (!signalSide) rejectionReason = "Gap fade conditions not met";
      break;
      
    case "GAP_FILL":
      signalSide = checkGapFillEntry(bar, condition, indicators);
      signalReason = "GAP_FILL";
      if (!signalSide) rejectionReason = "Gap fill momentum not confirmed";
      break;
      
    case "REVERSAL":
      signalSide = checkReversalEntry(bars, index, condition, indicators);
      signalReason = "REVERSAL";
      if (!signalSide) rejectionReason = "Reversal pattern not detected";
      break;
      
    case "RANGE_SCALP":
      signalSide = checkRangeScalpEntry(bars, index, condition, indicators);
      signalReason = "RANGE_SCALP";
      if (!signalSide) rejectionReason = "Not at range boundary";
      break;
      
    case "MOMENTUM_SURGE":
      signalSide = checkMomentumSurgeEntry(bar, condition, indicators);
      signalReason = "MOMENTUM_SURGE";
      if (!signalSide) rejectionReason = "Momentum surge not confirmed";
      break;
      
    default:
      // INSTITUTIONAL FAIL-CLOSED: Catch unhandled entry condition types at compile time
      assertNever(condition.type, "entry condition type");
  }
  
  // Diagnostic logging
  if (diagnosticsEnabled && index % 50 === 0) { // Sample every 50 bars
    entryDiagnostics.push({
      barIndex: index,
      time: bar.time,
      conditionType: condition.type,
      primarySignal: signalSide,
      rejectionReason: signalSide ? null : rejectionReason,
      indicators: {
        rsi: indicators.rsi,
        vwap: indicators.vwap,
        ema9: indicators.ema9,
        ema21: indicators.ema21,
        momentum: indicators.momentum,
        close: bar.close,
      },
    });
  }
  
  if (!signalSide) {
    return null;
  }
  
  // Check confirmations
  for (const confirmation of entry.confirmations) {
    if (!checkConfirmation(bar, confirmation, indicators, signalSide)) {
      if (diagnosticsEnabled) {
        entryDiagnostics.push({
          barIndex: index,
          time: bar.time,
          conditionType: condition.type,
          primarySignal: signalSide,
          rejectionReason: `Confirmation failed: ${confirmation.type}`,
          indicators: {
            rsi: indicators.rsi,
            vwap: indicators.vwap,
            ema9: indicators.ema9,
            ema21: indicators.ema21,
            momentum: indicators.momentum,
            close: bar.close,
          },
        });
      }
      return null;
    }
  }
  
  // Check invalidations
  for (const invalidation of entry.invalidations) {
    if (checkInvalidation(bars, index, invalidation, indicators)) {
      if (diagnosticsEnabled) {
        entryDiagnostics.push({
          barIndex: index,
          time: bar.time,
          conditionType: condition.type,
          primarySignal: signalSide,
          rejectionReason: `Invalidation triggered: ${invalidation.type}`,
          indicators: {
            rsi: indicators.rsi,
            vwap: indicators.vwap,
            ema9: indicators.ema9,
            ema21: indicators.ema21,
            momentum: indicators.momentum,
            close: bar.close,
          },
        });
      }
      return null;
    }
  }
  
  return { side: signalSide, reason: signalReason };
}

function checkBreakoutEntry(
  bars: Bar[],
  index: number,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: shorter lookback, lower threshold
  const isLabMode = labModeRelaxation;
  const lookback = isLabMode ? 5 : (condition.breakoutBars || 10);
  const threshold = isLabMode ? 2 : (condition.breakoutThreshold || 8);
  const thresholdMultiplier = isLabMode ? 0.1 : 0.25; // LAB: easier breakout
  
  if (index < lookback) return null;
  
  const recentBars = bars.slice(index - lookback, index);
  const rangeHigh = Math.max(...recentBars.map(b => b.high));
  const rangeLow = Math.min(...recentBars.map(b => b.low));
  const currentBar = bars[index];
  
  // Breakout long
  if (currentBar.close > rangeHigh) {
    const breakoutSize = currentBar.close - rangeHigh;
    if (breakoutSize >= threshold * thresholdMultiplier) {
      return "LONG";
    }
  }
  
  // Breakout short
  if (currentBar.close < rangeLow) {
    const breakoutSize = rangeLow - currentBar.close;
    if (breakoutSize >= threshold * thresholdMultiplier) {
      return "SHORT";
    }
  }
  
  return null;
}

function checkMeanReversionEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: use more lenient thresholds
  const isLabMode = labModeRelaxation;
  const deviationBands = isLabMode ? 1.0 : (condition.deviationBands || 2.0);
  const rsiOversold = isLabMode ? 40 : (condition.rsiOversold || 30);
  const rsiOverbought = isLabMode ? 60 : (condition.rsiOverbought || 70);
  const deviationMultiplier = isLabMode ? 0.25 : 0.5;
  
  // Check RSI extremes with price deviation
  const deviation = Math.abs(bar.close - indicators.vwap) / indicators.atr;
  
  // Oversold condition - go long
  if (indicators.rsi < rsiOversold && deviation > deviationBands * deviationMultiplier) {
    if (bar.close < indicators.vwap) {
      return "LONG";
    }
  }
  
  // Overbought condition - go short
  if (indicators.rsi > rsiOverbought && deviation > deviationBands * deviationMultiplier) {
    if (bar.close > indicators.vwap) {
      return "SHORT";
    }
  }
  
  return null;
}

function checkVWAPEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: use wider deviation zone
  const isLabMode = labModeRelaxation;
  const vwapDeviation = isLabMode ? 1.2 : (condition.vwapDeviation || 0.5);
  const vwapReclaim = condition.vwapReclaim ?? true;
  
  const deviation = (bar.close - indicators.vwap) / indicators.atr;
  const deviationAbs = Math.abs(deviation);
  
  // Check for VWAP touch/reclaim
  if (deviationAbs < vwapDeviation) {
    // Price is near VWAP
    if (vwapReclaim && !isLabMode) {
      // Look for reclaim (skip in LAB mode for more signals)
      if (bar.low < indicators.vwap && bar.close > indicators.vwap) {
        return "LONG";
      }
      if (bar.high > indicators.vwap && bar.close < indicators.vwap) {
        return "SHORT";
      }
    } else {
      // Simple VWAP bounce (LAB mode uses this simpler logic)
      if (bar.close > indicators.vwap) {
        return "LONG";
      }
      if (bar.close < indicators.vwap) {
        return "SHORT";
      }
    }
  }
  
  return null;
}

function checkTrendEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: skip momentum confirmation for more baseline trades
  const isLabMode = labModeRelaxation;
  const emaShort = condition.trendEmaShort || 9;
  const emaLong = condition.trendEmaLong || 21;
  
  // Use pre-calculated EMAs (9 and 21 are standard)
  const shortEma = emaShort === 9 ? indicators.ema9 : indicators.ema20;
  const longEma = emaLong === 21 ? indicators.ema21 : indicators.sma50;
  
  // EMA crossover with momentum confirmation (LAB: skip momentum check)
  if (shortEma > longEma && bar.close > shortEma) {
    if (isLabMode || indicators.momentum > 0) {
      return "LONG";
    }
  }
  
  if (shortEma < longEma && bar.close < shortEma) {
    if (isLabMode || indicators.momentum < 0) {
      return "SHORT";
    }
  }
  
  return null;
}

function checkGapFadeEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: lower gap threshold, skip bar direction check
  const isLabMode = labModeRelaxation;
  const gapThreshold = isLabMode ? 3 : (condition.gapThreshold || 8);
  const gapSize = bar.open - indicators.openOfDay;
  const gapInTicks = Math.abs(gapSize / (indicators.atr / 10));
  const thresholdMultiplier = isLabMode ? 0.25 : 0.5;
  
  // Gap must meet minimum threshold
  if (gapInTicks < gapThreshold * thresholdMultiplier) {
    return null;
  }
  
  // Gap up - fade short (expect gap to fill down)
  if (gapSize > 0 && (isLabMode || bar.close < bar.open)) {
    // Confirmation: RSI not extremely overbought (widened in LAB mode)
    const rsiLimit = isLabMode ? 75 : (condition.rsiOverbought || 65);
    if (indicators.rsi < rsiLimit) {
      return "SHORT";
    }
  }
  
  // Gap down - fade long (expect gap to fill up)
  if (gapSize < 0 && (isLabMode || bar.close > bar.open)) {
    // Confirmation: RSI not extremely oversold (widened in LAB mode)
    const rsiLimit = isLabMode ? 25 : (condition.rsiOversold || 35);
    if (indicators.rsi > rsiLimit) {
      return "LONG";
    }
  }
  
  return null;
}

function checkGapFillEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: lower thresholds for more baseline trades
  const isLabMode = labModeRelaxation;
  const gapThreshold = isLabMode ? 2 : (condition.gapThreshold || 6);
  const gapFillTarget = isLabMode ? 0.2 : (condition.gapFillTarget || 0.5);
  const thresholdMultiplier = isLabMode ? 0.2 : 0.5;
  
  const gapSize = bar.open - indicators.openOfDay;
  const gapInTicks = Math.abs(gapSize / (indicators.atr / 10));
  
  // Gap must meet minimum threshold
  if (gapInTicks < gapThreshold * thresholdMultiplier) {
    return null;
  }
  
  // Calculate fill percentage
  const fillAmount = Math.abs(bar.close - bar.open);
  const fillPct = fillAmount / Math.abs(gapSize);
  
  // Gap up filling - price moving towards fill
  if (gapSize > 0 && fillPct >= gapFillTarget * 0.5) {
    // LAB mode: skip bar direction/momentum checks
    if (isLabMode || (bar.close < bar.open && indicators.momentum < 0)) {
      return "SHORT";
    }
  }
  
  // Gap down filling - price moving towards fill
  if (gapSize < 0 && fillPct >= gapFillTarget * 0.5) {
    // LAB mode: skip bar direction/momentum checks
    if (isLabMode || (bar.close > bar.open && indicators.momentum > 0)) {
      return "LONG";
    }
  }
  
  return null;
}

function checkReversalEntry(
  bars: Bar[],
  index: number,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: wider RSI bands, skip volume confirmation
  const isLabMode = labModeRelaxation;
  const reversalBars = isLabMode ? 3 : (condition.reversalBars || 5);
  const pivotStrength = isLabMode ? 2 : (condition.pivotStrength || 3);
  const rsiOversold = isLabMode ? 40 : (condition.rsiOversold || 25);
  const rsiOverbought = isLabMode ? 60 : (condition.rsiOverbought || 75);
  
  if (index < reversalBars + pivotStrength) return null;
  
  const currentBar = bars[index];
  const recentBars = bars.slice(index - reversalBars, index);
  
  // Check for bullish reversal (at low)
  const isAtLow = currentBar.low <= Math.min(...recentBars.map(b => b.low));
  if (isAtLow && indicators.rsi < rsiOversold) {
    // Bullish reversal candle: closes higher than open (skip in LAB mode)
    if (isLabMode || currentBar.close > currentBar.open) {
      // Volume confirmation (skip in LAB mode for more signals)
      if (isLabMode || currentBar.volume > indicators.avgVolume) {
        return "LONG";
      }
    }
  }
  
  // Check for bearish reversal (at high)
  const isAtHigh = currentBar.high >= Math.max(...recentBars.map(b => b.high));
  if (isAtHigh && indicators.rsi > rsiOverbought) {
    // Bearish reversal candle: closes lower than open (skip in LAB mode)
    if (isLabMode || currentBar.close < currentBar.open) {
      // Volume confirmation (skip in LAB mode for more signals)
      if (isLabMode || currentBar.volume > indicators.avgVolume) {
        return "SHORT";
      }
    }
  }
  
  return null;
}

function checkRangeScalpEntry(
  bars: Bar[],
  index: number,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: use wider parameters to generate more baseline trades
  const isLabMode = labModeRelaxation;
  const rangeMinBars = isLabMode ? 5 : (condition.rangeMinBars || 10);
  const rangeThreshold = isLabMode ? 3.0 : (condition.rangeThreshold || 1.5);
  const bandWidth = isLabMode ? 0.35 : 0.2; // LAB: 35% zone, PROD: 20% zone
  
  if (index < rangeMinBars) return null;
  
  const currentBar = bars[index];
  const rangeBars = bars.slice(index - rangeMinBars, index);
  
  // Calculate range
  const rangeHigh = Math.max(...rangeBars.map(b => b.high));
  const rangeLow = Math.min(...rangeBars.map(b => b.low));
  const rangeSize = rangeHigh - rangeLow;
  
  // Check if range is tight enough (not trending)
  // LAB mode allows wider ranges
  if (rangeSize > indicators.atr * rangeThreshold) {
    return null; // Range too wide, might be trending
  }
  
  // Buy at lower range
  const lowerBand = rangeLow + rangeSize * bandWidth;
  // LAB mode: relax bar direction requirement
  if (currentBar.close <= lowerBand) {
    if (isLabMode || currentBar.close > currentBar.open) {
      return "LONG";
    }
  }
  
  // Sell at upper range
  const upperBand = rangeHigh - rangeSize * bandWidth;
  // LAB mode: relax bar direction requirement
  if (currentBar.close >= upperBand) {
    if (isLabMode || currentBar.close < currentBar.open) {
      return "SHORT";
    }
  }
  
  return null;
}

function checkMomentumSurgeEntry(
  bar: Bar,
  condition: EntryCondition,
  indicators: IndicatorState
): Side | null {
  // LAB mode relaxation: lower thresholds for more baseline trades
  const isLabMode = labModeRelaxation;
  const emaShort = condition.trendEmaShort || 9;
  const emaLong = condition.trendEmaLong || 21;
  
  const shortEma = emaShort === 9 ? indicators.ema9 : indicators.ema20;
  const longEma = emaLong === 21 ? indicators.ema21 : indicators.sma50;
  
  // Strong momentum requirement (relaxed in LAB mode)
  const momentumStrength = Math.abs(indicators.momentum) / indicators.atr;
  const momentumThreshold = isLabMode ? 0.2 : 0.5;
  
  if (momentumStrength < momentumThreshold) {
    return null;
  }
  
  // Volume multiplier (relaxed in LAB mode)
  const volumeMultiplier = isLabMode ? 0.8 : 1.3;
  
  // Bullish surge
  if (shortEma > longEma && 
      bar.close > shortEma && 
      indicators.momentum > 0 &&
      (isLabMode || bar.volume > indicators.avgVolume * volumeMultiplier)) {
    return "LONG";
  }
  
  // Bearish surge
  if (shortEma < longEma && 
      bar.close < shortEma && 
      indicators.momentum < 0 &&
      (isLabMode || bar.volume > indicators.avgVolume * volumeMultiplier)) {
    return "SHORT";
  }
  
  return null;
}

function checkConfirmation(
  bar: Bar,
  confirmation: { type: string; volumeMultiplier?: number; minBarsHeld?: number; aboveEma?: number; belowEma?: number; atrMultiplier?: number; momentumPositive?: boolean; momentumThreshold?: number },
  indicators: IndicatorState,
  side: Side
): boolean {
  switch (confirmation.type) {
    case "VOLUME":
      const volMultiplier = confirmation.volumeMultiplier || 1.5;
      return bar.volume >= indicators.avgVolume * volMultiplier;
      
    case "TREND":
      if (confirmation.aboveEma) {
        return bar.close > indicators.ema20;
      }
      if (confirmation.belowEma) {
        return bar.close < indicators.ema20;
      }
      return true;
      
    case "MOMENTUM":
      if (confirmation.momentumPositive !== undefined) {
        return confirmation.momentumPositive ? indicators.momentum > 0 : indicators.momentum < 0;
      }
      if (confirmation.momentumThreshold !== undefined) {
        return side === "LONG" 
          ? indicators.momentum > confirmation.momentumThreshold
          : indicators.momentum < -confirmation.momentumThreshold;
      }
      return true;
      
    case "VOLATILITY":
      const atrMult = confirmation.atrMultiplier || 1.0;
      const barRange = bar.high - bar.low;
      return barRange <= indicators.atr * atrMult;
      
    default:
      return true;
  }
}

function checkInvalidation(
  bars: Bar[],
  index: number,
  invalidation: { type: string; priceRetracePct?: number; maxBarsWithoutEntry?: number; volumeDryUp?: number },
  indicators: IndicatorState
): boolean {
  switch (invalidation.type) {
    case "VOLUME":
      const volThreshold = invalidation.volumeDryUp || 0.5;
      return bars[index].volume < indicators.avgVolume * volThreshold;
      
    default:
      return false;
  }
}

function checkExitConditions(
  position: Position,
  bar: Bar,
  rules: StrategyRules,
  indicators: IndicatorState,
  spec: InstrumentSpec
): { reason: string } | null {
  // Check stop loss
  if (position.side === "LONG" && bar.low <= position.stopLoss) {
    return { reason: "STOP_LOSS" };
  }
  if (position.side === "SHORT" && bar.high >= position.stopLoss) {
    return { reason: "STOP_LOSS" };
  }
  
  // Check take profit
  if (position.side === "LONG" && bar.high >= position.takeProfit) {
    return { reason: "TAKE_PROFIT" };
  }
  if (position.side === "SHORT" && bar.low <= position.takeProfit) {
    return { reason: "TAKE_PROFIT" };
  }
  
  // Check trailing stop
  if (position.trailingStop) {
    if (position.side === "LONG" && bar.low <= position.trailingStop) {
      return { reason: "TRAILING_STOP" };
    }
    if (position.side === "SHORT" && bar.high >= position.trailingStop) {
      return { reason: "TRAILING_STOP" };
    }
  }
  
  // Check time stop
  if (rules.exit.timeStop) {
    if (rules.exit.timeStop.maxBarsInTrade && position.barsHeld >= rules.exit.timeStop.maxBarsInTrade) {
      return { reason: "TIME_STOP" };
    }
  }
  
  return null;
}

function openPosition(
  signal: { side: Side; reason: string },
  bar: Bar,
  rules: StrategyRules,
  indicators: IndicatorState,
  spec: InstrumentSpec
): Position {
  // Calculate stop loss and take profit based on rules
  let stopLoss: number;
  let takeProfit: number;
  
  const primarySL = rules.exit.stopLoss[0];
  const primaryTP = rules.exit.takeProfit[0];
  
  // Calculate stop loss
  if (primarySL.type === "FIXED_TICKS" && primarySL.ticks) {
    const slDistance = primarySL.ticks * spec.tickSize;
    stopLoss = signal.side === "LONG" 
      ? bar.close - slDistance 
      : bar.close + slDistance;
  } else if (primarySL.type === "ATR_MULTIPLE" && primarySL.atrMultiple) {
    const slDistance = indicators.atr * primarySL.atrMultiple;
    stopLoss = signal.side === "LONG" 
      ? bar.close - slDistance 
      : bar.close + slDistance;
  } else {
    // Default to 10 ticks
    const slDistance = 10 * spec.tickSize;
    stopLoss = signal.side === "LONG" ? bar.close - slDistance : bar.close + slDistance;
  }
  
  // Calculate take profit
  if (primaryTP.type === "FIXED_TICKS" && primaryTP.ticks) {
    const tpDistance = primaryTP.ticks * spec.tickSize;
    takeProfit = signal.side === "LONG" 
      ? bar.close + tpDistance 
      : bar.close - tpDistance;
  } else if (primaryTP.type === "RISK_MULTIPLE" && primaryTP.riskMultiple) {
    const risk = Math.abs(bar.close - stopLoss);
    const tpDistance = risk * primaryTP.riskMultiple;
    takeProfit = signal.side === "LONG" 
      ? bar.close + tpDistance 
      : bar.close - tpDistance;
  } else if (primaryTP.type === "ATR_MULTIPLE" && primaryTP.atrMultiple) {
    const tpDistance = indicators.atr * primaryTP.atrMultiple;
    takeProfit = signal.side === "LONG" 
      ? bar.close + tpDistance 
      : bar.close - tpDistance;
  } else {
    // Default to 2:1 risk/reward
    const risk = Math.abs(bar.close - stopLoss);
    const tpDistance = risk * 2;
    takeProfit = signal.side === "LONG" ? bar.close + tpDistance : bar.close - tpDistance;
  }
  
  return {
    side: signal.side,
    entryPrice: roundToTick(bar.close, spec),
    entryTime: bar.time,
    quantity: rules.risk.maxPositionSize,
    stopLoss: roundToTick(stopLoss, spec),
    takeProfit: roundToTick(takeProfit, spec),
    entryReason: signal.reason,
    barsHeld: 0,
    highestPrice: bar.high,
    lowestPrice: bar.low,
    trailingStop: undefined,
  };
}

function closePosition(
  position: Position,
  bar: Bar,
  reason: string,
  rules: StrategyRules,
  spec: InstrumentSpec
): Trade {
  let exitPrice: number;
  
  // Determine exit price based on reason
  switch (reason) {
    case "STOP_LOSS":
      exitPrice = position.stopLoss;
      break;
    case "TAKE_PROFIT":
      exitPrice = position.takeProfit;
      break;
    case "TRAILING_STOP":
      exitPrice = position.trailingStop || bar.close;
      break;
    default:
      exitPrice = bar.close;
  }
  
  exitPrice = roundToTick(exitPrice, spec);
  
  // Calculate PnL with slippage and fees
  const pnlResult = calculateTradePnL(
    position.entryPrice,
    exitPrice,
    position.quantity,
    position.side === "LONG" ? "BUY" : "SELL",
    spec
  );
  
  return {
    entryTime: position.entryTime,
    exitTime: bar.time,
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    pnl: pnlResult.netPnl,
    grossPnl: pnlResult.grossPnl,
    fees: pnlResult.commission,
    slippage: pnlResult.slippageCost,
    entryReason: position.entryReason,
    exitReason: reason,
    ruleVersion: rules.version,
  };
}

function updateTrailingStop(
  position: Position,
  bar: Bar,
  trailingConfig: { activationTicks?: number; trailDistance?: number; stepSize?: number }
): number | undefined {
  const activationTicks = trailingConfig.activationTicks || 10;
  const trailDistance = trailingConfig.trailDistance || 8;
  
  // Calculate current profit in approximate ticks
  const profitTicks = position.side === "LONG"
    ? (position.highestPrice - position.entryPrice) / 0.25
    : (position.entryPrice - position.lowestPrice) / 0.25;
  
  if (profitTicks < activationTicks) {
    return position.trailingStop;
  }
  
  // Calculate new trailing stop
  const trailDistancePrice = trailDistance * 0.25;
  
  let newStop: number;
  if (position.side === "LONG") {
    newStop = position.highestPrice - trailDistancePrice;
    if (position.trailingStop && newStop <= position.trailingStop) {
      return position.trailingStop;
    }
  } else {
    newStop = position.lowestPrice + trailDistancePrice;
    if (position.trailingStop && newStop >= position.trailingStop) {
      return position.trailingStop;
    }
  }
  
  return newStop;
}

// Track if we've logged session diagnostics for this execution
let sessionDiagLogged = false;

export function isWithinTradingSession(time: Date, session: StrategyRules["session"]): boolean {
  // SEV-1: If session bypass is enabled (FULL_24x5 mode), always return true
  // This removes hidden session gating for LAB research
  if (sessionBypassEnabled) {
    return true;
  }
  
  // CRITICAL: Convert UTC timestamp to Eastern Time for CME futures
  const et = getEasternTimeComponents(time);
  
  // Log first few calls for diagnostics
  if (!sessionDiagLogged) {
    console.log(`[SESSION_CHECK] UTC=${time.toISOString()} ET_hour=${et.hours} ET_min=${et.minutes} ET_day=${et.dayOfWeek} tradingDays=${JSON.stringify(session.tradingDays)} rthStart=${session.rthStart} rthEnd=${session.rthEnd}`);
    sessionDiagLogged = true;
  }
  
  if (!session.tradingDays.includes(et.dayOfWeek)) {
    return false;
  }
  
  const timeMinutes = et.hours * 60 + et.minutes;
  
  const [startHour, startMin] = session.rthStart.split(":").map(Number);
  const [endHour, endMin] = session.rthEnd.split(":").map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
}

export function isInNoTradeWindow(time: Date, windows: StrategyRules["session"]["noTradeWindows"]): boolean {
  // SEV-1: If session bypass is enabled (FULL_24x5 mode), no trade windows don't apply
  if (sessionBypassEnabled) {
    return false;
  }
  
  // CRITICAL: Convert UTC timestamp to Eastern Time for CME futures
  const et = getEasternTimeComponents(time);
  const timeMinutes = et.hours * 60 + et.minutes;
  
  for (const window of windows) {
    if (window.daysOfWeek && !window.daysOfWeek.includes(et.dayOfWeek)) {
      continue;
    }
    
    const [startHour, startMin] = window.start.split(":").map(Number);
    const [endHour, endMin] = window.end.split(":").map(Number);
    
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    
    if (timeMinutes >= startMinutes && timeMinutes <= endMinutes) {
      return true;
    }
  }
  
  return false;
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  
  return ema;
}

function calculateATR(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    sum += tr;
  }
  
  return sum / (bars.length - 1);
}

function calculateSharpeRatio(trades: Trade[], initialCapital: number): number {
  if (trades.length < 2) return 0;
  
  const returns = trades.map(t => t.pnl / initialCapital);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  // Annualize (assuming daily returns, ~252 trading days)
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  return annualizedReturn / annualizedStdDev;
}
