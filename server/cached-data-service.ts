/**
 * Cached Data Service
 * 
 * Provides cached access to all data providers with:
 * - Automatic deduplication across bots
 * - Rate limit protection
 * - Stale-while-revalidate for seamless updates
 * 
 * USAGE: Import this instead of individual clients for shared caching
 */

import { getCachedData, getCacheStats, invalidateCache } from "./data-source-cache";
import { fetchOptionsFlow, FlowSummary } from "./unusual-whales-client";
import { fetchMacroSnapshot, MacroSnapshot } from "./fred-client";
import { fetchNewsSentiment, NewsSentimentSummary } from "./news-sentiment-client";

export interface CachedFlowResult {
  data: FlowSummary | null;
  fromCache: boolean;
  isStale: boolean;
  error?: string;
}

export interface CachedMacroResult {
  data: MacroSnapshot | null;
  fromCache: boolean;
  isStale: boolean;
  error?: string;
}

export interface CachedNewsResult {
  data: NewsSentimentSummary | null;
  fromCache: boolean;
  isStale: boolean;
  error?: string;
}


export async function getCachedOptionsFlow(
  symbol: string,
  traceId: string,
  botId?: string,
  stage?: string
): Promise<CachedFlowResult> {
  try {
    const result = await getCachedData<{ success: boolean; data?: FlowSummary; error?: string }>(
      "unusual_whales",
      "flow-alerts",
      () => fetchOptionsFlow(symbol, traceId, botId, stage),
      { symbol }
    );
    
    if (result.data.success && result.data.data) {
      return {
        data: result.data.data,
        fromCache: result.fromCache,
        isStale: result.isStale,
      };
    }
    
    return {
      data: null,
      fromCache: result.fromCache,
      isStale: result.isStale,
      error: result.data.error,
    };
  } catch (error) {
    return {
      data: null,
      fromCache: false,
      isStale: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getCachedMacroData(
  traceId: string,
  botId?: string,
  stage?: string
): Promise<CachedMacroResult> {
  try {
    const result = await getCachedData<{ success: boolean; data?: MacroSnapshot; error?: string }>(
      "fred",
      "macro-indicators",
      () => fetchMacroSnapshot(traceId, botId, stage),
      {}
    );
    
    if (result.data.success && result.data.data) {
      return {
        data: result.data.data,
        fromCache: result.fromCache,
        isStale: result.isStale,
      };
    }
    
    return {
      data: null,
      fromCache: result.fromCache,
      isStale: result.isStale,
      error: result.data.error,
    };
  } catch (error) {
    return {
      data: null,
      fromCache: false,
      isStale: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function getCachedNewsSentiment(
  symbol: string,
  traceId: string,
  botId?: string,
  stage?: string
): Promise<CachedNewsResult> {
  try {
    const result = await getCachedData<{ success: boolean; data?: NewsSentimentSummary; error?: string }>(
      "finnhub",
      "news-sentiment",
      () => fetchNewsSentiment(symbol, traceId, botId, stage),
      { symbol }
    );
    
    if (result.data.success && result.data.data) {
      return {
        data: result.data.data,
        fromCache: result.fromCache,
        isStale: result.isStale,
      };
    }
    
    return {
      data: null,
      fromCache: result.fromCache,
      isStale: result.isStale,
      error: result.data.error,
    };
  } catch (error) {
    return {
      data: null,
      fromCache: false,
      isStale: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export function getDataCacheStats() {
  return getCacheStats();
}

export function invalidateProviderCache(provider: string) {
  return invalidateCache(provider);
}

export function invalidateAllCaches() {
  const providers = ["unusual_whales", "fred", "finnhub", "newsapi", "marketaux", "fmp", "databento", "polygon"];
  let total = 0;
  for (const provider of providers) {
    total += invalidateCache(provider);
  }
  return total;
}
