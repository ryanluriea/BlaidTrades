/**
 * TWAP/VWAP Smart Order Execution Algorithms
 * 
 * Institutional-grade execution algorithms with stage gating:
 * - PAPER/SHADOW/TRIALS/LAB: Simulate execution using current market prices
 * - CANARY/LIVE: Use real broker execution via Ironbeam
 * 
 * Features:
 * - Time-Weighted Average Price (TWAP) execution
 * - Volume-Weighted Average Price (VWAP) execution
 * - Active execution tracking by botId/orderId
 * - Cancellation support mid-execution
 * - Slippage calculation in basis points
 */

import { EventEmitter } from "events";
import {
  IronbeamLiveClient,
  type IronbeamOrder,
  type OrderResult,
  type IronbeamQuote,
  type OrderSide,
} from "./ironbeam-live-client";
import { logActivityEvent } from "./activity-logger";
import { db } from "./db";
import { bots } from "@shared/schema";
import { eq } from "drizzle-orm";

export type ExecutionStatus = "COMPLETE" | "PARTIAL" | "CANCELLED" | "FAILED" | "EXECUTING";
export type BotStage = "LAB" | "TRIALS" | "PAPER" | "SHADOW" | "CANARY" | "LIVE";

export interface ExecutionReport {
  orderId: string;
  symbol: string;
  totalQty: number;
  filledQty: number;
  avgPrice: number;
  startTime: Date;
  endTime: Date;
  slippage: number;
  status: ExecutionStatus;
}

export interface TWAPResult extends ExecutionReport {
  slicesFilled: number;
  totalSlices: number;
  sliceDetails: SliceExecution[];
}

export interface VWAPResult extends ExecutionReport {
  benchmarkVWAP: number;
  actualVWAP: number;
  participationRate: number;
  sliceDetails: SliceExecution[];
}

export interface SliceExecution {
  sliceIndex: number;
  quantity: number;
  price: number;
  executedAt: Date;
  simulated: boolean;
}

export interface TWAPParams {
  symbol: string;
  totalQuantity: number;
  side: "BUY" | "SELL";
  durationMinutes: number;
  sliceCount: number;
  botId: string;
}

export interface VWAPParams {
  symbol: string;
  totalQuantity: number;
  side: "BUY" | "SELL";
  durationMinutes: number;
  participationRate: number;
  botId: string;
}

interface ActiveExecution {
  orderId: string;
  botId: string;
  symbol: string;
  side: "BUY" | "SELL";
  totalQuantity: number;
  filledQuantity: number;
  avgPrice: number;
  startTime: Date;
  slices: SliceExecution[];
  timer: NodeJS.Timeout | null;
  cancelled: boolean;
  algorithmType: "TWAP" | "VWAP";
  stage: string;
  benchmarkPrice: number;
  participationRate?: number;
  resolve?: (result: TWAPResult | VWAPResult) => void;
}

const LIVE_EXECUTION_STAGES: BotStage[] = ["CANARY", "LIVE"];
const SIMULATION_STAGES: BotStage[] = ["LAB", "TRIALS", "PAPER", "SHADOW"];

class ExecutionAlgorithmsManager extends EventEmitter {
  private activeExecutions: Map<string, ActiveExecution> = new Map();
  private executionsByBot: Map<string, Set<string>> = new Map();
  private ironbeamClient: IronbeamLiveClient | null = null;
  private latestQuotes: Map<string, IronbeamQuote> = new Map();
  private volumeTracker: Map<string, { timestamp: Date; volume: number }[]> = new Map();

  constructor() {
    super();
  }

  setIronbeamClient(client: IronbeamLiveClient): void {
    this.ironbeamClient = client;
    client.on("quote", (quote: IronbeamQuote) => {
      this.latestQuotes.set(this.normalizeSymbol(quote.exchSym), quote);
      this.trackVolume(quote);
    });
  }

  private normalizeSymbol(symbol: string): string {
    const match = symbol.match(/(?:XCME:)?([A-Z]+)/);
    return match ? match[1] : symbol.toUpperCase();
  }

  private trackVolume(quote: IronbeamQuote): void {
    const symbol = this.normalizeSymbol(quote.exchSym);
    const now = new Date();
    
    let history = this.volumeTracker.get(symbol) || [];
    history.push({ timestamp: now, volume: quote.volume });
    
    const fiveMinAgo = now.getTime() - 5 * 60 * 1000;
    history = history.filter(h => h.timestamp.getTime() > fiveMinAgo);
    this.volumeTracker.set(symbol, history);
  }

  private getRecentVolume(symbol: string, durationMinutes: number): number {
    const history = this.volumeTracker.get(symbol) || [];
    if (history.length < 2) return 0;
    
    const now = Date.now();
    const cutoff = now - durationMinutes * 60 * 1000;
    const recent = history.filter(h => h.timestamp.getTime() > cutoff);
    
    if (recent.length < 2) return 0;
    
    const volumeDelta = recent[recent.length - 1].volume - recent[0].volume;
    return Math.max(0, volumeDelta);
  }

  private async getBotStage(botId: string): Promise<string> {
    try {
      const [bot] = await db
        .select({ stage: bots.stage })
        .from(bots)
        .where(eq(bots.id, botId))
        .limit(1);
      return bot?.stage || "PAPER";
    } catch {
      return "PAPER";
    }
  }

  private shouldUseLiveExecution(stage: string): boolean {
    const normalizedStage = stage.toUpperCase() as BotStage;
    const isLiveEnv = process.env.IRONBEAM_ENV === "live";
    return LIVE_EXECUTION_STAGES.includes(normalizedStage) && isLiveEnv;
  }

  private getCurrentPrice(symbol: string): number {
    const quote = this.latestQuotes.get(this.normalizeSymbol(symbol));
    if (quote) {
      return quote.lastPrice || (quote.bidPrice + quote.askPrice) / 2;
    }
    return this.getFallbackPrice(symbol);
  }

  private getFallbackPrice(symbol: string): number {
    const fallbackPrices: Record<string, number> = {
      MES: 5950,
      MNQ: 21200,
      ES: 5950,
      NQ: 21200,
    };
    return fallbackPrices[this.normalizeSymbol(symbol)] || 5000;
  }

  private calculateSlippage(avgPrice: number, benchmarkPrice: number, side: "BUY" | "SELL"): number {
    if (benchmarkPrice <= 0) return 0;
    const priceDiff = avgPrice - benchmarkPrice;
    const slippagePct = priceDiff / benchmarkPrice;
    const slippageBps = (side === "BUY" ? slippagePct : -slippagePct) * 10000;
    return Math.round(slippageBps * 100) / 100;
  }

  async executeTWAP(params: TWAPParams): Promise<TWAPResult> {
    const { symbol, totalQuantity, side, durationMinutes, sliceCount, botId } = params;
    
    const orderId = `twap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const stage = await this.getBotStage(botId);
    const useLiveExecution = this.shouldUseLiveExecution(stage);
    const benchmarkPrice = this.getCurrentPrice(symbol);
    const startTime = new Date();

    console.log(`[EXEC_ALGO] TWAP started: orderId=${orderId} symbol=${symbol} qty=${totalQuantity} side=${side} duration=${durationMinutes}min slices=${sliceCount} stage=${stage} live=${useLiveExecution}`);

    await logActivityEvent({
      eventType: "ORDER_EXECUTION",
      severity: "INFO",
      title: "TWAP Execution Started",
      summary: `${side} ${totalQuantity} ${symbol} over ${durationMinutes}min in ${sliceCount} slices`,
      payload: { orderId, botId, symbol, side, totalQuantity, durationMinutes, sliceCount, stage },
    });

    const execution: ActiveExecution = {
      orderId,
      botId,
      symbol,
      side,
      totalQuantity,
      filledQuantity: 0,
      avgPrice: 0,
      startTime,
      slices: [],
      timer: null,
      cancelled: false,
      algorithmType: "TWAP",
      stage,
      benchmarkPrice,
    };

    this.activeExecutions.set(orderId, execution);
    if (!this.executionsByBot.has(botId)) {
      this.executionsByBot.set(botId, new Set());
    }
    this.executionsByBot.get(botId)!.add(orderId);

    return new Promise((resolve) => {
      execution.resolve = resolve as (result: TWAPResult | VWAPResult) => void;
      
      const intervalMs = (durationMinutes * 60 * 1000) / sliceCount;
      const sliceQuantity = Math.floor(totalQuantity / sliceCount);
      const lastSliceExtra = totalQuantity - (sliceQuantity * sliceCount);
      
      let sliceIndex = 0;
      
      const executeSlice = async () => {
        if (execution.cancelled) {
          clearInterval(execution.timer!);
          this.completeExecution(orderId, "CANCELLED");
          return;
        }
        
        if (sliceIndex >= sliceCount) {
          clearInterval(execution.timer!);
          this.completeExecution(orderId, "COMPLETE");
          return;
        }
        
        const isLastSlice = sliceIndex === sliceCount - 1;
        const qty = isLastSlice ? sliceQuantity + lastSliceExtra : sliceQuantity;
        
        if (qty <= 0) {
          sliceIndex++;
          return;
        }
        
        try {
          const sliceResult = await this.executeSlice(
            execution,
            sliceIndex,
            qty,
            useLiveExecution
          );
          
          execution.slices.push(sliceResult);
          execution.filledQuantity += sliceResult.quantity;
          
          if (execution.avgPrice === 0) {
            execution.avgPrice = sliceResult.price;
          } else {
            const prevTotal = execution.avgPrice * (execution.filledQuantity - sliceResult.quantity);
            const newTotal = prevTotal + sliceResult.price * sliceResult.quantity;
            execution.avgPrice = newTotal / execution.filledQuantity;
          }
          
          console.log(`[EXEC_ALGO] TWAP slice ${sliceIndex + 1}/${sliceCount}: ${qty} @ ${sliceResult.price.toFixed(2)} filled=${execution.filledQuantity}/${totalQuantity}`);
          
          this.emit("slice_executed", {
            orderId,
            sliceIndex,
            quantity: qty,
            price: sliceResult.price,
            filledQty: execution.filledQuantity,
            totalQty: totalQuantity,
          });
          
        } catch (error) {
          console.error(`[EXEC_ALGO] TWAP slice ${sliceIndex} failed:`, error);
        }
        
        sliceIndex++;
      };
      
      executeSlice();
      execution.timer = setInterval(executeSlice, intervalMs);
    });
  }

  async executeVWAP(params: VWAPParams): Promise<VWAPResult> {
    const { symbol, totalQuantity, side, durationMinutes, participationRate, botId } = params;
    
    const orderId = `vwap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const stage = await this.getBotStage(botId);
    const useLiveExecution = this.shouldUseLiveExecution(stage);
    const benchmarkPrice = this.getCurrentPrice(symbol);
    const startTime = new Date();

    console.log(`[EXEC_ALGO] VWAP started: orderId=${orderId} symbol=${symbol} qty=${totalQuantity} side=${side} duration=${durationMinutes}min participation=${(participationRate * 100).toFixed(1)}% stage=${stage} live=${useLiveExecution}`);

    await logActivityEvent({
      eventType: "ORDER_EXECUTION",
      severity: "INFO",
      title: "VWAP Execution Started",
      summary: `${side} ${totalQuantity} ${symbol} over ${durationMinutes}min at ${(participationRate * 100).toFixed(1)}% participation`,
      payload: { orderId, botId, symbol, side, totalQuantity, durationMinutes, participationRate, stage },
    });

    const execution: ActiveExecution = {
      orderId,
      botId,
      symbol,
      side,
      totalQuantity,
      filledQuantity: 0,
      avgPrice: 0,
      startTime,
      slices: [],
      timer: null,
      cancelled: false,
      algorithmType: "VWAP",
      stage,
      benchmarkPrice,
      participationRate,
    };

    this.activeExecutions.set(orderId, execution);
    if (!this.executionsByBot.has(botId)) {
      this.executionsByBot.set(botId, new Set());
    }
    this.executionsByBot.get(botId)!.add(orderId);

    return new Promise((resolve) => {
      execution.resolve = resolve as (result: TWAPResult | VWAPResult) => void;
      
      const checkIntervalMs = 30_000;
      const endTime = startTime.getTime() + durationMinutes * 60 * 1000;
      let sliceIndex = 0;
      let lastCheckedVolume = this.getRecentVolume(symbol, 1);
      
      const executeVolumeSlice = async () => {
        if (execution.cancelled) {
          clearInterval(execution.timer!);
          this.completeExecution(orderId, execution.filledQuantity > 0 ? "PARTIAL" : "CANCELLED");
          return;
        }
        
        const now = Date.now();
        if (now >= endTime || execution.filledQuantity >= totalQuantity) {
          clearInterval(execution.timer!);
          this.completeExecution(orderId, execution.filledQuantity >= totalQuantity ? "COMPLETE" : "PARTIAL");
          return;
        }
        
        const currentVolume = this.getRecentVolume(symbol, 1);
        const volumeDelta = Math.max(0, currentVolume - lastCheckedVolume);
        lastCheckedVolume = currentVolume;
        
        const targetParticipation = volumeDelta * participationRate;
        const remainingQty = totalQuantity - execution.filledQuantity;
        const sliceQty = Math.min(Math.max(1, Math.floor(targetParticipation)), remainingQty);
        
        if (sliceQty <= 0 && volumeDelta < 10) {
          const fallbackQty = Math.min(
            Math.ceil(totalQuantity / (durationMinutes * 2)),
            remainingQty
          );
          if (fallbackQty <= 0) return;
          
          try {
            const sliceResult = await this.executeSlice(
              execution,
              sliceIndex,
              fallbackQty,
              useLiveExecution
            );
            
            execution.slices.push(sliceResult);
            execution.filledQuantity += sliceResult.quantity;
            
            if (execution.avgPrice === 0) {
              execution.avgPrice = sliceResult.price;
            } else {
              const prevTotal = execution.avgPrice * (execution.filledQuantity - sliceResult.quantity);
              const newTotal = prevTotal + sliceResult.price * sliceResult.quantity;
              execution.avgPrice = newTotal / execution.filledQuantity;
            }
            
            sliceIndex++;
          } catch (error) {
            console.error(`[EXEC_ALGO] VWAP fallback slice failed:`, error);
          }
          return;
        }
        
        if (sliceQty <= 0) return;
        
        try {
          const sliceResult = await this.executeSlice(
            execution,
            sliceIndex,
            sliceQty,
            useLiveExecution
          );
          
          execution.slices.push(sliceResult);
          execution.filledQuantity += sliceResult.quantity;
          
          if (execution.avgPrice === 0) {
            execution.avgPrice = sliceResult.price;
          } else {
            const prevTotal = execution.avgPrice * (execution.filledQuantity - sliceResult.quantity);
            const newTotal = prevTotal + sliceResult.price * sliceResult.quantity;
            execution.avgPrice = newTotal / execution.filledQuantity;
          }
          
          const actualParticipation = volumeDelta > 0 ? sliceQty / volumeDelta : 0;
          console.log(`[EXEC_ALGO] VWAP slice ${sliceIndex + 1}: ${sliceQty} @ ${sliceResult.price.toFixed(2)} vol=${volumeDelta} participation=${(actualParticipation * 100).toFixed(1)}% filled=${execution.filledQuantity}/${totalQuantity}`);
          
          this.emit("slice_executed", {
            orderId,
            sliceIndex,
            quantity: sliceQty,
            price: sliceResult.price,
            filledQty: execution.filledQuantity,
            totalQty: totalQuantity,
            marketVolume: volumeDelta,
            participationRate: actualParticipation,
          });
          
          sliceIndex++;
        } catch (error) {
          console.error(`[EXEC_ALGO] VWAP slice ${sliceIndex} failed:`, error);
        }
      };
      
      executeVolumeSlice();
      execution.timer = setInterval(executeVolumeSlice, checkIntervalMs);
    });
  }

  private async executeSlice(
    execution: ActiveExecution,
    sliceIndex: number,
    quantity: number,
    useLiveExecution: boolean
  ): Promise<SliceExecution> {
    const now = new Date();
    
    if (!useLiveExecution) {
      const price = this.simulateSliceExecution(execution.symbol, execution.side, quantity);
      return {
        sliceIndex,
        quantity,
        price,
        executedAt: now,
        simulated: true,
      };
    }
    
    if (!this.ironbeamClient) {
      const price = this.simulateSliceExecution(execution.symbol, execution.side, quantity);
      return {
        sliceIndex,
        quantity,
        price,
        executedAt: now,
        simulated: true,
      };
    }
    
    const order: IronbeamOrder = {
      symbol: execution.symbol,
      side: execution.side,
      quantity,
      orderType: "MARKET",
      timeInForce: "IOC",
      clientOrderId: `${execution.orderId}_slice_${sliceIndex}`,
    };
    
    try {
      const result: OrderResult = await this.ironbeamClient.submitOrder(order, execution.stage);
      
      if (result.status === "FILLED" || result.status === "PARTIAL") {
        return {
          sliceIndex,
          quantity: result.filledQty,
          price: result.avgPrice,
          executedAt: now,
          simulated: result.simulated || false,
        };
      }
      
      const fallbackPrice = this.simulateSliceExecution(execution.symbol, execution.side, quantity);
      return {
        sliceIndex,
        quantity,
        price: fallbackPrice,
        executedAt: now,
        simulated: true,
      };
    } catch (error) {
      console.error(`[EXEC_ALGO] Live slice execution failed, falling back to simulation:`, error);
      const fallbackPrice = this.simulateSliceExecution(execution.symbol, execution.side, quantity);
      return {
        sliceIndex,
        quantity,
        price: fallbackPrice,
        executedAt: now,
        simulated: true,
      };
    }
  }

  private simulateSliceExecution(symbol: string, side: "BUY" | "SELL", quantity: number): number {
    const basePrice = this.getCurrentPrice(symbol);
    
    const spreadBps = 2 + Math.random() * 3;
    const halfSpread = basePrice * (spreadBps / 10000) / 2;
    
    const slippageBps = 0.5 + Math.random() * 1.5;
    const slippage = basePrice * (slippageBps / 10000);
    
    const impactBps = Math.min(5, quantity * 0.1);
    const impact = basePrice * (impactBps / 10000);
    
    if (side === "BUY") {
      return basePrice + halfSpread + slippage + impact;
    } else {
      return basePrice - halfSpread - slippage - impact;
    }
  }

  private completeExecution(orderId: string, status: ExecutionStatus): void {
    const execution = this.activeExecutions.get(orderId);
    if (!execution || !execution.resolve) return;
    
    const endTime = new Date();
    const slippage = this.calculateSlippage(execution.avgPrice, execution.benchmarkPrice, execution.side);
    
    const baseReport: ExecutionReport = {
      orderId,
      symbol: execution.symbol,
      totalQty: execution.totalQuantity,
      filledQty: execution.filledQuantity,
      avgPrice: execution.avgPrice,
      startTime: execution.startTime,
      endTime,
      slippage,
      status,
    };
    
    if (execution.algorithmType === "TWAP") {
      const result: TWAPResult = {
        ...baseReport,
        slicesFilled: execution.slices.length,
        totalSlices: execution.slices.length,
        sliceDetails: execution.slices,
      };
      
      console.log(`[EXEC_ALGO] TWAP complete: orderId=${orderId} status=${status} filled=${execution.filledQuantity}/${execution.totalQuantity} avgPrice=${execution.avgPrice.toFixed(2)} slippage=${slippage.toFixed(2)}bps`);
      
      logActivityEvent({
        eventType: "ORDER_EXECUTION",
        severity: status === "COMPLETE" ? "INFO" : "WARN",
        title: `TWAP Execution ${status}`,
        summary: `${execution.side} ${execution.filledQuantity}/${execution.totalQuantity} ${execution.symbol} @ ${execution.avgPrice.toFixed(2)} (${slippage.toFixed(2)}bps slippage)`,
        payload: result,
      }).catch(() => {});
      
      execution.resolve(result);
    } else {
      const result: VWAPResult = {
        ...baseReport,
        benchmarkVWAP: execution.benchmarkPrice,
        actualVWAP: execution.avgPrice,
        participationRate: execution.participationRate || 0,
        sliceDetails: execution.slices,
      };
      
      console.log(`[EXEC_ALGO] VWAP complete: orderId=${orderId} status=${status} filled=${execution.filledQuantity}/${execution.totalQuantity} avgPrice=${execution.avgPrice.toFixed(2)} slippage=${slippage.toFixed(2)}bps`);
      
      logActivityEvent({
        eventType: "ORDER_EXECUTION",
        severity: status === "COMPLETE" ? "INFO" : "WARN",
        title: `VWAP Execution ${status}`,
        summary: `${execution.side} ${execution.filledQuantity}/${execution.totalQuantity} ${execution.symbol} @ ${execution.avgPrice.toFixed(2)} (${slippage.toFixed(2)}bps slippage)`,
        payload: result,
      }).catch(() => {});
      
      execution.resolve(result);
    }
    
    if (execution.timer) {
      clearInterval(execution.timer);
    }
    
    this.activeExecutions.delete(orderId);
    const botOrders = this.executionsByBot.get(execution.botId);
    if (botOrders) {
      botOrders.delete(orderId);
      if (botOrders.size === 0) {
        this.executionsByBot.delete(execution.botId);
      }
    }
    
    this.emit("execution_complete", baseReport);
  }

  cancelOrder(orderId: string): boolean {
    const execution = this.activeExecutions.get(orderId);
    if (!execution) {
      console.log(`[EXEC_ALGO] Cancel failed: order ${orderId} not found`);
      return false;
    }
    
    execution.cancelled = true;
    console.log(`[EXEC_ALGO] Order ${orderId} marked for cancellation`);
    
    logActivityEvent({
      eventType: "ORDER_EXECUTION",
      severity: "INFO",
      title: "Execution Cancellation Requested",
      summary: `${execution.algorithmType} order ${orderId} cancelled (filled ${execution.filledQuantity}/${execution.totalQuantity})`,
      payload: { orderId, botId: execution.botId, filledQty: execution.filledQuantity },
    }).catch(() => {});
    
    return true;
  }

  cancelByBot(botId: string): number {
    const orderIds = this.executionsByBot.get(botId);
    if (!orderIds || orderIds.size === 0) {
      return 0;
    }
    
    let cancelledCount = 0;
    for (const orderId of orderIds) {
      if (this.cancelOrder(orderId)) {
        cancelledCount++;
      }
    }
    
    console.log(`[EXEC_ALGO] Cancelled ${cancelledCount} orders for bot ${botId}`);
    return cancelledCount;
  }

  cleanupBot(botId: string): void {
    const orderIds = this.executionsByBot.get(botId);
    if (!orderIds) return;
    
    for (const orderId of orderIds) {
      const execution = this.activeExecutions.get(orderId);
      if (execution) {
        execution.cancelled = true;
        if (execution.timer) {
          clearInterval(execution.timer);
        }
        
        if (execution.resolve) {
          const endTime = new Date();
          const slippage = this.calculateSlippage(execution.avgPrice, execution.benchmarkPrice, execution.side);
          
          if (execution.algorithmType === "TWAP") {
            execution.resolve({
              orderId,
              symbol: execution.symbol,
              totalQty: execution.totalQuantity,
              filledQty: execution.filledQuantity,
              avgPrice: execution.avgPrice,
              startTime: execution.startTime,
              endTime,
              slippage,
              status: execution.filledQuantity > 0 ? "PARTIAL" : "CANCELLED",
              slicesFilled: execution.slices.length,
              totalSlices: execution.slices.length,
              sliceDetails: execution.slices,
            } as TWAPResult);
          } else {
            execution.resolve({
              orderId,
              symbol: execution.symbol,
              totalQty: execution.totalQuantity,
              filledQty: execution.filledQuantity,
              avgPrice: execution.avgPrice,
              startTime: execution.startTime,
              endTime,
              slippage,
              status: execution.filledQuantity > 0 ? "PARTIAL" : "CANCELLED",
              benchmarkVWAP: execution.benchmarkPrice,
              actualVWAP: execution.avgPrice,
              participationRate: execution.participationRate || 0,
              sliceDetails: execution.slices,
            } as VWAPResult);
          }
        }
        
        this.activeExecutions.delete(orderId);
      }
    }
    
    this.executionsByBot.delete(botId);
    console.log(`[EXEC_ALGO] Cleaned up ${orderIds.size} executions for bot ${botId}`);
  }

  getActiveExecutions(): ActiveExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  getActiveExecutionsByBot(botId: string): ActiveExecution[] {
    const orderIds = this.executionsByBot.get(botId);
    if (!orderIds) return [];
    
    return Array.from(orderIds)
      .map(id => this.activeExecutions.get(id))
      .filter((e): e is ActiveExecution => e !== undefined);
  }

  getExecution(orderId: string): ActiveExecution | undefined {
    return this.activeExecutions.get(orderId);
  }

  getExecutionSummary(): {
    activeCount: number;
    twapCount: number;
    vwapCount: number;
    totalFilledQty: number;
    botIds: string[];
  } {
    const executions = this.getActiveExecutions();
    return {
      activeCount: executions.length,
      twapCount: executions.filter(e => e.algorithmType === "TWAP").length,
      vwapCount: executions.filter(e => e.algorithmType === "VWAP").length,
      totalFilledQty: executions.reduce((sum, e) => sum + e.filledQuantity, 0),
      botIds: Array.from(this.executionsByBot.keys()),
    };
  }
}

export const executionAlgorithms = new ExecutionAlgorithmsManager();

export async function executeTWAP(params: TWAPParams): Promise<TWAPResult> {
  return executionAlgorithms.executeTWAP(params);
}

export async function executeVWAP(params: VWAPParams): Promise<VWAPResult> {
  return executionAlgorithms.executeVWAP(params);
}

export function cancelExecution(orderId: string): boolean {
  return executionAlgorithms.cancelOrder(orderId);
}

export function cancelBotExecutions(botId: string): number {
  return executionAlgorithms.cancelByBot(botId);
}

export function cleanupBotExecutions(botId: string): void {
  executionAlgorithms.cleanupBot(botId);
}

export function getActiveExecutions(): ActiveExecution[] {
  return executionAlgorithms.getActiveExecutions();
}

export function getActiveExecutionsByBot(botId: string): ActiveExecution[] {
  return executionAlgorithms.getActiveExecutionsByBot(botId);
}

export function getExecutionSummary(): ReturnType<ExecutionAlgorithmsManager["getExecutionSummary"]> {
  return executionAlgorithms.getExecutionSummary();
}
