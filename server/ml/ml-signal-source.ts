import { modelTrainingService } from "./model-training-service";
import { FeatureEngineer } from "./feature-engineering";
import { db } from "../db";
import { mlPredictions } from "@shared/schema";
import type { LiveBar } from "../live-data-service";

export interface MLSignalResult {
  available: boolean;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  probability: number;
  modelId: string | null;
  modelVersion: number | null;
  features: Record<string, number>;
  reasoning: string;
  fetchedAt: Date;
}

export interface MLSignalConfig {
  confidenceThreshold: number;
  probabilityThreshold: number;
  minBarsRequired: number;
}

const DEFAULT_CONFIG: MLSignalConfig = {
  confidenceThreshold: 60,
  probabilityThreshold: 0.55,
  minBarsRequired: 50,
};

export class MLSignalSource {
  private featureEngineer: FeatureEngineer;
  private config: MLSignalConfig;

  constructor(config: Partial<MLSignalConfig> = {}) {
    this.featureEngineer = new FeatureEngineer();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getMLSignal(
    symbol: string,
    bars: LiveBar[],
    botId?: string,
    traceId?: string
  ): Promise<MLSignalResult> {
    const fetchedAt = new Date();
    
    if (bars.length < this.config.minBarsRequired) {
      return {
        available: false,
        bias: "NEUTRAL",
        confidence: 0,
        probability: 0.5,
        modelId: null,
        modelVersion: null,
        features: {},
        reasoning: `Insufficient bars: ${bars.length}/${this.config.minBarsRequired} required`,
        fetchedAt,
      };
    }

    const model = await modelTrainingService.getActiveModel(symbol);
    if (!model) {
      return {
        available: false,
        bias: "NEUTRAL",
        confidence: 0,
        probability: 0.5,
        modelId: null,
        modelVersion: null,
        features: {},
        reasoning: `No trained ML model available for ${symbol}`,
        fetchedAt,
      };
    }

    try {
      const featureVectors = this.featureEngineer.extractFeatures(bars, 1);
      if (featureVectors.length === 0) {
        return {
          available: false,
          bias: "NEUTRAL",
          confidence: 0,
          probability: 0.5,
          modelId: model.id,
          modelVersion: null,
          features: {},
          reasoning: "Failed to extract features from bar data",
          fetchedAt,
        };
      }

      const latestFeatures = featureVectors[featureVectors.length - 1].features;
      const prediction = await modelTrainingService.predict(symbol, latestFeatures);

      if (!prediction) {
        return {
          available: false,
          bias: "NEUTRAL",
          confidence: 0,
          probability: 0.5,
          modelId: model.id,
          modelVersion: null,
          features: latestFeatures,
          reasoning: "Model prediction failed",
          fetchedAt,
        };
      }

      const bias = this.interpretPrediction(prediction.probability, prediction.confidence);
      const confidence = prediction.confidence * 100;

      if (botId) {
        await this.logPrediction(model.id, botId, symbol, prediction, latestFeatures);
      }

      const reasoning = this.generateReasoning(prediction, bias, model.id);

      console.log(`[ML_SIGNAL] trace_id=${traceId || "none"} symbol=${symbol} bias=${bias} prob=${prediction.probability.toFixed(3)} conf=${confidence.toFixed(1)}%`);

      return {
        available: true,
        bias,
        confidence,
        probability: prediction.probability,
        modelId: model.id,
        modelVersion: null,
        features: latestFeatures,
        reasoning,
        fetchedAt,
      };
    } catch (error) {
      console.error(`[ML_SIGNAL] trace_id=${traceId || "none"} error:`, error);
      return {
        available: false,
        bias: "NEUTRAL",
        confidence: 0,
        probability: 0.5,
        modelId: model.id,
        modelVersion: null,
        features: {},
        reasoning: `ML prediction error: ${error instanceof Error ? error.message : "unknown"}`,
        fetchedAt,
      };
    }
  }

  private interpretPrediction(
    probability: number,
    confidence: number
  ): "BULLISH" | "BEARISH" | "NEUTRAL" {
    if (confidence < this.config.confidenceThreshold / 100) {
      return "NEUTRAL";
    }

    if (probability >= this.config.probabilityThreshold) {
      return "BULLISH";
    } else if (probability <= 1 - this.config.probabilityThreshold) {
      return "BEARISH";
    }
    return "NEUTRAL";
  }

  private generateReasoning(
    prediction: { probability: number; confidence: number },
    bias: "BULLISH" | "BEARISH" | "NEUTRAL",
    modelId: string
  ): string {
    const pct = (prediction.probability * 100).toFixed(1);
    const conf = (prediction.confidence * 100).toFixed(0);
    
    if (bias === "NEUTRAL") {
      return `ML model neutral: prob=${pct}% conf=${conf}% (below threshold)`;
    }
    
    return `ML model predicts ${bias.toLowerCase()}: prob=${pct}% conf=${conf}%`;
  }

  private async logPrediction(
    modelId: string,
    botId: string,
    symbol: string,
    prediction: { probability: number; confidence: number; prediction: number },
    features: Record<string, number>
  ): Promise<void> {
    try {
      await db.insert(mlPredictions).values({
        modelId,
        botId,
        symbol,
        timestamp: new Date(),
        prediction: prediction.prediction,
        probability: prediction.probability,
        confidence: prediction.confidence,
        features,
      });
    } catch (error) {
      console.warn("[ML_SIGNAL] Failed to log prediction:", error);
    }
  }
}

export const mlSignalSource = new MLSignalSource();
