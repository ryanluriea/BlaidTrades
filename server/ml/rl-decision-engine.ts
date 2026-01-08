import { DQNAgent, TradingEnvironment } from "./rl-dqn-agent";
import { PPOAgent, ContinuousTradingEnv } from "./rl-ppo-agent";
import { FeatureEngineer } from "./feature-engineering";
import type { LiveBar } from "../live-data-service";
import { db } from "../db";

export interface RLDecision {
  action: "HOLD" | "BUY" | "SELL";
  positionSize: number;
  confidence: number;
  qValues?: number[];
  policyProb?: number;
  agentType: "DQN" | "PPO";
  reasoning: string;
  timestamp: Date;
}

export interface RLActionLog {
  botId: string;
  symbol: string;
  agentType: "DQN" | "PPO";
  action: string;
  positionSize: number;
  confidence: number;
  stateVector: number[];
  qValues?: number[];
  policyLogProb?: number;
  timestamp: Date;
}

export interface RLDecisionEngineConfig {
  defaultAgentType: "DQN" | "PPO";
  minConfidence: number;
  maxPositionSize: number;
  stateSize: number;
}

const DEFAULT_CONFIG: RLDecisionEngineConfig = {
  defaultAgentType: "PPO",
  minConfidence: 0.6,
  maxPositionSize: 10,
  stateSize: 30,
};

export class RLDecisionEngine {
  private dqnAgents: Map<string, DQNAgent> = new Map();
  private ppoAgents: Map<string, PPOAgent> = new Map();
  private featureEngineer: FeatureEngineer;
  private config: RLDecisionEngineConfig;
  private actionLogs: RLActionLog[] = [];
  private readonly MAX_LOGS = 10000;

  constructor(config: Partial<RLDecisionEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.featureEngineer = new FeatureEngineer();
  }

  getDQNAgent(botId: string): DQNAgent {
    if (!this.dqnAgents.has(botId)) {
      this.dqnAgents.set(botId, new DQNAgent({
        stateSize: this.config.stateSize,
        actionSize: 3,
        hiddenLayers: [64, 32],
        learningRate: 0.001,
        gamma: 0.99,
        epsilonStart: 0.1,
        epsilonEnd: 0.01,
        epsilonDecay: 0.995,
        memorySize: 10000,
        batchSize: 32,
        targetUpdateFreq: 100,
      }));
    }
    return this.dqnAgents.get(botId)!;
  }

  getPPOAgent(botId: string): PPOAgent {
    if (!this.ppoAgents.has(botId)) {
      this.ppoAgents.set(botId, new PPOAgent({
        stateSize: this.config.stateSize,
        actionSize: 2,
        hiddenLayers: [64, 32],
        learningRate: 0.0003,
        gamma: 0.99,
        gaeλ: 0.95,
        clipRatio: 0.2,
        epochs: 4,
        miniBatchSize: 64,
        valueCoeff: 0.5,
        entropyCoeff: 0.01,
        maxGradNorm: 0.5,
      }));
    }
    return this.ppoAgents.get(botId)!;
  }

  extractStateFromBars(bars: LiveBar[], currentPosition: number = 0): number[] {
    if (bars.length < 50) {
      return Array(this.config.stateSize).fill(0);
    }

    const featureVectors = this.featureEngineer.extractFeatures(bars, 1);
    if (featureVectors.length === 0) {
      return Array(this.config.stateSize).fill(0);
    }

    const features = featureVectors[featureVectors.length - 1].features;
    const state: number[] = [];

    state.push(features.rsi_14 / 100 - 0.5);
    state.push(features.stoch_k / 100 - 0.5);
    state.push(features.stoch_d / 100 - 0.5);
    state.push(Math.tanh(features.macd / 10));
    state.push(Math.tanh(features.macd_signal / 10));
    state.push(Math.tanh(features.macd_histogram / 5));
    state.push(features.bb_position - 0.5);
    state.push(Math.tanh(features.bb_width * 10));
    state.push(Math.tanh(features.atr_ratio - 1));
    state.push(Math.tanh(features.volume_ratio - 1));

    const returns = [];
    for (let i = 1; i < Math.min(11, bars.length); i++) {
      const ret = (bars[bars.length - i].close - bars[bars.length - i - 1].close) / bars[bars.length - i - 1].close;
      returns.push(Math.tanh(ret * 100));
    }
    while (returns.length < 10) returns.push(0);
    state.push(...returns);

    state.push(currentPosition / this.config.maxPositionSize);
    state.push(features.trend_strength - 0.5);
    state.push(features.up_momentum - 0.5);
    state.push(features.down_momentum - 0.5);
    state.push(features.price_vs_vwap);
    state.push(Math.tanh(features.volume_profile_high_ratio - 1));
    state.push(Math.tanh(features.volume_profile_low_ratio - 1));
    state.push(features.volatility_regime - 0.5);

    while (state.length < this.config.stateSize) {
      state.push(0);
    }

    return state.slice(0, this.config.stateSize);
  }

  async getDecision(
    botId: string,
    symbol: string,
    bars: LiveBar[],
    currentPosition: number = 0,
    agentType?: "DQN" | "PPO",
    traceId?: string
  ): Promise<RLDecision> {
    const type = agentType || this.config.defaultAgentType;
    const timestamp = new Date();
    const state = this.extractStateFromBars(bars, currentPosition);

    if (type === "DQN") {
      return this.getDQNDecision(botId, symbol, state, traceId, timestamp);
    } else {
      return this.getPPODecision(botId, symbol, state, traceId, timestamp);
    }
  }

  private getDQNDecision(
    botId: string,
    symbol: string,
    state: number[],
    traceId: string | undefined,
    timestamp: Date
  ): RLDecision {
    const agent = this.getDQNAgent(botId);
    const qValues = agent.getQValues(state);
    const action = agent.selectAction(state);

    const maxQ = Math.max(...qValues);
    const minQ = Math.min(...qValues);
    const qRange = maxQ - minQ || 1;
    const confidence = (qValues[action] - minQ) / qRange;

    const actionMap: Record<number, "HOLD" | "BUY" | "SELL"> = {
      0: "HOLD",
      1: "BUY",
      2: "SELL"
    };

    const decision: RLDecision = {
      action: actionMap[action],
      positionSize: action === 0 ? 0 : 1,
      confidence,
      qValues,
      agentType: "DQN",
      reasoning: `DQN Q-values: [HOLD=${qValues[0].toFixed(3)}, BUY=${qValues[1].toFixed(3)}, SELL=${qValues[2].toFixed(3)}]`,
      timestamp,
    };

    this.logAction({
      botId,
      symbol,
      agentType: "DQN",
      action: decision.action,
      positionSize: decision.positionSize,
      confidence,
      stateVector: state,
      qValues,
      timestamp,
    });

    console.log(`[RL_DECISION] trace_id=${traceId || "none"} bot=${botId} agent=DQN action=${decision.action} conf=${(confidence * 100).toFixed(1)}%`);

    return decision;
  }

  private getPPODecision(
    botId: string,
    symbol: string,
    state: number[],
    traceId: string | undefined,
    timestamp: Date
  ): RLDecision {
    const agent = this.getPPOAgent(botId);
    const { action, logProb, value } = agent.selectAction(state);

    const direction = action[0];
    const sizing = Math.abs(action[1]);
    
    let actionLabel: "HOLD" | "BUY" | "SELL" = "HOLD";
    if (direction > 0.3) actionLabel = "BUY";
    else if (direction < -0.3) actionLabel = "SELL";

    const positionSize = Math.min(
      Math.floor(sizing * this.config.maxPositionSize),
      this.config.maxPositionSize
    );

    const confidence = 1 / (1 + Math.exp(-Math.abs(direction) * 3));

    const decision: RLDecision = {
      action: actionLabel,
      positionSize: actionLabel === "HOLD" ? 0 : Math.max(1, positionSize),
      confidence,
      policyProb: Math.exp(logProb),
      agentType: "PPO",
      reasoning: `PPO output: direction=${direction.toFixed(3)}, sizing=${sizing.toFixed(3)}, value=${value.toFixed(3)}`,
      timestamp,
    };

    this.logAction({
      botId,
      symbol,
      agentType: "PPO",
      action: decision.action,
      positionSize: decision.positionSize,
      confidence,
      stateVector: state,
      policyLogProb: logProb,
      timestamp,
    });

    console.log(`[RL_DECISION] trace_id=${traceId || "none"} bot=${botId} agent=PPO action=${decision.action} size=${decision.positionSize} conf=${(confidence * 100).toFixed(1)}%`);

    return decision;
  }

  private logAction(log: RLActionLog): void {
    this.actionLogs.push(log);
    if (this.actionLogs.length > this.MAX_LOGS) {
      this.actionLogs = this.actionLogs.slice(-this.MAX_LOGS / 2);
    }
  }

  storeExperience(
    botId: string,
    agentType: "DQN" | "PPO",
    state: number[],
    action: number | number[],
    reward: number,
    nextState: number[],
    done: boolean,
    logProb?: number,
    value?: number
  ): void {
    if (agentType === "DQN") {
      const agent = this.getDQNAgent(botId);
      agent.storeExperience({
        state,
        action: action as number,
        reward,
        nextState,
        done,
      });
    } else {
      const agent = this.getPPOAgent(botId);
      agent.storeExperience({
        state,
        action: action as number[],
        reward,
        value: value ?? 0,
        logProb: logProb ?? 0,
        done,
      });
    }
  }

  train(botId: string, agentType: "DQN" | "PPO"): { loss: number; episodes?: number } {
    if (agentType === "DQN") {
      const agent = this.getDQNAgent(botId);
      const loss = agent.train();
      return { loss };
    } else {
      const agent = this.getPPOAgent(botId);
      const result = agent.train();
      return { loss: result.policyLoss + result.valueLoss };
    }
  }

  getActionLogs(botId?: string, limit: number = 100): RLActionLog[] {
    let logs = this.actionLogs;
    if (botId) {
      logs = logs.filter(l => l.botId === botId);
    }
    return logs.slice(-limit);
  }

  getAgentStats(botId: string): {
    dqn: { memorySize: number; epsilon: number; trained: boolean } | null;
    ppo: { bufferSize: number; trained: boolean } | null;
  } {
    const dqnAgent = this.dqnAgents.get(botId);
    const ppoAgent = this.ppoAgents.get(botId);

    return {
      dqn: dqnAgent ? {
        memorySize: dqnAgent.getMemorySize(),
        epsilon: dqnAgent.getEpsilon(),
        trained: dqnAgent.getMemorySize() > 0,
      } : null,
      ppo: ppoAgent ? {
        bufferSize: ppoAgent.getBufferSize(),
        trained: true,
      } : null,
    };
  }

  getAllAgentStats(): Map<string, ReturnType<typeof this.getAgentStats>> {
    const allBotIds = new Set([...this.dqnAgents.keys(), ...this.ppoAgents.keys()]);
    const stats = new Map<string, ReturnType<typeof this.getAgentStats>>();
    
    for (const botId of allBotIds) {
      stats.set(botId, this.getAgentStats(botId));
    }
    
    return stats;
  }
}

export const rlDecisionEngine = new RLDecisionEngine();
