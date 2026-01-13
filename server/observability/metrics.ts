/**
 * Prometheus Metrics Endpoint
 * 
 * Provides industry-standard metrics collection and export.
 * Pattern: RED metrics (Rate, Errors, Duration) + business metrics.
 */

import { Request, Response, NextFunction } from 'express';

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

interface CounterMetric {
  name: string;
  help: string;
  type: 'counter';
  values: MetricValue[];
}

interface GaugeMetric {
  name: string;
  help: string;
  type: 'gauge';
  values: MetricValue[];
}

interface HistogramMetric {
  name: string;
  help: string;
  type: 'histogram';
  buckets: number[];
  values: Map<string, { count: number; sum: number; buckets: number[] }>;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

class MetricsRegistry {
  private metrics: Map<string, Metric> = new Map();
  
  // HTTP request metrics
  private httpRequestsTotal = this.createCounter('http_requests_total', 'Total HTTP requests');
  private httpRequestDuration = this.createHistogram('http_request_duration_seconds', 'HTTP request duration in seconds', [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  private httpRequestErrors = this.createCounter('http_request_errors_total', 'Total HTTP request errors');
  
  // Database metrics
  private dbQueryDuration = this.createHistogram('db_query_duration_seconds', 'Database query duration in seconds', [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
  private dbConnectionPool = this.createGauge('db_connection_pool_size', 'Database connection pool size');
  
  // Cache metrics
  private cacheHits = this.createCounter('cache_hits_total', 'Total cache hits');
  private cacheMisses = this.createCounter('cache_misses_total', 'Total cache misses');
  
  // Business metrics
  private activeBots = this.createGauge('trading_bots_active', 'Number of active trading bots');
  private botsByStage = this.createGauge('trading_bots_by_stage', 'Number of bots by stage');
  private backtestsRunning = this.createGauge('backtests_running', 'Number of backtests currently running');
  private tradesToday = this.createCounter('trades_today_total', 'Total trades executed today');
  
  private createCounter(name: string, help: string): CounterMetric {
    const metric: CounterMetric = { name, help, type: 'counter', values: [] };
    this.metrics.set(name, metric);
    return metric;
  }
  
  private createGauge(name: string, help: string): GaugeMetric {
    const metric: GaugeMetric = { name, help, type: 'gauge', values: [] };
    this.metrics.set(name, metric);
    return metric;
  }
  
  private createHistogram(name: string, help: string, buckets: number[]): HistogramMetric {
    const metric: HistogramMetric = { name, help, type: 'histogram', buckets, values: new Map() };
    this.metrics.set(name, metric);
    return metric;
  }
  
  // Increment a counter
  incCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'counter') {
      const labelKey = JSON.stringify(labels);
      const existing = metric.values.find(v => JSON.stringify(v.labels) === labelKey);
      if (existing) {
        existing.value += value;
        existing.timestamp = Date.now();
      } else {
        metric.values.push({ value, labels, timestamp: Date.now() });
      }
    }
  }
  
  // Set a gauge value
  setGauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'gauge') {
      const labelKey = JSON.stringify(labels);
      const existing = metric.values.find(v => JSON.stringify(v.labels) === labelKey);
      if (existing) {
        existing.value = value;
        existing.timestamp = Date.now();
      } else {
        metric.values.push({ value, labels, timestamp: Date.now() });
      }
    }
  }
  
  // Observe a histogram value
  observeHistogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'histogram') {
      const labelKey = JSON.stringify(labels);
      let bucket = metric.values.get(labelKey);
      if (!bucket) {
        bucket = { count: 0, sum: 0, buckets: new Array(metric.buckets.length).fill(0) };
        metric.values.set(labelKey, bucket);
      }
      bucket.count += 1;
      bucket.sum += value;
      for (let i = 0; i < metric.buckets.length; i++) {
        if (value <= metric.buckets[i]) {
          bucket.buckets[i] += 1;
        }
      }
    }
  }
  
  // Public methods for recording common metrics
  recordHttpRequest(method: string, path: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, path: this.normalizePath(path), status: String(statusCode) };
    this.incCounter('http_requests_total', labels);
    this.observeHistogram('http_request_duration_seconds', durationSeconds, labels);
    if (statusCode >= 400) {
      this.incCounter('http_request_errors_total', labels);
    }
  }
  
  recordDbQuery(operation: string, table: string, durationSeconds: number): void {
    this.observeHistogram('db_query_duration_seconds', durationSeconds, { operation, table });
  }
  
  recordCacheHit(cache: string): void {
    this.incCounter('cache_hits_total', { cache });
  }
  
  recordCacheMiss(cache: string): void {
    this.incCounter('cache_misses_total', { cache });
  }
  
  setActiveBots(count: number, stage?: string): void {
    if (stage) {
      this.setGauge('trading_bots_by_stage', count, { stage });
    } else {
      this.setGauge('trading_bots_active', count);
    }
  }
  
  setBacktestsRunning(count: number): void {
    this.setGauge('backtests_running', count);
  }
  
  recordTrade(stage: string): void {
    this.incCounter('trades_today_total', { stage });
  }
  
  // Normalize path to avoid high cardinality (e.g., /api/bots/:id -> /api/bots/{id})
  private normalizePath(path: string): string {
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
      .replace(/\/\d+/g, '/{id}');
  }
  
  // Export metrics in Prometheus format
  toPrometheusFormat(): string {
    const lines: string[] = [];
    
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      
      if (metric.type === 'counter' || metric.type === 'gauge') {
        for (const v of metric.values) {
          const labelStr = Object.entries(v.labels)
            .map(([k, val]) => `${k}="${val}"`)
            .join(',');
          lines.push(`${metric.name}${labelStr ? `{${labelStr}}` : ''} ${v.value}`);
        }
      } else if (metric.type === 'histogram') {
        for (const [labelKey, bucket] of metric.values.entries()) {
          const labels = JSON.parse(labelKey);
          const labelStr = Object.entries(labels)
            .map(([k, val]) => `${k}="${val}"`)
            .join(',');
          const labelPrefix = labelStr ? `{${labelStr},` : '{';
          
          for (let i = 0; i < metric.buckets.length; i++) {
            lines.push(`${metric.name}_bucket${labelPrefix}le="${metric.buckets[i]}"} ${bucket.buckets[i]}`);
          }
          lines.push(`${metric.name}_bucket${labelPrefix}le="+Inf"} ${bucket.count}`);
          lines.push(`${metric.name}_sum${labelStr ? `{${labelStr}}` : ''} ${bucket.sum}`);
          lines.push(`${metric.name}_count${labelStr ? `{${labelStr}}` : ''} ${bucket.count}`);
        }
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

// Singleton instance
export const metricsRegistry = new MetricsRegistry();

/**
 * Middleware to record HTTP request metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const durationSeconds = (Date.now() - startTime) / 1000;
    metricsRegistry.recordHttpRequest(req.method, req.path, res.statusCode, durationSeconds);
  });
  
  next();
}

/**
 * Handler for /metrics endpoint
 */
export function metricsHandler(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4');
  res.send(metricsRegistry.toPrometheusFormat());
}
