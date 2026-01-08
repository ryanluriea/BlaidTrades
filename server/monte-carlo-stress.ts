/**
 * MONTE CARLO STRESS TESTING ENGINE
 * 
 * Probabilistic risk assessment through Monte Carlo simulations.
 * Calculates VaR, CVaR (Expected Shortfall), and stress scenarios.
 * 
 * Key Features:
 * - Multi-path return simulations
 * - Value at Risk (VaR) at multiple confidence levels
 * - Conditional VaR (CVaR / Expected Shortfall)
 * - Stress scenario generation (crash, volatility spike, correlation breakdown)
 * - Portfolio drawdown probability estimation
 * - Tail risk quantification
 */

import { db } from "./db";
import { bots } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

export type StressScenario = "CRASH" | "VOLATILITY_SPIKE" | "CORRELATION_BREAKDOWN" | "LIQUIDITY_CRISIS" | "REGIME_SHIFT";
export type RiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "EXTREME";

export interface MonteCarloConfig {
  numSimulations: number;
  horizonDays: number;
  confidenceLevels: number[];
  includeStressScenarios: boolean;
  capitalAmount: number;
  seed?: number;
}

export interface VaRResult {
  confidenceLevel: number;
  varAbsolute: number;
  varPercent: number;
  cvarAbsolute: number;
  cvarPercent: number;
}

export interface StressTestResult {
  scenario: StressScenario;
  description: string;
  appliedShock: number;
  projectedLoss: number;
  lossPercent: number;
  recoveryDays: number;
  probability: number;
}

export interface DrawdownDistribution {
  percentile: number;
  maxDrawdown: number;
}

export interface MonteCarloResult {
  botId: string;
  config: MonteCarloConfig;
  simulations: {
    completed: number;
    meanReturn: number;
    stdDev: number;
    minReturn: number;
    maxReturn: number;
    skewness: number;
    kurtosis: number;
  };
  varResults: VaRResult[];
  stressTests: StressTestResult[];
  drawdownDistribution: DrawdownDistribution[];
  probabilityOfRuin: number;
  tailRiskScore: number;
  overallRiskLevel: RiskLevel;
  recommendations: string[];
  timestamp: Date;
  durationMs: number;
}

export interface PortfolioMonteCarloResult {
  portfolioId: string;
  botResults: MonteCarloResult[];
  aggregateVaR: VaRResult[];
  aggregateStressTests: StressTestResult[];
  diversificationBenefit: number;
  portfolioRiskLevel: RiskLevel;
  recommendations: string[];
  timestamp: Date;
}

const monteCarloCache: Map<string, { result: MonteCarloResult; expiry: Date }> = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

class RandomGenerator {
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? Date.now();
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  normalRandom(): number {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

function calculateMoments(returns: number[]): { mean: number; stdDev: number; skewness: number; kurtosis: number } {
  const n = returns.length;
  if (n === 0) return { mean: 0, stdDev: 0, skewness: 0, kurtosis: 0 };

  const mean = returns.reduce((a, b) => a + b, 0) / n;
  
  let variance = 0;
  let m3 = 0;
  let m4 = 0;
  
  for (const r of returns) {
    const diff = r - mean;
    variance += diff * diff;
    m3 += diff * diff * diff;
    m4 += diff * diff * diff * diff;
  }
  
  variance /= n;
  const stdDev = Math.sqrt(variance);
  
  const skewness = stdDev > 0 ? (m3 / n) / (stdDev * stdDev * stdDev) : 0;
  const kurtosis = stdDev > 0 ? (m4 / n) / (variance * variance) - 3 : 0;

  return { mean, stdDev, skewness, kurtosis };
}

function simulateReturns(
  baseReturn: number,
  volatility: number,
  horizonDays: number,
  numSimulations: number,
  rng: RandomGenerator
): number[][] {
  const paths: number[][] = [];
  
  const dailyReturn = baseReturn / 252;
  const dailyVol = volatility / Math.sqrt(252);
  
  for (let sim = 0; sim < numSimulations; sim++) {
    const path: number[] = [];
    let cumReturn = 1.0;
    
    for (let day = 0; day < horizonDays; day++) {
      const shock = rng.normalRandom() * dailyVol;
      const dayReturn = dailyReturn + shock;
      cumReturn *= (1 + dayReturn);
      path.push(cumReturn - 1);
    }
    
    paths.push(path);
  }
  
  return paths;
}

function calculateVaR(
  finalReturns: number[],
  confidenceLevels: number[],
  capitalAmount: number
): VaRResult[] {
  const sorted = [...finalReturns].sort((a, b) => a - b);
  const n = sorted.length;
  
  return confidenceLevels.map(confidence => {
    const index = Math.floor((1 - confidence) * n);
    const varReturn = sorted[index] || sorted[0];
    
    const tailReturns = sorted.slice(0, index + 1);
    const cvarReturn = tailReturns.length > 0
      ? tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length
      : varReturn;
    
    return {
      confidenceLevel: confidence,
      varAbsolute: -varReturn * capitalAmount,
      varPercent: -varReturn * 100,
      cvarAbsolute: -cvarReturn * capitalAmount,
      cvarPercent: -cvarReturn * 100,
    };
  });
}

function calculateDrawdownDistribution(paths: number[][]): DrawdownDistribution[] {
  const maxDrawdowns = paths.map(path => {
    let peak = 0;
    let maxDD = 0;
    
    for (const ret of path) {
      const value = 1 + ret;
      if (value > peak) peak = value;
      const dd = peak > 0 ? (peak - value) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }
    
    return maxDD;
  });
  
  const sorted = [...maxDrawdowns].sort((a, b) => a - b);
  const n = sorted.length;
  
  return [10, 25, 50, 75, 90, 95, 99].map(percentile => ({
    percentile,
    maxDrawdown: sorted[Math.floor(percentile / 100 * n)] || 0,
  }));
}

function calculateProbabilityOfRuin(paths: number[][], ruinThreshold: number = -0.5): number {
  const ruinCount = paths.filter(path => {
    const minReturn = Math.min(...path);
    return minReturn <= ruinThreshold;
  }).length;
  
  return ruinCount / paths.length;
}

function runStressScenario(
  scenario: StressScenario,
  baseVolatility: number,
  meanReturn: number,
  capitalAmount: number
): StressTestResult {
  const scenarioConfigs: Record<StressScenario, { description: string; shock: number; probability: number; recoveryMult: number }> = {
    CRASH: {
      description: "Market crash similar to 2008 or March 2020",
      shock: -0.35,
      probability: 0.02,
      recoveryMult: 2.0,
    },
    VOLATILITY_SPIKE: {
      description: "VIX spike to 50+ levels",
      shock: -0.15,
      probability: 0.05,
      recoveryMult: 1.2,
    },
    CORRELATION_BREAKDOWN: {
      description: "All assets become correlated during crisis",
      shock: -0.25,
      probability: 0.03,
      recoveryMult: 1.5,
    },
    LIQUIDITY_CRISIS: {
      description: "Bid-ask spreads widen dramatically",
      shock: -0.20,
      probability: 0.04,
      recoveryMult: 1.3,
    },
    REGIME_SHIFT: {
      description: "Fundamental market structure change",
      shock: -0.10,
      probability: 0.10,
      recoveryMult: 3.0,
    },
  };
  
  const config = scenarioConfigs[scenario];
  const effectiveShock = config.shock * (1 + baseVolatility);
  const projectedLoss = -effectiveShock * capitalAmount;
  
  const dailyRecoveryRate = Math.abs(meanReturn) / 252;
  const recoveryDays = dailyRecoveryRate > 0
    ? Math.ceil(Math.abs(effectiveShock) / dailyRecoveryRate)
    : 365;
  
  return {
    scenario,
    description: config.description,
    appliedShock: effectiveShock,
    projectedLoss,
    lossPercent: -effectiveShock * 100,
    recoveryDays: Math.min(recoveryDays, 365),
    probability: config.probability,
  };
}

function calculateTailRiskScore(
  cvar99: number,
  kurtosis: number,
  probabilityOfRuin: number
): number {
  const cvarScore = Math.min(40, Math.abs(cvar99) * 2);
  const kurtosisScore = Math.min(30, Math.max(0, kurtosis) * 5);
  const ruinScore = probabilityOfRuin * 100 * 30;
  
  return Math.min(100, cvarScore + kurtosisScore + ruinScore);
}

function determineRiskLevel(tailRiskScore: number, cvar99Percent: number): RiskLevel {
  if (tailRiskScore >= 80 || cvar99Percent >= 30) return "EXTREME";
  if (tailRiskScore >= 60 || cvar99Percent >= 20) return "HIGH";
  if (tailRiskScore >= 40 || cvar99Percent >= 15) return "ELEVATED";
  if (tailRiskScore >= 20 || cvar99Percent >= 10) return "MODERATE";
  return "LOW";
}

function generateRecommendations(
  result: Partial<MonteCarloResult>,
  varResults: VaRResult[],
  stressTests: StressTestResult[]
): string[] {
  const recommendations: string[] = [];
  
  const var95 = varResults.find(v => v.confidenceLevel === 0.95);
  const var99 = varResults.find(v => v.confidenceLevel === 0.99);
  
  if (var99 && var99.varPercent > 20) {
    recommendations.push("Extreme tail risk detected - consider reducing position sizes by 50%");
  } else if (var95 && var95.varPercent > 15) {
    recommendations.push("Elevated VaR - review risk parameters and consider tighter stops");
  }
  
  if (result.probabilityOfRuin && result.probabilityOfRuin > 0.05) {
    recommendations.push("High probability of significant drawdown - diversify or reduce leverage");
  }
  
  const crashTest = stressTests.find(s => s.scenario === "CRASH");
  if (crashTest && crashTest.lossPercent > 40) {
    recommendations.push("Vulnerable to market crashes - add tail-risk hedges or reduce exposure");
  }
  
  if (result.simulations && result.simulations.kurtosis > 3) {
    recommendations.push("Fat-tailed return distribution - standard VaR may underestimate risk");
  }
  
  if (result.simulations && result.simulations.skewness < -0.5) {
    recommendations.push("Negative skew detected - consider asymmetric risk management");
  }
  
  if (recommendations.length === 0) {
    recommendations.push("Risk metrics within acceptable bounds - maintain current strategy");
  }
  
  return recommendations;
}

export async function runMonteCarloSimulation(
  botId: string,
  config: Partial<MonteCarloConfig> = {}
): Promise<MonteCarloResult> {
  const startTime = Date.now();
  
  const cacheKey = `monte-carlo-${botId}`;
  const cached = monteCarloCache.get(cacheKey);
  if (cached && cached.expiry > new Date()) {
    return cached.result;
  }
  
  const fullConfig: MonteCarloConfig = {
    numSimulations: config.numSimulations || 10000,
    horizonDays: config.horizonDays || 21,
    confidenceLevels: config.confidenceLevels || [0.90, 0.95, 0.99],
    includeStressScenarios: config.includeStressScenarios ?? true,
    capitalAmount: config.capitalAmount || 10000,
    seed: config.seed,
  };
  
  const bot = await db.query.bots.findFirst({
    where: eq(bots.id, botId),
  });
  
  let meanReturn = 0.10;
  let volatility = 0.20;
  
  if (bot) {
    const livePnl = bot.livePnl || bot.simPnl || 0;
    const capital = bot.capitalAllocated || fullConfig.capitalAmount;
    meanReturn = capital > 0 ? livePnl / capital : 0.10;
    
    const archetype = (bot.strategyConfig as Record<string, unknown>)?.archetype as string || "UNKNOWN";
    const archetypeVols: Record<string, number> = {
      TREND_FOLLOW: 0.25,
      MEAN_REVERT: 0.15,
      BREAKOUT: 0.30,
      SCALP: 0.10,
      SWING: 0.20,
      VOLATILITY: 0.35,
    };
    volatility = archetypeVols[archetype] || 0.20;
  }
  
  console.log(`[MONTE_CARLO] Running ${fullConfig.numSimulations} simulations for bot ${botId}`);
  
  const rng = new RandomGenerator(fullConfig.seed);
  const paths = simulateReturns(
    meanReturn,
    volatility,
    fullConfig.horizonDays,
    fullConfig.numSimulations,
    rng
  );
  
  const finalReturns = paths.map(path => path[path.length - 1]);
  
  const moments = calculateMoments(finalReturns);
  
  const varResults = calculateVaR(
    finalReturns,
    fullConfig.confidenceLevels,
    fullConfig.capitalAmount
  );
  
  const drawdownDistribution = calculateDrawdownDistribution(paths);
  
  const probabilityOfRuin = calculateProbabilityOfRuin(paths, -0.5);
  
  const stressTests: StressTestResult[] = fullConfig.includeStressScenarios
    ? (["CRASH", "VOLATILITY_SPIKE", "CORRELATION_BREAKDOWN", "LIQUIDITY_CRISIS", "REGIME_SHIFT"] as StressScenario[])
        .map(scenario => runStressScenario(scenario, volatility, meanReturn, fullConfig.capitalAmount))
    : [];
  
  const cvar99 = varResults.find(v => v.confidenceLevel === 0.99)?.cvarPercent || 0;
  const tailRiskScore = calculateTailRiskScore(cvar99, moments.kurtosis, probabilityOfRuin);
  const overallRiskLevel = determineRiskLevel(tailRiskScore, cvar99);
  
  const partialResult: Partial<MonteCarloResult> = {
    simulations: {
      completed: fullConfig.numSimulations,
      meanReturn: moments.mean,
      stdDev: moments.stdDev,
      minReturn: Math.min(...finalReturns),
      maxReturn: Math.max(...finalReturns),
      skewness: moments.skewness,
      kurtosis: moments.kurtosis,
    },
    probabilityOfRuin,
  };
  
  const recommendations = generateRecommendations(partialResult, varResults, stressTests);
  
  const result: MonteCarloResult = {
    botId,
    config: fullConfig,
    simulations: partialResult.simulations!,
    varResults,
    stressTests,
    drawdownDistribution,
    probabilityOfRuin,
    tailRiskScore,
    overallRiskLevel,
    recommendations,
    timestamp: new Date(),
    durationMs: Date.now() - startTime,
  };
  
  monteCarloCache.set(cacheKey, {
    result,
    expiry: new Date(Date.now() + CACHE_TTL_MS),
  });
  
  console.log(`[MONTE_CARLO] Completed in ${result.durationMs}ms - Risk Level: ${overallRiskLevel}`);
  
  return result;
}

export async function runPortfolioMonteCarlo(
  botIds: string[],
  config: Partial<MonteCarloConfig> = {}
): Promise<PortfolioMonteCarloResult> {
  const botResults = await Promise.all(
    botIds.map(botId => runMonteCarloSimulation(botId, config))
  );
  
  const avgVarResults: VaRResult[] = [];
  const confidenceLevels = config.confidenceLevels || [0.90, 0.95, 0.99];
  
  for (const confidence of confidenceLevels) {
    const varsAtLevel = botResults
      .map(r => r.varResults.find(v => v.confidenceLevel === confidence))
      .filter((v): v is VaRResult => v !== undefined);
    
    if (varsAtLevel.length > 0) {
      const diversificationFactor = 1 / Math.sqrt(varsAtLevel.length);
      
      avgVarResults.push({
        confidenceLevel: confidence,
        varAbsolute: varsAtLevel.reduce((sum, v) => sum + v.varAbsolute, 0) * diversificationFactor,
        varPercent: varsAtLevel.reduce((sum, v) => sum + v.varPercent, 0) / varsAtLevel.length * diversificationFactor,
        cvarAbsolute: varsAtLevel.reduce((sum, v) => sum + v.cvarAbsolute, 0) * diversificationFactor,
        cvarPercent: varsAtLevel.reduce((sum, v) => sum + v.cvarPercent, 0) / varsAtLevel.length * diversificationFactor,
      });
    }
  }
  
  const undiversifiedVar = botResults.reduce((sum, r) => {
    const var95 = r.varResults.find(v => v.confidenceLevel === 0.95);
    return sum + (var95?.varAbsolute || 0);
  }, 0);
  
  const diversifiedVar = avgVarResults.find(v => v.confidenceLevel === 0.95)?.varAbsolute || 0;
  const diversificationBenefit = undiversifiedVar > 0
    ? (undiversifiedVar - diversifiedVar) / undiversifiedVar * 100
    : 0;
  
  const maxTailRisk = Math.max(...botResults.map(r => r.tailRiskScore));
  const avgCvar99 = botResults.reduce((sum, r) => {
    const cvar = r.varResults.find(v => v.confidenceLevel === 0.99);
    return sum + (cvar?.cvarPercent || 0);
  }, 0) / botResults.length;
  
  const portfolioRiskLevel = determineRiskLevel(maxTailRisk, avgCvar99);
  
  const recommendations: string[] = [];
  if (diversificationBenefit < 10) {
    recommendations.push("Low diversification benefit - strategies may be too correlated");
  }
  if (portfolioRiskLevel === "EXTREME" || portfolioRiskLevel === "HIGH") {
    recommendations.push("Portfolio risk is elevated - consider reducing overall exposure");
  }
  if (botResults.some(r => r.probabilityOfRuin > 0.1)) {
    recommendations.push("Some strategies have high ruin probability - review individual bot risks");
  }
  
  return {
    portfolioId: `portfolio-${botIds.join("-").slice(0, 20)}`,
    botResults,
    aggregateVaR: avgVarResults,
    aggregateStressTests: botResults[0]?.stressTests || [],
    diversificationBenefit,
    portfolioRiskLevel,
    recommendations,
    timestamp: new Date(),
  };
}

export function getMonteCarloSummary(): {
  cachedBots: number;
  avgTailRisk: number;
  highRiskBots: number;
} {
  let totalTailRisk = 0;
  let highRiskCount = 0;
  let count = 0;
  
  for (const [_, cached] of monteCarloCache) {
    if (cached.expiry > new Date()) {
      totalTailRisk += cached.result.tailRiskScore;
      if (cached.result.overallRiskLevel === "HIGH" || cached.result.overallRiskLevel === "EXTREME") {
        highRiskCount++;
      }
      count++;
    }
  }
  
  return {
    cachedBots: count,
    avgTailRisk: count > 0 ? totalTailRisk / count : 0,
    highRiskBots: highRiskCount,
  };
}

export async function runMonteCarloTests(): Promise<{ passed: boolean; results: string[] }> {
  const results: string[] = [];
  let allPassed = true;

  const rng = new RandomGenerator(42);
  const normals = Array.from({ length: 1000 }, () => rng.normalRandom());
  const normalMean = normals.reduce((a, b) => a + b, 0) / normals.length;
  const normalStd = Math.sqrt(normals.reduce((s, n) => s + (n - normalMean) ** 2, 0) / normals.length);
  
  if (Math.abs(normalMean) < 0.1 && Math.abs(normalStd - 1) < 0.1) {
    results.push("PASS: Normal random generator produces valid distribution");
  } else {
    results.push(`FAIL: Normal distribution off - mean=${normalMean.toFixed(3)}, std=${normalStd.toFixed(3)}`);
    allPassed = false;
  }

  const moments = calculateMoments([1, 2, 3, 4, 5]);
  if (Math.abs(moments.mean - 3) < 0.01 && moments.stdDev > 0) {
    results.push("PASS: Moment calculation correct");
  } else {
    results.push(`FAIL: Moment calculation - mean=${moments.mean}, expected 3`);
    allPassed = false;
  }

  const paths = simulateReturns(0.10, 0.20, 21, 100, new RandomGenerator(123));
  if (paths.length === 100 && paths[0].length === 21) {
    results.push("PASS: Path simulation generates correct dimensions");
  } else {
    results.push("FAIL: Path simulation dimensions incorrect");
    allPassed = false;
  }

  const testReturns = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const varResults = calculateVaR(testReturns, [0.90, 0.95], 10000);
  const var90 = varResults.find(v => v.confidenceLevel === 0.90);
  if (var90 && var90.varAbsolute > 0) {
    results.push("PASS: VaR calculation returns positive loss");
  } else {
    results.push("FAIL: VaR should be positive for loss");
    allPassed = false;
  }

  const cvar = varResults.find(v => v.confidenceLevel === 0.95);
  if (cvar && cvar.cvarAbsolute >= cvar.varAbsolute) {
    results.push("PASS: CVaR >= VaR (expected shortfall property)");
  } else {
    results.push("FAIL: CVaR should be >= VaR");
    allPassed = false;
  }

  const stressResult = runStressScenario("CRASH", 0.2, 0.1, 10000);
  if (stressResult.projectedLoss > 0 && stressResult.lossPercent > 0) {
    results.push("PASS: Stress scenario produces positive projected loss");
  } else {
    results.push("FAIL: Stress scenario should show loss");
    allPassed = false;
  }

  const tailScore = calculateTailRiskScore(15, 2, 0.05);
  if (tailScore >= 0 && tailScore <= 100) {
    results.push("PASS: Tail risk score within valid range");
  } else {
    results.push(`FAIL: Tail risk score out of range: ${tailScore}`);
    allPassed = false;
  }

  if (determineRiskLevel(90, 35) === "EXTREME") {
    results.push("PASS: Risk level classification correct for extreme case");
  } else {
    results.push("FAIL: High tail risk should be EXTREME");
    allPassed = false;
  }

  console.log(`[MONTE_CARLO_TESTS] ${results.filter(r => r.startsWith("PASS")).length}/${results.length} tests passed`);

  return { passed: allPassed, results };
}

runMonteCarloTests().then(({ passed, results }) => {
  console.log("[MONTE_CARLO] Self-test results:", passed ? "ALL PASSED" : "SOME FAILED");
  results.forEach(r => console.log(`  ${r}`));
});

export const monteCarloEngine = {
  simulate: runMonteCarloSimulation,
  simulatePortfolio: runPortfolioMonteCarlo,
  getSummary: getMonteCarloSummary,
  runTests: runMonteCarloTests,
};
