/**
 * Database Query Latency Monitor
 * 
 * Tracks query execution times, identifies slow queries (>10s),
 * and triggers alerts via Discord for production monitoring.
 * 
 * Features:
 * - Rolling window metrics (1min, 5min, 15min)
 * - Slow query logging and alerting (>10s threshold)
 * - P50/P95/P99 latency tracking per query type
 * - Discord alerts for critical latency spikes
 */

import { sendDiscord } from "../providers/notify/discordWebhook";

const LOG_PREFIX = "[DB_MONITOR]";

export interface QueryMetric {
  queryType: string;
  durationMs: number;
  timestamp: number;
  success: boolean;
  errorCode?: string;
}

export interface SlowQueryAlert {
  id: string;
  queryType: string;
  durationMs: number;
  timestamp: Date;
  acknowledged: boolean;
  alertedViaDiscord: boolean;
}

export interface QueryLatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  slowCount: number;
  errorCount: number;
}

export interface DbMonitorMetrics {
  uptime: number;
  totalQueries: number;
  slowQueries: number;
  errorQueries: number;
  windows: {
    oneMin: QueryLatencyStats;
    fiveMin: QueryLatencyStats;
    fifteenMin: QueryLatencyStats;
  };
  byQueryType: Record<string, QueryLatencyStats>;
  recentSlowQueries: SlowQueryAlert[];
  alertsTriggered24h: number;
}

const SLOW_QUERY_THRESHOLD_MS = 10000;
const CRITICAL_QUERY_THRESHOLD_MS = 30000;
const ROLLING_WINDOW_MAX_ENTRIES = 10000;
const SLOW_QUERY_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

const queryMetrics: QueryMetric[] = [];
const slowQueryAlerts: SlowQueryAlert[] = [];
let alertsTriggered24h = 0;
let lastAlertTime = 0;
let startupTime = Date.now();

export function recordQueryMetric(metric: QueryMetric): void {
  queryMetrics.push(metric);
  
  if (queryMetrics.length > ROLLING_WINDOW_MAX_ENTRIES) {
    queryMetrics.shift();
  }
  
  if (metric.durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    const alertId = `slow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const alert: SlowQueryAlert = {
      id: alertId,
      queryType: metric.queryType,
      durationMs: metric.durationMs,
      timestamp: new Date(),
      acknowledged: false,
      alertedViaDiscord: false,
    };
    
    slowQueryAlerts.push(alert);
    if (slowQueryAlerts.length > 100) {
      slowQueryAlerts.shift();
    }
    
    const isCritical = metric.durationMs >= CRITICAL_QUERY_THRESHOLD_MS;
    const severity = isCritical ? "CRITICAL" : "WARN";
    
    console.log(`${LOG_PREFIX} SLOW_QUERY severity=${severity} type=${metric.queryType} duration=${metric.durationMs}ms`);
    
    if (Date.now() - lastAlertTime > SLOW_QUERY_ALERT_COOLDOWN_MS) {
      triggerSlowQueryAlert(alert, isCritical).catch(err => {
        console.error(`${LOG_PREFIX} Failed to send Discord alert:`, err.message);
      });
      lastAlertTime = Date.now();
      alertsTriggered24h++;
      alert.alertedViaDiscord = true;
    }
  }
}

async function triggerSlowQueryAlert(alert: SlowQueryAlert, isCritical: boolean): Promise<void> {
  const severity = isCritical ? "CRITICAL" : "WARN";
  const correlationId = `dbmon_${Date.now()}`;
  
  try {
    await sendDiscord({
      channel: "ops",
      title: `Database Slow Query Alert`,
      message: `Query type **${alert.queryType}** took **${(alert.durationMs / 1000).toFixed(2)}s** (threshold: ${SLOW_QUERY_THRESHOLD_MS / 1000}s)`,
      severity,
      metadata: {
        queryType: alert.queryType,
        durationMs: alert.durationMs,
        threshold: SLOW_QUERY_THRESHOLD_MS,
        timestamp: alert.timestamp.toISOString(),
      },
      correlationId,
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Discord alert failed:`, error);
  }
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * percentile) - 1;
  return sorted[Math.max(0, index)] || 0;
}

function getStatsForWindow(windowMs: number): QueryLatencyStats {
  const now = Date.now();
  const cutoff = now - windowMs;
  const windowMetrics = queryMetrics.filter(m => m.timestamp >= cutoff);
  
  if (windowMetrics.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, slowCount: 0, errorCount: 0 };
  }
  
  const durations = windowMetrics.map(m => m.durationMs);
  const slowCount = windowMetrics.filter(m => m.durationMs >= SLOW_QUERY_THRESHOLD_MS).length;
  const errorCount = windowMetrics.filter(m => !m.success).length;
  
  return {
    count: windowMetrics.length,
    p50: calculatePercentile(durations, 0.50),
    p95: calculatePercentile(durations, 0.95),
    p99: calculatePercentile(durations, 0.99),
    max: Math.max(...durations),
    slowCount,
    errorCount,
  };
}

function getStatsByQueryType(): Record<string, QueryLatencyStats> {
  const now = Date.now();
  const cutoff = now - 15 * 60 * 1000;
  const recentMetrics = queryMetrics.filter(m => m.timestamp >= cutoff);
  
  const byType: Record<string, QueryMetric[]> = {};
  for (const metric of recentMetrics) {
    if (!byType[metric.queryType]) {
      byType[metric.queryType] = [];
    }
    byType[metric.queryType].push(metric);
  }
  
  const result: Record<string, QueryLatencyStats> = {};
  for (const [queryType, metrics] of Object.entries(byType)) {
    const durations = metrics.map(m => m.durationMs);
    result[queryType] = {
      count: metrics.length,
      p50: calculatePercentile(durations, 0.50),
      p95: calculatePercentile(durations, 0.95),
      p99: calculatePercentile(durations, 0.99),
      max: Math.max(...durations),
      slowCount: metrics.filter(m => m.durationMs >= SLOW_QUERY_THRESHOLD_MS).length,
      errorCount: metrics.filter(m => !m.success).length,
    };
  }
  
  return result;
}

export function getDbMonitorMetrics(): DbMonitorMetrics {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  if (startupTime < oneDayAgo) {
    alertsTriggered24h = slowQueryAlerts.filter(
      a => a.alertedViaDiscord && a.timestamp.getTime() > oneDayAgo
    ).length;
  }
  
  return {
    uptime: now - startupTime,
    totalQueries: queryMetrics.length,
    slowQueries: queryMetrics.filter(m => m.durationMs >= SLOW_QUERY_THRESHOLD_MS).length,
    errorQueries: queryMetrics.filter(m => !m.success).length,
    windows: {
      oneMin: getStatsForWindow(60 * 1000),
      fiveMin: getStatsForWindow(5 * 60 * 1000),
      fifteenMin: getStatsForWindow(15 * 60 * 1000),
    },
    byQueryType: getStatsByQueryType(),
    recentSlowQueries: slowQueryAlerts.slice(-10).reverse(),
    alertsTriggered24h,
  };
}

export function acknowledgeSlowQuery(alertId: string): boolean {
  const alert = slowQueryAlerts.find(a => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    return true;
  }
  return false;
}

export function resetDbMonitorMetrics(): void {
  queryMetrics.length = 0;
  slowQueryAlerts.length = 0;
  alertsTriggered24h = 0;
  startupTime = Date.now();
  console.log(`${LOG_PREFIX} Metrics reset`);
}

export function createQueryWrapper<T>(
  queryType: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now();
  
  return queryFn()
    .then(result => {
      recordQueryMetric({
        queryType,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        success: true,
      });
      return result;
    })
    .catch(error => {
      recordQueryMetric({
        queryType,
        durationMs: Date.now() - startTime,
        timestamp: Date.now(),
        success: false,
        errorCode: error.code || error.message?.slice(0, 50),
      });
      throw error;
    });
}
