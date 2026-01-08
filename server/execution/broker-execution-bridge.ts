import { TWAPAlgorithm, type TWAPOrder, type TWAPSlice, type TWAPConfig } from "./twap-algorithm";
import { VWAPAlgorithm, type VWAPOrder, type VWAPSlice, type VWAPConfig } from "./vwap-algorithm";
import { logActivityEvent } from "../activity-logger";

const IRONBEAM_API_URL = process.env.IRONBEAM_ENV === "live" 
  ? "https://live.ironbeamapi.com/v2" 
  : "https://demo.ironbeamapi.com/v2";

export interface BrokerCredentials {
  username: string;
  password: string;
  apiKey: string;
}

export type BotStage = "LAB" | "TRIALS" | "PAPER" | "SHADOW" | "CANARY" | "LIVE";

export interface OrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice?: number;
  timeInForce: "DAY" | "GTC" | "IOC" | "FOK";
  accountId?: string;
  botId?: string;
  botStage?: BotStage;
}

export interface OrderResponse {
  orderId: string;
  status: "PENDING" | "FILLED" | "PARTIALLY_FILLED" | "REJECTED" | "CANCELLED";
  filledQuantity: number;
  avgFillPrice: number;
  commission: number;
  timestamp: Date;
  rejectReason?: string;
}

export interface ExecutionMetrics {
  totalOrders: number;
  filledOrders: number;
  rejectedOrders: number;
  avgSlippage: number;
  avgLatencyMs: number;
  totalCommission: number;
  twapOrders: number;
  vwapOrders: number;
}

export interface AuthMetrics {
  totalAttempts: number;
  failedAttempts: number;
  consecutiveFailures: number;
  lastAttempt: Date | null;
  lastSuccess: Date | null;
  lastFailureReason: string | null;
}

export class BrokerExecutionBridge {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private accountId: string | null = null;
  private twapAlgorithm: TWAPAlgorithm;
  private vwapAlgorithm: VWAPAlgorithm;
  private executionMetrics: ExecutionMetrics;
  private orderHistory: OrderResponse[] = [];
  private sliceTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private globalSimulationForced: boolean = false;
  private hasValidCredentials: boolean = false;
  private authenticationVerified: boolean = false;
  private authMetrics: AuthMetrics;

  constructor() {
    this.twapAlgorithm = new TWAPAlgorithm();
    this.vwapAlgorithm = new VWAPAlgorithm();
    this.executionMetrics = {
      totalOrders: 0,
      filledOrders: 0,
      rejectedOrders: 0,
      avgSlippage: 0,
      avgLatencyMs: 0,
      totalCommission: 0,
      twapOrders: 0,
      vwapOrders: 0,
    };
    
    this.globalSimulationForced = process.env.BROKER_EXECUTION_MODE === "SIMULATION";
    this.hasValidCredentials = !!(process.env.IRONBEAM_USERNAME_1 && 
                                   process.env.IRONBEAM_PASSWORD_1 && 
                                   process.env.IRONBEAM_API_KEY_1);
    this.authMetrics = {
      totalAttempts: 0,
      failedAttempts: 0,
      consecutiveFailures: 0,
      lastAttempt: null,
      lastSuccess: null,
      lastFailureReason: null,
    };
    
    console.log(`[BROKER_BRIDGE] Initialized with stage-based execution mode`);
    console.log(`[BROKER_BRIDGE] Global simulation forced: ${this.globalSimulationForced}, credentials: ${this.hasValidCredentials ? 'present' : 'missing'}`);
    console.log(`[BROKER_BRIDGE] LIVE stage bots will use real execution if credentials are valid and auth succeeds`);
  }

  getAuthMetrics(): AuthMetrics {
    return { ...this.authMetrics };
  }

  shouldUseSimulation(botStage?: BotStage): boolean {
    if (this.globalSimulationForced) {
      return true;
    }
    if (!this.hasValidCredentials) {
      return true;
    }
    if (!this.authenticationVerified) {
      return true;
    }
    if (!botStage || botStage !== "LIVE") {
      return true;
    }
    return false;
  }

  async authenticate(): Promise<boolean> {
    this.authMetrics.totalAttempts++;
    this.authMetrics.lastAttempt = new Date();

    if (this.globalSimulationForced || !this.hasValidCredentials) {
      console.log("[BROKER_BRIDGE] Simulation mode - skipping authentication");
      return true;
    }

    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return true;
    }

    try {
      const username = process.env.IRONBEAM_USERNAME_1;
      const password = process.env.IRONBEAM_PASSWORD_1;
      const apiKey = process.env.IRONBEAM_API_KEY_1;

      if (!username || !password || !apiKey) {
        console.error("[BROKER_BRIDGE] Missing Ironbeam credentials - auth not verified");
        this.authenticationVerified = false;
        this.recordAuthFailure("Missing credentials");
        return true;
      }

      const response = await fetch(`${IRONBEAM_API_URL}/auth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[BROKER_BRIDGE] Auth failed: ${response.status} - ${errorText}`);
        console.warn(`[BROKER_BRIDGE] Auth not verified - LIVE bots will use simulation`);
        this.authenticationVerified = false;
        this.recordAuthFailure(`HTTP ${response.status}: ${errorText.slice(0, 100)}`);
        return true;
      }

      const data = await response.json() as { token: string; expiresIn: number; accountId?: string };
      this.token = data.token;
      this.tokenExpiry = new Date(Date.now() + (data.expiresIn || 3600) * 1000);
      this.accountId = data.accountId || null;
      this.authenticationVerified = true;
      this.authMetrics.consecutiveFailures = 0;
      this.authMetrics.lastSuccess = new Date();
      this.authMetrics.lastFailureReason = null;

      console.log(`[BROKER_BRIDGE] Authenticated successfully, token expires at ${this.tokenExpiry}`);
      console.log(`[BROKER_BRIDGE] LIVE stage bots can now use real execution`);
      
      await logActivityEvent({
        eventType: "INTEGRATION_VERIFIED",
        severity: "INFO",
        title: "Broker Authentication Success",
        summary: `Ironbeam API authenticated, account: ${this.accountId || 'pending'}`,
        payload: { accountId: this.accountId },
      });

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error("[BROKER_BRIDGE] Auth error:", error);
      console.warn(`[BROKER_BRIDGE] Auth not verified - LIVE bots will use simulation`);
      this.authenticationVerified = false;
      this.recordAuthFailure(errorMsg);
      return true;
    }
  }

  private recordAuthFailure(reason: string): void {
    this.authMetrics.failedAttempts++;
    this.authMetrics.consecutiveFailures++;
    this.authMetrics.lastFailureReason = reason;
    
    if (this.authMetrics.consecutiveFailures >= 3) {
      console.warn(`[BROKER_BRIDGE] ALERT: ${this.authMetrics.consecutiveFailures} consecutive auth failures`);
      logActivityEvent({
        eventType: "ALERT",
        severity: "WARN",
        title: "Repeated Broker Auth Failures",
        summary: `${this.authMetrics.consecutiveFailures} consecutive authentication failures - LIVE bots using simulation`,
        payload: { 
          consecutiveFailures: this.authMetrics.consecutiveFailures,
          lastReason: reason,
          totalAttempts: this.authMetrics.totalAttempts,
        },
      }).catch(() => {});
    }
  }

  async placeOrder(request: OrderRequest): Promise<OrderResponse> {
    const startTime = Date.now();
    this.executionMetrics.totalOrders++;

    if (this.globalSimulationForced) {
      return this.simulateOrder(request, startTime);
    }
    
    if (!request.botStage || request.botStage !== "LIVE") {
      return this.simulateOrder(request, startTime);
    }

    if (!this.hasValidCredentials) {
      console.log(`[BROKER_BRIDGE] LIVE stage but no credentials - using simulation`);
      return this.simulateOrder(request, startTime);
    }

    const authenticated = await this.authenticate();
    if (!authenticated || !this.authenticationVerified) {
      console.log(`[BROKER_BRIDGE] LIVE stage but auth failed - using simulation`);
      return this.simulateOrder(request, startTime);
    }

    try {
      const response = await fetch(`${IRONBEAM_API_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          symbol: request.symbol,
          side: request.side,
          quantity: request.quantity,
          orderType: request.orderType,
          limitPrice: request.limitPrice,
          timeInForce: request.timeInForce,
          accountId: request.accountId || this.accountId,
        }),
      });

      const latencyMs = Date.now() - startTime;
      this.updateAvgLatency(latencyMs);

      if (!response.ok) {
        const errorText = await response.text();
        this.executionMetrics.rejectedOrders++;
        
        return {
          orderId: `rejected_${Date.now()}`,
          status: "REJECTED",
          filledQuantity: 0,
          avgFillPrice: 0,
          commission: 0,
          timestamp: new Date(),
          rejectReason: errorText,
        };
      }

      const data = await response.json() as OrderResponse;
      
      if (data.status === "FILLED" || data.status === "PARTIALLY_FILLED") {
        this.executionMetrics.filledOrders++;
        this.executionMetrics.totalCommission += data.commission || 0;
      } else if (data.status === "REJECTED") {
        this.executionMetrics.rejectedOrders++;
      }

      this.orderHistory.push(data);
      
      await logActivityEvent({
        eventType: "TRADE_EXECUTED",
        severity: "INFO",
        title: `Order ${data.status}: ${request.side} ${request.quantity} ${request.symbol}`,
        summary: `Fill: ${data.filledQuantity}@${data.avgFillPrice}, latency: ${latencyMs}ms`,
        payload: { request, response: data, latencyMs },
      });

      return data;
    } catch (error) {
      console.error("[BROKER_BRIDGE] Order placement error:", error);
      this.executionMetrics.rejectedOrders++;
      
      return {
        orderId: `error_${Date.now()}`,
        status: "REJECTED",
        filledQuantity: 0,
        avgFillPrice: 0,
        commission: 0,
        timestamp: new Date(),
        rejectReason: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private simulateOrder(request: OrderRequest, startTime: number): OrderResponse {
    const latencyMs = Date.now() - startTime + Math.random() * 50;
    this.updateAvgLatency(latencyMs);

    const basePrice = this.getSimulatedPrice(request.symbol);
    const slippage = request.orderType === "MARKET" 
      ? (request.side === "BUY" ? 0.0002 : -0.0002) 
      : 0;
    const fillPrice = basePrice * (1 + slippage);
    
    const commission = request.quantity * 0.65;
    this.executionMetrics.totalCommission += commission;
    this.executionMetrics.filledOrders++;

    const response: OrderResponse = {
      orderId: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      status: "FILLED",
      filledQuantity: request.quantity,
      avgFillPrice: Math.round(fillPrice * 100) / 100,
      commission,
      timestamp: new Date(),
    };

    this.orderHistory.push(response);
    
    console.log(`[BROKER_BRIDGE] SIMULATED ${request.side} ${request.quantity} ${request.symbol} @ ${fillPrice.toFixed(2)}`);
    
    return response;
  }

  private getSimulatedPrice(symbol: string): number {
    const basePrices: Record<string, number> = {
      "MES": 6150,
      "MNQ": 22100,
      "ES": 6150,
      "NQ": 22100,
      "MCL": 72,
      "MBT": 105000,
    };
    const base = basePrices[symbol.toUpperCase()] || 100;
    return base * (0.998 + Math.random() * 0.004);
  }

  private updateAvgLatency(latencyMs: number): void {
    const n = this.executionMetrics.totalOrders;
    this.executionMetrics.avgLatencyMs = 
      ((this.executionMetrics.avgLatencyMs * (n - 1)) + latencyMs) / n;
  }

  async executeTWAP(
    symbol: string,
    side: "BUY" | "SELL",
    totalQuantity: number,
    benchmarkPrice: number,
    config?: Partial<TWAPConfig>,
    botId?: string,
    botStage?: BotStage
  ): Promise<TWAPOrder & { isSimulation: boolean }> {
    const order = this.twapAlgorithm.createOrder(symbol, side, totalQuantity, benchmarkPrice, config);
    const isSimulation = this.shouldUseSimulation(botStage);
    this.executionMetrics.twapOrders++;
    
    const modeInfo = this.getExecutionMode(botStage);
    console.log(`[BROKER_BRIDGE] Starting TWAP execution: ${order.id} (${modeInfo.mode} - ${modeInfo.reason})`);
    
    const timers: NodeJS.Timeout[] = [];
    this.sliceTimers.set(order.id, timers);

    for (const slice of order.slices) {
      const delay = slice.scheduledTime.getTime() - Date.now();
      if (delay > 0) {
        const timer = setTimeout(async () => {
          await this.executeSlice(order, slice, 0, botStage);
        }, delay);
        timers.push(timer);
      } else {
        await this.executeSlice(order, slice, 0, botStage);
      }
    }

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: `TWAP Order Started: ${side} ${totalQuantity} ${symbol}`,
      summary: `${order.slices.length} slices over ${config?.durationMinutes || 30} minutes (${modeInfo.mode})`,
      payload: { orderId: order.id, slices: order.slices.length, botId, botStage, isSimulation },
    });

    return { ...order, isSimulation };
  }

  private async executeSlice(order: TWAPOrder, slice: TWAPSlice, retryCount: number = 0, botStage?: BotStage): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    
    slice.status = "EXECUTING";
    order.status = "EXECUTING";
    
    try {
      const response = await this.placeOrder({
        symbol: order.symbol,
        side: order.side,
        quantity: slice.quantity,
        orderType: "MARKET",
        timeInForce: "IOC",
        botStage,
      });

      if (response.status === "FILLED" || response.status === "PARTIALLY_FILLED") {
        slice.status = "FILLED";
        slice.executedTime = response.timestamp;
        slice.fillPrice = response.avgFillPrice;
        
        order.executedQuantity += response.filledQuantity;
        order.remainingQuantity -= response.filledQuantity;
        
        const totalFillValue = order.avgFillPrice * (order.executedQuantity - response.filledQuantity) 
                             + response.avgFillPrice * response.filledQuantity;
        order.avgFillPrice = order.executedQuantity > 0 ? totalFillValue / order.executedQuantity : 0;
        
        order.slippage = order.benchmarkPrice > 0 
          ? (order.avgFillPrice - order.benchmarkPrice) / order.benchmarkPrice 
          : 0;
        if (order.side === "SELL") order.slippage *= -1;
        
        this.updateSlippageMetrics(order.slippage);
      } else if (response.status === "REJECTED" && retryCount < MAX_RETRIES) {
        console.warn(`[BROKER_BRIDGE] Slice ${slice.id} rejected, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.executeSlice(order, slice, retryCount + 1, botStage);
      } else {
        slice.status = "FAILED";
        console.error(`[BROKER_BRIDGE] Slice ${slice.id} failed after ${retryCount} retries: ${response.rejectReason}`);
      }

      if (order.executedQuantity >= order.totalQuantity) {
        order.status = "COMPLETED";
        console.log(`[BROKER_BRIDGE] TWAP ${order.id} COMPLETED: ${order.executedQuantity}@${order.avgFillPrice.toFixed(2)}, slippage: ${(order.slippage * 100).toFixed(3)}%`);
      }
    } catch (error) {
      console.error(`[BROKER_BRIDGE] Slice execution error:`, error);
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.executeSlice(order, slice, retryCount + 1, botStage);
      }
      slice.status = "FAILED";
    }
  }

  async executeVWAP(
    symbol: string,
    side: "BUY" | "SELL",
    totalQuantity: number,
    benchmarkVWAP: number,
    config?: Partial<VWAPConfig>,
    botId?: string,
    botStage?: BotStage
  ): Promise<VWAPOrder & { isSimulation: boolean }> {
    const order = this.vwapAlgorithm.createOrder(symbol, side, totalQuantity, benchmarkVWAP, config);
    const isSimulation = this.shouldUseSimulation(botStage);
    this.executionMetrics.vwapOrders++;
    
    const modeInfo = this.getExecutionMode(botStage);
    console.log(`[BROKER_BRIDGE] Starting VWAP execution: ${order.id} (${modeInfo.mode} - ${modeInfo.reason})`);
    
    const timers: NodeJS.Timeout[] = [];
    this.sliceTimers.set(order.id, timers);

    for (const slice of order.slices) {
      const delay = slice.scheduledTime.getTime() - Date.now();
      if (delay > 0) {
        const timer = setTimeout(async () => {
          await this.executeVWAPSlice(order, slice, 0, botStage);
        }, delay);
        timers.push(timer);
      } else {
        await this.executeVWAPSlice(order, slice, 0, botStage);
      }
    }

    await logActivityEvent({
      eventType: "INTEGRATION_PROOF",
      severity: "INFO",
      title: `VWAP Order Started: ${side} ${totalQuantity} ${symbol}`,
      summary: `${order.slices.length} slices following volume profile (${modeInfo.mode})`,
      payload: { orderId: order.id, slices: order.slices.length, botId, botStage, isSimulation },
    });

    return { ...order, isSimulation };
  }

  private async executeVWAPSlice(order: VWAPOrder, slice: VWAPSlice, retryCount: number = 0, botStage?: BotStage): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;
    
    slice.status = "EXECUTING";
    order.status = "EXECUTING";
    
    try {
      const response = await this.placeOrder({
        symbol: order.symbol,
        side: order.side,
        quantity: slice.quantity,
        orderType: "MARKET",
        timeInForce: "IOC",
        botStage,
      });

      if (response.status === "FILLED" || response.status === "PARTIALLY_FILLED") {
        slice.status = "FILLED";
        slice.executedTime = response.timestamp;
        slice.fillPrice = response.avgFillPrice;
        
        order.executedQuantity += response.filledQuantity;
        order.remainingQuantity -= response.filledQuantity;
        
        const totalFillValue = order.avgFillPrice * (order.executedQuantity - response.filledQuantity) 
                             + response.avgFillPrice * response.filledQuantity;
        order.avgFillPrice = order.executedQuantity > 0 ? totalFillValue / order.executedQuantity : 0;
        
        order.slippage = order.benchmarkVWAP > 0 
          ? (order.avgFillPrice - order.benchmarkVWAP) / order.benchmarkVWAP 
          : 0;
        if (order.side === "SELL") order.slippage *= -1;
        
        this.updateSlippageMetrics(order.slippage);
      } else if (response.status === "REJECTED" && retryCount < MAX_RETRIES) {
        console.warn(`[BROKER_BRIDGE] VWAP Slice ${slice.id} rejected, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.executeVWAPSlice(order, slice, retryCount + 1, botStage);
      } else {
        slice.status = "FAILED";
        console.error(`[BROKER_BRIDGE] VWAP Slice ${slice.id} failed after ${retryCount} retries: ${response.rejectReason}`);
      }

      if (order.executedQuantity >= order.totalQuantity) {
        order.status = "COMPLETED";
        console.log(`[BROKER_BRIDGE] VWAP ${order.id} COMPLETED: ${order.executedQuantity}@${order.avgFillPrice.toFixed(2)}, slippage: ${(order.slippage * 100).toFixed(3)}%`);
      }
    } catch (error) {
      console.error(`[BROKER_BRIDGE] VWAP Slice execution error:`, error);
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (retryCount + 1)));
        return this.executeVWAPSlice(order, slice, retryCount + 1, botStage);
      }
      slice.status = "FAILED";
    }
  }

  private updateSlippageMetrics(slippage: number): void {
    const n = this.executionMetrics.filledOrders;
    this.executionMetrics.avgSlippage = 
      ((this.executionMetrics.avgSlippage * (n - 1)) + Math.abs(slippage)) / n;
  }

  cancelOrder(orderId: string): boolean {
    const timers = this.sliceTimers.get(orderId);
    if (timers) {
      timers.forEach(t => clearTimeout(t));
      this.sliceTimers.delete(orderId);
      console.log(`[BROKER_BRIDGE] Cancelled order ${orderId}`);
      return true;
    }
    return false;
  }

  getExecutionMetrics(): ExecutionMetrics {
    return { ...this.executionMetrics };
  }

  getOrderHistory(limit: number = 50): OrderResponse[] {
    return this.orderHistory.slice(-limit);
  }

  isLive(): boolean {
    return this.authenticationVerified && this.hasValidCredentials && !this.globalSimulationForced;
  }

  getExecutionMode(botStage?: BotStage): { mode: "SIMULATION" | "LIVE"; reason: string } {
    if (this.globalSimulationForced) {
      return { mode: "SIMULATION", reason: "BROKER_EXECUTION_MODE=SIMULATION (master kill-switch)" };
    }
    if (!this.hasValidCredentials) {
      return { mode: "SIMULATION", reason: "Missing broker credentials" };
    }
    if (!this.authenticationVerified) {
      return { mode: "SIMULATION", reason: "Broker authentication not verified" };
    }
    if (!botStage) {
      return { mode: "SIMULATION", reason: "No bot stage provided" };
    }
    if (botStage !== "LIVE") {
      return { mode: "SIMULATION", reason: `Bot stage is ${botStage}, not LIVE` };
    }
    return { mode: "LIVE", reason: "Bot is in LIVE stage with verified credentials" };
  }
}

let bridgeInstance: BrokerExecutionBridge | null = null;

export function getBrokerExecutionBridge(): BrokerExecutionBridge {
  if (!bridgeInstance) {
    bridgeInstance = new BrokerExecutionBridge();
  }
  return bridgeInstance;
}
