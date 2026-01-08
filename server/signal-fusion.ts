import { fetchOptionsFlow, interpretFlowSignal, type FlowSummary } from "./unusual-whales-client";
import { fetchMacroSnapshot, getMacroTradingBias, type MacroSnapshot } from "./fred-client";
import { fetchNewsSentiment, getNewsTradingBias, type NewsSentimentSummary } from "./news-sentiment-client";
import { logActivityEvent } from "./activity-logger";
import { getProviderStatus, getProviderHealth, type ProviderStatus } from "./provider-health";
import { BotSourceStates, SourceId, getEnabledSourceIds } from "@shared/strategy-types";
import { getAdaptiveWeights, type SignalWeights } from "./adaptive-weights";
import { loadBotSourceStates } from "./source-selection-governor";

// Individual data provider info for institutional transparency
export interface DataProvider {
  name: string;           // Literal provider name (e.g., "Unusual Whales", "FRED")
  category: string;       // Category this provider belongs to (e.g., "Options Flow")
  status: "CONNECTED" | "DEGRADED" | "OFFLINE";
  latencyMs?: number;     // Last response latency
  lastFetchedAt?: Date;
}

export interface SignalSource {
  name: string;
  available: boolean;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL" | "RISK_ON" | "RISK_OFF";
  confidence: number;
  weight: number;
  reasoning: string;
  fetchedAt?: Date;
  // INSTITUTIONAL REQUIREMENT: Literal provider names for audit compliance
  providers: DataProvider[];
}

export interface FusedSignal {
  symbol: string;
  netBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  positionSizeMultiplier: number;
  tradingAllowed: boolean;
  sources: SignalSource[];
  reasoning: string[];
  fusedAt: Date;
  // SEV-0 PROVENANCE: Source attribution for trade metadata
  sourceAttribution: SignalSourceAttribution;
}

// SEV-0 INSTITUTIONAL REQUIREMENT: Track which data sources contributed to each signal
export interface SignalSourceAttribution {
  contributingSources: string[];
  sourceWeights: Record<string, number>;
  sourceConfidences: Record<string, number>;
  primarySource: string | null;
  fusionHash: string;
  attestationTimestamp: Date;
}

export interface SignalFusionConfig {
  optionsFlowWeight: number;
  macroWeight: number;
  newsWeight: number;
  minimumConfidenceThreshold: number;
  riskOffStopsTrading: boolean;
}

const DEFAULT_CONFIG: SignalFusionConfig = {
  optionsFlowWeight: 0.4,
  macroWeight: 0.35,
  newsWeight: 0.25,
  minimumConfidenceThreshold: 40,
  riskOffStopsTrading: false,
};

export async function fetchAllSignals(
  symbol: string,
  traceId: string
): Promise<{
  optionsFlow: FlowSummary | null;
  macro: MacroSnapshot | null;
  news: NewsSentimentSummary | null;
}> {
  const [optionsFlowResult, macroResult, newsResult] = await Promise.allSettled([
    fetchOptionsFlow(symbol, traceId),
    fetchMacroSnapshot(traceId),
    fetchNewsSentiment(symbol, traceId),
  ]);

  return {
    optionsFlow: optionsFlowResult.status === "fulfilled" && optionsFlowResult.value.success 
      ? optionsFlowResult.value.data || null 
      : null,
    macro: macroResult.status === "fulfilled" && macroResult.value.success 
      ? macroResult.value.data || null 
      : null,
    news: newsResult.status === "fulfilled" && newsResult.value.success 
      ? newsResult.value.data || null 
      : null,
  };
}

// Map source names to SourceId for filtering
const SOURCE_NAME_TO_ID: Record<string, SourceId> = {
  "Options Flow": "options_flow",
  "Macro Indicators": "macro_indicators",
  "News Sentiment": "news_sentiment",
  "Economic Calendar": "economic_calendar",
};

// Check if a source is enabled based on BotSourceStates
function isSourceEnabled(sourceName: string, sourceStates?: BotSourceStates): boolean {
  if (!sourceStates?.useAutonomousSelection) {
    return true; // If not using autonomous selection, all sources are enabled
  }
  const sourceId = SOURCE_NAME_TO_ID[sourceName];
  if (!sourceId) return true; // Unknown source, default to enabled
  const state = sourceStates.states[sourceId];
  return state?.status === "enabled" || state?.status === "probation";
}

export function fuseSignals(
  symbol: string,
  optionsFlow: FlowSummary | null,
  macro: MacroSnapshot | null,
  news: NewsSentimentSummary | null,
  config: SignalFusionConfig = DEFAULT_CONFIG,
  sourceStates?: BotSourceStates
): FusedSignal {
  const sources: SignalSource[] = [];
  const reasoning: string[] = [];
  
  let totalWeight = 0;
  let weightedBullishScore = 0;
  let weightedConfidence = 0;
  let positionMultiplier = 1.0;
  let tradingAllowed = true;

  // Track skipped sources for logging
  const skippedSources: string[] = [];

  // Check if Options Flow is enabled
  const optionsFlowEnabled = isSourceEnabled("Options Flow", sourceStates);
  if (!optionsFlowEnabled) {
    skippedSources.push("Options Flow (disabled)");
  }

  if (optionsFlow && optionsFlowEnabled) {
    const flowSignal = interpretFlowSignal(optionsFlow);
    const biasScore = flowSignal.bias === "BULLISH" ? 1 : flowSignal.bias === "BEARISH" ? -1 : 0;
    const uwHealth = getProviderHealth("Unusual Whales");
    
    sources.push({
      name: "Options Flow",
      available: true,
      bias: flowSignal.bias,
      confidence: flowSignal.confidence,
      weight: config.optionsFlowWeight,
      reasoning: flowSignal.reasoning,
      fetchedAt: optionsFlow.fetchedAt,
      providers: [{
        name: "Unusual Whales",
        category: "Options Flow",
        status: uwHealth?.status || "CONNECTED",
        latencyMs: uwHealth?.latencyMs || undefined,
        lastFetchedAt: uwHealth?.lastSuccessAt || optionsFlow.fetchedAt,
      }],
    });

    weightedBullishScore += biasScore * config.optionsFlowWeight * (flowSignal.confidence / 100);
    weightedConfidence += flowSignal.confidence * config.optionsFlowWeight;
    totalWeight += config.optionsFlowWeight;
    reasoning.push(`Options: ${flowSignal.reasoning}`);
  } else {
    const uwHealth = getProviderHealth("Unusual Whales");
    sources.push({
      name: "Options Flow",
      available: false,
      bias: "NEUTRAL",
      confidence: 0,
      weight: 0,
      reasoning: optionsFlowEnabled ? "Unusual Whales data unavailable" : "Source disabled by governor",
      providers: [{
        name: "Unusual Whales",
        category: "Options Flow",
        status: uwHealth?.status || "OFFLINE",
        latencyMs: uwHealth?.latencyMs || undefined,
        lastFetchedAt: uwHealth?.lastSuccessAt || undefined,
      }],
    });
  }

  // Check if Macro Indicators is enabled
  const macroEnabled = isSourceEnabled("Macro Indicators", sourceStates);
  if (!macroEnabled) {
    skippedSources.push("Macro Indicators (disabled)");
  }

  if (macro && macroEnabled) {
    const macroBias = getMacroTradingBias(macro);
    const biasScore = macroBias.bias === "RISK_ON" ? 0.5 : macroBias.bias === "RISK_OFF" ? -0.5 : 0;
    const fredHealth = getProviderHealth("FRED");
    
    sources.push({
      name: "Macro Indicators",
      available: true,
      bias: macroBias.bias,
      confidence: macroBias.positionSizeMultiplier * 100,
      weight: config.macroWeight,
      reasoning: macroBias.reasoning,
      fetchedAt: macro.fetchedAt,
      providers: [{
        name: "FRED",
        category: "Macro Indicators",
        status: fredHealth?.status || "CONNECTED",
        latencyMs: fredHealth?.latencyMs || undefined,
        lastFetchedAt: fredHealth?.lastSuccessAt || macro.fetchedAt,
      }],
    });

    weightedBullishScore += biasScore * config.macroWeight;
    weightedConfidence += (macroBias.positionSizeMultiplier * 100) * config.macroWeight;
    totalWeight += config.macroWeight;
    positionMultiplier *= macroBias.positionSizeMultiplier;
    reasoning.push(`Macro: ${macroBias.reasoning}`);

    if (macroBias.bias === "RISK_OFF" && config.riskOffStopsTrading) {
      tradingAllowed = false;
      reasoning.push("Trading paused due to risk-off macro conditions");
    }
  } else {
    const fredHealth = getProviderHealth("FRED");
    sources.push({
      name: "Macro Indicators",
      available: false,
      bias: "NEUTRAL",
      confidence: 0,
      weight: 0,
      reasoning: macroEnabled ? "FRED data unavailable" : "Source disabled by governor",
      providers: [{
        name: "FRED",
        category: "Macro Indicators",
        status: fredHealth?.status || "OFFLINE",
        latencyMs: fredHealth?.latencyMs || undefined,
        lastFetchedAt: fredHealth?.lastSuccessAt || undefined,
      }],
    });
  }

  // Check if News Sentiment is enabled
  const newsEnabled = isSourceEnabled("News Sentiment", sourceStates);
  if (!newsEnabled) {
    skippedSources.push("News Sentiment (disabled)");
  }

  if (news && newsEnabled) {
    const newsBias = getNewsTradingBias(news);
    const biasScore = newsBias.bias === "BULLISH" ? 1 : newsBias.bias === "BEARISH" ? -1 : 0;
    const finnhubHealth = getProviderHealth("Finnhub");
    const newsapiHealth = getProviderHealth("NewsAPI");
    const marketauxHealth = getProviderHealth("Marketaux");
    
    sources.push({
      name: "News Sentiment",
      available: true,
      bias: newsBias.bias,
      confidence: newsBias.confidence,
      weight: config.newsWeight,
      reasoning: newsBias.reasoning,
      fetchedAt: news.fetchedAt,
      providers: [
        { name: "Finnhub", category: "News Sentiment", status: finnhubHealth?.status || "CONNECTED", latencyMs: finnhubHealth?.latencyMs || undefined, lastFetchedAt: finnhubHealth?.lastSuccessAt || news.fetchedAt },
        { name: "NewsAPI", category: "News Sentiment", status: newsapiHealth?.status || "CONNECTED", latencyMs: newsapiHealth?.latencyMs || undefined, lastFetchedAt: newsapiHealth?.lastSuccessAt || news.fetchedAt },
        { name: "Marketaux", category: "News Sentiment", status: marketauxHealth?.status || "CONNECTED", latencyMs: marketauxHealth?.latencyMs || undefined, lastFetchedAt: marketauxHealth?.lastSuccessAt || news.fetchedAt },
      ],
    });

    weightedBullishScore += biasScore * config.newsWeight * (newsBias.confidence / 100);
    weightedConfidence += newsBias.confidence * config.newsWeight;
    totalWeight += config.newsWeight;
    reasoning.push(`News: ${newsBias.reasoning}`);
  } else {
    const finnhubHealth = getProviderHealth("Finnhub");
    const newsapiHealth = getProviderHealth("NewsAPI");
    const marketauxHealth = getProviderHealth("Marketaux");
    sources.push({
      name: "News Sentiment",
      available: false,
      bias: "NEUTRAL",
      confidence: 0,
      weight: 0,
      reasoning: newsEnabled ? "News APIs unavailable" : "Source disabled by governor",
      providers: [
        { name: "Finnhub", category: "News Sentiment", status: finnhubHealth?.status || "OFFLINE", latencyMs: finnhubHealth?.latencyMs || undefined, lastFetchedAt: finnhubHealth?.lastSuccessAt || undefined },
        { name: "NewsAPI", category: "News Sentiment", status: newsapiHealth?.status || "OFFLINE", latencyMs: newsapiHealth?.latencyMs || undefined, lastFetchedAt: newsapiHealth?.lastSuccessAt || undefined },
        { name: "Marketaux", category: "News Sentiment", status: marketauxHealth?.status || "OFFLINE", latencyMs: marketauxHealth?.latencyMs || undefined, lastFetchedAt: marketauxHealth?.lastSuccessAt || undefined },
      ],
    });
  }

  // Log skipped sources if any
  if (skippedSources.length > 0) {
    reasoning.push(`Skipped: ${skippedSources.join(", ")}`);
  }

  let netBias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (totalWeight > 0) {
    const normalizedScore = weightedBullishScore / totalWeight;
    if (normalizedScore > 0.2) netBias = "BULLISH";
    else if (normalizedScore < -0.2) netBias = "BEARISH";
  }

  const confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

  if (confidence < config.minimumConfidenceThreshold) {
    reasoning.push(`Low confidence (${confidence.toFixed(0)}%) - consider reduced position size`);
    positionMultiplier *= 0.5;
  }

  // SEV-0 PROVENANCE: Build source attribution for trade metadata
  const contributingSources = sources.filter(s => s.available).map(s => s.name);
  const sourceWeights: Record<string, number> = {};
  const sourceConfidences: Record<string, number> = {};
  let primarySource: string | null = null;
  let maxContribution = 0;
  
  sources.forEach(s => {
    if (s.available) {
      sourceWeights[s.name] = s.weight;
      sourceConfidences[s.name] = s.confidence;
      const contribution = s.weight * (s.confidence / 100);
      if (contribution > maxContribution) {
        maxContribution = contribution;
        primarySource = s.name;
      }
    }
  });
  
  // Generate deterministic fusion hash for provenance
  const fusionInput = `${symbol}|${netBias}|${confidence.toFixed(2)}|${contributingSources.sort().join(",")}`;
  const fusionHash = Buffer.from(fusionInput).toString('base64').substring(0, 16);
  
  const sourceAttribution: SignalSourceAttribution = {
    contributingSources,
    sourceWeights,
    sourceConfidences,
    primarySource,
    fusionHash,
    attestationTimestamp: new Date(),
  };

  return {
    symbol,
    netBias,
    confidence,
    positionSizeMultiplier: positionMultiplier,
    tradingAllowed,
    sources,
    reasoning,
    fusedAt: new Date(),
    sourceAttribution,
  };
}

// Convert adaptive SignalWeights to SignalFusionConfig format
function adaptiveWeightsToConfig(weights: SignalWeights, baseConfig: SignalFusionConfig = DEFAULT_CONFIG): SignalFusionConfig {
  return {
    optionsFlowWeight: weights.options_flow,
    macroWeight: weights.macro_indicators,
    newsWeight: weights.news_sentiment,
    minimumConfidenceThreshold: baseConfig.minimumConfidenceThreshold,
    riskOffStopsTrading: baseConfig.riskOffStopsTrading,
  };
}

export async function getSignalFusion(
  symbol: string,
  traceId: string,
  config: SignalFusionConfig = DEFAULT_CONFIG,
  botId?: string
): Promise<{ success: boolean; data?: FusedSignal; error?: string }> {
  try {
    const { optionsFlow, macro, news } = await fetchAllSignals(symbol, traceId);
    
    const sourcesAvailable = [optionsFlow, macro, news].filter(Boolean).length;
    
    if (sourcesAvailable === 0) {
      return { 
        success: false, 
        error: "No signal sources available (check API keys for Unusual Whales, FRED, Finnhub, NewsAPI, Marketaux)" 
      };
    }

    // Use adaptive weights and source states if botId is provided
    let effectiveConfig = config;
    let sourceStates: BotSourceStates | undefined;
    
    if (botId) {
      try {
        // Fetch adaptive weights for this bot
        const adaptiveResult = await getAdaptiveWeights(botId, traceId);
        effectiveConfig = adaptiveWeightsToConfig(adaptiveResult.weights, config);
        
        // Load source states for autonomous source selection
        sourceStates = await loadBotSourceStates(botId);
        
        console.log(`[SIGNAL_FUSION] trace_id=${traceId} bot_id=${botId} using_adaptive_weights regime=${adaptiveResult.regime} autonomous_selection=${sourceStates.useAutonomousSelection}`);
      } catch (adaptiveError) {
        console.warn(`[SIGNAL_FUSION] trace_id=${traceId} bot_id=${botId} adaptive_weights_fallback error=${adaptiveError}`);
        // Fall back to default config if adaptive weights fail
      }
    }

    const fusedSignal = fuseSignals(symbol, optionsFlow, macro, news, effectiveConfig, sourceStates);

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: `Signal Fusion for ${symbol}`,
      summary: `Net Bias: ${fusedSignal.netBias} (${fusedSignal.confidence.toFixed(0)}% confidence). Sources: ${sourcesAvailable}/3`,
      payload: {
        symbol,
        netBias: fusedSignal.netBias,
        confidence: fusedSignal.confidence.toFixed(1),
        positionMultiplier: fusedSignal.positionSizeMultiplier.toFixed(2),
        tradingAllowed: fusedSignal.tradingAllowed,
        sourcesAvailable,
      },
      traceId,
      symbol,
    });

    console.log(`[SIGNAL_FUSION] trace_id=${traceId} symbol=${symbol} bias=${fusedSignal.netBias} confidence=${fusedSignal.confidence.toFixed(0)}% sources=${sourcesAvailable}/3`);

    return { success: true, data: fusedSignal };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[SIGNAL_FUSION] trace_id=${traceId} error=${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

export function shouldEnterTrade(
  fusedSignal: FusedSignal,
  strategyBias: "LONG" | "SHORT" | "NEUTRAL"
): { allowed: boolean; reason: string } {
  if (!fusedSignal.tradingAllowed) {
    return { allowed: false, reason: "Trading suspended due to macro risk-off conditions" };
  }

  if (fusedSignal.confidence < 30) {
    return { allowed: false, reason: "Insufficient signal confidence for trade entry" };
  }

  if (strategyBias === "LONG" && fusedSignal.netBias === "BEARISH") {
    return { 
      allowed: false, 
      reason: "Long entry blocked: signals indicate bearish conditions" 
    };
  }

  if (strategyBias === "SHORT" && fusedSignal.netBias === "BULLISH") {
    return { 
      allowed: false, 
      reason: "Short entry blocked: signals indicate bullish conditions" 
    };
  }

  const alignedBias = 
    (strategyBias === "LONG" && fusedSignal.netBias === "BULLISH") ||
    (strategyBias === "SHORT" && fusedSignal.netBias === "BEARISH");

  if (alignedBias) {
    return { 
      allowed: true, 
      reason: `Trade aligned with ${fusedSignal.netBias.toLowerCase()} signal fusion (${fusedSignal.confidence.toFixed(0)}% confidence)` 
    };
  }

  return { 
    allowed: true, 
    reason: `Trade allowed with neutral signal fusion (${fusedSignal.confidence.toFixed(0)}% confidence)` 
  };
}
