import type { LiveBar } from "../live-data-service";
import { FeatureEngineer } from "./feature-engineering";

export interface DQNConfig {
  stateSize: number;
  actionSize: number;
  hiddenLayers: number[];
  learningRate: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  epsilonDecay: number;
  batchSize: number;
  memorySize: number;
  targetUpdateFreq: number;
}

export interface Experience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
}

export interface TrainingMetrics {
  episode: number;
  totalReward: number;
  avgQ: number;
  epsilon: number;
  loss: number;
  sharpeReward: number;
  pnlReward: number;
  drawdownPenalty: number;
}

export interface DQNModel {
  id: string;
  symbol: string;
  config: DQNConfig;
  weights: number[][][];
  biases: number[][];
  targetWeights: number[][][];
  targetBiases: number[][];
  createdAt: Date;
  trainingMetrics: TrainingMetrics[];
}

const DEFAULT_CONFIG: DQNConfig = {
  stateSize: 30,
  actionSize: 3, // HOLD, BUY, SELL
  hiddenLayers: [64, 32],
  learningRate: 0.001,
  gamma: 0.99,
  epsilonStart: 1.0,
  epsilonEnd: 0.01,
  epsilonDecay: 0.995,
  batchSize: 32,
  memorySize: 10000,
  targetUpdateFreq: 100,
};

export class DQNAgent {
  private config: DQNConfig;
  private weights: number[][][];
  private biases: number[][];
  private targetWeights: number[][][];
  private targetBiases: number[][];
  private memory: Experience[] = [];
  private epsilon: number;
  private stepCount: number = 0;
  private featureEngineer: FeatureEngineer;

  constructor(config: Partial<DQNConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.epsilon = this.config.epsilonStart;
    this.featureEngineer = new FeatureEngineer();
    
    const { weights, biases } = this.initializeNetwork();
    this.weights = weights;
    this.biases = biases;
    this.targetWeights = this.deepCopy(weights);
    this.targetBiases = this.deepCopy(biases);
  }

  private initializeNetwork(): { weights: number[][][]; biases: number[][] } {
    const layers = [this.config.stateSize, ...this.config.hiddenLayers, this.config.actionSize];
    const weights: number[][][] = [];
    const biases: number[][] = [];

    for (let i = 0; i < layers.length - 1; i++) {
      const w: number[][] = [];
      const b: number[] = [];
      const scale = Math.sqrt(2 / layers[i]);
      
      for (let j = 0; j < layers[i + 1]; j++) {
        const row: number[] = [];
        for (let k = 0; k < layers[i]; k++) {
          row.push((Math.random() * 2 - 1) * scale);
        }
        w.push(row);
        b.push(0);
      }
      weights.push(w);
      biases.push(b);
    }

    return { weights, biases };
  }

  private forward(state: number[], weights: number[][][], biases: number[][]): number[] {
    let current = state;
    
    for (let i = 0; i < weights.length; i++) {
      const next: number[] = [];
      for (let j = 0; j < weights[i].length; j++) {
        let sum = biases[i][j];
        for (let k = 0; k < current.length; k++) {
          sum += weights[i][j][k] * current[k];
        }
        next.push(i < weights.length - 1 ? Math.max(0, sum) : sum);
      }
      current = next;
    }
    
    return current;
  }

  getQValues(state: number[]): number[] {
    return this.forward(state, this.weights, this.biases);
  }

  selectAction(state: number[]): number {
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.config.actionSize);
    }
    
    const qValues = this.getQValues(state);
    return qValues.indexOf(Math.max(...qValues));
  }

  storeExperience(exp: Experience): void {
    if (this.memory.length >= this.config.memorySize) {
      this.memory.shift();
    }
    this.memory.push(exp);
  }

  train(): number {
    if (this.memory.length < this.config.batchSize) {
      return 0;
    }

    const batch = this.sampleBatch(this.config.batchSize);
    let totalLoss = 0;

    for (const exp of batch) {
      const currentQ = this.getQValues(exp.state);
      const targetQ = [...currentQ];
      
      if (exp.done) {
        targetQ[exp.action] = exp.reward;
      } else {
        const nextQ = this.forward(exp.nextState, this.targetWeights, this.targetBiases);
        targetQ[exp.action] = exp.reward + this.config.gamma * Math.max(...nextQ);
      }

      const loss = this.updateWeights(exp.state, targetQ);
      totalLoss += loss;
    }

    this.stepCount++;
    if (this.stepCount % this.config.targetUpdateFreq === 0) {
      this.targetWeights = this.deepCopy(this.weights);
      this.targetBiases = this.deepCopy(this.biases);
    }

    this.epsilon = Math.max(this.config.epsilonEnd, this.epsilon * this.config.epsilonDecay);

    return totalLoss / batch.length;
  }

  private updateWeights(state: number[], targetQ: number[]): number {
    const activations: number[][] = [state];
    let current = state;
    
    for (let i = 0; i < this.weights.length; i++) {
      const next: number[] = [];
      for (let j = 0; j < this.weights[i].length; j++) {
        let sum = this.biases[i][j];
        for (let k = 0; k < current.length; k++) {
          sum += this.weights[i][j][k] * current[k];
        }
        next.push(i < this.weights.length - 1 ? Math.max(0, sum) : sum);
      }
      activations.push(next);
      current = next;
    }

    const output = activations[activations.length - 1];
    let error = targetQ.map((t, i) => t - output[i]);
    let loss = error.reduce((sum, e) => sum + e * e, 0) / error.length;

    for (let layer = this.weights.length - 1; layer >= 0; layer--) {
      const input = activations[layer];
      const nextError: number[] = new Array(input.length).fill(0);

      for (let j = 0; j < this.weights[layer].length; j++) {
        const gradient = error[j] * this.config.learningRate;
        
        for (let k = 0; k < this.weights[layer][j].length; k++) {
          nextError[k] += error[j] * this.weights[layer][j][k];
          this.weights[layer][j][k] += gradient * input[k];
        }
        this.biases[layer][j] += gradient;
      }

      if (layer > 0) {
        error = nextError.map((e, i) => activations[layer][i] > 0 ? e : 0);
      }
    }

    return loss;
  }

  private sampleBatch(size: number): Experience[] {
    const batch: Experience[] = [];
    const indices = new Set<number>();
    
    while (indices.size < size && indices.size < this.memory.length) {
      indices.add(Math.floor(Math.random() * this.memory.length));
    }
    
    for (const i of indices) {
      batch.push(this.memory[i]);
    }
    
    return batch;
  }

  private deepCopy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  getModel(symbol: string): DQNModel {
    return {
      id: `dqn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      config: this.config,
      weights: this.weights,
      biases: this.biases,
      targetWeights: this.targetWeights,
      targetBiases: this.targetBiases,
      createdAt: new Date(),
      trainingMetrics: [],
    };
  }

  loadModel(model: DQNModel): void {
    this.config = model.config;
    this.weights = model.weights;
    this.biases = model.biases;
    this.targetWeights = model.targetWeights;
    this.targetBiases = model.targetBiases;
  }

  getEpsilon(): number {
    return this.epsilon;
  }

  getMemorySize(): number {
    return this.memory.length;
  }
}

export class TradingEnvironment {
  private bars: LiveBar[];
  private currentStep: number = 0;
  private position: number = 0;
  private entryPrice: number = 0;
  private pnl: number = 0;
  private maxEquity: number = 0;
  private featureEngineer: FeatureEngineer;
  private featureCache: Map<number, number[]> = new Map();
  private lookback: number = 50;

  constructor(bars: LiveBar[]) {
    this.bars = bars;
    this.featureEngineer = new FeatureEngineer();
  }

  reset(): number[] {
    this.currentStep = this.lookback;
    this.position = 0;
    this.entryPrice = 0;
    this.pnl = 0;
    this.maxEquity = 0;
    return this.getState();
  }

  step(action: number): { state: number[]; reward: number; done: boolean; info: any } {
    const currentBar = this.bars[this.currentStep];
    const prevBar = this.bars[this.currentStep - 1];
    
    let stepPnl = 0;
    
    if (this.position !== 0) {
      const priceChange = currentBar.close - prevBar.close;
      stepPnl = this.position * priceChange;
      this.pnl += stepPnl;
    }

    if (action === 1 && this.position <= 0) {
      if (this.position < 0) {
        stepPnl += this.position * (this.entryPrice - currentBar.close);
      }
      this.position = 1;
      this.entryPrice = currentBar.close;
    } else if (action === 2 && this.position >= 0) {
      if (this.position > 0) {
        stepPnl += this.position * (currentBar.close - this.entryPrice);
      }
      this.position = -1;
      this.entryPrice = currentBar.close;
    }

    this.maxEquity = Math.max(this.maxEquity, this.pnl);
    const drawdown = this.maxEquity - this.pnl;
    
    const reward = this.calculateReward(stepPnl, drawdown);
    
    this.currentStep++;
    const done = this.currentStep >= this.bars.length - 1;

    return {
      state: done ? this.getState() : this.getState(),
      reward,
      done,
      info: { pnl: this.pnl, position: this.position, drawdown },
    };
  }

  private calculateReward(stepPnl: number, drawdown: number): number {
    const pnlReward = stepPnl * 0.01;
    
    const drawdownPenalty = drawdown > 0 ? -drawdown * 0.001 : 0;
    
    return pnlReward + drawdownPenalty;
  }

  private getState(): number[] {
    if (this.featureCache.has(this.currentStep)) {
      return this.featureCache.get(this.currentStep)!;
    }

    const windowStart = Math.max(0, this.currentStep - this.lookback);
    const windowBars = this.bars.slice(windowStart, this.currentStep + 1);
    
    const features: number[] = [];
    const currentBar = this.bars[this.currentStep];
    
    for (let i = 1; i <= 10; i++) {
      if (this.currentStep - i >= 0) {
        const prevBar = this.bars[this.currentStep - i];
        features.push((currentBar.close - prevBar.close) / prevBar.close);
      } else {
        features.push(0);
      }
    }

    const closes = windowBars.map(b => b.close);
    const sma5 = this.sma(closes, 5);
    const sma10 = this.sma(closes, 10);
    const sma20 = this.sma(closes, 20);
    
    features.push((currentBar.close - sma5) / sma5 || 0);
    features.push((currentBar.close - sma10) / sma10 || 0);
    features.push((currentBar.close - sma20) / sma20 || 0);

    const rsi = this.calculateRSI(closes, 14);
    features.push((rsi - 50) / 50);

    const volumes = windowBars.map(b => b.volume);
    const avgVol = this.sma(volumes, 10);
    features.push((currentBar.volume - avgVol) / avgVol || 0);

    const volatility = this.calculateVolatility(closes, 10);
    features.push(volatility);

    features.push(this.position);
    
    if (this.position !== 0) {
      features.push((currentBar.close - this.entryPrice) / this.entryPrice);
    } else {
      features.push(0);
    }

    const hour = currentBar.time.getUTCHours();
    features.push(Math.sin((2 * Math.PI * hour) / 24));
    features.push(Math.cos((2 * Math.PI * hour) / 24));

    while (features.length < 30) {
      features.push(0);
    }

    const normalized = features.slice(0, 30).map(f => 
      isNaN(f) || !isFinite(f) ? 0 : Math.max(-3, Math.min(3, f))
    );

    this.featureCache.set(this.currentStep, normalized);
    return normalized;
  }

  private sma(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  private calculateVolatility(closes: number[], period: number): number {
    if (closes.length < period) return 0;
    const slice = closes.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    return Math.sqrt(variance) / mean;
  }

  getCurrentStep(): number {
    return this.currentStep;
  }

  getTotalSteps(): number {
    return this.bars.length - this.lookback - 1;
  }

  getFinalPnL(): number {
    return this.pnl;
  }
}

export function trainDQNAgent(
  bars: LiveBar[],
  numEpisodes: number = 100,
  config: Partial<DQNConfig> = {}
): { agent: DQNAgent; metrics: TrainingMetrics[] } {
  console.log(`[RL_TRAINING] Starting DQN training with ${bars.length} bars for ${numEpisodes} episodes`);
  
  const agent = new DQNAgent(config);
  const metrics: TrainingMetrics[] = [];

  for (let episode = 0; episode < numEpisodes; episode++) {
    const env = new TradingEnvironment(bars);
    let state = env.reset();
    let totalReward = 0;
    let totalQ = 0;
    let steps = 0;
    let totalLoss = 0;

    while (true) {
      const action = agent.selectAction(state);
      const qValues = agent.getQValues(state);
      totalQ += Math.max(...qValues);
      
      const { state: nextState, reward, done } = env.step(action);
      
      agent.storeExperience({ state, action, reward, nextState, done });
      
      const loss = agent.train();
      totalLoss += loss;
      
      totalReward += reward;
      state = nextState;
      steps++;
      
      if (done) break;
    }

    const episodeMetrics: TrainingMetrics = {
      episode,
      totalReward,
      avgQ: totalQ / steps,
      epsilon: agent.getEpsilon(),
      loss: totalLoss / steps,
      sharpeReward: 0,
      pnlReward: env.getFinalPnL(),
      drawdownPenalty: 0,
    };
    metrics.push(episodeMetrics);

    if ((episode + 1) % 10 === 0) {
      console.log(`[RL_TRAINING] Episode ${episode + 1}/${numEpisodes}, reward=${totalReward.toFixed(2)}, pnl=${env.getFinalPnL().toFixed(2)}, epsilon=${agent.getEpsilon().toFixed(4)}`);
    }
  }

  console.log(`[RL_TRAINING] Training complete. Final epsilon=${agent.getEpsilon().toFixed(4)}`);
  return { agent, metrics };
}
