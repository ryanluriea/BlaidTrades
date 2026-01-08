import { db } from "../db";
import { mlModels } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { modelTrainingService } from "./model-training-service";
import type { LiveBar } from "../live-data-service";

export interface DriftMetrics {
  psi: number;
  klDivergence: number;
  featureDrift: Record<string, number>;
  hasDrift: boolean;
  severity: "NONE" | "LOW" | "MEDIUM" | "HIGH";
}

export interface RetrainingSchedule {
  symbol: string;
  lastTrainedAt: Date | null;
  nextScheduledAt: Date;
  driftMetrics: DriftMetrics | null;
  requiresRetraining: boolean;
  reason: string;
}

export interface RetrainingConfig {
  retrainingIntervalDays: number;
  psiThreshold: number;
  klDivergenceThreshold: number;
  minBarsForRetraining: number;
  autoRetrain: boolean;
}

const DEFAULT_CONFIG: RetrainingConfig = {
  retrainingIntervalDays: 7,
  psiThreshold: 0.2,
  klDivergenceThreshold: 0.1,
  minBarsForRetraining: 1000,
  autoRetrain: false,
};

export class ModelRetrainingScheduler {
  private config: RetrainingConfig;
  private retrainingInProgress: Set<string> = new Set();

  constructor(config: Partial<RetrainingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getSchedule(symbol: string): Promise<RetrainingSchedule> {
    const [latestModel] = await db
      .select()
      .from(mlModels)
      .where(eq(mlModels.symbol, symbol))
      .orderBy(desc(mlModels.createdAt))
      .limit(1);

    const lastTrainedAt = latestModel?.createdAt || null;
    const nextScheduledAt = this.calculateNextRetraining(lastTrainedAt);
    
    const now = new Date();
    const isPastDue = nextScheduledAt <= now;

    return {
      symbol,
      lastTrainedAt,
      nextScheduledAt,
      driftMetrics: null,
      requiresRetraining: isPastDue,
      reason: isPastDue 
        ? `Scheduled retraining overdue (last: ${lastTrainedAt?.toISOString() || "never"})`
        : `Next retraining scheduled for ${nextScheduledAt.toISOString()}`,
    };
  }

  private calculateNextRetraining(lastTrainedAt: Date | null): Date {
    if (!lastTrainedAt) {
      return new Date();
    }
    
    const next = new Date(lastTrainedAt);
    next.setDate(next.getDate() + this.config.retrainingIntervalDays);
    return next;
  }

  calculateDrift(
    trainingFeatures: number[][],
    currentFeatures: number[][]
  ): DriftMetrics {
    if (trainingFeatures.length === 0 || currentFeatures.length === 0) {
      return {
        psi: 0,
        klDivergence: 0,
        featureDrift: {},
        hasDrift: false,
        severity: "NONE",
      };
    }

    const numFeatures = Math.min(
      trainingFeatures[0]?.length || 0,
      currentFeatures[0]?.length || 0
    );

    const featureDrift: Record<string, number> = {};
    let totalPSI = 0;
    let totalKL = 0;

    for (let f = 0; f < numFeatures; f++) {
      const trainDist = trainingFeatures.map(row => row[f]);
      const currDist = currentFeatures.map(row => row[f]);

      const psi = this.calculatePSI(trainDist, currDist);
      const kl = this.calculateKLDivergence(trainDist, currDist);

      featureDrift[`feature_${f}`] = psi;
      totalPSI += psi;
      totalKL += kl;
    }

    const avgPSI = numFeatures > 0 ? totalPSI / numFeatures : 0;
    const avgKL = numFeatures > 0 ? totalKL / numFeatures : 0;

    let severity: "NONE" | "LOW" | "MEDIUM" | "HIGH" = "NONE";
    if (avgPSI >= this.config.psiThreshold * 2) severity = "HIGH";
    else if (avgPSI >= this.config.psiThreshold) severity = "MEDIUM";
    else if (avgPSI >= this.config.psiThreshold * 0.5) severity = "LOW";

    const hasDrift = avgPSI >= this.config.psiThreshold || avgKL >= this.config.klDivergenceThreshold;

    return {
      psi: avgPSI,
      klDivergence: avgKL,
      featureDrift,
      hasDrift,
      severity,
    };
  }

  private calculatePSI(expected: number[], actual: number[]): number {
    const numBins = 10;
    const expectedHist = this.histogram(expected, numBins);
    const actualHist = this.histogram(actual, numBins);

    let psi = 0;
    for (let i = 0; i < numBins; i++) {
      const e = Math.max(expectedHist[i], 0.0001);
      const a = Math.max(actualHist[i], 0.0001);
      psi += (a - e) * Math.log(a / e);
    }

    return Math.abs(psi);
  }

  private calculateKLDivergence(p: number[], q: number[]): number {
    const numBins = 10;
    const pHist = this.histogram(p, numBins);
    const qHist = this.histogram(q, numBins);

    let kl = 0;
    for (let i = 0; i < numBins; i++) {
      const pVal = Math.max(pHist[i], 0.0001);
      const qVal = Math.max(qHist[i], 0.0001);
      kl += pVal * Math.log(pVal / qVal);
    }

    return Math.abs(kl);
  }

  private histogram(values: number[], numBins: number): number[] {
    if (values.length === 0) return new Array(numBins).fill(1 / numBins);

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binWidth = range / numBins;

    const counts = new Array(numBins).fill(0);
    for (const v of values) {
      const bin = Math.min(numBins - 1, Math.floor((v - min) / binWidth));
      counts[bin]++;
    }

    const total = values.length;
    return counts.map(c => c / total);
  }

  async checkAndRetrain(
    symbol: string,
    bars: LiveBar[],
    force: boolean = false
  ): Promise<{ retrained: boolean; reason: string; modelId?: string }> {
    if (this.retrainingInProgress.has(symbol)) {
      return { retrained: false, reason: "Retraining already in progress" };
    }

    if (bars.length < this.config.minBarsForRetraining) {
      return { 
        retrained: false, 
        reason: `Insufficient bars: ${bars.length}/${this.config.minBarsForRetraining}` 
      };
    }

    const schedule = await this.getSchedule(symbol);

    if (!force && !schedule.requiresRetraining) {
      return { retrained: false, reason: schedule.reason };
    }

    this.retrainingInProgress.add(symbol);
    
    try {
      console.log(`[RETRAINING] Starting retraining for ${symbol}`);
      const model = await modelTrainingService.trainModel(symbol, bars);
      
      console.log(`[RETRAINING] Completed for ${symbol}: model=${model.id} accuracy=${model.testMetrics.accuracy.toFixed(4)}`);
      
      return { 
        retrained: true, 
        reason: "Retraining completed successfully",
        modelId: model.id,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[RETRAINING] Failed for ${symbol}:`, error);
      return { retrained: false, reason: `Retraining failed: ${errorMsg}` };
    } finally {
      this.retrainingInProgress.delete(symbol);
    }
  }

  async getAllSchedules(): Promise<RetrainingSchedule[]> {
    const models = await db
      .select()
      .from(mlModels)
      .orderBy(desc(mlModels.createdAt));

    const symbolMap = new Map<string, typeof models[0]>();
    for (const model of models) {
      if (!symbolMap.has(model.symbol)) {
        symbolMap.set(model.symbol, model);
      }
    }

    const schedules: RetrainingSchedule[] = [];
    for (const [symbol, model] of symbolMap) {
      const schedule = await this.getSchedule(symbol);
      schedules.push(schedule);
    }

    return schedules;
  }
}

export const modelRetrainingScheduler = new ModelRetrainingScheduler();
