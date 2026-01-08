import { db } from "./db";
import { bots, botGenerations, type Bot } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { detectUnifiedRegime, type RegimeState, type UnifiedRegime } from "./autonomous-regime-engine";

export type ParameterType = "integer" | "float" | "boolean" | "enum";

export interface ParameterBounds {
  name: string;
  type: ParameterType;
  min?: number;
  max?: number;
  step?: number;
  values?: any[];
  default: number | boolean | string;
  mutationWeight?: number;
}

export interface StrategyParameterSpace {
  archetype: string;
  parameters: ParameterBounds[];
}

export const STRATEGY_PARAMETER_SPACES: StrategyParameterSpace[] = [
  {
    archetype: "momentum",
    parameters: [
      { name: "entryThreshold", type: "float", min: 0.001, max: 0.05, step: 0.001, default: 0.02, mutationWeight: 1.5 },
      { name: "exitThreshold", type: "float", min: 0.001, max: 0.03, step: 0.001, default: 0.01, mutationWeight: 1.0 },
      { name: "lookbackPeriod", type: "integer", min: 5, max: 50, step: 1, default: 20, mutationWeight: 1.2 },
      { name: "stopLossTicks", type: "integer", min: 5, max: 50, step: 1, default: 20, mutationWeight: 0.8 },
      { name: "takeProfitTicks", type: "integer", min: 10, max: 100, step: 2, default: 40, mutationWeight: 0.8 },
      { name: "trailingStop", type: "boolean", default: true, mutationWeight: 0.5 },
      { name: "volumeFilter", type: "boolean", default: true, mutationWeight: 0.5 },
      { name: "adxThreshold", type: "integer", min: 15, max: 40, step: 1, default: 25, mutationWeight: 1.0 },
    ],
  },
  {
    archetype: "mean_reversion",
    parameters: [
      { name: "bollingerPeriod", type: "integer", min: 10, max: 50, step: 1, default: 20, mutationWeight: 1.2 },
      { name: "bollingerStdDev", type: "float", min: 1.0, max: 3.5, step: 0.1, default: 2.0, mutationWeight: 1.5 },
      { name: "rsiOverbought", type: "integer", min: 65, max: 85, step: 1, default: 70, mutationWeight: 1.0 },
      { name: "rsiOversold", type: "integer", min: 15, max: 35, step: 1, default: 30, mutationWeight: 1.0 },
      { name: "meanReversionPeriod", type: "integer", min: 5, max: 30, step: 1, default: 14, mutationWeight: 1.0 },
      { name: "stopLossTicks", type: "integer", min: 8, max: 40, step: 1, default: 15, mutationWeight: 0.8 },
      { name: "takeProfitTicks", type: "integer", min: 5, max: 60, step: 1, default: 25, mutationWeight: 0.8 },
    ],
  },
  {
    archetype: "breakout",
    parameters: [
      { name: "channelPeriod", type: "integer", min: 10, max: 60, step: 1, default: 20, mutationWeight: 1.2 },
      { name: "breakoutThreshold", type: "float", min: 0.001, max: 0.02, step: 0.001, default: 0.005, mutationWeight: 1.5 },
      { name: "volumeMultiplier", type: "float", min: 1.0, max: 3.0, step: 0.1, default: 1.5, mutationWeight: 1.0 },
      { name: "retestConfirmation", type: "boolean", default: true, mutationWeight: 0.5 },
      { name: "stopLossTicks", type: "integer", min: 10, max: 50, step: 1, default: 25, mutationWeight: 0.8 },
      { name: "takeProfitTicks", type: "integer", min: 20, max: 120, step: 5, default: 50, mutationWeight: 0.8 },
    ],
  },
  {
    archetype: "scalping",
    parameters: [
      { name: "tickTarget", type: "integer", min: 2, max: 10, step: 1, default: 4, mutationWeight: 1.5 },
      { name: "maxHoldingSeconds", type: "integer", min: 30, max: 300, step: 10, default: 120, mutationWeight: 1.0 },
      { name: "minVolume", type: "integer", min: 100, max: 1000, step: 50, default: 500, mutationWeight: 0.8 },
      { name: "spreadThreshold", type: "float", min: 0.25, max: 2.0, step: 0.25, default: 1.0, mutationWeight: 1.2 },
      { name: "stopLossTicks", type: "integer", min: 2, max: 8, step: 1, default: 4, mutationWeight: 1.0 },
    ],
  },
  {
    archetype: "defensive",
    parameters: [
      { name: "maxDrawdownPct", type: "float", min: 0.01, max: 0.05, step: 0.005, default: 0.02, mutationWeight: 1.0 },
      { name: "positionSizeMultiplier", type: "float", min: 0.25, max: 1.0, step: 0.05, default: 0.5, mutationWeight: 1.2 },
      { name: "vixThreshold", type: "integer", min: 15, max: 30, step: 1, default: 20, mutationWeight: 1.0 },
      { name: "dailyLossLimit", type: "float", min: 0.005, max: 0.03, step: 0.005, default: 0.015, mutationWeight: 1.0 },
      { name: "stopLossTicks", type: "integer", min: 5, max: 25, step: 1, default: 12, mutationWeight: 0.8 },
      { name: "takeProfitTicks", type: "integer", min: 8, max: 40, step: 2, default: 20, mutationWeight: 0.8 },
    ],
  },
  {
    archetype: "trend_following",
    parameters: [
      { name: "emaFast", type: "integer", min: 5, max: 20, step: 1, default: 9, mutationWeight: 1.2 },
      { name: "emaSlow", type: "integer", min: 15, max: 60, step: 1, default: 21, mutationWeight: 1.2 },
      { name: "trendStrengthThreshold", type: "float", min: 0.01, max: 0.05, step: 0.005, default: 0.02, mutationWeight: 1.5 },
      { name: "pyramiding", type: "boolean", default: false, mutationWeight: 0.5 },
      { name: "trailingStopPct", type: "float", min: 0.005, max: 0.03, step: 0.005, default: 0.015, mutationWeight: 1.0 },
      { name: "stopLossTicks", type: "integer", min: 15, max: 60, step: 1, default: 30, mutationWeight: 0.8 },
      { name: "takeProfitTicks", type: "integer", min: 30, max: 150, step: 5, default: 60, mutationWeight: 0.8 },
    ],
  },
];

export type MutationType = "gaussian" | "uniform" | "boundary" | "adaptive" | "regime_aware";

export interface MutationConfig {
  type: MutationType;
  mutationRate: number;
  mutationStrength: number;
  adaptiveDecay?: number;
  elitismRatio?: number;
}

export interface Chromosome {
  genes: Record<string, number | boolean | string>;
  fitness: number;
  generation: number;
  parentIds?: string[];
  mutations: string[];
}

export interface EvolutionState {
  botId: string;
  archetype: string;
  currentGeneration: number;
  bestFitness: number;
  population: Chromosome[];
  history: {
    generation: number;
    bestFitness: number;
    avgFitness: number;
    mutations: string[];
    timestamp: Date;
  }[];
  lastEvolved: Date;
  traceId: string;
}

export interface FitnessMetrics {
  sharpeRatio: number;
  profitFactor: number;
  winRate: number;
  maxDrawdown: number;
  expectancy: number;
  tradesCount: number;
}

const DEFAULT_MUTATION_CONFIG: MutationConfig = {
  type: "adaptive",
  mutationRate: 0.15,
  mutationStrength: 0.2,
  adaptiveDecay: 0.95,
  elitismRatio: 0.1,
};

const REGIME_MUTATION_ADJUSTMENTS: Record<UnifiedRegime, Partial<MutationConfig>> = {
  BULL_EXPANSION: { mutationRate: 0.1, mutationStrength: 0.15 },
  BULL_CONTRACTION: { mutationRate: 0.2, mutationStrength: 0.25 },
  BEAR_EXPANSION: { mutationRate: 0.25, mutationStrength: 0.3 },
  BEAR_RECESSION: { mutationRate: 0.3, mutationStrength: 0.35 },
  SIDEWAYS_STABLE: { mutationRate: 0.1, mutationStrength: 0.1 },
  HIGH_VOL_CRISIS: { mutationRate: 0.4, mutationStrength: 0.5 },
  LOW_VOL_COMPRESSION: { mutationRate: 0.05, mutationStrength: 0.1 },
  TRANSITION: { mutationRate: 0.2, mutationStrength: 0.25 },
  UNKNOWN: { mutationRate: 0.15, mutationStrength: 0.2 },
};

function gaussianRandom(mean: number = 0, stdDev: number = 1): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mutateParameter(
  param: ParameterBounds,
  currentValue: number | boolean | string,
  config: MutationConfig,
  generation: number
): { value: number | boolean | string; mutated: boolean } {
  const shouldMutate = Math.random() < config.mutationRate * (param.mutationWeight || 1.0);
  if (!shouldMutate) {
    return { value: currentValue, mutated: false };
  }

  if (param.type === "boolean") {
    return { value: !currentValue, mutated: true };
  }

  if (param.type === "enum" && param.values) {
    const currentIndex = param.values.indexOf(currentValue);
    const newIndex = Math.floor(Math.random() * param.values.length);
    return { value: param.values[newIndex], mutated: newIndex !== currentIndex };
  }

  if ((param.type === "integer" || param.type === "float") && param.min !== undefined && param.max !== undefined) {
    const range = param.max - param.min;
    let adaptiveStrength = config.mutationStrength;
    if (config.type === "adaptive" && config.adaptiveDecay) {
      adaptiveStrength *= Math.pow(config.adaptiveDecay, generation / 10);
    }

    let newValue: number;
    const numValue = currentValue as number;

    switch (config.type) {
      case "gaussian":
      case "adaptive":
      case "regime_aware":
        const stdDev = range * adaptiveStrength;
        newValue = numValue + gaussianRandom(0, stdDev);
        break;
      case "uniform":
        const delta = range * adaptiveStrength;
        newValue = numValue + (Math.random() * 2 - 1) * delta;
        break;
      case "boundary":
        newValue = Math.random() < 0.5 ? param.min : param.max;
        break;
      default:
        newValue = numValue;
    }

    newValue = clamp(newValue, param.min, param.max);

    if (param.type === "integer") {
      newValue = Math.round(newValue);
      if (param.step) {
        newValue = Math.round(newValue / param.step) * param.step;
      }
    }

    return { value: newValue, mutated: Math.abs(newValue - numValue) > 0.0001 };
  }

  return { value: currentValue, mutated: false };
}

function crossover(parent1: Chromosome, parent2: Chromosome, paramSpace: StrategyParameterSpace): Chromosome {
  const childGenes: Record<string, number | boolean | string> = {};
  
  for (const param of paramSpace.parameters) {
    const useParent1 = Math.random() < 0.5;
    childGenes[param.name] = useParent1 ? parent1.genes[param.name] : parent2.genes[param.name];
    
    if (param.type === "float" && Math.random() < 0.3) {
      const v1 = parent1.genes[param.name] as number;
      const v2 = parent2.genes[param.name] as number;
      const blendRatio = Math.random();
      childGenes[param.name] = v1 * blendRatio + v2 * (1 - blendRatio);
      
      if (param.min !== undefined && param.max !== undefined) {
        childGenes[param.name] = clamp(childGenes[param.name] as number, param.min, param.max);
      }
    }
  }

  return {
    genes: childGenes,
    fitness: 0,
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    parentIds: [String(Math.random()).slice(2, 10), String(Math.random()).slice(2, 10)],
    mutations: ["crossover"],
  };
}

function calculateFitness(metrics: FitnessMetrics): number {
  if (metrics.tradesCount < 10) {
    return 0;
  }

  const sharpeFactor = Math.max(0, metrics.sharpeRatio) * 0.35;
  const profitFactorScore = Math.min(metrics.profitFactor / 3, 1) * 0.25;
  const winRateScore = metrics.winRate * 0.15;
  const drawdownPenalty = Math.max(0, 1 - metrics.maxDrawdown * 2) * 0.15;
  const expectancyScore = Math.max(0, Math.min(metrics.expectancy / 50, 1)) * 0.10;

  return sharpeFactor + profitFactorScore + winRateScore + drawdownPenalty + expectancyScore;
}

export function getParameterSpaceForArchetype(archetype: string): StrategyParameterSpace | null {
  const normalizedArchetype = archetype.toLowerCase().replace(/[-\s]/g, "_");
  return STRATEGY_PARAMETER_SPACES.find(
    (space) => space.archetype.toLowerCase() === normalizedArchetype
  ) || null;
}

export async function initializeChromosome(
  botId: string,
  archetype: string,
  existingConfig?: Record<string, any>
): Promise<Chromosome> {
  const paramSpace = getParameterSpaceForArchetype(archetype);
  if (!paramSpace) {
    throw new Error(`No parameter space defined for archetype: ${archetype}`);
  }

  const genes: Record<string, number | boolean | string> = {};
  for (const param of paramSpace.parameters) {
    if (existingConfig && existingConfig[param.name] !== undefined) {
      genes[param.name] = existingConfig[param.name];
    } else {
      genes[param.name] = param.default;
    }
  }

  return {
    genes,
    fitness: 0,
    generation: 0,
    mutations: ["initial"],
  };
}

export async function evolveBot(
  botId: string,
  metrics: FitnessMetrics,
  options?: {
    mutationConfig?: Partial<MutationConfig>;
    useRegimeAwareness?: boolean;
    traceId?: string;
  }
): Promise<{
  evolved: boolean;
  newConfig: Record<string, any>;
  generation: number;
  fitnessImprovement: number;
  mutations: string[];
  traceId: string;
}> {
  const traceId = options?.traceId || crypto.randomUUID();
  
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) {
    throw new Error(`Bot not found: ${botId}`);
  }

  const archetype = extractArchetype(bot);
  const paramSpace = getParameterSpaceForArchetype(archetype);
  if (!paramSpace) {
    console.log(`[EVOLUTION] trace_id=${traceId} bot_id=${botId} no_param_space archetype=${archetype}`);
    return {
      evolved: false,
      newConfig: (bot.strategyConfig as Record<string, any>) || {},
      generation: 0,
      fitnessImprovement: 0,
      mutations: [],
      traceId,
    };
  }

  let mutationConfig: MutationConfig = { ...DEFAULT_MUTATION_CONFIG, ...options?.mutationConfig };
  
  if (options?.useRegimeAwareness) {
    try {
      const regimeState = await detectUnifiedRegime("MES", { traceId });
      const regimeAdjustments = REGIME_MUTATION_ADJUSTMENTS[regimeState.unifiedRegime];
      mutationConfig = { ...mutationConfig, ...regimeAdjustments, type: "regime_aware" };
      console.log(`[EVOLUTION] trace_id=${traceId} regime_aware=${regimeState.unifiedRegime} mutation_rate=${mutationConfig.mutationRate}`);
    } catch (e) {
      console.warn(`[EVOLUTION] trace_id=${traceId} regime_awareness_failed, using defaults`);
    }
  }

  const existingConfig = (bot.strategyConfig as Record<string, any>) || {};
  const currentChromosome = await initializeChromosome(botId, archetype, existingConfig);
  currentChromosome.fitness = calculateFitness(metrics);
  currentChromosome.generation = (existingConfig._generation || 0) as number;

  const mutations: string[] = [];
  const newGenes: Record<string, number | boolean | string> = {};

  for (const param of paramSpace.parameters) {
    const currentValue = currentChromosome.genes[param.name];
    const result = mutateParameter(param, currentValue, mutationConfig, currentChromosome.generation);
    newGenes[param.name] = result.value;
    if (result.mutated) {
      mutations.push(`${param.name}: ${currentValue} -> ${result.value}`);
    }
  }

  if (mutations.length === 0) {
    return {
      evolved: false,
      newConfig: existingConfig,
      generation: currentChromosome.generation,
      fitnessImprovement: 0,
      mutations: [],
      traceId,
    };
  }

  const newConfig = {
    ...existingConfig,
    ...newGenes,
    _generation: currentChromosome.generation + 1,
    _lastEvolved: new Date().toISOString(),
    _parentFitness: currentChromosome.fitness,
    _mutations: mutations,
  };

  await db.update(bots)
    .set({
      strategyConfig: newConfig,
      updatedAt: new Date(),
    })
    .where(eq(bots.id, botId));

  try {
    await db.insert(botGenerations).values({
      botId,
      stage: bot.stage || "LAB",
      generationNumber: currentChromosome.generation + 1,
      parentGenerationNumber: currentChromosome.generation,
      strategyConfig: newConfig as any,
      mutationReasonCode: mutationConfig.type,
      mutationsSummary: {
        mutations,
        parentFitness: currentChromosome.fitness,
        mutationConfig,
      } as any,
    });
  } catch (e) {
    console.warn(`[EVOLUTION] trace_id=${traceId} failed to record generation: ${e}`);
  }

  await logActivityEvent({
    eventType: "INTEGRATION_PROOF",
    severity: "INFO",
    title: `Strategy Evolution: Gen ${currentChromosome.generation + 1}`,
    summary: `Bot ${bot.name} evolved ${mutations.length} parameters using ${mutationConfig.type} mutation`,
    payload: {
      category: "STRATEGY_EVOLUTION",
      botId,
      archetype,
      generation: currentChromosome.generation + 1,
      mutationsCount: mutations.length,
      parentFitness: currentChromosome.fitness,
      mutationType: mutationConfig.type,
    },
    traceId,
    botId,
  });

  console.log(`[EVOLUTION] trace_id=${traceId} bot_id=${botId} gen=${currentChromosome.generation + 1} mutations=${mutations.length} fitness=${currentChromosome.fitness.toFixed(4)}`);

  return {
    evolved: true,
    newConfig,
    generation: currentChromosome.generation + 1,
    fitnessImprovement: 0,
    mutations,
    traceId,
  };
}

export async function crossoverBots(
  parentBotId1: string,
  parentBotId2: string,
  options?: { traceId?: string }
): Promise<{
  childConfig: Record<string, any>;
  inheritedFrom: { parent1: string[]; parent2: string[] };
  traceId: string;
}> {
  const traceId = options?.traceId || crypto.randomUUID();

  const [parent1, parent2] = await Promise.all([
    db.select().from(bots).where(eq(bots.id, parentBotId1)).limit(1),
    db.select().from(bots).where(eq(bots.id, parentBotId2)).limit(1),
  ]);

  if (!parent1[0] || !parent2[0]) {
    throw new Error("One or both parent bots not found");
  }

  const archetype1 = extractArchetype(parent1[0]);
  const archetype2 = extractArchetype(parent2[0]);
  
  if (archetype1 !== archetype2) {
    throw new Error(`Cannot crossover different archetypes: ${archetype1} vs ${archetype2}`);
  }

  const paramSpace = getParameterSpaceForArchetype(archetype1);
  if (!paramSpace) {
    throw new Error(`No parameter space for archetype: ${archetype1}`);
  }

  const config1 = (parent1[0].strategyConfig as Record<string, any>) || {};
  const config2 = (parent2[0].strategyConfig as Record<string, any>) || {};

  const chrom1 = await initializeChromosome(parentBotId1, archetype1, config1);
  const chrom2 = await initializeChromosome(parentBotId2, archetype1, config2);

  const child = crossover(chrom1, chrom2, paramSpace);

  const inheritedFrom = { parent1: [] as string[], parent2: [] as string[] };
  for (const param of paramSpace.parameters) {
    if (child.genes[param.name] === chrom1.genes[param.name]) {
      inheritedFrom.parent1.push(param.name);
    } else {
      inheritedFrom.parent2.push(param.name);
    }
  }

  const childConfig = {
    ...child.genes,
    _generation: child.generation,
    _crossoverParents: [parentBotId1, parentBotId2],
    _createdAt: new Date().toISOString(),
  };

  console.log(`[EVOLUTION] trace_id=${traceId} crossover from ${parentBotId1} x ${parentBotId2} gen=${child.generation}`);

  return { childConfig, inheritedFrom, traceId };
}

export async function getEvolutionHistory(botId: string): Promise<{
  currentGeneration: number;
  totalEvolutions: number;
  recentMutations: { generation: number; mutations: string[]; timestamp: string }[];
}> {
  const generations = await db.select()
    .from(botGenerations)
    .where(eq(botGenerations.botId, botId))
    .orderBy(desc(botGenerations.generationNumber))
    .limit(10);

  const currentGeneration = generations[0]?.generationNumber || 0;
  
  const recentMutations = generations.map((g) => ({
    generation: g.generationNumber || 0,
    mutations: (g.mutationsSummary as any)?.mutations || [],
    timestamp: g.createdAt?.toISOString() || new Date().toISOString(),
  }));

  return {
    currentGeneration,
    totalEvolutions: generations.length,
    recentMutations,
  };
}

export async function shouldEvolve(botId: string, metrics: FitnessMetrics): Promise<{
  shouldEvolve: boolean;
  reason: string;
  priority: "high" | "medium" | "low" | "none";
}> {
  const fitness = calculateFitness(metrics);
  
  if (metrics.tradesCount < 20) {
    return { shouldEvolve: false, reason: "Insufficient trade data", priority: "none" };
  }

  if (metrics.sharpeRatio < 0) {
    return { shouldEvolve: true, reason: "Negative Sharpe ratio", priority: "high" };
  }

  if (metrics.maxDrawdown > 0.15) {
    return { shouldEvolve: true, reason: "Excessive drawdown", priority: "high" };
  }

  if (metrics.profitFactor < 1.0) {
    return { shouldEvolve: true, reason: "Unprofitable (PF < 1)", priority: "high" };
  }

  if (metrics.winRate < 0.35) {
    return { shouldEvolve: true, reason: "Low win rate", priority: "medium" };
  }

  if (metrics.sharpeRatio < 0.5) {
    return { shouldEvolve: true, reason: "Suboptimal Sharpe", priority: "medium" };
  }

  if (fitness < 0.4) {
    return { shouldEvolve: true, reason: "Low overall fitness", priority: "low" };
  }

  return { shouldEvolve: false, reason: "Strategy performing adequately", priority: "none" };
}

function extractArchetype(bot: Bot): string {
  const strategyType = (bot as any).strategyType || (bot as any).archetype;
  if (strategyType) {
    return strategyType.toLowerCase().replace(/[-\s]/g, "_");
  }
  const name = (bot.name || "").toLowerCase();
  if (name.includes("momentum")) return "momentum";
  if (name.includes("mean") || name.includes("reversion")) return "mean_reversion";
  if (name.includes("breakout")) return "breakout";
  if (name.includes("scalp")) return "scalping";
  if (name.includes("defensive") || name.includes("hedge")) return "defensive";
  if (name.includes("trend")) return "trend_following";
  return "momentum";
}

export async function runEvolutionTests(): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: { name: string; passed: boolean; details?: any; error?: string }[];
}> {
  const results: { name: string; passed: boolean; details?: any; error?: string }[] = [];

  try {
    const paramSpace = getParameterSpaceForArchetype("momentum");
    if (!paramSpace) throw new Error("No param space for momentum");
    if (paramSpace.parameters.length < 5) throw new Error("Insufficient params");
    results.push({ name: "Parameter Space Loading", passed: true, details: { paramCount: paramSpace.parameters.length } });
  } catch (e) {
    results.push({ name: "Parameter Space Loading", passed: false, error: String(e) });
  }

  try {
    const config: MutationConfig = { type: "gaussian", mutationRate: 1.0, mutationStrength: 0.3 };
    const param: ParameterBounds = { name: "test", type: "float", min: 0, max: 100, default: 50 };
    let mutationCount = 0;
    for (let i = 0; i < 100; i++) {
      const result = mutateParameter(param, 50, config, 0);
      if (result.mutated) mutationCount++;
    }
    if (mutationCount < 80) throw new Error(`Low mutation rate: ${mutationCount}/100`);
    results.push({ name: "Mutation Operator", passed: true, details: { mutationCount } });
  } catch (e) {
    results.push({ name: "Mutation Operator", passed: false, error: String(e) });
  }

  try {
    const fitness = calculateFitness({
      sharpeRatio: 1.5,
      profitFactor: 2.0,
      winRate: 0.55,
      maxDrawdown: 0.08,
      expectancy: 25,
      tradesCount: 100,
    });
    if (fitness < 0.5) throw new Error(`Fitness too low: ${fitness}`);
    if (fitness > 1.0) throw new Error(`Fitness too high: ${fitness}`);
    results.push({ name: "Fitness Calculation", passed: true, details: { fitness } });
  } catch (e) {
    results.push({ name: "Fitness Calculation", passed: false, error: String(e) });
  }

  try {
    const shouldEvolveResult = await shouldEvolve("test-bot", {
      sharpeRatio: -0.5,
      profitFactor: 0.8,
      winRate: 0.3,
      maxDrawdown: 0.2,
      expectancy: -10,
      tradesCount: 50,
    });
    if (!shouldEvolveResult.shouldEvolve) throw new Error("Should recommend evolution");
    if (shouldEvolveResult.priority !== "high") throw new Error(`Wrong priority: ${shouldEvolveResult.priority}`);
    results.push({ name: "Evolution Decision", passed: true, details: shouldEvolveResult });
  } catch (e) {
    results.push({ name: "Evolution Decision", passed: false, error: String(e) });
  }

  try {
    const paramSpace = getParameterSpaceForArchetype("momentum")!;
    const parent1: Chromosome = { genes: { entryThreshold: 0.01 }, fitness: 0.5, generation: 1, mutations: [] };
    const parent2: Chromosome = { genes: { entryThreshold: 0.03 }, fitness: 0.6, generation: 1, mutations: [] };
    const child = crossover(parent1, parent2, paramSpace);
    if (child.generation !== 2) throw new Error(`Wrong generation: ${child.generation}`);
    results.push({ name: "Crossover Operator", passed: true, details: { childGeneration: child.generation } });
  } catch (e) {
    results.push({ name: "Crossover Operator", passed: false, error: String(e) });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`[EVOLUTION_TESTS] ${passed}/${results.length} passed`);

  return { passed, failed, total: results.length, results };
}
