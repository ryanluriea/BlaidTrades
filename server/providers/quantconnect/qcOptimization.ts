/**
 * INSTITUTIONAL QC OPTIMIZATION MODULE
 * 
 * Implements:
 * - Parameter grid search (optimization sweeps)
 * - Walk-forward analysis with in-sample/out-of-sample splits
 * - Regression baseline comparisons
 * - Institutional verification gates
 */

import crypto from 'crypto';

// ============================================================================
// PARAMETER GRID SEARCH
// ============================================================================

export interface ParameterRange {
  name: string;
  min: number;
  max: number;
  step: number;
  type: 'indicator_period' | 'threshold' | 'risk' | 'timing';
}

export interface OptimizationConfig {
  parameters: ParameterRange[];
  metric: 'sharpe' | 'profit_factor' | 'win_rate' | 'sortino' | 'calmar';
  maxCombinations: number;
  parallelJobs: number;
  backtestDays: number;
}

export interface ParameterCombination {
  id: string;
  parameters: Record<string, number>;
  hash: string;
}

export interface OptimizationResult {
  combinationId: string;
  parameters: Record<string, number>;
  metrics: {
    sharpe: number;
    profitFactor: number;
    winRate: number;
    maxDrawdown: number;
    totalTrades: number;
    netProfit: number;
    sortino?: number;
    calmar?: number;
  };
  rank: number;
  qcJobId?: string;
}

export interface OptimizationSummary {
  totalCombinations: number;
  completedCombinations: number;
  bestResult: OptimizationResult | null;
  topResults: OptimizationResult[];
  averageMetrics: {
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
  };
  parameterSensitivity: Record<string, number>;
  startTime: string;
  endTime?: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export function generateParameterGrid(config: OptimizationConfig): ParameterCombination[] {
  const combinations: ParameterCombination[] = [];
  const paramArrays: { name: string; values: number[] }[] = [];
  
  for (const param of config.parameters) {
    const values: number[] = [];
    for (let v = param.min; v <= param.max; v += param.step) {
      values.push(Math.round(v * 100) / 100);
    }
    paramArrays.push({ name: param.name, values });
  }
  
  function cartesianProduct(arrays: { name: string; values: number[] }[], current: Record<string, number> = {}): void {
    if (arrays.length === 0) {
      const id = crypto.randomUUID().slice(0, 8);
      const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(current))
        .digest('hex')
        .slice(0, 16);
      
      combinations.push({
        id,
        parameters: { ...current },
        hash,
      });
      return;
    }
    
    const [first, ...rest] = arrays;
    for (const value of first.values) {
      cartesianProduct(rest, { ...current, [first.name]: value });
    }
  }
  
  cartesianProduct(paramArrays);
  
  if (combinations.length > config.maxCombinations) {
    const step = Math.ceil(combinations.length / config.maxCombinations);
    return combinations.filter((_, i) => i % step === 0).slice(0, config.maxCombinations);
  }
  
  return combinations;
}

export function getDefaultOptimizationConfig(): OptimizationConfig {
  return {
    parameters: [
      { name: 'rsiPeriod', min: 10, max: 21, step: 3, type: 'indicator_period' },
      { name: 'rsiOversold', min: 25, max: 35, step: 5, type: 'threshold' },
      { name: 'rsiOverbought', min: 65, max: 75, step: 5, type: 'threshold' },
      { name: 'bbPeriod', min: 15, max: 25, step: 5, type: 'indicator_period' },
      { name: 'bbStd', min: 1.5, max: 2.5, step: 0.5, type: 'threshold' },
    ],
    metric: 'sharpe',
    maxCombinations: 50,
    parallelJobs: 5,
    backtestDays: 30,
  };
}

export function rankOptimizationResults(
  results: OptimizationResult[],
  primaryMetric: 'sharpe' | 'profit_factor' | 'win_rate' | 'sortino' | 'calmar'
): OptimizationResult[] {
  return results
    .sort((a, b) => {
      const aValue = a.metrics[primaryMetric === 'profit_factor' ? 'profitFactor' : primaryMetric] || 0;
      const bValue = b.metrics[primaryMetric === 'profit_factor' ? 'profitFactor' : primaryMetric] || 0;
      return bValue - aValue;
    })
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

export function calculateParameterSensitivity(
  results: OptimizationResult[],
  parameters: string[]
): Record<string, number> {
  const sensitivity: Record<string, number> = {};
  
  for (const param of parameters) {
    const values = results.map(r => r.parameters[param]);
    const uniqueValues = [...new Set(values)];
    
    if (uniqueValues.length <= 1) {
      sensitivity[param] = 0;
      continue;
    }
    
    const metricsByValue: Record<number, number[]> = {};
    for (const result of results) {
      const pValue = result.parameters[param];
      if (!metricsByValue[pValue]) {
        metricsByValue[pValue] = [];
      }
      metricsByValue[pValue].push(result.metrics.sharpe);
    }
    
    const avgByValue = Object.entries(metricsByValue).map(([v, metrics]) => ({
      value: parseFloat(v),
      avgMetric: metrics.reduce((a, b) => a + b, 0) / metrics.length,
    }));
    
    if (avgByValue.length > 1) {
      const metricRange = Math.max(...avgByValue.map(x => x.avgMetric)) - 
                          Math.min(...avgByValue.map(x => x.avgMetric));
      const avgMetric = avgByValue.reduce((a, b) => a + b.avgMetric, 0) / avgByValue.length;
      sensitivity[param] = avgMetric !== 0 ? (metricRange / Math.abs(avgMetric)) * 100 : 0;
    } else {
      sensitivity[param] = 0;
    }
  }
  
  return sensitivity;
}

// ============================================================================
// WALK-FORWARD ANALYSIS
// ============================================================================

export interface WalkForwardConfig {
  totalPeriodDays: number;
  inSampleRatio: number;
  numWindows: number;
  anchoredStart: boolean;
}

export interface WalkForwardWindow {
  windowId: number;
  inSampleStart: Date;
  inSampleEnd: Date;
  outOfSampleStart: Date;
  outOfSampleEnd: Date;
}

export interface WalkForwardResult {
  windowId: number;
  inSampleMetrics: {
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    totalTrades: number;
  };
  outOfSampleMetrics: {
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    totalTrades: number;
  };
  degradation: {
    sharpe: number;
    winRate: number;
  };
  passed: boolean;
}

export interface WalkForwardSummary {
  windows: WalkForwardResult[];
  aggregateMetrics: {
    avgInSampleSharpe: number;
    avgOutOfSampleSharpe: number;
    avgDegradation: number;
    windowsPassed: number;
    totalWindows: number;
    passRate: number;
  };
  robustnessScore: number;
  recommendation: 'PROMOTE' | 'REVIEW' | 'REJECT';
  provenanceHash: string;
}

export function generateWalkForwardWindows(config: WalkForwardConfig): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  const now = new Date();
  const totalMs = config.totalPeriodDays * 24 * 60 * 60 * 1000;
  const windowMs = totalMs / config.numWindows;
  const inSampleMs = windowMs * config.inSampleRatio;
  const outOfSampleMs = windowMs * (1 - config.inSampleRatio);
  
  for (let i = 0; i < config.numWindows; i++) {
    const windowEndMs = now.getTime() - (config.numWindows - 1 - i) * outOfSampleMs;
    
    let inSampleStart: Date;
    if (config.anchoredStart) {
      inSampleStart = new Date(now.getTime() - totalMs);
    } else {
      inSampleStart = new Date(windowEndMs - inSampleMs - outOfSampleMs);
    }
    
    const inSampleEnd = new Date(windowEndMs - outOfSampleMs);
    const outOfSampleStart = new Date(inSampleEnd.getTime() + 1);
    const outOfSampleEnd = new Date(windowEndMs);
    
    windows.push({
      windowId: i + 1,
      inSampleStart,
      inSampleEnd,
      outOfSampleStart,
      outOfSampleEnd,
    });
  }
  
  return windows;
}

export function getDefaultWalkForwardConfig(): WalkForwardConfig {
  return {
    totalPeriodDays: 90,
    inSampleRatio: 0.7,
    numWindows: 3,
    anchoredStart: true,
  };
}

export function evaluateWalkForwardResult(
  inSample: { sharpe: number; winRate: number; maxDrawdown: number; totalTrades: number },
  outOfSample: { sharpe: number; winRate: number; maxDrawdown: number; totalTrades: number },
  windowId: number
): WalkForwardResult {
  const sharpeDegradation = inSample.sharpe !== 0 
    ? ((inSample.sharpe - outOfSample.sharpe) / Math.abs(inSample.sharpe)) * 100 
    : 0;
  
  const winRateDegradation = inSample.winRate !== 0
    ? ((inSample.winRate - outOfSample.winRate) / inSample.winRate) * 100
    : 0;
  
  const passed = 
    outOfSample.sharpe > 0.5 &&
    outOfSample.winRate > 45 &&
    outOfSample.maxDrawdown < 20 &&
    sharpeDegradation < 50;
  
  return {
    windowId,
    inSampleMetrics: inSample,
    outOfSampleMetrics: outOfSample,
    degradation: {
      sharpe: sharpeDegradation,
      winRate: winRateDegradation,
    },
    passed,
  };
}

export function summarizeWalkForward(results: WalkForwardResult[]): WalkForwardSummary {
  if (results.length === 0) {
    return {
      windows: [],
      aggregateMetrics: {
        avgInSampleSharpe: 0,
        avgOutOfSampleSharpe: 0,
        avgDegradation: 0,
        windowsPassed: 0,
        totalWindows: 0,
        passRate: 0,
      },
      robustnessScore: 0,
      recommendation: 'REJECT',
      provenanceHash: crypto.createHash('sha256').update('empty').digest('hex').slice(0, 16),
    };
  }
  
  const avgInSampleSharpe = results.reduce((a, r) => a + r.inSampleMetrics.sharpe, 0) / results.length;
  const avgOutOfSampleSharpe = results.reduce((a, r) => a + r.outOfSampleMetrics.sharpe, 0) / results.length;
  const avgDegradation = results.reduce((a, r) => a + r.degradation.sharpe, 0) / results.length;
  const windowsPassed = results.filter(r => r.passed).length;
  const passRate = (windowsPassed / results.length) * 100;
  
  const robustnessScore = Math.max(0, Math.min(100,
    (avgOutOfSampleSharpe * 20) +
    (passRate * 0.5) +
    (100 - Math.abs(avgDegradation)) * 0.3
  ));
  
  let recommendation: 'PROMOTE' | 'REVIEW' | 'REJECT';
  if (robustnessScore >= 70 && passRate >= 66) {
    recommendation = 'PROMOTE';
  } else if (robustnessScore >= 50 && passRate >= 50) {
    recommendation = 'REVIEW';
  } else {
    recommendation = 'REJECT';
  }
  
  const provenanceHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(results))
    .digest('hex')
    .slice(0, 16);
  
  return {
    windows: results,
    aggregateMetrics: {
      avgInSampleSharpe,
      avgOutOfSampleSharpe,
      avgDegradation,
      windowsPassed,
      totalWindows: results.length,
      passRate,
    },
    robustnessScore,
    recommendation,
    provenanceHash,
  };
}

// ============================================================================
// INSTITUTIONAL VERIFICATION GATE
// ============================================================================

export interface VerificationGate {
  name: string;
  passed: boolean;
  score: number;
  threshold: number;
  message: string;
}

export interface InstitutionalVerification {
  botId: string;
  candidateId?: string;
  timestamp: string;
  gates: VerificationGate[];
  overallPassed: boolean;
  overallScore: number;
  recommendation: 'PROMOTE' | 'REVIEW' | 'REJECT' | 'HOLD';
  provenanceChain: {
    rulesHash: string;
    codeHash: string;
    backtestHash: string;
    optimizationHash?: string;
    walkForwardHash?: string;
  };
}

export function createVerificationGates(
  backtestMetrics: { sharpe: number; winRate: number; maxDrawdown: number; totalTrades: number; profitFactor: number },
  optimization?: OptimizationSummary,
  walkForward?: WalkForwardSummary
): VerificationGate[] {
  const gates: VerificationGate[] = [];
  
  gates.push({
    name: 'MINIMUM_TRADES',
    passed: backtestMetrics.totalTrades >= 30,
    score: Math.min(100, (backtestMetrics.totalTrades / 30) * 100),
    threshold: 30,
    message: `${backtestMetrics.totalTrades} trades (min: 30)`,
  });
  
  gates.push({
    name: 'POSITIVE_SHARPE',
    passed: backtestMetrics.sharpe > 0,
    score: Math.min(100, Math.max(0, backtestMetrics.sharpe * 50)),
    threshold: 0,
    message: `Sharpe: ${backtestMetrics.sharpe.toFixed(2)} (min: 0)`,
  });
  
  gates.push({
    name: 'ACCEPTABLE_DRAWDOWN',
    passed: backtestMetrics.maxDrawdown < 25,
    score: Math.max(0, 100 - (backtestMetrics.maxDrawdown * 4)),
    threshold: 25,
    message: `Max DD: ${backtestMetrics.maxDrawdown.toFixed(1)}% (max: 25%)`,
  });
  
  gates.push({
    name: 'WIN_RATE_THRESHOLD',
    passed: backtestMetrics.winRate >= 45,
    score: Math.min(100, (backtestMetrics.winRate / 45) * 100),
    threshold: 45,
    message: `Win Rate: ${backtestMetrics.winRate.toFixed(1)}% (min: 45%)`,
  });
  
  gates.push({
    name: 'PROFIT_FACTOR',
    passed: backtestMetrics.profitFactor >= 1.2,
    score: Math.min(100, (backtestMetrics.profitFactor / 1.2) * 100),
    threshold: 1.2,
    message: `Profit Factor: ${backtestMetrics.profitFactor.toFixed(2)} (min: 1.2)`,
  });
  
  if (optimization) {
    gates.push({
      name: 'OPTIMIZATION_COVERAGE',
      passed: optimization.completedCombinations >= optimization.totalCombinations * 0.9,
      score: (optimization.completedCombinations / optimization.totalCombinations) * 100,
      threshold: 90,
      message: `${optimization.completedCombinations}/${optimization.totalCombinations} combinations tested`,
    });
  }
  
  if (walkForward) {
    gates.push({
      name: 'WALK_FORWARD_ROBUSTNESS',
      passed: walkForward.robustnessScore >= 60,
      score: walkForward.robustnessScore,
      threshold: 60,
      message: `Robustness: ${walkForward.robustnessScore.toFixed(0)}% (min: 60%)`,
    });
    
    gates.push({
      name: 'OUT_OF_SAMPLE_PERFORMANCE',
      passed: walkForward.aggregateMetrics.passRate >= 50,
      score: walkForward.aggregateMetrics.passRate,
      threshold: 50,
      message: `${walkForward.aggregateMetrics.windowsPassed}/${walkForward.aggregateMetrics.totalWindows} windows passed`,
    });
  }
  
  return gates;
}

export function runInstitutionalVerification(
  botId: string,
  candidateId: string | undefined,
  backtestMetrics: { sharpe: number; winRate: number; maxDrawdown: number; totalTrades: number; profitFactor: number },
  provenanceChain: { rulesHash: string; codeHash: string; backtestHash: string },
  optimization?: OptimizationSummary,
  walkForward?: WalkForwardSummary
): InstitutionalVerification {
  const gates = createVerificationGates(backtestMetrics, optimization, walkForward);
  
  const passedGates = gates.filter(g => g.passed).length;
  const totalGates = gates.length;
  const overallScore = gates.reduce((a, g) => a + g.score, 0) / totalGates;
  const overallPassed = passedGates === totalGates;
  
  let recommendation: 'PROMOTE' | 'REVIEW' | 'REJECT' | 'HOLD';
  if (overallPassed && overallScore >= 70) {
    recommendation = 'PROMOTE';
  } else if (passedGates >= totalGates * 0.8 && overallScore >= 50) {
    recommendation = 'REVIEW';
  } else if (passedGates >= totalGates * 0.6) {
    recommendation = 'HOLD';
  } else {
    recommendation = 'REJECT';
  }
  
  return {
    botId,
    candidateId,
    timestamp: new Date().toISOString(),
    gates,
    overallPassed,
    overallScore,
    recommendation,
    provenanceChain: {
      ...provenanceChain,
      optimizationHash: optimization?.bestResult?.combinationId,
      walkForwardHash: walkForward?.provenanceHash,
    },
  };
}
