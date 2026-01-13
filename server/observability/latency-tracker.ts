/**
 * Institutional-Grade Latency Percentile Tracker
 * 
 * Provides P50/P95/P99 latency calculations using reservoir sampling
 * for memory-efficient percentile estimation. Pattern used by:
 * - Bloomberg Terminal
 * - Interactive Brokers TWS
 * - QuantConnect LEAN
 * 
 * Features:
 * - Rolling window (5-minute default)
 * - Memory-bounded sampling (max 10k samples per endpoint)
 * - Automatic cleanup of stale data
 * - SLO violation alerting
 */

interface LatencySample {
  timestamp: number;
  durationMs: number;
}

interface EndpointStats {
  samples: LatencySample[];
  totalRequests: number;
  totalErrors: number;
  sloViolations: number;
  itemsSeen: number; // For true reservoir sampling (Algorithm R)
}

interface PercentileResult {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  count: number;
  errorRate: number;
  sloViolationRate: number;
}

interface SLOConfig {
  targetMs: number;
  errorBudgetPercent: number;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SAMPLES_PER_ENDPOINT = 10000;
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

class LatencyTracker {
  private endpoints: Map<string, EndpointStats> = new Map();
  private sloConfigs: Map<string, SLOConfig> = new Map();
  private windowMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
    this.startCleanup();
    
    this.setSLO('/api/bots', { targetMs: 250, errorBudgetPercent: 1 });
    this.setSLO('/api/bots-overview', { targetMs: 500, errorBudgetPercent: 1 });
    this.setSLO('/api/strategy-lab/candidates', { targetMs: 1000, errorBudgetPercent: 2 });
    this.setSLO('/api/health', { targetMs: 100, errorBudgetPercent: 0.1 });
    this.setSLO('ws:tick', { targetMs: 50, errorBudgetPercent: 0.5 });
    this.setSLO('ws:pnl', { targetMs: 100, errorBudgetPercent: 1 });
    this.setSLO('broker:order', { targetMs: 200, errorBudgetPercent: 0.1 });
    this.setSLO('backtest:execute', { targetMs: 30000, errorBudgetPercent: 5 });
  }
  
  setSLO(endpoint: string, config: SLOConfig): void {
    this.sloConfigs.set(endpoint, config);
  }
  
  record(endpoint: string, durationMs: number, isError: boolean = false): void {
    const now = Date.now();
    
    if (!this.endpoints.has(endpoint)) {
      this.endpoints.set(endpoint, {
        samples: [],
        totalRequests: 0,
        totalErrors: 0,
        sloViolations: 0,
        itemsSeen: 0,
      });
    }
    
    const stats = this.endpoints.get(endpoint)!;
    stats.totalRequests++;
    stats.itemsSeen++;
    
    if (isError) {
      stats.totalErrors++;
    }
    
    const slo = this.sloConfigs.get(endpoint);
    if (slo && durationMs > slo.targetMs) {
      stats.sloViolations++;
    }
    
    // Algorithm R reservoir sampling - maintains uniform random sample
    // Each item has probability k/n of being in the reservoir where k=MAX_SAMPLES, n=itemsSeen
    if (stats.samples.length < MAX_SAMPLES_PER_ENDPOINT) {
      stats.samples.push({ timestamp: now, durationMs });
    } else {
      // Replace with probability k/n (decreasing as more items seen)
      const replaceProb = MAX_SAMPLES_PER_ENDPOINT / stats.itemsSeen;
      if (Math.random() < replaceProb) {
        const randomIndex = Math.floor(Math.random() * MAX_SAMPLES_PER_ENDPOINT);
        stats.samples[randomIndex] = { timestamp: now, durationMs };
      }
    }
  }
  
  getPercentiles(endpoint: string): PercentileResult | null {
    const stats = this.endpoints.get(endpoint);
    if (!stats || stats.samples.length === 0) {
      return null;
    }
    
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    const recentSamples = stats.samples
      .filter(s => s.timestamp >= windowStart)
      .map(s => s.durationMs)
      .sort((a, b) => a - b);
    
    if (recentSamples.length === 0) {
      return null;
    }
    
    const percentile = (arr: number[], p: number): number => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };
    
    const sum = recentSamples.reduce((a, b) => a + b, 0);
    
    return {
      p50: percentile(recentSamples, 50),
      p75: percentile(recentSamples, 75),
      p90: percentile(recentSamples, 90),
      p95: percentile(recentSamples, 95),
      p99: percentile(recentSamples, 99),
      min: recentSamples[0],
      max: recentSamples[recentSamples.length - 1],
      mean: sum / recentSamples.length,
      count: recentSamples.length,
      errorRate: stats.totalRequests > 0 ? (stats.totalErrors / stats.totalRequests) * 100 : 0,
      sloViolationRate: stats.totalRequests > 0 ? (stats.sloViolations / stats.totalRequests) * 100 : 0,
    };
  }
  
  getAllPercentiles(): Record<string, PercentileResult> {
    const result: Record<string, PercentileResult> = {};
    
    for (const endpoint of this.endpoints.keys()) {
      const percentiles = this.getPercentiles(endpoint);
      if (percentiles) {
        result[endpoint] = percentiles;
      }
    }
    
    return result;
  }
  
  getSLOStatus(): Array<{
    endpoint: string;
    slo: SLOConfig;
    current: PercentileResult;
    status: 'OK' | 'WARNING' | 'CRITICAL';
    budgetRemaining: number;
  }> {
    const results: Array<{
      endpoint: string;
      slo: SLOConfig;
      current: PercentileResult;
      status: 'OK' | 'WARNING' | 'CRITICAL';
      budgetRemaining: number;
    }> = [];
    
    for (const [endpoint, slo] of this.sloConfigs) {
      const current = this.getPercentiles(endpoint);
      if (!current) continue;
      
      const budgetRemaining = slo.errorBudgetPercent - current.sloViolationRate;
      
      let status: 'OK' | 'WARNING' | 'CRITICAL' = 'OK';
      if (budgetRemaining <= 0) {
        status = 'CRITICAL';
      } else if (budgetRemaining < slo.errorBudgetPercent * 0.25) {
        status = 'WARNING';
      }
      
      results.push({
        endpoint,
        slo,
        current,
        status,
        budgetRemaining: Math.max(0, budgetRemaining),
      });
    }
    
    return results;
  }
  
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const windowStart = now - this.windowMs;
      
      for (const stats of this.endpoints.values()) {
        const oldLength = stats.samples.length;
        stats.samples = stats.samples.filter(s => s.timestamp >= windowStart);
        const newLength = stats.samples.length;
        
        // Reset itemsSeen to current sample count after cleanup
        // This ensures reservoir sampling probability k/n stays fresh for the active window
        // Without this, itemsSeen grows unbounded and new samples get decreasing admission probability
        if (newLength < oldLength) {
          stats.itemsSeen = newLength;
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }
  
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  logSummary(): void {
    const all = this.getAllPercentiles();
    const sloStatus = this.getSLOStatus();
    
    const critical = sloStatus.filter(s => s.status === 'CRITICAL');
    const warning = sloStatus.filter(s => s.status === 'WARNING');
    
    if (critical.length > 0) {
      console.error(`[LATENCY] SLO CRITICAL: ${critical.map(c => c.endpoint).join(', ')}`);
    }
    if (warning.length > 0) {
      console.warn(`[LATENCY] SLO WARNING: ${warning.map(w => w.endpoint).join(', ')}`);
    }
    
    const topEndpoints = Object.entries(all)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    
    for (const [endpoint, stats] of topEndpoints) {
      console.log(
        `[LATENCY] ${endpoint} p50=${stats.p50.toFixed(0)}ms p95=${stats.p95.toFixed(0)}ms p99=${stats.p99.toFixed(0)}ms count=${stats.count} errors=${stats.errorRate.toFixed(2)}%`
      );
    }
  }
}

export const latencyTracker = new LatencyTracker();

import { Request, Response, NextFunction } from 'express';

export function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();
  
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const durationMs = Number(endTime - startTime) / 1_000_000;
    
    const normalizedPath = req.path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
      .replace(/\/\d+/g, '/{id}');
    
    const isError = res.statusCode >= 400;
    latencyTracker.record(normalizedPath, durationMs, isError);
  });
  
  next();
}

let latencyLogInterval: NodeJS.Timeout | null = null;

export function startLatencyLogging(intervalMs: number = 60000): void {
  if (latencyLogInterval) {
    clearInterval(latencyLogInterval);
  }
  latencyLogInterval = setInterval(() => latencyTracker.logSummary(), intervalMs);
  console.log(`[LATENCY] Started percentile tracking (window=5min, log_interval=${intervalMs / 1000}s)`);
}

export function stopLatencyLogging(): void {
  if (latencyLogInterval) {
    clearInterval(latencyLogInterval);
    latencyLogInterval = null;
  }
}
