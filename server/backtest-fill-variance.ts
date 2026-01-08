/**
 * Backtest Fill Variance - Realistic Fill Simulation
 * 
 * INDUSTRY STANDARD: Backtests should account for execution uncertainty.
 * - Randomized fill offsets within volatility envelopes
 * - Seeded RNG for deterministic replay
 * - Partial fill simulation
 * - Slippage based on market conditions
 * 
 * Used by: Backtest executor, Strategy evaluation
 */

import { getInstrumentSpec } from "./instrument-spec";

export interface FillVarianceConfig {
  seed: number;                    // RNG seed for determinism
  baseSlippageTicks: number;       // Minimum slippage
  volatilityMultiplier: number;    // How much volatility affects fills
  partialFillProbability: number;  // 0-1 probability of partial fill
  minFillRatio: number;            // Minimum fill ratio for partial fills
}

export interface SimulatedFill {
  requestedPrice: number;
  fillPrice: number;
  requestedQty: number;
  filledQty: number;
  slippageTicks: number;
  slippageValue: number;
  isPartialFill: boolean;
  fillRatio: number;
  seed: number;
}

const DEFAULT_CONFIG: FillVarianceConfig = {
  seed: 42,
  baseSlippageTicks: 1,
  volatilityMultiplier: 0.5,
  partialFillProbability: 0.05,   // 5% chance of partial fill
  minFillRatio: 0.5,              // At least 50% filled on partials
};

class SeededRNG {
  private seed: number;
  
  constructor(seed: number) {
    this.seed = seed;
  }
  
  /**
   * Mulberry32 PRNG - fast and good quality
   */
  next(): number {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  
  /**
   * Gaussian distribution using Box-Muller transform
   */
  nextGaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = this.next();
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }
  
  getSeed(): number {
    return this.seed;
  }
}

class BacktestFillVarianceEngine {
  private config: FillVarianceConfig = DEFAULT_CONFIG;
  private rng: SeededRNG;
  private fillCount = 0;
  
  constructor() {
    this.rng = new SeededRNG(this.config.seed);
  }
  
  /**
   * Configure the fill variance engine
   */
  setConfig(config: Partial<FillVarianceConfig>): void {
    this.config = { ...this.config, ...config };
    this.rng = new SeededRNG(this.config.seed);
    this.fillCount = 0;
    console.log(`[FILL_VARIANCE] config updated: seed=${this.config.seed} base_slippage=${this.config.baseSlippageTicks}`);
  }
  
  /**
   * Reset the RNG to initial seed state
   */
  reset(): void {
    this.rng = new SeededRNG(this.config.seed);
    this.fillCount = 0;
  }
  
  /**
   * Simulate a fill with realistic variance
   * 
   * @param symbol - The instrument symbol
   * @param direction - "long" or "short"
   * @param requestedPrice - The theoretical fill price
   * @param requestedQty - The order quantity
   * @param barVolatility - Optional volatility of the bar (high-low range)
   * @param barVolume - Optional volume of the bar
   */
  simulateFill(
    symbol: string,
    direction: "long" | "short",
    requestedPrice: number,
    requestedQty: number,
    barVolatility?: number,
    barVolume?: number
  ): SimulatedFill {
    const spec = getInstrumentSpec(symbol);
    const tickSize = spec?.tickSize ?? 0.25;
    
    this.fillCount++;
    
    // Calculate slippage
    const volatilityFactor = barVolatility 
      ? (barVolatility / requestedPrice) * this.config.volatilityMultiplier * 100
      : 0;
    
    // Gaussian slippage centered on base with volatility adjustment
    const rawSlippage = this.rng.nextGaussian(
      this.config.baseSlippageTicks,
      Math.max(0.5, this.config.baseSlippageTicks * 0.5 + volatilityFactor)
    );
    
    // Ensure non-negative slippage (we always slip unfavorably)
    const slippageTicks = Math.max(0, Math.round(Math.abs(rawSlippage)));
    const slippageValue = slippageTicks * tickSize;
    
    // Apply slippage in unfavorable direction
    const fillPrice = direction === "long"
      ? requestedPrice + slippageValue
      : requestedPrice - slippageValue;
    
    // Check for partial fill
    let filledQty = requestedQty;
    let isPartialFill = false;
    let fillRatio = 1.0;
    
    if (this.rng.next() < this.config.partialFillProbability) {
      // Partial fill
      isPartialFill = true;
      fillRatio = this.config.minFillRatio + 
        this.rng.next() * (1 - this.config.minFillRatio);
      filledQty = Math.max(1, Math.floor(requestedQty * fillRatio));
      fillRatio = filledQty / requestedQty;
    }
    
    return {
      requestedPrice,
      fillPrice,
      requestedQty,
      filledQty,
      slippageTicks,
      slippageValue,
      isPartialFill,
      fillRatio,
      seed: this.rng.getSeed(),
    };
  }
  
  /**
   * Simulate multiple fills for the same order (e.g., scaling in/out)
   */
  simulateMultiFill(
    symbol: string,
    direction: "long" | "short",
    requestedPrice: number,
    totalQty: number,
    numFills: number,
    barVolatility?: number
  ): SimulatedFill[] {
    const fills: SimulatedFill[] = [];
    let remainingQty = totalQty;
    const baseQtyPerFill = Math.floor(totalQty / numFills);
    
    for (let i = 0; i < numFills && remainingQty > 0; i++) {
      // Last fill gets remaining quantity
      const fillQty = i === numFills - 1 ? remainingQty : baseQtyPerFill;
      
      // Price moves slightly between fills
      const priceOffset = this.rng.nextGaussian(0, barVolatility ?? 0.1);
      const adjustedPrice = requestedPrice + priceOffset;
      
      const fill = this.simulateFill(
        symbol,
        direction,
        adjustedPrice,
        fillQty,
        barVolatility
      );
      
      fills.push(fill);
      remainingQty -= fill.filledQty;
    }
    
    return fills;
  }
  
  /**
   * Get aggregate statistics for a series of fills
   */
  aggregateFills(fills: SimulatedFill[]): {
    totalQtyFilled: number;
    avgFillPrice: number;
    totalSlippage: number;
    avgSlippageTicks: number;
    partialFillCount: number;
  } {
    if (fills.length === 0) {
      return {
        totalQtyFilled: 0,
        avgFillPrice: 0,
        totalSlippage: 0,
        avgSlippageTicks: 0,
        partialFillCount: 0,
      };
    }
    
    const totalQtyFilled = fills.reduce((sum, f) => sum + f.filledQty, 0);
    const weightedPrice = fills.reduce((sum, f) => sum + f.fillPrice * f.filledQty, 0);
    const avgFillPrice = totalQtyFilled > 0 ? weightedPrice / totalQtyFilled : 0;
    const totalSlippage = fills.reduce((sum, f) => sum + f.slippageValue * f.filledQty, 0);
    const avgSlippageTicks = fills.reduce((sum, f) => sum + f.slippageTicks, 0) / fills.length;
    const partialFillCount = fills.filter(f => f.isPartialFill).length;
    
    return {
      totalQtyFilled,
      avgFillPrice,
      totalSlippage,
      avgSlippageTicks,
      partialFillCount,
    };
  }
  
  /**
   * Get current configuration
   */
  getConfig(): FillVarianceConfig {
    return { ...this.config };
  }
  
  /**
   * Get fill count since last reset
   */
  getFillCount(): number {
    return this.fillCount;
  }
}

export const backtestFillVariance = new BacktestFillVarianceEngine();
