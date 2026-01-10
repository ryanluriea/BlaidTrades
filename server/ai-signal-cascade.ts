/**
 * AI Signal Cascade - Multi-Provider LLM Trade Signal Generation with Failover
 * 
 * Orchestrates multiple LLM providers for generating trade signals with:
 * - Priority-based cascade (Groq → OpenAI → Anthropic → Gemini → xAI → OpenRouter)
 * - Automatic failover on provider errors
 * - Provider health tracking with auto-recovery
 * - Signal aggregation across multiple providers
 */

export type SignalProvider = "groq" | "openai" | "anthropic" | "gemini" | "xai" | "openrouter";

export interface MarketContext {
  trend: "BULLISH" | "BEARISH" | "SIDEWAYS" | "VOLATILE";
  volatility: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  volume: "LOW" | "AVERAGE" | "HIGH";
  regime?: string;
  keyLevels?: {
    support: number[];
    resistance: number[];
  };
}

export interface TechnicalIndicators {
  rsi?: number;
  macd?: { value: number; signal: number; histogram: number };
  ema?: { fast: number; slow: number };
  atr?: number;
  bollinger?: { upper: number; middle: number; lower: number };
  vwap?: number;
  adx?: number;
  stochastic?: { k: number; d: number };
  [key: string]: any;
}

export interface SignalRequest {
  symbol: string;
  timeframe: string;
  marketContext: MarketContext;
  indicators: TechnicalIndicators;
  newsContext?: string[];
  currentPrice?: number;
  userId?: string;
}

export interface TradeSignal {
  direction: "LONG" | "SHORT" | "FLAT";
  confidence: number;
  reasoning: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  provider: string;
  latencyMs: number;
  timestamp: Date;
  cascadePosition?: number;
  failoverReason?: string;
}

export interface ProviderHealthStatus {
  provider: SignalProvider;
  isHealthy: boolean;
  successRate: number;
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  averageLatencyMs: number;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  cooldownUntil?: Date;
  weight: number;
}

interface ProviderConfig {
  name: SignalProvider;
  url: string;
  envVar: string;
  model: string;
  weight: number;
  timeout: number;
  formatRequest: (prompt: string, apiKey: string) => { 
    headers: Record<string, string>; 
    body: string;
    url?: string;
  };
  parseResponse: (json: any) => { content: string; inputTokens: number; outputTokens: number };
}

const LLM_PRICING: Record<string, { input: number; output: number }> = {
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "grok-4.1-fast": { input: 2.00, output: 8.00 },
  "meta-llama/llama-3.3-70b-instruct": { input: 0.59, output: 0.79 },
};

const SIGNAL_PROVIDERS: ProviderConfig[] = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    envVar: "GROQ_API_KEY",
    model: "llama-3.3-70b-versatile",
    weight: 1.0,
    timeout: 15000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    }),
    parseResponse: (json) => ({
      content: json.choices?.[0]?.message?.content || "",
      inputTokens: json.usage?.prompt_tokens || 0,
      outputTokens: json.usage?.completion_tokens || 0,
    }),
  },
  {
    name: "openai",
    url: "https://api.openai.com/v1/chat/completions",
    envVar: "OPENAI_API_KEY",
    model: "gpt-4o",
    weight: 0.95,
    timeout: 30000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    }),
    parseResponse: (json) => ({
      content: json.choices?.[0]?.message?.content || "",
      inputTokens: json.usage?.prompt_tokens || 0,
      outputTokens: json.usage?.completion_tokens || 0,
    }),
  },
  {
    name: "anthropic",
    url: "https://api.anthropic.com/v1/messages",
    envVar: "ANTHROPIC_API_KEY",
    model: "claude-sonnet-4-20250514",
    weight: 0.95,
    timeout: 30000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    }),
    parseResponse: (json) => ({
      content: json.content?.[0]?.text || "",
      inputTokens: json.usage?.input_tokens || 0,
      outputTokens: json.usage?.output_tokens || 0,
    }),
  },
  {
    name: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    envVar: "GOOGLE_GEMINI_API_KEY",
    model: "gemini-2.0-flash",
    weight: 0.85,
    timeout: 25000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
      },
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1500,
        },
      }),
    }),
    parseResponse: (json) => ({
      content: json.candidates?.[0]?.content?.parts?.[0]?.text || "",
      inputTokens: json.usageMetadata?.promptTokenCount || 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount || 0,
    }),
  },
  {
    name: "xai",
    url: "https://api.x.ai/v1/chat/completions",
    envVar: "XAI_API_KEY",
    model: "grok-4.1-fast",
    weight: 0.9,
    timeout: 30000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.1-fast",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    }),
    parseResponse: (json) => ({
      content: json.choices?.[0]?.message?.content || "",
      inputTokens: json.usage?.prompt_tokens || 0,
      outputTokens: json.usage?.completion_tokens || 0,
    }),
  },
  {
    name: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    envVar: "OPENROUTER_API_KEY",
    model: "meta-llama/llama-3.3-70b-instruct",
    weight: 0.8,
    timeout: 35000,
    formatRequest: (prompt, apiKey) => ({
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.REPLIT_DEV_DOMAIN || "https://blaidagent.replit.app",
        "X-Title": "BlaidAgent Signal Cascade",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      }),
    }),
    parseResponse: (json) => ({
      content: json.choices?.[0]?.message?.content || "",
      inputTokens: json.usage?.prompt_tokens || 0,
      outputTokens: json.usage?.completion_tokens || 0,
    }),
  },
];

const HEALTH_CONFIG = {
  maxConsecutiveFailures: 3,
  cooldownMs: 5 * 60 * 1000,
  successRateThreshold: 0.5,
  minRequestsForRateCalc: 5,
};

const providerHealthMap = new Map<SignalProvider, ProviderHealthStatus>();

function initializeProviderHealth(provider: SignalProvider, weight: number): ProviderHealthStatus {
  return {
    provider,
    isHealthy: true,
    successRate: 1.0,
    consecutiveFailures: 0,
    totalRequests: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    averageLatencyMs: 0,
    weight,
  };
}

function getProviderHealth(provider: SignalProvider): ProviderHealthStatus {
  const config = SIGNAL_PROVIDERS.find(p => p.name === provider);
  if (!providerHealthMap.has(provider)) {
    providerHealthMap.set(provider, initializeProviderHealth(provider, config?.weight || 1.0));
  }
  return providerHealthMap.get(provider)!;
}

function recordProviderSuccess(provider: SignalProvider, latencyMs: number): void {
  const health = getProviderHealth(provider);
  health.totalRequests++;
  health.totalSuccesses++;
  health.consecutiveFailures = 0;
  health.lastSuccessAt = new Date();
  health.isHealthy = true;
  health.cooldownUntil = undefined;
  
  health.averageLatencyMs = health.totalSuccesses === 1 
    ? latencyMs 
    : (health.averageLatencyMs * (health.totalSuccesses - 1) + latencyMs) / health.totalSuccesses;
  
  if (health.totalRequests >= HEALTH_CONFIG.minRequestsForRateCalc) {
    health.successRate = health.totalSuccesses / health.totalRequests;
  }
  
  console.log(`[AI_SIGNAL_CASCADE] SUCCESS provider=${provider} latency=${latencyMs}ms successRate=${(health.successRate * 100).toFixed(1)}%`);
}

function recordProviderFailure(provider: SignalProvider, error: string): void {
  const health = getProviderHealth(provider);
  health.totalRequests++;
  health.totalFailures++;
  health.consecutiveFailures++;
  health.lastFailureAt = new Date();
  
  if (health.totalRequests >= HEALTH_CONFIG.minRequestsForRateCalc) {
    health.successRate = health.totalSuccesses / health.totalRequests;
  }
  
  if (health.consecutiveFailures >= HEALTH_CONFIG.maxConsecutiveFailures || 
      health.successRate < HEALTH_CONFIG.successRateThreshold) {
    health.isHealthy = false;
    health.cooldownUntil = new Date(Date.now() + HEALTH_CONFIG.cooldownMs);
    console.warn(`[AI_SIGNAL_CASCADE] UNHEALTHY provider=${provider} consecutiveFailures=${health.consecutiveFailures} cooldownUntil=${health.cooldownUntil.toISOString()}`);
  }
  
  console.warn(`[AI_SIGNAL_CASCADE] FAILURE provider=${provider} error="${error.substring(0, 100)}" consecutiveFailures=${health.consecutiveFailures}`);
}

function isProviderAvailable(provider: SignalProvider): boolean {
  const health = getProviderHealth(provider);
  
  if (health.cooldownUntil && new Date() < health.cooldownUntil) {
    return false;
  }
  
  if (health.cooldownUntil && new Date() >= health.cooldownUntil) {
    health.isHealthy = true;
    health.cooldownUntil = undefined;
    health.consecutiveFailures = 0;
    console.log(`[AI_SIGNAL_CASCADE] AUTO_RECOVERED provider=${provider}`);
  }
  
  return health.isHealthy;
}

function buildSignalPrompt(request: SignalRequest): string {
  const { symbol, timeframe, marketContext, indicators, newsContext, currentPrice } = request;
  
  let prompt = `You are an expert quantitative trading analyst. Analyze the following market data and provide a trading signal.

MARKET DATA:
- Symbol: ${symbol}
- Timeframe: ${timeframe}
- Current Price: ${currentPrice || "N/A"}
- Trend: ${marketContext.trend}
- Volatility: ${marketContext.volatility}
- Volume: ${marketContext.volume}
${marketContext.regime ? `- Market Regime: ${marketContext.regime}` : ""}
${marketContext.keyLevels ? `- Support Levels: ${marketContext.keyLevels.support.join(", ")}
- Resistance Levels: ${marketContext.keyLevels.resistance.join(", ")}` : ""}

TECHNICAL INDICATORS:
`;

  if (indicators.rsi !== undefined) prompt += `- RSI: ${indicators.rsi.toFixed(2)}\n`;
  if (indicators.macd) prompt += `- MACD: Value=${indicators.macd.value.toFixed(2)}, Signal=${indicators.macd.signal.toFixed(2)}, Histogram=${indicators.macd.histogram.toFixed(2)}\n`;
  if (indicators.ema) prompt += `- EMA: Fast=${indicators.ema.fast.toFixed(2)}, Slow=${indicators.ema.slow.toFixed(2)}\n`;
  if (indicators.atr !== undefined) prompt += `- ATR: ${indicators.atr.toFixed(2)}\n`;
  if (indicators.bollinger) prompt += `- Bollinger: Upper=${indicators.bollinger.upper.toFixed(2)}, Middle=${indicators.bollinger.middle.toFixed(2)}, Lower=${indicators.bollinger.lower.toFixed(2)}\n`;
  if (indicators.vwap !== undefined) prompt += `- VWAP: ${indicators.vwap.toFixed(2)}\n`;
  if (indicators.adx !== undefined) prompt += `- ADX: ${indicators.adx.toFixed(2)}\n`;
  if (indicators.stochastic) prompt += `- Stochastic: K=${indicators.stochastic.k.toFixed(2)}, D=${indicators.stochastic.d.toFixed(2)}\n`;

  if (newsContext && newsContext.length > 0) {
    prompt += `\nNEWS CONTEXT:\n${newsContext.slice(0, 5).map((n, i) => `${i + 1}. ${n}`).join("\n")}\n`;
  }

  prompt += `
Respond ONLY with valid JSON in this exact format:
{
  "direction": "LONG" | "SHORT" | "FLAT",
  "confidence": <number 0-100>,
  "reasoning": "<brief explanation>",
  "entryPrice": <number or null>,
  "stopLoss": <number or null>,
  "takeProfit": <number or null>
}

Consider risk/reward, momentum, and market context. Be conservative with confidence scores.`;

  return prompt;
}

function parseSignalResponse(content: string): Partial<TradeSignal> | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!["LONG", "SHORT", "FLAT"].includes(parsed.direction)) return null;
    if (typeof parsed.confidence !== "number" || parsed.confidence < 0 || parsed.confidence > 100) return null;
    
    return {
      direction: parsed.direction as "LONG" | "SHORT" | "FLAT",
      confidence: Math.round(parsed.confidence),
      reasoning: parsed.reasoning || "No reasoning provided",
      entryPrice: typeof parsed.entryPrice === "number" ? parsed.entryPrice : undefined,
      stopLoss: typeof parsed.stopLoss === "number" ? parsed.stopLoss : undefined,
      takeProfit: typeof parsed.takeProfit === "number" ? parsed.takeProfit : undefined,
    };
  } catch (e) {
    console.error("[AI_SIGNAL_CASCADE] Failed to parse response:", e);
    return null;
  }
}

async function callProvider(
  config: ProviderConfig,
  prompt: string
): Promise<{ signal: Partial<TradeSignal>; latencyMs: number; inputTokens: number; outputTokens: number }> {
  const apiKey = process.env[config.envVar];
  if (!apiKey) {
    throw new Error(`API key not configured: ${config.envVar}`);
  }
  
  const { headers, body, url } = config.formatRequest(prompt, apiKey);
  const targetUrl = url || config.url;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }
    
    const json = await response.json();
    const { content, inputTokens, outputTokens } = config.parseResponse(json);
    
    if (!content) {
      throw new Error("Empty response from provider");
    }
    
    const signal = parseSignalResponse(content);
    if (!signal) {
      throw new Error("Failed to parse signal from response");
    }
    
    return { signal, latencyMs, inputTokens, outputTokens };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Timeout after ${config.timeout}ms`);
    }
    throw error;
  }
}

export async function generateSignalWithCascade(
  request: SignalRequest
): Promise<TradeSignal | null> {
  const prompt = buildSignalPrompt(request);
  const availableProviders = SIGNAL_PROVIDERS.filter(p => {
    const hasKey = !!process.env[p.envVar];
    const isAvailable = isProviderAvailable(p.name);
    return hasKey && isAvailable;
  });
  
  if (availableProviders.length === 0) {
    console.error("[AI_SIGNAL_CASCADE] No providers available - all keys missing or providers unhealthy");
    return null;
  }
  
  console.log(`[AI_SIGNAL_CASCADE] CASCADE_START symbol=${request.symbol} timeframe=${request.timeframe} availableProviders=${availableProviders.map(p => p.name).join(",")}`);
  
  let cascadePosition = 0;
  let lastError = "";
  
  for (const config of availableProviders) {
    cascadePosition++;
    
    try {
      console.log(`[AI_SIGNAL_CASCADE] TRYING provider=${config.name} position=${cascadePosition}`);
      
      const { signal, latencyMs, inputTokens, outputTokens } = await callProvider(config, prompt);
      
      recordProviderSuccess(config.name, latencyMs);
      
      const fullSignal: TradeSignal = {
        direction: signal.direction!,
        confidence: signal.confidence!,
        reasoning: signal.reasoning!,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        provider: config.name,
        latencyMs,
        timestamp: new Date(),
        cascadePosition,
        failoverReason: cascadePosition > 1 ? lastError : undefined,
      };
      
      const pricing = LLM_PRICING[config.model] || { input: 1.0, output: 3.0 };
      const costUsd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
      
      console.log(`[AI_SIGNAL_CASCADE] SUCCESS provider=${config.name} direction=${fullSignal.direction} confidence=${fullSignal.confidence} latency=${latencyMs}ms cost=$${costUsd.toFixed(6)}`);
      
      return fullSignal;
      
    } catch (error: any) {
      lastError = error.message || "Unknown error";
      recordProviderFailure(config.name, lastError);
      console.warn(`[AI_SIGNAL_CASCADE] FAILOVER from=${config.name} error="${lastError.substring(0, 100)}"`);
    }
  }
  
  console.error(`[AI_SIGNAL_CASCADE] CASCADE_EXHAUSTED all ${availableProviders.length} providers failed`);
  return null;
}

export async function generateSignalsFromMultipleProviders(
  request: SignalRequest,
  maxProviders: number = 3
): Promise<TradeSignal[]> {
  const prompt = buildSignalPrompt(request);
  const availableProviders = SIGNAL_PROVIDERS.filter(p => {
    const hasKey = !!process.env[p.envVar];
    const isAvailable = isProviderAvailable(p.name);
    return hasKey && isAvailable;
  }).slice(0, maxProviders);
  
  if (availableProviders.length === 0) {
    return [];
  }
  
  console.log(`[AI_SIGNAL_CASCADE] PARALLEL_START symbol=${request.symbol} providers=${availableProviders.map(p => p.name).join(",")}`);
  
  const results = await Promise.allSettled(
    availableProviders.map(async (config, index) => {
      const { signal, latencyMs } = await callProvider(config, prompt);
      recordProviderSuccess(config.name, latencyMs);
      
      return {
        direction: signal.direction!,
        confidence: signal.confidence!,
        reasoning: signal.reasoning!,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        provider: config.name,
        latencyMs,
        timestamp: new Date(),
        cascadePosition: index + 1,
      } as TradeSignal;
    })
  );
  
  const signals: TradeSignal[] = [];
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const provider = availableProviders[i].name;
    
    if (result.status === "fulfilled") {
      signals.push(result.value);
    } else {
      recordProviderFailure(provider, result.reason?.message || "Unknown error");
    }
  }
  
  console.log(`[AI_SIGNAL_CASCADE] PARALLEL_COMPLETE success=${signals.length}/${availableProviders.length}`);
  
  return signals;
}

export function aggregateMultipleSignals(signals: TradeSignal[]): TradeSignal | null {
  if (signals.length === 0) return null;
  if (signals.length === 1) return signals[0];
  
  const weightedVotes = { LONG: 0, SHORT: 0, FLAT: 0 };
  let totalWeight = 0;
  let weightedConfidence = 0;
  const reasonings: string[] = [];
  let fastestLatency = Infinity;
  let fastestProvider = signals[0].provider;
  
  for (const signal of signals) {
    const health = getProviderHealth(signal.provider as SignalProvider);
    const reliabilityWeight = health.successRate * health.weight;
    const signalWeight = (signal.confidence / 100) * reliabilityWeight;
    
    weightedVotes[signal.direction] += signalWeight;
    totalWeight += signalWeight;
    weightedConfidence += signal.confidence * signalWeight;
    reasonings.push(`[${signal.provider}] ${signal.reasoning}`);
    
    if (signal.latencyMs < fastestLatency) {
      fastestLatency = signal.latencyMs;
      fastestProvider = signal.provider;
    }
  }
  
  let consensusDirection: "LONG" | "SHORT" | "FLAT" = "FLAT";
  let maxVote = weightedVotes.FLAT;
  
  if (weightedVotes.LONG > maxVote) {
    consensusDirection = "LONG";
    maxVote = weightedVotes.LONG;
  }
  if (weightedVotes.SHORT > maxVote) {
    consensusDirection = "SHORT";
    maxVote = weightedVotes.SHORT;
  }
  
  const consensusStrength = totalWeight > 0 ? maxVote / totalWeight : 0;
  const avgConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 50;
  const adjustedConfidence = Math.round(avgConfidence * consensusStrength);
  
  const entryPrices = signals.filter(s => s.entryPrice !== undefined).map(s => s.entryPrice!);
  const stopLosses = signals.filter(s => s.stopLoss !== undefined).map(s => s.stopLoss!);
  const takeProfits = signals.filter(s => s.takeProfit !== undefined).map(s => s.takeProfit!);
  
  const avgPrice = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;
  
  const aggregated: TradeSignal = {
    direction: consensusDirection,
    confidence: adjustedConfidence,
    reasoning: `Consensus from ${signals.length} providers (${(consensusStrength * 100).toFixed(1)}% agreement): ${reasonings.join(" | ")}`,
    entryPrice: avgPrice(entryPrices),
    stopLoss: avgPrice(stopLosses),
    takeProfit: avgPrice(takeProfits),
    provider: `aggregate(${signals.map(s => s.provider).join(",")})`,
    latencyMs: Math.max(...signals.map(s => s.latencyMs)),
    timestamp: new Date(),
  };
  
  console.log(`[AI_SIGNAL_CASCADE] AGGREGATED direction=${aggregated.direction} confidence=${aggregated.confidence} providers=${signals.length} consensusStrength=${(consensusStrength * 100).toFixed(1)}%`);
  
  return aggregated;
}

export function getProviderHealthStatus(): ProviderHealthStatus[] {
  return SIGNAL_PROVIDERS.map(config => getProviderHealth(config.name));
}

export function getSignalCascadeHealth(): {
  totalProviders: number;
  configuredProviders: number;
  healthyProviders: number;
  unhealthyProviders: string[];
  cooldownProviders: { provider: string; until: Date }[];
  cascadeReady: boolean;
} {
  const configuredProviders = SIGNAL_PROVIDERS.filter(p => !!process.env[p.envVar]);
  const healthyProviders = configuredProviders.filter(p => isProviderAvailable(p.name));
  const unhealthyProviders = configuredProviders
    .filter(p => !isProviderAvailable(p.name))
    .map(p => p.name);
  
  const cooldownProviders: { provider: string; until: Date }[] = [];
  for (const p of configuredProviders) {
    const health = getProviderHealth(p.name);
    if (health.cooldownUntil && new Date() < health.cooldownUntil) {
      cooldownProviders.push({ provider: p.name, until: health.cooldownUntil });
    }
  }
  
  return {
    totalProviders: SIGNAL_PROVIDERS.length,
    configuredProviders: configuredProviders.length,
    healthyProviders: healthyProviders.length,
    unhealthyProviders,
    cooldownProviders,
    cascadeReady: healthyProviders.length > 0,
  };
}

export function resetProviderHealth(provider?: SignalProvider): void {
  if (provider) {
    const config = SIGNAL_PROVIDERS.find(p => p.name === provider);
    if (config) {
      providerHealthMap.set(provider, initializeProviderHealth(provider, config.weight));
      console.log(`[AI_SIGNAL_CASCADE] HEALTH_RESET provider=${provider}`);
    }
  } else {
    providerHealthMap.clear();
    console.log("[AI_SIGNAL_CASCADE] HEALTH_RESET all providers");
  }
}

export function getAvailableProviders(): SignalProvider[] {
  return SIGNAL_PROVIDERS
    .filter(p => !!process.env[p.envVar] && isProviderAvailable(p.name))
    .map(p => p.name);
}

export function getProviderCascadeOrder(): SignalProvider[] {
  return SIGNAL_PROVIDERS.map(p => p.name);
}
