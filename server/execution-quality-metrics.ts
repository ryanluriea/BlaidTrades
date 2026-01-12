/**
 * Execution Quality Metrics and Time-Series Storage
 * 
 * Industry-standard Transaction Cost Analysis (TCA) metrics:
 * - Slippage vs VWAP benchmark
 * - Fill ratio tracking
 * - Implementation shortfall
 * - Market impact analysis
 * 
 * Persists metrics to PostgreSQL for historical analysis
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { latencyTracker } from "./latency-tracker";
import { EventEmitter } from "events";

export interface ExecutionMetric {
  id?: string;
  botId: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  filledQty: number;
  expectedPrice: number;
  actualPrice: number;
  benchmarkVwap?: number;
  slippageBps: number;
  vwapDeviationBps?: number;
  implementationShortfallBps?: number;
  fillRatio: number;
  executionTimeMs: number;
  algorithmType?: "TWAP" | "VWAP" | "MARKET" | "LIMIT";
  venue?: string;
  timestamp: Date;
}

export interface AggregatedMetrics {
  period: "HOUR" | "DAY" | "WEEK";
  startTime: Date;
  endTime: Date;
  symbol?: string;
  totalOrders: number;
  totalVolume: number;
  avgSlippageBps: number;
  avgFillRatio: number;
  avgExecutionTimeMs: number;
  p50SlippageBps: number;
  p90SlippageBps: number;
  p99SlippageBps: number;
  highSlippageCount: number;
  rejectedOrders: number;
}

export interface MarketImpactEstimate {
  symbol: string;
  orderSize: number;
  estimatedImpactBps: number;
  historicalAvgBps: number;
  confidence: number;
}

class ExecutionQualityMetricsService extends EventEmitter {
  private metricsBuffer: ExecutionMetric[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private aggregationInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  private readonly BUFFER_SIZE = 100;
  private readonly FLUSH_INTERVAL_MS = 30000;
  private readonly AGGREGATION_INTERVAL_MS = 3600000;
  private readonly HIGH_SLIPPAGE_THRESHOLD_BPS = 10;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.ensureTableExists();

    this.flushInterval = setInterval(() => {
      this.flushBuffer().catch(console.error);
    }, this.FLUSH_INTERVAL_MS);

    this.aggregationInterval = setInterval(() => {
      this.computeHourlyAggregation().catch(console.error);
    }, this.AGGREGATION_INTERVAL_MS);

    this.initialized = true;
    console.log("[EXEC_QUALITY] Execution quality metrics service initialized");
  }

  private async ensureTableExists(): Promise<void> {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS execution_metrics (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          bot_id VARCHAR(255) NOT NULL,
          order_id VARCHAR(255) NOT NULL,
          symbol VARCHAR(50) NOT NULL,
          side VARCHAR(10) NOT NULL,
          order_qty DECIMAL(18, 8) NOT NULL,
          filled_qty DECIMAL(18, 8) NOT NULL,
          expected_price DECIMAL(18, 8) NOT NULL,
          actual_price DECIMAL(18, 8) NOT NULL,
          benchmark_vwap DECIMAL(18, 8),
          slippage_bps DECIMAL(10, 4) NOT NULL,
          vwap_deviation_bps DECIMAL(10, 4),
          implementation_shortfall_bps DECIMAL(10, 4),
          fill_ratio DECIMAL(5, 4) NOT NULL,
          execution_time_ms INTEGER NOT NULL,
          algorithm_type VARCHAR(50),
          venue VARCHAR(100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_exec_metrics_bot_time 
        ON execution_metrics(bot_id, created_at DESC)
      `);

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_exec_metrics_symbol_time 
        ON execution_metrics(symbol, created_at DESC)
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS execution_metrics_hourly (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          period_start TIMESTAMPTZ NOT NULL,
          period_end TIMESTAMPTZ NOT NULL,
          symbol VARCHAR(50),
          total_orders INTEGER NOT NULL,
          total_volume DECIMAL(18, 8) NOT NULL,
          avg_slippage_bps DECIMAL(10, 4) NOT NULL,
          avg_fill_ratio DECIMAL(5, 4) NOT NULL,
          avg_execution_time_ms INTEGER NOT NULL,
          p50_slippage_bps DECIMAL(10, 4) NOT NULL,
          p90_slippage_bps DECIMAL(10, 4) NOT NULL,
          p99_slippage_bps DECIMAL(10, 4) NOT NULL,
          high_slippage_count INTEGER NOT NULL,
          rejected_orders INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_exec_hourly_time 
        ON execution_metrics_hourly(period_start DESC)
      `);

    } catch (error) {
      console.warn("[EXEC_QUALITY] Table creation warning:", (error as Error).message);
    }
  }

  recordExecution(metric: Omit<ExecutionMetric, "id" | "timestamp">): void {
    const fullMetric: ExecutionMetric = {
      ...metric,
      timestamp: new Date(),
    };

    this.metricsBuffer.push(fullMetric);

    latencyTracker.recordExecutionQuality({
      symbol: metric.symbol,
      orderId: metric.orderId,
      side: metric.side,
      expectedPrice: metric.expectedPrice,
      actualPrice: metric.actualPrice,
      slippageBps: metric.slippageBps,
      vwapBenchmark: metric.benchmarkVwap,
      vwapDeviation: metric.vwapDeviationBps,
      fillRatio: metric.fillRatio,
      executionTimeMs: metric.executionTimeMs,
    });

    if (Math.abs(metric.slippageBps) > this.HIGH_SLIPPAGE_THRESHOLD_BPS) {
      this.emit("high_slippage", {
        ...fullMetric,
        severity: Math.abs(metric.slippageBps) > 25 ? "CRITICAL" : "WARNING",
      });
    }

    if (this.metricsBuffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer().catch(console.error);
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;

    const metrics = [...this.metricsBuffer];
    this.metricsBuffer = [];

    try {
      for (const m of metrics) {
        await db.execute(sql`
          INSERT INTO execution_metrics (
            bot_id, order_id, symbol, side, order_qty, filled_qty,
            expected_price, actual_price, benchmark_vwap, slippage_bps,
            vwap_deviation_bps, implementation_shortfall_bps, fill_ratio,
            execution_time_ms, algorithm_type, venue, created_at
          ) VALUES (
            ${m.botId}, ${m.orderId}, ${m.symbol}, ${m.side},
            ${m.orderQty}, ${m.filledQty}, ${m.expectedPrice},
            ${m.actualPrice}, ${m.benchmarkVwap ?? null}, ${m.slippageBps},
            ${m.vwapDeviationBps ?? null}, ${m.implementationShortfallBps ?? null},
            ${m.fillRatio}, ${m.executionTimeMs}, ${m.algorithmType ?? null},
            ${m.venue ?? null}, ${m.timestamp}
          )
        `);
      }

      console.log(`[EXEC_QUALITY] Flushed ${metrics.length} execution metrics to database`);
    } catch (error) {
      console.error("[EXEC_QUALITY] Failed to flush metrics:", (error as Error).message);
      this.metricsBuffer.unshift(...metrics);
    }
  }

  private async computeHourlyAggregation(): Promise<void> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - this.AGGREGATION_INTERVAL_MS);

    try {
      const result = await db.execute(sql`
        SELECT 
          symbol,
          COUNT(*) as total_orders,
          SUM(filled_qty) as total_volume,
          AVG(slippage_bps) as avg_slippage,
          AVG(fill_ratio) as avg_fill_ratio,
          AVG(execution_time_ms) as avg_exec_time,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY slippage_bps) as p50,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY slippage_bps) as p90,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY slippage_bps) as p99,
          SUM(CASE WHEN ABS(slippage_bps) > ${this.HIGH_SLIPPAGE_THRESHOLD_BPS} THEN 1 ELSE 0 END) as high_slippage,
          SUM(CASE WHEN fill_ratio < 1 THEN 1 ELSE 0 END) as partial_fills
        FROM execution_metrics
        WHERE created_at >= ${startTime} AND created_at < ${endTime}
        GROUP BY symbol
      `) as { rows: any[] };

      for (const row of result.rows) {
        await db.execute(sql`
          INSERT INTO execution_metrics_hourly (
            period_start, period_end, symbol, total_orders, total_volume,
            avg_slippage_bps, avg_fill_ratio, avg_execution_time_ms,
            p50_slippage_bps, p90_slippage_bps, p99_slippage_bps,
            high_slippage_count, rejected_orders
          ) VALUES (
            ${startTime}, ${endTime}, ${row.symbol},
            ${parseInt(row.total_orders)}, ${parseFloat(row.total_volume) || 0},
            ${parseFloat(row.avg_slippage) || 0}, ${parseFloat(row.avg_fill_ratio) || 1},
            ${parseInt(row.avg_exec_time) || 0},
            ${parseFloat(row.p50) || 0}, ${parseFloat(row.p90) || 0}, ${parseFloat(row.p99) || 0},
            ${parseInt(row.high_slippage) || 0}, ${parseInt(row.partial_fills) || 0}
          )
        `);
      }

      console.log(`[EXEC_QUALITY] Computed hourly aggregation for ${result.rows.length} symbols`);
    } catch (error) {
      console.error("[EXEC_QUALITY] Aggregation failed:", (error as Error).message);
    }
  }

  async getRecentMetrics(
    options: { botId?: string; symbol?: string; limit?: number; since?: Date } = {}
  ): Promise<ExecutionMetric[]> {
    const limit = options.limit || 100;
    const since = options.since || new Date(Date.now() - 86400000);

    try {
      let query = sql`
        SELECT * FROM execution_metrics
        WHERE created_at >= ${since}
      `;

      if (options.botId) {
        query = sql`${query} AND bot_id = ${options.botId}`;
      }
      if (options.symbol) {
        query = sql`${query} AND symbol = ${options.symbol}`;
      }

      query = sql`${query} ORDER BY created_at DESC LIMIT ${limit}`;

      const result = await db.execute(query) as { rows: any[] };

      return result.rows.map((row) => ({
        id: row.id,
        botId: row.bot_id,
        orderId: row.order_id,
        symbol: row.symbol,
        side: row.side,
        orderQty: parseFloat(row.order_qty),
        filledQty: parseFloat(row.filled_qty),
        expectedPrice: parseFloat(row.expected_price),
        actualPrice: parseFloat(row.actual_price),
        benchmarkVwap: row.benchmark_vwap ? parseFloat(row.benchmark_vwap) : undefined,
        slippageBps: parseFloat(row.slippage_bps),
        vwapDeviationBps: row.vwap_deviation_bps ? parseFloat(row.vwap_deviation_bps) : undefined,
        implementationShortfallBps: row.implementation_shortfall_bps
          ? parseFloat(row.implementation_shortfall_bps)
          : undefined,
        fillRatio: parseFloat(row.fill_ratio),
        executionTimeMs: parseInt(row.execution_time_ms),
        algorithmType: row.algorithm_type,
        venue: row.venue,
        timestamp: new Date(row.created_at),
      }));
    } catch (error) {
      console.error("[EXEC_QUALITY] Failed to fetch metrics:", (error as Error).message);
      return [];
    }
  }

  async getAggregatedMetrics(
    period: "HOUR" | "DAY" | "WEEK",
    options: { symbol?: string; limit?: number } = {}
  ): Promise<AggregatedMetrics[]> {
    const limit = options.limit || 24;

    try {
      let query = sql`
        SELECT * FROM execution_metrics_hourly
      `;

      if (options.symbol) {
        query = sql`${query} WHERE symbol = ${options.symbol}`;
      }

      query = sql`${query} ORDER BY period_start DESC LIMIT ${limit}`;

      const result = await db.execute(query) as { rows: any[] };

      return result.rows.map((row) => ({
        period,
        startTime: new Date(row.period_start),
        endTime: new Date(row.period_end),
        symbol: row.symbol,
        totalOrders: parseInt(row.total_orders),
        totalVolume: parseFloat(row.total_volume),
        avgSlippageBps: parseFloat(row.avg_slippage_bps),
        avgFillRatio: parseFloat(row.avg_fill_ratio),
        avgExecutionTimeMs: parseInt(row.avg_execution_time_ms),
        p50SlippageBps: parseFloat(row.p50_slippage_bps),
        p90SlippageBps: parseFloat(row.p90_slippage_bps),
        p99SlippageBps: parseFloat(row.p99_slippage_bps),
        highSlippageCount: parseInt(row.high_slippage_count),
        rejectedOrders: parseInt(row.rejected_orders),
      }));
    } catch (error) {
      console.error("[EXEC_QUALITY] Failed to fetch aggregations:", (error as Error).message);
      return [];
    }
  }

  estimateMarketImpact(symbol: string, orderSize: number): MarketImpactEstimate {
    const avgDailyVolume = 10000;
    const participationRate = orderSize / avgDailyVolume;
    
    const alpha = 0.1;
    const beta = 0.5;
    const estimatedImpactBps = alpha * Math.pow(participationRate, beta) * 10000;

    const historicalData = latencyTracker.getExecutionQualityMetrics({ symbol, limit: 100 });
    const historicalAvgBps =
      historicalData.length > 0
        ? historicalData.reduce((sum, m) => sum + Math.abs(m.slippageBps), 0) / historicalData.length
        : estimatedImpactBps;

    return {
      symbol,
      orderSize,
      estimatedImpactBps: parseFloat(estimatedImpactBps.toFixed(2)),
      historicalAvgBps: parseFloat(historicalAvgBps.toFixed(2)),
      confidence: Math.min(0.95, historicalData.length / 100),
    };
  }

  calculateSlippage(
    expectedPrice: number,
    actualPrice: number,
    side: "BUY" | "SELL"
  ): number {
    if (expectedPrice === 0) return 0;
    
    const priceDiff = actualPrice - expectedPrice;
    const direction = side === "BUY" ? 1 : -1;
    const slippageBps = (priceDiff / expectedPrice) * 10000 * direction;
    
    return parseFloat(slippageBps.toFixed(4));
  }

  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    if (this.aggregationInterval) {
      clearInterval(this.aggregationInterval);
    }
    
    this.flushBuffer().catch(console.error);
    console.log("[EXEC_QUALITY] Shutdown complete");
  }
}

export const executionQualityMetrics = new ExecutionQualityMetricsService();
