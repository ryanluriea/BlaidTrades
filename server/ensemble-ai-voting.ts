/**
 * ENSEMBLE AI VOTING SYSTEM
 * 
 * Multi-LLM consensus voting for high-stakes trading decisions.
 * Queries multiple AI providers in parallel and aggregates their votes
 * with weighted consensus based on historical accuracy.
 * 
 * Key Features:
 * - Parallel provider queries with timeout protection
 * - Weighted voting based on provider accuracy history
 * - Confidence-adjusted vote weighting
 * - Conflict detection and resolution
 * - Provider accuracy tracking over time
 * - Supermajority requirements for high-risk decisions
 */

import { db } from "./db";
import { bots } from "@shared/schema";
import { eq } from "drizzle-orm";

export type VoteDecision = "BUY" | "SELL" | "HOLD" | "ABSTAIN";
export type DecisionCategory = "ENTRY" | "EXIT" | "SCALE" | "RISK_ADJUST" | "EVOLUTION";

export interface ProviderVote {
  provider: string;
  decision: VoteDecision;
  confidence: number;
  reasoning: string;
  latencyMs: number;
  timestamp: Date;
  error?: string;
}

export interface EnsembleVoteRequest {
  botId: string;
  category: DecisionCategory;
  context: {
    symbol?: string;
    currentPosition?: "LONG" | "SHORT" | "FLAT";
    entryPrice?: number;
    currentPrice?: number;
    unrealizedPnl?: number;
    marketRegime?: string;
    strategyArchetype?: string;
    recentPerformance?: {
      winRate: number;
      sharpeRatio: number;
      maxDrawdown: number;
    };
    customData?: Record<string, any>;
  };
  requiredProviders?: number;
  timeoutMs?: number;
  supermajorityRequired?: boolean;
}

export interface EnsembleVoteResult {
  botId: string;
  category: DecisionCategory;
  consensusDecision: VoteDecision;
  consensusConfidence: number;
  agreementStrength: number;
  totalVotes: number;
  votesReceived: number;
  providerVotes: ProviderVote[];
  conflicts: ConflictInfo[];
  recommendation: {
    action: VoteDecision;
    shouldExecute: boolean;
    reason: string;
  };
  timestamp: Date;
  durationMs: number;
}

export interface ConflictInfo {
  type: "SPLIT_DECISION" | "LOW_CONFIDENCE" | "TIMEOUT_DEGRADED" | "SUPERMAJORITY_FAILED";
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  affectedProviders: string[];
}

export interface ProviderAccuracy {
  provider: string;
  totalVotes: number;
  correctVotes: number;
  accuracyRate: number;
  avgConfidence: number;
  avgLatencyMs: number;
  lastUpdated: Date;
}

const PROVIDER_BASE_WEIGHTS: Record<string, number> = {
  anthropic: 1.2,
  openai: 1.1,
  perplexity: 1.15,
  groq: 0.95,
  gemini: 1.0,
  xai: 1.05,
};

const PROVIDER_API_CONFIGS: Record<string, {
  url: string;
  envVar: string;
  model: string;
  formatRequest: (prompt: string, apiKey: string) => { headers: Record<string, string>; body: string };
  parseResponse: (response: any) => { content: string; tokens?: { input: number; output: number } };
}> = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    envVar: "OPENAI_API_KEY",
    model: "gpt-4o-mini",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    }),
    parseResponse: (r) => ({
      content: r.choices?.[0]?.message?.content || "",
      tokens: { input: r.usage?.prompt_tokens || 0, output: r.usage?.completion_tokens || 0 },
    }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-3-haiku-20240307",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    parseResponse: (r) => ({
      content: r.content?.[0]?.text || "",
      tokens: { input: r.usage?.input_tokens || 0, output: r.usage?.output_tokens || 0 },
    }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    envVar: "GROQ_API_KEY",
    model: "llama-3.1-8b-instant",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    }),
    parseResponse: (r) => ({
      content: r.choices?.[0]?.message?.content || "",
      tokens: { input: r.usage?.prompt_tokens || 0, output: r.usage?.completion_tokens || 0 },
    }),
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    envVar: "GOOGLE_GEMINI_API_KEY",
    model: "gemini-1.5-flash",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }),
    parseResponse: (r) => ({
      content: r.candidates?.[0]?.content?.parts?.[0]?.text || "",
      tokens: {
        input: r.usageMetadata?.promptTokenCount || 0,
        output: r.usageMetadata?.candidatesTokenCount || 0,
      },
    }),
  },
  xai: {
    url: "https://api.x.ai/v1/chat/completions",
    envVar: "XAI_API_KEY",
    model: "grok-4.1-fast",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.1-fast",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    }),
    parseResponse: (r) => ({
      content: r.choices?.[0]?.message?.content || "",
      tokens: { input: r.usage?.prompt_tokens || 0, output: r.usage?.completion_tokens || 0 },
    }),
  },
};

const providerAccuracyCache: Map<string, ProviderAccuracy> = new Map();

const voteHistoryCache: Map<string, EnsembleVoteResult[]> = new Map();

function getAvailableProviders(): string[] {
  return Object.entries(PROVIDER_API_CONFIGS)
    .filter(([_, config]) => !!process.env[config.envVar])
    .map(([provider]) => provider);
}

function buildVotingPrompt(request: EnsembleVoteRequest): string {
  const { category, context } = request;
  
  let situationDescription = "";
  
  switch (category) {
    case "ENTRY":
      situationDescription = `
Considering a new ${context.symbol || "trading"} position.
Market regime: ${context.marketRegime || "UNKNOWN"}
Strategy archetype: ${context.strategyArchetype || "UNKNOWN"}
Current price: ${context.currentPrice || "N/A"}`;
      break;
    case "EXIT":
      situationDescription = `
Evaluating exit for ${context.currentPosition || "UNKNOWN"} position.
Entry price: ${context.entryPrice || "N/A"}
Current price: ${context.currentPrice || "N/A"}
Unrealized P&L: ${context.unrealizedPnl !== undefined ? `$${context.unrealizedPnl.toFixed(2)}` : "N/A"}`;
      break;
    case "SCALE":
      situationDescription = `
Evaluating position scaling for ${context.symbol || "UNKNOWN"}.
Current position: ${context.currentPosition || "FLAT"}
Unrealized P&L: ${context.unrealizedPnl !== undefined ? `$${context.unrealizedPnl.toFixed(2)}` : "N/A"}`;
      break;
    case "RISK_ADJUST":
      situationDescription = `
Evaluating risk adjustment for portfolio.
Market regime: ${context.marketRegime || "UNKNOWN"}
Recent performance: Win rate ${(context.recentPerformance?.winRate ?? 0) * 100}%, Sharpe ${context.recentPerformance?.sharpeRatio?.toFixed(2) || "N/A"}`;
      break;
    case "EVOLUTION":
      situationDescription = `
Evaluating strategy evolution for ${context.strategyArchetype || "UNKNOWN"} bot.
Recent performance: Win rate ${(context.recentPerformance?.winRate ?? 0) * 100}%, Max DD ${(context.recentPerformance?.maxDrawdown ?? 0) * 100}%`;
      break;
  }

  return `You are a quantitative trading analyst participating in an ensemble voting system for trading decisions.

SITUATION:
${situationDescription}

${context.customData ? `ADDITIONAL CONTEXT:\n${JSON.stringify(context.customData, null, 2)}` : ""}

DECISION REQUIRED: ${category}

You must respond with a JSON object containing:
1. "decision": One of "BUY", "SELL", "HOLD", or "ABSTAIN"
2. "confidence": A number between 0 and 1 indicating your confidence level
3. "reasoning": A brief 1-2 sentence explanation

For ${category} decisions:
- BUY = Enter/add to long position or reduce short
- SELL = Enter/add to short position or reduce long  
- HOLD = Maintain current position, no action
- ABSTAIN = Insufficient information to make a recommendation

Respond ONLY with the JSON object, no additional text.

Example response:
{"decision":"HOLD","confidence":0.72,"reasoning":"Current market regime suggests caution. Wait for clearer directional signals."}`;
}

async function queryProvider(
  provider: string,
  prompt: string,
  timeoutMs: number
): Promise<ProviderVote> {
  const config = PROVIDER_API_CONFIGS[provider];
  if (!config) {
    return {
      provider,
      decision: "ABSTAIN",
      confidence: 0,
      reasoning: "Provider not configured",
      latencyMs: 0,
      timestamp: new Date(),
      error: "Provider not configured",
    };
  }

  const apiKey = process.env[config.envVar];
  if (!apiKey) {
    return {
      provider,
      decision: "ABSTAIN",
      confidence: 0,
      reasoning: "API key not available",
      latencyMs: 0,
      timestamp: new Date(),
      error: "API key not available",
    };
  }

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { headers, body } = config.formatRequest(prompt, apiKey);
    
    let url = config.url;
    if (provider === "gemini") {
      url = `${config.url}?key=${apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      return {
        provider,
        decision: "ABSTAIN",
        confidence: 0,
        reasoning: "API request failed",
        latencyMs,
        timestamp: new Date(),
        error: `HTTP ${response.status}: ${errorText.slice(0, 100)}`,
      };
    }

    const data = await response.json();
    const parsed = config.parseResponse(data);
    
    let decision: VoteDecision = "ABSTAIN";
    let confidence = 0;
    let reasoning = "Failed to parse response";

    try {
      const cleanContent = parsed.content.trim().replace(/```json\n?|\n?```/g, "");
      const voteData = JSON.parse(cleanContent);
      
      decision = (["BUY", "SELL", "HOLD", "ABSTAIN"].includes(voteData.decision?.toUpperCase()))
        ? voteData.decision.toUpperCase() as VoteDecision
        : "ABSTAIN";
      confidence = Math.min(1, Math.max(0, parseFloat(voteData.confidence) || 0));
      reasoning = voteData.reasoning || "No reasoning provided";
    } catch (parseError) {
      const upper = parsed.content.toUpperCase();
      if (upper.includes("BUY")) decision = "BUY";
      else if (upper.includes("SELL")) decision = "SELL";
      else if (upper.includes("HOLD")) decision = "HOLD";
      confidence = 0.5;
      reasoning = parsed.content.slice(0, 200);
    }

    return {
      provider,
      decision,
      confidence,
      reasoning,
      latencyMs,
      timestamp: new Date(),
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    
    return {
      provider,
      decision: "ABSTAIN",
      confidence: 0,
      reasoning: error.name === "AbortError" ? "Request timed out" : "Request failed",
      latencyMs,
      timestamp: new Date(),
      error: error.message,
    };
  }
}

function calculateWeightedVote(
  vote: ProviderVote,
  accuracyHistory?: ProviderAccuracy
): number {
  const baseWeight = PROVIDER_BASE_WEIGHTS[vote.provider] || 1.0;
  
  const accuracyMultiplier = accuracyHistory && accuracyHistory.totalVotes >= 10
    ? 0.5 + accuracyHistory.accuracyRate * 0.5
    : 1.0;
  
  const confidenceMultiplier = 0.3 + vote.confidence * 0.7;
  
  return baseWeight * accuracyMultiplier * confidenceMultiplier;
}

function aggregateVotes(
  votes: ProviderVote[],
  supermajorityRequired: boolean
): {
  consensusDecision: VoteDecision;
  consensusConfidence: number;
  agreementStrength: number;
  conflicts: ConflictInfo[];
} {
  const validVotes = votes.filter(v => v.decision !== "ABSTAIN" && !v.error);
  
  if (validVotes.length === 0) {
    return {
      consensusDecision: "HOLD",
      consensusConfidence: 0,
      agreementStrength: 0,
      conflicts: [{
        type: "TIMEOUT_DEGRADED",
        severity: "HIGH",
        description: "No valid votes received from any provider",
        affectedProviders: votes.map(v => v.provider),
      }],
    };
  }

  const voteWeights: Record<VoteDecision, number> = {
    BUY: 0,
    SELL: 0,
    HOLD: 0,
    ABSTAIN: 0,
  };

  let totalWeight = 0;
  let totalConfidence = 0;

  for (const vote of validVotes) {
    const accuracy = providerAccuracyCache.get(vote.provider);
    const weight = calculateWeightedVote(vote, accuracy);
    
    voteWeights[vote.decision] += weight;
    totalWeight += weight;
    totalConfidence += vote.confidence;
  }

  const avgConfidence = totalConfidence / validVotes.length;

  const sortedDecisions = (Object.entries(voteWeights) as [VoteDecision, number][])
    .filter(([decision]) => decision !== "ABSTAIN")
    .sort((a, b) => b[1] - a[1]);

  const topDecision = sortedDecisions[0]?.[0] || "HOLD";
  const topWeight = sortedDecisions[0]?.[1] || 0;
  const secondWeight = sortedDecisions[1]?.[1] || 0;

  const agreementStrength = totalWeight > 0 ? topWeight / totalWeight : 0;

  const conflicts: ConflictInfo[] = [];

  if (sortedDecisions.length >= 2 && secondWeight > 0) {
    const margin = topWeight - secondWeight;
    const marginRatio = margin / totalWeight;
    
    if (marginRatio < 0.15) {
      conflicts.push({
        type: "SPLIT_DECISION",
        severity: "HIGH",
        description: `Very close vote between ${sortedDecisions[0][0]} (${(topWeight/totalWeight*100).toFixed(0)}%) and ${sortedDecisions[1][0]} (${(secondWeight/totalWeight*100).toFixed(0)}%)`,
        affectedProviders: validVotes
          .filter(v => v.decision === sortedDecisions[0][0] || v.decision === sortedDecisions[1][0])
          .map(v => v.provider),
      });
    } else if (marginRatio < 0.3) {
      conflicts.push({
        type: "SPLIT_DECISION",
        severity: "MEDIUM",
        description: `Moderate disagreement: ${sortedDecisions[0][0]} leads with ${(agreementStrength*100).toFixed(0)}%`,
        affectedProviders: validVotes.filter(v => v.decision !== topDecision).map(v => v.provider),
      });
    }
  }

  if (avgConfidence < 0.5) {
    conflicts.push({
      type: "LOW_CONFIDENCE",
      severity: avgConfidence < 0.3 ? "HIGH" : "MEDIUM",
      description: `Average provider confidence is low: ${(avgConfidence*100).toFixed(0)}%`,
      affectedProviders: validVotes.filter(v => v.confidence < 0.5).map(v => v.provider),
    });
  }

  const abstainedOrFailed = votes.filter(v => v.decision === "ABSTAIN" || v.error);
  if (abstainedOrFailed.length >= votes.length / 2) {
    conflicts.push({
      type: "TIMEOUT_DEGRADED",
      severity: "MEDIUM",
      description: `${abstainedOrFailed.length}/${votes.length} providers failed or abstained`,
      affectedProviders: abstainedOrFailed.map(v => v.provider),
    });
  }

  if (supermajorityRequired && agreementStrength < 0.67) {
    conflicts.push({
      type: "SUPERMAJORITY_FAILED",
      severity: "HIGH",
      description: `Supermajority required (67%) but only achieved ${(agreementStrength*100).toFixed(0)}%`,
      affectedProviders: validVotes.filter(v => v.decision !== topDecision).map(v => v.provider),
    });
    
    return {
      consensusDecision: "HOLD",
      consensusConfidence: avgConfidence,
      agreementStrength,
      conflicts,
    };
  }

  return {
    consensusDecision: topDecision,
    consensusConfidence: avgConfidence,
    agreementStrength,
    conflicts,
  };
}

function determineRecommendation(
  consensusDecision: VoteDecision,
  agreementStrength: number,
  conflicts: ConflictInfo[],
  category: DecisionCategory
): { action: VoteDecision; shouldExecute: boolean; reason: string } {
  const hasHighSeverityConflict = conflicts.some(c => c.severity === "HIGH");
  const hasMediumSeverityConflict = conflicts.some(c => c.severity === "MEDIUM");
  
  const isHighStakes = category === "ENTRY" || category === "EXIT";
  
  if (consensusDecision === "ABSTAIN" || consensusDecision === "HOLD") {
    return {
      action: "HOLD",
      shouldExecute: false,
      reason: "Consensus is to hold or abstain - no action needed",
    };
  }

  if (hasHighSeverityConflict) {
    return {
      action: consensusDecision,
      shouldExecute: false,
      reason: `High severity conflicts detected: ${conflicts.filter(c => c.severity === "HIGH").map(c => c.description).join("; ")}`,
    };
  }

  if (isHighStakes && agreementStrength < 0.6) {
    return {
      action: consensusDecision,
      shouldExecute: false,
      reason: `Insufficient agreement (${(agreementStrength*100).toFixed(0)}%) for high-stakes ${category} decision`,
    };
  }

  if (hasMediumSeverityConflict && agreementStrength < 0.55) {
    return {
      action: consensusDecision,
      shouldExecute: false,
      reason: `Medium conflicts with weak agreement (${(agreementStrength*100).toFixed(0)}%)`,
    };
  }

  return {
    action: consensusDecision,
    shouldExecute: true,
    reason: `Strong consensus (${(agreementStrength*100).toFixed(0)}%) for ${consensusDecision}${conflicts.length > 0 ? ` despite minor conflicts` : ""}`,
  };
}

export async function conductEnsembleVote(
  request: EnsembleVoteRequest
): Promise<EnsembleVoteResult> {
  const startTime = Date.now();
  const providers = getAvailableProviders();
  
  const requiredProviders = request.requiredProviders || Math.min(3, providers.length);
  const timeoutMs = request.timeoutMs || 10000;
  const supermajorityRequired = request.supermajorityRequired || false;
  
  if (providers.length < requiredProviders) {
    console.warn(`[ENSEMBLE] Only ${providers.length} providers available, need ${requiredProviders}`);
  }

  const prompt = buildVotingPrompt(request);
  
  console.log(`[ENSEMBLE] Conducting vote for bot ${request.botId}, category ${request.category} with ${providers.length} providers`);

  const votePromises = providers.slice(0, Math.max(requiredProviders, 3)).map(provider =>
    queryProvider(provider, prompt, timeoutMs)
  );

  const votes = await Promise.all(votePromises);

  const { consensusDecision, consensusConfidence, agreementStrength, conflicts } = aggregateVotes(
    votes,
    supermajorityRequired
  );

  const recommendation = determineRecommendation(
    consensusDecision,
    agreementStrength,
    conflicts,
    request.category
  );

  const result: EnsembleVoteResult = {
    botId: request.botId,
    category: request.category,
    consensusDecision,
    consensusConfidence,
    agreementStrength,
    totalVotes: providers.length,
    votesReceived: votes.filter(v => !v.error).length,
    providerVotes: votes,
    conflicts,
    recommendation,
    timestamp: new Date(),
    durationMs: Date.now() - startTime,
  };

  const history = voteHistoryCache.get(request.botId) || [];
  history.push(result);
  if (history.length > 100) history.shift();
  voteHistoryCache.set(request.botId, history);

  console.log(`[ENSEMBLE] Vote complete: ${consensusDecision} (${(agreementStrength*100).toFixed(0)}% agreement, ${conflicts.length} conflicts)`);

  return result;
}

export function updateProviderAccuracy(
  provider: string,
  wasCorrect: boolean,
  confidence: number,
  latencyMs: number
): void {
  const existing = providerAccuracyCache.get(provider) || {
    provider,
    totalVotes: 0,
    correctVotes: 0,
    accuracyRate: 0.5,
    avgConfidence: 0.5,
    avgLatencyMs: 1000,
    lastUpdated: new Date(),
  };

  const decay = 0.95;
  const newTotal = existing.totalVotes * decay + 1;
  const newCorrect = existing.correctVotes * decay + (wasCorrect ? 1 : 0);
  const newAvgConfidence = (existing.avgConfidence * existing.totalVotes * decay + confidence) / newTotal;
  const newAvgLatency = (existing.avgLatencyMs * existing.totalVotes * decay + latencyMs) / newTotal;

  providerAccuracyCache.set(provider, {
    provider,
    totalVotes: newTotal,
    correctVotes: newCorrect,
    accuracyRate: newCorrect / newTotal,
    avgConfidence: newAvgConfidence,
    avgLatencyMs: newAvgLatency,
    lastUpdated: new Date(),
  });
}

export function getProviderAccuracyStats(): ProviderAccuracy[] {
  return Array.from(providerAccuracyCache.values())
    .sort((a, b) => b.accuracyRate - a.accuracyRate);
}

export function getVoteHistory(botId: string): EnsembleVoteResult[] {
  return voteHistoryCache.get(botId) || [];
}

export function getEnsembleHealthStatus(): {
  availableProviders: string[];
  providerStats: ProviderAccuracy[];
  totalVotesLast24h: number;
  avgAgreementStrength: number;
  avgResponseTime: number;
} {
  const providers = getAvailableProviders();
  const stats = getProviderAccuracyStats();
  
  let totalVotes = 0;
  let totalAgreement = 0;
  let totalLatency = 0;
  let voteCount = 0;

  for (const history of voteHistoryCache.values()) {
    for (const vote of history) {
      if (Date.now() - vote.timestamp.getTime() < 24 * 60 * 60 * 1000) {
        totalVotes++;
        totalAgreement += vote.agreementStrength;
        totalLatency += vote.durationMs;
        voteCount++;
      }
    }
  }

  return {
    availableProviders: providers,
    providerStats: stats,
    totalVotesLast24h: totalVotes,
    avgAgreementStrength: voteCount > 0 ? totalAgreement / voteCount : 0,
    avgResponseTime: voteCount > 0 ? totalLatency / voteCount : 0,
  };
}

export async function runEnsembleVotingTests(): Promise<{ passed: boolean; results: string[] }> {
  const results: string[] = [];
  let allPassed = true;

  const mockVotes: ProviderVote[] = [
    { provider: "openai", decision: "BUY", confidence: 0.8, reasoning: "Test", latencyMs: 500, timestamp: new Date() },
    { provider: "anthropic", decision: "BUY", confidence: 0.75, reasoning: "Test", latencyMs: 600, timestamp: new Date() },
    { provider: "groq", decision: "HOLD", confidence: 0.6, reasoning: "Test", latencyMs: 200, timestamp: new Date() },
  ];

  const aggregation = aggregateVotes(mockVotes, false);
  if (aggregation.consensusDecision === "BUY") {
    results.push("PASS: Vote aggregation returns correct consensus");
  } else {
    results.push(`FAIL: Expected BUY, got ${aggregation.consensusDecision}`);
    allPassed = false;
  }

  if (aggregation.agreementStrength > 0.5) {
    results.push("PASS: Agreement strength calculation is positive");
  } else {
    results.push(`FAIL: Agreement strength too low: ${aggregation.agreementStrength}`);
    allPassed = false;
  }

  const splitVotes: ProviderVote[] = [
    { provider: "openai", decision: "BUY", confidence: 0.7, reasoning: "Test", latencyMs: 500, timestamp: new Date() },
    { provider: "anthropic", decision: "SELL", confidence: 0.7, reasoning: "Test", latencyMs: 600, timestamp: new Date() },
    { provider: "groq", decision: "HOLD", confidence: 0.7, reasoning: "Test", latencyMs: 200, timestamp: new Date() },
  ];

  const splitResult = aggregateVotes(splitVotes, false);
  if (splitResult.conflicts.length > 0) {
    results.push("PASS: Split vote detected as conflict");
  } else {
    results.push("FAIL: Split vote should generate conflict");
    allPassed = false;
  }

  const supermajorityVotes: ProviderVote[] = [
    { provider: "openai", decision: "BUY", confidence: 0.6, reasoning: "Test", latencyMs: 500, timestamp: new Date() },
    { provider: "anthropic", decision: "SELL", confidence: 0.6, reasoning: "Test", latencyMs: 600, timestamp: new Date() },
    { provider: "groq", decision: "HOLD", confidence: 0.6, reasoning: "Test", latencyMs: 200, timestamp: new Date() },
  ];

  const supermajorityResult = aggregateVotes(supermajorityVotes, true);
  const supermajorityFailed = supermajorityResult.conflicts.some(c => c.type === "SUPERMAJORITY_FAILED");
  if (supermajorityFailed && supermajorityResult.consensusDecision === "HOLD") {
    results.push("PASS: Supermajority requirement enforced correctly");
  } else {
    results.push("FAIL: Supermajority should fail and return HOLD");
    allPassed = false;
  }

  const recommendation = determineRecommendation("BUY", 0.8, [], "ENTRY");
  if (recommendation.shouldExecute && recommendation.action === "BUY") {
    results.push("PASS: Strong consensus generates executable recommendation");
  } else {
    results.push("FAIL: Strong BUY should be executable");
    allPassed = false;
  }

  const weakRecommendation = determineRecommendation("SELL", 0.4, [], "ENTRY");
  if (!weakRecommendation.shouldExecute) {
    results.push("PASS: Weak agreement blocks high-stakes execution");
  } else {
    results.push("FAIL: Weak agreement should not execute for ENTRY");
    allPassed = false;
  }

  const conflictRecommendation = determineRecommendation("BUY", 0.7, [{
    type: "SPLIT_DECISION",
    severity: "HIGH",
    description: "Test conflict",
    affectedProviders: ["test"],
  }], "ENTRY");
  if (!conflictRecommendation.shouldExecute) {
    results.push("PASS: High severity conflict blocks execution");
  } else {
    results.push("FAIL: High severity conflict should block execution");
    allPassed = false;
  }

  console.log(`[ENSEMBLE_TESTS] ${results.filter(r => r.startsWith("PASS")).length}/${results.length} tests passed`);

  return { passed: allPassed, results };
}

runEnsembleVotingTests().then(({ passed, results }) => {
  console.log("[ENSEMBLE_VOTING] Self-test results:", passed ? "ALL PASSED" : "SOME FAILED");
  results.forEach(r => console.log(`  ${r}`));
});

export const ensembleVotingEngine = {
  conductVote: conductEnsembleVote,
  updateAccuracy: updateProviderAccuracy,
  getAccuracyStats: getProviderAccuracyStats,
  getVoteHistory,
  getHealthStatus: getEnsembleHealthStatus,
  runTests: runEnsembleVotingTests,
};
