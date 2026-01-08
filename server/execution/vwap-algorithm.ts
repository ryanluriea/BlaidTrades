import type { LiveBar } from "../live-data-service";

export interface VWAPOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  slices: VWAPSlice[];
  startTime: Date;
  endTime: Date;
  status: "PENDING" | "EXECUTING" | "COMPLETED" | "CANCELLED";
  avgFillPrice: number;
  benchmarkVWAP: number;
  slippage: number;
  volumeProfile: VolumeProfileBucket[];
  createdAt: Date;
}

export interface VWAPSlice {
  id: string;
  orderId: string;
  bucketIndex: number;
  targetParticipation: number;
  quantity: number;
  scheduledTime: Date;
  executedTime?: Date;
  fillPrice?: number;
  marketVolume?: number;
  status: "SCHEDULED" | "EXECUTING" | "FILLED" | "FAILED";
}

export interface VolumeProfileBucket {
  hour: number;
  minute: number;
  volumeWeight: number;
  cumulativeWeight: number;
}

export interface VWAPConfig {
  durationMinutes: number;
  bucketSizeMinutes: number;
  maxParticipationRate: number;
  minSliceSize: number;
  maxSlippage: number;
}

const DEFAULT_CONFIG: VWAPConfig = {
  durationMinutes: 60,
  bucketSizeMinutes: 5,
  maxParticipationRate: 0.15,
  minSliceSize: 1,
  maxSlippage: 0.003,
};

export class VWAPAlgorithm {
  private config: VWAPConfig;
  private activeOrders: Map<string, VWAPOrder> = new Map();
  private volumeProfiles: Map<string, VolumeProfileBucket[]> = new Map();

  constructor(config: Partial<VWAPConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  buildVolumeProfile(symbol: string, historicalBars: LiveBar[]): VolumeProfileBucket[] {
    const volumeByTime: Map<string, number[]> = new Map();

    for (const bar of historicalBars) {
      const hour = bar.time.getUTCHours();
      const minuteBucket = Math.floor(bar.time.getUTCMinutes() / this.config.bucketSizeMinutes) * this.config.bucketSizeMinutes;
      const key = `${hour}:${minuteBucket}`;
      
      if (!volumeByTime.has(key)) {
        volumeByTime.set(key, []);
      }
      volumeByTime.get(key)!.push(bar.volume);
    }

    const buckets: VolumeProfileBucket[] = [];
    let totalVolume = 0;

    volumeByTime.forEach((volumes, key) => {
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      totalVolume += avgVolume;
      const [hour, minute] = key.split(":").map(Number);
      buckets.push({
        hour,
        minute,
        volumeWeight: avgVolume,
        cumulativeWeight: 0,
      });
    });

    buckets.sort((a, b) => {
      if (a.hour !== b.hour) return a.hour - b.hour;
      return a.minute - b.minute;
    });

    let cumulative = 0;
    for (const bucket of buckets) {
      bucket.volumeWeight = totalVolume > 0 ? bucket.volumeWeight / totalVolume : 1 / buckets.length;
      cumulative += bucket.volumeWeight;
      bucket.cumulativeWeight = cumulative;
    }

    this.volumeProfiles.set(symbol, buckets);
    console.log(`[VWAP] Built volume profile for ${symbol}: ${buckets.length} buckets from ${historicalBars.length} bars`);
    
    return buckets;
  }

  createOrder(
    symbol: string,
    side: "BUY" | "SELL",
    totalQuantity: number,
    benchmarkVWAP: number,
    config?: Partial<VWAPConfig>
  ): VWAPOrder {
    const effectiveConfig = { ...this.config, ...config };
    const orderId = `vwap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const volumeProfile = this.volumeProfiles.get(symbol) || this.generateDefaultProfile();
    
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + effectiveConfig.durationMinutes * 60 * 1000);
    
    const slices = this.generateSlices(
      orderId,
      totalQuantity,
      startTime,
      endTime,
      volumeProfile,
      effectiveConfig
    );

    const order: VWAPOrder = {
      id: orderId,
      symbol,
      side,
      totalQuantity,
      executedQuantity: 0,
      remainingQuantity: totalQuantity,
      slices,
      startTime,
      endTime,
      status: "PENDING",
      avgFillPrice: 0,
      benchmarkVWAP,
      slippage: 0,
      volumeProfile,
      createdAt: new Date(),
    };

    this.activeOrders.set(orderId, order);
    console.log(`[VWAP] Created order ${orderId}: ${side} ${totalQuantity} ${symbol} over ${effectiveConfig.durationMinutes}min in ${slices.length} slices`);
    
    return order;
  }

  private generateDefaultProfile(): VolumeProfileBucket[] {
    const buckets: VolumeProfileBucket[] = [];
    const numBuckets = 12;
    
    for (let i = 0; i < numBuckets; i++) {
      const hour = 9 + Math.floor(i * 5 / 60);
      const minute = (i * 5) % 60;
      
      let weight = 1 / numBuckets;
      if (i === 0 || i === numBuckets - 1) {
        weight *= 1.5;
      }
      
      buckets.push({
        hour,
        minute,
        volumeWeight: weight,
        cumulativeWeight: 0,
      });
    }

    const total = buckets.reduce((s, b) => s + b.volumeWeight, 0);
    let cumulative = 0;
    for (const bucket of buckets) {
      bucket.volumeWeight /= total;
      cumulative += bucket.volumeWeight;
      bucket.cumulativeWeight = cumulative;
    }

    return buckets;
  }

  private generateSlices(
    orderId: string,
    totalQuantity: number,
    startTime: Date,
    endTime: Date,
    volumeProfile: VolumeProfileBucket[],
    config: VWAPConfig
  ): VWAPSlice[] {
    const slices: VWAPSlice[] = [];
    const duration = endTime.getTime() - startTime.getTime();
    const numBuckets = Math.ceil(config.durationMinutes / config.bucketSizeMinutes);
    
    let remainingQty = totalQuantity;
    const bucketDuration = duration / numBuckets;

    for (let i = 0; i < numBuckets && remainingQty > 0; i++) {
      const scheduledTime = new Date(startTime.getTime() + i * bucketDuration);
      const hour = scheduledTime.getUTCHours();
      const minute = Math.floor(scheduledTime.getUTCMinutes() / config.bucketSizeMinutes) * config.bucketSizeMinutes;
      
      const matchingBucket = volumeProfile.find(b => b.hour === hour && b.minute === minute);
      const volumeWeight = matchingBucket?.volumeWeight || (1 / numBuckets);
      
      let sliceQty: number;
      if (i === numBuckets - 1) {
        sliceQty = remainingQty;
      } else {
        sliceQty = Math.max(
          config.minSliceSize,
          Math.round(totalQuantity * volumeWeight)
        );
        sliceQty = Math.min(sliceQty, remainingQty);
      }

      slices.push({
        id: `${orderId}_slice_${i}`,
        orderId,
        bucketIndex: i,
        targetParticipation: volumeWeight * config.maxParticipationRate,
        quantity: sliceQty,
        scheduledTime,
        status: "SCHEDULED",
      });

      remainingQty -= sliceQty;
    }

    return slices;
  }

  async executeSlice(
    orderId: string,
    sliceId: string,
    fillPrice: number,
    marketVolume?: number
  ): Promise<{ success: boolean; order: VWAPOrder }> {
    const order = this.activeOrders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const slice = order.slices.find(s => s.id === sliceId);
    if (!slice) {
      throw new Error(`Slice ${sliceId} not found in order ${orderId}`);
    }

    slice.status = "FILLED";
    slice.executedTime = new Date();
    slice.fillPrice = fillPrice;
    slice.marketVolume = marketVolume;

    const prevExecuted = order.executedQuantity;
    order.executedQuantity += slice.quantity;
    order.remainingQuantity -= slice.quantity;

    if (prevExecuted === 0) {
      order.avgFillPrice = fillPrice;
    } else {
      order.avgFillPrice = (order.avgFillPrice * prevExecuted + fillPrice * slice.quantity) / order.executedQuantity;
    }

    order.slippage = (order.avgFillPrice - order.benchmarkVWAP) / order.benchmarkVWAP;
    if (order.side === "SELL") {
      order.slippage = -order.slippage;
    }

    if (order.remainingQuantity <= 0) {
      order.status = "COMPLETED";
    } else if (order.status === "PENDING") {
      order.status = "EXECUTING";
    }

    const actualParticipation = marketVolume && marketVolume > 0 
      ? slice.quantity / marketVolume 
      : 0;

    console.log(`[VWAP] Slice ${slice.bucketIndex + 1}/${order.slices.length} filled: ${slice.quantity} @ ${fillPrice.toFixed(2)}, participation=${(actualParticipation * 100).toFixed(1)}%, slippage=${(order.slippage * 100).toFixed(3)}%`);

    return { success: true, order };
  }

  getNextSlice(orderId: string): VWAPSlice | null {
    const order = this.activeOrders.get(orderId);
    if (!order || order.status === "COMPLETED" || order.status === "CANCELLED") {
      return null;
    }

    const now = new Date();
    const pendingSlices = order.slices
      .filter(s => s.status === "SCHEDULED" && s.scheduledTime <= now)
      .sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());

    return pendingSlices[0] || null;
  }

  cancelOrder(orderId: string): VWAPOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    order.status = "CANCELLED";
    order.slices.forEach(s => {
      if (s.status === "SCHEDULED") {
        s.status = "FAILED";
      }
    });

    console.log(`[VWAP] Order ${orderId} cancelled. Executed ${order.executedQuantity}/${order.totalQuantity}`);
    return order;
  }

  getOrder(orderId: string): VWAPOrder | null {
    return this.activeOrders.get(orderId) || null;
  }

  getActiveOrders(): VWAPOrder[] {
    return Array.from(this.activeOrders.values()).filter(o => 
      o.status === "PENDING" || o.status === "EXECUTING"
    );
  }

  getExecutionQuality(orderId: string): {
    slippage: number;
    vwapDeviation: number;
    participationRate: number;
    completionRate: number;
    volumeWeightedSlippage: number;
  } | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    const filledSlices = order.slices.filter(s => s.status === "FILLED");
    const totalSlices = order.slices.length;

    let totalMarketVol = 0;
    let participatedVol = 0;
    
    filledSlices.forEach(slice => {
      if (slice.marketVolume) {
        totalMarketVol += slice.marketVolume;
        participatedVol += slice.quantity;
      }
    });

    const vwapDeviation = order.benchmarkVWAP > 0 
      ? (order.avgFillPrice - order.benchmarkVWAP) / order.benchmarkVWAP 
      : 0;

    return {
      slippage: order.slippage,
      vwapDeviation,
      participationRate: totalMarketVol > 0 ? participatedVol / totalMarketVol : 0,
      completionRate: filledSlices.length / totalSlices,
      volumeWeightedSlippage: vwapDeviation * (order.executedQuantity / order.totalQuantity),
    };
  }

  calculateVWAP(bars: LiveBar[]): number {
    if (bars.length === 0) return 0;
    
    let sumPriceVolume = 0;
    let sumVolume = 0;
    
    for (const bar of bars) {
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      sumPriceVolume += typicalPrice * bar.volume;
      sumVolume += bar.volume;
    }
    
    return sumVolume > 0 ? sumPriceVolume / sumVolume : bars[bars.length - 1].close;
  }
}

export const vwapAlgorithm = new VWAPAlgorithm();
