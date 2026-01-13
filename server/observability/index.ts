/**
 * Observability Infrastructure Index
 * 
 * Exports all observability modules for easy integration.
 */

import { startMetricsLogging, stopMetricsLogging } from './metrics';
import { latencyTracker, startLatencyLogging, stopLatencyLogging } from './latency-tracker';
import { startEventLoopMonitoring, stopEventLoopMonitoring } from './event-loop-monitor';
import { startWSTracking, stopWSTracking } from './websocket-tracker';
import { startLeakDetection, stopLeakDetection } from './memory-leak-detector';
import { startDRTracking, stopDRTracking } from './disaster-recovery';

export { metricsRegistry, metricsMiddleware, metricsHandler, startMetricsLogging, stopMetricsLogging, logMetricsSummary } from './metrics';
export { latencyTracker, latencyMiddleware, startLatencyLogging, stopLatencyLogging } from './latency-tracker';
export { eventLoopMonitor, startEventLoopMonitoring, stopEventLoopMonitoring } from './event-loop-monitor';
export { wsTracker, startWSTracking, stopWSTracking } from './websocket-tracker';
export { memoryLeakDetector, startLeakDetection, stopLeakDetection } from './memory-leak-detector';
export { drTracker, startDRTracking, stopDRTracking } from './disaster-recovery';
export { getREDMetrics } from './red-dashboard';

/**
 * Initialize all observability systems
 */
export function initializeObservability(): void {
  startMetricsLogging(60000);      // Log metrics every 60s
  startLatencyLogging(60000);      // Log latency percentiles every 60s
  startEventLoopMonitoring(60000); // Log event loop stats every 60s
  startWSTracking(60000);          // Log WS stats every 60s
  startLeakDetection(60000);       // Log memory leak stats every 60s
  startDRTracking(300000);         // Log DR status every 5 min
  
  console.log('[OBSERVABILITY] Institutional-grade monitoring initialized');
  console.log('[OBSERVABILITY] - Latency percentiles (P50/P95/P99)');
  console.log('[OBSERVABILITY] - Event loop lag monitoring');
  console.log('[OBSERVABILITY] - WebSocket message tracking');
  console.log('[OBSERVABILITY] - Memory leak detection');
  console.log('[OBSERVABILITY] - RED metrics dashboard');
  console.log('[OBSERVABILITY] - SLO compliance tracking');
  console.log('[OBSERVABILITY] - Disaster recovery tracking');
}

/**
 * Shutdown all observability systems
 */
export function shutdownObservability(): void {
  stopMetricsLogging();
  stopLatencyLogging();
  stopEventLoopMonitoring();
  stopWSTracking();
  stopLeakDetection();
  stopDRTracking();
  latencyTracker.shutdown();
  
  console.log('[OBSERVABILITY] Monitoring shutdown complete');
}
