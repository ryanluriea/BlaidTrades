/**
 * Monte Carlo Resampling & Parameter Sensitivity Testing
 * 
 * INSTITUTIONAL STANDARD: Statistical validation for trading strategies
 * - Monte Carlo resampling to test strategy robustness
 * - Parameter sensitivity sweeps for overfitting detection
 * - Walk-forward validation integration
 * 
 * SEC/CFTC Best Practice: Statistical rigor in strategy validation
 */

import * as crypto from "crypto";

export interface Trade {
  entryTime: Date;
  exitTime: Date;
  pnl: number;
  direction: "LONG" | "SHORT";
  symbol: string;
}

export interface MonteCarloConfig {
  numSimulations: number;
  confidenceLevel: number;
  shuffleMethod: "TRADE_ORDER" | "RETURN_SEQUENCE" | "BLOCK_BOOTSTRAP";
  blockSize?: number;
  seed?: number;
}

export interface MonteCarloResult {
  simulationId: string;
  numSimulations: number;
  originalPnl: number;
  originalSharpe: number;
  originalMaxDrawdown: number;
  
  pnlDistribution: {
    mean: number;
    median: number;
    stdDev: number;
    percentile5: number;
    percentile25: number;
    percentile75: number;
    percentile95: number;
    min: number;
    max: number;
  };
  
  sharpeDistribution: {
    mean: number;
    median: number;
    stdDev: number;
    percentile5: number;
    percentile95: number;
  };
  
  maxDrawdownDistribution: {
    mean: number;
    median: number;
    percentile95: number;
    percentile99: number;
  };
  
  robustnessScore: number;
  confidenceInterval: { lower: number; upper: number };
  pValueVsRandom: number;
  isStatisticallySignificant: boolean;
}

export interface ParameterSensitivityConfig {
  parameterName: string;
  baseValue: number;
  minValue: number;
  maxValue: number;
  stepCount: number;
  stepType: "LINEAR" | "LOGARITHMIC";
}

export interface ParameterSensitivityResult {
  parameterName: string;
  sweepPoints: Array<{
    value: number;
    pnl: number;
    sharpe: number;
    winRate: number;
    tradeCount: number;
  }>;
  
  sensitivityScore: number;
  optimalValue: number;
  optimalPnl: number;
  
  plateauRange: { min: number; max: number } | null;
  cliffEdges: number[];
  isOverfit: boolean;
  overfitConfidence: number;
}

function shuffleArray<T>(array: T[], seed?: number): T[] {
  const shuffled = [...array];
  let rng = seed !== undefined ? seededRandom(seed) : Math.random;
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

function seededRandom(seed: number): () => number {
  let x = seed;
  return () => {
    x = Math.sin(x) * 10000;
    return x - Math.floor(x);
  };
}

function calculateReturns(trades: Trade[]): number[] {
  return trades.map(t => t.pnl);
}

function calculatePnl(returns: number[]): number {
  return returns.reduce((sum, r) => sum + r, 0);
}

function calculateSharpe(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  const annualizationFactor = Math.sqrt(252);
  return ((mean - riskFreeRate) / stdDev) * annualizationFactor;
}

function calculateMaxDrawdown(returns: number[]): number {
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  
  return maxDrawdown;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) return sorted[lower];
  
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function median(arr: number[]): number {
  return percentile(arr, 50);
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function blockBootstrap(returns: number[], blockSize: number, seed?: number): number[] {
  const rng = seed !== undefined ? seededRandom(seed) : Math.random;
  const result: number[] = [];
  
  while (result.length < returns.length) {
    const startIdx = Math.floor(rng() * (returns.length - blockSize + 1));
    for (let i = 0; i < blockSize && result.length < returns.length; i++) {
      result.push(returns[startIdx + i]);
    }
  }
  
  return result;
}

export function runMonteCarloSimulation(
  trades: Trade[],
  config: MonteCarloConfig = {
    numSimulations: 1000,
    confidenceLevel: 0.95,
    shuffleMethod: "TRADE_ORDER",
    blockSize: 5,
  }
): MonteCarloResult {
  const simulationId = crypto.randomUUID().slice(0, 8);
  const originalReturns = calculateReturns(trades);
  const originalPnl = calculatePnl(originalReturns);
  const originalSharpe = calculateSharpe(originalReturns);
  const originalMaxDrawdown = calculateMaxDrawdown(originalReturns);
  
  const pnlResults: number[] = [];
  const sharpeResults: number[] = [];
  const maxDrawdownResults: number[] = [];
  
  for (let i = 0; i < config.numSimulations; i++) {
    let shuffledReturns: number[];
    const seed = config.seed !== undefined ? config.seed + i : undefined;
    
    switch (config.shuffleMethod) {
      case "TRADE_ORDER":
        shuffledReturns = shuffleArray(originalReturns, seed);
        break;
      case "RETURN_SEQUENCE":
        shuffledReturns = shuffleArray(originalReturns, seed);
        break;
      case "BLOCK_BOOTSTRAP":
        shuffledReturns = blockBootstrap(originalReturns, config.blockSize || 5, seed);
        break;
      default:
        shuffledReturns = shuffleArray(originalReturns, seed);
    }
    
    pnlResults.push(calculatePnl(shuffledReturns));
    sharpeResults.push(calculateSharpe(shuffledReturns));
    maxDrawdownResults.push(calculateMaxDrawdown(shuffledReturns));
  }
  
  const betterThanOriginal = pnlResults.filter(p => p >= originalPnl).length;
  const pValueVsRandom = betterThanOriginal / config.numSimulations;
  
  const pnlMean = pnlResults.reduce((a, b) => a + b, 0) / pnlResults.length;
  const pnlStdDev = stdDev(pnlResults);
  
  const robustnessScore = Math.min(100, Math.max(0,
    (1 - Math.abs(originalPnl - pnlMean) / (pnlStdDev || 1)) * 50 +
    (originalSharpe > 0 ? 25 : 0) +
    (pValueVsRandom > 0.5 ? 25 : pValueVsRandom * 50)
  ));
  
  const alpha = 1 - config.confidenceLevel;
  
  return {
    simulationId,
    numSimulations: config.numSimulations,
    originalPnl,
    originalSharpe,
    originalMaxDrawdown,
    
    pnlDistribution: {
      mean: pnlMean,
      median: median(pnlResults),
      stdDev: pnlStdDev,
      percentile5: percentile(pnlResults, 5),
      percentile25: percentile(pnlResults, 25),
      percentile75: percentile(pnlResults, 75),
      percentile95: percentile(pnlResults, 95),
      min: Math.min(...pnlResults),
      max: Math.max(...pnlResults),
    },
    
    sharpeDistribution: {
      mean: sharpeResults.reduce((a, b) => a + b, 0) / sharpeResults.length,
      median: median(sharpeResults),
      stdDev: stdDev(sharpeResults),
      percentile5: percentile(sharpeResults, 5),
      percentile95: percentile(sharpeResults, 95),
    },
    
    maxDrawdownDistribution: {
      mean: maxDrawdownResults.reduce((a, b) => a + b, 0) / maxDrawdownResults.length,
      median: median(maxDrawdownResults),
      percentile95: percentile(maxDrawdownResults, 95),
      percentile99: percentile(maxDrawdownResults, 99),
    },
    
    robustnessScore,
    confidenceInterval: {
      lower: percentile(pnlResults, alpha * 100 / 2),
      upper: percentile(pnlResults, 100 - alpha * 100 / 2),
    },
    pValueVsRandom,
    isStatisticallySignificant: pValueVsRandom <= 0.05,
  };
}

export function runParameterSensitivitySweep(
  baseBacktestFn: (paramValue: number) => { pnl: number; sharpe: number; winRate: number; tradeCount: number },
  config: ParameterSensitivityConfig
): ParameterSensitivityResult {
  const sweepPoints: ParameterSensitivityResult["sweepPoints"] = [];
  
  const values: number[] = [];
  if (config.stepType === "LINEAR") {
    const step = (config.maxValue - config.minValue) / (config.stepCount - 1);
    for (let i = 0; i < config.stepCount; i++) {
      values.push(config.minValue + step * i);
    }
  } else {
    const logMin = Math.log(config.minValue);
    const logMax = Math.log(config.maxValue);
    const logStep = (logMax - logMin) / (config.stepCount - 1);
    for (let i = 0; i < config.stepCount; i++) {
      values.push(Math.exp(logMin + logStep * i));
    }
  }
  
  for (const value of values) {
    const result = baseBacktestFn(value);
    sweepPoints.push({
      value,
      pnl: result.pnl,
      sharpe: result.sharpe,
      winRate: result.winRate,
      tradeCount: result.tradeCount,
    });
  }
  
  const pnls = sweepPoints.map(p => p.pnl);
  const maxPnl = Math.max(...pnls);
  const optimalIndex = pnls.indexOf(maxPnl);
  const optimalValue = sweepPoints[optimalIndex].value;
  
  const pnlStdDev = stdDev(pnls);
  const pnlMean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  
  const sensitivityScore = pnlStdDev / (Math.abs(pnlMean) || 1) * 100;
  
  let plateauRange: { min: number; max: number } | null = null;
  const threshold = maxPnl * 0.9;
  const plateauIndices = pnls.map((p, i) => p >= threshold ? i : -1).filter(i => i >= 0);
  
  if (plateauIndices.length >= 3) {
    const isContiguous = plateauIndices.every((idx, i) => 
      i === 0 || idx === plateauIndices[i - 1] + 1
    );
    
    if (isContiguous) {
      plateauRange = {
        min: sweepPoints[plateauIndices[0]].value,
        max: sweepPoints[plateauIndices[plateauIndices.length - 1]].value,
      };
    }
  }
  
  const cliffEdges: number[] = [];
  for (let i = 1; i < pnls.length; i++) {
    const change = Math.abs(pnls[i] - pnls[i - 1]);
    const avgPnl = (Math.abs(pnls[i]) + Math.abs(pnls[i - 1])) / 2;
    if (avgPnl > 0 && change / avgPnl > 0.3) {
      cliffEdges.push(sweepPoints[i].value);
    }
  }
  
  const distanceFromOptimal = Math.abs(optimalIndex - Math.floor(sweepPoints.length / 2));
  const peakNarrowness = plateauRange 
    ? (plateauRange.max - plateauRange.min) / (config.maxValue - config.minValue) 
    : 0.1;
  
  const overfitConfidence = Math.min(100, 
    (sensitivityScore > 50 ? 30 : 0) +
    (cliffEdges.length >= 2 ? 25 : 0) +
    (peakNarrowness < 0.2 ? 25 : 0) +
    (distanceFromOptimal > sweepPoints.length * 0.3 ? 20 : 0)
  );
  
  const isOverfit = overfitConfidence >= 50;
  
  return {
    parameterName: config.parameterName,
    sweepPoints,
    sensitivityScore,
    optimalValue,
    optimalPnl: maxPnl,
    plateauRange,
    cliffEdges,
    isOverfit,
    overfitConfidence,
  };
}

export function validateStrategyRobustness(
  trades: Trade[],
  monteCarloConfig?: MonteCarloConfig
): {
  isRobust: boolean;
  robustnessScore: number;
  concerns: string[];
  recommendations: string[];
  monteCarloResult: MonteCarloResult;
} {
  const mcResult = runMonteCarloSimulation(trades, monteCarloConfig);
  
  const concerns: string[] = [];
  const recommendations: string[] = [];
  
  if (!mcResult.isStatisticallySignificant) {
    concerns.push("Strategy returns are not statistically significant vs random");
    recommendations.push("Collect more trade data or reconsider strategy logic");
  }
  
  if (mcResult.robustnessScore < 50) {
    concerns.push(`Low robustness score: ${mcResult.robustnessScore.toFixed(1)}`);
    recommendations.push("Consider reducing parameter optimization depth");
  }
  
  if (mcResult.pnlDistribution.percentile5 < 0) {
    concerns.push("5th percentile P&L is negative - tail risk present");
    recommendations.push("Implement tighter stop losses or position sizing");
  }
  
  if (mcResult.sharpeDistribution.percentile5 < 0.5) {
    concerns.push("5th percentile Sharpe < 0.5 - inconsistent risk-adjusted returns");
    recommendations.push("Review strategy for regime dependency");
  }
  
  const isRobust = mcResult.robustnessScore >= 60 && 
    mcResult.isStatisticallySignificant && 
    mcResult.pnlDistribution.percentile25 > 0;
  
  return {
    isRobust,
    robustnessScore: mcResult.robustnessScore,
    concerns,
    recommendations,
    monteCarloResult: mcResult,
  };
}
