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

const GROK_MODEL = "grok-4.1-fast";
const GROK_API_URL = "https://api.x.ai/v1/chat/completions";

const LLM_PRICING = {
  "grok-4.1-fast": { input: 2.00, output: 8.00 },
  "grok-4": { input: 3.00, output: 15.00 },
};

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

function parseGrokResponse(content: string): ResearchCandidate[] {
  try {
    let jsonContent = content.trim();
    
    const jsonMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonContent = jsonMatch[1].trim();
    }
    
    const arrayMatch = jsonContent.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonContent = arrayMatch[0];
    }
    
    const parsed = JSON.parse(jsonContent) as any[];
    
    return parsed.map((item: any) => {
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

async function checkBudgetLimit(userId: string): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const budget = await db.query.llmBudgets.findFirst({
      where: and(
        eq(llmBudgets.userId, userId),
        eq(llmBudgets.provider, "xai" as any)
      ),
    });
    
    if (!budget) return { allowed: true };
    if (!budget.isEnabled || budget.isPaused) {
      return { allowed: false, reason: "xAI/Grok is disabled or paused" };
    }
    if (budget.isAutoThrottled) {
      return { allowed: false, reason: "xAI/Grok budget exceeded for this month" };
    }
    if ((budget.currentMonthSpendUsd ?? 0) >= (budget.monthlyLimitUsd ?? 10)) {
      await db.update(llmBudgets)
        .set({ isAutoThrottled: true })
        .where(eq(llmBudgets.id, budget.id));
      return { allowed: false, reason: "xAI/Grok monthly budget exceeded" };
    }
    return { allowed: true };
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
  botId: string,
  userId: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  traceId: string,
  depth: GrokResearchDepth
): Promise<void> {
  try {
    await db.insert(botCostEvents).values({
      botId,
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
  
  if (!apiKey) {
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
      return {
        success: false,
        candidates: [],
        error: budgetCheck.reason,
        traceId,
      };
    }
  }
  
  const prompt = buildGrokResearchPrompt(context);
  
  try {
    console.log(`[GROK_RESEARCH] trace_id=${traceId} depth=${depth} starting research`);
    
    // Stream to Research Monitor
    researchMonitorWS.logSearch("grok", `Grok ${depth} research - ${context?.regimeTrigger || "scheduled"} ${context?.customFocus ? `focus: ${context.customFocus}` : ""}`, {
      depth,
      regime: context?.currentRegime,
      traceId,
    });
    
    const response = await fetch(GROK_API_URL, {
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
    });
    
    if (!response.ok) {
      throw new Error(`Grok API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || "";
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    
    const candidates = parseGrokResponse(content);
    const costUsd = calculateCost(GROK_MODEL, inputTokens, outputTokens);
    
    for (const candidate of candidates) {
      const recalculated = calculateConfidenceScore(
        candidate,
        { sharpeRatio: 1.2, maxDrawdown: 15, winRate: 55 }
      );
      candidate.confidence = {
        score: recalculated.total,
        breakdown: recalculated,
      };
    }
    
    if (userId) {
      await updateBudgetSpend(userId, costUsd);
      await logCostEvent(
        context?.sourceLabBotId || "00000000-0000-0000-0000-000000000000",
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
    
    // Log AI request for tracking/analytics
    await logIntegrationRequest({
      source: "AI",
      traceId,
      provider: "xai",
      model: GROK_MODEL,
      tokensIn: inputTokens,
      tokensOut: outputTokens,
      latencyMs: 0, // Could add timing if needed
      success: true,
      purpose: `GROK_RESEARCH_${depth}`,
    });
    
    console.log(`[GROK_RESEARCH] trace_id=${traceId} SUCCESS depth=${depth} candidates=${candidates.length} cost=$${costUsd.toFixed(6)}`);
    
    // Stream candidates to Research Monitor
    for (const candidate of candidates) {
      researchMonitorWS.logCandidate(
        "grok", 
        candidate.strategyName, 
        candidate.confidence.score,
        candidate.symbols?.[0]
      );
    }
    
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
    
    // Stream error to Research Monitor
    researchMonitorWS.logError("grok", `Research failed: ${errorMsg}`);
    
    // Log failed AI request
    await logIntegrationRequest({
      source: "AI",
      traceId,
      provider: "xai",
      model: GROK_MODEL,
      latencyMs: 0,
      success: false,
      errorMessage: errorMsg,
      purpose: `GROK_RESEARCH_${depth}`,
    });
    
    return {
      success: false,
      candidates: [],
      error: errorMsg,
      traceId,
    };
  }
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
