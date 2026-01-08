import type { LiveBar } from "../live-data-service";

export interface FeatureVector {
  timestamp: Date;
  symbol: string;
  features: Record<string, number>;
  target?: number;
}

export interface FeatureConfig {
  laggedReturns: number[];
  smaWindows: number[];
  emaWindows: number[];
  rsiWindow: number;
  bbWindow: number;
  bbStd: number;
  atrWindow: number;
  volumeWindows: number[];
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
}

const DEFAULT_CONFIG: FeatureConfig = {
  laggedReturns: [1, 2, 3, 5, 10, 20],
  smaWindows: [5, 10, 20, 50],
  emaWindows: [9, 21, 50],
  rsiWindow: 14,
  bbWindow: 20,
  bbStd: 2,
  atrWindow: 14,
  volumeWindows: [5, 10, 20],
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
};

export class FeatureEngineer {
  private config: FeatureConfig;

  constructor(config: Partial<FeatureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  extractFeatures(bars: LiveBar[], targetLookforward: number = 5): FeatureVector[] {
    if (bars.length < 100) {
      console.warn("[FEATURE_ENGINEER] Insufficient bars for feature extraction, need at least 100");
      return [];
    }

    const closes = bars.map(b => b.close);
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const opens = bars.map(b => b.open);

    const smaCache: Record<number, number[]> = {};
    const emaCache: Record<number, number[]> = {};
    
    for (const window of this.config.smaWindows) {
      smaCache[window] = this.sma(closes, window);
    }
    for (const window of this.config.emaWindows) {
      emaCache[window] = this.ema(closes, window);
    }

    const rsi = this.rsi(closes, this.config.rsiWindow);
    const { upper: bbUpper, middle: bbMiddle, lower: bbLower } = this.bollingerBands(
      closes, this.config.bbWindow, this.config.bbStd
    );
    const atr = this.atr(highs, lows, closes, this.config.atrWindow);
    const { macd, signal: macdSignalLine, histogram } = this.macd(
      closes, this.config.macdFast, this.config.macdSlow, this.config.macdSignal
    );

    const volumeSmaCache: Record<number, number[]> = {};
    for (const window of this.config.volumeWindows) {
      volumeSmaCache[window] = this.sma(volumes, window);
    }

    const minIndex = Math.max(
      ...this.config.laggedReturns,
      ...this.config.smaWindows,
      ...this.config.emaWindows,
      this.config.rsiWindow,
      this.config.bbWindow,
      this.config.atrWindow,
      this.config.macdSlow + this.config.macdSignal,
      ...this.config.volumeWindows
    );

    const features: FeatureVector[] = [];

    for (let i = minIndex; i < bars.length - targetLookforward; i++) {
      const bar = bars[i];
      const featureMap: Record<string, number> = {};

      for (const lag of this.config.laggedReturns) {
        if (i >= lag && closes[i - lag] !== 0) {
          featureMap[`return_${lag}`] = (closes[i] - closes[i - lag]) / closes[i - lag];
        }
      }

      for (const window of this.config.smaWindows) {
        const smaVal = smaCache[window][i];
        if (smaVal && closes[i] !== 0) {
          featureMap[`sma_${window}_ratio`] = closes[i] / smaVal - 1;
        }
      }

      for (const window of this.config.emaWindows) {
        const emaVal = emaCache[window][i];
        if (emaVal && closes[i] !== 0) {
          featureMap[`ema_${window}_ratio`] = closes[i] / emaVal - 1;
        }
      }

      if (rsi[i] !== undefined) {
        featureMap["rsi"] = rsi[i] / 100;
      }

      if (bbUpper[i] && bbLower[i] && bbUpper[i] !== bbLower[i]) {
        featureMap["bb_position"] = (closes[i] - bbLower[i]) / (bbUpper[i] - bbLower[i]);
        featureMap["bb_width"] = (bbUpper[i] - bbLower[i]) / bbMiddle[i];
      }

      if (atr[i] && closes[i] !== 0) {
        featureMap["atr_ratio"] = atr[i] / closes[i];
      }

      if (macd[i] !== undefined) {
        featureMap["macd"] = macd[i];
        featureMap["macd_signal"] = macdSignalLine[i] || 0;
        featureMap["macd_histogram"] = histogram[i] || 0;
      }

      for (const window of this.config.volumeWindows) {
        const volSma = volumeSmaCache[window][i];
        if (volSma && volSma !== 0) {
          featureMap[`volume_${window}_ratio`] = volumes[i] / volSma;
        }
      }

      if (highs[i] !== lows[i]) {
        featureMap["body_ratio"] = Math.abs(closes[i] - opens[i]) / (highs[i] - lows[i]);
        featureMap["upper_shadow"] = (highs[i] - Math.max(opens[i], closes[i])) / (highs[i] - lows[i]);
        featureMap["lower_shadow"] = (Math.min(opens[i], closes[i]) - lows[i]) / (highs[i] - lows[i]);
      }

      featureMap["is_green"] = closes[i] > opens[i] ? 1 : 0;

      if (i >= 3) {
        let greenCount = 0;
        for (let j = i - 2; j <= i; j++) {
          if (closes[j] > opens[j]) greenCount++;
        }
        featureMap["green_streak_3"] = greenCount / 3;
      }

      const hour = bar.time.getUTCHours();
      const dayOfWeek = bar.time.getUTCDay();
      featureMap["hour_sin"] = Math.sin((2 * Math.PI * hour) / 24);
      featureMap["hour_cos"] = Math.cos((2 * Math.PI * hour) / 24);
      featureMap["dow_sin"] = Math.sin((2 * Math.PI * dayOfWeek) / 7);
      featureMap["dow_cos"] = Math.cos((2 * Math.PI * dayOfWeek) / 7);

      const futureClose = closes[i + targetLookforward];
      const target = futureClose > closes[i] ? 1 : 0;

      features.push({
        timestamp: bar.time,
        symbol: bar.symbol,
        features: featureMap,
        target,
      });
    }

    console.log(`[FEATURE_ENGINEER] Extracted ${features.length} feature vectors with ${Object.keys(features[0]?.features || {}).length} features each`);
    return features;
  }

  getFeatureNames(): string[] {
    const names: string[] = [];
    
    for (const lag of this.config.laggedReturns) {
      names.push(`return_${lag}`);
    }
    for (const window of this.config.smaWindows) {
      names.push(`sma_${window}_ratio`);
    }
    for (const window of this.config.emaWindows) {
      names.push(`ema_${window}_ratio`);
    }
    names.push("rsi", "bb_position", "bb_width", "atr_ratio");
    names.push("macd", "macd_signal", "macd_histogram");
    for (const window of this.config.volumeWindows) {
      names.push(`volume_${window}_ratio`);
    }
    names.push("body_ratio", "upper_shadow", "lower_shadow", "is_green", "green_streak_3");
    names.push("hour_sin", "hour_cos", "dow_sin", "dow_cos");
    
    return names;
  }

  private sma(data: number[], window: number): number[] {
    const result: number[] = new Array(data.length).fill(NaN);
    for (let i = window - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < window; j++) {
        sum += data[i - j];
      }
      result[i] = sum / window;
    }
    return result;
  }

  private ema(data: number[], window: number): number[] {
    const result: number[] = new Array(data.length).fill(NaN);
    const multiplier = 2 / (window + 1);
    
    let sum = 0;
    for (let i = 0; i < window && i < data.length; i++) {
      sum += data[i];
    }
    result[window - 1] = sum / window;
    
    for (let i = window; i < data.length; i++) {
      result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1];
    }
    return result;
  }

  private rsi(data: number[], window: number): number[] {
    const result: number[] = new Array(data.length).fill(NaN);
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);
    }
    
    if (gains.length < window) return result;
    
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < window; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= window;
    avgLoss /= window;
    
    result[window] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    
    for (let i = window; i < gains.length; i++) {
      avgGain = (avgGain * (window - 1) + gains[i]) / window;
      avgLoss = (avgLoss * (window - 1) + losses[i]) / window;
      result[i + 1] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
    
    return result;
  }

  private bollingerBands(data: number[], window: number, stdDev: number): { upper: number[]; middle: number[]; lower: number[] } {
    const middle = this.sma(data, window);
    const upper: number[] = new Array(data.length).fill(NaN);
    const lower: number[] = new Array(data.length).fill(NaN);
    
    for (let i = window - 1; i < data.length; i++) {
      let sumSq = 0;
      for (let j = 0; j < window; j++) {
        sumSq += Math.pow(data[i - j] - middle[i], 2);
      }
      const std = Math.sqrt(sumSq / window);
      upper[i] = middle[i] + stdDev * std;
      lower[i] = middle[i] - stdDev * std;
    }
    
    return { upper, middle, lower };
  }

  private atr(highs: number[], lows: number[], closes: number[], window: number): number[] {
    const result: number[] = new Array(highs.length).fill(NaN);
    const tr: number[] = [];
    
    for (let i = 1; i < highs.length; i++) {
      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr.push(Math.max(hl, hc, lc));
    }
    
    if (tr.length < window) return result;
    
    let sum = 0;
    for (let i = 0; i < window; i++) {
      sum += tr[i];
    }
    result[window] = sum / window;
    
    for (let i = window; i < tr.length; i++) {
      result[i + 1] = (result[i] * (window - 1) + tr[i]) / window;
    }
    
    return result;
  }

  private macd(data: number[], fast: number, slow: number, signal: number): { macd: number[]; signal: number[]; histogram: number[] } {
    const emaFast = this.ema(data, fast);
    const emaSlow = this.ema(data, slow);
    const macdLine: number[] = new Array(data.length).fill(NaN);
    
    for (let i = slow - 1; i < data.length; i++) {
      if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
        macdLine[i] = emaFast[i] - emaSlow[i];
      }
    }
    
    const validMacd = macdLine.filter(v => !isNaN(v));
    const signalEma = this.ema(validMacd, signal);
    
    const signalLine: number[] = new Array(data.length).fill(NaN);
    const histogram: number[] = new Array(data.length).fill(NaN);
    
    let validIdx = 0;
    for (let i = 0; i < data.length; i++) {
      if (!isNaN(macdLine[i])) {
        if (validIdx >= signal - 1 && !isNaN(signalEma[validIdx])) {
          signalLine[i] = signalEma[validIdx];
          histogram[i] = macdLine[i] - signalLine[i];
        }
        validIdx++;
      }
    }
    
    return { macd: macdLine, signal: signalLine, histogram };
  }
}

export function normalizeFeatures(vectors: FeatureVector[]): { normalized: FeatureVector[]; stats: Record<string, { mean: number; std: number }> } {
  if (vectors.length === 0) return { normalized: [], stats: {} };
  
  const featureNames = Object.keys(vectors[0].features);
  const stats: Record<string, { mean: number; std: number }> = {};
  
  for (const name of featureNames) {
    const values = vectors.map(v => v.features[name]).filter(v => !isNaN(v) && isFinite(v));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const std = Math.sqrt(variance) || 1;
    stats[name] = { mean, std };
  }
  
  const normalized = vectors.map(v => ({
    ...v,
    features: Object.fromEntries(
      Object.entries(v.features).map(([name, value]) => {
        const { mean, std } = stats[name];
        const normalizedValue = (value - mean) / std;
        return [name, isNaN(normalizedValue) || !isFinite(normalizedValue) ? 0 : normalizedValue];
      })
    ),
  }));
  
  return { normalized, stats };
}

export function splitTrainTest(vectors: FeatureVector[], trainRatio: number = 0.8): { train: FeatureVector[]; test: FeatureVector[] } {
  const splitIdx = Math.floor(vectors.length * trainRatio);
  return {
    train: vectors.slice(0, splitIdx),
    test: vectors.slice(splitIdx),
  };
}
