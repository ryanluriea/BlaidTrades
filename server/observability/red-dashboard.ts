/**
 * RED Metrics Dashboard
 * 
 * Rate, Errors, Duration - The golden signals for service monitoring.
 * Industry standard pattern used by Google SRE, Netflix, and trading platforms.
 * 
 * Provides:
 * - Real-time service health overview
 * - SLO compliance tracking
 * - Error budget consumption
 * - Latency percentile summaries
 */

import { latencyTracker } from './latency-tracker';
import { eventLoopMonitor } from './event-loop-monitor';
import { wsTracker } from './websocket-tracker';
import { metricsRegistry } from './metrics';
import { getAllCircuitStats } from '../circuit-breaker';

interface REDMetrics {
  timestamp: string;
  uptime: number;
  
  rate: {
    httpRequestsTotal: number;
    requestsPerMinute: number;
    wsMessagesPerSecond: Record<string, number>;
  };
  
  errors: {
    httpErrorsTotal: number;
    errorRate: number;
    circuitBreakers: Record<string, {
      state: string;
      failures: number;
      lastError?: string;
    }>;
  };
  
  duration: {
    apiLatency: Record<string, {
      p50: number;
      p95: number;
      p99: number;
      count: number;
    }>;
    wsLatency: Record<string, {
      p50: number;
      p95: number;
      p99: number;
    }>;
    eventLoop: {
      status: string;
      avgLagMs: number;
      p95LagMs: number;
      p99LagMs: number;
    };
  };
  
  slos: Array<{
    endpoint: string;
    targetMs: number;
    p95Ms: number;
    status: 'OK' | 'WARNING' | 'CRITICAL';
    budgetRemaining: number;
  }>;
  
  health: {
    overall: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    components: Array<{
      name: string;
      status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
      detail: string;
    }>;
  };
}

const startTime = Date.now();

export function getREDMetrics(): REDMetrics {
  const now = new Date();
  const uptimeSeconds = (Date.now() - startTime) / 1000;
  
  // Get metrics summary
  const metricsSummary = metricsRegistry.getSummary();
  
  // Get latency percentiles
  const apiLatency = latencyTracker.getAllPercentiles();
  const sloStatus = latencyTracker.getSLOStatus();
  
  // Get WebSocket stats
  const wsChannels = wsTracker.getAllChannels();
  
  // Get event loop stats
  const eventLoop = eventLoopMonitor.getStats();
  
  // Get circuit breaker stats
  const circuits = getAllCircuitStats();
  
  // Calculate rate metrics
  const requestsPerMinute = uptimeSeconds > 60 
    ? (metricsSummary.httpRequests / (uptimeSeconds / 60))
    : metricsSummary.httpRequests;
  
  // Calculate error rate
  const errorRate = metricsSummary.httpRequests > 0
    ? (metricsSummary.httpErrors / metricsSummary.httpRequests) * 100
    : 0;
  
  // Build API latency summary (top endpoints by traffic)
  const apiLatencySummary: Record<string, { p50: number; p95: number; p99: number; count: number }> = {};
  const sortedEndpoints = Object.entries(apiLatency)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  
  for (const [endpoint, stats] of sortedEndpoints) {
    apiLatencySummary[endpoint] = {
      p50: Math.round(stats.p50),
      p95: Math.round(stats.p95),
      p99: Math.round(stats.p99),
      count: stats.count,
    };
  }
  
  // Build WS latency summary
  const wsLatencySummary: Record<string, { p50: number; p95: number; p99: number }> = {};
  const wsRates: Record<string, number> = {};
  
  for (const [channel, stats] of Object.entries(wsChannels)) {
    wsLatencySummary[channel] = {
      p50: Math.round(stats.p50),
      p95: Math.round(stats.p95),
      p99: Math.round(stats.p99),
    };
    wsRates[channel] = Math.round(stats.messagesPerSecond * 10) / 10;
  }
  
  // Build circuit breaker summary
  const circuitSummary: Record<string, { state: string; failures: number; lastError?: string }> = {};
  for (const [name, stats] of Object.entries(circuits)) {
    circuitSummary[name] = {
      state: stats.state,
      failures: stats.totalFailures,
      lastError: stats.lastError,
    };
  }
  
  // Build SLO summary
  const slos = sloStatus.map(s => ({
    endpoint: s.endpoint,
    targetMs: s.slo.targetMs,
    p95Ms: Math.round(s.current.p95),
    status: s.status,
    budgetRemaining: Math.round(s.budgetRemaining * 100) / 100,
  }));
  
  // Determine overall health
  const components: Array<{ name: string; status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'; detail: string }> = [];
  
  // Event loop health
  components.push({
    name: 'Event Loop',
    status: eventLoop.status,
    detail: `p95=${eventLoop.p95LagMs.toFixed(1)}ms`,
  });
  
  // Error rate health
  let errorHealth: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (errorRate > 5) errorHealth = 'CRITICAL';
  else if (errorRate > 1) errorHealth = 'DEGRADED';
  components.push({
    name: 'Error Rate',
    status: errorHealth,
    detail: `${errorRate.toFixed(2)}%`,
  });
  
  // Circuit breaker health
  const openCircuits = Object.values(circuits).filter(c => c.state === 'OPEN');
  let circuitHealth: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (openCircuits.length > 2) circuitHealth = 'CRITICAL';
  else if (openCircuits.length > 0) circuitHealth = 'DEGRADED';
  components.push({
    name: 'Circuit Breakers',
    status: circuitHealth,
    detail: `${openCircuits.length} open`,
  });
  
  // SLO health
  const criticalSLOs = slos.filter(s => s.status === 'CRITICAL');
  let sloHealth: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (criticalSLOs.length > 2) sloHealth = 'CRITICAL';
  else if (criticalSLOs.length > 0) sloHealth = 'DEGRADED';
  components.push({
    name: 'SLO Compliance',
    status: sloHealth,
    detail: `${criticalSLOs.length} violations`,
  });
  
  // Overall health is the worst of all components
  let overall: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';
  if (components.some(c => c.status === 'CRITICAL')) overall = 'CRITICAL';
  else if (components.some(c => c.status === 'DEGRADED')) overall = 'DEGRADED';
  
  return {
    timestamp: now.toISOString(),
    uptime: Math.round(uptimeSeconds),
    
    rate: {
      httpRequestsTotal: metricsSummary.httpRequests,
      requestsPerMinute: Math.round(requestsPerMinute),
      wsMessagesPerSecond: wsRates,
    },
    
    errors: {
      httpErrorsTotal: metricsSummary.httpErrors,
      errorRate: Math.round(errorRate * 100) / 100,
      circuitBreakers: circuitSummary,
    },
    
    duration: {
      apiLatency: apiLatencySummary,
      wsLatency: wsLatencySummary,
      eventLoop: {
        status: eventLoop.status,
        avgLagMs: Math.round(eventLoop.avgLagMs * 10) / 10,
        p95LagMs: Math.round(eventLoop.p95LagMs * 10) / 10,
        p99LagMs: Math.round(eventLoop.p99LagMs * 10) / 10,
      },
    },
    
    slos,
    
    health: {
      overall,
      components,
    },
  };
}
