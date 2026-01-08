import { FeatureVector, normalizeFeatures, splitTrainTest } from "./feature-engineering";

export interface GBModelConfig {
  numTrees: number;
  maxDepth: number;
  learningRate: number;
  minSamplesLeaf: number;
  subsampleRatio: number;
}

export interface TreeNode {
  isLeaf: boolean;
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  prediction?: number;
}

export interface TrainedModel {
  id: string;
  symbol: string;
  createdAt: Date;
  config: GBModelConfig;
  trees: TreeNode[];
  featureNames: string[];
  normStats: Record<string, { mean: number; std: number }>;
  trainMetrics: ModelMetrics;
  testMetrics: ModelMetrics;
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
  logLoss: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

const DEFAULT_CONFIG: GBModelConfig = {
  numTrees: 100,
  maxDepth: 5,
  learningRate: 0.1,
  minSamplesLeaf: 10,
  subsampleRatio: 0.8,
};

export class GradientBoostingClassifier {
  private config: GBModelConfig;
  private trees: TreeNode[] = [];
  private featureNames: string[] = [];
  private normStats: Record<string, { mean: number; std: number }> = {};
  private featureSplitCounts: Map<number, number> = new Map();

  constructor(config: Partial<GBModelConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  train(vectors: FeatureVector[]): TrainedModel {
    console.log(`[GRADIENT_BOOSTING] Training on ${vectors.length} samples`);
    
    const { train, test } = splitTrainTest(vectors, 0.8);
    const { normalized: trainNorm, stats } = normalizeFeatures(train);
    this.normStats = stats;
    
    if (trainNorm.length === 0) {
      throw new Error("No training data after normalization");
    }

    this.featureNames = Object.keys(trainNorm[0].features);
    const X = trainNorm.map(v => this.featureNames.map(f => v.features[f]));
    const y = trainNorm.map(v => v.target ?? 0);

    let predictions = new Array(X.length).fill(0);
    this.trees = [];
    this.featureSplitCounts.clear();

    for (let t = 0; t < this.config.numTrees; t++) {
      const residuals = y.map((yi, i) => {
        const p = this.sigmoid(predictions[i]);
        return yi - p;
      });

      const subsampleIndices = this.subsample(X.length, this.config.subsampleRatio);
      const subX = subsampleIndices.map(i => X[i]);
      const subResiduals = subsampleIndices.map(i => residuals[i]);

      const tree = this.buildTree(subX, subResiduals, 0);
      this.trees.push(tree);

      for (let i = 0; i < X.length; i++) {
        const leafPred = this.predictTree(tree, X[i]);
        predictions[i] += this.config.learningRate * leafPred;
      }

      if ((t + 1) % 20 === 0) {
        const trainAcc = this.calculateAccuracy(X, y, predictions);
        console.log(`[GRADIENT_BOOSTING] Tree ${t + 1}/${this.config.numTrees}, train_acc=${trainAcc.toFixed(4)}`);
      }
    }

    const trainMetrics = this.evaluateMetrics(X, y);
    
    const testNorm = test.map(v => ({
      ...v,
      features: Object.fromEntries(
        Object.entries(v.features).map(([name, value]) => {
          const stat = this.normStats[name];
          if (!stat) return [name, 0];
          return [name, (value - stat.mean) / stat.std];
        })
      ),
    }));
    const testX = testNorm.map(v => this.featureNames.map(f => v.features[f] || 0));
    const testY = testNorm.map(v => v.target ?? 0);
    const testMetrics = this.evaluateMetrics(testX, testY);

    console.log(`[GRADIENT_BOOSTING] Training complete. Train acc=${trainMetrics.accuracy.toFixed(4)}, Test acc=${testMetrics.accuracy.toFixed(4)}`);

    return {
      id: `gb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: vectors[0]?.symbol || "UNKNOWN",
      createdAt: new Date(),
      config: this.config,
      trees: this.trees,
      featureNames: this.featureNames,
      normStats: this.normStats,
      trainMetrics,
      testMetrics,
    };
  }

  predict(model: TrainedModel, features: Record<string, number>): { probability: number; prediction: number; confidence: number } {
    const normalizedFeatures = model.featureNames.map(name => {
      const stat = model.normStats[name];
      if (!stat) return 0;
      const value = features[name] ?? 0;
      const norm = (value - stat.mean) / stat.std;
      return isNaN(norm) || !isFinite(norm) ? 0 : norm;
    });

    let score = 0;
    for (const tree of model.trees) {
      score += model.config.learningRate * this.predictTree(tree, normalizedFeatures);
    }

    const probability = this.sigmoid(score);
    const prediction = probability > 0.5 ? 1 : 0;
    const confidence = Math.abs(probability - 0.5) * 2;

    return { probability, prediction, confidence };
  }

  getFeatureImportance(model: TrainedModel): FeatureImportance[] {
    const importanceMap = new Map<number, number>();
    
    const countSplits = (node: TreeNode) => {
      if (node.isLeaf) return;
      if (node.featureIndex !== undefined) {
        importanceMap.set(node.featureIndex, (importanceMap.get(node.featureIndex) || 0) + 1);
      }
      if (node.left) countSplits(node.left);
      if (node.right) countSplits(node.right);
    };

    for (const tree of model.trees) {
      countSplits(tree);
    }

    const totalSplits = Array.from(importanceMap.values()).reduce((a, b) => a + b, 0);
    
    return model.featureNames
      .map((feature, idx) => ({
        feature,
        importance: (importanceMap.get(idx) || 0) / (totalSplits || 1),
      }))
      .sort((a, b) => b.importance - a.importance);
  }

  private buildTree(X: number[][], residuals: number[], depth: number): TreeNode {
    if (depth >= this.config.maxDepth || X.length < this.config.minSamplesLeaf * 2) {
      return {
        isLeaf: true,
        prediction: this.calculateLeafValue(residuals),
      };
    }

    const { featureIndex, threshold, leftIndices, rightIndices } = this.findBestSplit(X, residuals);

    if (featureIndex === -1 || leftIndices.length < this.config.minSamplesLeaf || rightIndices.length < this.config.minSamplesLeaf) {
      return {
        isLeaf: true,
        prediction: this.calculateLeafValue(residuals),
      };
    }

    this.featureSplitCounts.set(featureIndex, (this.featureSplitCounts.get(featureIndex) || 0) + 1);

    const leftX = leftIndices.map(i => X[i]);
    const leftResiduals = leftIndices.map(i => residuals[i]);
    const rightX = rightIndices.map(i => X[i]);
    const rightResiduals = rightIndices.map(i => residuals[i]);

    return {
      isLeaf: false,
      featureIndex,
      threshold,
      left: this.buildTree(leftX, leftResiduals, depth + 1),
      right: this.buildTree(rightX, rightResiduals, depth + 1),
    };
  }

  private findBestSplit(X: number[][], residuals: number[]): { featureIndex: number; threshold: number; leftIndices: number[]; rightIndices: number[] } {
    let bestGain = -Infinity;
    let bestFeatureIndex = -1;
    let bestThreshold = 0;
    let bestLeftIndices: number[] = [];
    let bestRightIndices: number[] = [];

    const numFeatures = X[0]?.length || 0;
    const totalSum = residuals.reduce((a, b) => a + b, 0);
    const totalSumSq = residuals.reduce((a, b) => a + b * b, 0);

    for (let f = 0; f < numFeatures; f++) {
      const featureValues = X.map((row, i) => ({ value: row[f], index: i }))
        .sort((a, b) => a.value - b.value);

      let leftSum = 0;
      let leftCount = 0;

      for (let i = 0; i < featureValues.length - 1; i++) {
        const { value, index } = featureValues[i];
        leftSum += residuals[index];
        leftCount++;

        if (value === featureValues[i + 1].value) continue;

        const rightSum = totalSum - leftSum;
        const rightCount = featureValues.length - leftCount;

        if (leftCount < this.config.minSamplesLeaf || rightCount < this.config.minSamplesLeaf) continue;

        const leftMean = leftSum / leftCount;
        const rightMean = rightSum / rightCount;
        const gain = leftCount * leftMean * leftMean + rightCount * rightMean * rightMean;

        if (gain > bestGain) {
          bestGain = gain;
          bestFeatureIndex = f;
          bestThreshold = (value + featureValues[i + 1].value) / 2;
          bestLeftIndices = featureValues.slice(0, i + 1).map(v => v.index);
          bestRightIndices = featureValues.slice(i + 1).map(v => v.index);
        }
      }
    }

    return { featureIndex: bestFeatureIndex, threshold: bestThreshold, leftIndices: bestLeftIndices, rightIndices: bestRightIndices };
  }

  private calculateLeafValue(residuals: number[]): number {
    if (residuals.length === 0) return 0;
    const sum = residuals.reduce((a, b) => a + b, 0);
    return sum / residuals.length;
  }

  private predictTree(node: TreeNode, features: number[]): number {
    if (node.isLeaf) {
      return node.prediction ?? 0;
    }
    if (node.featureIndex === undefined || node.threshold === undefined) {
      return 0;
    }
    if (features[node.featureIndex] <= node.threshold) {
      return this.predictTree(node.left!, features);
    } else {
      return this.predictTree(node.right!, features);
    }
  }

  private subsample(n: number, ratio: number): number[] {
    const sampleSize = Math.floor(n * ratio);
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, sampleSize);
  }

  private sigmoid(x: number): number {
    if (x > 20) return 1;
    if (x < -20) return 0;
    return 1 / (1 + Math.exp(-x));
  }

  private calculateAccuracy(X: number[][], y: number[], scores: number[]): number {
    let correct = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = this.sigmoid(scores[i]) > 0.5 ? 1 : 0;
      if (pred === y[i]) correct++;
    }
    return correct / X.length;
  }

  private evaluateMetrics(X: number[][], y: number[]): ModelMetrics {
    const scores: number[] = [];
    for (let i = 0; i < X.length; i++) {
      let score = 0;
      for (const tree of this.trees) {
        score += this.config.learningRate * this.predictTree(tree, X[i]);
      }
      scores.push(score);
    }

    const probs = scores.map(s => this.sigmoid(s));
    const preds = probs.map(p => (p > 0.5 ? 1 : 0));

    let tp = 0, fp = 0, tn = 0, fn = 0;
    for (let i = 0; i < y.length; i++) {
      if (y[i] === 1 && preds[i] === 1) tp++;
      else if (y[i] === 0 && preds[i] === 1) fp++;
      else if (y[i] === 0 && preds[i] === 0) tn++;
      else fn++;
    }

    const accuracy = (tp + tn) / (tp + tn + fp + fn);
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    const f1Score = 2 * precision * recall / (precision + recall) || 0;

    let logLoss = 0;
    for (let i = 0; i < y.length; i++) {
      const p = Math.max(1e-15, Math.min(1 - 1e-15, probs[i]));
      logLoss -= y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p);
    }
    logLoss /= y.length;

    const sorted = probs.map((p, i) => ({ p, y: y[i] })).sort((a, b) => b.p - a.p);
    let auc = 0;
    let tpCount = 0;
    let fpCount = 0;
    const totalPos = y.filter(yi => yi === 1).length;
    const totalNeg = y.length - totalPos;
    for (const { y: yi } of sorted) {
      if (yi === 1) {
        tpCount++;
      } else {
        auc += tpCount;
        fpCount++;
      }
    }
    auc = totalPos * totalNeg > 0 ? auc / (totalPos * totalNeg) : 0.5;

    return { accuracy, precision, recall, f1Score, auc, logLoss };
  }
}

export function serializeModel(model: TrainedModel): string {
  return JSON.stringify(model);
}

export function deserializeModel(json: string): TrainedModel {
  const parsed = JSON.parse(json);
  parsed.createdAt = new Date(parsed.createdAt);
  return parsed as TrainedModel;
}
