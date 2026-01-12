/**
 * Institutional-Grade Latency Tracking System
 * 
 * Tracks P50/P90/P99 latencies for:
 * - Event loop responsiveness
 * - Quote processing time
 * - Order execution latency
 * - Database query duration
 * - WebSocket message delivery
 * 
 * Uses perf_hooks for high-resolution timing
 */

import { performance, PerformanceObserver, monitorEventLoopDelay } from "perf_hooks";
import { EventEmitter } from "events";

export type LatencyCategory =
  | "event_loop"
  | "quote_processing"
  | "order_execution"
  | "database_query"
  | "websocket_delivery"
  | "backtest_execution"
  | "worker_task"
  | "api_response";

interface LatencyBucket {
  samples: number[];
  maxSamples: number;
  sum: number;
  count: number;
  min: number;
  max: number;
  lastUpdated: number;
}

interface LatencySnapshot {
  category: LatencyCategory;
  p50: number;
  p90: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  timestamp: number;
}

interface ExecutionQualityMetrics {
  symbol: string;
  orderId: string;
  side: "BUY" | "SELL";
  expectedPrice: number;
  actualPrice: number;
  slippageBps: number;
  vwapBenchmark?: number;
  vwapDeviation?: number;
  fillRatio: number;
  executionTimeMs: number;
  timestamp: number;
}

const DEFAULT_MAX_SAMPLES = 10000;
const PERCENTILE_WINDOW_MS = 300000;
const ALERT_THRESHOLD_P99_MS = 100;
const EVENT_LOOP_WARNING_MS = 50;

class LatencyTracker extends EventEmitter {
  private buckets: Map<LatencyCategory, LatencyBucket> = new Map();
  private snapshots: Map<LatencyCategory, LatencySnapshot[]> = new Map();
  private eventLoopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;
  private activeMarkers: Map<string, number> = new Map();
  private executionQuality: ExecutionQualityMetrics[] = [];
  private snapshotInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    super();
    this.initializeBuckets();
  }

  private initializeBuckets(): void {
    const categories: LatencyCategory[] = [
      "event_loop",
      "quote_processing",
      "order_execution",
      "database_query",
      "websocket_delivery",
      "backtest_execution",
      "worker_task",
      "api_response",
    ];

    for (const category of categories) {
      this.buckets.set(category, {
        samples: [],
        maxSamples: DEFAULT_MAX_SAMPLES,
        sum: 0,
        count: 0,
        min: Infinity,
        max: -Infinity,
        lastUpdated: Date.now(),
      });
      this.snapshots.set(category, []);
    }
  }

  initialize(): void {
    if (this.initialized) return;

    try {
      this.eventLoopMonitor = monitorEventLoopDelay({ resolution: 10 });
      this.eventLoopMonitor.enable();
    } catch (e) {
      console.warn("[LATENCY_TRACKER] Event loop monitor unavailable:", (e as Error).message);
    }

    this.snapshotInterval = setInterval(() => {
      this.captureSnapshots();
    }, 60000);

    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 300000);

    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === "measure") {
          const category = this.extractCategory(entry.name);
          if (category) {
            this.record(category, entry.duration);
          }
        }
      }
    });

    try {
      obs.observe({ entryTypes: ["measure"], buffered: true });
    } catch (e) {
      console.warn("[LATENCY_TRACKER] Performance observer setup warning:", (e as Error).message);
    }

    this.initialized = true;
    console.log("[LATENCY_TRACKER] Initialized with P50/P90/P99 tracking");
  }

  private extractCategory(name: string): LatencyCategory | null {
    if (name.startsWith("quote-")) return "quote_processing";
    if (name.startsWith("order-")) return "order_execution";
    if (name.startsWith("db-")) return "database_query";
    if (name.startsWith("ws-")) return "websocket_delivery";
    if (name.startsWith("backtest-")) return "backtest_execution";
    if (name.startsWith("worker-task-")) return "worker_task";
    if (name.startsWith("api-")) return "api_response";
    return null;
  }

  record(category: LatencyCategory, durationMs: number): void {
    const bucket = this.buckets.get(category);
    if (!bucket) return;

    bucket.samples.push(durationMs);
    if (bucket.samples.length > bucket.maxSamples) {
      const removed = bucket.samples.shift()!;
      bucket.sum -= removed;
    }

    bucket.sum += durationMs;
    bucket.count++;
    bucket.min = Math.min(bucket.min, durationMs);
    bucket.max = Math.max(bucket.max, durationMs);
    bucket.lastUpdated = Date.now();

    if (category !== "event_loop" && durationMs > ALERT_THRESHOLD_P99_MS) {
      this.emit("latency_alert", {
        category,
        latencyMs: durationMs,
        threshold: ALERT_THRESHOLD_P99_MS,
        timestamp: Date.now(),
      });
    }
  }

  recordEventLoopStart(markerId: string): void {
    this.activeMarkers.set(markerId, performance.now());
  }

  recordEventLoopEnd(markerId: string, overrideDuration?: number): void {
    const startTime = this.activeMarkers.get(markerId);
    if (startTime !== undefined) {
      const duration = overrideDuration ?? (performance.now() - startTime);
      this.activeMarkers.delete(markerId);
      
      try {
        performance.measure(markerId, { start: startTime, duration });
      } catch {
        // Ignore if marks not found
      }
    }
  }

  recordExecutionQuality(metrics: Omit<ExecutionQualityMetrics, "timestamp">): void {
    const fullMetrics: ExecutionQualityMetrics = {
      ...metrics,
      timestamp: Date.now(),
    };

    this.executionQuality.push(fullMetrics);

    if (this.executionQuality.length > 10000) {
      this.executionQuality.shift();
    }

    if (Math.abs(metrics.slippageBps) > 10) {
      this.emit("slippage_alert", {
        ...fullMetrics,
        severity: Math.abs(metrics.slippageBps) > 25 ? "HIGH" : "MEDIUM",
      });
    }
  }

  private computePercentile(samples: number[], percentile: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  getSnapshot(category: LatencyCategory): LatencySnapshot | null {
    const bucket = this.buckets.get(category);
    if (!bucket || bucket.samples.length === 0) return null;

    return {
      category,
      p50: this.computePercentile(bucket.samples, 50),
      p90: this.computePercentile(bucket.samples, 90),
      p99: this.computePercentile(bucket.samples, 99),
      avg: bucket.sum / bucket.samples.length,
      min: bucket.min === Infinity ? 0 : bucket.min,
      max: bucket.max === -Infinity ? 0 : bucket.max,
      count: bucket.count,
      timestamp: Date.now(),
    };
  }

  getAllSnapshots(): LatencySnapshot[] {
    const results: LatencySnapshot[] = [];
    for (const category of this.buckets.keys()) {
      const snapshot = this.getSnapshot(category);
      if (snapshot) results.push(snapshot);
    }
    return results;
  }

  getEventLoopMetrics(): { p50: number; p90: number; p99: number; mean: number } | null {
    if (!this.eventLoopMonitor) return null;

    return {
      p50: this.eventLoopMonitor.percentile(50) / 1e6,
      p90: this.eventLoopMonitor.percentile(90) / 1e6,
      p99: this.eventLoopMonitor.percentile(99) / 1e6,
      mean: this.eventLoopMonitor.mean / 1e6,
    };
  }

  getExecutionQualityMetrics(
    options: { symbol?: string; limit?: number; since?: number } = {}
  ): ExecutionQualityMetrics[] {
    let filtered = this.executionQuality;

    if (options.symbol) {
      filtered = filtered.filter((m) => m.symbol === options.symbol);
    }

    if (options.since) {
      filtered = filtered.filter((m) => m.timestamp >= options.since);
    }

    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  getExecutionQualitySummary(): {
    avgSlippageBps: number;
    avgFillRatio: number;
    avgExecutionTimeMs: number;
    totalExecutions: number;
    highSlippageCount: number;
  } {
    if (this.executionQuality.length === 0) {
      return {
        avgSlippageBps: 0,
        avgFillRatio: 0,
        avgExecutionTimeMs: 0,
        totalExecutions: 0,
        highSlippageCount: 0,
      };
    }

    const recent = this.executionQuality.filter(
      (m) => Date.now() - m.timestamp < PERCENTILE_WINDOW_MS
    );

    if (recent.length === 0) {
      return {
        avgSlippageBps: 0,
        avgFillRatio: 0,
        avgExecutionTimeMs: 0,
        totalExecutions: this.executionQuality.length,
        highSlippageCount: 0,
      };
    }

    const sumSlippage = recent.reduce((s, m) => s + Math.abs(m.slippageBps), 0);
    const sumFillRatio = recent.reduce((s, m) => s + m.fillRatio, 0);
    const sumExecTime = recent.reduce((s, m) => s + m.executionTimeMs, 0);
    const highSlippage = recent.filter((m) => Math.abs(m.slippageBps) > 10).length;

    return {
      avgSlippageBps: sumSlippage / recent.length,
      avgFillRatio: sumFillRatio / recent.length,
      avgExecutionTimeMs: sumExecTime / recent.length,
      totalExecutions: this.executionQuality.length,
      highSlippageCount: highSlippage,
    };
  }

  private captureSnapshots(): void {
    for (const category of this.buckets.keys()) {
      const snapshot = this.getSnapshot(category);
      if (snapshot) {
        const history = this.snapshots.get(category)!;
        history.push(snapshot);
        
        if (history.length > 1440) {
          history.shift();
        }
      }
    }

    if (this.eventLoopMonitor) {
      const elMetrics = this.getEventLoopMetrics();
      if (elMetrics && elMetrics.p99 > EVENT_LOOP_WARNING_MS) {
        console.warn(
          `[LATENCY_TRACKER] Event loop P99=${elMetrics.p99.toFixed(2)}ms exceeds ${EVENT_LOOP_WARNING_MS}ms threshold`
        );
        this.emit("event_loop_warning", elMetrics);
      }
    }
  }

  private cleanupOldData(): void {
    const cutoff = Date.now() - 86400000;
    
    for (const history of this.snapshots.values()) {
      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
      }
    }

    while (
      this.executionQuality.length > 0 &&
      this.executionQuality[0].timestamp < cutoff
    ) {
      this.executionQuality.shift();
    }
  }

  getHistoricalSnapshots(
    category: LatencyCategory,
    limit: number = 60
  ): LatencySnapshot[] {
    return (this.snapshots.get(category) || []).slice(-limit);
  }

  shutdown(): void {
    if (this.eventLoopMonitor) {
      this.eventLoopMonitor.disable();
    }
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    console.log("[LATENCY_TRACKER] Shutdown complete");
  }
}

export const latencyTracker = new LatencyTracker();
