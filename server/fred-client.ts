import { logActivityEvent } from "./activity-logger";
import { logIntegrationRequest, generateRequestFingerprint } from "./request-logger";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health";

export interface FREDSeries {
  seriesId: string;
  title: string;
  value: number;
  date: string;
  units: string;
  frequency: string;
}

export interface MacroSnapshot {
  gdpGrowth?: FREDSeries;
  unemploymentRate?: FREDSeries;
  federalFundsRate?: FREDSeries;
  cpi?: FREDSeries;
  pce?: FREDSeries;
  yieldCurve?: FREDSeries;
  vix?: FREDSeries;
  regime: "EXPANSION" | "CONTRACTION" | "RECESSION" | "RECOVERY" | "UNKNOWN";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
  fetchedAt: Date;
}

const FRED_SERIES = {
  GDP_GROWTH: "A191RL1Q225SBEA",
  UNEMPLOYMENT: "UNRATE",
  FED_FUNDS: "FEDFUNDS",
  CPI: "CPIAUCSL",
  PCE: "PCEPI",
  YIELD_SPREAD: "T10Y2Y",
  VIX: "VIXCLS",
};

async function fetchFREDSeries(
  seriesId: string,
  apiKey: string
): Promise<FREDSeries | null> {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`[FRED] Failed to fetch ${seriesId}: ${response.status}`);
      return null;
    }

    const data = await response.json() as { observations?: Array<{ date: string; value: string }> };
    
    if (!data.observations || data.observations.length === 0) {
      return null;
    }

    const latest = data.observations[0];
    const value = parseFloat(latest.value);
    
    if (isNaN(value)) {
      return null;
    }

    const seriesInfoUrl = `https://api.stlouisfed.org/fred/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;
    const seriesResponse = await fetch(seriesInfoUrl);
    let title = seriesId;
    let units = "";
    let frequency = "";
    
    if (seriesResponse.ok) {
      const seriesData = await seriesResponse.json() as { seriess?: Array<{ title?: string; units?: string; frequency?: string }> };
      if (seriesData.seriess && seriesData.seriess.length > 0) {
        title = seriesData.seriess[0].title || seriesId;
        units = seriesData.seriess[0].units || "";
        frequency = seriesData.seriess[0].frequency || "";
      }
    }

    return {
      seriesId,
      title,
      value,
      date: latest.date,
      units,
      frequency,
    };
  } catch (error) {
    console.error(`[FRED] Error fetching ${seriesId}:`, error);
    return null;
  }
}

export async function fetchMacroSnapshot(
  traceId: string,
  botId?: string,
  stage?: string
): Promise<{ success: boolean; data?: MacroSnapshot; error?: string }> {
  const apiKey = process.env.FRED_API_KEY;
  const startTime = Date.now();
  const seriesIds = Object.values(FRED_SERIES);
  const fingerprint = generateRequestFingerprint("MACRO", { seriesIds: seriesIds.join(",") });
  
  if (!apiKey) {
    await logIntegrationRequest({
      source: "MACRO",
      traceId,
      botId,
      stage,
      seriesIds,
      provider: "FRED",
      endpoint: "api.stlouisfed.org",
      latencyMs: Date.now() - startTime,
      success: false,
      errorCode: "NO_API_KEY",
      errorMessage: "FRED_API_KEY not configured",
      requestFingerprint: fingerprint,
    });
    return { success: false, error: "FRED_API_KEY not configured" };
  }

  try {
    const [gdpGrowth, unemploymentRate, federalFundsRate, cpi, pce, yieldCurve, vix] = 
      await Promise.all([
        fetchFREDSeries(FRED_SERIES.GDP_GROWTH, apiKey),
        fetchFREDSeries(FRED_SERIES.UNEMPLOYMENT, apiKey),
        fetchFREDSeries(FRED_SERIES.FED_FUNDS, apiKey),
        fetchFREDSeries(FRED_SERIES.CPI, apiKey),
        fetchFREDSeries(FRED_SERIES.PCE, apiKey),
        fetchFREDSeries(FRED_SERIES.YIELD_SPREAD, apiKey),
        fetchFREDSeries(FRED_SERIES.VIX, apiKey),
      ]);

    const regime = determineEconomicRegime(gdpGrowth, unemploymentRate, yieldCurve);
    const riskLevel = determineRiskLevel(vix, yieldCurve, federalFundsRate);

    const snapshot: MacroSnapshot = {
      gdpGrowth: gdpGrowth || undefined,
      unemploymentRate: unemploymentRate || undefined,
      federalFundsRate: federalFundsRate || undefined,
      cpi: cpi || undefined,
      pce: pce || undefined,
      yieldCurve: yieldCurve || undefined,
      vix: vix || undefined,
      regime,
      riskLevel,
      fetchedAt: new Date(),
    };

    const fetchedCount = [gdpGrowth, unemploymentRate, federalFundsRate, cpi, pce, yieldCurve, vix]
      .filter(Boolean).length;
    const latencyMs = Date.now() - startTime;

    // Record provider health for institutional monitoring
    recordProviderSuccess("FRED", latencyMs);
    
    await logIntegrationRequest({
      source: "MACRO",
      traceId,
      botId,
      stage,
      seriesIds,
      provider: "FRED",
      endpoint: "api.stlouisfed.org",
      recordsReturned: fetchedCount,
      latencyMs,
      success: true,
      requestFingerprint: fingerprint,
    });

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: "FRED Macro Snapshot Fetched",
      summary: `Retrieved ${fetchedCount}/7 macro indicators. Regime: ${regime}, Risk: ${riskLevel}`,
      payload: { 
        regime, 
        riskLevel, 
        indicatorsCount: fetchedCount,
        gdp: gdpGrowth?.value,
        unemployment: unemploymentRate?.value,
        vix: vix?.value,
        latencyMs,
      },
      traceId,
    });

    console.log(`[FRED] trace_id=${traceId} indicators=${fetchedCount} regime=${regime} risk=${riskLevel} latency_ms=${latencyMs}`);

    return { success: true, data: snapshot };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const latencyMs = Date.now() - startTime;
    
    // Record provider failure for health monitoring
    recordProviderFailure("FRED", errorMsg);
    
    await logIntegrationRequest({
      source: "MACRO",
      traceId,
      botId,
      stage,
      seriesIds,
      provider: "FRED",
      endpoint: "api.stlouisfed.org",
      latencyMs,
      success: false,
      errorCode: "FETCH_ERROR",
      errorMessage: errorMsg,
      requestFingerprint: fingerprint,
    });
    
    console.error(`[FRED] trace_id=${traceId} error=${errorMsg} latency_ms=${latencyMs}`);
    return { success: false, error: errorMsg };
  }
}

function determineEconomicRegime(
  gdp: FREDSeries | null,
  unemployment: FREDSeries | null,
  yieldSpread: FREDSeries | null
): "EXPANSION" | "CONTRACTION" | "RECESSION" | "RECOVERY" | "UNKNOWN" {
  if (!gdp) return "UNKNOWN";

  const gdpGrowth = gdp.value;
  const unemploymentRate = unemployment?.value || 5;
  const spread = yieldSpread?.value || 0;

  if (gdpGrowth < 0 && spread < 0) {
    return "RECESSION";
  }
  
  if (gdpGrowth < 0 && spread >= 0) {
    return "CONTRACTION";
  }
  
  if (gdpGrowth > 0 && gdpGrowth < 2 && unemploymentRate > 5) {
    return "RECOVERY";
  }
  
  if (gdpGrowth >= 2) {
    return "EXPANSION";
  }

  return "UNKNOWN";
}

function determineRiskLevel(
  vix: FREDSeries | null,
  yieldSpread: FREDSeries | null,
  fedFunds: FREDSeries | null
): "LOW" | "MEDIUM" | "HIGH" | "EXTREME" {
  const vixValue = vix?.value || 15;
  const spread = yieldSpread?.value || 1;

  if (vixValue > 35 || spread < -0.5) {
    return "EXTREME";
  }
  
  if (vixValue > 25 || spread < 0) {
    return "HIGH";
  }
  
  if (vixValue > 18 || spread < 0.5) {
    return "MEDIUM";
  }

  return "LOW";
}

export function getMacroTradingBias(snapshot: MacroSnapshot): {
  bias: "RISK_ON" | "RISK_OFF" | "NEUTRAL";
  positionSizeMultiplier: number;
  reasoning: string;
} {
  const { regime, riskLevel, vix, yieldCurve } = snapshot;

  if (riskLevel === "EXTREME") {
    return {
      bias: "RISK_OFF",
      positionSizeMultiplier: 0.25,
      reasoning: `Extreme risk conditions (VIX: ${vix?.value?.toFixed(1) || 'N/A'}). Reduce position sizes significantly.`,
    };
  }

  if (riskLevel === "HIGH") {
    return {
      bias: "RISK_OFF",
      positionSizeMultiplier: 0.5,
      reasoning: `Elevated risk (${regime} regime, inverted yield curve). Trade with caution.`,
    };
  }

  if (regime === "EXPANSION" && riskLevel === "LOW") {
    return {
      bias: "RISK_ON",
      positionSizeMultiplier: 1.0,
      reasoning: `Favorable macro conditions. Economic expansion with low volatility.`,
    };
  }

  return {
    bias: "NEUTRAL",
    positionSizeMultiplier: 0.75,
    reasoning: `Mixed macro signals. ${regime} regime with ${riskLevel.toLowerCase()} risk.`,
  };
}
