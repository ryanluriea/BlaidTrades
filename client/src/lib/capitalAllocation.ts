/**
 * Capital Allocation Engine
 * Dynamic allocation of account risk budget among bots
 */

import type { HealthState, PriorityBucket } from "./priorityScore";

export interface BotAllocationInput {
  botId: string;
  priorityScore: number;
  priorityBucket: PriorityBucket;
  healthState: HealthState;
  stage: string;
}

export interface AccountBudget {
  accountId: string;
  dailyRiskBudgetDollars: number;
  perTradeRiskBudgetDollars: number;
  maxTotalExposureContracts: number;
  maxContractsPerTrade: number;
  currentBalance: number;
}

export interface BotAllocation {
  botId: string;
  accountId: string;
  priorityScore: number;
  weight: number;
  maxContractsDynamic: number;
  maxRiskDollarsDynamic: number;
}

/**
 * Compute allocation weights using softmax-like scaling
 * Emphasizes high performers, de-emphasizes low scorers
 */
function computeWeights(bots: BotAllocationInput[]): Map<string, number> {
  const weights = new Map<string, number>();
  
  // Filter out degraded/frozen bots
  const eligibleBots = bots.filter(b => 
    b.healthState !== "DEGRADED" && b.stage !== "DEGRADED"
  );
  
  if (eligibleBots.length === 0) {
    return weights;
  }
  
  // Compute raw weights: (score - 30)^1.5
  // Anything below 30 gets near-zero allocation
  const rawWeights: { botId: string; raw: number }[] = [];
  let totalRaw = 0;
  
  for (const bot of eligibleBots) {
    const shifted = Math.max(0, bot.priorityScore - 30);
    const raw = Math.pow(shifted, 1.5);
    rawWeights.push({ botId: bot.botId, raw });
    totalRaw += raw;
  }
  
  // Normalize to sum to 1
  for (const { botId, raw } of rawWeights) {
    const normalized = totalRaw > 0 ? raw / totalRaw : 0;
    weights.set(botId, normalized);
  }
  
  return weights;
}

/**
 * Apply bucket-based and health-based modifiers to weight
 */
function applyModifiers(
  weight: number,
  bucket: PriorityBucket,
  health: HealthState
): number {
  let modified = weight;
  
  // Bucket modifiers
  switch (bucket) {
    case "A+":
      // A+ gets full allocation (no cap)
      break;
    case "A":
      // A is close to A+
      break;
    case "B":
      // B is standard
      break;
    case "C":
    case "D":
      // C/D get downscaled by 50%
      modified *= 0.5;
      break;
    case "FROZEN":
      return 0;
  }
  
  // Health modifiers
  switch (health) {
    case "OK":
      break;
    case "WARN":
      modified *= 0.75;
      break;
    case "DEGRADED":
      return 0;
  }
  
  return modified;
}

/**
 * Compute allocations for all bots on an account
 */
export function computeAllocations(
  bots: BotAllocationInput[],
  budget: AccountBudget,
  dollarsPerContractAtStop: number = 100 // Default estimate
): BotAllocation[] {
  const allocations: BotAllocation[] = [];
  
  // Get base weights
  const weights = computeWeights(bots);
  
  for (const bot of bots) {
    const baseWeight = weights.get(bot.botId) || 0;
    
    // Apply modifiers
    const adjustedWeight = applyModifiers(baseWeight, bot.priorityBucket, bot.healthState);
    
    // Compute risk dollars allocation
    const maxRiskDollarsDynamic = budget.perTradeRiskBudgetDollars * adjustedWeight;
    
    // Convert to contracts
    let maxContractsDynamic = dollarsPerContractAtStop > 0
      ? Math.floor(maxRiskDollarsDynamic / dollarsPerContractAtStop)
      : 0;
    
    // Apply account cap
    maxContractsDynamic = Math.min(maxContractsDynamic, budget.maxContractsPerTrade);
    
    // A+ bots can use full account cap if their allocation supports it
    if (bot.priorityBucket === "A+") {
      maxContractsDynamic = Math.min(
        Math.max(maxContractsDynamic, 1), // At least 1 if A+
        budget.maxContractsPerTrade
      );
    }
    
    allocations.push({
      botId: bot.botId,
      accountId: budget.accountId,
      priorityScore: bot.priorityScore,
      weight: adjustedWeight,
      maxContractsDynamic: Math.max(0, maxContractsDynamic),
      maxRiskDollarsDynamic: Math.max(0, maxRiskDollarsDynamic),
    });
  }
  
  return allocations;
}

/**
 * Get safe fallback allocation for bots without computed allocation
 */
export function getSafeFallbackAllocation(
  botId: string,
  accountId: string,
  accountMaxContractsPerTrade: number
): BotAllocation {
  // Minimum safe allocation: 1 contract, small risk
  return {
    botId,
    accountId,
    priorityScore: 0,
    weight: 0.1,
    maxContractsDynamic: 1,
    maxRiskDollarsDynamic: 50,
  };
}

/**
 * Check if allocation should be recomputed
 */
export function shouldRecomputeAllocations(
  lastComputedAt: Date | null,
  recentTradeCloseCount: number = 0,
  balanceChangePercent: number = 0
): boolean {
  // Recompute every 5 minutes
  if (!lastComputedAt) return true;
  
  const minutesSince = (Date.now() - lastComputedAt.getTime()) / (1000 * 60);
  if (minutesSince >= 5) return true;
  
  // Recompute on trade burst (3+ trades closed)
  if (recentTradeCloseCount >= 3) return true;
  
  // Recompute on significant balance change (>2%)
  if (Math.abs(balanceChangePercent) > 2) return true;
  
  return false;
}
