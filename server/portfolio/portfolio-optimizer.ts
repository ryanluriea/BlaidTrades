import { db } from "../db";
import { bots, botInstances, tradeLogs } from "@shared/schema";
import { eq, and, gte, desc } from "drizzle-orm";

export interface BotReturns {
  botId: string;
  botName: string;
  symbol: string;
  returns: number[];
  avgReturn: number;
  volatility: number;
  sharpe: number;
}

export interface CorrelationMatrix {
  botIds: string[];
  matrix: number[][];
  timestamp: Date;
}

export interface PortfolioAllocation {
  botId: string;
  weight: number;
  riskContribution: number;
  expectedReturn: number;
}

export interface PortfolioMetrics {
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  maxCorrelation: number;
  diversificationRatio: number;
}

export interface OptimizationResult {
  allocations: PortfolioAllocation[];
  metrics: PortfolioMetrics;
  efficientFrontier: { volatility: number; return: number }[];
  correlationMatrix: CorrelationMatrix;
  timestamp: Date;
}

export class PortfolioOptimizer {
  private riskFreeRate: number = 0.05;
  private maxCorrelationLimit: number = 0.7;
  private minWeight: number = 0.02;
  private maxWeight: number = 0.4;

  async calculateBotReturns(lookbackDays: number = 30): Promise<BotReturns[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);

    const activeBots = await db
      .select()
      .from(bots)
      .where(eq(bots.stage, "PAPER"));

    const botReturns: BotReturns[] = [];

    for (const bot of activeBots) {
      const trades = await db
        .select()
        .from(tradeLogs)
        .where(and(
          eq(tradeLogs.botId, bot.id),
          gte(tradeLogs.createdAt, cutoff)
        ))
        .orderBy(desc(tradeLogs.createdAt));

      if (trades.length < 5) continue;

      const dailyReturns: Map<string, number> = new Map();
      
      for (const trade of trades) {
        const dateKey = trade.createdAt?.toISOString().split("T")[0] || "";
        const pnl = Number(trade.pnl) || 0;
        dailyReturns.set(dateKey, (dailyReturns.get(dateKey) || 0) + pnl);
      }

      const returns = Array.from(dailyReturns.values());
      if (returns.length < 3) continue;

      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length;
      const volatility = Math.sqrt(variance);
      const sharpe = volatility > 0 ? (avgReturn - this.riskFreeRate / 252) / volatility : 0;

      botReturns.push({
        botId: bot.id,
        botName: bot.name,
        symbol: bot.symbol,
        returns,
        avgReturn,
        volatility,
        sharpe,
      });
    }

    return botReturns;
  }

  calculateCorrelationMatrix(botReturns: BotReturns[]): CorrelationMatrix {
    const n = botReturns.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = 1;
        } else if (i < j) {
          const corr = this.pearsonCorrelation(botReturns[i].returns, botReturns[j].returns);
          matrix[i][j] = corr;
          matrix[j][i] = corr;
        }
      }
    }

    return {
      botIds: botReturns.map(b => b.botId),
      matrix,
      timestamp: new Date(),
    };
  }

  private pearsonCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 3) return 0;

    const xSlice = x.slice(0, n);
    const ySlice = y.slice(0, n);

    const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
    const yMean = ySlice.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let xDenom = 0;
    let yDenom = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = xSlice[i] - xMean;
      const yDiff = ySlice[i] - yMean;
      numerator += xDiff * yDiff;
      xDenom += xDiff * xDiff;
      yDenom += yDiff * yDiff;
    }

    const denom = Math.sqrt(xDenom * yDenom);
    return denom > 0 ? numerator / denom : 0;
  }

  optimizePortfolio(botReturns: BotReturns[], correlationMatrix: CorrelationMatrix): OptimizationResult {
    const n = botReturns.length;
    
    if (n === 0) {
      return {
        allocations: [],
        metrics: { expectedReturn: 0, volatility: 0, sharpe: 0, maxCorrelation: 0, diversificationRatio: 1 },
        efficientFrontier: [],
        correlationMatrix,
        timestamp: new Date(),
      };
    }

    const covMatrix = this.buildCovarianceMatrix(botReturns, correlationMatrix);

    let bestWeights = this.equalWeight(n);
    let bestSharpe = this.calculatePortfolioSharpe(bestWeights, botReturns, covMatrix);

    for (let iter = 0; iter < 1000; iter++) {
      const candidate = this.generateRandomWeights(n);
      const sharpe = this.calculatePortfolioSharpe(candidate, botReturns, covMatrix);
      
      if (sharpe > bestSharpe && this.satisfiesConstraints(candidate, correlationMatrix)) {
        bestWeights = candidate;
        bestSharpe = sharpe;
      }
    }

    const portfolioReturn = this.calculatePortfolioReturn(bestWeights, botReturns);
    const portfolioVol = this.calculatePortfolioVolatility(bestWeights, covMatrix);
    const maxCorr = this.findMaxCorrelation(correlationMatrix);
    const divRatio = this.calculateDiversificationRatio(bestWeights, botReturns, portfolioVol);

    const allocations: PortfolioAllocation[] = botReturns.map((bot, i) => ({
      botId: bot.botId,
      weight: bestWeights[i],
      riskContribution: this.calculateRiskContribution(i, bestWeights, covMatrix, portfolioVol),
      expectedReturn: bot.avgReturn * bestWeights[i],
    }));

    const efficientFrontier = this.calculateEfficientFrontier(botReturns, covMatrix);

    return {
      allocations,
      metrics: {
        expectedReturn: portfolioReturn,
        volatility: portfolioVol,
        sharpe: bestSharpe,
        maxCorrelation: maxCorr,
        diversificationRatio: divRatio,
      },
      efficientFrontier,
      correlationMatrix,
      timestamp: new Date(),
    };
  }

  private buildCovarianceMatrix(botReturns: BotReturns[], corrMatrix: CorrelationMatrix): number[][] {
    const n = botReturns.length;
    const cov: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        cov[i][j] = corrMatrix.matrix[i][j] * botReturns[i].volatility * botReturns[j].volatility;
      }
    }

    return cov;
  }

  private equalWeight(n: number): number[] {
    return Array(n).fill(1 / n);
  }

  private generateRandomWeights(n: number): number[] {
    const weights = Array(n).fill(0).map(() => Math.random());
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => {
      const normalized = w / sum;
      return Math.max(this.minWeight, Math.min(this.maxWeight, normalized));
    });
  }

  private calculatePortfolioReturn(weights: number[], botReturns: BotReturns[]): number {
    return weights.reduce((sum, w, i) => sum + w * botReturns[i].avgReturn, 0);
  }

  private calculatePortfolioVolatility(weights: number[], covMatrix: number[][]): number {
    const n = weights.length;
    let variance = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        variance += weights[i] * weights[j] * covMatrix[i][j];
      }
    }

    return Math.sqrt(variance);
  }

  private calculatePortfolioSharpe(weights: number[], botReturns: BotReturns[], covMatrix: number[][]): number {
    const ret = this.calculatePortfolioReturn(weights, botReturns);
    const vol = this.calculatePortfolioVolatility(weights, covMatrix);
    return vol > 0 ? (ret - this.riskFreeRate / 252) / vol : 0;
  }

  private satisfiesConstraints(weights: number[], corrMatrix: CorrelationMatrix): boolean {
    for (const w of weights) {
      if (w < this.minWeight || w > this.maxWeight) return false;
    }
    
    const maxCorr = this.findMaxCorrelation(corrMatrix);
    if (maxCorr > this.maxCorrelationLimit) return false;

    return true;
  }

  private findMaxCorrelation(corrMatrix: CorrelationMatrix): number {
    let maxCorr = 0;
    const n = corrMatrix.matrix.length;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        maxCorr = Math.max(maxCorr, Math.abs(corrMatrix.matrix[i][j]));
      }
    }

    return maxCorr;
  }

  private calculateDiversificationRatio(weights: number[], botReturns: BotReturns[], portfolioVol: number): number {
    const weightedVol = weights.reduce((sum, w, i) => sum + w * botReturns[i].volatility, 0);
    return portfolioVol > 0 ? weightedVol / portfolioVol : 1;
  }

  private calculateRiskContribution(idx: number, weights: number[], covMatrix: number[][], portfolioVol: number): number {
    const n = weights.length;
    let marginalContrib = 0;

    for (let j = 0; j < n; j++) {
      marginalContrib += weights[j] * covMatrix[idx][j];
    }

    return portfolioVol > 0 ? (weights[idx] * marginalContrib) / (portfolioVol * portfolioVol) : 0;
  }

  private calculateEfficientFrontier(botReturns: BotReturns[], covMatrix: number[][]): { volatility: number; return: number }[] {
    const frontier: { volatility: number; return: number }[] = [];
    const n = botReturns.length;

    const minRet = Math.min(...botReturns.map(b => b.avgReturn));
    const maxRet = Math.max(...botReturns.map(b => b.avgReturn));

    for (let targetRet = minRet; targetRet <= maxRet; targetRet += (maxRet - minRet) / 20) {
      let bestVol = Infinity;
      
      for (let iter = 0; iter < 100; iter++) {
        const weights = this.generateRandomWeights(n);
        const ret = this.calculatePortfolioReturn(weights, botReturns);
        
        if (Math.abs(ret - targetRet) < (maxRet - minRet) * 0.1) {
          const vol = this.calculatePortfolioVolatility(weights, covMatrix);
          if (vol < bestVol) {
            bestVol = vol;
          }
        }
      }

      if (bestVol < Infinity) {
        frontier.push({ volatility: bestVol, return: targetRet });
      }
    }

    return frontier.sort((a, b) => a.volatility - b.volatility);
  }
}

export const portfolioOptimizer = new PortfolioOptimizer();
