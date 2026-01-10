import crypto from "crypto";
import { db } from "./db";
import { strategyCandidates, botCostEvents, llmBudgets, grokInjections } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logActivityEvent } from "./activity-logger";
import { 
  calculateConfidenceScore,
  generateRulesHash,
  type ResearchCandidate,
  type ResearchContext,
  type RegimeTrigger,
  trackProviderSuccess,
  trackProviderFailure,
} from "./ai-strategy-evolution";
import { detectMarketRegime } from "./regime-detector";
import { getRecentGrokFeedback, buildFeedbackContextForGrok } from "./grok-feedback-collector";
import { logIntegrationRequest } from "./request-logger";
import { researchMonitorWS } from "./research-monitor-ws";

const GROK_MODEL = "grok-4-1-fast";
const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const LLM_PRICING = {
  "grok-4-1-fast": { input: 0.20, output: 0.50 },
  "grok-4-1-fast-reasoning": { input: 0.20, output: 0.50 },
  "grok-3-beta": { input: 2.00, output: 8.00 },
  "grok-4": { input: 3.00, output: 15.00 },
};

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  traceId: string,
  maxAttempts = MAX_RETRY_ATTEMPTS
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) {
        if (attempt > 1) {
          console.log(`[GROK_RESEARCH] trace_id=${traceId} RETRY_SUCCESS attempt=${attempt}`);
          researchMonitorWS.logSystem("grok", `API recovered after ${attempt} attempts`, "Self-healing successful");
        }
        return response;
      }
      
      if (response.status === 429) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[GROK_RESEARCH] trace_id=${traceId} RATE_LIMITED attempt=${attempt} retrying_in=${delay}ms`);
        researchMonitorWS.logSystem("grok", `Rate limited, retrying in ${delay/1000}s (attempt ${attempt}/${maxAttempts})`, "Auto-retry active");
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      if (response.status >= 500 && response.status < 600) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[GROK_RESEARCH] trace_id=${traceId} SERVER_ERROR=${response.status} attempt=${attempt} retrying_in=${delay}ms`);
        researchMonitorWS.logSystem("grok", `Server error ${response.status}, retrying in ${delay/1000}s`, "Auto-retry active");
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < maxAttempts && !lastError.message.includes("404") && !lastError.message.includes("401")) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[GROK_RESEARCH] trace_id=${traceId} FETCH_ERROR="${lastError.message}" attempt=${attempt} retrying_in=${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw lastError;
    }
  }
  
  throw lastError || new Error("Max retries exceeded");
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = LLM_PRICING[model as keyof typeof LLM_PRICING] || { input: 2.0, output: 8.0 };
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export type GrokResearchDepth = "CONTRARIAN_SCAN" | "SENTIMENT_BURST" | "DEEP_REASONING";

export interface GrokResearchContext {
  grokDepth?: GrokResearchDepth;
  xSentimentFocus?: string[];
  contrarianTargets?: string[];
  regimeTrigger?: RegimeTrigger;
  regimeSnapshot?: Record<string, any>;
  sourceLabBotId?: string;
  sourceLabFailure?: {
    failureReasonCodes: string[];
    performanceDeltas: Record<string, number>;
    regimeAtFailure: string;
  };
  customFocus?: string;
  currentRegime?: string;
  feedbackContext?: string; // Performance feedback from previous strategies
}

export interface GrokResearchResult {
  success: boolean;
  candidates: ResearchCandidate[];
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  traceId: string;
  xInsights?: string[];
}

function buildGrokResearchPrompt(context?: GrokResearchContext): string {
  const depth = context?.grokDepth || "CONTRARIAN_SCAN";
  const regime = context?.currentRegime || "UNKNOWN";
  const customFocus = context?.customFocus || "";
  const failureContext = context?.sourceLabFailure?.failureReasonCodes?.join(", ") || "";
  
  const depthInstructions = {
    CONTRARIAN_SCAN: `
You are analyzing market conditions for CONTRARIAN trading opportunities. 
Focus on:
- Crowded trades that may reverse
- Sentiment extremes that historically precede reversals
- Overlooked correlations and divergences
- Positions that "everyone" is in (and why they might be wrong)
`,
    SENTIMENT_BURST: `
You are analyzing real-time market SENTIMENT from X/Twitter and financial media.
Focus on:
- Current trending topics affecting ES/NQ/MES/MNQ futures
- Fear/greed indicators from social sentiment
- Retail vs institutional positioning divergence
- Breaking news that hasn't been priced in yet
`,
    DEEP_REASONING: `
You are conducting DEEP REASONING analysis for institutional-grade strategies.
Focus on:
- Multi-timeframe confluence patterns
- Macro regime implications for micro execution
- Statistical edge quantification
- Risk-adjusted return optimization
- Cross-asset correlations and regime shifts
`,
  };

  const basePrompt = `You are Grok 4, xAI's advanced reasoning model with real-time X (Twitter) access. 
You are generating trading strategy candidates for CME micro futures (MES, MNQ).

${depthInstructions[depth]}

CURRENT MARKET REGIME: ${regime}
${customFocus ? `FOCUS AREA: ${customFocus}` : ""}
${failureContext ? `LEARN FROM FAILURE: A previous strategy failed because: ${failureContext}. Design strategies that address this weakness.` : ""}
${context?.feedbackContext ? `\n${context.feedbackContext}\n` : ""}

Generate 2-3 HIGH-QUALITY strategy candidates optimized for the current regime.
Each strategy must have:
1. A CONTRARIAN or UNIQUE edge (not what everyone else is doing)
2. Specific entry/exit rules that can be backtested
3. Risk management appropriate for micro futures ($5/point MES, $2/point MNQ)
4. Clear invalidation conditions

CRITICAL SCHEMA REQUIREMENTS:
Return a JSON array of strategy candidates with this EXACT structure:
\`\`\`json
[
  {
    "strategyName": "TRADING DESK NAME: 2-4 words only, professional style (e.g. 'Mesa Pulse Fade', 'Vol Squeeze Break'). NEVER include AI/model names like Grok, GPT, Claude, Perplexity. NEVER include instrument names like MES, MNQ, ES, NQ.",
    "archetypeName": "One of: SCALPING, BREAKOUT, MEAN_REVERSION, TREND_FOLLOWING, GAP_FADE, VWAP_BOUNCE",
    "hypothesis": "The core thesis of why this strategy should work (2-3 sentences max)",
    "instrumentUniverse": ["MES"] or ["MNQ"],
    "timeframePreferences": ["5m"] or ["1m", "5m"],
    "sessionModePreference": "RTH" or "ETH" or "FULL_24x5",
    "rulesJson": {
      "entry": ["Rule 1", "Rule 2"],
      "exit": ["Exit rule 1", "Exit rule 2"],
      "risk": ["Max 1% per trade", "Stop loss rule"],
      "filters": ["Session filter", "Regime filter"],
      "invalidation": ["When to NOT trade"]
    },
    "confidenceScore": 65-95,
    "reasoning": "2-3 sentence plain-language explanation of WHY you chose this strategy - what market inefficiency or edge you detected, and what convinced you this is the right approach.",
    "sources": [
      {"type": "X/Twitter", "label": "Social Sentiment", "detail": "Brief description of what you found"},
      {"type": "Options Flow", "label": "Positioning", "detail": "e.g., 4:1 call/put ratio"},
      {"type": "Technical", "label": "Pattern", "detail": "e.g., VWAP deviation at 2.3 std"},
      {"type": "News", "label": "Catalyst", "detail": "Brief news description"}
    ]
  }
]
\`\`\`

IMPORTANT:
- Return ONLY the JSON array, no markdown code blocks or explanations
- Each strategy must be DISTINCT and not overlap with common retail strategies
- Confidence scores should reflect genuine edge assessment (don't just say 85 for everything)
- Prioritize strategies that exploit current regime characteristics
- ALWAYS include "reasoning" explaining your thought process in plain language
- ALWAYS include "sources" array with at least 2 sources showing what data you used`;

  return basePrompt;
}

function sanitizeStrategyName(name: string): string {
  if (!name) return "Unnamed Strategy";
  
  const providerPatterns = [
    /\b(grok|xai|x\.ai)\b/gi,
    /\b(gpt|openai|chatgpt)\b/gi,
    /\b(claude|anthropic)\b/gi,
    /\b(perplexity|pplx)\b/gi,
    /\b(gemini|google)\b/gi,
    /\b(llama|meta)\b/gi,
  ];
  
  const instrumentPatterns = [
    /\b(MES|MNQ|ES|NQ)\b/g,
  ];
  
  let cleaned = name;
  
  for (const pattern of providerPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  for (const pattern of instrumentPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }
  
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/^[\s\-_:,]+/, "")
    .replace(/[\s\-_:,]+$/, "")
    .replace(/\s*(v\d+)\s*$/i, "")
    .trim();
  
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  if (words.length > 4) {
    cleaned = words.slice(0, 4).join(" ");
  }
  
  const tradingAcronyms = new Set([
    "EMA", "SMA", "VWAP", "RSI", "ATR", "ADX", "MACD", "BB", "MTF", 
    "ORB", "RTH", "ETH", "HVN", "LVN", "POC", "VAH", "VAL", "VIX"
  ]);
  
  cleaned = cleaned
    .split(" ")
    .map(word => {
      const upper = word.toUpperCase();
      if (tradingAcronyms.has(upper)) return upper;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
  
  return cleaned || "Unnamed Strategy";
}

function extractCleanJSONGrok(rawContent: string): string | null {
  let content = rawContent.trim();
  let sanitized = false;
  
  // Step 1: Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
    sanitized = true;
  }
  
  // Step 2: Remove any leading prose/text before JSON starts
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
      console.log(`[GROK_RESEARCH] Stripped ${leadingText.length} chars of leading prose before JSON`);
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
      console.log(`[GROK_RESEARCH] JSON sanitization applied - extracted ${result.length} chars of clean JSON`);
    }
    return result;
  }
  
  return null;
}

function parseGrokResponse(content: string): ResearchCandidate[] {
  try {
    // Use robust JSON extraction that handles markdown fences, leading prose, etc.
    const cleanJson = extractCleanJSONGrok(content);
    if (!cleanJson) {
      console.error("[GROK_RESEARCH] No valid JSON found in response");
      console.error(`[GROK_RESEARCH] Response preview (first 500 chars): ${content.slice(0, 500)}`);
      return [];
    }
    
    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error(`[GROK_RESEARCH] JSON parse error: ${parseErr instanceof Error ? parseErr.message : 'Unknown'}`);
      console.error(`[GROK_RESEARCH] Clean JSON preview (first 500 chars): ${cleanJson.slice(0, 500)}`);
      return [];
    }
    
    // Handle both array and object formats
    const candidatesArray = Array.isArray(parsed) ? parsed : (parsed.candidates || parsed.strategies || [parsed]);
    console.log(`[GROK_RESEARCH] Processing ${candidatesArray.length} candidates from parsed response`);
    
    return candidatesArray.map((item: any) => {
      const candidate: ResearchCandidate = {
        strategyName: sanitizeStrategyName(item.strategyName || "Unnamed Strategy"),
        archetypeName: item.archetypeName || "BREAKOUT",
        hypothesis: item.hypothesis || "",
        instrumentUniverse: item.instrumentUniverse || ["MES"],
        timeframePreferences: item.timeframePreferences || ["5m"],
        sessionModePreference: item.sessionModePreference || "RTH",
        rules: item.rulesJson || {
          entry: [],
          exit: [],
          risk: ["Max 1% per trade"],
          filters: [],
          invalidation: [],
        },
        confidence: {
          score: Math.min(95, Math.max(40, item.confidenceScore || 70)),
          breakdown: {
            researchConfidence: 75,
            structuralSoundness: 80,
            historicalValidation: 70,
            regimeRobustness: 65,
          },
        },
        noveltyJustification: {
          closestKnown: ["Standard momentum strategy"],
          distinctDeltas: ["Grok-generated contrarian approach", "AI-optimized for current regime"],
          whyItMatters: "Exploits overlooked market inefficiencies using advanced reasoning",
        },
        dataRequirements: {
          required: ["RSI", "ATR", "VWAP"],
          optional: [],
          proxies: [],
        },
        evidence: item.xSentimentInsight ? [{
          title: "X Sentiment Insight",
          url: "https://x.ai",
          sourceTier: "SECONDARY" as const,
          snippet: item.xSentimentInsight,
          supports: ["hypothesis"] as ("hypothesis" | "filter" | "exit" | "risk")[],
        }] : [],
        explainers: {
          whyThisExists: item.hypothesis?.substring(0, 100) || "Grok-generated strategy",
          howToFalsify: "Strategy fails if premise is invalid",
          expectedFailureModes: ["Regime change", "Crowded trade"],
          whatToWatch: ["Entry signals", "Risk limits"],
        },
        triggeredByRegime: "GROK_RESEARCH",
      };
      
      // Add AI research provenance fields (reasoning and sources)
      (candidate as any).aiReasoning = item.reasoning || null;
      (candidate as any).aiResearchSources = item.sources || null;
      
      return candidate;
    }).filter((c: ResearchCandidate) => c.strategyName && c.hypothesis);
  } catch (error) {
    console.error("[GROK_RESEARCH] Failed to parse response:", error);
    return [];
  }
}

interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  actionRequired?: string;
  actionType?: "INCREASE_BUDGET" | "RESUME_MANUALLY" | "CHECK_API_KEY" | "WAIT_FOR_RESET";
  currentSpend?: number;
  limit?: number;
}

async function checkBudgetLimit(userId: string): Promise<BudgetCheckResult> {
  try {
    const budget = await db.query.llmBudgets.findFirst({
      where: and(
        eq(llmBudgets.userId, userId),
        eq(llmBudgets.provider, "xai" as any)
      ),
    });
    
    if (!budget) return { allowed: true };
    
    const currentSpend = budget.currentMonthSpendUsd ?? 0;
    const limit = budget.monthlyLimitUsd ?? 10;
    
    if (!budget.isEnabled) {
      return { 
        allowed: false, 
        reason: "Grok research is disabled",
        actionRequired: "Enable Grok in Settings > AI Providers to resume autonomous research",
        actionType: "RESUME_MANUALLY",
        currentSpend,
        limit,
      };
    }
    
    if (budget.isPaused) {
      return { 
        allowed: false, 
        reason: "Grok research is manually paused",
        actionRequired: "Unpause Grok in Settings > AI Providers to resume research",
        actionType: "RESUME_MANUALLY",
        currentSpend,
        limit,
      };
    }
    
    if (budget.isAutoThrottled) {
      const now = new Date();
      const budgetMonth = budget.budgetMonthStart;
      
      if (budgetMonth) {
        const monthStart = new Date(budgetMonth);
        const nextMonth = new Date(monthStart);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        
        if (now >= nextMonth) {
          await db.update(llmBudgets)
            .set({ 
              isAutoThrottled: false,
              currentMonthSpendUsd: 0,
              budgetMonthStart: now,
              updatedAt: now,
            })
            .where(eq(llmBudgets.id, budget.id));
          
          console.log(`[GROK_BUDGET] Auto-reset: new month detected, unthrottling userId=${userId}`);
          researchMonitorWS.logSystem("grok", "Monthly budget reset - research resuming automatically", "Self-healing: budget cycle reset");
          return { allowed: true, currentSpend: 0, limit };
        }
      }
      
      return { 
        allowed: false, 
        reason: `Grok monthly budget exceeded ($${currentSpend.toFixed(2)} / $${limit.toFixed(2)})`,
        actionRequired: `Increase your Grok budget limit in Settings > AI Providers, or wait until next month for auto-reset`,
        actionType: "INCREASE_BUDGET",
        currentSpend,
        limit,
      };
    }
    
    if (currentSpend >= limit) {
      await db.update(llmBudgets)
        .set({ isAutoThrottled: true })
        .where(eq(llmBudgets.id, budget.id));
      
      return { 
        allowed: false, 
        reason: `Grok monthly budget limit reached ($${currentSpend.toFixed(2)} / $${limit.toFixed(2)})`,
        actionRequired: `Increase your Grok budget limit in Settings, or wait until next month`,
        actionType: "INCREASE_BUDGET",
        currentSpend,
        limit,
      };
    }
    
    return { allowed: true, currentSpend, limit };
  } catch (error) {
    console.error("[GROK_BUDGET_CHECK] Error:", error);
    return { allowed: true };
  }
}

async function updateBudgetSpend(userId: string, costUsd: number): Promise<void> {
  try {
    await db.update(llmBudgets)
      .set({ 
        currentMonthSpendUsd: sql`${llmBudgets.currentMonthSpendUsd} + ${costUsd}`,
        updatedAt: new Date()
      })
      .where(and(
        eq(llmBudgets.userId, userId),
        eq(llmBudgets.provider, "xai" as any)
      ));
  } catch (error) {
    console.error("[GROK_BUDGET_UPDATE] Failed to update spend:", error);
  }
}

async function logCostEvent(
  botId: string | null,
  userId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  traceId: string,
  depth: GrokResearchDepth
): Promise<void> {
  try {
    await db.insert(botCostEvents).values({
      botId: botId || null, // Allow null for system-level research costs
      userId,
      category: "llm",
      provider: "xai",
      eventType: "grok_research",
      inputTokens,
      outputTokens,
      costUsd,
      metadata: { 
        model: GROK_MODEL,
        depth,
        action: "GROK_AUTONOMOUS_RESEARCH",
      },
      traceId,
    });
  } catch (error) {
    console.error("[GROK_COST_TRACKING] Failed to log cost event:", error);
  }
}

export async function runGrokResearch(
  context?: GrokResearchContext,
  userId?: string
): Promise<GrokResearchResult> {
  const traceId = crypto.randomUUID();
  const apiKey = process.env.XAI_API_KEY;
  const depth = context?.grokDepth || "CONTRARIAN_SCAN";
  const startTime = Date.now();
  
  // INSTITUTIONAL: Start research phase
  researchMonitorWS.startPhase("grok", `${depth} Research`, traceId, {
    depth,
    regime: context?.currentRegime,
    trigger: context?.regimeTrigger || "manual",
  });
  
  if (!apiKey) {
    researchMonitorWS.logError("grok", "XAI_API_KEY not configured", { traceId });
    researchMonitorWS.endPhase("grok", `${depth} Research`, traceId, "Failed: API key missing");
    return {
      success: false,
      candidates: [],
      error: "XAI_API_KEY not configured",
      traceId,
    };
  }
  
  if (userId) {
    const budgetCheck = await checkBudgetLimit(userId);
    if (!budgetCheck.allowed) {
      console.log(`[GROK_RESEARCH] trace_id=${traceId} skipped: ${budgetCheck.reason}`);
      
      researchMonitorWS.logActionRequired("grok", budgetCheck.reason || "Budget limit reached", {
        actionRequired: budgetCheck.actionRequired,
        actionType: budgetCheck.actionType,
        currentSpend: budgetCheck.currentSpend,
        limit: budgetCheck.limit,
        traceId,
      });
      
      researchMonitorWS.endPhase("grok", `${depth} Research`, traceId, `Blocked: ${budgetCheck.reason}`);
      return {
        success: false,
        candidates: [],
        error: budgetCheck.reason,
        traceId,
      };
    }
    
    const spendPercent = budgetCheck.limit && budgetCheck.limit > 0 
      ? Math.round(((budgetCheck.currentSpend || 0) / budgetCheck.limit) * 100) 
      : 0;
    researchMonitorWS.logValidation("grok", "Budget Check", "PASS", 
      `$${(budgetCheck.currentSpend || 0).toFixed(2)} / $${(budgetCheck.limit || 10).toFixed(2)} (${spendPercent}% used)`
    );
  }
  
  const prompt = buildGrokResearchPrompt(context);
  
  try {
    console.log(`[GROK_RESEARCH] trace_id=${traceId} depth=${depth} starting research`);
    
    // INSTITUTIONAL: Log research context and focus
    const focusAreas = [];
    if (context?.currentRegime) focusAreas.push(`Regime: ${context.currentRegime}`);
    if (context?.customFocus) focusAreas.push(`Focus: ${context.customFocus}`);
    if (context?.xSentimentFocus) focusAreas.push(`X Sentiment: ${context.xSentimentFocus.join(", ")}`);
    if (context?.contrarianTargets) focusAreas.push(`Contrarian Targets: ${context.contrarianTargets.join(", ")}`);
    
    researchMonitorWS.logAnalysis("grok", `Research Context: ${focusAreas.join(" | ") || "General market scan"}`, {
      traceId,
      depth,
      regime: context?.currentRegime,
    });
    
    // Log if learning from failure
    if (context?.sourceLabFailure) {
      researchMonitorWS.logReasoning("grok", 
        `Learning from previous failure: ${context.sourceLabFailure.failureReasonCodes?.join(", ")}`,
        "Adaptive evolution mode"
      );
    }
    
    // Log feedback context if present
    if (context?.feedbackContext) {
      researchMonitorWS.logReasoning("grok",
        "Incorporating performance feedback from past strategies",
        "Autonomous learning active"
      );
    }
    
    // INSTITUTIONAL: API call logging
    researchMonitorWS.logApiCall("grok", "xai", GROK_MODEL, `${depth} strategy generation`, {
      traceId,
      depth,
      temperature: 0.7,
      maxTokens: 4000,
    });
    
    const response = await fetchWithRetry(
      GROK_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROK_MODEL,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 4000,
        }),
      },
      traceId
    );
    
    const apiLatency = Date.now() - startTime;
    
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const costUsd = calculateCost(GROK_MODEL, inputTokens, outputTokens);
    
    // INSTITUTIONAL: Cost tracking event
    researchMonitorWS.logCost("grok", "xai", GROK_MODEL, inputTokens, outputTokens, costUsd, traceId);
    
    // INSTITUTIONAL: Log parsing phase
    researchMonitorWS.logAnalysis("grok", `Parsing ${outputTokens.toLocaleString()} tokens of strategy candidates`, {
      traceId,
      durationMs: apiLatency,
    });
    
    const candidates = parseGrokResponse(content);
    
    if (candidates.length === 0) {
      researchMonitorWS.logValidation("grok", "Candidate Parsing", "WARN", "No valid candidates extracted from response");
    } else {
      researchMonitorWS.logValidation("grok", "Candidate Parsing", "PASS", `Extracted ${candidates.length} strategies`);
    }
    
    // INSTITUTIONAL: Confidence scoring phase
    for (const candidate of candidates) {
      const recalculated = calculateConfidenceScore(
        candidate,
        { sharpeRatio: 1.2, maxDrawdown: 15, winRate: 55 }
      );
      candidate.confidence = {
        score: recalculated.total,
        breakdown: recalculated,
      };
      
      // Log detailed scoring
      researchMonitorWS.logScoring("grok", candidate.strategyName, recalculated.total, recalculated);
      
      // Log idea discovery with full context
      researchMonitorWS.logIdea("grok", 
        `${candidate.archetypeName}: ${candidate.hypothesis?.slice(0, 100) || candidate.strategyName}`,
        recalculated.total,
        candidate.hypothesis
      );
    }
    
    if (userId) {
      await updateBudgetSpend(userId, costUsd);
      await logCostEvent(
        context?.sourceLabBotId || null, // Null for system-level research costs
        userId,
        inputTokens,
        outputTokens,
        costUsd,
        traceId,
        depth
      );
    }
    
    logActivityEvent({
      eventType: "GROK_RESEARCH_COMPLETED",
      severity: "INFO",
      title: `Grok Research (${depth})`,
      summary: `Generated ${candidates.length} contrarian strategy candidates`,
      payload: {
        depth,
        candidateCount: candidates.length,
        candidateNames: candidates.map(c => c.strategyName),
        avgConfidence: candidates.length > 0 
          ? Math.round(candidates.reduce((sum, c) => sum + c.confidence.score, 0) / candidates.length)
          : 0,
        cost: costUsd.toFixed(6),
        tokens: { input: inputTokens, output: outputTokens },
        context: context?.regimeTrigger || "SCHEDULED",
        model: GROK_MODEL,
      },
      traceId,
    });
    
    trackProviderSuccess("xai");
    
    await logIntegrationRequest({
      source: "AI",
      traceId,
      provider: "xai",
      model: GROK_MODEL,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      latencyMs: apiLatency,
      success: true,
      purpose: `GROK_RESEARCH_${depth}`,
    });
    
    console.log(`[GROK_RESEARCH] trace_id=${traceId} SUCCESS depth=${depth} candidates=${candidates.length} cost=$${costUsd.toFixed(6)}`);
    
    // INSTITUTIONAL: Stream detailed candidates to Research Monitor
    for (const candidate of candidates) {
      const aiReasoning = (candidate as any).aiReasoning;
      const aiSources = (candidate as any).aiResearchSources;
      
      researchMonitorWS.logCandidate("grok", candidate.strategyName, candidate.confidence.score, {
        symbols: candidate.instrumentUniverse || candidate.symbols,
        archetype: candidate.archetypeName,
        hypothesis: candidate.hypothesis,
        reasoning: aiReasoning,
        sources: aiSources,
        confidenceBreakdown: candidate.confidence.breakdown,
        traceId,
      });
    }
    
    // End research phase
    const totalDuration = Date.now() - startTime;
    researchMonitorWS.endPhase("grok", `${depth} Research`, traceId, 
      `Completed: ${candidates.length} strategies in ${(totalDuration/1000).toFixed(1)}s | $${costUsd.toFixed(4)}`
    );
    
    return {
      success: true,
      candidates,
      usage: { inputTokens, outputTokens, costUsd },
      traceId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[GROK_RESEARCH] trace_id=${traceId} FAILED: ${errorMsg}`);
    trackProviderFailure("xai", errorMsg);
    
    const errorCategory = categorizeApiError(errorMsg);
    
    if (errorCategory.requiresUserAction) {
      researchMonitorWS.logActionRequired("grok", errorCategory.userMessage, {
        actionRequired: errorCategory.actionRequired,
        actionType: errorCategory.actionType,
        traceId,
        originalError: errorMsg,
        canAutoRecover: errorCategory.canAutoRecover,
      });
    } else {
      researchMonitorWS.logError("grok", `Research failed: ${errorMsg}`, { 
        traceId,
        willRetry: errorCategory.canAutoRecover,
      });
    }
    
    researchMonitorWS.endPhase("grok", `${depth} Research`, traceId, `Failed: ${errorCategory.userMessage}`);
    
    await logIntegrationRequest({
      source: "AI",
      traceId,
      provider: "xai",
      model: GROK_MODEL,
      latencyMs: Date.now() - startTime,
      success: false,
      errorMessage: errorMsg,
      purpose: `GROK_RESEARCH_${depth}`,
    });
    
    return {
      success: false,
      candidates: [],
      error: errorCategory.userMessage,
      traceId,
    };
  }
}

function categorizeApiError(errorMsg: string): {
  userMessage: string;
  actionRequired?: string;
  actionType?: "INCREASE_BUDGET" | "RESUME_MANUALLY" | "CHECK_API_KEY" | "WAIT_FOR_RESET";
  requiresUserAction: boolean;
  canAutoRecover: boolean;
} {
  const lowerError = errorMsg.toLowerCase();
  
  if (lowerError.includes("401") || lowerError.includes("unauthorized") || lowerError.includes("invalid api key")) {
    return {
      userMessage: "Grok API authentication failed",
      actionRequired: "Check that your XAI_API_KEY secret is valid and has not expired. Get a new key from console.x.ai",
      actionType: "CHECK_API_KEY",
      requiresUserAction: true,
      canAutoRecover: false,
    };
  }
  
  if (lowerError.includes("402") || lowerError.includes("payment required") || lowerError.includes("insufficient") || lowerError.includes("credits")) {
    return {
      userMessage: "Grok API requires payment or credits",
      actionRequired: "Add credits to your xAI account at console.x.ai/billing",
      actionType: "INCREASE_BUDGET",
      requiresUserAction: true,
      canAutoRecover: false,
    };
  }
  
  if (lowerError.includes("404") || lowerError.includes("not found")) {
    return {
      userMessage: "Grok API endpoint or model not found",
      actionRequired: "The model may have been deprecated. Check console.x.ai for available models",
      actionType: "CHECK_API_KEY",
      requiresUserAction: true,
      canAutoRecover: false,
    };
  }
  
  if (lowerError.includes("429") || lowerError.includes("rate limit")) {
    return {
      userMessage: "Grok API rate limited - will auto-retry",
      requiresUserAction: false,
      canAutoRecover: true,
    };
  }
  
  if (lowerError.includes("500") || lowerError.includes("502") || lowerError.includes("503") || lowerError.includes("504")) {
    return {
      userMessage: "Grok API temporary server error - will auto-retry",
      requiresUserAction: false,
      canAutoRecover: true,
    };
  }
  
  if (lowerError.includes("timeout") || lowerError.includes("econnreset") || lowerError.includes("network")) {
    return {
      userMessage: "Network error connecting to Grok - will auto-retry",
      requiresUserAction: false,
      canAutoRecover: true,
    };
  }
  
  return {
    userMessage: errorMsg,
    requiresUserAction: false,
    canAutoRecover: false,
  };
}

export async function processGrokResearchCycle(
  depth: GrokResearchDepth,
  userId: string
): Promise<{
  success: boolean;
  candidatesCreated: number;
  candidateIds: string[];
  error?: string;
  traceId: string;
}> {
  const traceId = crypto.randomUUID();
  
  try {
    let regimeStr = "UNKNOWN";
    try {
      const now = new Date();
      const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const regime = await detectMarketRegime("MES", startDate, now, traceId);
      regimeStr = regime?.regime || "UNKNOWN";
    } catch (e) {
      console.warn(`[GROK_CYCLE] trace_id=${traceId} regime detection failed, proceeding anyway`);
    }
    
    // Fetch recent performance feedback from Grok strategies for autonomous learning
    let feedbackContext = "";
    try {
      const feedback = await getRecentGrokFeedback(20);
      if (feedback.successes.length > 0 || feedback.failures.length > 0) {
        feedbackContext = buildFeedbackContextForGrok(feedback);
        console.log(`[GROK_CYCLE] trace_id=${traceId} injecting feedback: ${feedback.successes.length} successes, ${feedback.failures.length} failures`);
      }
    } catch (e) {
      console.warn(`[GROK_CYCLE] trace_id=${traceId} feedback fetch failed, proceeding without feedback`);
    }
    
    const context: GrokResearchContext = {
      grokDepth: depth,
      currentRegime: regimeStr,
      feedbackContext,
    };
    
    const result = await runGrokResearch(context, userId);
    
    if (!result.success || result.candidates.length === 0) {
      return {
        success: false,
        candidatesCreated: 0,
        candidateIds: [],
        error: result.error || "No candidates generated",
        traceId,
      };
    }
    
    const createdIds: string[] = [];
    
    for (const candidate of result.candidates) {
      try {
        const rulesHash = generateRulesHash(candidate.rules);
        
        const existing = await db.query.strategyCandidates.findFirst({
          where: eq(strategyCandidates.rulesHash, rulesHash),
        });
        
        if (existing) {
          console.log(`[GROK_CYCLE] trace_id=${traceId} duplicate_skipped name="${candidate.strategyName}" hash=${rulesHash}`);
          continue;
        }
        
        const disposition = candidate.confidence.score >= 65 ? "SENT_TO_LAB" : 
                           candidate.confidence.score >= 50 ? "PENDING_REVIEW" : "QUEUED";
        
        const [created] = await db.insert(strategyCandidates).values({
          strategyName: candidate.strategyName,
          archetypeName: candidate.archetypeName || "BREAKOUT",
          hypothesis: candidate.hypothesis,
          instrumentUniverse: candidate.instrumentUniverse || ["MES"],
          timeframePreferences: candidate.timeframePreferences || ["5m"],
          sessionModePreference: candidate.sessionModePreference || "RTH",
          rulesJson: candidate.rules,
          confidenceScore: candidate.confidence.score,
          confidenceBreakdownJson: candidate.confidence.breakdown,
          noveltyScore: 75,
          noveltyJustificationJson: candidate.noveltyJustification,
          dataRequirementsJson: candidate.dataRequirements,
          source: "GROK_RESEARCH",
          disposition,
          rulesHash,
          researchDepth: depth === "DEEP_REASONING" ? "DEEP" : depth === "SENTIMENT_BURST" ? "BALANCED" : "QUICK",
          aiProvider: "GROK",
          createdByAi: GROK_MODEL,
          evidenceJson: candidate.evidence,
          explainersJson: candidate.explainers,
          // AI Research Provenance (sources and reasoning transparency)
          aiReasoning: (candidate as any).aiReasoning || null,
          aiResearchSources: (candidate as any).aiResearchSources || null,
          aiResearchDepth: depth, // CONTRARIAN_SCAN, SENTIMENT_BURST, DEEP_REASONING
        }).returning({ id: strategyCandidates.id });
        
        createdIds.push(created.id);
        
        // Create grok_injection record for feedback loop tracking
        try {
          await db.insert(grokInjections).values({
            candidateId: created.id,
            userId: userId || undefined,
            strategyName: candidate.strategyName,
            archetypeName: candidate.archetypeName || "BREAKOUT",
            researchDepth: depth,
            source: "GROK_AUTONOMOUS",
            disposition,
            confidenceScore: candidate.confidence.score,
            noveltyScore: 75,
            hypothesis: candidate.hypothesis,
            rulesHash,
            evolutionGeneration: 0,
          });
          console.log(`[GROK_CYCLE] trace_id=${traceId} created injection for candidate="${candidate.strategyName}"`);
        } catch (injectionError) {
          console.error(`[GROK_CYCLE] trace_id=${traceId} failed to create injection for "${candidate.strategyName}":`, injectionError);
        }
        
        console.log(`[GROK_CYCLE] trace_id=${traceId} created candidate="${candidate.strategyName}" id=${created.id} disposition=${disposition} confidence=${candidate.confidence.score}`);
      } catch (insertError) {
        console.error(`[GROK_CYCLE] trace_id=${traceId} failed to insert candidate="${candidate.strategyName}":`, insertError);
      }
    }
    
    logActivityEvent({
      eventType: "GROK_CYCLE_COMPLETED",
      severity: "INFO",
      title: "Grok Research Cycle Complete",
      summary: `Created ${createdIds.length} new strategy candidates`,
      payload: {
        depth,
        candidatesCreated: createdIds.length,
        candidateIds: createdIds,
        totalGenerated: result.candidates.length,
        cost: result.usage?.costUsd.toFixed(6),
      },
      traceId,
    });
    
    return {
      success: true,
      candidatesCreated: createdIds.length,
      candidateIds: createdIds,
      traceId,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[GROK_CYCLE] trace_id=${traceId} FAILED:`, error);
    
    return {
      success: false,
      candidatesCreated: 0,
      candidateIds: [],
      error: errorMsg,
      traceId,
    };
  }
}

export function getGrokResearchDepthDescription(depth: GrokResearchDepth): string {
  switch (depth) {
    case "CONTRARIAN_SCAN":
      return "Quick contrarian analysis - finds crowded trades and sentiment extremes";
    case "SENTIMENT_BURST":
      return "X/Twitter sentiment analysis - real-time social intelligence";
    case "DEEP_REASONING":
      return "Deep reasoning - institutional-grade multi-factor analysis";
    default:
      return "Unknown depth";
  }
}
