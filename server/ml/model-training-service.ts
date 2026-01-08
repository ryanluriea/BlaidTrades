import { db } from "../db";
import { mlModels } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { FeatureEngineer, FeatureVector } from "./feature-engineering";
import { GradientBoostingClassifier, TrainedModel, serializeModel, deserializeModel, FeatureImportance } from "./gradient-boosting";
import type { LiveBar } from "../live-data-service";

export interface ModelTrainingJob {
  id: string;
  symbol: string;
  status: "PENDING" | "TRAINING" | "COMPLETED" | "FAILED";
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  modelId?: string;
}

export interface StoredModel {
  id: string;
  symbol: string;
  modelType: string;
  version: number;
  createdAt: Date;
  trainAccuracy: number;
  testAccuracy: number;
  featureImportance: FeatureImportance[];
  isActive: boolean;
  modelData: string;
}

const trainingJobs: Map<string, ModelTrainingJob> = new Map();
const modelCache: Map<string, TrainedModel> = new Map();

export class ModelTrainingService {
  private featureEngineer: FeatureEngineer;
  private classifier: GradientBoostingClassifier;

  constructor() {
    this.featureEngineer = new FeatureEngineer();
    this.classifier = new GradientBoostingClassifier({
      numTrees: 100,
      maxDepth: 5,
      learningRate: 0.1,
      minSamplesLeaf: 10,
      subsampleRatio: 0.8,
    });
  }

  async trainModel(symbol: string, bars: LiveBar[]): Promise<TrainedModel> {
    const traceId = `ml_train_${Date.now()}`;
    console.log(`[MODEL_TRAINING] trace_id=${traceId} Starting training for ${symbol} with ${bars.length} bars`);

    const job: ModelTrainingJob = {
      id: traceId,
      symbol,
      status: "TRAINING",
      createdAt: new Date(),
    };
    trainingJobs.set(traceId, job);

    try {
      const features = this.featureEngineer.extractFeatures(bars, 5);
      
      if (features.length < 500) {
        throw new Error(`Insufficient feature vectors: ${features.length}, need at least 500`);
      }

      const model = this.classifier.train(features);
      const featureImportance = this.classifier.getFeatureImportance(model);

      const existingModels = await db
        .select()
        .from(mlModels)
        .where(eq(mlModels.symbol, symbol))
        .orderBy(desc(mlModels.version))
        .limit(1);

      const nextVersion = existingModels.length > 0 ? existingModels[0].version + 1 : 1;

      await db.update(mlModels)
        .set({ isActive: false })
        .where(eq(mlModels.symbol, symbol));

      const [stored] = await db.insert(mlModels).values({
        id: model.id,
        symbol,
        modelType: "GRADIENT_BOOSTING",
        version: nextVersion,
        trainAccuracy: model.trainMetrics.accuracy,
        testAccuracy: model.testMetrics.accuracy,
        trainPrecision: model.trainMetrics.precision,
        testPrecision: model.testMetrics.precision,
        trainRecall: model.trainMetrics.recall,
        testRecall: model.testMetrics.recall,
        trainF1: model.trainMetrics.f1Score,
        testF1: model.testMetrics.f1Score,
        trainAuc: model.trainMetrics.auc,
        testAuc: model.testMetrics.auc,
        featureImportance: JSON.stringify(featureImportance),
        isActive: true,
        modelData: serializeModel(model),
        createdAt: new Date(),
      }).returning();

      modelCache.set(symbol, model);

      job.status = "COMPLETED";
      job.completedAt = new Date();
      job.modelId = model.id;

      console.log(`[MODEL_TRAINING] trace_id=${traceId} Completed. Model ${model.id} v${nextVersion}, test_acc=${model.testMetrics.accuracy.toFixed(4)}`);

      return model;
    } catch (error) {
      job.status = "FAILED";
      job.error = error instanceof Error ? error.message : String(error);
      console.error(`[MODEL_TRAINING] trace_id=${traceId} Failed:`, error);
      throw error;
    }
  }

  async getActiveModel(symbol: string): Promise<TrainedModel | null> {
    if (modelCache.has(symbol)) {
      return modelCache.get(symbol)!;
    }

    const [stored] = await db
      .select()
      .from(mlModels)
      .where(eq(mlModels.symbol, symbol))
      .limit(1);

    if (!stored) {
      return null;
    }

    const model = deserializeModel(stored.modelData);
    modelCache.set(symbol, model);
    return model;
  }

  async predict(symbol: string, features: Record<string, number>): Promise<{ probability: number; prediction: number; confidence: number } | null> {
    const model = await this.getActiveModel(symbol);
    if (!model) {
      return null;
    }

    return this.classifier.predict(model, features);
  }

  async getAllModels(): Promise<StoredModel[]> {
    const models = await db
      .select()
      .from(mlModels)
      .orderBy(desc(mlModels.createdAt));

    return models.map(m => ({
      id: m.id,
      symbol: m.symbol,
      modelType: m.modelType,
      version: m.version,
      createdAt: m.createdAt || new Date(),
      trainAccuracy: m.trainAccuracy,
      testAccuracy: m.testAccuracy,
      featureImportance: JSON.parse(m.featureImportance || "[]"),
      isActive: m.isActive,
      modelData: m.modelData,
    }));
  }

  async getModelById(modelId: string): Promise<TrainedModel | null> {
    const [stored] = await db
      .select()
      .from(mlModels)
      .where(eq(mlModels.id, modelId))
      .limit(1);

    if (!stored) {
      return null;
    }

    return deserializeModel(stored.modelData);
  }

  async activateModel(modelId: string): Promise<void> {
    const [model] = await db
      .select()
      .from(mlModels)
      .where(eq(mlModels.id, modelId))
      .limit(1);

    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    await db.update(mlModels)
      .set({ isActive: false })
      .where(eq(mlModels.symbol, model.symbol));

    await db.update(mlModels)
      .set({ isActive: true })
      .where(eq(mlModels.id, modelId));

    modelCache.delete(model.symbol);
  }

  getTrainingJobs(): ModelTrainingJob[] {
    return Array.from(trainingJobs.values());
  }

  clearCache(): void {
    modelCache.clear();
  }
}

export const modelTrainingService = new ModelTrainingService();
