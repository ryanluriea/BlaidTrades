/**
 * Price Authority Module - Institutional-Grade Price Freshness
 * 
 * ZERO TOLERANCE for stale data display. This module is the SINGLE SOURCE
 * of truth for whether a mark price is valid for P&L computation.
 * 
 * Authority Hierarchy (QUOTE-FIRST ARCHITECTURE):
 * 1. PRIMARY: liveDataService.getLastQuote() - Real-time tick data (sub-second)
 * 2. SECONDARY: liveDataService.getLastBar() - 1-minute bar close (for strategy signals)
 * 3. TERTIARY: bar-cache (historical bars, only if <60s old)
 * 4. UNAVAILABLE: Show "Awaiting live mark" - NEVER compute P&L without fresh mark
 * 
 * Staleness Rules (QUOTE-AWARE):
 * - Quote >5s old = STALE - emit alert (industry standard for tick feeds)
 * - Bar >75s old = STALE - acceptable for 1-minute bars
 * - Mark >60s old = UNAVAILABLE - halt P&L computation entirely
 * - Cache mode with real trading = BLOCKED - autonomy halts
 */

import crypto from "crypto";
import { liveDataService } from "./live-data-service";
import { getCachedBars } from "./bar-cache";
import { logActivityEvent } from "./activity-logger";
import { notifyDataHealthDegradation, notifyExecutionRisk } from "./notification-router";

export type PriceSource = "QUOTE" | "IRONBEAM" | "CACHE" | "NONE";
export type MarkStatus = "FRESH" | "STALE" | "UNAVAILABLE";

export interface MarkResult {
  price: number | null;
  timestamp: Date | null;
  source: PriceSource;
  status: MarkStatus;
  ageMs: number;
  isFresh: boolean;
}

// Quote-aware staleness thresholds
const QUOTE_STALE_THRESHOLD_MS = 5_000;  // 5s for tick data (industry standard)
const BAR_STALE_THRESHOLD_MS = 75_000;   // 75s for 1-min bars (allows for late aggregation)
const UNAVAILABLE_THRESHOLD_MS = 120_000; // 2 min = data source is down

let lastStaleAlert: Map<string, number> = new Map();
let lastDegradationNotif: Map<string, { source: PriceSource; status: MarkStatus; time: number }> = new Map();
const ALERT_COOLDOWN_MS = 60_000;
const DEGRADATION_NOTIF_COOLDOWN_MS = 300_000; // 5 min cooldown for user notifications

class PriceAuthorityImpl {
  private traceId: string = crypto.randomUUID().slice(0, 8);
  
  /**
   * Get mark price using QUOTE-FIRST architecture.
   * Priority: Quote (real-time tick) > Bar (1-min aggregate) > Cache
   */
  async getMark(symbol: string, timeframe: string = "1m"): Promise<MarkResult> {
    const now = Date.now();
    
    // PRIORITY 1: Real-time quote (sub-second freshness)
    const quote = liveDataService.getLastQuote(symbol);
    if (quote && quote.lastPrice > 0) {
      const ageMs = now - quote.timestamp.getTime();
      const status = this.computeQuoteStatus(ageMs);
      
      if (status === "STALE") {
        await this.emitStaleAlert(symbol, ageMs, "QUOTE");
      }
      
      // Use mid-price for fair value, fallback to last price
      const markPrice = quote.midPrice > 0 ? quote.midPrice : quote.lastPrice;
      
      return {
        price: markPrice,
        timestamp: quote.timestamp,
        source: "QUOTE",
        status,
        ageMs,
        isFresh: status === "FRESH",
      };
    }
    
    // PRIORITY 2: 1-minute bar close (for when quotes aren't flowing)
    const liveBar = liveDataService.getLastBar(symbol, timeframe);
    if (liveBar && liveBar.close > 0) {
      const ageMs = now - liveBar.time.getTime();
      const status = this.computeBarStatus(ageMs);
      
      if (status === "STALE") {
        await this.emitStaleAlert(symbol, ageMs, "IRONBEAM");
      }
      
      return {
        price: liveBar.close,
        timestamp: liveBar.time,
        source: "IRONBEAM",
        status,
        ageMs,
        isFresh: status === "FRESH",
      };
    }
    
    // PRIORITY 3: Cache fallback (historical data)
    const cachedMark = await this.getFromCache(symbol);
    if (cachedMark.price !== null) {
      const ageMs = cachedMark.timestamp ? now - cachedMark.timestamp.getTime() : UNAVAILABLE_THRESHOLD_MS + 1;
      const status = this.computeBarStatus(ageMs); // Use bar thresholds for cache
      
      if (status !== "UNAVAILABLE") {
        if (status === "STALE") {
          await this.emitStaleAlert(symbol, ageMs, "CACHE");
        }
        
        return {
          price: cachedMark.price,
          timestamp: cachedMark.timestamp,
          source: "CACHE",
          status,
          ageMs,
          isFresh: status === "FRESH",
        };
      }
    }
    
    return {
      price: null,
      timestamp: null,
      source: "NONE",
      status: "UNAVAILABLE",
      ageMs: Infinity,
      isFresh: false,
    };
  }
  
  /**
   * Status computation for QUOTE data (5s freshness threshold)
   */
  private computeQuoteStatus(ageMs: number): MarkStatus {
    if (ageMs <= QUOTE_STALE_THRESHOLD_MS) return "FRESH";
    if (ageMs <= UNAVAILABLE_THRESHOLD_MS) return "STALE";
    return "UNAVAILABLE";
  }
  
  /**
   * Status computation for BAR data (75s freshness threshold)
   */
  private computeBarStatus(ageMs: number): MarkStatus {
    if (ageMs <= BAR_STALE_THRESHOLD_MS) return "FRESH";
    if (ageMs <= UNAVAILABLE_THRESHOLD_MS) return "STALE";
    return "UNAVAILABLE";
  }
  
  private async getFromCache(symbol: string): Promise<{ price: number | null; timestamp: Date | null }> {
    try {
      const traceId = crypto.randomUUID().slice(0, 8);
      const bars = await getCachedBars(symbol, traceId);
      
      if (bars && bars.length > 0) {
        const latestBar = bars[bars.length - 1];
        return {
          price: latestBar.close,
          timestamp: latestBar.time,
        };
      }
    } catch (error) {
      console.error(`[PRICE_AUTHORITY] Cache lookup failed for ${symbol}:`, error);
    }
    
    return { price: null, timestamp: null };
  }
  
  private async emitStaleAlert(symbol: string, ageMs: number, source: PriceSource): Promise<void> {
    const now = Date.now();
    const lastAlert = lastStaleAlert.get(symbol) || 0;
    
    if (now - lastAlert < ALERT_COOLDOWN_MS) return;
    
    lastStaleAlert.set(symbol, now);
    
    const ageSec = Math.round(ageMs / 1000);
    console.error(`[PRICE_AUTHORITY] SEV-0 STALE_MARK symbol=${symbol} source=${source} age=${ageSec}s`);
    
    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "WARN",
      title: "Stale Market Data",
      summary: `${symbol} mark is ${ageSec}s old from ${source}`,
      payload: {
        symbol,
        source,
        ageMs,
        quoteThreshold: QUOTE_STALE_THRESHOLD_MS,
        barThreshold: BAR_STALE_THRESHOLD_MS,
      },
      traceId: this.traceId,
    });
  }
  
  private async checkAndNotifyDegradation(
    symbol: string, 
    currentSource: PriceSource, 
    currentStatus: MarkStatus,
    ageMs: number,
    userId?: string,
    botId?: string
  ): Promise<void> {
    const now = Date.now();
    const key = `${symbol}:${botId || 'global'}`;
    const previous = lastDegradationNotif.get(key);
    
    // SEVERITY HIERARCHY: FRESH < STALE < UNAVAILABLE
    const getSeverityLevel = (status: MarkStatus): number => {
      if (status === "FRESH") return 0;
      if (status === "STALE") return 1;
      return 2; // UNAVAILABLE
    };
    
    const currentSeverity = getSeverityLevel(currentStatus);
    const previousSeverity = previous ? getSeverityLevel(previous.status) : 0;
    
    // Detect severity escalation (e.g., STALE -> UNAVAILABLE, or FRESH -> any degradation)
    const isSeverityEscalation = currentSeverity > previousSeverity;
    
    // Detect recovery (for clearing cooldown tracking)
    const isRecovery = currentStatus === "FRESH" && currentSource === "IRONBEAM";
    
    // Clear tracking on recovery so subsequent degradations trigger fresh alerts
    if (isRecovery) {
      lastDegradationNotif.delete(key);
      return;
    }
    
    // Determine if this is a degradation event worth notifying
    const isDegradation = currentSource === "CACHE" || currentSource === "NONE" || currentStatus !== "FRESH";
    
    // BYPASS cooldown for severity escalations - user must know immediately
    const inCooldown = previous && now - previous.time < DEGRADATION_NOTIF_COOLDOWN_MS;
    if (inCooldown && !isSeverityEscalation) {
      // Still in cooldown and not escalating - update state but don't notify
      lastDegradationNotif.set(key, { source: currentSource, status: currentStatus, time: previous.time });
      return;
    }
    
    // Notify on degradation or severity escalation
    if (isDegradation && (isSeverityEscalation || !previous)) {
      if (userId) {
        const isStale = currentStatus === "UNAVAILABLE";
        await notifyDataHealthDegradation({
          userId,
          botId,
          symbol,
          previousSource: previous?.source || "IRONBEAM",
          currentSource,
          isStale,
          staleDurationMs: isStale ? ageMs : undefined,
        }).catch(err => console.error(`[PRICE_AUTHORITY] Failed to notify data degradation:`, err));
        
        console.log(`[PRICE_AUTHORITY] Notified user of data degradation: ${symbol} ${currentSource}/${currentStatus} severity_escalation=${isSeverityEscalation}`);
      }
      
      // Reset cooldown timer after notification
      lastDegradationNotif.set(key, { source: currentSource, status: currentStatus, time: now });
    } else if (isDegradation) {
      // Update state without notifying (same severity level, still in cooldown)
      lastDegradationNotif.set(key, { source: currentSource, status: currentStatus, time: previous?.time || now });
    }
  }
  
  async notifyTradingFrozen(userId: string, botId: string, botName: string, symbol: string, reason: string): Promise<void> {
    await notifyExecutionRisk({
      userId,
      botId,
      botName,
      riskType: "trading_frozen",
      reason,
    }).catch(err => console.error(`[PRICE_AUTHORITY] Failed to notify trading frozen:`, err));
    
    console.log(`[PRICE_AUTHORITY] Trading frozen notification sent for ${botName}: ${reason}`);
  }
  
  shouldHaltAutonomy(): boolean {
    const status = liveDataService.getStatus();
    return status.dataSource === "cache" || status.dataSource === "none";
  }
  
  getDataSourceStatus(): {
    source: "live" | "cache" | "none";
    isLive: boolean;
    autonomyAllowed: boolean;
    isFresh: boolean;
    lastUpdateTime: number;
  } {
    const status = liveDataService.getStatus();
    const isLive = status.dataSource === "ironbeam";
    // Use quote time if available (real-time), otherwise bar time
    const lastUpdateTime = status.lastQuoteUpdateTime || status.lastUpdateTime || 0;
    const ageMs = lastUpdateTime > 0 ? Date.now() - lastUpdateTime : Infinity;
    // Use quote threshold when we have quote data, bar threshold otherwise
    const threshold = status.lastQuoteUpdateTime > 0 ? QUOTE_STALE_THRESHOLD_MS : BAR_STALE_THRESHOLD_MS;
    const isFresh = isLive && ageMs < threshold;
    
    return {
      source: status.dataSource === "ironbeam" ? "live" : status.dataSource || "none",
      isLive,
      autonomyAllowed: isLive,
      isFresh,
      lastUpdateTime,
    };
  }
  
  computePnL(entryPrice: number, markPrice: number, side: "LONG" | "SHORT", quantity: number = 1): number {
    const pointValue = 5;
    const priceDiff = side === "LONG" 
      ? markPrice - entryPrice 
      : entryPrice - markPrice;
    return priceDiff * quantity * pointValue;
  }
  
  /**
   * Compute P&L with mark validation.
   * ZERO TOLERANCE: Only returns shouldDisplay=true when mark is genuinely FRESH.
   */
  async computePnLWithMark(
    botId: string,
    symbol: string, 
    entryPrice: number, 
    side: "LONG" | "SHORT",
    quantity: number = 1,
    timeframe: string = "1m",
    userId?: string
  ): Promise<{
    pnl: number | null;
    mark: MarkResult;
    shouldDisplay: boolean;
    displayMessage: string;
  }> {
    const mark = await this.getMark(symbol, timeframe);
    
    // Track degradation and notify user
    await this.checkAndNotifyDegradation(symbol, mark.source, mark.status, mark.ageMs, userId, botId);
    
    // ZERO TOLERANCE: Only display P&L when mark is genuinely FRESH
    if (!mark.isFresh || mark.status !== "FRESH" || mark.price === null) {
      const displayMessage = mark.price === null
        ? "Awaiting live mark"
        : `Mark is ${mark.status.toLowerCase()} (${Math.round(mark.ageMs / 1000)}s old) - P&L display blocked`;
      
      return {
        pnl: null,
        mark,
        shouldDisplay: false,
        displayMessage,
      };
    }
    
    const pnl = this.computePnL(entryPrice, mark.price, side, quantity);
    
    return {
      pnl,
      mark,
      shouldDisplay: true,
      displayMessage: "",
    };
  }
  
  /**
   * Check if trading should be frozen for a bot due to unavailable or stale marks.
   * ZERO TOLERANCE: Returns freeze status if mark is anything other than FRESH.
   * Paper runner should call this before executing trades.
   */
  async shouldFreezeTrading(symbol: string, timeframe: string = "1m"): Promise<{
    frozen: boolean;
    reason: string;
    mark: MarkResult;
  }> {
    const mark = await this.getMark(symbol, timeframe);
    
    // ZERO TOLERANCE: Only allow trading when mark is genuinely FRESH
    if (!mark.isFresh || mark.status !== "FRESH") {
      const reason = mark.price === null
        ? `No mark price available for ${symbol}. Data source: ${mark.source}`
        : `Mark is ${mark.status} (${Math.round(mark.ageMs / 1000)}s old) from ${mark.source}. Live trading requires FRESH marks (<15s).`;
      
      return {
        frozen: true,
        reason,
        mark,
      };
    }
    
    return {
      frozen: false,
      reason: "",
      mark,
    };
  }
  
  /**
   * INSTITUTIONAL AUDIT: Persist freshness metadata to immutable audit storage
   * for compliance and regulatory requirements.
   * 
   * Called when P&L is displayed, trading decisions are made, or marks are
   * used for any calculation that could affect user-facing values.
   */
  async persistFreshnessAudit(
    botId: string | null,
    symbol: string,
    mark: MarkResult,
    context: {
      action: "pnl_display" | "trade_decision" | "position_valuation" | "trading_freeze";
      displayAllowed: boolean;
      computedPnl?: number | null;
      userId?: string;
      traceId?: string;
    }
  ): Promise<void> {
    try {
      await logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: mark.isFresh ? "INFO" : (mark.status === "UNAVAILABLE" ? "ERROR" : "WARN"),
        title: `Freshness Audit: ${context.action}`,
        summary: `${symbol} mark=${mark.price?.toFixed(2) || 'N/A'} source=${mark.source} status=${mark.status} displayAllowed=${context.displayAllowed}`,
        botId: botId || undefined,
        userId: context.userId,
        symbol,
        traceId: context.traceId || this.traceId,
        payload: {
          auditType: "DATA_FRESHNESS",
          action: context.action,
          mark: {
            price: mark.price,
            timestamp: mark.timestamp?.toISOString() || null,
            source: mark.source,
            status: mark.status,
            ageMs: mark.ageMs,
            isFresh: mark.isFresh,
          },
          displayAllowed: context.displayAllowed,
          computedPnl: context.computedPnl,
          auditedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error(`[PRICE_AUTHORITY] Failed to persist freshness audit:`, error);
    }
  }
  
  /**
   * Get mark with automatic audit logging for compliance-sensitive operations.
   * Use this when the mark will be used for user-facing values or trading decisions.
   * ZERO TOLERANCE: displayAllowed is only true when mark is genuinely FRESH.
   */
  async getMarkWithAudit(
    botId: string,
    symbol: string,
    timeframe: string = "1m",
    action: "pnl_display" | "trade_decision" | "position_valuation",
    userId?: string
  ): Promise<MarkResult> {
    const mark = await this.getMark(symbol, timeframe);
    
    // ZERO TOLERANCE: Only allow display/use when mark is genuinely FRESH
    const displayAllowed = mark.isFresh && mark.status === "FRESH";
    
    // Persist audit trail asynchronously (fire-and-forget for performance)
    this.persistFreshnessAudit(botId, symbol, mark, {
      action,
      displayAllowed,
      userId,
    }).catch(err => console.error(`[PRICE_AUTHORITY] Audit persist failed:`, err));
    
    return mark;
  }
}

export const priceAuthority = new PriceAuthorityImpl();
