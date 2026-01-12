/**
 * Ironbeam Live Market Data Client
 * 
 * Real-time WebSocket streaming for CME futures (MES, MNQ, ES, NQ).
 * Uses Ironbeam's REST API for auth + WebSocket for quote streaming.
 * Aggregates ticks into 1-minute OHLCV bars for paper trading.
 * 
 * API: https://docs.ironbeamapi.com/
 */

import { EventEmitter } from "events";
import WebSocket from "ws";
import { logActivityEvent } from "./activity-logger";
import { logIntegrationUsage } from "./integration-usage";

// Ironbeam API v2 - all REST endpoints use v2
const IRONBEAM_API_URL = process.env.IRONBEAM_ENV === "live" 
  ? "https://live.ironbeamapi.com/v2" 
  : "https://demo.ironbeamapi.com/v2";

// WebSocket uses v1 (REST is v2 but WebSocket streams are v1 per community reports)
const IRONBEAM_WS_URL = process.env.IRONBEAM_ENV === "live"
  ? "wss://live.ironbeamapi.com/v1/stream"
  : "wss://demo.ironbeamapi.com/v1/stream";

// Month codes for futures contracts
const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];

// Get current front-month contract code for CME equity index futures (quarterly: H, M, U, Z)
function getFrontMonthCode(): string {
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-11
  const currentYear = now.getFullYear() % 100; // 2-digit year
  const dayOfMonth = now.getDate();
  
  // CME equity index futures expire quarterly: Mar (H), Jun (M), Sep (U), Dec (Z)
  // Quarterly month indices: 2 (Mar), 5 (Jun), 8 (Sep), 11 (Dec)
  const quarterlyMonths = [2, 5, 8, 11];
  
  let contractMonth: number | null = null;
  let contractYear = currentYear;
  
  // Find the current or next quarterly expiration
  // Roll to next quarter if we're past day 10 of an expiration month
  for (let offset = 0; offset < 5; offset++) {
    const checkMonth = (currentMonth + offset) % 12;
    const yearOffset = Math.floor((currentMonth + offset) / 12);
    
    if (quarterlyMonths.includes(checkMonth)) {
      // If this is the current month and we're past day 10, skip to next quarter
      if (offset === 0 && dayOfMonth > 10) {
        continue;
      }
      contractMonth = checkMonth;
      contractYear = currentYear + yearOffset;
      break;
    }
  }
  
  // Fallback to March of next year only if loop didn't find anything
  if (contractMonth === null) {
    contractMonth = 2; // March
    contractYear = currentYear + 1;
  }
  
  const monthCode = MONTH_CODES[contractMonth];
  const yearStr = String(contractYear % 100).padStart(2, '0');
  console.log(`[IRONBEAM_LIVE] front_month_calc: month=${currentMonth} day=${dayOfMonth} -> ${monthCode}${yearStr}`);
  return `${monthCode}${yearStr}`;
}

// Dynamic symbol mapping with current front-month contract
function getSymbolMapping(): Record<string, string> {
  const frontMonth = getFrontMonthCode();
  return {
    "MES": `XCME:MES.${frontMonth}`,
    "MNQ": `XCME:MNQ.${frontMonth}`,
    "ES": `XCME:ES.${frontMonth}`,
    "NQ": `XCME:NQ.${frontMonth}`,
  };
}

export interface IronbeamQuote {
  exchSym: string;
  bidPrice: number;
  askPrice: number;
  lastPrice: number;
  lastSize: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  timestamp: Date;
}

// ============================================================================
// ORDER EXECUTION TYPES - Institutional-grade order management
// ============================================================================

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type OrderStatus = "PENDING" | "SUBMITTED" | "WORKING" | "PARTIAL" | "FILLED" | "CANCELLED" | "REJECTED" | "EXPIRED";

export interface IronbeamOrder {
  symbol: string;
  side: OrderSide;
  quantity: number;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: "DAY" | "GTC" | "IOC" | "FOK";
  accountId?: string;
  clientOrderId?: string;
}

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  status: OrderStatus;
  filledQty: number;
  avgPrice: number;
  remainingQty: number;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  submittedAt: Date;
  updatedAt: Date;
  error?: string;
  errorCode?: string;
  simulated?: boolean;
}

export interface IronbeamPosition {
  symbol: string;
  quantity: number;
  side: "LONG" | "SHORT" | "FLAT";
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  accountId: string;
  timestamp: Date;
}

export interface CancelResult {
  orderId: string;
  success: boolean;
  message: string;
  error?: string;
}

export interface StageGateResult {
  allowed: boolean;
  reason: string;
  stage: string;
  environment: string;
  simulateOnly: boolean;
}

export interface LiveBar {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  symbol: string;
  timeframe: string;
}

/**
 * LEVEL 2 ORDER BOOK - Market Depth for execution quality
 * Industry standard: Track bid/ask levels for spread analysis, 
 * liquidity assessment, and dynamic slippage estimation
 */
export interface OrderBookLevel {
  price: number;
  size: number;
  timestamp: Date;
}

export interface OrderBookSnapshot {
  symbol: string;
  timestamp: Date;
  bids: OrderBookLevel[];  // Sorted high to low (best bid first)
  asks: OrderBookLevel[];  // Sorted low to high (best ask first)
  spread: number;          // Ask - Bid (in ticks)
  spreadPct: number;       // Spread as percentage of mid price
  midPrice: number;        // (Best Ask + Best Bid) / 2
  imbalance: number;       // (Bid Size - Ask Size) / (Bid Size + Ask Size), range [-1, 1]
  liquidityScore: number;  // Combined depth score (0-100)
}

export interface MarketMicrostructure {
  symbol: string;
  currentSpread: number;
  avgSpread5m: number;
  avgSpread1h: number;
  volatility5m: number;    // Price volatility last 5 minutes
  imbalance: number;       // Current order flow imbalance
  liquidityScore: number;  // 0-100 based on book depth
  suggestedSlippageTicks: number;  // Dynamic slippage based on conditions
  timestamp: Date;
}

interface BarBuilder {
  symbol: string;
  startTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
}

export class IronbeamLiveClient extends EventEmitter {
  private token: string | null = null;
  private streamId: string | null = null;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0; // Tracks total attempts (no limit - infinite retry)
  private reconnectDelayMs = 1000; // Initial delay, doubles with exponential backoff
  private maxReconnectDelayMs = 300_000; // 5 minute max delay (cap on exponential backoff)
  private isConnected = false;
  private subscribedSymbols: Set<string> = new Set();
  private barBuilders: Map<string, BarBuilder> = new Map();
  private barEmitInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private staleCheckInterval: NodeJS.Timeout | null = null;
  private lastQuoteTime: Date | null = null;
  private traceId: string;
  private credentialSet: 1 | 2 | 3;
  private consecutiveFailures = 0;
  private lastSuccessfulConnection: Date | null = null;
  private isReconnecting = false;
  private readonly STALE_THRESHOLD_MS = 120_000; // 2 minutes without quotes = stale
  private readonly MARKET_HOURS_CHECK = true; // Skip stale check outside market hours
  
  // LEVEL 2 ORDER BOOK TRACKING
  private orderBooks: Map<string, OrderBookSnapshot> = new Map();
  private spreadHistory: Map<string, { timestamp: Date; spread: number }[]> = new Map();
  private priceHistory: Map<string, { timestamp: Date; price: number }[]> = new Map();
  private readonly SPREAD_HISTORY_MAX_SIZE = 720;  // 1 hour at 5s updates
  private readonly PRICE_HISTORY_MAX_SIZE = 300;   // 5 min at 1s updates
  
  private subscriptionSucceeded = false;
  private subscribedStreamId: string | null = null;
  private subscribedFrontMonth: string | null = null;
  private entitlementFailedSymbols: Set<string> = new Set();

  constructor(credentialSet: 1 | 2 | 3 = 1) {
    super();
    this.credentialSet = credentialSet;
    this.traceId = crypto.randomUUID().slice(0, 8);
  }

  private getCredentials(): { username: string; password: string; apiKey: string } | null {
    const suffix = this.credentialSet === 1 ? "_1" : this.credentialSet === 2 ? "_2" : "_3";
    const username = process.env[`IRONBEAM_USERNAME${suffix}`];
    const password = process.env[`IRONBEAM_PASSWORD${suffix}`];
    const apiKey = process.env[`IRONBEAM_API_KEY${suffix}`];

    if (!username || !password || !apiKey) {
      return null;
    }
    return { username, password, apiKey };
  }

  async authenticate(): Promise<boolean> {
    const creds = this.getCredentials();
    if (!creds) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} credentials not configured for set ${this.credentialSet}`);
      return false;
    }

    // Debug: Log credential presence (not values)
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} auth attempt: username_len=${creds.username.length} password_len=${creds.password.length} apiKey_len=${creds.apiKey.length} env=${process.env.IRONBEAM_ENV || 'demo'}`);

    try {
      // Ironbeam API expects JSON with specific field naming
      const response = await fetch(`${IRONBEAM_API_URL}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Username: creds.username,
          Password: creds.password,
          ApiKey: creds.apiKey,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} auth failed: ${response.status} - ${errorText}`);
        return false;
      }

      const data = await response.json() as { token?: string };
      if (!data.token) {
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} auth response missing token`);
        return false;
      }

      this.token = data.token;
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} authenticated successfully`);
      
      await logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: "Ironbeam Live Authenticated",
        summary: `Credential set ${this.credentialSet} authenticated`,
        payload: { credentialSet: this.credentialSet },
        traceId: this.traceId,
      });

      await logIntegrationUsage({
        provider: "ironbeam",
        operation: "broker_auth",
        status: "OK",
        latencyMs: 0,
        traceId: this.traceId,
        metadata: { credentialSet: this.credentialSet, env: process.env.IRONBEAM_ENV || "demo" },
      });

      return true;
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} auth error:`, error);
      return false;
    }
  }

  async createStream(): Promise<boolean> {
    if (!this.token) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cannot create stream - not authenticated`);
      return false;
    }

    try {
      // Ironbeam API: GET /v2/stream/create to obtain streamId
      // Python example in docs uses requests.get() for this endpoint
      // 405 error with POST indicates GET is correct method for live environment
      const response = await fetch(`${IRONBEAM_API_URL}/stream/create`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} create stream failed: ${response.status} - ${errorText}`);
        return false;
      }

      const data = await response.json() as { streamId?: string };
      if (!data.streamId) {
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} stream response missing streamId`);
        return false;
      }

      this.streamId = data.streamId;
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} stream created: ${this.streamId}`);
      return true;
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} create stream error:`, error);
      return false;
    }
  }

  // Store pending symbols to subscribe after WebSocket connects
  private pendingSymbols: string[] = [];

  async subscribeToQuotes(symbols: string[]): Promise<boolean> {
    if (!this.token || !this.streamId) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cannot subscribe - missing token or streamId`);
      return false;
    }

    const symbolMapping = getSymbolMapping();
    const instruments = symbols.map(s => symbolMapping[s.toUpperCase()] || `XCME:${s.toUpperCase()}`);
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscribing to: ${instruments.join(", ")}`);

    // Store symbols for subscription after WebSocket connects
    this.pendingSymbols = symbols;
    this.pendingInstruments = instruments;
    
    // If already connected, subscribe via REST API now
    if (this.isConnected) {
      return this.subscribeViaRestApi(instruments);
    }

    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} queued ${symbols.length} symbols for subscription after connect`);
    return true;
  }

  private pendingInstruments: string[] = [];
  
  // Method 3: Subscribe via WebSocket message (based on quantDIY Python framework)
  // Some Ironbeam setups use WebSocket messages instead of REST API for subscriptions
  private subscribeViaWebSocket(instruments: string[]): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cannot subscribe via WS - not connected`);
      return false;
    }
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} trying WebSocket subscription for: ${instruments.join(", ")}`);
    
    try {
      // Try multiple subscription message formats
      // Format 1: Per quantDIY Python code - subscribe to trades/quotes per symbol
      for (const instrument of instruments) {
        // Try quotes subscription
        const quotesMsg = JSON.stringify({
          action: "subscribe",
          type: "quotes",
          symbol: instrument,
          flags: ["live"]
        });
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WS subscribe quotes: ${instrument}`);
        this.ws.send(quotesMsg);
        
        // Also try trades subscription
        const tradesMsg = JSON.stringify({
          action: "subscribe",
          type: "trades",
          symbol: instrument,
          flags: ["live"]
        });
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WS subscribe trades: ${instrument}`);
        this.ws.send(tradesMsg);
      }
      
      // Format 2: Batch subscription message
      const batchMsg = JSON.stringify({
        action: "subscribe",
        type: "quotes",
        symbols: instruments,
        flags: ["live"]
      });
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WS batch subscribe: ${instruments.length} symbols`);
      this.ws.send(batchMsg);
      
      // Mark symbols as subscribed (optimistically - we'll detect failures via lack of quote data)
      this.pendingSymbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
      
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket subscription messages sent`);
      return true;  // Messages sent - may still fail if API doesn't support this method
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket subscribe error:`, error);
      return false;
    }
  }

  // Ironbeam requires REST API call to subscribe after WebSocket is connected
  // Documentation: GET /v2/market/quotes/subscribe/{streamId}?instruments=...
  private async subscribeViaRestApi(instruments: string[]): Promise<boolean> {
    const currentFrontMonth = getFrontMonthCode();
    
    if (this.subscriptionSucceeded && 
        this.subscribedStreamId === this.streamId && 
        this.subscribedFrontMonth === currentFrontMonth) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscription already active for current stream/contract, skipping`);
      return true;
    }
    
    if (this.subscribedFrontMonth && this.subscribedFrontMonth !== currentFrontMonth) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} CONTRACT_ROLL detected: ${this.subscribedFrontMonth} -> ${currentFrontMonth}, resubscribing`);
      this.subscriptionSucceeded = false;
      this.entitlementFailedSymbols.clear();
    }
    
    const validInstruments = instruments.filter(i => !this.entitlementFailedSymbols.has(i));
    if (validInstruments.length === 0) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} all instruments have failed entitlements`);
      return false;
    }
    
    if (validInstruments.length < instruments.length) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} skipping ${instruments.length - validInstruments.length} entitlement-failed symbols`);
    }
    
    try {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscribing via REST API: ${validInstruments.join(", ")}`);
      
      const params = new URLSearchParams();
      validInstruments.forEach(i => params.append("symbols", i));
      const primaryUrl = `${IRONBEAM_API_URL}/market/quotes/subscribe/${this.streamId}?${params.toString()}`;
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} trying: GET /v2/market/quotes/subscribe/{streamId}?symbols=X&symbols=Y`);
      
      let response = await fetch(primaryUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} multi-param failed (${response.status}): ${errorText}, trying comma-separated...`);
        
        if (response.status === 400 && (errorText.includes("Can't subscribe") || errorText.includes("not entitled"))) {
          validInstruments.forEach(i => this.entitlementFailedSymbols.add(i));
          console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} ENTITLEMENT_FAILURE: Marked ${validInstruments.length} symbols as failed`);
          await logActivityEvent({
            eventType: "INTEGRATION_ERROR",
            severity: "ERROR",
            title: "Ironbeam Entitlement Failure",
            summary: `Entitlement failed for: ${validInstruments.join(", ")}`,
            payload: { error: errorText, instruments: validInstruments },
            traceId: this.traceId,
          });
          return false;
        }
        
        const symbolsParam = validInstruments.join(",");
        const altUrl = `${IRONBEAM_API_URL}/market/quotes/subscribe/${this.streamId}?symbols=${encodeURIComponent(symbolsParam)}`;
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} trying: GET /v2/market/quotes/subscribe/{streamId}?symbols=...`);
        
        response = await fetch(altUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${this.token}`,
          },
        });
      }

      if (response.ok) {
        const data = await response.json();
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscribe quotes SUCCESS: ${JSON.stringify(data)}`);
        this.pendingSymbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
        this.subscriptionSucceeded = true;
        this.subscribedStreamId = this.streamId;
        this.subscribedFrontMonth = currentFrontMonth;
        
        await logActivityEvent({
          eventType: "INTEGRATION_PROOF",
          severity: "INFO",
          title: "Ironbeam Quote Subscription Active",
          summary: `Subscribed to ${validInstruments.length} symbols: ${validInstruments.join(", ")}`,
          payload: { symbols: validInstruments, streamId: this.streamId, frontMonth: currentFrontMonth },
          traceId: this.traceId,
        });
        
        return true;
      }
      
      const errorText = await response.text();
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscribe quotes failed: ${response.status} - ${errorText}`);
      
      if (response.status === 400 && (errorText.includes("Can't subscribe") || errorText.includes("not entitled"))) {
        validInstruments.forEach(i => this.entitlementFailedSymbols.add(i));
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} ENTITLEMENT_FAILURE: Marked ${validInstruments.length} symbols as failed`);
        return false;
      }
      
      await this.checkSecurityDefinitions(validInstruments);
      
      return false;
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} subscribe error:`, error);
      return false;
    }
  }
  
  // Emit subscription_failed event - called only after ALL subscription methods fail
  emitSubscriptionFailed(instruments: string[]): void {
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} all subscription methods failed - emitting event`);
    this.emit("subscription_failed", {
      traceId: this.traceId,
      instruments,
    });
  }

  // Check if account has entitlements for the requested symbols
  private async checkSecurityDefinitions(instruments: string[]): Promise<void> {
    try {
      const params = new URLSearchParams();
      instruments.forEach(i => params.append("exchangeSymbols", i));
      
      const url = `${IRONBEAM_API_URL}/marketData/getSecurityDefinitions?${params.toString()}`;
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} checking entitlements via ${url.replace(this.streamId || "", "STREAM_ID")}`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { definitions?: unknown[] } | unknown[];
        const definitions = Array.isArray(data) ? data : (data as { definitions?: unknown[] }).definitions || [];
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} security_definitions count=${definitions.length}`);
        
        if (definitions.length === 0) {
          console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} NO_ENTITLEMENTS: Account may not have market data access for ${instruments.join(", ")}`);
        } else {
          console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} entitlements_found: ${JSON.stringify(definitions.slice(0, 2))}`);
        }
      } else {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} security definitions check failed: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} security definitions error:`, error);
    }
  }

  async connect(): Promise<boolean> {
    if (!this.token || !this.streamId) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cannot connect - missing token or streamId`);
      return false;
    }

    return new Promise((resolve) => {
      const wsUrl = `${IRONBEAM_WS_URL}/${this.streamId}?token=${this.token}`;
      
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = async () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.consecutiveFailures = 0;
          this.isReconnecting = false;
          this.lastSuccessfulConnection = new Date();
          console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket connected (failures reset)`);
          
          await logIntegrationUsage({
            provider: "ironbeam",
            operation: "broker_websocket_connect",
            status: "OK",
            latencyMs: 0,
            traceId: this.traceId,
            metadata: { streamId: this.streamId, env: process.env.IRONBEAM_ENV || "demo" },
          });
          
          this.startHeartbeat();
          this.startBarEmitter();
          this.startStaleCheck();
          
          // Try subscribing via multiple methods
          if (this.pendingInstruments.length > 0) {
            // Method 1: Try REST API first (official documentation approach)
            let restSuccess = await this.subscribeViaRestApi(this.pendingInstruments);
            
            // Method 2: If REST API fails, try WebSocket message subscription (quantDIY approach)
            if (!restSuccess) {
              console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} REST API failed, trying WebSocket subscription...`);
              const wsSuccess = this.subscribeViaWebSocket(this.pendingInstruments);
              
              if (wsSuccess) {
                // WebSocket subscription messages sent - wait a bit to see if quotes arrive
                console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket subscription sent, waiting for quotes...`);
                
                // Give 5 seconds for quotes to arrive before declaring failure
                setTimeout(() => {
                  if (!this.lastQuoteTime || Date.now() - this.lastQuoteTime.getTime() > 10000) {
                    console.warn(`[IRONBEAM_LIVE] trace_id=${this.traceId} no quotes received after WebSocket subscription`);
                    this.emitSubscriptionFailed(this.pendingInstruments);
                  } else {
                    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket subscription working - quotes received`);
                  }
                }, 5000);
              } else {
                // Both methods failed immediately
                this.emitSubscriptionFailed(this.pendingInstruments);
              }
            }
          }
          
          this.emit("connected");
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data as string);
        };

        this.ws.onerror = (error) => {
          console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket error:`, error);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} WebSocket closed`);
          this.stopHeartbeat();
          this.emit("disconnected");
          this.attemptReconnect();
        };

      } catch (error) {
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} connect error:`, error);
        resolve(false);
      }
    });
  }

  private messageCount = 0;
  private lastMessageLogTime = 0;

  private handleMessage(data: string): void {
    try {
      this.messageCount++;
      const now = Date.now();
      
      // Log first 5 messages and then every 60 seconds
      if (this.messageCount <= 5 || now - this.lastMessageLogTime > 60000) {
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} message_count=${this.messageCount} raw_data_preview=${data.substring(0, 200)}`);
        this.lastMessageLogTime = now;
      }
      
      const msg = JSON.parse(data);
      
      if (msg.q) {
        // Ironbeam sends quotes as array: {"q": [{"s": "XCME:ES.H26", "l": 6930.25, ...}, ...]}
        const quoteArray = Array.isArray(msg.q) ? msg.q : [msg.q];
        for (const rawQuote of quoteArray) {
          const quote = this.parseQuote(rawQuote);
          if (quote) {
            this.lastQuoteTime = quote.timestamp;
            this.updateBarBuilder(quote);
            this.updateOrderBook(quote);  // LEVEL 2: Update order book on each quote
            this.emit("quote", quote);
            
            // Log first quote per symbol + proof-of-use for health dashboard
            if (!this.firstQuoteReceived.has(quote.exchSym)) {
              this.firstQuoteReceived.add(quote.exchSym);
              console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} QUOTE_RECEIVED symbol=${quote.exchSym} price=${quote.lastPrice} hi=${quote.high} lo=${quote.low}`);
              
              // AUTONOMOUS: Log proof-of-use to flip health status from DEGRADED to CONNECTED
              logIntegrationUsage({
                provider: "ironbeam",
                operation: "quote_received",
                status: "OK",
                traceId: this.traceId,
                latencyMs: 0,
                metadata: { symbol: quote.exchSym, price: quote.lastPrice },
              }).catch(err => console.warn(`[IRONBEAM_LIVE] failed to log integration usage: ${err}`));
            }
          }
        }
      }
      
      if (msg.heartbeat || msg.type === "heartbeat") {
        this.emit("heartbeat");
      }
      
      // Log unexpected message types
      if (!msg.q && !msg.heartbeat && msg.type !== "heartbeat") {
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} unknown_msg_type keys=${Object.keys(msg).join(",")}`);
      }
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} parse_error: ${error} data_preview=${data.substring(0, 100)}`);
    }
  }
  
  private firstQuoteReceived = new Set<string>();

  private parseQuote(q: any): IronbeamQuote | null {
    // Ironbeam uses short field names:
    // s = symbol, l = last, sz = size, hi = high, lo = low, op = open, b = bid, a = ask, v = volume
    const symbol = q.s || q.exchSym;
    if (!symbol) return null;

    const cleanSymbol = symbol.replace("XCME:", "");
    
    return {
      exchSym: cleanSymbol,
      bidPrice: parseFloat(q.b || q.bidPrice || q.bid_price || "0"),
      askPrice: parseFloat(q.a || q.askPrice || q.ask_price || "0"),
      lastPrice: parseFloat(q.l || q.lastPrice || q.last_price || q.tradePrice || "0"),
      lastSize: parseInt(q.sz || q.lastSize || q.last_size || q.tradeSize || "0", 10),
      volume: parseInt(q.v || q.volume || q.totalVolume || "0", 10),
      high: parseFloat(q.hi || q.high || "0"),
      low: parseFloat(q.lo || q.low || "0"),
      open: parseFloat(q.op || q.open || "0"),
      timestamp: new Date(),
    };
  }

  private updateBarBuilder(quote: IronbeamQuote): void {
    const symbol = quote.exchSym;
    const now = new Date();
    const barStartTime = new Date(now);
    barStartTime.setUTCSeconds(0, 0);

    let builder = this.barBuilders.get(symbol);

    if (!builder || builder.startTime.getTime() !== barStartTime.getTime()) {
      if (builder && builder.tickCount > 0) {
        this.emitBar(builder);
      }

      builder = {
        symbol,
        startTime: barStartTime,
        open: quote.lastPrice,
        high: quote.lastPrice,
        low: quote.lastPrice,
        close: quote.lastPrice,
        volume: 0,
        tickCount: 0,
      };
      this.barBuilders.set(symbol, builder);
    }

    if (quote.lastPrice > 0) {
      builder.high = Math.max(builder.high, quote.lastPrice);
      builder.low = Math.min(builder.low, quote.lastPrice);
      builder.close = quote.lastPrice;
      builder.volume += quote.lastSize;
      builder.tickCount++;
    }
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/\.[A-Z]\d{2}$/, "");
  }

  private emitBar(builder: BarBuilder): void {
    if (builder.tickCount === 0) return;

    const normalizedSymbol = this.normalizeSymbol(builder.symbol);
    
    const bar: LiveBar = {
      time: builder.startTime,
      open: builder.open,
      high: builder.high,
      low: builder.low,
      close: builder.close,
      volume: builder.volume,
      symbol: normalizedSymbol,
      timeframe: "1m",
    };

    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} bar=${bar.symbol} time=${bar.time.toISOString()} O=${bar.open} H=${bar.high} L=${bar.low} C=${bar.close} V=${bar.volume}`);
    this.emit("bar", bar);
  }

  private startBarEmitter(): void {
    if (this.barEmitInterval) return;

    this.barEmitInterval = setInterval(() => {
      const now = new Date();
      const currentBarStart = new Date(now);
      currentBarStart.setUTCSeconds(0, 0);

      for (const [symbol, builder] of this.barBuilders.entries()) {
        if (builder.startTime.getTime() < currentBarStart.getTime() && builder.tickCount > 0) {
          this.emitBar(builder);
          this.barBuilders.delete(symbol);
        }
      }
    }, 1000);
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startStaleCheck(): void {
    if (this.staleCheckInterval) return;
    
    this.staleCheckInterval = setInterval(() => {
      if (!this.isConnected || this.isReconnecting) return;
      
      // Skip stale check if market is closed (CME Globex: Sun 5pm - Fri 5pm CT)
      if (this.MARKET_HOURS_CHECK && !this.isMarketOpen()) {
        return;
      }
      
      const now = Date.now();
      const timeSinceQuote = this.lastQuoteTime ? now - this.lastQuoteTime.getTime() : Infinity;
      
      if (timeSinceQuote > this.STALE_THRESHOLD_MS) {
        console.warn(`[IRONBEAM_LIVE] trace_id=${this.traceId} STALE_DETECTED no_quote_for_ms=${timeSinceQuote} threshold=${this.STALE_THRESHOLD_MS}`);
        
        // Force reconnect
        this.emit("stale_data");
        this.forceReconnect();
      }
    }, 30_000); // Check every 30 seconds
  }

  private stopStaleCheck(): void {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
  }

  private isMarketOpen(): boolean {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();
    
    // CME Globex: Sunday 5pm CT to Friday 5pm CT (with daily pause 4-5pm CT)
    // CT = UTC-6 (or -5 during DST)
    // Simplified: Market closed Saturday, and Sunday before 11pm UTC, Friday after 11pm UTC
    
    if (dayOfWeek === 6) return false; // Saturday
    if (dayOfWeek === 0 && hour < 23) return false; // Sunday before 11pm UTC
    if (dayOfWeek === 5 && hour >= 22) return false; // Friday after 10pm UTC
    
    return true;
  }

  private async forceReconnect(): Promise<void> {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} forcing reconnection due to stale data`);
    
    // Close existing connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    this.stopHeartbeat();
    this.stopStaleCheck();
    
    // Attempt reconnect
    await this.attemptReconnect();
  }

  private async attemptReconnect(): Promise<void> {
    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.consecutiveFailures++;
    
    // Exponential backoff with cap
    const baseDelay = this.reconnectDelayMs * Math.pow(2, Math.min(this.reconnectAttempts - 1, 8));
    const delay = Math.min(baseDelay, this.maxReconnectDelayMs);
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}, failures=${this.consecutiveFailures})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.warn(`[IRONBEAM_LIVE] trace_id=${this.traceId} auth failed during reconnect, retrying...`);
        this.scheduleRetry();
        return;
      }

      const streamCreated = await this.createStream();
      if (!streamCreated) {
        console.warn(`[IRONBEAM_LIVE] trace_id=${this.traceId} stream creation failed, retrying...`);
        this.scheduleRetry();
        return;
      }

      const subscribed = await this.subscribeToQuotes(Array.from(this.subscribedSymbols));
      if (!subscribed) {
        console.warn(`[IRONBEAM_LIVE] trace_id=${this.traceId} quote subscription failed, retrying...`);
        this.scheduleRetry();
        return;
      }

      await this.connect();
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} reconnect error:`, error);
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    const failedCount = this.entitlementFailedSymbols.size;
    const totalSymbols = this.subscribedSymbols.size || 4;
    
    if (failedCount >= totalSymbols) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} STOPPING_RETRY: all ${failedCount} symbols have entitlement failures`);
      this.isReconnecting = false;
      return;
    }
    
    const retryDelay = this.maxReconnectDelayMs;
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} scheduling retry in ${retryDelay}ms (attempts=${this.reconnectAttempts}, failed_symbols=${failedCount})`);
    
    setTimeout(() => {
      this.attemptReconnect();
    }, retryDelay);
  }

  async start(symbols: string[]): Promise<boolean> {
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} starting live stream for ${symbols.join(", ")}`);

    const authenticated = await this.authenticate();
    if (!authenticated) return false;

    const streamCreated = await this.createStream();
    if (!streamCreated) return false;

    const subscribed = await this.subscribeToQuotes(symbols);
    if (!subscribed) return false;

    const connected = await this.connect();
    if (!connected) return false;

    await logActivityEvent({
      eventType: "RUNNER_STARTED",
      severity: "INFO",
      title: "Ironbeam Live Stream Started",
      summary: `Streaming ${symbols.join(", ")} via WebSocket`,
      payload: { symbols, streamId: this.streamId },
      traceId: this.traceId,
    });

    return true;
  }

  stop(): void {
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} stopping`);
    
    this.stopHeartbeat();
    this.stopStaleCheck();
    
    if (this.barEmitInterval) {
      clearInterval(this.barEmitInterval);
      this.barEmitInterval = null;
    }

    for (const builder of this.barBuilders.values()) {
      if (builder.tickCount > 0) {
        this.emitBar(builder);
      }
    }
    this.barBuilders.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isReconnecting = false;
    this.token = null;
    this.streamId = null;
  }

  getStatus(): { 
    connected: boolean; 
    subscribedSymbols: string[]; 
    lastQuoteTime: Date | null;
    isReconnecting: boolean;
    reconnectAttempts: number;
    consecutiveFailures: number;
    lastSuccessfulConnection: Date | null;
    isMarketOpen: boolean;
  } {
    return {
      connected: this.isConnected,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      lastQuoteTime: this.lastQuoteTime,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessfulConnection: this.lastSuccessfulConnection,
      isMarketOpen: this.isMarketOpen(),
    };
  }
  
  /**
   * LEVEL 2 ORDER BOOK - Update from quote data
   * Called on each quote to build and maintain order book snapshot
   */
  private updateOrderBook(quote: IronbeamQuote): void {
    const symbol = this.normalizeSymbol(quote.exchSym);
    const now = new Date();
    
    // Skip if no bid/ask data
    if (quote.bidPrice <= 0 && quote.askPrice <= 0) return;
    
    // Calculate spread metrics
    const bidPrice = quote.bidPrice > 0 ? quote.bidPrice : quote.lastPrice;
    const askPrice = quote.askPrice > 0 ? quote.askPrice : quote.lastPrice;
    const spread = askPrice - bidPrice;
    const midPrice = (bidPrice + askPrice) / 2;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    
    // Ironbeam Level 1 - we only get BBO, not full depth
    // Create synthetic order book with available data
    const bidLevel: OrderBookLevel = {
      price: bidPrice,
      size: quote.lastSize || 1,  // Use trade size as proxy
      timestamp: now,
    };
    const askLevel: OrderBookLevel = {
      price: askPrice,
      size: quote.lastSize || 1,
      timestamp: now,
    };
    
    // Calculate imbalance (-1 to 1, positive = buy pressure)
    const totalSize = bidLevel.size + askLevel.size;
    const imbalance = totalSize > 0 ? (bidLevel.size - askLevel.size) / totalSize : 0;
    
    // Liquidity score (0-100) - based on spread and volume
    // Tighter spread = higher liquidity, higher volume = higher liquidity
    const spreadScore = Math.max(0, 100 - spreadPct * 100);  // 1% spread = 0 score
    const volumeScore = Math.min(100, (quote.volume / 10000) * 20);  // 50k volume = 100 score
    const liquidityScore = (spreadScore * 0.6 + volumeScore * 0.4);
    
    const snapshot: OrderBookSnapshot = {
      symbol,
      timestamp: now,
      bids: [bidLevel],
      asks: [askLevel],
      spread,
      spreadPct,
      midPrice,
      imbalance,
      liquidityScore,
    };
    
    this.orderBooks.set(symbol, snapshot);
    
    // Track spread history for averaging
    let history = this.spreadHistory.get(symbol) || [];
    history.push({ timestamp: now, spread });
    if (history.length > this.SPREAD_HISTORY_MAX_SIZE) {
      history = history.slice(-this.SPREAD_HISTORY_MAX_SIZE);
    }
    this.spreadHistory.set(symbol, history);
    
    // Track price history for volatility calculation
    let priceHist = this.priceHistory.get(symbol) || [];
    priceHist.push({ timestamp: now, price: quote.lastPrice });
    if (priceHist.length > this.PRICE_HISTORY_MAX_SIZE) {
      priceHist = priceHist.slice(-this.PRICE_HISTORY_MAX_SIZE);
    }
    this.priceHistory.set(symbol, priceHist);
    
    // Emit order book update event
    this.emit("orderbook", snapshot);
  }
  
  /**
   * Get current order book snapshot for a symbol
   */
  getOrderBook(symbol: string): OrderBookSnapshot | null {
    const normalized = this.normalizeSymbol(symbol);
    return this.orderBooks.get(normalized) || null;
  }
  
  /**
   * Get market microstructure analysis with dynamic slippage suggestion
   */
  getMarketMicrostructure(symbol: string): MarketMicrostructure | null {
    const normalized = this.normalizeSymbol(symbol);
    const book = this.orderBooks.get(normalized);
    if (!book) return null;
    
    const now = Date.now();
    const spreadHist = this.spreadHistory.get(normalized) || [];
    const priceHist = this.priceHistory.get(normalized) || [];
    
    // Calculate 5-minute average spread
    const fiveMinAgo = now - 5 * 60 * 1000;
    const recentSpreads = spreadHist.filter(h => h.timestamp.getTime() > fiveMinAgo);
    const avgSpread5m = recentSpreads.length > 0 
      ? recentSpreads.reduce((sum, h) => sum + h.spread, 0) / recentSpreads.length 
      : book.spread;
    
    // Calculate 1-hour average spread
    const oneHourAgo = now - 60 * 60 * 1000;
    const hourSpreads = spreadHist.filter(h => h.timestamp.getTime() > oneHourAgo);
    const avgSpread1h = hourSpreads.length > 0 
      ? hourSpreads.reduce((sum, h) => sum + h.spread, 0) / hourSpreads.length 
      : avgSpread5m;
    
    // Calculate 5-minute volatility (standard deviation of returns)
    const recentPrices = priceHist.filter(h => h.timestamp.getTime() > fiveMinAgo);
    let volatility5m = 0;
    if (recentPrices.length > 1) {
      const returns: number[] = [];
      for (let i = 1; i < recentPrices.length; i++) {
        const ret = (recentPrices[i].price - recentPrices[i - 1].price) / recentPrices[i - 1].price;
        returns.push(ret);
      }
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      volatility5m = Math.sqrt(variance) * 100;  // As percentage
    }
    
    // Calculate dynamic slippage suggestion (in ticks)
    // Base: half-spread, adjusted for volatility and imbalance
    const baseSlippage = book.spread / 2;
    const volatilityAdj = volatility5m * book.midPrice * 0.1;  // 10% of vol as ticks
    const imbalanceAdj = Math.abs(book.imbalance) * baseSlippage * 0.5;  // Imbalance adds 50%
    const suggestedSlippageTicks = Math.ceil(baseSlippage + volatilityAdj + imbalanceAdj);
    
    return {
      symbol: normalized,
      currentSpread: book.spread,
      avgSpread5m,
      avgSpread1h,
      volatility5m,
      imbalance: book.imbalance,
      liquidityScore: book.liquidityScore,
      suggestedSlippageTicks: Math.max(1, suggestedSlippageTicks),  // Minimum 1 tick
      timestamp: book.timestamp,
    };
  }
  
  /**
   * Get all tracked order books
   */
  getAllOrderBooks(): Map<string, OrderBookSnapshot> {
    return new Map(this.orderBooks);
  }

  // ============================================================================
  // ORDER EXECUTION METHODS - Stage-gated live/simulated order flow
  // ============================================================================

  /**
   * Check if order execution is allowed based on bot stage and environment.
   * Returns whether to execute live or simulate.
   */
  checkStageGate(botStage?: string): StageGateResult {
    const ironbeamEnv = process.env.IRONBEAM_ENV || "demo";
    const stage = botStage?.toUpperCase() || "PAPER";
    
    const liveStages = ["CANARY", "LIVE"];
    const isLiveStage = liveStages.includes(stage);
    const isLiveEnv = ironbeamEnv === "live";
    
    if (!isLiveStage) {
      return {
        allowed: true,
        reason: `Stage ${stage} will simulate orders (paper trading)`,
        stage,
        environment: ironbeamEnv,
        simulateOnly: true,
      };
    }
    
    if (!isLiveEnv) {
      return {
        allowed: true,
        reason: `Live stage ${stage} but IRONBEAM_ENV=${ironbeamEnv}, simulating orders`,
        stage,
        environment: ironbeamEnv,
        simulateOnly: true,
      };
    }
    
    return {
      allowed: true,
      reason: `Live execution enabled: stage=${stage}, env=${ironbeamEnv}`,
      stage,
      environment: ironbeamEnv,
      simulateOnly: false,
    };
  }

  /**
   * Submit order to Ironbeam.
   * Checks stage gate first - simulates if not CANARY/LIVE with live env.
   */
  async submitOrder(order: IronbeamOrder, botStage?: string): Promise<OrderResult> {
    const gate = this.checkStageGate(botStage);
    const clientOrderId = order.clientOrderId || crypto.randomUUID().slice(0, 16);
    const now = new Date();
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} submitOrder: ${order.side} ${order.quantity} ${order.symbol} @ ${order.orderType} gate=${gate.simulateOnly ? "SIMULATE" : "LIVE"}`);
    
    if (gate.simulateOnly) {
      return this.simulateOrder(order, clientOrderId, gate.reason);
    }
    
    if (!this.token) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        return {
          orderId: "",
          clientOrderId,
          status: "REJECTED",
          filledQty: 0,
          avgPrice: 0,
          remainingQty: order.quantity,
          symbol: order.symbol,
          side: order.side,
          orderType: order.orderType,
          submittedAt: now,
          updatedAt: now,
          error: "Authentication failed",
          errorCode: "AUTH_FAILED",
          simulated: false,
        };
      }
    }
    
    try {
      const symbolMapping = getSymbolMapping();
      const instrument = symbolMapping[order.symbol.toUpperCase()] || `XCME:${order.symbol.toUpperCase()}`;
      
      const orderPayload: Record<string, unknown> = {
        symbol: instrument,
        side: order.side,
        quantity: order.quantity,
        orderType: order.orderType,
        timeInForce: order.timeInForce || "DAY",
        clientOrderId,
      };
      
      if (order.limitPrice !== undefined) {
        orderPayload.limitPrice = order.limitPrice;
      }
      if (order.stopPrice !== undefined) {
        orderPayload.stopPrice = order.stopPrice;
      }
      if (order.accountId) {
        orderPayload.accountId = order.accountId;
      }
      
      const response = await fetch(`${IRONBEAM_API_URL}/orders`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orderPayload),
      });
      
      if (response.status === 401) {
        console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} token expired, re-authenticating...`);
        const reauth = await this.authenticate();
        if (!reauth) {
          return {
            orderId: "",
            clientOrderId,
            status: "REJECTED",
            filledQty: 0,
            avgPrice: 0,
            remainingQty: order.quantity,
            symbol: order.symbol,
            side: order.side,
            orderType: order.orderType,
            submittedAt: now,
            updatedAt: now,
            error: "Re-authentication failed",
            errorCode: "REAUTH_FAILED",
            simulated: false,
          };
        }
        
        const retryResponse = await fetch(`${IRONBEAM_API_URL}/orders`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(orderPayload),
        });
        
        return this.parseOrderResponse(retryResponse, order, clientOrderId, now);
      }
      
      return this.parseOrderResponse(response, order, clientOrderId, now);
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} submitOrder error:`, error);
      
      await logActivityEvent({
        eventType: "ORDER_EXECUTION",
        severity: "ERROR",
        title: "Ironbeam Order Submission Failed",
        summary: `Failed to submit ${order.side} ${order.quantity} ${order.symbol}: ${(error as Error).message}`,
        payload: { order, error: (error as Error).message },
        traceId: this.traceId,
      });
      
      return {
        orderId: "",
        clientOrderId,
        status: "REJECTED",
        filledQty: 0,
        avgPrice: 0,
        remainingQty: order.quantity,
        symbol: order.symbol,
        side: order.side,
        orderType: order.orderType,
        submittedAt: now,
        updatedAt: now,
        error: (error as Error).message,
        errorCode: "NETWORK_ERROR",
        simulated: false,
      };
    }
  }

  private async parseOrderResponse(
    response: Response,
    order: IronbeamOrder,
    clientOrderId: string,
    submittedAt: Date
  ): Promise<OrderResult> {
    const now = new Date();
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} order rejected: ${response.status} - ${errorText}`);
      
      await logActivityEvent({
        eventType: "ORDER_EXECUTION",
        severity: "WARN",
        title: "Ironbeam Order Rejected",
        summary: `Order rejected: ${errorText}`,
        payload: { order, status: response.status, error: errorText },
        traceId: this.traceId,
      });
      
      return {
        orderId: "",
        clientOrderId,
        status: "REJECTED",
        filledQty: 0,
        avgPrice: 0,
        remainingQty: order.quantity,
        symbol: order.symbol,
        side: order.side,
        orderType: order.orderType,
        submittedAt,
        updatedAt: now,
        error: errorText,
        errorCode: `HTTP_${response.status}`,
        simulated: false,
      };
    }
    
    const data = await response.json() as {
      orderId?: string;
      status?: string;
      filledQty?: number;
      avgPrice?: number;
      remainingQty?: number;
    };
    
    const status = this.mapOrderStatus(data.status || "SUBMITTED");
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} order accepted: orderId=${data.orderId} status=${status}`);
    
    await logActivityEvent({
      eventType: "ORDER_EXECUTION",
      severity: "INFO",
      title: "Ironbeam Order Submitted",
      summary: `${order.side} ${order.quantity} ${order.symbol} orderId=${data.orderId}`,
      payload: { order, orderId: data.orderId, status },
      traceId: this.traceId,
    });
    
    await logIntegrationUsage({
      provider: "ironbeam",
      operation: "order_submit",
      status: "OK",
      latencyMs: now.getTime() - submittedAt.getTime(),
      traceId: this.traceId,
      metadata: { orderId: data.orderId, symbol: order.symbol, side: order.side, quantity: order.quantity },
    });
    
    return {
      orderId: data.orderId || "",
      clientOrderId,
      status,
      filledQty: data.filledQty || 0,
      avgPrice: data.avgPrice || 0,
      remainingQty: data.remainingQty ?? order.quantity,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      submittedAt,
      updatedAt: now,
      simulated: false,
    };
  }

  private simulateOrder(order: IronbeamOrder, clientOrderId: string, reason: string): OrderResult {
    const now = new Date();
    const simulatedOrderId = `SIM-${crypto.randomUUID().slice(0, 12)}`;
    
    const book = this.getOrderBook(order.symbol);
    let fillPrice = 0;
    
    if (order.orderType === "MARKET") {
      if (book) {
        fillPrice = order.side === "BUY" ? book.asks[0]?.price || book.midPrice : book.bids[0]?.price || book.midPrice;
      } else {
        fillPrice = order.limitPrice || 0;
      }
    } else if (order.orderType === "LIMIT") {
      fillPrice = order.limitPrice || 0;
    } else if (order.orderType === "STOP" || order.orderType === "STOP_LIMIT") {
      fillPrice = order.stopPrice || order.limitPrice || 0;
    }
    
    console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} SIMULATED order: ${simulatedOrderId} ${order.side} ${order.quantity} ${order.symbol} @ ${fillPrice} (${reason})`);
    
    logActivityEvent({
      eventType: "ORDER_EXECUTION",
      severity: "INFO",
      title: "Simulated Order Executed",
      summary: `PAPER: ${order.side} ${order.quantity} ${order.symbol} @ ${fillPrice.toFixed(2)}`,
      payload: { order, simulatedOrderId, fillPrice, reason },
      traceId: this.traceId,
    }).catch(console.error);
    
    return {
      orderId: simulatedOrderId,
      clientOrderId,
      status: "FILLED",
      filledQty: order.quantity,
      avgPrice: fillPrice,
      remainingQty: 0,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      submittedAt: now,
      updatedAt: now,
      simulated: true,
    };
  }

  private mapOrderStatus(apiStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      "PENDING": "PENDING",
      "NEW": "SUBMITTED",
      "SUBMITTED": "SUBMITTED",
      "WORKING": "WORKING",
      "PARTIAL": "PARTIAL",
      "PARTIALLY_FILLED": "PARTIAL",
      "FILLED": "FILLED",
      "CANCELLED": "CANCELLED",
      "CANCELED": "CANCELLED",
      "REJECTED": "REJECTED",
      "EXPIRED": "EXPIRED",
    };
    return statusMap[apiStatus.toUpperCase()] || "PENDING";
  }

  /**
   * Get order status from Ironbeam API.
   */
  async getOrderStatus(orderId: string): Promise<OrderResult | null> {
    if (orderId.startsWith("SIM-")) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} getOrderStatus: ${orderId} is simulated, returning filled`);
      return null;
    }
    
    if (!this.token) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getOrderStatus: auth failed`);
        return null;
      }
    }
    
    try {
      const response = await fetch(`${IRONBEAM_API_URL}/orders/${orderId}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });
      
      if (response.status === 401) {
        await this.authenticate();
        const retryResponse = await fetch(`${IRONBEAM_API_URL}/orders/${orderId}`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${this.token}` },
        });
        if (!retryResponse.ok) {
          console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getOrderStatus failed after reauth`);
          return null;
        }
        return this.parseOrderStatusResponse(await retryResponse.json(), orderId);
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getOrderStatus failed: ${response.status} - ${errorText}`);
        return null;
      }
      
      return this.parseOrderStatusResponse(await response.json(), orderId);
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getOrderStatus error:`, error);
      return null;
    }
  }

  private parseOrderStatusResponse(data: Record<string, unknown>, orderId: string): OrderResult {
    const now = new Date();
    return {
      orderId,
      clientOrderId: (data.clientOrderId as string) || undefined,
      status: this.mapOrderStatus((data.status as string) || "PENDING"),
      filledQty: (data.filledQty as number) || 0,
      avgPrice: (data.avgPrice as number) || (data.avgFillPrice as number) || 0,
      remainingQty: (data.remainingQty as number) || (data.leavesQty as number) || 0,
      symbol: this.normalizeSymbol((data.symbol as string) || ""),
      side: ((data.side as string) || "BUY").toUpperCase() as OrderSide,
      orderType: ((data.orderType as string) || "MARKET").toUpperCase() as OrderType,
      submittedAt: data.submittedAt ? new Date(data.submittedAt as string) : now,
      updatedAt: data.updatedAt ? new Date(data.updatedAt as string) : now,
      simulated: false,
    };
  }

  /**
   * Cancel an order via Ironbeam API.
   */
  async cancelOrder(orderId: string): Promise<CancelResult> {
    if (orderId.startsWith("SIM-")) {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} cancelOrder: ${orderId} is simulated`);
      return {
        orderId,
        success: true,
        message: "Simulated order cancelled",
      };
    }
    
    if (!this.token) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        return {
          orderId,
          success: false,
          message: "Authentication failed",
          error: "AUTH_FAILED",
        };
      }
    }
    
    try {
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} cancelOrder: ${orderId}`);
      
      const response = await fetch(`${IRONBEAM_API_URL}/orders/${orderId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });
      
      if (response.status === 401) {
        await this.authenticate();
        const retryResponse = await fetch(`${IRONBEAM_API_URL}/orders/${orderId}`, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${this.token}` },
        });
        
        if (!retryResponse.ok) {
          const errorText = await retryResponse.text();
          return {
            orderId,
            success: false,
            message: `Cancel failed: ${errorText}`,
            error: errorText,
          };
        }
        
        return { orderId, success: true, message: "Order cancelled" };
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cancelOrder failed: ${response.status} - ${errorText}`);
        
        await logActivityEvent({
          eventType: "ORDER_EXECUTION",
          severity: "WARN",
          title: "Ironbeam Order Cancel Failed",
          summary: `Failed to cancel ${orderId}: ${errorText}`,
          payload: { orderId, error: errorText },
          traceId: this.traceId,
        });
        
        return {
          orderId,
          success: false,
          message: `Cancel failed: ${errorText}`,
          error: errorText,
        };
      }
      
      console.log(`[IRONBEAM_LIVE] trace_id=${this.traceId} order cancelled: ${orderId}`);
      
      await logActivityEvent({
        eventType: "ORDER_EXECUTION",
        severity: "INFO",
        title: "Ironbeam Order Cancelled",
        summary: `Order ${orderId} cancelled`,
        payload: { orderId },
        traceId: this.traceId,
      });
      
      return {
        orderId,
        success: true,
        message: "Order cancelled successfully",
      };
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} cancelOrder error:`, error);
      return {
        orderId,
        success: false,
        message: (error as Error).message,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get current open positions from Ironbeam API.
   */
  async getPositions(): Promise<IronbeamPosition[]> {
    if (!this.token) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getPositions: auth failed`);
        return [];
      }
    }
    
    try {
      const response = await fetch(`${IRONBEAM_API_URL}/positions`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.token}`,
        },
      });
      
      if (response.status === 401) {
        await this.authenticate();
        const retryResponse = await fetch(`${IRONBEAM_API_URL}/positions`, {
          method: "GET",
          headers: { "Authorization": `Bearer ${this.token}` },
        });
        if (!retryResponse.ok) {
          console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getPositions failed after reauth`);
          return [];
        }
        return this.parsePositionsResponse(await retryResponse.json());
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getPositions failed: ${response.status} - ${errorText}`);
        return [];
      }
      
      return this.parsePositionsResponse(await response.json());
    } catch (error) {
      console.error(`[IRONBEAM_LIVE] trace_id=${this.traceId} getPositions error:`, error);
      return [];
    }
  }

  private parsePositionsResponse(data: unknown): IronbeamPosition[] {
    const positions: IronbeamPosition[] = [];
    const now = new Date();
    
    const items = Array.isArray(data) ? data : (data as { positions?: unknown[] })?.positions || [];
    
    for (const item of items as Record<string, unknown>[]) {
      const quantity = (item.quantity as number) || (item.netQty as number) || 0;
      const symbol = this.normalizeSymbol((item.symbol as string) || "");
      
      if (quantity === 0) continue;
      
      const avgEntry = (item.avgEntryPrice as number) || (item.avgPrice as number) || 0;
      const currentPrice = (item.currentPrice as number) || (item.lastPrice as number) || avgEntry;
      const unrealizedPnL = (item.unrealizedPnL as number) || (item.openPnL as number) || 
        (quantity * (currentPrice - avgEntry));
      
      positions.push({
        symbol,
        quantity: Math.abs(quantity),
        side: quantity > 0 ? "LONG" : quantity < 0 ? "SHORT" : "FLAT",
        avgEntryPrice: avgEntry,
        currentPrice,
        unrealizedPnL,
        realizedPnL: (item.realizedPnL as number) || (item.closedPnL as number) || 0,
        accountId: (item.accountId as string) || "",
        timestamp: now,
      });
    }
    
    return positions;
  }

  /**
   * Get entitlement status for monitoring dashboard
   */
  getEntitlementStatus(): {
    connected: boolean;
    subscribedSymbols: string[];
    entitlementFailedSymbols: string[];
    subscriptionSucceeded: boolean;
    subscribedFrontMonth: string | null;
    subscribedStreamId: string | null;
  } {
    return {
      connected: this.ws?.readyState === 1,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      entitlementFailedSymbols: Array.from(this.entitlementFailedSymbols),
      subscriptionSucceeded: this.subscriptionSucceeded,
      subscribedFrontMonth: this.subscribedFrontMonth,
      subscribedStreamId: this.subscribedStreamId,
    };
  }
}

let globalIronbeamClient: IronbeamLiveClient | null = null;

export function getIronbeamClient(): IronbeamLiveClient | null {
  return globalIronbeamClient;
}

export function setIronbeamClient(client: IronbeamLiveClient): void {
  globalIronbeamClient = client;
}

export async function verifyIronbeamLiveConnection(credentialSet: 1 | 2 | 3 = 1): Promise<{
  connected: boolean;
  message: string;
}> {
  const client = new IronbeamLiveClient(credentialSet);
  const authenticated = await client.authenticate();
  
  if (!authenticated) {
    return { connected: false, message: `Credential set ${credentialSet} authentication failed` };
  }

  return { connected: true, message: `Ironbeam credential set ${credentialSet} authenticated` };
}
