/**
 * Execution Context Service - Dynamic Slippage & Fill Quality
 * 
 * INDUSTRY STANDARD: Slippage should be condition-dependent, not static.
 * This service provides real-time execution quality estimates based on:
 * - Current spread (from Level 2 order book)
 * - Market volatility (5-minute price variance)
 * - Order flow imbalance (buy vs sell pressure)
 * - Time of day (avoid illiquid periods)
 * 
 * Used by: PaperRunner, BacktestExecutor, RiskEngine
 */

import { getInstrumentSpec, InstrumentSpec } from "./instrument-spec";

export interface ExecutionContext {
  symbol: string;
  timestamp: Date;
  baseTick: number;           // Contract tick size
  currentSpread: number;      // Current bid-ask spread in ticks
  avgSpread5m: number;        // 5-minute average spread
  volatility5m: number;       // 5-minute price volatility %
  imbalance: number;          // Order flow imbalance (-1 to 1)
  liquidityScore: number;     // 0-100 score
  suggestedSlippageTicks: number;  // Dynamic slippage estimate
  isLiquidPeriod: boolean;    // True during regular trading hours
  source: "live" | "simulated";
}

export interface SlippageConfig {
  mode: "dynamic" | "fixed";
  fixedTicks?: number;
  minTicks: number;
  maxTicks: number;
  volatilityMultiplier: number;  // How much volatility affects slippage
  imbalanceMultiplier: number;   // How much imbalance affects slippage
}

const DEFAULT_SLIPPAGE_CONFIG: SlippageConfig = {
  mode: "dynamic",
  minTicks: 1,
  maxTicks: 8,
  volatilityMultiplier: 0.15,
  imbalanceMultiplier: 0.5,
};

class ExecutionContextServiceImpl {
  private config: SlippageConfig = DEFAULT_SLIPPAGE_CONFIG;
  private microstructureCache: Map<string, {
    spread: number;
    volatility: number;
    imbalance: number;
    liquidityScore: number;
    timestamp: Date;
  }> = new Map();
  
  /**
   * Update microstructure data from Ironbeam order book
   * Called by live-data-service when order book updates
   */
  updateMicrostructure(
    symbol: string,
    spread: number,
    volatility: number,
    imbalance: number,
    liquidityScore: number
  ): void {
    this.microstructureCache.set(symbol, {
      spread,
      volatility,
      imbalance,
      liquidityScore,
      timestamp: new Date(),
    });
  }
  
  /**
   * Get execution context for a symbol
   * Combines live microstructure data with instrument specs
   */
  getContext(symbol: string): ExecutionContext {
    const spec = getInstrumentSpec(symbol);
    const cached = this.microstructureCache.get(symbol);
    const now = new Date();
    
    // Fallback tick size if instrument not found
    const tickSize = spec?.tickSize ?? 0.25;
    const defaultSpec: InstrumentSpec = spec ?? {
      symbol,
      fullName: symbol,
      exchange: "CME",
      assetClass: "Equity Index",
      tickSize,
      pointValue: 5,  // Default for micros
      currency: "USD",
      tradingHours: {
        rth: { start: "09:30", end: "16:00" },
        eth: { start: "18:00", end: "17:00" },
        timezone: "America/New_York",
      },
      minPriceIncrement: tickSize,
      priceDecimals: 2,
      commission: 0.62,
      slippageTicks: 1,
      marginRequirement: 50,
      category: "equity_index",
      priceBounds: {
        min: 0,
        max: 50000,
        maxDailyMove: 0.10,
      },
    };
    
    if (cached && Date.now() - cached.timestamp.getTime() < 60_000) {
      // Use live data if fresh (< 1 minute old)
      return this.buildContext(symbol, defaultSpec, cached, "live");
    }
    
    // Simulate reasonable defaults when no live data
    return this.buildContext(symbol, defaultSpec, {
      spread: tickSize * 2,  // Assume 2-tick spread
      volatility: 0.1,            // 0.1% volatility
      imbalance: 0,               // Neutral
      liquidityScore: 80,         // Assume decent liquidity
      timestamp: now,
    }, "simulated");
  }
  
  private buildContext(
    symbol: string,
    spec: InstrumentSpec,
    data: { spread: number; volatility: number; imbalance: number; liquidityScore: number; timestamp: Date },
    source: "live" | "simulated"
  ): ExecutionContext {
    const baseSlippageTicks = Math.max(1, Math.round(data.spread / spec.tickSize / 2));
    
    // Dynamic slippage calculation
    const volatilityAdj = data.volatility * this.config.volatilityMultiplier * 10;  // Scale up
    const imbalanceAdj = Math.abs(data.imbalance) * this.config.imbalanceMultiplier * baseSlippageTicks;
    
    // Liquidity penalty: poor liquidity adds slippage
    const liquidityPenalty = Math.max(0, (50 - data.liquidityScore) / 50) * 2;
    
    let suggestedSlippageTicks = Math.round(baseSlippageTicks + volatilityAdj + imbalanceAdj + liquidityPenalty);
    
    // Clamp to configured bounds
    suggestedSlippageTicks = Math.max(this.config.minTicks, Math.min(this.config.maxTicks, suggestedSlippageTicks));
    
    // Use fixed if configured
    if (this.config.mode === "fixed" && this.config.fixedTicks) {
      suggestedSlippageTicks = this.config.fixedTicks;
    }
    
    return {
      symbol,
      timestamp: data.timestamp,
      baseTick: spec.tickSize,
      currentSpread: data.spread,
      avgSpread5m: data.spread,  // TODO: track 5m average
      volatility5m: data.volatility,
      imbalance: data.imbalance,
      liquidityScore: data.liquidityScore,
      suggestedSlippageTicks,
      isLiquidPeriod: this.isLiquidPeriod(),
      source,
    };
  }
  
  /**
   * Calculate fill price with slippage for a given order
   * Returns the expected fill price after slippage
   */
  calculateFillPrice(
    symbol: string,
    direction: "long" | "short",
    basePrice: number,
    overrideSlippageTicks?: number
  ): { fillPrice: number; slippageTicks: number; slippageValue: number } {
    const context = this.getContext(symbol);
    const slippageTicks = overrideSlippageTicks ?? context.suggestedSlippageTicks;
    const slippageValue = slippageTicks * context.baseTick;
    
    // Buys get filled at ask (higher), sells get filled at bid (lower)
    const fillPrice = direction === "long" 
      ? basePrice + slippageValue 
      : basePrice - slippageValue;
    
    return { fillPrice, slippageTicks, slippageValue };
  }
  
  /**
   * Check if current time is during liquid trading hours
   * CME Globex: Sunday 5pm - Friday 5pm CT, with maintenance breaks
   */
  private isLiquidPeriod(): boolean {
    const now = new Date();
    const hour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay();
    
    // Weekend (Saturday after 10pm UTC, Sunday before 10pm UTC)
    if (dayOfWeek === 6 && hour >= 22) return false;
    if (dayOfWeek === 0 && hour < 22) return false;
    
    // Daily maintenance break 21:00-22:00 UTC (4-5pm CT)
    if (hour >= 21 && hour < 22) return false;
    
    // Low liquidity: Asian session for equity index futures
    // 0:00-6:00 UTC tends to have thinner books
    if (hour >= 0 && hour < 6) return false;
    
    return true;
  }
  
  /**
   * Configure slippage behavior
   */
  setConfig(config: Partial<SlippageConfig>): void {
    this.config = { ...this.config, ...config };
    console.log(`[EXECUTION_CONTEXT] config updated: mode=${this.config.mode} min=${this.config.minTicks} max=${this.config.maxTicks}`);
  }
  
  getConfig(): SlippageConfig {
    return { ...this.config };
  }
  
  /**
   * Get all cached microstructure data for monitoring
   */
  getAllContexts(): Map<string, ExecutionContext> {
    const result = new Map<string, ExecutionContext>();
    for (const symbol of this.microstructureCache.keys()) {
      result.set(symbol, this.getContext(symbol));
    }
    return result;
  }
}

export const executionContextService = new ExecutionContextServiceImpl();
