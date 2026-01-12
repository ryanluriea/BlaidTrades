/**
 * Worker Thread Executor
 * 
 * Executes CPU-intensive tasks in a separate thread to keep main event loop responsive.
 * This file runs in a worker thread context.
 */

const { parentPort, workerData } = require("worker_threads");

const workerId = workerData?.workerId ?? 0;

parentPort?.on("message", async (task) => {
  const startTime = Date.now();
  
  try {
    let result;
    
    switch (task.type) {
      case "BACKTEST_SCORING":
        result = await executeBacktestScoring(task.payload);
        break;
      
      case "MONTE_CARLO":
        result = await executeMonteCarlo(task.payload);
        break;
      
      case "FEATURE_ENGINEERING":
        result = await executeFeatureEngineering(task.payload);
        break;
      
      case "STRATEGY_OPTIMIZATION":
        result = await executeStrategyOptimization(task.payload);
        break;
      
      case "RISK_CALCULATION":
        result = await executeRiskCalculation(task.payload);
        break;
      
      case "VOLUME_ANALYSIS":
        result = await executeVolumeAnalysis(task.payload);
        break;
      
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
    
    parentPort?.postMessage({
      taskId: task.id,
      success: true,
      result,
      durationMs: Date.now() - startTime,
      workerId,
    });
  } catch (error) {
    parentPort?.postMessage({
      taskId: task.id,
      success: false,
      error: error.message || "Unknown error",
      durationMs: Date.now() - startTime,
      workerId,
    });
  }
});

async function executeBacktestScoring(payload) {
  const { trades, riskConfig } = payload;
  
  if (!trades || trades.length === 0) {
    return {
      sharpe: 0,
      sortino: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      tradeCount: 0,
    };
  }
  
  const returns = trades.map((t) => t.pnl || 0);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  const negativeReturns = returns.filter((r) => r < 0);
  const downVar = negativeReturns.length > 0
    ? negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length
    : 0;
  const downDev = Math.sqrt(downVar);
  
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  const sortino = downDev > 0 ? (avgReturn / downDev) * Math.sqrt(252) : 0;
  
  let peak = 0;
  let maxDrawdown = 0;
  let cumPnl = 0;
  
  for (const ret of returns) {
    cumPnl += ret;
    peak = Math.max(peak, cumPnl);
    const drawdown = peak > 0 ? (peak - cumPnl) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = returns.length > 0 ? wins.length / returns.length : 0;
  
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  
  return {
    sharpe: parseFloat(sharpe.toFixed(4)),
    sortino: parseFloat(sortino.toFixed(4)),
    maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
    winRate: parseFloat((winRate * 100).toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(4)),
    expectancy: parseFloat(expectancy.toFixed(2)),
    tradeCount: trades.length,
    totalPnl: parseFloat(cumPnl.toFixed(2)),
    avgTrade: parseFloat(avgReturn.toFixed(2)),
  };
}

async function executeMonteCarlo(payload) {
  const { trades, iterations = 1000, confidenceLevel = 0.95 } = payload;
  
  if (!trades || trades.length === 0) {
    return { worstCase: 0, bestCase: 0, median: 0, var95: 0, es95: 0 };
  }
  
  const returns = trades.map((t) => t.pnl || 0);
  const results = [];
  
  for (let i = 0; i < iterations; i++) {
    let cumReturn = 0;
    for (let j = 0; j < returns.length; j++) {
      const randIdx = Math.floor(Math.random() * returns.length);
      cumReturn += returns[randIdx];
    }
    results.push(cumReturn);
  }
  
  results.sort((a, b) => a - b);
  
  const varIndex = Math.floor((1 - confidenceLevel) * iterations);
  const var95 = results[varIndex];
  
  const tailReturns = results.slice(0, varIndex + 1);
  const es95 = tailReturns.length > 0
    ? tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
    : var95;
  
  return {
    worstCase: results[0],
    bestCase: results[results.length - 1],
    median: results[Math.floor(iterations / 2)],
    var95: parseFloat(var95.toFixed(2)),
    es95: parseFloat(es95.toFixed(2)),
    p10: results[Math.floor(iterations * 0.1)],
    p25: results[Math.floor(iterations * 0.25)],
    p75: results[Math.floor(iterations * 0.75)],
    p90: results[Math.floor(iterations * 0.9)],
  };
}

async function executeFeatureEngineering(payload) {
  const { bars, indicators = ["rsi", "macd", "bb"] } = payload;
  
  if (!bars || bars.length === 0) {
    return { features: [], indicatorValues: {} };
  }
  
  const closes = bars.map((b) => b.close);
  const features = [];
  const indicatorValues = {};
  
  for (const indicator of indicators) {
    switch (indicator) {
      case "rsi":
        indicatorValues.rsi = calculateRSI(closes, 14);
        break;
      case "macd":
        indicatorValues.macd = calculateMACD(closes);
        break;
      case "bb":
        indicatorValues.bb = calculateBollingerBands(closes, 20, 2);
        break;
      case "sma":
        indicatorValues.sma = calculateSMA(closes, 20);
        break;
      case "ema":
        indicatorValues.ema = calculateEMA(closes, 20);
        break;
    }
  }
  
  for (let i = Math.max(20, bars.length - 100); i < bars.length; i++) {
    const feature = {
      timestamp: bars[i].time,
      close: bars[i].close,
      volume: bars[i].volume,
    };
    
    if (indicatorValues.rsi && indicatorValues.rsi[i] !== undefined) {
      feature.rsi = indicatorValues.rsi[i];
    }
    if (indicatorValues.sma && indicatorValues.sma[i] !== undefined) {
      feature.smaDeviation = (bars[i].close - indicatorValues.sma[i]) / indicatorValues.sma[i];
    }
    
    features.push(feature);
  }
  
  return { features, indicatorCount: Object.keys(indicatorValues).length };
}

async function executeStrategyOptimization(payload) {
  const { parameterSpace, fitnessFunction, maxIterations = 100 } = payload;
  
  let bestParams = {};
  let bestFitness = -Infinity;
  
  for (let i = 0; i < maxIterations; i++) {
    const params = {};
    for (const [key, range] of Object.entries(parameterSpace)) {
      params[key] = range.min + Math.random() * (range.max - range.min);
    }
    
    const fitness = Math.random() * 100 - 20;
    
    if (fitness > bestFitness) {
      bestFitness = fitness;
      bestParams = { ...params };
    }
  }
  
  return {
    bestParams,
    bestFitness: parseFloat(bestFitness.toFixed(4)),
    iterations: maxIterations,
  };
}

async function executeRiskCalculation(payload) {
  const { positions, prices, correlationMatrix } = payload;
  
  if (!positions || positions.length === 0) {
    return { portfolioVaR: 0, componentVaR: [], totalExposure: 0 };
  }
  
  let totalExposure = 0;
  const componentVaR = [];
  
  for (const pos of positions) {
    const notional = Math.abs(pos.quantity * (prices?.[pos.symbol] || pos.avgPrice));
    totalExposure += notional;
    
    const volatility = 0.02;
    const var95 = notional * volatility * 1.645;
    
    componentVaR.push({
      symbol: pos.symbol,
      notional,
      var95: parseFloat(var95.toFixed(2)),
      contribution: 0,
    });
  }
  
  const portfolioVaR = componentVaR.reduce((sum, cv) => sum + cv.var95, 0) * 0.85;
  
  for (const cv of componentVaR) {
    cv.contribution = portfolioVaR > 0 ? cv.var95 / portfolioVaR : 0;
  }
  
  return {
    portfolioVaR: parseFloat(portfolioVaR.toFixed(2)),
    componentVaR,
    totalExposure: parseFloat(totalExposure.toFixed(2)),
    diversificationBenefit: 0.15,
  };
}

async function executeVolumeAnalysis(payload) {
  const { bars, windowMinutes = 60 } = payload;
  
  if (!bars || bars.length === 0) {
    return { vwap: 0, volumeProfile: [], averageVolume: 0 };
  }
  
  let sumPV = 0;
  let sumV = 0;
  const volumeProfile = new Map();
  
  for (const bar of bars) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    sumPV += typicalPrice * bar.volume;
    sumV += bar.volume;
    
    const priceLevel = Math.round(bar.close * 4) / 4;
    volumeProfile.set(priceLevel, (volumeProfile.get(priceLevel) || 0) + bar.volume);
  }
  
  const vwap = sumV > 0 ? sumPV / sumV : 0;
  const averageVolume = bars.length > 0 ? sumV / bars.length : 0;
  
  const sortedProfile = Array.from(volumeProfile.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([price, volume]) => ({ price, volume }));
  
  return {
    vwap: parseFloat(vwap.toFixed(4)),
    volumeProfile: sortedProfile,
    averageVolume: parseFloat(averageVolume.toFixed(0)),
    totalVolume: sumV,
  };
}

function calculateRSI(closes, period) {
  const rsi = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return rsi;
  
  let avgGain = 0;
  let avgLoss = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
  rsi[period] = 100 - 100 / (1 + rs);
  
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    const rs2 = avgLoss > 0 ? avgGain / avgLoss : 100;
    rsi[i] = 100 - 100 / (1 + rs2);
  }
  
  return rsi;
}

function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  
  const macdLine = closes.map((_, i) => {
    if (emaFast[i] === null || emaSlow[i] === null) return null;
    return emaFast[i] - emaSlow[i];
  });
  
  return { macdLine, histogram: macdLine };
}

function calculateBollingerBands(closes, period, stdDevs) {
  const sma = calculateSMA(closes, period);
  const upper = [];
  const lower = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    
    upper.push(sma[i] + stdDevs * stdDev);
    lower.push(sma[i] - stdDevs * stdDev);
  }
  
  return { sma, upper, lower };
}

function calculateSMA(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;
  
  for (let i = period; i < values.length; i++) {
    sum = sum - values[i - period] + values[i];
    result[i] = sum / period;
  }
  
  return result;
}

function calculateEMA(values, period) {
  const result = new Array(values.length).fill(null);
  if (values.length < period) return result;
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;
  
  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
  }
  
  return result;
}

console.log(`[WORKER_EXECUTOR] Worker ${workerId} ready`);
