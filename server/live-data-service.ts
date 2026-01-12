/**
 * Live Data Service - Real-time Market Data for PAPER+ Stage Bots
 * 
 * INSTITUTIONAL ARCHITECTURE:
 * - QUOTES: Real-time tick data for P&L valuation (updates every trade)
 * - BARS: 1-minute OHLCV for strategy signal generation
 * 
 * Primary: Ironbeam WebSocket streaming (quotes for marks, bars for signals)
 * Fallback: Bar cache polling (historical data, capped at midnight UTC)
 */

import { EventEmitter } from "events";
import { IronbeamLiveClient, LiveBar as IronbeamBar, IronbeamQuote, setIronbeamClient } from "./ironbeam-live-client";
import { getCachedBars } from "./bar-cache";
import { logActivityEvent } from "./activity-logger";
import { tickIngestionService } from "./tick-ingestion-service";

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
 * Real-time quote for P&L valuation - updates on every tick
 */
export interface LiveQuote {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  timestamp: Date;
  volume: number;
}

export interface BarSubscription {
  botId: string;
  symbol: string;
  timeframe: string;
  callback: (bar: LiveBar) => void;
}

export interface QuoteSubscription {
  botId: string;
  symbol: string;
  callback: (quote: LiveQuote) => void;
}

type DataSource = "ironbeam" | "cache" | "none";

class LiveDataServiceImpl extends EventEmitter {
  private subscriptions: Map<string, BarSubscription[]> = new Map();
  private quoteSubscriptions: Map<string, QuoteSubscription[]> = new Map();
  private lastBars: Map<string, LiveBar> = new Map();
  private lastQuotes: Map<string, LiveQuote> = new Map();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private ironbeamClient: IronbeamLiveClient | null = null;
  private activeDataSource: DataSource = "none";
  private isRunning = false;
  private traceId: string = crypto.randomUUID().slice(0, 8);
  private quoteSubscriptionFailed = false;
  private barsReceivedFromIronbeam = 0;
  private quotesReceivedFromIronbeam = 0;
  private lastQuoteLogTime = 0;
  
  private readonly BAR_POLL_INTERVAL_MS = 60_000;
  private readonly SYMBOLS_SUPPORTED = ["MES", "MNQ", "ES", "NQ"];

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log("[LIVE_DATA_SERVICE] Starting...");
    
    const ironbeamStarted = await this.startIronbeamStream();
    
    if (ironbeamStarted) {
      await new Promise(r => setTimeout(r, 3000));
      
      if (this.quoteSubscriptionFailed) {
        this.activeDataSource = "cache";
        console.log("[LIVE_DATA_SERVICE] Started with bar cache fallback (Ironbeam quote subscription failed)");
      } else {
        this.activeDataSource = "ironbeam";
        console.log("[LIVE_DATA_SERVICE] Started with Ironbeam live streaming");
      }
    } else {
      this.activeDataSource = "cache";
      console.log("[LIVE_DATA_SERVICE] Started with bar cache fallback (Ironbeam unavailable)");
    }

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: "Live Data Service Started",
      summary: `Using ${this.activeDataSource} as data source`,
      payload: { dataSource: this.activeDataSource },
      traceId: this.traceId,
    });
  }

  private async startIronbeamStream(): Promise<boolean> {
    const hasCredentials = !!process.env.IRONBEAM_USERNAME_1 && 
                          !!process.env.IRONBEAM_PASSWORD_1 && 
                          !!process.env.IRONBEAM_API_KEY_1;

    if (!hasCredentials) {
      console.log("[LIVE_DATA_SERVICE] Ironbeam credentials not configured");
      return false;
    }

    try {
      this.ironbeamClient = new IronbeamLiveClient(1);
      setIronbeamClient(this.ironbeamClient);
      
      this.ironbeamClient.on("bar", (bar: IronbeamBar) => {
        this.handleIronbeamBar(bar);
      });

      this.ironbeamClient.on("quote", (quote: IronbeamQuote) => {
        this.handleIronbeamQuote(quote);
      });

      this.ironbeamClient.on("disconnected", () => {
        console.warn("[LIVE_DATA_SERVICE] Ironbeam disconnected, falling back to cache");
        this.activeDataSource = "cache";
        this.startCacheFallback();
      });

      this.ironbeamClient.on("connected", () => {
        console.log("[LIVE_DATA_SERVICE] Ironbeam reconnected");
        if (!this.quoteSubscriptionFailed) {
          this.activeDataSource = "ironbeam";
          this.stopCacheFallback();
        } else {
          console.log("[LIVE_DATA_SERVICE] Staying on cache fallback (quote subscription previously failed)");
        }
      });

      this.ironbeamClient.on("subscription_failed", () => {
        console.warn("[LIVE_DATA_SERVICE] Ironbeam quote subscription failed, falling back to bar cache");
        this.quoteSubscriptionFailed = true;
        this.activeDataSource = "cache";
        this.startCacheFallback();
      });

      this.ironbeamClient.on("stale_data", () => {
        console.warn("[LIVE_DATA_SERVICE] Stale data detected - Ironbeam will auto-reconnect");
        this.activeDataSource = "cache";
        this.startCacheFallback();
      });

      this.ironbeamClient.on("reconnect_failed", () => {
        console.error("[LIVE_DATA_SERVICE] Ironbeam reconnection failed after max attempts");
        this.activeDataSource = "cache";
        this.startCacheFallback();
        
        logActivityEvent({
          eventType: "INTEGRATION_PROOF",
          severity: "ERROR",
          title: "Ironbeam Connection Lost",
          summary: "Falling back to bar cache polling",
          payload: { source: "ironbeam", fallback: "cache" },
          traceId: this.traceId,
        });
      });

      const started = await this.ironbeamClient.start(this.SYMBOLS_SUPPORTED);
      return started;
    } catch (error) {
      console.error("[LIVE_DATA_SERVICE] Failed to start Ironbeam:", error);
      return false;
    }
  }

  private normalizeTimeframe(tf: string): string {
    if (/^\d+$/.test(tf)) {
      return `${tf}m`;
    }
    return tf;
  }

  private handleIronbeamBar(bar: IronbeamBar): void {
    this.barsReceivedFromIronbeam++;
    
    // CRITICAL FIX: If we thought subscription failed but we're receiving bars,
    // switch back to Ironbeam as the data source. The REST subscription can fail
    // but WebSocket quotes may still work (race condition in initial check).
    if (this.quoteSubscriptionFailed && this.barsReceivedFromIronbeam === 1) {
      console.log(`[LIVE_DATA_SERVICE] IRONBEAM_SELF_HEAL: Bars received despite subscription_failed flag. Switching to Ironbeam.`);
      this.quoteSubscriptionFailed = false;
      this.activeDataSource = "ironbeam";
      this.stopCacheFallback();
      
      logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: "Ironbeam Data Restored",
        summary: "Live bars detected - switching from cache fallback to Ironbeam streaming",
        payload: { dataSource: "ironbeam", selfHealed: true },
        traceId: this.traceId,
      });
    }
    
    const normalizedTimeframe = this.normalizeTimeframe(bar.timeframe);
    
    const liveBar: LiveBar = {
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      symbol: bar.symbol,
      timeframe: normalizedTimeframe,
    };

    const key = `${bar.symbol}:${normalizedTimeframe}`;
    this.lastBars.set(key, liveBar);
    this.notifySubscribers(key, liveBar);
  }

  /**
   * Handle real-time quote from Ironbeam - THIS IS THE KEY FIX
   * Quotes arrive on every tick, providing sub-second mark prices for P&L valuation.
   */
  private handleIronbeamQuote(quote: IronbeamQuote): void {
    this.quotesReceivedFromIronbeam++;
    
    // Normalize symbol (remove contract suffix like .H26)
    const normalizedSymbol = quote.exchSym.replace(/\.[A-Z]\d{2}$/, "");
    
    // Calculate mid-price for fair value mark
    const hasBidAsk = quote.bidPrice > 0 && quote.askPrice > 0;
    const midPrice = hasBidAsk 
      ? (quote.bidPrice + quote.askPrice) / 2 
      : quote.lastPrice;
    
    const liveQuote: LiveQuote = {
      symbol: normalizedSymbol,
      lastPrice: quote.lastPrice,
      bidPrice: quote.bidPrice,
      askPrice: quote.askPrice,
      midPrice,
      timestamp: quote.timestamp,
      volume: quote.volume,
    };
    
    this.lastQuotes.set(normalizedSymbol, liveQuote);
    
    // INSTITUTIONAL TICK DATA: Ingest quote tick for persistence and gap detection
    if (quote.bidPrice > 0 && quote.askPrice > 0) {
      tickIngestionService.ingestQuoteTick({
        symbol: normalizedSymbol,
        exchange: "XCME",
        bidPrice: quote.bidPrice,
        bidSize: 1, // Ironbeam L1 doesn't provide size, default to 1
        askPrice: quote.askPrice,
        askSize: 1,
        timestamp: quote.timestamp,
      });
      
      // Also capture trade tick from lastPrice/lastSize if available
      if (quote.lastPrice > 0 && quote.lastSize > 0) {
        tickIngestionService.ingestTradeTick({
          symbol: normalizedSymbol,
          exchange: "XCME",
          price: quote.lastPrice,
          size: quote.lastSize,
          timestamp: quote.timestamp,
        });
      }
    }
    
    // Log quote updates periodically (every 30s) to avoid log spam
    const now = Date.now();
    if (now - this.lastQuoteLogTime > 30_000) {
      console.log(`[LIVE_DATA_SERVICE] Quote tick symbol=${normalizedSymbol} last=${quote.lastPrice} bid=${quote.bidPrice} ask=${quote.askPrice} mid=${midPrice.toFixed(2)} quotes_total=${this.quotesReceivedFromIronbeam}`);
      this.lastQuoteLogTime = now;
    }
    
    // Notify quote subscribers (for real-time P&L updates)
    this.notifyQuoteSubscribers(normalizedSymbol, liveQuote);
    
    // CRITICAL FIX: If we thought subscription failed but we're receiving quotes,
    // switch back to Ironbeam as the data source
    if (this.quoteSubscriptionFailed && this.quotesReceivedFromIronbeam === 1) {
      console.log(`[LIVE_DATA_SERVICE] IRONBEAM_SELF_HEAL: Quotes received despite subscription_failed flag. Switching to Ironbeam.`);
      this.quoteSubscriptionFailed = false;
      this.activeDataSource = "ironbeam";
      this.stopCacheFallback();
    }
  }

  private notifyQuoteSubscribers(symbol: string, quote: LiveQuote): void {
    const subs = this.quoteSubscriptions.get(symbol);
    if (!subs || subs.length === 0) return;
    
    for (const sub of subs) {
      try {
        sub.callback(quote);
      } catch (error) {
        console.error(`[LIVE_DATA_SERVICE] Quote callback error for bot=${sub.botId}:`, error);
      }
    }
  }

  private startCacheFallback(): void {
    for (const key of this.subscriptions.keys()) {
      if (!this.pollingIntervals.has(key)) {
        const [symbol, timeframe] = key.split(":");
        this.startPolling(symbol, timeframe);
      }
    }
  }

  private stopCacheFallback(): void {
    this.pollingIntervals.forEach((interval) => clearInterval(interval));
    this.pollingIntervals.clear();
  }

  stop(): void {
    this.isRunning = false;
    
    if (this.ironbeamClient) {
      this.ironbeamClient.stop();
      this.ironbeamClient = null;
    }
    
    this.stopCacheFallback();
    this.activeDataSource = "none";
    
    console.log("[LIVE_DATA_SERVICE] Stopped");
  }

  subscribe(subscription: BarSubscription): () => void {
    const key = `${subscription.symbol}:${subscription.timeframe}`;
    
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }
    
    // Always start polling if we're using cache (either initially or due to quote subscription failure)
    if (this.activeDataSource === "cache" || this.quoteSubscriptionFailed) {
      this.startPolling(subscription.symbol, subscription.timeframe);
    }
    
    this.subscriptions.get(key)!.push(subscription);
    
    console.log(`[LIVE_DATA_SERVICE] Subscribed bot=${subscription.botId.slice(0,8)} symbol=${subscription.symbol} timeframe=${subscription.timeframe} source=${this.activeDataSource} quotesFailed=${this.quoteSubscriptionFailed}`);
    
    return () => {
      const subs = this.subscriptions.get(key);
      if (subs) {
        const idx = subs.findIndex(s => s.botId === subscription.botId);
        if (idx >= 0) subs.splice(idx, 1);
        if (subs.length === 0) {
          this.subscriptions.delete(key);
          this.stopPolling(key);
        }
      }
    };
  }

  private startPolling(symbol: string, timeframe: string): void {
    const key = `${symbol}:${timeframe}`;
    
    if (this.pollingIntervals.has(key)) return;
    
    const pollFn = async () => {
      if (!this.isRunning || this.activeDataSource !== "cache") return;
      
      try {
        const bar = await this.fetchLatestBarFromCache(symbol, timeframe);
        if (bar) {
          const lastBar = this.lastBars.get(key);
          
          if (!lastBar || bar.time.getTime() > lastBar.time.getTime()) {
            this.lastBars.set(key, bar);
            this.notifySubscribers(key, bar);
          }
        }
      } catch (error) {
        console.error(`[LIVE_DATA_SERVICE] Error polling ${key}:`, error);
      }
    };
    
    pollFn();
    
    const intervalMs = timeframe === "1m" ? 60_000 : 
                       timeframe === "5m" ? 300_000 : 
                       60_000;
    
    const interval = setInterval(pollFn, intervalMs);
    this.pollingIntervals.set(key, interval);
  }

  private stopPolling(key: string): void {
    const interval = this.pollingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(key);
    }
  }

  private async fetchLatestBarFromCache(symbol: string, timeframe: string): Promise<LiveBar | null> {
    const traceId = crypto.randomUUID().slice(0, 8);
    
    try {
      const bars = await getCachedBars(symbol, traceId);
      
      if (bars.length > 0) {
        const latestBar = bars[bars.length - 1];
        return {
          time: latestBar.time,
          open: latestBar.open,
          high: latestBar.high,
          low: latestBar.low,
          close: latestBar.close,
          volume: latestBar.volume,
          symbol: symbol,
          timeframe: timeframe,
        };
      }
    } catch (error) {
      console.error(`[LIVE_DATA_SERVICE] Failed to fetch bar for ${symbol}:`, error);
    }
    
    return null;
  }

  private notifySubscribers(key: string, bar: LiveBar): void {
    const subs = this.subscriptions.get(key);
    if (!subs || subs.length === 0) return;
    
    console.log(`[LIVE_DATA_SERVICE] Emitting bar symbol=${bar.symbol} close=${bar.close.toFixed(2)} time=${bar.time.toISOString()} to ${subs.length} subscriber(s)`);
    
    for (const sub of subs) {
      try {
        sub.callback(bar);
      } catch (error) {
        console.error(`[LIVE_DATA_SERVICE] Callback error for bot=${sub.botId}:`, error);
      }
    }
  }

  getLastBar(symbol: string, timeframe: string): LiveBar | undefined {
    return this.lastBars.get(`${symbol}:${timeframe}`);
  }

  /**
   * Get the latest quote for a symbol - REAL-TIME MARK PRICE
   * This is the primary source for P&L valuation (updates on every tick).
   */
  getLastQuote(symbol: string): LiveQuote | undefined {
    return this.lastQuotes.get(symbol);
  }

  /**
   * Get the freshest mark price available for a symbol.
   * Priority: Quote (real-time) > Bar close (1-minute aggregate)
   */
  getFreshestMark(symbol: string, timeframe: string = "1m"): {
    price: number | null;
    timestamp: Date | null;
    source: "QUOTE" | "BAR" | "NONE";
    ageMs: number;
  } {
    const now = Date.now();
    const quote = this.lastQuotes.get(symbol);
    const bar = this.lastBars.get(`${symbol}:${timeframe}`);
    
    // Prefer quote (real-time) over bar (aggregated)
    if (quote && quote.lastPrice > 0) {
      const ageMs = now - quote.timestamp.getTime();
      return {
        price: quote.midPrice > 0 ? quote.midPrice : quote.lastPrice,
        timestamp: quote.timestamp,
        source: "QUOTE",
        ageMs,
      };
    }
    
    if (bar && bar.close > 0) {
      const ageMs = now - bar.time.getTime();
      return {
        price: bar.close,
        timestamp: bar.time,
        source: "BAR",
        ageMs,
      };
    }
    
    return {
      price: null,
      timestamp: null,
      source: "NONE",
      ageMs: Infinity,
    };
  }

  getActiveSymbols(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  getSubscriptionCount(): number {
    let count = 0;
    this.subscriptions.forEach(subs => count += subs.length);
    return count;
  }

  getDataSource(): DataSource {
    return this.activeDataSource;
  }

  getStatus(): {
    running: boolean;
    dataSource: DataSource;
    subscriptions: number;
    symbols: string[];
    ironbeamConnected: boolean;
    lastUpdateTime: number;
    lastQuoteUpdateTime: number;
    quotesReceived: number;
    barsReceived: number;
    ironbeamDetails: {
      isReconnecting: boolean;
      reconnectAttempts: number;
      consecutiveFailures: number;
      lastSuccessfulConnection: Date | null;
      lastQuoteTime: Date | null;
      isMarketOpen: boolean;
    } | null;
  } {
    const ironbeamStatus = this.ironbeamClient?.getStatus();
    
    // Compute lastUpdateTime from the most recent quote across all symbols
    let lastQuoteUpdateTime = 0;
    this.lastQuotes.forEach(quote => {
      const quoteTime = quote.timestamp.getTime();
      if (quoteTime > lastQuoteUpdateTime) {
        lastQuoteUpdateTime = quoteTime;
      }
    });
    
    // Compute lastUpdateTime from the most recent bar across all symbols
    let lastBarUpdateTime = 0;
    this.lastBars.forEach(bar => {
      const barTime = bar.time.getTime();
      if (barTime > lastBarUpdateTime) {
        lastBarUpdateTime = barTime;
      }
    });
    
    // Use the most recent of quote or bar
    const lastUpdateTime = Math.max(lastQuoteUpdateTime, lastBarUpdateTime);
    
    return {
      running: this.isRunning,
      dataSource: this.activeDataSource,
      subscriptions: this.getSubscriptionCount(),
      symbols: this.getActiveSymbols(),
      ironbeamConnected: ironbeamStatus?.connected ?? false,
      lastUpdateTime,
      lastQuoteUpdateTime,
      quotesReceived: this.quotesReceivedFromIronbeam,
      barsReceived: this.barsReceivedFromIronbeam,
      ironbeamDetails: ironbeamStatus ? {
        isReconnecting: ironbeamStatus.isReconnecting,
        reconnectAttempts: ironbeamStatus.reconnectAttempts,
        consecutiveFailures: ironbeamStatus.consecutiveFailures,
        lastSuccessfulConnection: ironbeamStatus.lastSuccessfulConnection,
        lastQuoteTime: ironbeamStatus.lastQuoteTime,
        isMarketOpen: ironbeamStatus.isMarketOpen,
      } : null,
    };
  }
}

export const liveDataService = new LiveDataServiceImpl();
