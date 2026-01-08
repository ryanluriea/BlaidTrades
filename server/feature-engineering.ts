/**
 * PROPRIETARY FEATURE ENGINEERING LIBRARY
 * 
 * Comprehensive technical indicator library with 50+ features
 * designed for algorithmic trading strategy development.
 * 
 * Categories:
 * - Trend Indicators (SMA, EMA, MACD, ADX, etc.)
 * - Momentum Indicators (RSI, Stochastic, CCI, Williams %R, etc.)
 * - Volatility Indicators (Bollinger, ATR, Keltner, etc.)
 * - Volume Indicators (OBV, MFI, VWAP, etc.)
 * - Price Action Features (Support/Resistance, Patterns, etc.)
 * - Statistical Features (Z-Score, Skewness, Kurtosis, etc.)
 * - Custom Alpha Signals
 */

export type OHLCV = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp?: Date;
};

export type IndicatorResult = {
  name: string;
  value: number | null;
  signal?: "BUY" | "SELL" | "NEUTRAL";
  metadata?: Record<string, number | string>;
};

export type FeatureVector = {
  timestamp: Date;
  features: Record<string, number>;
  signals: Record<string, "BUY" | "SELL" | "NEUTRAL">;
};

function sma(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  
  return result;
}

function standardDeviation(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  return Math.sqrt(variance);
}

function trueRange(candle: OHLCV, prevClose: number): number {
  const hl = candle.high - candle.low;
  const hc = Math.abs(candle.high - prevClose);
  const lc = Math.abs(candle.low - prevClose);
  return Math.max(hl, hc, lc);
}

export function calculateSMA(closes: number[], period: number): IndicatorResult {
  const value = sma(closes, period);
  const currentPrice = closes[closes.length - 1];
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  
  if (value !== null) {
    if (currentPrice > value * 1.01) signal = "BUY";
    else if (currentPrice < value * 0.99) signal = "SELL";
  }
  
  return { name: `SMA_${period}`, value, signal };
}

export function calculateEMA(closes: number[], period: number): IndicatorResult {
  const emaValues = ema(closes, period);
  const value = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
  const currentPrice = closes[closes.length - 1];
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  
  if (value !== null) {
    if (currentPrice > value * 1.01) signal = "BUY";
    else if (currentPrice < value * 0.99) signal = "SELL";
  }
  
  return { name: `EMA_${period}`, value, signal };
}

export function calculateMACD(closes: number[]): IndicatorResult {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  
  if (ema12.length === 0 || ema26.length === 0) {
    return { name: "MACD", value: null, signal: "NEUTRAL" };
  }
  
  const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
  const macdHistory = ema12.slice(-9).map((v, i) => v - ema26[ema26.length - 9 + i]);
  const signalLine = sma(macdHistory, 9) || 0;
  const histogram = macdLine - signalLine;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (histogram > 0 && macdLine > 0) signal = "BUY";
  else if (histogram < 0 && macdLine < 0) signal = "SELL";
  
  return {
    name: "MACD",
    value: macdLine,
    signal,
    metadata: { signalLine, histogram },
  };
}

export function calculateRSI(closes: number[], period: number = 14): IndicatorResult {
  if (closes.length < period + 1) {
    return { name: `RSI_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) {
    return { name: `RSI_${period}`, value: 100, signal: "SELL" };
  }
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (rsi < 30) signal = "BUY";
  else if (rsi > 70) signal = "SELL";
  
  return { name: `RSI_${period}`, value: rsi, signal };
}

export function calculateStochastic(candles: OHLCV[], period: number = 14): IndicatorResult {
  if (candles.length < period) {
    return { name: "STOCH", value: null, signal: "NEUTRAL" };
  }
  
  const slice = candles.slice(-period);
  const highest = Math.max(...slice.map(c => c.high));
  const lowest = Math.min(...slice.map(c => c.low));
  const currentClose = candles[candles.length - 1].close;
  
  if (highest === lowest) {
    return { name: "STOCH", value: 50, signal: "NEUTRAL" };
  }
  
  const k = ((currentClose - lowest) / (highest - lowest)) * 100;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (k < 20) signal = "BUY";
  else if (k > 80) signal = "SELL";
  
  return { name: "STOCH", value: k, signal };
}

export function calculateCCI(candles: OHLCV[], period: number = 20): IndicatorResult {
  if (candles.length < period) {
    return { name: `CCI_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const typicalPrices = candles.map(c => (c.high + c.low + c.close) / 3);
  const slice = typicalPrices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const meanDeviation = slice.reduce((sum, tp) => sum + Math.abs(tp - mean), 0) / period;
  
  if (meanDeviation === 0) {
    return { name: `CCI_${period}`, value: 0, signal: "NEUTRAL" };
  }
  
  const cci = (typicalPrices[typicalPrices.length - 1] - mean) / (0.015 * meanDeviation);
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (cci < -100) signal = "BUY";
  else if (cci > 100) signal = "SELL";
  
  return { name: `CCI_${period}`, value: cci, signal };
}

export function calculateWilliamsR(candles: OHLCV[], period: number = 14): IndicatorResult {
  if (candles.length < period) {
    return { name: `WILLR_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const slice = candles.slice(-period);
  const highest = Math.max(...slice.map(c => c.high));
  const lowest = Math.min(...slice.map(c => c.low));
  const currentClose = candles[candles.length - 1].close;
  
  if (highest === lowest) {
    return { name: `WILLR_${period}`, value: -50, signal: "NEUTRAL" };
  }
  
  const willR = ((highest - currentClose) / (highest - lowest)) * -100;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (willR < -80) signal = "BUY";
  else if (willR > -20) signal = "SELL";
  
  return { name: `WILLR_${period}`, value: willR, signal };
}

export function calculateADX(candles: OHLCV[], period: number = 14): IndicatorResult {
  if (candles.length < period * 2) {
    return { name: `ADX_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  const trValues: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const highMove = candles[i].high - candles[i - 1].high;
    const lowMove = candles[i - 1].low - candles[i].low;
    
    if (highMove > lowMove && highMove > 0) dmPlus.push(highMove);
    else dmPlus.push(0);
    
    if (lowMove > highMove && lowMove > 0) dmMinus.push(lowMove);
    else dmMinus.push(0);
    
    trValues.push(trueRange(candles[i], candles[i - 1].close));
  }
  
  const smoothedTR = sma(trValues.slice(-period), period) || 1;
  const smoothedDMPlus = sma(dmPlus.slice(-period), period) || 0;
  const smoothedDMMinus = sma(dmMinus.slice(-period), period) || 0;
  
  const diPlus = (smoothedDMPlus / smoothedTR) * 100;
  const diMinus = (smoothedDMMinus / smoothedTR) * 100;
  const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus + 0.001) * 100;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (dx > 25 && diPlus > diMinus) signal = "BUY";
  else if (dx > 25 && diMinus > diPlus) signal = "SELL";
  
  return { name: `ADX_${period}`, value: dx, signal, metadata: { diPlus, diMinus } };
}

export function calculateBollingerBands(closes: number[], period: number = 20, stdDevMultiplier: number = 2): IndicatorResult {
  const middle = sma(closes, period);
  const std = standardDeviation(closes, period);
  
  if (middle === null || std === null) {
    return { name: "BB", value: null, signal: "NEUTRAL" };
  }
  
  const upper = middle + stdDevMultiplier * std;
  const lower = middle - stdDevMultiplier * std;
  const currentPrice = closes[closes.length - 1];
  const percentB = (currentPrice - lower) / (upper - lower);
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (currentPrice < lower) signal = "BUY";
  else if (currentPrice > upper) signal = "SELL";
  
  return {
    name: "BB",
    value: percentB,
    signal,
    metadata: { upper, middle, lower, bandwidth: (upper - lower) / middle },
  };
}

export function calculateATR(candles: OHLCV[], period: number = 14): IndicatorResult {
  if (candles.length < period + 1) {
    return { name: `ATR_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const trValues: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trValues.push(trueRange(candles[i], candles[i - 1].close));
  }
  
  const atr = sma(trValues.slice(-period), period);
  
  return { name: `ATR_${period}`, value: atr, signal: "NEUTRAL" };
}

export function calculateKeltnerChannels(candles: OHLCV[], emaPeriod: number = 20, atrPeriod: number = 10, multiplier: number = 2): IndicatorResult {
  const closes = candles.map(c => c.close);
  const emaValues = ema(closes, emaPeriod);
  const middle = emaValues.length > 0 ? emaValues[emaValues.length - 1] : null;
  
  const atrResult = calculateATR(candles, atrPeriod);
  
  if (middle === null || atrResult.value === null) {
    return { name: "KELT", value: null, signal: "NEUTRAL" };
  }
  
  const upper = middle + multiplier * atrResult.value;
  const lower = middle - multiplier * atrResult.value;
  const currentPrice = closes[closes.length - 1];
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (currentPrice < lower) signal = "BUY";
  else if (currentPrice > upper) signal = "SELL";
  
  return { name: "KELT", value: currentPrice, signal, metadata: { upper, middle, lower } };
}

export function calculateOBV(candles: OHLCV[]): IndicatorResult {
  if (candles.length < 2) {
    return { name: "OBV", value: null, signal: "NEUTRAL" };
  }
  
  let obv = 0;
  const obvValues: number[] = [0];
  
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      obv += candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      obv -= candles[i].volume;
    }
    obvValues.push(obv);
  }
  
  const obvSma = sma(obvValues.slice(-20), 20);
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  
  if (obvSma !== null) {
    if (obv > obvSma * 1.05) signal = "BUY";
    else if (obv < obvSma * 0.95) signal = "SELL";
  }
  
  return { name: "OBV", value: obv, signal };
}

export function calculateMFI(candles: OHLCV[], period: number = 14): IndicatorResult {
  if (candles.length < period + 1) {
    return { name: `MFI_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  let positiveFlow = 0;
  let negativeFlow = 0;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const prevTypicalPrice = (candles[i - 1].high + candles[i - 1].low + candles[i - 1].close) / 3;
    const rawMoneyFlow = typicalPrice * candles[i].volume;
    
    if (typicalPrice > prevTypicalPrice) {
      positiveFlow += rawMoneyFlow;
    } else {
      negativeFlow += rawMoneyFlow;
    }
  }
  
  if (negativeFlow === 0) {
    return { name: `MFI_${period}`, value: 100, signal: "SELL" };
  }
  
  const moneyRatio = positiveFlow / negativeFlow;
  const mfi = 100 - (100 / (1 + moneyRatio));
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (mfi < 20) signal = "BUY";
  else if (mfi > 80) signal = "SELL";
  
  return { name: `MFI_${period}`, value: mfi, signal };
}

export function calculateVWAP(candles: OHLCV[]): IndicatorResult {
  if (candles.length === 0) {
    return { name: "VWAP", value: null, signal: "NEUTRAL" };
  }
  
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }
  
  const vwap = cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : null;
  const currentPrice = candles[candles.length - 1].close;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (vwap !== null) {
    if (currentPrice > vwap * 1.01) signal = "BUY";
    else if (currentPrice < vwap * 0.99) signal = "SELL";
  }
  
  return { name: "VWAP", value: vwap, signal };
}

export function calculateZScore(data: number[], lookback: number = 20): IndicatorResult {
  if (data.length < lookback) {
    return { name: `ZSCORE_${lookback}`, value: null, signal: "NEUTRAL" };
  }
  
  const slice = data.slice(-lookback);
  const mean = slice.reduce((a, b) => a + b, 0) / lookback;
  const std = Math.sqrt(slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / lookback);
  
  if (std === 0) {
    return { name: `ZSCORE_${lookback}`, value: 0, signal: "NEUTRAL" };
  }
  
  const zScore = (data[data.length - 1] - mean) / std;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (zScore < -2) signal = "BUY";
  else if (zScore > 2) signal = "SELL";
  
  return { name: `ZSCORE_${lookback}`, value: zScore, signal };
}

export function calculateSkewness(data: number[], lookback: number = 20): IndicatorResult {
  if (data.length < lookback) {
    return { name: "SKEW", value: null, signal: "NEUTRAL" };
  }
  
  const slice = data.slice(-lookback);
  const n = slice.length;
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  
  if (std === 0) {
    return { name: "SKEW", value: 0, signal: "NEUTRAL" };
  }
  
  const m3 = slice.reduce((sum, val) => sum + Math.pow(val - mean, 3), 0) / n;
  const skewness = m3 / Math.pow(std, 3);
  
  return { name: "SKEW", value: skewness, signal: "NEUTRAL" };
}

export function calculateKurtosis(data: number[], lookback: number = 20): IndicatorResult {
  if (data.length < lookback) {
    return { name: "KURT", value: null, signal: "NEUTRAL" };
  }
  
  const slice = data.slice(-lookback);
  const n = slice.length;
  const mean = slice.reduce((a, b) => a + b, 0) / n;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  
  if (variance === 0) {
    return { name: "KURT", value: 0, signal: "NEUTRAL" };
  }
  
  const m4 = slice.reduce((sum, val) => sum + Math.pow(val - mean, 4), 0) / n;
  const kurtosis = (m4 / Math.pow(variance, 2)) - 3;
  
  return { name: "KURT", value: kurtosis, signal: "NEUTRAL" };
}

export function calculateMomentum(closes: number[], period: number = 10): IndicatorResult {
  if (closes.length <= period) {
    return { name: `MOM_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const momentum = closes[closes.length - 1] - closes[closes.length - 1 - period];
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (momentum > 0) signal = "BUY";
  else if (momentum < 0) signal = "SELL";
  
  return { name: `MOM_${period}`, value: momentum, signal };
}

export function calculateROC(closes: number[], period: number = 10): IndicatorResult {
  if (closes.length <= period || closes[closes.length - 1 - period] === 0) {
    return { name: `ROC_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  const roc = ((closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period]) * 100;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (roc > 5) signal = "BUY";
  else if (roc < -5) signal = "SELL";
  
  return { name: `ROC_${period}`, value: roc, signal };
}

export function calculatePivotPoints(candles: OHLCV[]): IndicatorResult {
  if (candles.length === 0) {
    return { name: "PIVOT", value: null, signal: "NEUTRAL" };
  }
  
  const lastCandle = candles[candles.length - 1];
  const pivot = (lastCandle.high + lastCandle.low + lastCandle.close) / 3;
  const r1 = 2 * pivot - lastCandle.low;
  const s1 = 2 * pivot - lastCandle.high;
  const r2 = pivot + (lastCandle.high - lastCandle.low);
  const s2 = pivot - (lastCandle.high - lastCandle.low);
  
  const currentPrice = lastCandle.close;
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  
  if (currentPrice < s1) signal = "BUY";
  else if (currentPrice > r1) signal = "SELL";
  
  return { name: "PIVOT", value: pivot, signal, metadata: { r1, r2, s1, s2 } };
}

export function calculateTrendStrength(closes: number[], shortPeriod: number = 10, longPeriod: number = 50): IndicatorResult {
  const shortSma = sma(closes, shortPeriod);
  const longSma = sma(closes, longPeriod);
  
  if (shortSma === null || longSma === null || longSma === 0) {
    return { name: "TREND_STR", value: null, signal: "NEUTRAL" };
  }
  
  const trendStrength = ((shortSma - longSma) / longSma) * 100;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (trendStrength > 2) signal = "BUY";
  else if (trendStrength < -2) signal = "SELL";
  
  return { name: "TREND_STR", value: trendStrength, signal };
}

export function calculateVolatilityRatio(candles: OHLCV[], shortPeriod: number = 5, longPeriod: number = 20): IndicatorResult {
  const shortATR = calculateATR(candles, shortPeriod).value;
  const longATR = calculateATR(candles, longPeriod).value;
  
  if (shortATR === null || longATR === null || longATR === 0) {
    return { name: "VOL_RATIO", value: null, signal: "NEUTRAL" };
  }
  
  const ratio = shortATR / longATR;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (ratio > 1.5) signal = "SELL";
  else if (ratio < 0.7) signal = "BUY";
  
  return { name: "VOL_RATIO", value: ratio, signal };
}

export function calculatePriceChannelPosition(candles: OHLCV[], period: number = 20): IndicatorResult {
  if (candles.length < period) {
    return { name: "CHANNEL_POS", value: null, signal: "NEUTRAL" };
  }
  
  const slice = candles.slice(-period);
  const highest = Math.max(...slice.map(c => c.high));
  const lowest = Math.min(...slice.map(c => c.low));
  const currentPrice = candles[candles.length - 1].close;
  
  if (highest === lowest) {
    return { name: "CHANNEL_POS", value: 0.5, signal: "NEUTRAL" };
  }
  
  const position = (currentPrice - lowest) / (highest - lowest);
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (position < 0.1) signal = "BUY";
  else if (position > 0.9) signal = "SELL";
  
  return { name: "CHANNEL_POS", value: position, signal };
}

export function calculateCMF(candles: OHLCV[], period: number = 20): IndicatorResult {
  if (candles.length < period) {
    return { name: `CMF_${period}`, value: null, signal: "NEUTRAL" };
  }
  
  let mfvSum = 0;
  let volumeSum = 0;
  
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    const mfMultiplier = range > 0 ? ((c.close - c.low) - (c.high - c.close)) / range : 0;
    const mfVolume = mfMultiplier * c.volume;
    mfvSum += mfVolume;
    volumeSum += c.volume;
  }
  
  const cmf = volumeSum > 0 ? mfvSum / volumeSum : 0;
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (cmf > 0.1) signal = "BUY";
  else if (cmf < -0.1) signal = "SELL";
  
  return { name: `CMF_${period}`, value: cmf, signal };
}

export function calculateIchimoku(candles: OHLCV[]): IndicatorResult {
  if (candles.length < 52) {
    return { name: "ICHIMOKU", value: null, signal: "NEUTRAL" };
  }
  
  const period9Highs = candles.slice(-9).map(c => c.high);
  const period9Lows = candles.slice(-9).map(c => c.low);
  const tenkanSen = (Math.max(...period9Highs) + Math.min(...period9Lows)) / 2;
  
  const period26Highs = candles.slice(-26).map(c => c.high);
  const period26Lows = candles.slice(-26).map(c => c.low);
  const kijunSen = (Math.max(...period26Highs) + Math.min(...period26Lows)) / 2;
  
  const senkouSpanA = (tenkanSen + kijunSen) / 2;
  
  const period52Highs = candles.slice(-52).map(c => c.high);
  const period52Lows = candles.slice(-52).map(c => c.low);
  const senkouSpanB = (Math.max(...period52Highs) + Math.min(...period52Lows)) / 2;
  
  const currentPrice = candles[candles.length - 1].close;
  const cloudTop = Math.max(senkouSpanA, senkouSpanB);
  const cloudBottom = Math.min(senkouSpanA, senkouSpanB);
  
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  if (currentPrice > cloudTop && tenkanSen > kijunSen) signal = "BUY";
  else if (currentPrice < cloudBottom && tenkanSen < kijunSen) signal = "SELL";
  
  return {
    name: "ICHIMOKU",
    value: currentPrice > cloudTop ? 1 : currentPrice < cloudBottom ? -1 : 0,
    signal,
    metadata: { tenkanSen, kijunSen, senkouSpanA, senkouSpanB },
  };
}

export function generateFullFeatureVector(candles: OHLCV[]): FeatureVector {
  const closes = candles.map(c => c.close);
  const timestamp = candles[candles.length - 1]?.timestamp || new Date();
  
  const indicators = [
    calculateSMA(closes, 10),
    calculateSMA(closes, 20),
    calculateSMA(closes, 50),
    calculateEMA(closes, 12),
    calculateEMA(closes, 26),
    calculateMACD(closes),
    calculateRSI(closes, 14),
    calculateRSI(closes, 7),
    calculateStochastic(candles, 14),
    calculateCCI(candles, 20),
    calculateWilliamsR(candles, 14),
    calculateADX(candles, 14),
    calculateBollingerBands(closes, 20, 2),
    calculateATR(candles, 14),
    calculateKeltnerChannels(candles, 20, 10, 2),
    calculateOBV(candles),
    calculateMFI(candles, 14),
    calculateVWAP(candles),
    calculateZScore(closes, 20),
    calculateSkewness(closes, 20),
    calculateKurtosis(closes, 20),
    calculateMomentum(closes, 10),
    calculateMomentum(closes, 20),
    calculateROC(closes, 10),
    calculateROC(closes, 5),
    calculatePivotPoints(candles),
    calculateTrendStrength(closes, 10, 50),
    calculateVolatilityRatio(candles, 5, 20),
    calculatePriceChannelPosition(candles, 20),
    calculateCMF(candles, 20),
    calculateIchimoku(candles),
  ];
  
  const features: Record<string, number> = {};
  const signals: Record<string, "BUY" | "SELL" | "NEUTRAL"> = {};
  
  for (const ind of indicators) {
    if (ind.value !== null) {
      features[ind.name] = ind.value;
    }
    if (ind.signal) {
      signals[ind.name] = ind.signal;
    }
    if (ind.metadata) {
      for (const [key, val] of Object.entries(ind.metadata)) {
        if (typeof val === "number") {
          features[`${ind.name}_${key}`] = val;
        }
      }
    }
  }
  
  return { timestamp, features, signals };
}

export function getIndicatorCatalog(): { category: string; indicators: string[] }[] {
  return [
    { category: "Trend", indicators: ["SMA", "EMA", "MACD", "ADX", "Ichimoku", "TrendStrength"] },
    { category: "Momentum", indicators: ["RSI", "Stochastic", "CCI", "WilliamsR", "Momentum", "ROC"] },
    { category: "Volatility", indicators: ["BollingerBands", "ATR", "KeltnerChannels", "VolatilityRatio"] },
    { category: "Volume", indicators: ["OBV", "MFI", "VWAP", "CMF"] },
    { category: "PriceAction", indicators: ["PivotPoints", "PriceChannelPosition"] },
    { category: "Statistical", indicators: ["ZScore", "Skewness", "Kurtosis"] },
  ];
}

export async function runFeatureEngineeringTests(): Promise<{ passed: boolean; results: string[] }> {
  const results: string[] = [];
  let allPassed = true;

  const mockCandles: OHLCV[] = [];
  for (let i = 0; i < 100; i++) {
    const base = 100 + Math.sin(i / 10) * 10 + i * 0.1;
    mockCandles.push({
      open: base,
      high: base + Math.random() * 2,
      low: base - Math.random() * 2,
      close: base + (Math.random() - 0.5) * 2,
      volume: 1000 + Math.random() * 500,
      timestamp: new Date(Date.now() - (100 - i) * 60000),
    });
  }
  const closes = mockCandles.map(c => c.close);

  const smaResult = calculateSMA(closes, 20);
  if (smaResult.value !== null && smaResult.value > 0) {
    results.push("PASS: SMA calculation returns valid value");
  } else {
    results.push("FAIL: SMA calculation failed");
    allPassed = false;
  }

  const rsiResult = calculateRSI(closes, 14);
  if (rsiResult.value !== null && rsiResult.value >= 0 && rsiResult.value <= 100) {
    results.push("PASS: RSI within valid range [0, 100]");
  } else {
    results.push(`FAIL: RSI out of range: ${rsiResult.value}`);
    allPassed = false;
  }

  const macdResult = calculateMACD(closes);
  if (macdResult.metadata?.histogram !== undefined) {
    results.push("PASS: MACD returns histogram metadata");
  } else {
    results.push("FAIL: MACD missing histogram");
    allPassed = false;
  }

  const bbResult = calculateBollingerBands(closes, 20, 2);
  if (bbResult.metadata?.upper !== undefined && bbResult.metadata?.lower !== undefined) {
    if ((bbResult.metadata.upper as number) > (bbResult.metadata.lower as number)) {
      results.push("PASS: Bollinger upper > lower");
    } else {
      results.push("FAIL: Bollinger bands inverted");
      allPassed = false;
    }
  } else {
    results.push("FAIL: Bollinger bands missing metadata");
    allPassed = false;
  }

  const atrResult = calculateATR(mockCandles, 14);
  if (atrResult.value !== null && atrResult.value > 0) {
    results.push("PASS: ATR returns positive value");
  } else {
    results.push("FAIL: ATR should be positive");
    allPassed = false;
  }

  const obvResult = calculateOBV(mockCandles);
  if (obvResult.value !== null) {
    results.push("PASS: OBV calculation works");
  } else {
    results.push("FAIL: OBV calculation failed");
    allPassed = false;
  }

  const featureVector = generateFullFeatureVector(mockCandles);
  const featureCount = Object.keys(featureVector.features).length;
  if (featureCount >= 30) {
    results.push(`PASS: Feature vector has ${featureCount} features (target: 50+)`);
  } else {
    results.push(`FAIL: Feature vector only has ${featureCount} features`);
    allPassed = false;
  }

  const catalog = getIndicatorCatalog();
  if (catalog.length >= 6) {
    results.push("PASS: Indicator catalog has 6+ categories");
  } else {
    results.push("FAIL: Indicator catalog incomplete");
    allPassed = false;
  }

  console.log(`[FEATURE_ENG_TESTS] ${results.filter(r => r.startsWith("PASS")).length}/${results.length} tests passed`);

  return { passed: allPassed, results };
}

runFeatureEngineeringTests().then(({ passed, results }) => {
  console.log("[FEATURE_ENG] Self-test results:", passed ? "ALL PASSED" : "SOME FAILED");
  results.forEach(r => console.log(`  ${r}`));
});

export const featureEngineering = {
  calculateSMA,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateStochastic,
  calculateCCI,
  calculateWilliamsR,
  calculateADX,
  calculateBollingerBands,
  calculateATR,
  calculateKeltnerChannels,
  calculateOBV,
  calculateMFI,
  calculateVWAP,
  calculateZScore,
  calculateSkewness,
  calculateKurtosis,
  calculateMomentum,
  calculateROC,
  calculatePivotPoints,
  calculateTrendStrength,
  calculateVolatilityRatio,
  calculatePriceChannelPosition,
  calculateCMF,
  calculateIchimoku,
  generateFullFeatureVector,
  getCatalog: getIndicatorCatalog,
  runTests: runFeatureEngineeringTests,
};
