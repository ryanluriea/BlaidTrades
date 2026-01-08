/**
 * Trade Arbiter
 * Deterministic gating + ranking for signal execution
 */

import type { HealthState, PriorityBucket } from "./priorityScore";

export type ArbiterDecision = "ALLOWED" | "REDUCED" | "DELAYED" | "REJECTED";

// Economic event blocking configuration
export const MACRO_EVENT_WINDOW = {
  beforeMinutes: 5,
  afterMinutes: 10,
};

export interface MacroEventBlock {
  isBlocked: boolean;
  events: {
    name: string;
    scheduledAt: string;
    country?: string;
  }[];
  windowStart: Date;
  windowEnd: Date;
}

export interface BotContext {
  botId: string;
  botInstanceId?: string;
  stage: string;
  executionMode: string;
  priorityScore: number;
  priorityBucket: PriorityBucket;
  healthState: HealthState;
  accountId: string;
  accountType: string;
  currentPositionContracts: number;
  totalExposureContracts: number;
  dailyRealizedPnl: number;
  macroEventBlock?: MacroEventBlock;
}

export interface AccountRiskBudget {
  dailyLossLimitDollars: number;
  dailyLossUsedDollars: number;
  maxTotalExposureContracts: number;
  currentExposureContracts: number;
  maxContractsPerSymbol: number;
  currentSymbolContracts: number;
  perTradeRiskBudgetDollars: number;
}

export interface SignalCandidate {
  signalId?: string;
  botContext: BotContext;
  signalConfidence: number; // 0-1
  regimeFit: number; // 0-1
  requestedContracts: number;
  dollarsPerContractAtStop: number;
  symbol: string;
  direction: "BUY" | "SELL";
}

export interface ArbiterResult {
  decision: ArbiterDecision;
  allowedContracts: number;
  reason: string;
  candidateScore: number;
  capsApplied: string[];
  macroEventBlock?: MacroEventBlock;
}

/**
 * Check hard safety gates
 * Returns rejection reason or null if passed
 */
function checkSafetyGates(ctx: BotContext): { reason: string | null; macroBlock?: MacroEventBlock } {
  // DEGRADED health = FROZEN
  if (ctx.healthState === "DEGRADED") {
    return { reason: "FROZEN: Bot health is DEGRADED" };
  }
  
  // LIVE mode requires LIVE account
  if (ctx.executionMode === "LIVE" && ctx.accountType !== "LIVE") {
    return { reason: "BLOCKED: LIVE mode requires LIVE account" };
  }
  
  // Stage must match mode capability
  if (ctx.stage === "TRIALS" && ctx.executionMode === "LIVE") {
    return { reason: "BLOCKED: TRIALS stage cannot execute LIVE orders" };
  }

  // Check macro event blocking (if provided)
  if (ctx.macroEventBlock?.isBlocked) {
    const eventNames = ctx.macroEventBlock.events.map(e => e.name).join(", ");
    return { 
      reason: `BLOCKED: High-impact macro event(s): ${eventNames}`,
      macroBlock: ctx.macroEventBlock,
    };
  }
  
  return { reason: null };
}

/**
 * Check risk budget availability
 * Returns remaining budget info or rejection
 */
function checkRiskBudget(
  budget: AccountRiskBudget,
  requestedContracts: number
): { canProceed: boolean; maxAllowed: number; reason?: string } {
  // Daily loss check
  const dailyHeadroom = budget.dailyLossLimitDollars - Math.abs(budget.dailyLossUsedDollars);
  if (dailyHeadroom <= 0) {
    return { canProceed: false, maxAllowed: 0, reason: "BUDGET_EXHAUSTED: Daily loss limit reached" };
  }
  
  // Exposure check
  const exposureHeadroom = budget.maxTotalExposureContracts - budget.currentExposureContracts;
  if (exposureHeadroom <= 0) {
    return { canProceed: false, maxAllowed: 0, reason: "BUDGET_EXHAUSTED: Max exposure reached" };
  }
  
  // Symbol check
  const symbolHeadroom = budget.maxContractsPerSymbol - budget.currentSymbolContracts;
  if (symbolHeadroom <= 0) {
    return { canProceed: false, maxAllowed: 0, reason: "BUDGET_EXHAUSTED: Symbol limit reached" };
  }
  
  // Calculate max allowed
  const maxAllowed = Math.min(
    requestedContracts,
    exposureHeadroom,
    symbolHeadroom
  );
  
  return { canProceed: true, maxAllowed };
}

/**
 * Compute candidate score for ranking
 * Higher score = higher priority for allocation
 */
function computeCandidateScore(
  candidate: SignalCandidate,
  correlationPenalty: number = 0,
  exposurePenalty: number = 0
): number {
  const { botContext, signalConfidence, regimeFit } = candidate;
  
  // Normalize priority score to 0-1
  const priorityNorm = botContext.priorityScore / 100;
  
  // Base score from priority, confidence, regime
  const baseScore = 
    0.60 * priorityNorm +
    0.25 * signalConfidence +
    0.15 * regimeFit;
  
  // Apply penalties
  const finalScore = Math.max(0, baseScore - correlationPenalty - exposurePenalty);
  
  return finalScore;
}

/**
 * Arbitrate a single signal
 */
export function arbitrateSignal(
  candidate: SignalCandidate,
  budget: AccountRiskBudget,
  correlationPenalty: number = 0,
  exposurePenalty: number = 0
): ArbiterResult {
  const capsApplied: string[] = [];
  
  // Step 1: Safety gates
  const gateCheck = checkSafetyGates(candidate.botContext);
  if (gateCheck.reason) {
    return {
      decision: "REJECTED",
      allowedContracts: 0,
      reason: gateCheck.reason,
      candidateScore: 0,
      capsApplied: [],
      macroEventBlock: gateCheck.macroBlock,
    };
  }
  
  // Step 2: Risk budget check
  const budgetCheck = checkRiskBudget(budget, candidate.requestedContracts);
  if (!budgetCheck.canProceed) {
    return {
      decision: "REJECTED",
      allowedContracts: 0,
      reason: budgetCheck.reason || "BUDGET_EXHAUSTED",
      candidateScore: 0,
      capsApplied: [],
    };
  }
  
  // Step 3: Compute candidate score
  const candidateScore = computeCandidateScore(candidate, correlationPenalty, exposurePenalty);
  
  // Step 4: Determine allowed contracts
  let allowedContracts = Math.min(candidate.requestedContracts, budgetCheck.maxAllowed);
  
  // Apply budget constraints and track caps
  if (allowedContracts < candidate.requestedContracts) {
    if (budget.currentExposureContracts + candidate.requestedContracts > budget.maxTotalExposureContracts) {
      capsApplied.push("max_total_exposure");
    }
    if (budget.currentSymbolContracts + candidate.requestedContracts > budget.maxContractsPerSymbol) {
      capsApplied.push("max_contracts_per_symbol");
    }
  }
  
  // Step 5: Determine decision
  let decision: ArbiterDecision;
  let reason: string;
  
  if (allowedContracts === 0) {
    decision = "REJECTED";
    reason = "Order reduced to zero after caps applied";
  } else if (allowedContracts < candidate.requestedContracts) {
    decision = "REDUCED";
    reason = `Reduced from ${candidate.requestedContracts} to ${allowedContracts} contracts`;
  } else {
    decision = "ALLOWED";
    reason = "Order allowed at requested size";
  }
  
  return {
    decision,
    allowedContracts,
    reason,
    candidateScore,
    capsApplied,
  };
}

/**
 * Arbitrate multiple competing signals
 * Allocates budget to highest priority first
 */
export function arbitrateMultipleSignals(
  candidates: SignalCandidate[],
  budget: AccountRiskBudget,
  correlationPenalties: Map<string, number> = new Map()
): Map<string, ArbiterResult> {
  const results = new Map<string, ArbiterResult>();
  
  // Score and sort candidates
  const scoredCandidates = candidates.map(c => ({
    candidate: c,
    score: computeCandidateScore(
      c,
      correlationPenalties.get(c.botContext.botId) || 0
    ),
  })).sort((a, b) => b.score - a.score);
  
  // Track remaining budget
  let remainingExposure = budget.maxTotalExposureContracts - budget.currentExposureContracts;
  let remainingDailyLoss = budget.dailyLossLimitDollars - Math.abs(budget.dailyLossUsedDollars);
  
  for (const { candidate, score } of scoredCandidates) {
    // Compute adjusted budget
    const adjustedBudget: AccountRiskBudget = {
      ...budget,
      currentExposureContracts: budget.maxTotalExposureContracts - remainingExposure,
      dailyLossUsedDollars: budget.dailyLossLimitDollars - remainingDailyLoss,
    };
    
    const result = arbitrateSignal(
      candidate,
      adjustedBudget,
      correlationPenalties.get(candidate.botContext.botId) || 0
    );
    
    // Update remaining budget
    if (result.decision === "ALLOWED" || result.decision === "REDUCED") {
      remainingExposure -= result.allowedContracts;
      // Approximate daily loss impact
      remainingDailyLoss -= result.allowedContracts * candidate.dollarsPerContractAtStop * 0.5;
    }
    
    results.set(candidate.botContext.botId, result);
  }
  
  return results;
}

/**
 * Get execution routing based on account type and mode
 */
export function getExecutionRouting(
  accountType: string,
  executionMode: string
): "INTERNAL_SIM_FILLS" | "BROKER_FILLS" | "BLOCKED" {
  // BACKTEST always internal
  if (executionMode === "BACKTEST_ONLY") {
    return "INTERNAL_SIM_FILLS";
  }
  
  // SIM and SHADOW always internal
  if (executionMode === "SIM_LIVE" || executionMode === "SHADOW") {
    return "INTERNAL_SIM_FILLS";
  }
  
  // LIVE mode on LIVE account = broker
  if (executionMode === "LIVE" && accountType === "LIVE") {
    return "BROKER_FILLS";
  }
  
  // Invalid combination
  return "BLOCKED";
}
