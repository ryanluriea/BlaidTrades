import { logActivityEvent } from "./activity-logger";
import type { Bot } from "@shared/schema";
import { researchMonitorWS } from "./research-monitor-ws";
import { db } from "./db";
import { botCostEvents, llmBudgets } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// LLM pricing per 1M tokens (input/output)
const LLM_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-3-5-sonnet-latest": { input: 3.00, output: 15.00 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "grok-beta": { input: 5.00, output: 15.00 },
  "grok-2-1212": { input: 2.00, output: 10.00 },
  "grok-4": { input: 3.00, output: 15.00 },
  "grok-4.1-fast": { input: 2.00, output: 8.00 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0.59, output: 0.79 },
  // Perplexity Sonar models (online search-enabled)
  "sonar": { input: 1.00, output: 1.00 },
  "sonar-pro": { input: 3.00, output: 15.00 },
  "sonar-reasoning": { input: 1.00, output: 5.00 },
  // Legacy models (deprecated but kept for cost tracking)
  "llama-3.1-sonar-small-128k-online": { input: 0.20, output: 0.20 },
  "llama-3.1-sonar-large-128k-online": { input: 1.00, output: 1.00 },
};

interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = LLM_PRICING[model] || { input: 1.0, output: 3.0 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

interface CostEventMetadata {
  model: string;
  cascadeMode?: string;
  cascadePosition?: number;
  fallbackReason?: string;
  suggestionsCount?: number;
  appliedCount?: number;
  generation?: number;
  action?: string;
}

async function logCostEvent(
  botId: string,
  userId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  traceId: string,
  extendedMetadata?: Partial<CostEventMetadata>
): Promise<void> {
  try {
    await db.insert(botCostEvents).values({
      botId,
      userId,
      category: "llm",
      provider,
      eventType: "evolution",
      inputTokens,
      outputTokens,
      costUsd,
      metadata: { 
        model,
        ...extendedMetadata 
      },
      traceId,
    });
  } catch (error) {
    console.error("[COST_TRACKING] Failed to log cost event:", error);
  }
}

async function checkBudgetLimit(userId: string, provider: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const budget = await db.query.llmBudgets.findFirst({
      where: and(
        eq(llmBudgets.userId, userId),
        eq(llmBudgets.provider, provider as any)
      ),
    });
    
    if (!budget) return { allowed: true };
    if (!budget.isEnabled || budget.isPaused) {
      return { allowed: false, reason: `${provider} is disabled or paused` };
    }
    if (budget.isAutoThrottled) {
      return { allowed: false, reason: `${provider} budget exceeded for this month` };
    }
    if ((budget.currentMonthSpendUsd ?? 0) >= (budget.monthlyLimitUsd ?? 10)) {
      await db.update(llmBudgets)
        .set({ isAutoThrottled: true })
        .where(eq(llmBudgets.id, budget.id));
      return { allowed: false, reason: `${provider} monthly budget exceeded` };
    }
    return { allowed: true };
  } catch (error) {
    console.error("[BUDGET_CHECK] Error:", error);
    return { allowed: true };
  }
}

async function updateBudgetSpend(userId: string, provider: string, costUsd: number): Promise<void> {
  try {
    await db.update(llmBudgets)
      .set({ 
        currentMonthSpendUsd: sql`${llmBudgets.currentMonthSpendUsd} + ${costUsd}`,
        updatedAt: new Date()
      })
      .where(and(
        eq(llmBudgets.userId, userId),
        eq(llmBudgets.provider, provider as any)
      ));
  } catch (error) {
    console.error("[BUDGET_UPDATE] Failed to update spend:", error);
  }
}

export interface EvolutionSuggestion {
  type: "PARAMETER_TUNE" | "ENTRY_RULE" | "EXIT_RULE" | "RISK_ADJUSTMENT" | "TIMEFRAME_CHANGE";
  priority: "HIGH" | "MEDIUM" | "LOW";
  description: string;
  rationale: string;
  expectedImpact: string;
  parameters?: Record<string, any>;
}

export interface EvolutionAnalysis {
  botId: string;
  botName: string;
  currentPerformance: {
    winRate: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  suggestions: EvolutionSuggestion[];
  aiProvider: string;
  analysisTimestamp: Date;
}

export type AIProvider = "openai" | "anthropic" | "groq" | "gemini" | "xai" | "perplexity";

interface ProviderConfig {
  url: string;
  envVar: string;
  model: string;
  formatRequest: (prompt: string, apiKey: string) => { headers: Record<string, string>; body: string };
}

import { getStrategyLabState, type PerplexityModel, type SearchRecency } from "./strategy-lab-engine";

const PERPLEXITY_MODELS: Record<PerplexityModel, string> = {
  QUICK: "sonar",
  BALANCED: "sonar-pro",
  DEEP: "sonar-deep-research",
};

const SEARCH_RECENCY_MAP: Record<SearchRecency, string> = {
  HOUR: "hour",
  DAY: "day",
  WEEK: "week",
  MONTH: "month",
  YEAR: "year",
};

function getPerplexityConfig(): { model: string; recency: string } {
  const state = getStrategyLabState();
  return {
    model: PERPLEXITY_MODELS[state.perplexityModel] || "sonar-pro",
    recency: SEARCH_RECENCY_MAP[state.searchRecency] || "month",
  };
}

const AI_PROVIDERS: Record<AIProvider, ProviderConfig> = {
  perplexity: {
    url: "https://api.perplexity.ai/chat/completions",
    envVar: "PERPLEXITY_API_KEY",
    model: "sonar-pro",
    formatRequest: (prompt, apiKey) => {
      const config = getPerplexityConfig();
      return {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: config.model === "sonar-deep-research" ? 8000 : 4000,
          return_citations: true,
          search_recency_filter: config.recency,
        }),
      };
    },
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    envVar: "OPENAI_API_KEY",
    model: "gpt-4o",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    }),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-4-20250514",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    envVar: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 2000,
      }),
    }),
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    envVar: "GOOGLE_GEMINI_API_KEY",
    model: "gemini-2.0-flash",
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
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
        temperature: 0.7,
        max_tokens: 4000,
      }),
    }),
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMOUS AI CASCADE RECOVERY TRACKING
// ═══════════════════════════════════════════════════════════════════════════

interface ProviderHealthState {
  provider: AIProvider;
  consecutiveFailures: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  isHealthy: boolean;
  recoveredAt?: Date;
}

const providerHealthCache = new Map<AIProvider, ProviderHealthState>();

function initProviderHealth(provider: AIProvider): ProviderHealthState {
  return {
    provider,
    consecutiveFailures: 0,
    isHealthy: true,
  };
}

/**
 * Track provider failure for autonomous recovery monitoring
 */
export function trackProviderFailure(provider: AIProvider, error: string): void {
  const state = providerHealthCache.get(provider) || initProviderHealth(provider);
  state.consecutiveFailures++;
  state.lastFailure = new Date();
  state.isHealthy = state.consecutiveFailures < 3; // Mark unhealthy after 3 consecutive failures
  
  providerHealthCache.set(provider, state);
  
  console.warn(`[AI_CASCADE] FAILURE provider=${provider} consecutive=${state.consecutiveFailures} error="${error.substring(0, 100)}"`);
  
  if (!state.isHealthy) {
    console.error(`[AI_CASCADE] PROVIDER_UNHEALTHY provider=${provider} failures=${state.consecutiveFailures} last_failure=${state.lastFailure.toISOString()}`);
  }
}

/**
 * Track provider success for autonomous recovery monitoring  
 */
export function trackProviderSuccess(provider: AIProvider): void {
  const state = providerHealthCache.get(provider) || initProviderHealth(provider);
  const wasUnhealthy = !state.isHealthy;
  
  state.consecutiveFailures = 0;
  state.lastSuccess = new Date();
  state.isHealthy = true;
  
  if (wasUnhealthy) {
    state.recoveredAt = new Date();
    console.log(`[AI_CASCADE] AUTO_RECOVERED provider=${provider} recovered_at=${state.recoveredAt.toISOString()}`);
  }
  
  providerHealthCache.set(provider, state);
}

/**
 * Get AI cascade health summary for system status
 */
export function getAICascadeHealth(): {
  totalProviders: number;
  healthyProviders: number;
  unhealthyProviders: string[];
  recentlyRecovered: string[];
  cascadeReady: boolean;
} {
  const allProviders: AIProvider[] = ["anthropic", "openai", "groq", "gemini", "xai", "perplexity"];
  const configuredProviders = allProviders.filter(p => {
    const config = AI_PROVIDERS[p];
    return config && process.env[config.envVar];
  });
  
  const unhealthyProviders: string[] = [];
  const recentlyRecovered: string[] = [];
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  for (const provider of configuredProviders) {
    const state = providerHealthCache.get(provider);
    if (state) {
      if (!state.isHealthy) {
        unhealthyProviders.push(provider);
      }
      if (state.recoveredAt && state.recoveredAt > oneHourAgo) {
        recentlyRecovered.push(provider);
      }
    }
  }
  
  return {
    totalProviders: configuredProviders.length,
    healthyProviders: configuredProviders.length - unhealthyProviders.length,
    unhealthyProviders,
    recentlyRecovered,
    cascadeReady: configuredProviders.length > 0 && unhealthyProviders.length < configuredProviders.length,
  };
}

// Standard bot evolution cascade (does NOT include Perplexity - that's for Strategy Lab)
function getAvailableProviders(): Array<{ provider: AIProvider; apiKey: string }> {
  // Check global cost efficiency mode setting
  const costEfficiencyMode = (global as any).__costEfficiencyMode === true;
  
  // INSTITUTIONAL: Choose cascade order based on cost efficiency preference
  // Quality-first: Best reasoning models first (Claude → GPT-4 → Groq)
  // Cost-efficient: Groq-only, no fallbacks to expensive providers (institutional cost control)
  const providerOrder: AIProvider[] = costEfficiencyMode
    ? ["groq"]  // STRICT COST EFFICIENCY: Groq only - no expensive fallbacks
    : ["anthropic", "openai", "groq", "gemini", "xai"]; // Quality-first: Claude first
  
  const available: Array<{ provider: AIProvider; apiKey: string }> = [];
  
  for (const provider of providerOrder) {
    const config = AI_PROVIDERS[provider];
    const apiKey = process.env[config.envVar];
    if (apiKey) {
      available.push({ provider, apiKey });
    }
  }
  
  const cascadeMode = costEfficiencyMode ? 'COST_EFFICIENT (Groq-only)' : 'QUALITY_FIRST';
  console.log(`[AI_EVOLUTION] cascade_mode=${cascadeMode} providers=${available.map(p => p.provider).join('→')}`);
  
  return available;
}

// Strategy Lab cascade: Perplexity first for web-grounded research, then Claude for synthesis
export function getStrategyLabProviders(): Array<{ provider: AIProvider; apiKey: string }> {
  // Strategy Lab uses Perplexity for real-time research, then falls back to Claude/GPT for synthesis
  const providerOrder: AIProvider[] = ["perplexity", "anthropic", "openai", "groq", "gemini"];
  
  const available: Array<{ provider: AIProvider; apiKey: string }> = [];
  
  for (const provider of providerOrder) {
    const config = AI_PROVIDERS[provider];
    const apiKey = process.env[config.envVar];
    if (apiKey) {
      available.push({ provider, apiKey });
    }
  }
  
  console.log(`[STRATEGY_LAB] cascade_order=${providerOrder.slice(0, 3).join('→')} available=${available.map(p => p.provider).join(',')}`);
  
  return available;
}

/**
 * Apply AI evolution suggestions to a bot's strategy config
 * Returns the merged strategy config with applied suggestions
 */
export function applyEvolutionSuggestions(
  currentConfig: Record<string, any>,
  suggestions: EvolutionSuggestion[]
): { updatedConfig: Record<string, any>; appliedChanges: string[] } {
  const updatedConfig = { ...currentConfig };
  const appliedChanges: string[] = [];

  for (const suggestion of suggestions) {
    // Only apply HIGH priority suggestions automatically
    if (suggestion.priority !== "HIGH") continue;

    try {
      switch (suggestion.type) {
        case "PARAMETER_TUNE":
          if (suggestion.parameters) {
            for (const [key, value] of Object.entries(suggestion.parameters)) {
              // Safely apply numeric parameters with bounds checking
              if (typeof value === "number") {
                // Apply within reasonable bounds (0.5x to 2x of current or suggestion)
                const current = updatedConfig[key];
                if (typeof current === "number") {
                  const bounded = Math.max(current * 0.5, Math.min(value, current * 2));
                  updatedConfig[key] = bounded;
                  appliedChanges.push(`${key}: ${current} → ${bounded}`);
                } else {
                  updatedConfig[key] = value;
                  appliedChanges.push(`${key}: (new) ${value}`);
                }
              } else {
                updatedConfig[key] = value;
                appliedChanges.push(`${key}: ${value}`);
              }
            }
          }
          break;

        case "RISK_ADJUSTMENT":
          if (suggestion.parameters?.stopLoss) {
            updatedConfig.stopLoss = suggestion.parameters.stopLoss;
            appliedChanges.push(`stopLoss: ${suggestion.parameters.stopLoss}`);
          }
          if (suggestion.parameters?.takeProfit) {
            updatedConfig.takeProfit = suggestion.parameters.takeProfit;
            appliedChanges.push(`takeProfit: ${suggestion.parameters.takeProfit}`);
          }
          if (suggestion.parameters?.positionSize) {
            updatedConfig.positionSize = suggestion.parameters.positionSize;
            appliedChanges.push(`positionSize: ${suggestion.parameters.positionSize}`);
          }
          break;

        case "ENTRY_RULE":
        case "EXIT_RULE":
          // Log but don't auto-apply rule changes (requires more validation)
          appliedChanges.push(`[PENDING] ${suggestion.type}: ${suggestion.description}`);
          break;

        case "TIMEFRAME_CHANGE":
          if (suggestion.parameters?.timeframe) {
            updatedConfig.timeframe = suggestion.parameters.timeframe;
            appliedChanges.push(`timeframe: ${suggestion.parameters.timeframe}`);
          }
          break;
      }
    } catch (error) {
      console.error(`[AI_EVOLUTION] Failed to apply suggestion: ${suggestion.type}`, error);
    }
  }

  return { updatedConfig, appliedChanges };
}

function buildEvolutionPrompt(
  bot: Bot,
  performance: { winRate: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number },
  recentTrades?: number
): string {
  return `You are a quantitative trading strategy optimization expert. Analyze the following trading bot and suggest improvements.

BOT DETAILS:
- Name: ${bot.name}
- Symbol: ${bot.symbol}
- Strategy Archetype: ${(bot as any).category || bot.name.split(" ")[1] || "Unknown"}
- Current Stage: ${bot.stage}

PERFORMANCE METRICS:
- Win Rate: ${(performance.winRate * 100).toFixed(1)}%
- Profit Factor: ${performance.profitFactor.toFixed(2)}
- Sharpe Ratio: ${performance.sharpeRatio.toFixed(2)}
- Max Drawdown: ${performance.maxDrawdown.toFixed(1)}%
- Recent Trades: ${recentTrades || "N/A"}

STRATEGY CONFIG:
${JSON.stringify(bot.strategyConfig || {}, null, 2)}

Based on this analysis, provide 2-4 specific, actionable suggestions to improve the strategy. For each suggestion, provide:
1. Type: PARAMETER_TUNE, ENTRY_RULE, EXIT_RULE, RISK_ADJUSTMENT, or TIMEFRAME_CHANGE
2. Priority: HIGH, MEDIUM, or LOW
3. Description: What to change
4. Rationale: Why this change would help
5. Expected Impact: What improvement to expect

Respond in JSON format:
{
  "suggestions": [
    {
      "type": "PARAMETER_TUNE",
      "priority": "HIGH",
      "description": "...",
      "rationale": "...",
      "expectedImpact": "...",
      "parameters": { "key": "value" }
    }
  ]
}`;
}

interface AIProviderResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

async function callAIProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string
): Promise<AIProviderResponse> {
  const config = AI_PROVIDERS[provider];
  const { headers, body } = config.formatRequest(prompt, apiKey);
  
  // Stream Perplexity research to Research Monitor
  if (provider === "perplexity") {
    const queryPreview = prompt.slice(0, 150).replace(/\n/g, " ");
    researchMonitorWS.logSearch("perplexity", `Strategy research: ${queryPreview}...`);
  }
  
  let url = config.url;
  if (provider === "gemini") {
    url = `${config.url}?key=${apiKey}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`${provider} API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === "anthropic") {
    content = data.content?.[0]?.text || "";
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;
  } else if (provider === "gemini") {
    content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    inputTokens = data.usageMetadata?.promptTokenCount || 0;
    outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
  } else if (provider === "perplexity") {
    // Perplexity uses OpenAI-compatible format but may include citations
    content = data.choices?.[0]?.message?.content || "";
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
    // Citations available in data.citations if needed for Strategy Lab
  } else {
    content = data.choices?.[0]?.message?.content || "";
    inputTokens = data.usage?.prompt_tokens || 0;
    outputTokens = data.usage?.completion_tokens || 0;
  }

  return { content, inputTokens, outputTokens, model: config.model };
}

function parseEvolutionResponse(response: string): EvolutionSuggestion[] {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as { suggestions?: any[] };
    if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) return [];

    return parsed.suggestions.map((s: any) => ({
      type: s.type || "PARAMETER_TUNE",
      priority: s.priority || "MEDIUM",
      description: s.description || "",
      rationale: s.rationale || "",
      expectedImpact: s.expectedImpact || "",
      parameters: s.parameters,
    })).slice(0, 5);
  } catch (error) {
    console.error("[AI_EVOLUTION] Failed to parse response:", error);
    return [];
  }
}

export async function generateEvolutionSuggestions(
  bot: Bot,
  performance: { winRate: number; profitFactor: number; sharpeRatio: number; maxDrawdown: number },
  traceId: string,
  recentTrades?: number,
  userId?: string
): Promise<{ success: boolean; data?: EvolutionAnalysis; error?: string; cost?: LLMUsage }> {
  const availableProviders = getAvailableProviders();
  
  if (availableProviders.length === 0) {
    return { 
      success: false, 
      error: "No AI provider configured (OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, etc.)" 
    };
  }

  const prompt = buildEvolutionPrompt(bot, performance, recentTrades);
  const errors: string[] = [];

  // TRUE CASCADE: Try each provider in sequence until one succeeds
  for (const { provider, apiKey } of availableProviders) {
    // Check budget before making the call
    if (userId) {
      const budgetCheck = await checkBudgetLimit(userId, provider);
      if (!budgetCheck.allowed) {
        console.log(`[AI_EVOLUTION] trace_id=${traceId} provider=${provider} skipped: ${budgetCheck.reason}`);
        errors.push(`${provider}: ${budgetCheck.reason}`);
        continue; // Try next provider
      }
    }

    try {
      console.log(`[AI_EVOLUTION] trace_id=${traceId} bot=${bot.name} provider=${provider}`);

      const aiResponse = await callAIProvider(provider, apiKey, prompt);
      const suggestions = parseEvolutionResponse(aiResponse.content);

      // Calculate cost
      const costUsd = calculateCost(aiResponse.model, aiResponse.inputTokens, aiResponse.outputTokens);
      const usage: LLMUsage = {
        inputTokens: aiResponse.inputTokens,
        outputTokens: aiResponse.outputTokens,
        costUsd,
      };

      // Log cost event with extended metadata (WHY and WHAT)
      if (userId) {
        const isCostEfficient = (global as any).__costEfficiencyMode === true;
        await logCostEvent(
          bot.id,
          userId,
          provider,
          aiResponse.model,
          aiResponse.inputTokens,
          aiResponse.outputTokens,
          costUsd,
          traceId,
          {
            cascadeMode: isCostEfficient ? "COST_EFFICIENT" : "QUALITY_FIRST",
            cascadePosition: errors.length + 1, // Position in cascade (1 = first choice worked)
            fallbackReason: errors.length > 0 ? errors[errors.length - 1] : undefined,
            suggestionsCount: suggestions.length,
            generation: typeof bot.currentGeneration === 'number' ? bot.currentGeneration : parseInt(String(bot.currentGeneration || "1")),
            action: "EVOLUTION_ANALYSIS",
          }
        );
        await updateBudgetSpend(userId, provider, costUsd);
      }

      const analysis: EvolutionAnalysis = {
        botId: bot.id,
        botName: bot.name,
        currentPerformance: performance,
        suggestions,
        aiProvider: provider,
        analysisTimestamp: new Date(),
      };

      await logActivityEvent({
        botId: bot.id,
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: `AI Evolution Analysis (${provider})`,
        summary: `Generated ${suggestions.length} strategy suggestions for ${bot.name}`,
        payload: { 
          provider, 
          suggestionCount: suggestions.length,
          topSuggestion: suggestions[0]?.description,
          cost: costUsd.toFixed(6),
          tokens: { input: aiResponse.inputTokens, output: aiResponse.outputTokens },
          fallbacksAttempted: errors.length,
        },
        traceId,
        symbol: bot.symbol || undefined,
      });

      // AUTONOMOUS: Track success for auto-recovery monitoring
      trackProviderSuccess(provider);
      
      console.log(`[AI_EVOLUTION] trace_id=${traceId} SUCCESS provider=${provider} suggestions=${suggestions.length} cost=$${costUsd.toFixed(6)} fallbacks=${errors.length}`);

      return { success: true, data: analysis, cost: usage };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[AI_EVOLUTION] trace_id=${traceId} provider=${provider} FAILED: ${errorMsg} - trying next provider`);
      errors.push(`${provider}: ${errorMsg}`);
      
      // AUTONOMOUS: Track failure for auto-recovery monitoring
      trackProviderFailure(provider, errorMsg);
      // Continue to next provider in cascade
    }
  }

  // All providers failed
  const allErrors = errors.join("; ");
  console.error(`[AI_EVOLUTION] trace_id=${traceId} ALL_PROVIDERS_FAILED: ${allErrors}`);
  return { success: false, error: `All AI providers failed: ${allErrors}` };
}

export function getHighPrioritySuggestions(analysis: EvolutionAnalysis): EvolutionSuggestion[] {
  return analysis.suggestions.filter(s => s.priority === "HIGH");
}

// ═══════════════════════════════════════════════════════════════════════════
// PERPLEXITY DEEP RESEARCH ENGINE - Strategy Lab Candidate Generation
// ═══════════════════════════════════════════════════════════════════════════

export interface StrategyCandidateEvidence {
  title: string;
  url: string;
  sourceTier: "PRIMARY" | "SECONDARY" | "TERTIARY";
  snippet: string;
  supports: ("hypothesis" | "filter" | "exit" | "risk")[];
}

export interface StrategyCandidateRules {
  entry: string[];
  exit: string[];
  risk: string[];
  filters: string[];
  invalidation: string[];
}

export interface NoveltyJustification {
  closestKnown: string[];
  distinctDeltas: string[];
  whyItMatters: string;
}

export interface DataRequirements {
  required: string[];
  optional: string[];
  proxies: { need: string; proxy: string }[];
}

// Audit trail entry documenting a single scoring factor
export interface ConfidenceAuditEntry {
  factor: string;
  points: number;
  maxPoints: number;
  reason: string;
}

// Component audit with formula documentation
export interface ComponentAudit {
  score: number;
  maxScore: number;
  weight: number;
  weightedContribution: number;
  factors: ConfidenceAuditEntry[];
  formula: string;
}

// Full confidence breakdown with audit trail
export interface ConfidenceBreakdown {
  researchConfidence: number;
  structuralSoundness: number;
  historicalValidation: number;
  regimeRobustness: number;
  researchStrength?: number;
  structuralEdge?: number;
  regimeAlignment?: number;
  riskEfficiency?: number;
  historicalAnalogs?: number;
  executionFeasibility?: number;
  // Audit trail for transparency
  audit?: {
    calculatedAt: string;
    version: string;
    weights: { research: number; structural: number; historical: number; regime: number };
    components: {
      research: ComponentAudit;
      structural: ComponentAudit;
      historical: ComponentAudit;
      regime: ComponentAudit;
    };
    totalFormula: string;
    backtestValidation?: {
      hasBacktestData: boolean;
      sharpeRatio?: number;
      maxDrawdown?: number;
      winRate?: number;
      validationBonus: number;
      validationReason: string;
    };
  };
}

export function getConfidenceTier(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function isDeployable(score: number): boolean {
  return score >= 40;
}

export interface ExpectedBehavior {
  winRate: string | null;
  rewardRiskRatio: string | null;
  tradeFrequency: string | null;
  drawdownProfile: string | null;
}

export interface CandidateExplainers {
  whyThisExists: string;
  howToFalsify: string;
  expectedFailureModes: string[];
  whatToWatch: string[];
  expectedBehavior?: ExpectedBehavior;
}

export interface PlainLanguageSummary {
  what: string;
  how: string;
  when: string;
}

export interface ResearchSourceInsight {
  url: string;
  title: string;
  keyInsight: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
  supportedClaims: string[];
}

export interface ResearchCandidate {
  strategyName: string;
  archetypeId?: string;
  archetypeName?: string;
  entryConditionType?: string;
  instrumentUniverse: string[];
  timeframePreferences: string[];
  sessionModePreference: string;
  hypothesis: string;
  rules: StrategyCandidateRules;
  noveltyJustification: NoveltyJustification;
  dataRequirements: DataRequirements;
  evidence: StrategyCandidateEvidence[];
  confidence: {
    score: number;
    breakdown: ConfidenceBreakdown;
  };
  explainers: CandidateExplainers;
  plainLanguageSummary?: PlainLanguageSummary;
  triggeredByRegime?: string;
  sourceLabFailure?: {
    failureReasonCodes: string[];
    performanceDeltas: Record<string, number>;
    regimeAtFailure: string;
  };
  // AI Research Provenance - captures how AI came to conclusions
  aiReasoning?: string;                    // Plain-language explanation of WHY this strategy
  aiResearchSources?: ResearchSourceInsight[];  // Detailed source insights
  aiSynthesis?: string;                    // Summary of what sources found and how conclusions were reached
  aiProvider?: string;                     // Which AI provider generated this
}

export type RegimeTrigger = 
  | "VOLATILITY_SPIKE"
  | "VOLATILITY_COMPRESSION"
  | "TRENDING_STRONG"
  | "RANGE_BOUND"
  | "LIQUIDITY_THIN"
  | "NEWS_SHOCK"
  | "MACRO_EVENT_CLUSTER"
  | "NONE";

export interface ResearchContext {
  regimeTrigger?: RegimeTrigger;
  regimeSnapshot?: Record<string, any>;
  sourceLabBotId?: string;
  sourceLabFailure?: {
    failureReasonCodes: string[];
    performanceDeltas: Record<string, number>;
    regimeAtFailure: string;
  };
}

const STRATEGY_LAB_RESEARCH_PROMPT = `You are an elite quantitative trading strategy researcher specializing in CME futures (ES, NQ, MES, MNQ).
Your task is to generate PROFITABLE, institutional-grade strategy candidates with proven edges, explicit rules, and rigorous confidence scoring.

PROFITABILITY FOCUS (CRITICAL):
- Only propose strategies with DEMONSTRATED PROFITABILITY in backtests or institutional use
- Target minimum Sharpe Ratio of 1.0+ and Profit Factor of 1.3+
- Favor asymmetric risk/reward setups (minimum 1.5:1 R:R ratio)
- Prioritize strategies with verifiable track records or academic validation
- Focus on strategies that institutional traders actually use

REQUIREMENTS:
1. Each strategy must have EXPLICIT entry/exit/risk rules - no vague language
2. Each strategy must include at least 2 independent sources (URLs) with snippets - prefer institutional research and academic papers
3. Each strategy must have a NOVELTY JUSTIFICATION explaining what makes it distinct
4. Each strategy must include failure modes and invalidation conditions
5. CRITICAL: Strategy names MUST be SHORT (max 25 characters). Use abbreviations like "RTH", "Vol", "Arb", "Momo", "Rev" etc.
6. Include expected performance metrics (target win rate, R:R ratio, trade frequency)

OUTPUT FORMAT (STRICT JSON):
{
  "candidates": [
    {
      "strategy_name": "SHORT NAME (max 25 chars)",
      "archetype_name": "breakout_retest|mean_reversion|trend_following|momentum|range|volatility_breakout|session_transition",
      "entry_condition_type": "...",
      "instrument_universe": ["MES", "MNQ"],
      "timeframe_preferences": ["1m", "5m", "15m"],
      "session_mode_preference": "FULL_24x5|RTH|CUSTOM",
      "hypothesis": "If [condition], then [expected behavior] because [mechanism]",
      "rules": {
        "entry": ["explicit rule 1", "explicit rule 2"],
        "exit": ["explicit rule 1"],
        "risk": ["stop loss at X", "position size Y"],
        "filters": ["only when ATR > Z"],
        "invalidation": ["do not trade when..."]
      },
      "novelty_justification": {
        "closest_known": ["similar strategy names"],
        "distinct_deltas": ["what makes this different"],
        "why_it_matters": "measurable improvement claim"
      },
      "data_requirements": {
        "required": ["OHLCV"],
        "optional": ["volume_profile", "news_sentiment"],
        "proxies": [{"need": "order_flow", "proxy": "volume_delta"}]
      },
      "evidence": [
        {
          "title": "source title",
          "url": "https://...",
          "source_tier": "PRIMARY|SECONDARY|TERTIARY",
          "snippet": "<=25 words quote",
          "supports": ["hypothesis", "filter"]
        }
      ],
      "explainers": {
        "why_this_exists": "mechanism explanation with citations",
        "how_to_falsify": "if X doesn't happen within Y bars, invalidate",
        "expected_failure_modes": ["regime X causes failure"],
        "what_to_watch": ["indicator A crossing B"],
        "expected_behavior": {
          "win_rate": "50-60%",
          "reward_risk_ratio": "1.5:1",
          "trade_frequency": "2-4/day",
          "drawdown_profile": "Low|Medium|High"
        }
      },
      "plain_language_summary": {
        "what": "Plain English description of what market behavior this strategy exploits (1-2 sentences)",
        "how": "Plain English description of how trades are executed (1-2 sentences)",
        "when": "Plain English description of when/conditions for trading (1-2 sentences)"
      }
    }
  ]
}

EDGE CATEGORIES TO EXPLORE (prioritize by profitability):
1. Microstructure edges with PROVEN alpha (opening/closing auction effects, liquidity vacuums)
2. Volatility structure edges with high Sharpe ratios (compression → expansion triggers)
3. Session transition edges used by prop desks (overnight inventory unwind, RTH open impulse)
4. Multi-timeframe confirmation edges (higher timeframe trend + lower timeframe entry)
5. Event-driven edges with asymmetric payoffs (macro catalysts, FOMC reactions)
6. Mean reversion edges with statistical validation (Bollinger extremes, RSI divergences)

OUTPUT REQUIREMENTS:
- 3 "institutional proven" candidates (MUST have documented profitability, high Sharpe potential)
- 1 "optimized classic" candidate (well-known strategy with parameter refinements for current regime)
- 1 "high-conviction experimental" candidate (novel approach with strong theoretical backing)

QUALITY FILTERS (reject candidates that don't meet these):
- Reject strategies with unclear edge mechanics
- Reject strategies without quantifiable exit criteria
- Reject strategies that rely on curve-fitting or overly complex rules
- Reject strategies with win rate < 40% unless R:R is exceptional (3:1+)

Search for recent academic papers, institutional research reports, CME Market Intelligence, and prop trading firm strategies.
Focus on CME futures specifically. No crypto, forex, or equities.
Prioritize strategies that can achieve consistent profitability across market regimes.`;

function buildResearchPrompt(context?: ResearchContext): string {
  let prompt = STRATEGY_LAB_RESEARCH_PROMPT;
  
  if (context?.regimeTrigger && context.regimeTrigger !== "NONE") {
    prompt += `\n\nCURRENT MARKET REGIME: ${context.regimeTrigger}
Generate 3 strategies specifically suited for this regime plus:
- 1 "defensive" strategy (risk-off / reduced exposure)
- 1 "opportunistic" strategy (capture regime-specific opportunities)
Each candidate must explicitly mention triggered_by_regime and why this regime favors the mechanism.`;
  }
  
  if (context?.sourceLabBotId && context?.sourceLabFailure) {
    prompt += `\n\nFAILURE FEEDBACK CONTEXT:
A LAB bot has failed and requires re-research.
- Failure reasons: ${context.sourceLabFailure.failureReasonCodes.join(", ")}
- Performance deltas: ${JSON.stringify(context.sourceLabFailure.performanceDeltas)}
- Regime at failure: ${context.sourceLabFailure.regimeAtFailure}

Generate candidates that:
1. Fix the specific failure mode
2. Explore adjacent archetypes
3. Propose parameter relaxations or structural changes
4. Include explicit linkage to the failed bot's shortcomings`;
  }
  
  return prompt;
}

export function calculateConfidenceScore(
  candidate: Partial<ResearchCandidate>,
  backtestMetrics?: { sharpeRatio?: number; maxDrawdown?: number; winRate?: number }
): ConfidenceBreakdown & { total: number } {
  const WEIGHTS = {
    researchConfidence: 0.30,
    structuralSoundness: 0.25,
    historicalValidation: 0.30,
    regimeRobustness: 0.15,
  };
  
  const breakdown: ConfidenceBreakdown = {
    researchConfidence: 0,
    structuralSoundness: 0,
    historicalValidation: 0,
    regimeRobustness: 0,
  };
  
  // Audit trail collectors
  const researchFactors: ConfidenceAuditEntry[] = [];
  const structuralFactors: ConfidenceAuditEntry[] = [];
  const historicalFactors: ConfidenceAuditEntry[] = [];
  const regimeFactors: ConfidenceAuditEntry[] = [];
  
  const evidence = candidate.evidence || [];
  const rules = candidate.rules;
  const novelty = candidate.noveltyJustification;
  const hypothesis = candidate.hypothesis || "";
  
  const primaryCount = evidence.filter(e => e.sourceTier === "PRIMARY").length;
  const secondaryCount = evidence.filter(e => e.sourceTier === "SECONDARY").length;
  const totalEvidenceCount = evidence.length;
  
  // RESEARCH CONFIDENCE SCORING
  let citationQuality = 0;
  let citationReason = "";
  if (primaryCount >= 2) {
    citationQuality = 30;
    citationReason = `${primaryCount} primary sources provide strong academic backing`;
  } else if (primaryCount >= 1 && secondaryCount >= 1) {
    citationQuality = 25;
    citationReason = `Mix of ${primaryCount} primary + ${secondaryCount} secondary sources`;
  } else if (primaryCount >= 1 || secondaryCount >= 2) {
    citationQuality = 20;
    citationReason = primaryCount >= 1 ? "Single primary source" : `${secondaryCount} secondary sources`;
  } else if (totalEvidenceCount > 0) {
    citationQuality = 10;
    citationReason = `${totalEvidenceCount} unclassified evidence sources`;
  } else {
    citationReason = "No evidence sources provided";
  }
  researchFactors.push({ factor: "Citation Quality", points: citationQuality, maxPoints: 30, reason: citationReason });
  
  let consensusStrength = 0;
  let consensusReason = "";
  if (totalEvidenceCount >= 3 && primaryCount >= 1) {
    consensusStrength = 30;
    consensusReason = `Strong consensus: ${totalEvidenceCount} sources including ${primaryCount} primary`;
  } else if (totalEvidenceCount >= 2) {
    consensusStrength = 20;
    consensusReason = `Moderate consensus from ${totalEvidenceCount} sources`;
  } else if (totalEvidenceCount >= 1) {
    consensusStrength = 10;
    consensusReason = "Single source - limited consensus";
  } else {
    consensusReason = "No sources - cannot assess consensus";
  }
  researchFactors.push({ factor: "Consensus Strength", points: consensusStrength, maxPoints: 30, reason: consensusReason });
  
  let noveltyBonus = 0;
  let noveltyReason = "";
  if (novelty?.distinctDeltas?.length) {
    noveltyBonus = Math.min(novelty.distinctDeltas.length * 10, 20);
    noveltyReason = `${novelty.distinctDeltas.length} distinct innovations identified`;
  } else {
    noveltyReason = "No distinct deltas from known strategies";
  }
  researchFactors.push({ factor: "Novelty Bonus", points: noveltyBonus, maxPoints: 20, reason: noveltyReason });
  
  const mentionsRegime = hypothesis.toLowerCase().includes("regime") || 
    hypothesis.toLowerCase().includes("when") || 
    hypothesis.toLowerCase().includes("during");
  const researchRegimeAlignment = mentionsRegime ? 20 : 10;
  researchFactors.push({ 
    factor: "Regime Alignment", 
    points: researchRegimeAlignment, 
    maxPoints: 20, 
    reason: mentionsRegime ? "Hypothesis explicitly addresses market regimes" : "Hypothesis lacks regime-specific conditions"
  });
  
  breakdown.researchConfidence = Math.min(100, citationQuality + consensusStrength + noveltyBonus + researchRegimeAlignment);
  
  // STRUCTURAL SOUNDNESS SCORING
  let logicalCompleteness = 0;
  let entryExitSymmetry = 0;
  let invalidationClarity = 0;
  let parameterStability = 0;
  
  if (rules) {
    const hasEntry = rules.entry && rules.entry.length > 0;
    const hasExit = rules.exit && rules.exit.length > 0;
    const hasRisk = rules.risk && rules.risk.length > 0;
    const hasInvalidation = rules.invalidation && rules.invalidation.length > 0;
    const hasFilters = rules.filters && rules.filters.length > 0;
    
    if (hasEntry && hasExit && hasRisk && hasInvalidation) {
      logicalCompleteness = 30;
      structuralFactors.push({ factor: "Logical Completeness", points: 30, maxPoints: 30, reason: "Full rule set: entry, exit, risk, invalidation defined" });
    } else if (hasEntry && hasExit && (hasRisk || hasInvalidation)) {
      logicalCompleteness = 20;
      structuralFactors.push({ factor: "Logical Completeness", points: 20, maxPoints: 30, reason: "Partial rules: entry/exit with some risk/invalidation" });
    } else if (hasEntry && hasExit) {
      logicalCompleteness = 10;
      structuralFactors.push({ factor: "Logical Completeness", points: 10, maxPoints: 30, reason: "Basic rules: entry/exit only, no risk management" });
    } else {
      structuralFactors.push({ factor: "Logical Completeness", points: 0, maxPoints: 30, reason: "Incomplete rules: missing entry or exit logic" });
    }
    
    entryExitSymmetry = (hasEntry && hasExit) ? 25 : (hasEntry || hasExit ? 10 : 0);
    structuralFactors.push({ 
      factor: "Entry/Exit Symmetry", 
      points: entryExitSymmetry, 
      maxPoints: 25, 
      reason: (hasEntry && hasExit) ? "Both entry and exit rules defined" : "Asymmetric entry/exit"
    });
    
    invalidationClarity = hasInvalidation ? 25 : 0;
    structuralFactors.push({ 
      factor: "Invalidation Clarity", 
      points: invalidationClarity, 
      maxPoints: 25, 
      reason: hasInvalidation ? "Clear invalidation conditions specified" : "No invalidation rules"
    });
    
    parameterStability = hasFilters ? 20 : (hasRisk ? 15 : 10);
    structuralFactors.push({ 
      factor: "Parameter Stability", 
      points: parameterStability, 
      maxPoints: 20, 
      reason: hasFilters ? "Filter rules provide parameter constraints" : (hasRisk ? "Risk rules provide some stability" : "Minimal parameter constraints")
    });
  } else {
    structuralFactors.push({ factor: "Logical Completeness", points: 0, maxPoints: 30, reason: "No rules object provided" });
    structuralFactors.push({ factor: "Entry/Exit Symmetry", points: 0, maxPoints: 25, reason: "No rules object provided" });
    structuralFactors.push({ factor: "Invalidation Clarity", points: 0, maxPoints: 25, reason: "No rules object provided" });
    structuralFactors.push({ factor: "Parameter Stability", points: 10, maxPoints: 20, reason: "Default minimal stability" });
    parameterStability = 10;
  }
  
  breakdown.structuralSoundness = Math.min(100, logicalCompleteness + entryExitSymmetry + invalidationClarity + parameterStability);
  
  // HISTORICAL VALIDATION SCORING
  let labOutcomes = 0;
  let winRateStability = 0;
  let drawdownProfile = 0;
  let sampleSufficiency = 0;
  
  if (candidate.sourceLabFailure) {
    labOutcomes = 25;
    winRateStability = 20;
    drawdownProfile = 15;
    historicalFactors.push({ factor: "Lab Outcomes", points: labOutcomes, maxPoints: 30, reason: "Strategy derived from LAB failure analysis - higher confidence in problem understanding" });
  } else {
    labOutcomes = 15;
    winRateStability = 15;
    drawdownProfile = 10;
    historicalFactors.push({ factor: "Lab Outcomes", points: labOutcomes, maxPoints: 30, reason: "No LAB failure context - baseline scoring" });
  }
  historicalFactors.push({ factor: "Win Rate Stability", points: winRateStability, maxPoints: 25, reason: candidate.sourceLabFailure ? "Failure context provides win rate insights" : "No historical win rate data" });
  historicalFactors.push({ factor: "Drawdown Profile", points: drawdownProfile, maxPoints: 20, reason: candidate.sourceLabFailure ? "Failure context includes drawdown data" : "No drawdown history" });
  
  if (novelty?.closestKnown?.length) {
    sampleSufficiency = Math.min(novelty.closestKnown.length * 10, 30);
    historicalFactors.push({ factor: "Sample Sufficiency", points: sampleSufficiency, maxPoints: 30, reason: `${novelty.closestKnown.length} similar known strategies provide validation` });
  } else if (evidence.length >= 2) {
    sampleSufficiency = 25;
    historicalFactors.push({ factor: "Sample Sufficiency", points: 25, maxPoints: 30, reason: `${evidence.length} evidence sources support historical validity` });
  } else if (evidence.length >= 1) {
    sampleSufficiency = 15;
    historicalFactors.push({ factor: "Sample Sufficiency", points: 15, maxPoints: 30, reason: "Single evidence source - limited sample" });
  } else {
    sampleSufficiency = 10;
    historicalFactors.push({ factor: "Sample Sufficiency", points: 10, maxPoints: 30, reason: "No evidence - minimal sample sufficiency" });
  }
  
  breakdown.historicalValidation = Math.min(100, labOutcomes + winRateStability + drawdownProfile + sampleSufficiency);
  
  // REGIME ROBUSTNESS SCORING
  let crossRegimePerformance = 0;
  let volatilitySensitivity = 0;
  let liquiditySensitivity = 0;
  
  const hasCausalHypothesis = hypothesis.includes("because") || hypothesis.includes("due to");
  const mentionsVolatility = hypothesis.toLowerCase().includes("volatility") || hypothesis.toLowerCase().includes("vol");
  const mentionsLiquidity = hypothesis.toLowerCase().includes("liquidity") || hypothesis.toLowerCase().includes("volume");
  
  if (hasCausalHypothesis && mentionsRegime) {
    crossRegimePerformance = 40;
    regimeFactors.push({ factor: "Cross-Regime Performance", points: 40, maxPoints: 40, reason: "Causal hypothesis with explicit regime conditions" });
  } else if (hasCausalHypothesis || mentionsRegime) {
    crossRegimePerformance = 25;
    regimeFactors.push({ factor: "Cross-Regime Performance", points: 25, maxPoints: 40, reason: hasCausalHypothesis ? "Causal hypothesis without regime specificity" : "Regime mention without causal explanation" });
  } else if (hypothesis.length > 50) {
    crossRegimePerformance = 15;
    regimeFactors.push({ factor: "Cross-Regime Performance", points: 15, maxPoints: 40, reason: "Detailed hypothesis but no regime or causal analysis" });
  } else {
    crossRegimePerformance = 10;
    regimeFactors.push({ factor: "Cross-Regime Performance", points: 10, maxPoints: 40, reason: "Brief hypothesis lacking regime context" });
  }
  
  volatilitySensitivity = mentionsVolatility ? 30 : 15;
  regimeFactors.push({ factor: "Volatility Sensitivity", points: volatilitySensitivity, maxPoints: 30, reason: mentionsVolatility ? "Strategy addresses volatility conditions" : "No volatility awareness in hypothesis" });
  
  liquiditySensitivity = mentionsLiquidity ? 30 : 15;
  regimeFactors.push({ factor: "Liquidity Sensitivity", points: liquiditySensitivity, maxPoints: 30, reason: mentionsLiquidity ? "Strategy addresses liquidity/volume conditions" : "No liquidity awareness in hypothesis" });
  
  breakdown.regimeRobustness = Math.min(100, crossRegimePerformance + volatilitySensitivity + liquiditySensitivity);
  
  // BACKTEST VALIDATION BONUS (when available)
  let backtestValidationBonus = 0;
  let backtestReason = "No backtest data available";
  if (backtestMetrics) {
    const { sharpeRatio, maxDrawdown, winRate } = backtestMetrics;
    if (sharpeRatio !== undefined && sharpeRatio > 1.5) backtestValidationBonus += 5;
    if (maxDrawdown !== undefined && maxDrawdown < 15) backtestValidationBonus += 5;
    if (winRate !== undefined && winRate > 50) backtestValidationBonus += 5;
    backtestReason = `Backtest metrics: Sharpe=${sharpeRatio?.toFixed(2) || "N/A"}, MaxDD=${maxDrawdown?.toFixed(1) || "N/A"}%, WinRate=${winRate?.toFixed(1) || "N/A"}%`;
  }
  
  const rawTotal = 
    breakdown.researchConfidence * WEIGHTS.researchConfidence +
    breakdown.structuralSoundness * WEIGHTS.structuralSoundness +
    breakdown.historicalValidation * WEIGHTS.historicalValidation +
    breakdown.regimeRobustness * WEIGHTS.regimeRobustness +
    backtestValidationBonus;
  
  const total = Math.round(Math.min(rawTotal, 100));
  
  // Build audit trail
  breakdown.audit = {
    calculatedAt: new Date().toISOString(),
    version: "2.0.0",
    weights: { 
      research: WEIGHTS.researchConfidence, 
      structural: WEIGHTS.structuralSoundness, 
      historical: WEIGHTS.historicalValidation, 
      regime: WEIGHTS.regimeRobustness 
    },
    components: {
      research: {
        score: breakdown.researchConfidence,
        maxScore: 100,
        weight: WEIGHTS.researchConfidence,
        weightedContribution: Math.round(breakdown.researchConfidence * WEIGHTS.researchConfidence),
        factors: researchFactors,
        formula: "min(100, citationQuality + consensusStrength + noveltyBonus + regimeAlignment)"
      },
      structural: {
        score: breakdown.structuralSoundness,
        maxScore: 100,
        weight: WEIGHTS.structuralSoundness,
        weightedContribution: Math.round(breakdown.structuralSoundness * WEIGHTS.structuralSoundness),
        factors: structuralFactors,
        formula: "min(100, logicalCompleteness + entryExitSymmetry + invalidationClarity + parameterStability)"
      },
      historical: {
        score: breakdown.historicalValidation,
        maxScore: 100,
        weight: WEIGHTS.historicalValidation,
        weightedContribution: Math.round(breakdown.historicalValidation * WEIGHTS.historicalValidation),
        factors: historicalFactors,
        formula: "min(100, labOutcomes + winRateStability + drawdownProfile + sampleSufficiency)"
      },
      regime: {
        score: breakdown.regimeRobustness,
        maxScore: 100,
        weight: WEIGHTS.regimeRobustness,
        weightedContribution: Math.round(breakdown.regimeRobustness * WEIGHTS.regimeRobustness),
        factors: regimeFactors,
        formula: "min(100, crossRegimePerformance + volatilitySensitivity + liquiditySensitivity)"
      }
    },
    totalFormula: "research*0.30 + structural*0.25 + historical*0.30 + regime*0.15 + backtestBonus",
    backtestValidation: {
      hasBacktestData: !!backtestMetrics,
      sharpeRatio: backtestMetrics?.sharpeRatio,
      maxDrawdown: backtestMetrics?.maxDrawdown,
      winRate: backtestMetrics?.winRate,
      validationBonus: backtestValidationBonus,
      validationReason: backtestReason
    }
  };
  
  breakdown.researchStrength = breakdown.researchConfidence;
  breakdown.structuralEdge = breakdown.structuralSoundness;
  breakdown.regimeAlignment = breakdown.regimeRobustness;
  breakdown.riskEfficiency = Math.round((breakdown.structuralSoundness + breakdown.historicalValidation) / 2);
  breakdown.historicalAnalogs = breakdown.historicalValidation;
  breakdown.executionFeasibility = breakdown.structuralSoundness;
  
  return { ...breakdown, total };
}

// Regime-aware re-ranking: adjust confidence scores based on current market conditions
export interface RegimeScoreAdjustment {
  originalScore: number;
  adjustedScore: number;
  regimeBonus: number;
  regimeMatch: "OPTIMAL" | "FAVORABLE" | "NEUTRAL" | "UNFAVORABLE";
  reason: string;
}

const DEFAULT_REGIME_AFFINITY: Record<RegimeTrigger, number> = {
  "VOLATILITY_SPIKE": 0,
  "VOLATILITY_COMPRESSION": 0,
  "TRENDING_STRONG": 0,
  "RANGE_BOUND": 0,
  "LIQUIDITY_THIN": 0,
  "NEWS_SHOCK": 0,
  "MACRO_EVENT_CLUSTER": 0,
  "NONE": 0,
};

const ARCHETYPE_REGIME_AFFINITY: Record<string, Record<RegimeTrigger, number>> = {
  "breakout_retest": {
    "VOLATILITY_SPIKE": 15,
    "VOLATILITY_COMPRESSION": -10,
    "TRENDING_STRONG": 20,
    "RANGE_BOUND": -15,
    "LIQUIDITY_THIN": 5,
    "NEWS_SHOCK": 10,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "mean_reversion": {
    "VOLATILITY_SPIKE": -10,
    "VOLATILITY_COMPRESSION": 5,
    "TRENDING_STRONG": -20,
    "RANGE_BOUND": 25,
    "LIQUIDITY_THIN": -10,
    "NEWS_SHOCK": -15,
    "MACRO_EVENT_CLUSTER": -10,
    "NONE": 0,
  },
  "trend_following": {
    "VOLATILITY_SPIKE": 10,
    "VOLATILITY_COMPRESSION": -15,
    "TRENDING_STRONG": 25,
    "RANGE_BOUND": -25,
    "LIQUIDITY_THIN": 0,
    "NEWS_SHOCK": 5,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "momentum": {
    "VOLATILITY_SPIKE": 20,
    "VOLATILITY_COMPRESSION": -10,
    "TRENDING_STRONG": 20,
    "RANGE_BOUND": -15,
    "LIQUIDITY_THIN": -5,
    "NEWS_SHOCK": 15,
    "MACRO_EVENT_CLUSTER": 10,
    "NONE": 0,
  },
  "range": {
    "VOLATILITY_SPIKE": -15,
    "VOLATILITY_COMPRESSION": 10,
    "TRENDING_STRONG": -20,
    "RANGE_BOUND": 25,
    "LIQUIDITY_THIN": 0,
    "NEWS_SHOCK": -20,
    "MACRO_EVENT_CLUSTER": -10,
    "NONE": 0,
  },
  "volatility_breakout": {
    "VOLATILITY_SPIKE": 25,
    "VOLATILITY_COMPRESSION": 15,
    "TRENDING_STRONG": 10,
    "RANGE_BOUND": -10,
    "LIQUIDITY_THIN": 5,
    "NEWS_SHOCK": 20,
    "MACRO_EVENT_CLUSTER": 15,
    "NONE": 0,
  },
  "session_transition": {
    "VOLATILITY_SPIKE": 10,
    "VOLATILITY_COMPRESSION": 5,
    "TRENDING_STRONG": 10,
    "RANGE_BOUND": 5,
    "LIQUIDITY_THIN": -10,
    "NEWS_SHOCK": 5,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "liquidity_trap": {
    "VOLATILITY_SPIKE": 15,
    "VOLATILITY_COMPRESSION": -5,
    "TRENDING_STRONG": 5,
    "RANGE_BOUND": 10,
    "LIQUIDITY_THIN": 25,
    "NEWS_SHOCK": 10,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "open_drive": {
    "VOLATILITY_SPIKE": 20,
    "VOLATILITY_COMPRESSION": -10,
    "TRENDING_STRONG": 15,
    "RANGE_BOUND": -10,
    "LIQUIDITY_THIN": 5,
    "NEWS_SHOCK": 10,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "structure_break": {
    "VOLATILITY_SPIKE": 20,
    "VOLATILITY_COMPRESSION": -5,
    "TRENDING_STRONG": 15,
    "RANGE_BOUND": -15,
    "LIQUIDITY_THIN": 10,
    "NEWS_SHOCK": 15,
    "MACRO_EVENT_CLUSTER": 10,
    "NONE": 0,
  },
  "gap_fade": {
    "VOLATILITY_SPIKE": 10,
    "VOLATILITY_COMPRESSION": 5,
    "TRENDING_STRONG": -10,
    "RANGE_BOUND": 15,
    "LIQUIDITY_THIN": 0,
    "NEWS_SHOCK": 5,
    "MACRO_EVENT_CLUSTER": 0,
    "NONE": 0,
  },
  "tick_scalper": {
    "VOLATILITY_SPIKE": 15,
    "VOLATILITY_COMPRESSION": -15,
    "TRENDING_STRONG": 10,
    "RANGE_BOUND": 5,
    "LIQUIDITY_THIN": -20,
    "NEWS_SHOCK": 10,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "vwap_reversion": {
    "VOLATILITY_SPIKE": -5,
    "VOLATILITY_COMPRESSION": 10,
    "TRENDING_STRONG": -15,
    "RANGE_BOUND": 20,
    "LIQUIDITY_THIN": -10,
    "NEWS_SHOCK": -10,
    "MACRO_EVENT_CLUSTER": -5,
    "NONE": 0,
  },
  "atr_expansion": {
    "VOLATILITY_SPIKE": 25,
    "VOLATILITY_COMPRESSION": 10,
    "TRENDING_STRONG": 15,
    "RANGE_BOUND": -10,
    "LIQUIDITY_THIN": 5,
    "NEWS_SHOCK": 20,
    "MACRO_EVENT_CLUSTER": 15,
    "NONE": 0,
  },
  "bollinger_squeeze": {
    "VOLATILITY_SPIKE": 10,
    "VOLATILITY_COMPRESSION": 25,
    "TRENDING_STRONG": 5,
    "RANGE_BOUND": 15,
    "LIQUIDITY_THIN": 0,
    "NEWS_SHOCK": 5,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
  "rsi_divergence": {
    "VOLATILITY_SPIKE": 5,
    "VOLATILITY_COMPRESSION": 10,
    "TRENDING_STRONG": -10,
    "RANGE_BOUND": 20,
    "LIQUIDITY_THIN": -5,
    "NEWS_SHOCK": -5,
    "MACRO_EVENT_CLUSTER": 0,
    "NONE": 0,
  },
  "order_flow": {
    "VOLATILITY_SPIKE": 15,
    "VOLATILITY_COMPRESSION": 0,
    "TRENDING_STRONG": 15,
    "RANGE_BOUND": 5,
    "LIQUIDITY_THIN": -15,
    "NEWS_SHOCK": 10,
    "MACRO_EVENT_CLUSTER": 10,
    "NONE": 0,
  },
  "delta_divergence": {
    "VOLATILITY_SPIKE": 10,
    "VOLATILITY_COMPRESSION": 5,
    "TRENDING_STRONG": 10,
    "RANGE_BOUND": 10,
    "LIQUIDITY_THIN": -10,
    "NEWS_SHOCK": 5,
    "MACRO_EVENT_CLUSTER": 5,
    "NONE": 0,
  },
};

export function calculateRegimeAdjustedScore(
  archetypeName: string,
  originalScore: number,
  currentRegime: RegimeTrigger
): RegimeScoreAdjustment {
  const normalizedArchetype = archetypeName?.toLowerCase().replace(/[^a-z_]/g, "_") || "unknown";
  const affinityMap = ARCHETYPE_REGIME_AFFINITY[normalizedArchetype] || DEFAULT_REGIME_AFFINITY;
  const regimeBonus = affinityMap[currentRegime] ?? 0;
  
  const adjustedScore = Math.min(100, Math.max(0, originalScore + regimeBonus));
  
  let regimeMatch: "OPTIMAL" | "FAVORABLE" | "NEUTRAL" | "UNFAVORABLE";
  let reason: string;
  
  if (regimeBonus >= 20) {
    regimeMatch = "OPTIMAL";
    reason = `${archetypeName} strategies excel in ${currentRegime.replace(/_/g, " ").toLowerCase()} conditions`;
  } else if (regimeBonus >= 5) {
    regimeMatch = "FAVORABLE";
    reason = `${archetypeName} strategies perform well in ${currentRegime.replace(/_/g, " ").toLowerCase()} conditions`;
  } else if (regimeBonus >= -5) {
    regimeMatch = "NEUTRAL";
    reason = `${archetypeName} strategies are unaffected by ${currentRegime.replace(/_/g, " ").toLowerCase()} conditions`;
  } else {
    regimeMatch = "UNFAVORABLE";
    reason = `${archetypeName} strategies may underperform in ${currentRegime.replace(/_/g, " ").toLowerCase()} conditions`;
  }
  
  return {
    originalScore,
    adjustedScore,
    regimeBonus,
    regimeMatch,
    reason,
  };
}

// Archetype-based expected behavior defaults (used when AI doesn't provide)
const ARCHETYPE_EXPECTED_BEHAVIOR: Record<string, ExpectedBehavior> = {
  "breakout_retest": { winRate: "45-55%", rewardRiskRatio: "2.0:1", tradeFrequency: "2-4/day", drawdownProfile: "Medium" },
  "mean_reversion": { winRate: "55-65%", rewardRiskRatio: "1.2:1", tradeFrequency: "3-6/day", drawdownProfile: "Low" },
  "trend_following": { winRate: "35-45%", rewardRiskRatio: "2.5:1", tradeFrequency: "1-3/day", drawdownProfile: "Medium" },
  "momentum": { winRate: "50-60%", rewardRiskRatio: "1.8:1", tradeFrequency: "3-5/day", drawdownProfile: "Medium" },
  "range": { winRate: "55-65%", rewardRiskRatio: "1.3:1", tradeFrequency: "4-8/day", drawdownProfile: "Low" },
  "volatility_breakout": { winRate: "40-50%", rewardRiskRatio: "2.2:1", tradeFrequency: "1-3/day", drawdownProfile: "High" },
  "session_transition": { winRate: "50-60%", rewardRiskRatio: "1.5:1", tradeFrequency: "2-4/day", drawdownProfile: "Medium" },
  "microstructure": { winRate: "60-70%", rewardRiskRatio: "1.2:1", tradeFrequency: "5-10/day", drawdownProfile: "Low" },
  "event_driven": { winRate: "45-55%", rewardRiskRatio: "2.0:1", tradeFrequency: "1-2/day", drawdownProfile: "High" },
  "scalping": { winRate: "55-65%", rewardRiskRatio: "1.1:1", tradeFrequency: "10-20/day", drawdownProfile: "Low" },
  "swing": { winRate: "40-50%", rewardRiskRatio: "2.5:1", tradeFrequency: "1-2/week", drawdownProfile: "Medium" },
  "arbitrage": { winRate: "70-80%", rewardRiskRatio: "1.0:1", tradeFrequency: "5-15/day", drawdownProfile: "Low" },
};

function parseExpectedBehavior(raw: any, archetypeName?: string): ExpectedBehavior {
  // If AI provided expected_behavior, parse and validate it
  if (raw && typeof raw === "object") {
    return {
      winRate: raw.win_rate || raw.winRate || null,
      rewardRiskRatio: raw.reward_risk_ratio || raw.rewardRiskRatio || raw.rr || null,
      tradeFrequency: raw.trade_frequency || raw.tradeFrequency || null,
      drawdownProfile: normalizeDrawdownProfile(raw.drawdown_profile || raw.drawdownProfile),
    };
  }
  
  // Fall back to archetype-based defaults if no AI-provided data
  const normalizedArchetype = archetypeName?.toLowerCase().replace(/[^a-z_]/g, "_") || "";
  const archetypeDefault = ARCHETYPE_EXPECTED_BEHAVIOR[normalizedArchetype];
  
  if (archetypeDefault) {
    console.log(`[EXPECTED_BEHAVIOR] Using archetype defaults for ${normalizedArchetype}`);
    return archetypeDefault;
  }
  
  // No data available - return nulls
  return {
    winRate: null,
    rewardRiskRatio: null,
    tradeFrequency: null,
    drawdownProfile: null,
  };
}

function normalizeDrawdownProfile(value: any): string | null {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  if (lower.includes("low") || lower.includes("conservative")) return "Low";
  if (lower.includes("medium") || lower.includes("moderate")) return "Medium";
  if (lower.includes("high") || lower.includes("aggressive")) return "High";
  return value; // Return as-is if can't normalize
}

function extractDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 50);
  }
}

function buildAIReasoning(candidate: ResearchCandidate): string {
  const parts: string[] = [];
  
  if (candidate.explainers?.whyThisExists) {
    parts.push(`Strategy Foundation: ${candidate.explainers.whyThisExists}`);
  }
  
  if (candidate.noveltyJustification?.whyItMatters) {
    parts.push(`Uniqueness: ${candidate.noveltyJustification.whyItMatters}`);
  }
  
  if (candidate.hypothesis) {
    parts.push(`Core Hypothesis: ${candidate.hypothesis}`);
  }
  
  if (candidate.confidence?.breakdown) {
    const topFactors = Object.entries(candidate.confidence.breakdown)
      .filter(([_, v]) => v > 15)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').trim()}: ${v}%`);
    if (topFactors.length > 0) {
      parts.push(`Key Confidence Drivers: ${topFactors.join(', ')}`);
    }
  }
  
  return parts.join(' | ') || 'AI-generated strategy based on web-grounded research.';
}

function buildAISynthesis(candidate: ResearchCandidate, citations: string[]): string {
  const sourceCount = citations.length;
  const evidenceCount = candidate.evidence?.length || 0;
  const archetype = candidate.archetypeName || 'custom';
  const instruments = candidate.instrumentUniverse?.join(', ') || 'futures';
  
  let synthesis = `Analyzed ${Math.max(sourceCount, evidenceCount)} research sources for ${archetype} strategy on ${instruments}. `;
  
  if (candidate.explainers?.expectedFailureModes?.length) {
    synthesis += `Identified ${candidate.explainers.expectedFailureModes.length} potential failure modes. `;
  }
  
  if (candidate.confidence?.score) {
    synthesis += `Confidence: ${candidate.confidence.score}% based on research strength, structural soundness, and regime alignment.`;
  }
  
  return synthesis;
}

function extractCleanJSON(rawContent: string): string | null {
  let content = rawContent.trim();
  let sanitized = false;
  
  // Step 1: Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
    sanitized = true;
  }
  
  // Step 2: Remove any leading prose/text before JSON starts
  // Look for first { or [ character
  const jsonStartObj = content.indexOf('{');
  const jsonStartArr = content.indexOf('[');
  
  let jsonStart = -1;
  if (jsonStartObj >= 0 && jsonStartArr >= 0) {
    jsonStart = Math.min(jsonStartObj, jsonStartArr);
  } else if (jsonStartObj >= 0) {
    jsonStart = jsonStartObj;
  } else if (jsonStartArr >= 0) {
    jsonStart = jsonStartArr;
  }
  
  if (jsonStart > 0) {
    const leadingText = content.slice(0, jsonStart).trim();
    if (leadingText.length > 0) {
      console.log(`[STRATEGY_LAB] Stripped ${leadingText.length} chars of leading prose before JSON`);
      sanitized = true;
    }
    content = content.slice(jsonStart);
  }
  
  if (jsonStart < 0) {
    return null;
  }
  
  // Step 3: Find the balanced JSON structure (object or array)
  const startChar = content[0];
  const endChar = startChar === '{' ? '}' : ']';
  
  let depth = 0;
  let inString = false;
  let escaped = false;
  let jsonEnd = -1;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === startChar) {
        depth++;
      } else if (char === endChar) {
        depth--;
        if (depth === 0) {
          jsonEnd = i + 1;
          break;
        }
      }
    }
  }
  
  if (jsonEnd > 0) {
    const result = content.slice(0, jsonEnd);
    if (sanitized) {
      console.log(`[STRATEGY_LAB] JSON sanitization applied - extracted ${result.length} chars of clean JSON`);
    }
    return result;
  }
  
  // SELF-HEALING: Attempt to repair truncated JSON by closing unclosed braces/brackets
  if (depth > 0 && depth <= 10) {
    console.warn(`[STRATEGY_LAB] JSON truncated (depth=${depth}), attempting repair...`);
    
    // Track what needs to be closed by re-scanning with proper string/escape tracking
    let repairContent = content;
    const bracketStack: string[] = [];
    let repairInString = false;
    let repairEscaped = false;
    
    for (let i = 0; i < repairContent.length; i++) {
      const char = repairContent[i];
      
      // Handle escape sequences - escape flag applies to the NEXT character
      if (repairEscaped) {
        repairEscaped = false;
        continue;
      }
      
      // Backslash starts an escape sequence only inside strings
      if (char === '\\' && repairInString) {
        repairEscaped = true;
        continue;
      }
      
      // Toggle string state on unescaped quotes
      if (char === '"') {
        repairInString = !repairInString;
        continue;
      }
      
      // Only track brackets when OUTSIDE of strings (handles URLs with {/} in them)
      if (!repairInString) {
        if (char === '{') bracketStack.push('}');
        else if (char === '[') bracketStack.push(']');
        else if (char === '}' || char === ']') bracketStack.pop();
      }
    }
    
    // Log repair diagnostics
    console.log(`[STRATEGY_LAB] Repair state: inString=${repairInString} escaped=${repairEscaped} unclosedBrackets=${bracketStack.length}`);
    
    // Strategy: Try multiple repair approaches
    const repairAttempts: { description: string; content: string }[] = [];
    
    // APPROACH 1: Close unterminated string and add null value if needed for keys
    let approach1 = repairContent;
    if (repairInString) {
      approach1 += '"';
      // If next closer is }, we might have closed a key without value - add null
      if (bracketStack.length > 0 && bracketStack[bracketStack.length - 1] === '}') {
        approach1 += ': null';
      }
    }
    // Remove trailing comma or colon
    let a1LastChar = approach1.trim().slice(-1);
    if (a1LastChar === ',' || a1LastChar === ':') {
      approach1 = approach1.trimEnd().slice(0, -1);
    }
    // Close brackets
    for (let i = bracketStack.length - 1; i >= 0; i--) {
      approach1 += bracketStack[i];
    }
    repairAttempts.push({ description: 'close_string_with_null', content: approach1 });
    
    // APPROACH 2: Truncate to last complete element (find last }, ] or complete value)
    // Find the last valid JSON boundary before truncation
    let lastValidIdx = -1;
    let scanInString = false;
    let scanEscaped = false;
    for (let i = 0; i < repairContent.length; i++) {
      const c = repairContent[i];
      if (scanEscaped) { scanEscaped = false; continue; }
      if (c === '\\' && scanInString) { scanEscaped = true; continue; }
      if (c === '"') { scanInString = !scanInString; continue; }
      if (!scanInString) {
        // Track positions after complete elements
        if (c === '}' || c === ']' || c === ',') {
          lastValidIdx = i;
        }
      }
    }
    
    if (lastValidIdx > repairContent.length / 2) {
      let approach2 = repairContent.slice(0, lastValidIdx + 1);
      // Recompute brackets for truncated content
      const stack2: string[] = [];
      let s2InString = false;
      let s2Escaped = false;
      for (let i = 0; i < approach2.length; i++) {
        const c = approach2[i];
        if (s2Escaped) { s2Escaped = false; continue; }
        if (c === '\\' && s2InString) { s2Escaped = true; continue; }
        if (c === '"') { s2InString = !s2InString; continue; }
        if (!s2InString) {
          if (c === '{') stack2.push('}');
          else if (c === '[') stack2.push(']');
          else if (c === '}' || c === ']') stack2.pop();
        }
      }
      // Remove trailing comma
      let a2LastChar = approach2.trim().slice(-1);
      if (a2LastChar === ',') {
        approach2 = approach2.trimEnd().slice(0, -1);
      }
      // Close remaining brackets
      for (let i = stack2.length - 1; i >= 0; i--) {
        approach2 += stack2[i];
      }
      repairAttempts.push({ description: 'truncate_to_last_valid', content: approach2 });
    }
    
    // APPROACH 3: Just close brackets (no string close - in case string wasn't actually open)
    let approach3 = repairContent;
    let a3LastChar = approach3.trim().slice(-1);
    if (a3LastChar === ',' || a3LastChar === ':') {
      approach3 = approach3.trimEnd().slice(0, -1);
    }
    for (let i = bracketStack.length - 1; i >= 0; i--) {
      approach3 += bracketStack[i];
    }
    repairAttempts.push({ description: 'close_brackets_only', content: approach3 });
    
    // Try each approach until one works
    for (const attempt of repairAttempts) {
      try {
        JSON.parse(attempt.content);
        console.log(`[STRATEGY_LAB] JSON repair SUCCESS (${attempt.description}) - result ${attempt.content.length} chars`);
        return attempt.content;
      } catch (e) {
        // Continue to next approach
      }
    }
    
    // All approaches failed
    console.error(`[STRATEGY_LAB] JSON repair FAILED: All ${repairAttempts.length} approaches failed`);
    console.error(`[STRATEGY_LAB] Repair attempt last 100 chars: ${repairAttempts[0]?.content.slice(-100) || 'none'}`);
  }
  
  // DEBUG: Log why extraction failed
  console.error(`[STRATEGY_LAB] JSON extraction failed: depth=${depth} jsonStart=${jsonStart} content_len=${content.length}`);
  console.error(`[STRATEGY_LAB] Last 200 chars: ${content.slice(-200)}`);
  
  return null;
}

function parseResearchResponse(response: string, citations?: string[]): ResearchCandidate[] {
  try {
    // Log response length for diagnostics
    console.log(`[STRATEGY_LAB] Parsing response: ${response.length} chars`);
    
    // Use robust JSON extraction that handles markdown fences, leading prose, etc.
    const cleanJson = extractCleanJSON(response);
    if (!cleanJson) {
      console.error("[STRATEGY_LAB] No valid JSON found in research response");
      console.error(`[STRATEGY_LAB] Response preview (first 500 chars): ${response.slice(0, 500)}`);
      return [];
    }
    
    let parsed: { candidates?: any[] } | any[];
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error(`[STRATEGY_LAB] JSON parse error: ${parseErr instanceof Error ? parseErr.message : 'Unknown'}`);
      console.error(`[STRATEGY_LAB] Clean JSON preview (first 500 chars): ${cleanJson.slice(0, 500)}`);
      return [];
    }
    
    // Handle both formats: {candidates: [...]} or direct array [...]
    let candidatesArray: any[];
    if (Array.isArray(parsed)) {
      candidatesArray = parsed;
      console.log(`[STRATEGY_LAB] Parsed direct array with ${candidatesArray.length} items`);
    } else if (parsed.candidates && Array.isArray(parsed.candidates)) {
      candidatesArray = parsed.candidates;
      console.log(`[STRATEGY_LAB] Found ${candidatesArray.length} raw candidates in object`);
    } else {
      console.error("[STRATEGY_LAB] No candidates array in parsed response");
      console.error(`[STRATEGY_LAB] Parsed keys: ${Object.keys(parsed).join(', ')}`);
      return [];
    }
    
    const mapped = candidatesArray.map((c: any) => {
      const candidate: ResearchCandidate = {
        strategyName: c.strategy_name || c.strategyName || "Unnamed Strategy",
        archetypeName: c.archetype_name || c.archetypeName,
        entryConditionType: c.entry_condition_type || c.entryConditionType,
        instrumentUniverse: c.instrument_universe || c.instrumentUniverse || ["MES", "MNQ"],
        timeframePreferences: c.timeframe_preferences || c.timeframePreferences || ["5m"],
        sessionModePreference: c.session_mode_preference || c.sessionModePreference || "FULL_24x5",
        hypothesis: c.hypothesis || "",
        rules: {
          entry: c.rules?.entry || [],
          exit: c.rules?.exit || [],
          risk: c.rules?.risk || [],
          filters: c.rules?.filters || [],
          invalidation: c.rules?.invalidation || [],
        },
        noveltyJustification: {
          closestKnown: c.novelty_justification?.closest_known || c.noveltyJustification?.closestKnown || [],
          distinctDeltas: c.novelty_justification?.distinct_deltas || c.noveltyJustification?.distinctDeltas || [],
          whyItMatters: c.novelty_justification?.why_it_matters || c.noveltyJustification?.whyItMatters || "",
        },
        dataRequirements: {
          required: c.data_requirements?.required || c.dataRequirements?.required || ["OHLCV"],
          optional: c.data_requirements?.optional || c.dataRequirements?.optional || [],
          proxies: c.data_requirements?.proxies || c.dataRequirements?.proxies || [],
        },
        evidence: (c.evidence || []).map((e: any) => ({
          title: e.title || "",
          url: e.url || "",
          sourceTier: e.source_tier || e.sourceTier || "TERTIARY",
          snippet: e.snippet || "",
          supports: e.supports || ["hypothesis"],
        })),
        explainers: {
          whyThisExists: c.explainers?.why_this_exists || c.explainers?.whyThisExists || "",
          howToFalsify: c.explainers?.how_to_falsify || c.explainers?.howToFalsify || "",
          expectedFailureModes: c.explainers?.expected_failure_modes || c.explainers?.expectedFailureModes || [],
          whatToWatch: c.explainers?.what_to_watch || c.explainers?.whatToWatch || [],
          expectedBehavior: parseExpectedBehavior(c.explainers?.expected_behavior || c.explainers?.expectedBehavior, c.archetype_name || c.archetypeName),
        },
        plainLanguageSummary: c.plain_language_summary || c.plainLanguageSummary ? {
          what: c.plain_language_summary?.what || c.plainLanguageSummary?.what || "",
          how: c.plain_language_summary?.how || c.plainLanguageSummary?.how || "",
          when: c.plain_language_summary?.when || c.plainLanguageSummary?.when || "",
        } : undefined,
        triggeredByRegime: c.triggered_by_regime || c.triggeredByRegime,
        confidence: { score: 0, breakdown: {} as ConfidenceBreakdown },
      };
      
      // Calculate confidence score
      const confidenceResult = calculateConfidenceScore(candidate);
      candidate.confidence = {
        score: confidenceResult.total,
        breakdown: {
          researchConfidence: confidenceResult.researchConfidence,
          structuralSoundness: confidenceResult.structuralSoundness,
          historicalValidation: confidenceResult.historicalValidation,
          regimeRobustness: confidenceResult.regimeRobustness,
          researchStrength: confidenceResult.researchStrength,
          structuralEdge: confidenceResult.structuralEdge,
          regimeAlignment: confidenceResult.regimeAlignment,
          riskEfficiency: confidenceResult.riskEfficiency,
          historicalAnalogs: confidenceResult.historicalAnalogs,
          executionFeasibility: confidenceResult.executionFeasibility,
        },
      };
      
      // Enrich with Perplexity citations if available
      if (citations && citations.length > 0 && candidate.evidence.length === 0) {
        candidate.evidence = citations.slice(0, 3).map((url, idx) => ({
          title: `Source ${idx + 1}`,
          url,
          sourceTier: idx === 0 ? "PRIMARY" : "SECONDARY",
          snippet: "Citation from Perplexity web search",
          supports: ["hypothesis"] as ("hypothesis" | "filter" | "exit" | "risk")[],
        }));
      }
      
      // Build AI Research Provenance - capture WHY this strategy was chosen
      candidate.aiReasoning = buildAIReasoning(candidate);
      candidate.aiSynthesis = buildAISynthesis(candidate, citations || []);
      if (citations && citations.length > 0) {
        candidate.aiResearchSources = citations.slice(0, 5).map((url, idx) => ({
          url,
          title: extractDomainFromUrl(url),
          keyInsight: candidate.evidence[idx]?.snippet || `Supporting research for ${candidate.archetypeName || 'strategy'} approach`,
          relevance: idx === 0 ? "HIGH" as const : idx < 3 ? "MEDIUM" as const : "LOW" as const,
          supportedClaims: [candidate.hypothesis?.slice(0, 100) || 'Strategy hypothesis'],
        }));
      }
      
      return candidate;
    });
    
    // Log filter results for diagnostics
    const validCandidates = mapped.filter((c: ResearchCandidate) => c.strategyName && c.hypothesis);
    const invalidCount = mapped.length - validCandidates.length;
    
    if (invalidCount > 0) {
      console.warn(`[STRATEGY_LAB] Filtered out ${invalidCount} candidates (missing strategyName or hypothesis)`);
      const invalidExamples = mapped.filter((c: ResearchCandidate) => !c.strategyName || !c.hypothesis).slice(0, 2);
      invalidExamples.forEach((c: ResearchCandidate, i: number) => {
        console.warn(`[STRATEGY_LAB] Invalid candidate ${i + 1}: name="${c.strategyName || 'MISSING'}" hypothesis="${c.hypothesis?.slice(0, 50) || 'MISSING'}"`);
      });
    }
    
    console.log(`[STRATEGY_LAB] Returning ${validCandidates.length} valid candidates`);
    return validCandidates;
  } catch (error) {
    console.error("[STRATEGY_LAB] Failed to parse research response:", error);
    return [];
  }
}

export interface PerplexityResearchResult {
  success: boolean;
  candidates: ResearchCandidate[];
  error?: string;
  usage?: LLMUsage;
  traceId: string;
}

export async function runPerplexityResearch(
  context?: ResearchContext,
  userId?: string
): Promise<PerplexityResearchResult> {
  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  const providers = getStrategyLabProviders();
  
  // INSTITUTIONAL: Start Perplexity research phase
  researchMonitorWS.startPhase("perplexity", "Strategy Lab Research", traceId, {
    trigger: context?.regimeTrigger || "manual",
    regime: context?.currentRegime,
    providersAvailable: providers.map(p => p.provider),
  });
  
  if (providers.length === 0) {
    researchMonitorWS.logError("perplexity", "No AI providers configured for Strategy Lab", { traceId });
    researchMonitorWS.endPhase("perplexity", "Strategy Lab Research", traceId, "Failed: No providers");
    return {
      success: false,
      candidates: [],
      error: "No AI providers configured for Strategy Lab",
      traceId,
    };
  }
  
  // INSTITUTIONAL: Log research context
  const focusAreas = [];
  if (context?.currentRegime) focusAreas.push(`Regime: ${context.currentRegime}`);
  if (context?.regimeTrigger) focusAreas.push(`Trigger: ${context.regimeTrigger}`);
  
  researchMonitorWS.logAnalysis("perplexity", 
    `Research Context: ${focusAreas.join(" | ") || "Market-wide strategy scan"}`, 
    { traceId }
  );
  
  const prompt = buildResearchPrompt(context);
  const errors: string[] = [];
  
  for (const { provider, apiKey } of providers) {
    const providerSource = provider === "perplexity" ? "perplexity" : 
                           provider === "anthropic" ? "anthropic" :
                           provider === "openai" ? "openai" :
                           provider === "groq" ? "groq" :
                           provider === "gemini" ? "gemini" : "system";
    
    if (userId) {
      const budgetCheck = await checkBudgetLimit(userId, provider);
      if (!budgetCheck.allowed) {
        console.log(`[STRATEGY_LAB] trace_id=${traceId} provider=${provider} skipped: ${budgetCheck.reason}`);
        researchMonitorWS.logValidation(providerSource as any, `Budget Check (${provider})`, "FAIL", budgetCheck.reason);
        errors.push(`${provider}: ${budgetCheck.reason}`);
        continue;
      }
      researchMonitorWS.logValidation(providerSource as any, `Budget Check (${provider})`, "PASS", "Within limit");
    }
    
    try {
      console.log(`[STRATEGY_LAB] trace_id=${traceId} provider=${provider} starting research`);
      
      const config = AI_PROVIDERS[provider];
      const { headers, body } = config.formatRequest(prompt, apiKey);
      
      // INSTITUTIONAL: Log API call
      researchMonitorWS.logApiCall(providerSource as any, provider, config.model, "Strategy research with web grounding", {
        traceId,
        cascadePosition: errors.length + 1,
      });
      
      let url = config.url;
      if (provider === "gemini") {
        url = `${config.url}?key=${apiKey}`;
      }
      
      const callStart = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
      });
      const apiLatency = Date.now() - callStart;
      
      if (!response.ok) {
        throw new Error(`${provider} API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json() as any;
      let content = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let citations: string[] = [];
      
      if (provider === "perplexity") {
        content = data.choices?.[0]?.message?.content || "";
        inputTokens = data.usage?.prompt_tokens || 0;
        outputTokens = data.usage?.completion_tokens || 0;
        citations = data.citations || [];
        
        // DEBUG: Log actual Perplexity response content
        console.log(`[PERPLEXITY_DEBUG] trace_id=${traceId} content_length=${content.length} first_200_chars=${JSON.stringify(content.slice(0, 200))}`);
        
        // INSTITUTIONAL: Log citations discovered
        if (citations.length > 0) {
          researchMonitorWS.logCitations("perplexity", citations, `Found ${citations.length} web sources`);
          
          // Log individual high-value sources
          citations.slice(0, 5).forEach((url, idx) => {
            researchMonitorWS.logSource("perplexity", url, `Web Source ${idx + 1}`, 
              idx === 0 ? "PRIMARY" : "SECONDARY"
            );
          });
        }
      } else if (provider === "anthropic") {
        content = data.content?.[0]?.text || "";
        inputTokens = data.usage?.input_tokens || 0;
        outputTokens = data.usage?.output_tokens || 0;
      } else if (provider === "gemini") {
        content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        inputTokens = data.usageMetadata?.promptTokenCount || 0;
        outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
      } else {
        content = data.choices?.[0]?.message?.content || "";
        inputTokens = data.usage?.prompt_tokens || 0;
        outputTokens = data.usage?.completion_tokens || 0;
      }
      
      const costUsd = calculateCost(config.model, inputTokens, outputTokens);
      
      // INSTITUTIONAL: Cost tracking
      researchMonitorWS.logCost(providerSource as any, provider, config.model, inputTokens, outputTokens, costUsd, traceId);
      
      // INSTITUTIONAL: Log parsing phase
      researchMonitorWS.logAnalysis(providerSource as any, 
        `Parsing ${outputTokens.toLocaleString()} tokens for strategy candidates`, 
        { traceId, durationMs: apiLatency }
      );
      
      const candidates = parseResearchResponse(content, citations);
      
      if (candidates.length === 0) {
        researchMonitorWS.logValidation(providerSource as any, "Candidate Parsing", "WARN", "No valid candidates extracted");
      } else {
        researchMonitorWS.logValidation(providerSource as any, "Candidate Parsing", "PASS", `Extracted ${candidates.length} strategies`);
      }
      
      // INSTITUTIONAL: Log each candidate with full details and set provider
      for (const candidate of candidates) {
        // Set the AI provider that generated this candidate
        candidate.aiProvider = provider;
        
        // Log scoring
        researchMonitorWS.logScoring(providerSource as any, 
          candidate.strategyName, 
          candidate.confidence.score, 
          candidate.confidence.breakdown as Record<string, number>
        );
        
        // Log idea discovery
        researchMonitorWS.logIdea(providerSource as any,
          `${candidate.archetypeName}: ${candidate.hypothesis?.slice(0, 100) || candidate.strategyName}`,
          candidate.confidence.score,
          candidate.hypothesis
        );
        
        // Log full candidate with AI research provenance
        researchMonitorWS.logCandidate(providerSource as any, candidate.strategyName, candidate.confidence.score, {
          symbols: candidate.instrumentUniverse,
          archetype: candidate.archetypeName,
          hypothesis: candidate.hypothesis,
          reasoning: candidate.aiReasoning,
          synthesis: candidate.aiSynthesis,
          sources: candidate.aiResearchSources?.map(s => ({ 
            type: s.relevance, 
            label: s.title, 
            detail: s.keyInsight 
          })),
          aiProvider: provider,
          confidenceBreakdown: candidate.confidence.breakdown as Record<string, number>,
          traceId,
        });
      }
      
      if (userId) {
        await updateBudgetSpend(userId, provider, costUsd);
        await logCostEvent(
          context?.sourceLabBotId || "00000000-0000-0000-0000-000000000000",
          userId,
          provider,
          config.model,
          inputTokens,
          outputTokens,
          costUsd,
          traceId,
          {
            action: "STRATEGY_LAB_RESEARCH",
            suggestionsCount: candidates.length,
            cascadePosition: errors.length + 1,
            fallbackReason: errors.length > 0 ? errors[errors.length - 1] : undefined,
          }
        );
      }
      
      logActivityEvent({
        eventType: "STRATEGY_LAB_RESEARCH",
        severity: "INFO",
        title: `Strategy Lab Research (${provider})`,
        summary: `Generated ${candidates.length} strategy candidates`,
        payload: {
          provider,
          candidateCount: candidates.length,
          candidateNames: candidates.map(c => c.strategyName),
          avgConfidence: candidates.length > 0 
            ? Math.round(candidates.reduce((sum, c) => sum + c.confidence.score, 0) / candidates.length)
            : 0,
          cost: costUsd.toFixed(6),
          tokens: { input: inputTokens, output: outputTokens },
          context: context?.regimeTrigger || "SCHEDULED",
          citations: citations.slice(0, 5),
        },
        traceId,
      });
      
      trackProviderSuccess(provider);
      
      console.log(`[STRATEGY_LAB] trace_id=${traceId} SUCCESS provider=${provider} candidates=${candidates.length} cost=$${costUsd.toFixed(6)}`);
      
      // End research phase
      const totalDuration = Date.now() - startTime;
      researchMonitorWS.endPhase("perplexity", "Strategy Lab Research", traceId,
        `Completed: ${candidates.length} strategies via ${provider} in ${(totalDuration/1000).toFixed(1)}s | $${costUsd.toFixed(4)}`
      );
      
      return {
        success: true,
        candidates,
        usage: { inputTokens, outputTokens, costUsd },
        traceId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.warn(`[STRATEGY_LAB] trace_id=${traceId} provider=${provider} FAILED: ${errorMsg}`);
      researchMonitorWS.logError(providerSource as any, `${provider} failed: ${errorMsg}`, { traceId });
      errors.push(`${provider}: ${errorMsg}`);
      trackProviderFailure(provider, errorMsg);
    }
  }
  
  console.error(`[STRATEGY_LAB] trace_id=${traceId} ALL_PROVIDERS_FAILED: ${errors.join("; ")}`);
  researchMonitorWS.logError("system", `All providers failed: ${errors.join("; ")}`, { traceId });
  researchMonitorWS.endPhase("perplexity", "Strategy Lab Research", traceId, `Failed: All ${providers.length} providers exhausted`);
  
  return {
    success: false,
    candidates: [],
    error: `All AI providers failed: ${errors.join("; ")}`,
    traceId,
  };
}

// Generate a deterministic hash for rules to detect duplicates
export function generateRulesHash(rules: StrategyCandidateRules): string {
  const normalized = JSON.stringify({
    entry: (rules.entry || []).sort(),
    exit: (rules.exit || []).sort(),
    risk: (rules.risk || []).sort(),
    filters: (rules.filters || []).sort(),
    invalidation: (rules.invalidation || []).sort(),
  });
  
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
