export interface TWAPOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  totalQuantity: number;
  executedQuantity: number;
  remainingQuantity: number;
  slices: TWAPSlice[];
  startTime: Date;
  endTime: Date;
  status: "PENDING" | "EXECUTING" | "COMPLETED" | "CANCELLED";
  avgFillPrice: number;
  benchmarkPrice: number;
  slippage: number;
  createdAt: Date;
}

export interface TWAPSlice {
  id: string;
  orderId: string;
  sliceNumber: number;
  quantity: number;
  scheduledTime: Date;
  executedTime?: Date;
  fillPrice?: number;
  status: "SCHEDULED" | "EXECUTING" | "FILLED" | "FAILED";
}

export interface TWAPConfig {
  durationMinutes: number;
  numSlices: number;
  minSliceSize: number;
  randomizeTiming: boolean;
  randomizeSize: boolean;
  maxSlippage: number;
}

const DEFAULT_CONFIG: TWAPConfig = {
  durationMinutes: 30,
  numSlices: 10,
  minSliceSize: 1,
  randomizeTiming: true,
  randomizeSize: true,
  maxSlippage: 0.002,
};

export class TWAPAlgorithm {
  private config: TWAPConfig;
  private activeOrders: Map<string, TWAPOrder> = new Map();

  constructor(config: Partial<TWAPConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  createOrder(
    symbol: string,
    side: "BUY" | "SELL",
    totalQuantity: number,
    benchmarkPrice: number,
    config?: Partial<TWAPConfig>
  ): TWAPOrder {
    const effectiveConfig = { ...this.config, ...config };
    const orderId = `twap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + effectiveConfig.durationMinutes * 60 * 1000);
    
    const slices = this.generateSlices(
      orderId,
      totalQuantity,
      startTime,
      endTime,
      effectiveConfig
    );

    const order: TWAPOrder = {
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
      benchmarkPrice,
      slippage: 0,
      createdAt: new Date(),
    };

    this.activeOrders.set(orderId, order);
    console.log(`[TWAP] Created order ${orderId}: ${side} ${totalQuantity} ${symbol} over ${effectiveConfig.durationMinutes}min in ${slices.length} slices`);
    
    return order;
  }

  private generateSlices(
    orderId: string,
    totalQuantity: number,
    startTime: Date,
    endTime: Date,
    config: TWAPConfig
  ): TWAPSlice[] {
    const slices: TWAPSlice[] = [];
    const duration = endTime.getTime() - startTime.getTime();
    const baseInterval = duration / config.numSlices;
    const baseSliceSize = totalQuantity / config.numSlices;
    
    let remainingQty = totalQuantity;
    let currentTime = startTime.getTime();

    for (let i = 0; i < config.numSlices; i++) {
      let sliceQty: number;
      if (i === config.numSlices - 1) {
        sliceQty = remainingQty;
      } else {
        sliceQty = config.randomizeSize
          ? Math.max(config.minSliceSize, Math.round(baseSliceSize * (0.8 + Math.random() * 0.4)))
          : Math.round(baseSliceSize);
        sliceQty = Math.min(sliceQty, remainingQty);
      }

      let scheduledTime = currentTime;
      if (config.randomizeTiming && i > 0) {
        const jitter = baseInterval * 0.2 * (Math.random() - 0.5);
        scheduledTime += jitter;
      }

      slices.push({
        id: `${orderId}_slice_${i}`,
        orderId,
        sliceNumber: i + 1,
        quantity: sliceQty,
        scheduledTime: new Date(scheduledTime),
        status: "SCHEDULED",
      });

      remainingQty -= sliceQty;
      currentTime += baseInterval;
    }

    return slices;
  }

  async executeSlice(
    orderId: string,
    sliceId: string,
    fillPrice: number
  ): Promise<{ success: boolean; order: TWAPOrder }> {
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

    const prevExecuted = order.executedQuantity;
    order.executedQuantity += slice.quantity;
    order.remainingQuantity -= slice.quantity;

    if (prevExecuted === 0) {
      order.avgFillPrice = fillPrice;
    } else {
      order.avgFillPrice = (order.avgFillPrice * prevExecuted + fillPrice * slice.quantity) / order.executedQuantity;
    }

    order.slippage = (order.avgFillPrice - order.benchmarkPrice) / order.benchmarkPrice;
    if (order.side === "SELL") {
      order.slippage = -order.slippage;
    }

    if (order.remainingQuantity <= 0) {
      order.status = "COMPLETED";
    } else if (order.status === "PENDING") {
      order.status = "EXECUTING";
    }

    console.log(`[TWAP] Slice ${slice.sliceNumber}/${order.slices.length} filled: ${slice.quantity} @ ${fillPrice.toFixed(2)}, slippage=${(order.slippage * 100).toFixed(3)}%`);

    return { success: true, order };
  }

  getNextSlice(orderId: string): TWAPSlice | null {
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

  cancelOrder(orderId: string): TWAPOrder | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    order.status = "CANCELLED";
    order.slices.forEach(s => {
      if (s.status === "SCHEDULED") {
        s.status = "FAILED";
      }
    });

    console.log(`[TWAP] Order ${orderId} cancelled. Executed ${order.executedQuantity}/${order.totalQuantity}`);
    return order;
  }

  getOrder(orderId: string): TWAPOrder | null {
    return this.activeOrders.get(orderId) || null;
  }

  getActiveOrders(): TWAPOrder[] {
    return Array.from(this.activeOrders.values()).filter(o => 
      o.status === "PENDING" || o.status === "EXECUTING"
    );
  }

  getExecutionQuality(orderId: string): {
    slippage: number;
    participationRate: number;
    completionRate: number;
    avgSliceTime: number;
  } | null {
    const order = this.activeOrders.get(orderId);
    if (!order) return null;

    const filledSlices = order.slices.filter(s => s.status === "FILLED");
    const totalSlices = order.slices.length;

    let totalSliceTime = 0;
    filledSlices.forEach((slice, i) => {
      if (slice.executedTime) {
        const diff = slice.executedTime.getTime() - slice.scheduledTime.getTime();
        totalSliceTime += Math.abs(diff);
      }
    });

    return {
      slippage: order.slippage,
      participationRate: order.executedQuantity / order.totalQuantity,
      completionRate: filledSlices.length / totalSlices,
      avgSliceTime: filledSlices.length > 0 ? totalSliceTime / filledSlices.length / 1000 : 0,
    };
  }
}

export const twapAlgorithm = new TWAPAlgorithm();
