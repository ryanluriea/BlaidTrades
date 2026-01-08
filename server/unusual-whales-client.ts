import { logActivityEvent } from "./activity-logger";
import { logIntegrationRequest, generateRequestFingerprint } from "./request-logger";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health";

export interface OptionsFlowSignal {
  symbol: string;
  underlying: string;
  contractType: "CALL" | "PUT";
  strike: number;
  expiry: string;
  premium: number;
  volume: number;
  openInterest: number;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  size: "SMALL" | "MEDIUM" | "LARGE" | "SWEEP";
  timestamp: Date;
  alertType?: string;
}

export interface FlowSummary {
  symbol: string;
  callPremium: number;
  putPremium: number;
  callVolume: number;
  putVolume: number;
  putCallRatio: number;
  netSentiment: number;
  topStrikes: Array<{ strike: number; volume: number; type: "CALL" | "PUT" }>;
  signals: OptionsFlowSignal[];
  fetchedAt: Date;
}

export async function fetchOptionsFlow(
  symbol: string,
  traceId: string,
  botId?: string,
  stage?: string
): Promise<{ success: boolean; data?: FlowSummary; error?: string }> {
  const apiKey = process.env.UNUSUAL_WHALES_API_KEY;
  const startTime = Date.now();
  const endpoint = `api.unusualwhales.com/api/option-trades/flow-alerts?ticker=${symbol}`;
  const fingerprint = generateRequestFingerprint("OPTIONS_FLOW", { symbol });
  
  if (!apiKey) {
    await logIntegrationRequest({
      source: "OPTIONS_FLOW",
      traceId,
      botId,
      stage,
      symbol,
      provider: "UNUSUAL_WHALES",
      endpoint,
      latencyMs: Date.now() - startTime,
      success: false,
      errorCode: "NO_API_KEY",
      errorMessage: "UNUSUAL_WHALES_API_KEY not configured",
      requestFingerprint: fingerprint,
    });
    return { success: false, error: "UNUSUAL_WHALES_API_KEY not configured" };
  }

  try {
    const response = await fetch(
      `https://api.unusualwhales.com/api/option-trades/flow-alerts?ticker=${symbol}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      const latencyMs = Date.now() - startTime;
      await logIntegrationRequest({
        source: "OPTIONS_FLOW",
        traceId,
        botId,
        stage,
        symbol,
        provider: "UNUSUAL_WHALES",
        endpoint,
        latencyMs,
        success: false,
        errorCode: `HTTP_${response.status}`,
        errorMessage: `${response.status} ${response.statusText}`,
        requestFingerprint: fingerprint,
      });
      return { 
        success: false, 
        error: `Unusual Whales API error: ${response.status} ${response.statusText}` 
      };
    }

    const rawData = await response.json() as { data?: unknown[] };
    
    const signals: OptionsFlowSignal[] = [];
    let callPremium = 0;
    let putPremium = 0;
    let callVolume = 0;
    let putVolume = 0;
    const strikeMap = new Map<string, { strike: number; volume: number; type: "CALL" | "PUT" }>();

    if (Array.isArray(rawData?.data)) {
      for (const item of rawData.data as any[]) {
        const contractType = item.option_type?.toUpperCase() === "CALL" ? "CALL" : "PUT";
        const premium = parseFloat(item.premium) || 0;
        const volume = parseInt(item.volume) || 0;
        
        if (contractType === "CALL") {
          callPremium += premium;
          callVolume += volume;
        } else {
          putPremium += premium;
          putVolume += volume;
        }

        const strikeKey = `${item.strike}-${contractType}`;
        const existing = strikeMap.get(strikeKey);
        if (existing) {
          existing.volume += volume;
        } else {
          strikeMap.set(strikeKey, {
            strike: parseFloat(item.strike) || 0,
            volume,
            type: contractType,
          });
        }

        let size: "SMALL" | "MEDIUM" | "LARGE" | "SWEEP" = "SMALL";
        if (premium >= 1000000) size = "SWEEP";
        else if (premium >= 250000) size = "LARGE";
        else if (premium >= 50000) size = "MEDIUM";

        let sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
        if (item.sentiment?.toLowerCase().includes("bullish")) sentiment = "BULLISH";
        else if (item.sentiment?.toLowerCase().includes("bearish")) sentiment = "BEARISH";

        signals.push({
          symbol: item.symbol || symbol,
          underlying: item.underlying || symbol,
          contractType,
          strike: parseFloat(item.strike) || 0,
          expiry: item.expiry || "",
          premium,
          volume,
          openInterest: parseInt(item.open_interest) || 0,
          sentiment,
          size,
          timestamp: new Date(item.created_at || Date.now()),
          alertType: item.alert_type,
        });
      }
    }

    const topStrikes = Array.from(strikeMap.values())
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);

    const putCallRatio = callVolume > 0 ? putVolume / callVolume : 0;
    const totalPremium = callPremium + putPremium;
    const netSentiment = totalPremium > 0 
      ? (callPremium - putPremium) / totalPremium 
      : 0;

    const flowSummary: FlowSummary = {
      symbol,
      callPremium,
      putPremium,
      callVolume,
      putVolume,
      putCallRatio,
      netSentiment,
      topStrikes,
      signals: signals.slice(0, 50),
      fetchedAt: new Date(),
    };

    const latencyMs = Date.now() - startTime;
    
    // Record provider health for institutional monitoring
    recordProviderSuccess("Unusual Whales", latencyMs);
    
    await logIntegrationRequest({
      source: "OPTIONS_FLOW",
      traceId,
      botId,
      stage,
      symbol,
      provider: "UNUSUAL_WHALES",
      endpoint,
      recordsReturned: signals.length,
      latencyMs,
      success: true,
      requestFingerprint: fingerprint,
    });

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: "Unusual Whales Options Flow Fetched",
      summary: `Retrieved ${signals.length} flow alerts for ${symbol}`,
      payload: { 
        symbol, 
        signalCount: signals.length, 
        netSentiment: netSentiment.toFixed(3),
        putCallRatio: putCallRatio.toFixed(2),
        latencyMs,
      },
      traceId,
      symbol,
    });

    console.log(`[UNUSUAL_WHALES] trace_id=${traceId} symbol=${symbol} signals=${signals.length} net_sentiment=${netSentiment.toFixed(3)} latency_ms=${latencyMs}`);

    return { success: true, data: flowSummary };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const latencyMs = Date.now() - startTime;
    
    // Record provider failure for health monitoring
    recordProviderFailure("Unusual Whales", errorMsg);
    
    await logIntegrationRequest({
      source: "OPTIONS_FLOW",
      traceId,
      botId,
      stage,
      symbol,
      provider: "UNUSUAL_WHALES",
      endpoint,
      latencyMs,
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: errorMsg,
      requestFingerprint: fingerprint,
    });
    
    console.error(`[UNUSUAL_WHALES] trace_id=${traceId} error=${errorMsg} latency_ms=${latencyMs}`);
    return { success: false, error: errorMsg };
  }
}

export function interpretFlowSignal(flow: FlowSummary): {
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  reasoning: string;
} {
  const { netSentiment, putCallRatio, callPremium, putPremium, signals } = flow;

  let confidence = Math.min(Math.abs(netSentiment) * 100, 100);
  let bias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  let reasoning = "";

  if (netSentiment > 0.3) {
    bias = "BULLISH";
    reasoning = `Strong call premium dominance (${(netSentiment * 100).toFixed(0)}% net bullish)`;
  } else if (netSentiment < -0.3) {
    bias = "BEARISH";
    reasoning = `Strong put premium dominance (${(Math.abs(netSentiment) * 100).toFixed(0)}% net bearish)`;
  } else {
    reasoning = "Mixed flow signals, no clear directional bias";
    confidence = 30;
  }

  const largeSweeps = signals.filter(s => s.size === "SWEEP" || s.size === "LARGE");
  if (largeSweeps.length >= 3) {
    confidence = Math.min(confidence + 20, 100);
    reasoning += `. ${largeSweeps.length} large/sweep orders detected`;
  }

  if (putCallRatio > 2) {
    if (bias === "NEUTRAL") {
      bias = "BEARISH";
      reasoning = `High put/call ratio (${putCallRatio.toFixed(2)}) suggests hedging or bearish positioning`;
    }
  } else if (putCallRatio < 0.5 && callPremium > 100000) {
    if (bias === "NEUTRAL") {
      bias = "BULLISH";
      reasoning = `Low put/call ratio (${putCallRatio.toFixed(2)}) with significant call premium`;
    }
  }

  return { bias, confidence, reasoning };
}
