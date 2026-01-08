/**
 * Databento Historical Data Client
 * 
 * Institutional-grade CME futures data fetching for backtesting.
 * Uses Databento REST API to fetch real OHLCV bars for MES/MNQ.
 * 
 * Dataset: GLBX.MDP3 (CME Globex MDP 3.0)
 * Symbols: MES (Micro E-mini S&P 500), MNQ (Micro E-mini Nasdaq-100)
 */

import { logActivityEvent } from "./activity-logger";
import { db } from "./db";
import { databentoRequests } from "@shared/schema";

const DATABENTO_API_URL = "https://hist.databento.com/v0";

// Raw Databento JSON structure (actual API response format)
export interface DatabentoRawBar {
  hd: {
    ts_event: string;  // Nanoseconds since epoch as string
    rtype: number;
    publisher_id: number;
    instrument_id: number;
  };
  open: string;      // Fixed-point integer as string (1e-9 scale)
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface DatabentoOHLCVBar {
  ts_event: number;  // Nanoseconds since epoch (bar open time)
  open: number;      // Fixed-point integer (1e-9 scale)
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

export interface DatabentoBar {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
}

export interface DatabentoRequest {
  dataset: string;
  symbols: string[];
  schema: "ohlcv-1s" | "ohlcv-1m" | "ohlcv-1h" | "ohlcv-1d";
  start: string;  // ISO 8601
  end: string;    // ISO 8601
  encoding?: "json" | "csv";
  stype_in?: "raw_symbol" | "parent" | "continuous";
}

export interface DatabentoResponse {
  bars: DatabentoBar[];
  metadata: {
    symbol: string;
    dataset: string;
    schema: string;
    startDate: string;
    endDate: string;
    barCount: number;
    queryLatencyMs: number;
    costEstimate?: number;
  };
}

// Symbol mapping for CME futures continuous contracts
// Use front-month continuous notation for Databento (e.g., MES.c.0 = front month)
const SYMBOL_MAPPING: Record<string, string> = {
  "MES": "MES.c.0",   // Micro E-mini S&P 500 (front month continuous)
  "MNQ": "MNQ.c.0",   // Micro E-mini Nasdaq-100 (front month continuous)
  "ES": "ES.c.0",     // E-mini S&P 500 (front month continuous)
  "NQ": "NQ.c.0",     // E-mini Nasdaq-100 (front month continuous)
};

// Price scale factor for Databento fixed-point prices
const PRICE_SCALE = 1e-9;

/**
 * Fetch historical OHLCV bars from Databento
 */
export async function fetchDatabentoHistoricalBars(
  symbol: string,
  startDate: Date,
  endDate: Date,
  timeframe: string,
  traceId: string
): Promise<DatabentoResponse> {
  const apiKey = process.env.DATABENTO_API_KEY;
  
  if (!apiKey) {
    throw new Error("DATABENTO_API_KEY not configured");
  }

  const mappedSymbol = SYMBOL_MAPPING[symbol.toUpperCase()] || symbol.toUpperCase();
  
  // Map timeframe to Databento schema
  const schemaMap: Record<string, DatabentoRequest["schema"]> = {
    "1s": "ohlcv-1s",
    "1m": "ohlcv-1m",
    "5m": "ohlcv-1m",   // Will resample 1m bars to 5m
    "15m": "ohlcv-1m",  // Will resample 1m bars to 15m
    "1h": "ohlcv-1h",
    "1d": "ohlcv-1d",
  };
  
  const schema = schemaMap[timeframe] || "ohlcv-1m";
  const needsResampling = ["5m", "15m"].includes(timeframe);
  const resampleFactor = timeframe === "5m" ? 5 : timeframe === "15m" ? 15 : 1;

  // Cap end date to midnight UTC today (Databento historical data is EOD-1)
  const todayMidnight = new Date();
  todayMidnight.setUTCHours(0, 0, 0, 0);
  const cappedEndDate = endDate > todayMidnight ? todayMidnight : endDate;

  // Build form data for Databento API (expects application/x-www-form-urlencoded)
  const formData = new URLSearchParams();
  formData.append("dataset", "GLBX.MDP3");
  formData.append("symbols", mappedSymbol);
  formData.append("schema", schema);
  formData.append("start", startDate.toISOString());
  formData.append("end", cappedEndDate.toISOString());
  formData.append("encoding", "json");
  formData.append("stype_in", "continuous");

  console.log(`[DATABENTO] trace_id=${traceId} fetching symbol=${mappedSymbol} start=${startDate.toISOString()} end=${cappedEndDate.toISOString()} schema=${schema}${endDate > todayMidnight ? ' (capped to EOD)' : ''}`);

  const queryStart = Date.now();

  try {
    // Databento uses HTTP Basic auth with API key as username, empty password
    const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
    
    const response = await fetch(`${DATABENTO_API_URL}/timeseries.get_range`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DATABENTO] trace_id=${traceId} error status=${response.status} body=${errorText}`);
      
      await logActivityEvent({
        eventType: "INTEGRATION_ERROR",
        severity: "ERROR",
        title: "Databento API Error",
        summary: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        payload: { 
          status: response.status, 
          symbol: mappedSymbol,
          error: errorText.substring(0, 500),
        },
        traceId,
      });
      
      throw new Error(`Databento API error: ${response.status} - ${errorText}`);
    }

    // Parse the streaming JSON response
    const rawText = await response.text();
    const lines = rawText.trim().split("\n").filter(line => line.length > 0);
    
    let bars: DatabentoBar[] = [];
    
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as DatabentoRawBar;
        
        // Skip records without proper header data
        if (!record.hd || !record.hd.ts_event) {
          continue;
        }
        
        // Convert nanoseconds to Date
        // ts_event is in hd.ts_event as a string of nanoseconds
        const ts = BigInt(record.hd.ts_event);
        const timeMs = Number(ts / 1000000n);
        
        const barDate = new Date(timeMs);
        
        // Skip invalid dates
        if (isNaN(barDate.getTime())) {
          continue;
        }
        
        // Parse string values and convert fixed-point prices to decimal
        const bar: DatabentoBar = {
          time: barDate,
          open: parseFloat(record.open) * PRICE_SCALE,
          high: parseFloat(record.high) * PRICE_SCALE,
          low: parseFloat(record.low) * PRICE_SCALE,
          close: parseFloat(record.close) * PRICE_SCALE,
          volume: parseInt(record.volume, 10),
          symbol: mappedSymbol,
        };
        
        bars.push(bar);
      } catch (parseError) {
        // Skip malformed lines (metadata lines, etc.)
        continue;
      }
    }

    // Resample if needed (5m, 15m)
    if (needsResampling && bars.length > 0) {
      bars = resampleBars(bars, resampleFactor);
    }

    const queryLatencyMs = Date.now() - queryStart;

    console.log(`[DATABENTO] trace_id=${traceId} fetched bars=${bars.length} latency=${queryLatencyMs}ms`);

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: "Databento Historical Data Fetched",
      summary: `${bars.length} ${timeframe} bars for ${mappedSymbol}`,
      payload: {
        symbol: mappedSymbol,
        barCount: bars.length,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        schema,
        latencyMs: queryLatencyMs,
      },
      traceId,
    });

    // Log to databento_requests table for institutional audit (SEV-0 requirement)
    const requestFingerprint = `${mappedSymbol}-${startDate.toISOString()}-${endDate.toISOString()}-${schema}`;
    await db.insert(databentoRequests).values({
      symbol: mappedSymbol,
      timeframe,
      startTs: startDate,
      endTs: endDate,
      dataset: "GLBX.MDP3",
      schema,
      barsReturned: bars.length,
      latencyMs: queryLatencyMs,
      httpStatus: 200,
      success: true,
      requestFingerprint,
      traceId,
    }).catch(err => {
      console.warn(`[DATABENTO] Failed to log request to audit table: ${err.message}`);
    });

    return {
      bars,
      metadata: {
        symbol: mappedSymbol,
        dataset: "GLBX.MDP3",
        schema,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        barCount: bars.length,
        queryLatencyMs,
      },
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const queryLatencyMs = Date.now() - queryStart;
    console.error(`[DATABENTO] trace_id=${traceId} fetch_error=${errorMessage}`);
    
    await logActivityEvent({
      eventType: "INTEGRATION_ERROR",
      severity: "ERROR",
      title: "Databento Fetch Failed",
      summary: errorMessage.substring(0, 200),
      payload: { symbol: mappedSymbol, error: errorMessage },
      traceId,
    });
    
    // Log failed request to audit table
    const requestFingerprint = `${mappedSymbol}-${startDate.toISOString()}-${endDate.toISOString()}-${schema}`;
    await db.insert(databentoRequests).values({
      symbol: mappedSymbol,
      timeframe,
      startTs: startDate,
      endTs: endDate,
      dataset: "GLBX.MDP3",
      schema,
      barsReturned: 0,
      latencyMs: queryLatencyMs,
      httpStatus: 0,
      success: false,
      errorMessage: errorMessage.substring(0, 500),
      requestFingerprint,
      traceId,
    }).catch(err => {
      console.warn(`[DATABENTO] Failed to log error request to audit table: ${err.message}`);
    });
    
    throw error;
  }
}

/**
 * Resample 1-minute bars to higher timeframes (5m, 15m)
 * Exported for use by bar cache when resampling cached 1m bars
 */
export function resampleBars(bars: DatabentoBar[], factor: number): DatabentoBar[] {
  if (bars.length === 0 || factor <= 1) return bars;
  
  const resampled: DatabentoBar[] = [];
  
  for (let i = 0; i < bars.length; i += factor) {
    const group = bars.slice(i, i + factor);
    if (group.length === 0) continue;
    
    const aggregated: DatabentoBar = {
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map(b => b.high)),
      low: Math.min(...group.map(b => b.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, b) => sum + b.volume, 0),
      symbol: group[0].symbol,
    };
    
    resampled.push(aggregated);
  }
  
  return resampled;
}

/**
 * Check if Databento is configured and reachable
 */
export async function verifyDatabentoConnection(traceId: string): Promise<{
  connected: boolean;
  message: string;
  datasets?: string[];
}> {
  const apiKey = process.env.DATABENTO_API_KEY;
  
  if (!apiKey) {
    return { connected: false, message: "DATABENTO_API_KEY not configured" };
  }

  try {
    // Databento uses HTTP Basic auth with API key as username, empty password
    const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
    
    const response = await fetch(`${DATABENTO_API_URL}/metadata.list_datasets`, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        connected: false, 
        message: `API error: ${response.status} - ${errorText.substring(0, 100)}` 
      };
    }

    const data = await response.json() as { datasets?: string[] } | string[];
    const datasets: string[] = Array.isArray(data) ? data : (data.datasets || []);
    
    // Check if GLBX.MDP3 (CME Globex) is available
    const hasCME = datasets.some((d: any) => 
      typeof d === "string" ? d.includes("GLBX") : d.dataset?.includes("GLBX")
    );

    console.log(`[DATABENTO] trace_id=${traceId} verified connection datasets=${datasets.length} has_cme=${hasCME}`);

    return {
      connected: true,
      message: hasCME ? "Connected to Databento with CME access" : "Connected but CME dataset may not be accessible",
      datasets: datasets.slice(0, 10),
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { connected: false, message };
  }
}

/**
 * Estimate cost for a historical data query
 */
export async function estimateDataCost(
  symbol: string,
  startDate: Date,
  endDate: Date,
  schema: string,
  traceId: string
): Promise<{ cost: number; records: number } | null> {
  const apiKey = process.env.DATABENTO_API_KEY;
  
  if (!apiKey) return null;

  try {
    // Databento uses HTTP Basic auth with API key as username, empty password
    const basicAuth = Buffer.from(`${apiKey}:`).toString('base64');
    
    const response = await fetch(`${DATABENTO_API_URL}/metadata.get_cost`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataset: "GLBX.MDP3",
        symbols: [symbol],
        schema,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { cost?: number; size?: number };
    return {
      cost: data.cost || 0,
      records: data.size || 0,
    };
  } catch {
    return null;
  }
}
