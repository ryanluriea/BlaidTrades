import { logActivityEvent } from "./activity-logger";
import { logIntegrationRequest, generateRequestFingerprint } from "./request-logger";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health";

export interface NewsArticle {
  source: string;
  title: string;
  url: string;
  publishedAt: Date;
  sentiment: number;
  relevance: number;
  symbols: string[];
}

export interface NewsSentimentSummary {
  symbol: string;
  articleCount: number;
  avgSentiment: number;
  sentimentTrend: "IMPROVING" | "DECLINING" | "STABLE";
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  topArticles: NewsArticle[];
  fetchedAt: Date;
}

interface FetchResult {
  articles: NewsArticle[];
  hadError: boolean;
  errorMessage?: string;
}

async function fetchFinnhubNews(
  symbol: string,
  apiKey: string
): Promise<FetchResult> {
  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 3);
    const from = fromDate.toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[FINNHUB] Error: ${response.status}`);
      return { articles: [], hadError: true, errorMessage: `HTTP ${response.status}` };
    }

    const data = await response.json() as unknown[];
    
    if (!Array.isArray(data)) return { articles: [], hadError: false };

    const articles = data.slice(0, 20).map((item: any) => ({
      source: "finnhub",
      title: item.headline || "",
      url: item.url || "",
      publishedAt: new Date(item.datetime * 1000),
      sentiment: analyzeSentimentFromTitle(item.headline || ""),
      relevance: 0.8,
      symbols: [symbol],
    }));
    return { articles, hadError: false };
  } catch (error) {
    console.error("[FINNHUB] Fetch error:", error);
    return { articles: [], hadError: true, errorMessage: String(error) };
  }
}

async function fetchNewsAPINews(
  symbol: string,
  apiKey: string
): Promise<FetchResult> {
  try {
    const query = getSearchQueryForSymbol(symbol);
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[NEWSAPI] Error: ${response.status}`);
      return { articles: [], hadError: true, errorMessage: `HTTP ${response.status}` };
    }

    const data = await response.json() as { articles?: unknown[] };
    
    if (!data.articles || !Array.isArray(data.articles)) return { articles: [], hadError: false };

    const articles = data.articles.map((item: any) => ({
      source: "newsapi",
      title: item.title || "",
      url: item.url || "",
      publishedAt: new Date(item.publishedAt),
      sentiment: analyzeSentimentFromTitle(item.title || ""),
      relevance: 0.6,
      symbols: [symbol],
    }));
    return { articles, hadError: false };
  } catch (error) {
    console.error("[NEWSAPI] Fetch error:", error);
    return { articles: [], hadError: true, errorMessage: String(error) };
  }
}

async function fetchMarketauxNews(
  symbol: string,
  apiKey: string
): Promise<FetchResult> {
  try {
    const url = `https://api.marketaux.com/v1/news/all?symbols=${symbol}&filter_entities=true&language=en&api_token=${apiKey}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[MARKETAUX] Error: ${response.status}`);
      return { articles: [], hadError: true, errorMessage: `HTTP ${response.status}` };
    }

    const data = await response.json() as { data?: unknown[] };
    
    if (!data.data || !Array.isArray(data.data)) return { articles: [], hadError: false };

    const articles = data.data.map((item: any) => {
      const entitySentiment = item.entities?.find((e: any) => 
        e.symbol?.toUpperCase() === symbol.toUpperCase()
      );
      
      return {
        source: "marketaux",
        title: item.title || "",
        url: item.url || "",
        publishedAt: new Date(item.published_at),
        sentiment: entitySentiment?.sentiment_score || analyzeSentimentFromTitle(item.title || ""),
        relevance: entitySentiment?.match_score || 0.7,
        symbols: item.entities?.map((e: any) => e.symbol).filter(Boolean) || [symbol],
      };
    });
    return { articles, hadError: false };
  } catch (error) {
    console.error("[MARKETAUX] Fetch error:", error);
    return { articles: [], hadError: true, errorMessage: String(error) };
  }
}

function getSearchQueryForSymbol(symbol: string): string {
  const symbolMap: Record<string, string> = {
    "MES": "S&P 500 futures OR ES futures OR E-mini S&P",
    "ES": "S&P 500 futures OR ES futures OR E-mini S&P",
    "MNQ": "Nasdaq 100 futures OR NQ futures OR E-mini Nasdaq",
    "NQ": "Nasdaq 100 futures OR NQ futures OR E-mini Nasdaq",
    "YM": "Dow futures OR YM futures",
    "MYM": "Dow futures OR micro Dow",
    "RTY": "Russell 2000 futures",
    "M2K": "Russell 2000 futures micro",
    "CL": "crude oil futures OR WTI crude",
    "GC": "gold futures OR COMEX gold",
  };

  return symbolMap[symbol.toUpperCase()] || `${symbol} futures trading`;
}

function analyzeSentimentFromTitle(title: string): number {
  const lowerTitle = title.toLowerCase();
  
  const bullishKeywords = [
    "surge", "soar", "rally", "jump", "gain", "rise", "bull", "breakout",
    "record", "high", "boost", "strong", "optimism", "growth", "upbeat",
  ];
  
  const bearishKeywords = [
    "plunge", "crash", "tumble", "drop", "fall", "bear", "sink", "decline",
    "low", "weak", "fear", "concern", "recession", "warning", "risk",
  ];

  let score = 0;
  
  for (const keyword of bullishKeywords) {
    if (lowerTitle.includes(keyword)) score += 0.2;
  }
  
  for (const keyword of bearishKeywords) {
    if (lowerTitle.includes(keyword)) score -= 0.2;
  }

  return Math.max(-1, Math.min(1, score));
}

export async function fetchNewsSentiment(
  symbol: string,
  traceId: string,
  botId?: string,
  stage?: string
): Promise<{ success: boolean; data?: NewsSentimentSummary; error?: string }> {
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const newsApiKey = process.env.NEWS_API_KEY;
  const marketauxKey = process.env.MARKETAUX_API_KEY;
  const startTime = Date.now();

  const hasAnyKey = finnhubKey || newsApiKey || marketauxKey;
  
  if (!hasAnyKey) {
    const fingerprint = generateRequestFingerprint("NEWS", { symbol });
    await logIntegrationRequest({
      source: "NEWS",
      traceId,
      botId,
      stage,
      symbol,
      provider: "MULTI",
      latencyMs: Date.now() - startTime,
      success: false,
      errorCode: "NO_API_KEY",
      errorMessage: "No news API keys configured",
      requestFingerprint: fingerprint,
    });
    return { 
      success: false, 
      error: "No news API keys configured (FINNHUB_API_KEY, NEWS_API_KEY, or MARKETAUX_API_KEY)" 
    };
  }

  try {
    interface ProviderResult {
      provider: string;
      articles: NewsArticle[];
      hadError: boolean;
      errorMessage?: string;
      startTime: number;
    }
    
    const providerResults: Promise<ProviderResult>[] = [];
    
    if (finnhubKey) {
      const pStart = Date.now();
      providerResults.push(
        fetchFinnhubNews(symbol, finnhubKey).then(result => ({ 
          provider: "FINNHUB", 
          articles: result.articles,
          hadError: result.hadError,
          errorMessage: result.errorMessage,
          startTime: pStart 
        }))
      );
    }
    if (newsApiKey) {
      const pStart = Date.now();
      providerResults.push(
        fetchNewsAPINews(symbol, newsApiKey).then(result => ({ 
          provider: "NEWSAPI", 
          articles: result.articles,
          hadError: result.hadError,
          errorMessage: result.errorMessage,
          startTime: pStart 
        }))
      );
    }
    if (marketauxKey) {
      const pStart = Date.now();
      providerResults.push(
        fetchMarketauxNews(symbol, marketauxKey).then(result => ({ 
          provider: "MARKETAUX", 
          articles: result.articles,
          hadError: result.hadError,
          errorMessage: result.errorMessage,
          startTime: pStart 
        }))
      );
    }

    const results = await Promise.all(providerResults);
    
    // Map provider names for health tracking
    const providerNameMap: Record<string, string> = {
      "FINNHUB": "Finnhub",
      "NEWSAPI": "NewsAPI",
      "MARKETAUX": "Marketaux",
    };
    
    for (const result of results) {
      const latency = Date.now() - result.startTime;
      const providerDisplayName = providerNameMap[result.provider] || result.provider;
      
      // Record provider health:
      // - hadError=true: Actual API error (HTTP error, exception) → record failure
      // - hadError=false with 0 articles: Empty response is valid (no news on weekends) → record success
      // - hadError=false with articles: Normal success → record success
      if (result.hadError) {
        recordProviderFailure(providerDisplayName, result.errorMessage || "API error");
      } else {
        recordProviderSuccess(providerDisplayName, latency);
      }
      
      const fingerprint = generateRequestFingerprint("NEWS", { symbol, provider: result.provider });
      await logIntegrationRequest({
        source: "NEWS",
        traceId,
        botId,
        stage,
        symbol,
        provider: result.provider,
        endpoint: `${result.provider.toLowerCase()}.io`,
        recordsReturned: result.articles.length,
        latencyMs: latency,
        success: !result.hadError,
        errorMessage: result.hadError ? result.errorMessage : undefined,
        requestFingerprint: fingerprint,
      });
    }
    
    const allArticles = results.flatMap(r => r.articles);

    allArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    const articleCount = allArticles.length;
    const avgSentiment = articleCount > 0
      ? allArticles.reduce((sum, a) => sum + a.sentiment, 0) / articleCount
      : 0;

    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;

    for (const article of allArticles) {
      if (article.sentiment > 0.1) bullishCount++;
      else if (article.sentiment < -0.1) bearishCount++;
      else neutralCount++;
    }

    const recentHalf = allArticles.slice(0, Math.floor(articleCount / 2));
    const olderHalf = allArticles.slice(Math.floor(articleCount / 2));
    
    const recentAvg = recentHalf.length > 0
      ? recentHalf.reduce((sum, a) => sum + a.sentiment, 0) / recentHalf.length
      : 0;
    const olderAvg = olderHalf.length > 0
      ? olderHalf.reduce((sum, a) => sum + a.sentiment, 0) / olderHalf.length
      : 0;

    let sentimentTrend: "IMPROVING" | "DECLINING" | "STABLE" = "STABLE";
    if (recentAvg - olderAvg > 0.1) sentimentTrend = "IMPROVING";
    else if (recentAvg - olderAvg < -0.1) sentimentTrend = "DECLINING";

    const summary: NewsSentimentSummary = {
      symbol,
      articleCount,
      avgSentiment,
      sentimentTrend,
      bullishCount,
      bearishCount,
      neutralCount,
      topArticles: allArticles.slice(0, 10),
      fetchedAt: new Date(),
    };

    const latencyMs = Date.now() - startTime;
    
    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: "News Sentiment Aggregated",
      summary: `Analyzed ${articleCount} articles for ${symbol}. Avg sentiment: ${avgSentiment.toFixed(2)}, Trend: ${sentimentTrend}`,
      payload: { 
        symbol, 
        articleCount, 
        avgSentiment: avgSentiment.toFixed(3),
        sentimentTrend,
        bullishCount,
        bearishCount,
        latencyMs,
      },
      traceId,
      symbol,
    });

    console.log(`[NEWS_SENTIMENT] trace_id=${traceId} symbol=${symbol} articles=${articleCount} avg=${avgSentiment.toFixed(2)} trend=${sentimentTrend} latency_ms=${latencyMs}`);

    return { success: true, data: summary };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const latencyMs = Date.now() - startTime;
    const fingerprint = generateRequestFingerprint("NEWS", { symbol });
    
    // Record all news providers as failed on catch-all error
    recordProviderFailure("Finnhub", errorMsg);
    recordProviderFailure("NewsAPI", errorMsg);
    recordProviderFailure("Marketaux", errorMsg);
    
    await logIntegrationRequest({
      source: "NEWS",
      traceId,
      botId,
      stage,
      symbol,
      provider: "MULTI",
      latencyMs,
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: errorMsg,
      requestFingerprint: fingerprint,
    });
    
    console.error(`[NEWS_SENTIMENT] trace_id=${traceId} error=${errorMsg} latency_ms=${latencyMs}`);
    return { success: false, error: errorMsg };
  }
}

export function getNewsTradingBias(sentiment: NewsSentimentSummary): {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  reasoning: string;
} {
  const { avgSentiment, sentimentTrend, bullishCount, bearishCount, articleCount } = sentiment;

  if (articleCount < 3) {
    return {
      bias: "NEUTRAL",
      confidence: 20,
      reasoning: "Insufficient news coverage for sentiment analysis",
    };
  }

  let bias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let confidence = 50;
  let reasoning = "";

  if (avgSentiment > 0.2) {
    bias = "BULLISH";
    confidence = Math.min(70 + avgSentiment * 30, 95);
    reasoning = `Positive news sentiment (${avgSentiment.toFixed(2)}) with ${bullishCount} bullish articles`;
  } else if (avgSentiment < -0.2) {
    bias = "BEARISH";
    confidence = Math.min(70 + Math.abs(avgSentiment) * 30, 95);
    reasoning = `Negative news sentiment (${avgSentiment.toFixed(2)}) with ${bearishCount} bearish articles`;
  } else {
    reasoning = `Mixed news sentiment (${avgSentiment.toFixed(2)})`;
  }

  if (sentimentTrend === "IMPROVING" && bias === "BULLISH") {
    confidence = Math.min(confidence + 10, 95);
    reasoning += ". Sentiment improving";
  } else if (sentimentTrend === "DECLINING" && bias === "BEARISH") {
    confidence = Math.min(confidence + 10, 95);
    reasoning += ". Sentiment declining";
  }

  return { bias, confidence, reasoning };
}
