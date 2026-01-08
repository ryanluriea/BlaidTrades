import type { LiveBar } from "../live-data-service";

export interface PPOConfig {
  stateSize: number;
  actionSize: number;
  hiddenLayers: number[];
  learningRate: number;
  gamma: number;
  clipRatio: number;
  entropyCoeff: number;
  valueCoeff: number;
  maxGradNorm: number;
  epochs: number;
  miniBatchSize: number;
  gaeλ: number;
}

export interface PPOExperience {
  state: number[];
  action: number[];
  reward: number;
  value: number;
  logProb: number;
  done: boolean;
}

export interface PPOTrajectory {
  experiences: PPOExperience[];
  returns: number[];
  advantages: number[];
}

export interface PPOModel {
  id: string;
  config: PPOConfig;
  policyWeights: number[][][];
  valueWeights: number[][][];
  policyBiases: number[][];
  valueBiases: number[][];
  trainingStats: {
    totalEpisodes: number;
    avgReward: number;
    avgEntropy: number;
    policyLoss: number;
    valueLoss: number;
  };
}

function initializeLayer(inputSize: number, outputSize: number): { weights: number[][]; biases: number[] } {
  const scale = Math.sqrt(2 / inputSize);
  const weights: number[][] = [];
  const biases: number[] = [];
  
  for (let i = 0; i < outputSize; i++) {
    const row: number[] = [];
    for (let j = 0; j < inputSize; j++) {
      row.push((Math.random() - 0.5) * 2 * scale);
    }
    weights.push(row);
    biases.push(0);
  }
  
  return { weights, biases };
}

function relu(x: number): number {
  return Math.max(0, x);
}

function tanh(x: number): number {
  return Math.tanh(x);
}

function softplus(x: number): number {
  return Math.log(1 + Math.exp(Math.min(x, 20)));
}

function forwardPass(input: number[], weights: number[][][], biases: number[][], activation: (x: number) => number): number[] {
  let current = input;
  
  for (let layer = 0; layer < weights.length; layer++) {
    const layerWeights = weights[layer];
    const layerBiases = biases[layer];
    const output: number[] = [];
    
    for (let i = 0; i < layerWeights.length; i++) {
      let sum = layerBiases[i];
      for (let j = 0; j < current.length; j++) {
        sum += layerWeights[i][j] * current[j];
      }
      output.push(layer < weights.length - 1 ? activation(sum) : sum);
    }
    
    current = output;
  }
  
  return current;
}

function gaussianLogProb(action: number, mean: number, std: number): number {
  const variance = std * std;
  const logStd = Math.log(std);
  return -0.5 * (Math.pow(action - mean, 2) / variance + 2 * logStd + Math.log(2 * Math.PI));
}

function sampleGaussian(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

export class PPOAgent {
  private config: PPOConfig;
  private policyWeights: number[][][];
  private valueWeights: number[][][];
  private policyBiases: number[][];
  private valueBiases: number[][];
  private buffer: PPOExperience[];
  private trainingStats: PPOModel["trainingStats"];

  constructor(config: Partial<PPOConfig> = {}) {
    this.config = {
      stateSize: config.stateSize ?? 30,
      actionSize: config.actionSize ?? 2,
      hiddenLayers: config.hiddenLayers ?? [64, 32],
      learningRate: config.learningRate ?? 0.0003,
      gamma: config.gamma ?? 0.99,
      clipRatio: config.clipRatio ?? 0.2,
      entropyCoeff: config.entropyCoeff ?? 0.01,
      valueCoeff: config.valueCoeff ?? 0.5,
      maxGradNorm: config.maxGradNorm ?? 0.5,
      epochs: config.epochs ?? 4,
      miniBatchSize: config.miniBatchSize ?? 32,
      gaeλ: config.gaeλ ?? 0.95,
    };

    this.policyWeights = [];
    this.policyBiases = [];
    this.valueWeights = [];
    this.valueBiases = [];
    this.buffer = [];
    this.trainingStats = {
      totalEpisodes: 0,
      avgReward: 0,
      avgEntropy: 0,
      policyLoss: 0,
      valueLoss: 0,
    };

    this.initializeNetworks();
  }

  private initializeNetworks(): void {
    const allLayers = [this.config.stateSize, ...this.config.hiddenLayers];
    
    for (let i = 0; i < allLayers.length; i++) {
      const inputSize = allLayers[i];
      const outputSize = i < allLayers.length - 1 ? allLayers[i + 1] : this.config.actionSize * 2;
      const { weights, biases } = initializeLayer(inputSize, outputSize);
      this.policyWeights.push(weights);
      this.policyBiases.push(biases);
    }

    for (let i = 0; i < allLayers.length; i++) {
      const inputSize = allLayers[i];
      const outputSize = i < allLayers.length - 1 ? allLayers[i + 1] : 1;
      const { weights, biases } = initializeLayer(inputSize, outputSize);
      this.valueWeights.push(weights);
      this.valueBiases.push(biases);
    }
  }

  getPolicy(state: number[]): { means: number[]; stds: number[] } {
    const output = forwardPass(state, this.policyWeights, this.policyBiases, tanh);
    
    const means: number[] = [];
    const stds: number[] = [];
    
    for (let i = 0; i < this.config.actionSize; i++) {
      means.push(tanh(output[i]));
      stds.push(softplus(output[i + this.config.actionSize]) + 0.01);
    }
    
    return { means, stds };
  }

  getValue(state: number[]): number {
    const output = forwardPass(state, this.valueWeights, this.valueBiases, tanh);
    return output[0];
  }

  selectAction(state: number[]): { action: number[]; logProb: number; value: number } {
    const { means, stds } = this.getPolicy(state);
    const value = this.getValue(state);
    
    const action: number[] = [];
    let totalLogProb = 0;
    
    for (let i = 0; i < this.config.actionSize; i++) {
      const a = sampleGaussian(means[i], stds[i]);
      const clampedAction = Math.max(-1, Math.min(1, a));
      action.push(clampedAction);
      totalLogProb += gaussianLogProb(clampedAction, means[i], stds[i]);
    }
    
    return { action, logProb: totalLogProb, value };
  }

  getAction(state: number[]): number[] {
    const { means } = this.getPolicy(state);
    return means;
  }

  storeExperience(experience: PPOExperience): void {
    this.buffer.push(experience);
  }

  computeGAE(experiences: PPOExperience[]): { returns: number[]; advantages: number[] } {
    const n = experiences.length;
    const returns: number[] = new Array(n).fill(0);
    const advantages: number[] = new Array(n).fill(0);
    
    let lastGae = 0;
    let lastValue = 0;
    
    for (let t = n - 1; t >= 0; t--) {
      const exp = experiences[t];
      const nextValue = t === n - 1 ? 0 : (exp.done ? 0 : experiences[t + 1].value);
      
      const delta = exp.reward + this.config.gamma * nextValue - exp.value;
      lastGae = delta + this.config.gamma * this.config.gaeλ * (exp.done ? 0 : lastGae);
      advantages[t] = lastGae;
      returns[t] = advantages[t] + exp.value;
    }
    
    const mean = advantages.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(advantages.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n) + 1e-8;
    
    for (let i = 0; i < n; i++) {
      advantages[i] = (advantages[i] - mean) / std;
    }
    
    return { returns, advantages };
  }

  train(): { policyLoss: number; valueLoss: number; entropy: number } {
    if (this.buffer.length < this.config.miniBatchSize) {
      return { policyLoss: 0, valueLoss: 0, entropy: 0 };
    }

    const { returns, advantages } = this.computeGAE(this.buffer);
    
    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;
    let updateCount = 0;

    for (let epoch = 0; epoch < this.config.epochs; epoch++) {
      const indices = Array.from({ length: this.buffer.length }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      for (let start = 0; start < indices.length; start += this.config.miniBatchSize) {
        const batchIndices = indices.slice(start, start + this.config.miniBatchSize);
        if (batchIndices.length < this.config.miniBatchSize) continue;

        const policyGradients = this.initGradients(this.policyWeights, this.policyBiases);
        const valueGradients = this.initGradients(this.valueWeights, this.valueBiases);

        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchEntropy = 0;

        for (const idx of batchIndices) {
          const exp = this.buffer[idx];
          const { means, stds } = this.getPolicy(exp.state);
          const value = this.getValue(exp.state);
          
          let newLogProb = 0;
          let entropy = 0;
          
          for (let i = 0; i < this.config.actionSize; i++) {
            newLogProb += gaussianLogProb(exp.action[i], means[i], stds[i]);
            entropy += Math.log(stds[i] * Math.sqrt(2 * Math.PI * Math.E));
          }

          const ratio = Math.exp(newLogProb - exp.logProb);
          const clippedRatio = Math.max(1 - this.config.clipRatio, Math.min(1 + this.config.clipRatio, ratio));
          
          const policyLoss = -Math.min(ratio * advantages[idx], clippedRatio * advantages[idx]);
          const valueLoss = Math.pow(value - returns[idx], 2);
          
          this.computePolicyGradient(exp.state, exp.action, exp.logProb, advantages[idx], policyGradients);
          this.computeValueGradient(exp.state, returns[idx], valueGradients);
          
          batchPolicyLoss += policyLoss;
          batchValueLoss += valueLoss;
          batchEntropy += entropy;
        }

        const batchSize = batchIndices.length;
        batchPolicyLoss /= batchSize;
        batchValueLoss /= batchSize;
        batchEntropy /= batchSize;

        this.applyGradients(this.policyWeights, this.policyBiases, policyGradients, batchSize);
        this.applyGradients(this.valueWeights, this.valueBiases, valueGradients, batchSize);

        totalPolicyLoss += batchPolicyLoss;
        totalValueLoss += batchValueLoss;
        totalEntropy += batchEntropy;
        updateCount++;
      }
    }

    this.buffer = [];

    const avgPolicyLoss = updateCount > 0 ? totalPolicyLoss / updateCount : 0;
    const avgValueLoss = updateCount > 0 ? totalValueLoss / updateCount : 0;
    const avgEntropy = updateCount > 0 ? totalEntropy / updateCount : 0;

    this.trainingStats.policyLoss = avgPolicyLoss;
    this.trainingStats.valueLoss = avgValueLoss;
    this.trainingStats.avgEntropy = avgEntropy;

    return { policyLoss: avgPolicyLoss, valueLoss: avgValueLoss, entropy: avgEntropy };
  }

  private initGradients(weights: number[][][], biases: number[][]): { wGrads: number[][][]; bGrads: number[][] } {
    const wGrads: number[][][] = [];
    const bGrads: number[][] = [];
    
    for (let layer = 0; layer < weights.length; layer++) {
      const layerWGrad: number[][] = [];
      const layerBGrad: number[] = [];
      
      for (let i = 0; i < weights[layer].length; i++) {
        layerWGrad.push(new Array(weights[layer][i].length).fill(0));
        layerBGrad.push(0);
      }
      
      wGrads.push(layerWGrad);
      bGrads.push(layerBGrad);
    }
    
    return { wGrads, bGrads };
  }

  private computeClippedPPOLoss(
    state: number[],
    action: number[],
    oldLogProb: number,
    advantage: number
  ): number {
    const { means, stds } = this.getPolicy(state);
    let newLogProb = 0;
    for (let a = 0; a < this.config.actionSize; a++) {
      newLogProb += gaussianLogProb(action[a], means[a], stds[a]);
    }
    
    const ratio = Math.exp(newLogProb - oldLogProb);
    const clippedRatio = Math.max(1 - this.config.clipRatio, Math.min(1 + this.config.clipRatio, ratio));
    
    const surr1 = ratio * advantage;
    const surr2 = clippedRatio * advantage;
    
    return -Math.min(surr1, surr2);
  }

  private computePolicyGradient(
    state: number[],
    action: number[],
    oldLogProb: number,
    advantage: number,
    grads: { wGrads: number[][][]; bGrads: number[][] }
  ): void {
    const eps = 1e-5;
    
    for (let layer = 0; layer < this.policyWeights.length; layer++) {
      for (let i = 0; i < this.policyWeights[layer].length; i++) {
        for (let j = 0; j < this.policyWeights[layer][i].length; j++) {
          const original = this.policyWeights[layer][i][j];
          
          this.policyWeights[layer][i][j] = original + eps;
          const lossP = this.computeClippedPPOLoss(state, action, oldLogProb, advantage);
          
          this.policyWeights[layer][i][j] = original - eps;
          const lossM = this.computeClippedPPOLoss(state, action, oldLogProb, advantage);
          
          this.policyWeights[layer][i][j] = original;
          
          const grad = (lossP - lossM) / (2 * eps);
          grads.wGrads[layer][i][j] += grad;
        }
        
        const originalBias = this.policyBiases[layer][i];
        
        this.policyBiases[layer][i] = originalBias + eps;
        const lossP = this.computeClippedPPOLoss(state, action, oldLogProb, advantage);
        
        this.policyBiases[layer][i] = originalBias - eps;
        const lossM = this.computeClippedPPOLoss(state, action, oldLogProb, advantage);
        
        this.policyBiases[layer][i] = originalBias;
        
        const biasGrad = (lossP - lossM) / (2 * eps);
        grads.bGrads[layer][i] += biasGrad;
      }
    }
  }

  private computeValueGradient(
    state: number[],
    target: number,
    grads: { wGrads: number[][][]; bGrads: number[][] }
  ): void {
    const eps = 1e-5;
    const currentValue = this.getValue(state);
    const error = currentValue - target;
    
    for (let layer = 0; layer < this.valueWeights.length; layer++) {
      for (let i = 0; i < this.valueWeights[layer].length; i++) {
        for (let j = 0; j < this.valueWeights[layer][i].length; j++) {
          const original = this.valueWeights[layer][i][j];
          
          this.valueWeights[layer][i][j] = original + eps;
          const valueP = this.getValue(state);
          
          this.valueWeights[layer][i][j] = original - eps;
          const valueM = this.getValue(state);
          
          this.valueWeights[layer][i][j] = original;
          
          const grad = 2 * error * (valueP - valueM) / (2 * eps);
          grads.wGrads[layer][i][j] += grad;
        }
        
        const originalBias = this.valueBiases[layer][i];
        
        this.valueBiases[layer][i] = originalBias + eps;
        const valueBP = this.getValue(state);
        
        this.valueBiases[layer][i] = originalBias - eps;
        const valueBM = this.getValue(state);
        
        this.valueBiases[layer][i] = originalBias;
        
        const biasGrad = 2 * error * (valueBP - valueBM) / (2 * eps);
        grads.bGrads[layer][i] += biasGrad;
      }
    }
  }

  private applyGradients(
    weights: number[][][],
    biases: number[][],
    grads: { wGrads: number[][][]; bGrads: number[][] },
    batchSize: number
  ): void {
    const lr = this.config.learningRate;
    const maxNorm = this.config.maxGradNorm;
    
    let gradNorm = 0;
    for (let layer = 0; layer < grads.wGrads.length; layer++) {
      for (let i = 0; i < grads.wGrads[layer].length; i++) {
        for (let j = 0; j < grads.wGrads[layer][i].length; j++) {
          gradNorm += Math.pow(grads.wGrads[layer][i][j] / batchSize, 2);
        }
        gradNorm += Math.pow(grads.bGrads[layer][i] / batchSize, 2);
      }
    }
    gradNorm = Math.sqrt(gradNorm);
    
    const scale = gradNorm > maxNorm ? maxNorm / gradNorm : 1;
    
    for (let layer = 0; layer < weights.length; layer++) {
      for (let i = 0; i < weights[layer].length; i++) {
        for (let j = 0; j < weights[layer][i].length; j++) {
          weights[layer][i][j] -= lr * scale * grads.wGrads[layer][i][j] / batchSize;
        }
        biases[layer][i] -= lr * scale * grads.bGrads[layer][i] / batchSize;
      }
    }
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  getStats(): PPOModel["trainingStats"] {
    return { ...this.trainingStats };
  }

  exportModel(): PPOModel {
    return {
      id: `ppo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      config: { ...this.config },
      policyWeights: JSON.parse(JSON.stringify(this.policyWeights)),
      valueWeights: JSON.parse(JSON.stringify(this.valueWeights)),
      policyBiases: JSON.parse(JSON.stringify(this.policyBiases)),
      valueBiases: JSON.parse(JSON.stringify(this.valueBiases)),
      trainingStats: { ...this.trainingStats },
    };
  }

  loadModel(model: PPOModel): void {
    this.config = { ...model.config };
    this.policyWeights = JSON.parse(JSON.stringify(model.policyWeights));
    this.valueWeights = JSON.parse(JSON.stringify(model.valueWeights));
    this.policyBiases = JSON.parse(JSON.stringify(model.policyBiases));
    this.valueBiases = JSON.parse(JSON.stringify(model.valueBiases));
    this.trainingStats = { ...model.trainingStats };
  }
}

export class ContinuousTradingEnv {
  private bars: LiveBar[];
  private currentStep: number;
  private position: number;
  private entryPrice: number;
  private unrealizedPnL: number;
  private realizedPnL: number;
  private maxPosition: number;
  private lookback: number;

  constructor(bars: LiveBar[], maxPosition: number = 10, lookback: number = 20) {
    this.bars = bars;
    this.maxPosition = maxPosition;
    this.lookback = lookback;
    this.currentStep = lookback;
    this.position = 0;
    this.entryPrice = 0;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
  }

  reset(): number[] {
    this.currentStep = this.lookback;
    this.position = 0;
    this.entryPrice = 0;
    this.unrealizedPnL = 0;
    this.realizedPnL = 0;
    return this.getState();
  }

  getState(): number[] {
    const state: number[] = [];
    const currentBar = this.bars[this.currentStep];
    const currentPrice = currentBar.close;
    
    for (let i = this.lookback - 1; i >= 0; i--) {
      const bar = this.bars[this.currentStep - i];
      state.push((bar.close - currentPrice) / currentPrice);
    }

    let sumVol = 0, sumVolSq = 0;
    for (let i = 0; i < this.lookback; i++) {
      const ret = (this.bars[this.currentStep - i].close - this.bars[this.currentStep - i - 1].close) / this.bars[this.currentStep - i - 1].close;
      sumVol += ret;
      sumVolSq += ret * ret;
    }
    const volatility = Math.sqrt(sumVolSq / this.lookback - Math.pow(sumVol / this.lookback, 2)) * Math.sqrt(252);
    state.push(Math.min(volatility, 1));

    state.push(this.position / this.maxPosition);
    state.push(this.unrealizedPnL / 1000);

    const avgVolume = this.bars.slice(this.currentStep - this.lookback, this.currentStep)
      .reduce((s, b) => s + b.volume, 0) / this.lookback;
    state.push((currentBar.volume - avgVolume) / (avgVolume + 1));

    const sma = this.bars.slice(this.currentStep - this.lookback, this.currentStep)
      .reduce((s, b) => s + b.close, 0) / this.lookback;
    state.push((currentPrice - sma) / sma);

    const hl = this.bars.slice(this.currentStep - 14, this.currentStep);
    const highest = Math.max(...hl.map(b => b.high));
    const lowest = Math.min(...hl.map(b => b.low));
    state.push((currentPrice - lowest) / (highest - lowest + 0.0001) - 0.5);

    while (state.length < 30) {
      state.push(0);
    }

    return state.slice(0, 30);
  }

  step(action: number[]): { nextState: number[]; reward: number; done: boolean; info: Record<string, number> } {
    const positionDelta = action[0] * this.maxPosition;
    const targetPosition = Math.max(-this.maxPosition, Math.min(this.maxPosition, this.position + positionDelta));
    
    const currentBar = this.bars[this.currentStep];
    const prevBar = this.bars[this.currentStep - 1];
    
    if (this.position !== 0) {
      this.unrealizedPnL = (currentBar.close - this.entryPrice) * this.position;
    }

    const tradeSize = Math.abs(targetPosition - this.position);
    const tradeCost = tradeSize * currentBar.close * 0.0002;

    if (targetPosition !== this.position) {
      if (this.position !== 0 && Math.sign(targetPosition) !== Math.sign(this.position)) {
        this.realizedPnL += (currentBar.close - this.entryPrice) * this.position;
        this.unrealizedPnL = 0;
      }
      
      if (targetPosition !== 0) {
        this.entryPrice = currentBar.close;
      }
      
      this.position = targetPosition;
      this.realizedPnL -= tradeCost;
    }

    this.currentStep++;
    const done = this.currentStep >= this.bars.length - 1;

    if (done && this.position !== 0) {
      const finalBar = this.bars[this.currentStep];
      this.realizedPnL += (finalBar.close - this.entryPrice) * this.position;
      this.unrealizedPnL = 0;
      this.position = 0;
    }

    const priceReturn = (currentBar.close - prevBar.close) / prevBar.close;
    const reward = this.position * priceReturn * 100 - tradeCost * 0.1;

    return {
      nextState: done ? this.getState() : this.getState(),
      reward,
      done,
      info: {
        position: this.position,
        realizedPnL: this.realizedPnL,
        unrealizedPnL: this.unrealizedPnL,
        totalPnL: this.realizedPnL + this.unrealizedPnL,
      },
    };
  }

  getFinalPnL(): number {
    return this.realizedPnL + this.unrealizedPnL;
  }
}

export function trainPPOAgent(
  bars: LiveBar[],
  config: Partial<PPOConfig> = {},
  episodes: number = 10,
  stepsPerEpisode: number = 500
): { agent: PPOAgent; metrics: { episodeRewards: number[]; policyLosses: number[]; valueLosses: number[] } } {
  const agent = new PPOAgent(config);
  const metrics = {
    episodeRewards: [] as number[],
    policyLosses: [] as number[],
    valueLosses: [] as number[],
  };

  for (let ep = 0; ep < episodes; ep++) {
    const env = new ContinuousTradingEnv(bars);
    let state = env.reset();
    let episodeReward = 0;

    for (let step = 0; step < stepsPerEpisode; step++) {
      const { action, logProb, value } = agent.selectAction(state);
      const { nextState, reward, done, info } = env.step(action);

      agent.storeExperience({
        state,
        action,
        reward,
        value,
        logProb,
        done,
      });

      episodeReward += reward;
      state = nextState;

      if (done) break;
    }

    const { policyLoss, valueLoss } = agent.train();
    
    metrics.episodeRewards.push(episodeReward);
    metrics.policyLosses.push(policyLoss);
    metrics.valueLosses.push(valueLoss);

    console.log(`[PPO_TRAIN] episode=${ep + 1}/${episodes} reward=${episodeReward.toFixed(2)} policy_loss=${policyLoss.toFixed(4)} value_loss=${valueLoss.toFixed(4)}`);
  }

  return { agent, metrics };
}
