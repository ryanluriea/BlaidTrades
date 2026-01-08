/**
 * Memory Sentinel - Observability and Load Shedding
 * 
 * This module provides:
 * - Memory sampling every 10 seconds (heapUsed, heapTotal, rss, external, arrayBuffers)
 * - Event loop delay monitoring
 * - Load shedding when memory exceeds threshold (80%)
 * - Structured logging for observability
 * - API endpoints for memory status
 * 
 * LOAD SHEDDING:
 * When heapUsed/heapTotal > 0.80, heavy endpoints return 503 MEMORY_PRESSURE:
 * - /api/backtest/*
 * - /api/training/*
 * - /api/bars/bulk/*
 * 
 * This prevents OOM crashes and allows the system to recover gracefully.
 */

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export interface MemorySample {
  timestamp: string;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapUsedPercent: number;
  eventLoopDelayMs: number;
  gcPaused: boolean;
}

export interface MemoryStats {
  current: MemorySample;
  peak: MemorySample;
  samples: MemorySample[];
  avgHeapPercent: number;
  isUnderPressure: boolean;
  loadSheddingActive: boolean;
  uptime: number;
  sampleCount: number;
}

const SAMPLE_INTERVAL_MS = 5000;
const MAX_SAMPLES = 360;
const PRESSURE_THRESHOLD = 0.75;
const SEVERE_PRESSURE_THRESHOLD = 0.82;
const CRITICAL_PRESSURE_THRESHOLD = 0.88;
const EMERGENCY_PRESSURE_THRESHOLD = 0.92;
const RECOVERY_THRESHOLD = 0.65;

// MAX_HEAP_SIZE_MB: Use NODE_OPTIONS max-old-space-size or default to 4096MB
// This prevents false pressure alerts when V8 heap is dynamically growing
const MAX_HEAP_SIZE_MB = (() => {
  const nodeOptions = process.env.NODE_OPTIONS || '';
  const match = nodeOptions.match(/--max-old-space-size=(\d+)/);
  return match ? parseInt(match[1], 10) : 4096; // Default 4GB if not set
})();
const MAX_HEAP_SIZE_BYTES = MAX_HEAP_SIZE_MB * 1024 * 1024;

// AUTONOMOUS LOAD SHEDDING: Pause workers after sustained pressure
const PRESSURE_PERSIST_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes of sustained pressure

const HEAVY_ENDPOINTS = [
  "/api/backtest",
  "/api/training",
  "/api/bars/bulk",
  "/api/evolution",
  "/api/stress-test",
];

const EXEMPT_ENDPOINTS = [
  "/ops/",
  "/api/health",
  "/api/integrations/status",
  "/ws/",
];

let samples: MemorySample[] = [];
let peakSample: MemorySample | null = null;
let loadSheddingActive = false;
let sampleInterval: NodeJS.Timeout | null = null;
let lastEventLoopCheck = Date.now();
let eventLoopDelay = 0;
let blockedRequestCount = 0;

// AUTONOMOUS LOAD SHEDDING: Track pressure duration for worker pausing
let pressureStartedAt: Date | null = null;
let workersCurrentlyPaused = false;
let lastEvictionTime = 0;
let evictionCooldownMs = 30000;
let consecutiveEvictions = 0;

// Scheduler integration - dynamically imported to avoid circular dependencies
let schedulerPauseHeavyWorkers: (() => void) | null = null;
let schedulerResumeHeavyWorkers: (() => void) | null = null;
let cacheEvictionCallback: (() => { symbolsTrimmed: number; barsEvicted: number }) | null = null;

/**
 * Register scheduler functions for memory-based worker control
 * Called from server initialization to avoid circular imports
 */
export function registerSchedulerCallbacks(
  pauseFn: () => void,
  resumeFn: () => void
): void {
  schedulerPauseHeavyWorkers = pauseFn;
  schedulerResumeHeavyWorkers = resumeFn;
  console.log("[MEMORY_SENTINEL] Scheduler callbacks registered for autonomous load shedding");
}

/**
 * Register cache eviction callback for active memory recovery
 * Called from server initialization after bar cache is loaded
 */
export function registerCacheEvictionCallback(
  evictFn: () => { symbolsTrimmed: number; barsEvicted: number }
): void {
  cacheEvictionCallback = evictFn;
  console.log("[MEMORY_SENTINEL] Cache eviction callback registered for active memory recovery");
}

const INSTANCE_ID = process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_ID || crypto.randomUUID().slice(0, 8);

function measureEventLoopDelay(): void {
  const now = Date.now();
  const elapsed = now - lastEventLoopCheck;
  const expectedElapsed = SAMPLE_INTERVAL_MS;
  eventLoopDelay = Math.max(0, elapsed - expectedElapsed);
  lastEventLoopCheck = now;
}

function takeSample(): MemorySample {
  const mem = process.memoryUsage();
  measureEventLoopDelay();
  
  // Use MAX_HEAP_SIZE_BYTES for percentage calculation instead of dynamic heapTotal
  // This prevents false "severe pressure" alerts when V8 heap is growing normally
  const heapUsedPercent = mem.heapUsed / MAX_HEAP_SIZE_BYTES;
  
  const sample: MemorySample = {
    timestamp: new Date().toISOString(),
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    heapUsedPercent,
    eventLoopDelayMs: eventLoopDelay,
    gcPaused: false,
  };

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(-MAX_SAMPLES);
  }

  if (!peakSample || sample.heapUsed > peakSample.heapUsed) {
    peakSample = { ...sample };
  }

  const wasUnderPressure = loadSheddingActive;
  
  if (sample.heapUsedPercent >= PRESSURE_THRESHOLD) {
    loadSheddingActive = true;
  } else if (sample.heapUsedPercent <= RECOVERY_THRESHOLD) {
    loadSheddingActive = false;
  }

  if (loadSheddingActive !== wasUnderPressure) {
    console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} load_shedding=${loadSheddingActive ? "ACTIVATED" : "DEACTIVATED"} heap_percent=${(sample.heapUsedPercent * 100).toFixed(1)}%`);
  }

  const now = Date.now();
  const canEvict = cacheEvictionCallback && (now - lastEvictionTime) > evictionCooldownMs;
  
  if (sample.heapUsedPercent >= EMERGENCY_PRESSURE_THRESHOLD) {
    console.error(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} EMERGENCY_PRESSURE heap_percent=${(sample.heapUsedPercent * 100).toFixed(1)}% - forcing aggressive eviction and GC`);
    
    if (cacheEvictionCallback) {
      for (let i = 0; i < 3; i++) {
        const result = cacheEvictionCallback();
        console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} EMERGENCY_EVICTION_${i + 1} symbols=${result.symbolsTrimmed} bars=${result.barsEvicted}`);
        if (result.barsEvicted === 0) break;
      }
      lastEvictionTime = now;
      consecutiveEvictions++;
    }
    
    if (typeof global.gc === 'function') {
      console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} forcing garbage collection`);
      global.gc();
    }
    
    if (schedulerPauseHeavyWorkers && !workersCurrentlyPaused) {
      schedulerPauseHeavyWorkers();
      workersCurrentlyPaused = true;
    }
  } else if (sample.heapUsedPercent >= CRITICAL_PRESSURE_THRESHOLD) {
    console.warn(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} CRITICAL_PRESSURE heap_percent=${(sample.heapUsedPercent * 100).toFixed(1)}% heap_used_mb=${(sample.heapUsed / 1024 / 1024).toFixed(1)}`);
    
    if (canEvict) {
      for (let i = 0; i < 2; i++) {
        const result = cacheEvictionCallback!();
        console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} CRITICAL_EVICTION_${i + 1} symbols=${result.symbolsTrimmed} bars=${result.barsEvicted}`);
        if (result.barsEvicted === 0) break;
      }
      lastEvictionTime = now;
      consecutiveEvictions++;
      evictionCooldownMs = Math.max(5000, evictionCooldownMs - 5000);
    }
    
    if (schedulerPauseHeavyWorkers && !workersCurrentlyPaused) {
      schedulerPauseHeavyWorkers();
      workersCurrentlyPaused = true;
    }
  } else if (sample.heapUsedPercent >= SEVERE_PRESSURE_THRESHOLD) {
    console.warn(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} SEVERE_PRESSURE heap_percent=${(sample.heapUsedPercent * 100).toFixed(1)}% heap_used_mb=${(sample.heapUsed / 1024 / 1024).toFixed(1)} rss_mb=${(sample.rss / 1024 / 1024).toFixed(1)}`);
    
    if (canEvict) {
      const result = cacheEvictionCallback!();
      console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} SEVERE_EVICTION symbols=${result.symbolsTrimmed} bars=${result.barsEvicted}`);
      lastEvictionTime = now;
      consecutiveEvictions++;
    }
  }
  
  // AUTONOMOUS LOAD SHEDDING: Track sustained pressure and pause workers if needed
  if (loadSheddingActive) {
    if (!pressureStartedAt) {
      pressureStartedAt = new Date();
    }
    
    const pressureDurationMs = Date.now() - pressureStartedAt.getTime();
    
    if (pressureDurationMs >= PRESSURE_PERSIST_THRESHOLD_MS && !workersCurrentlyPaused && schedulerPauseHeavyWorkers) {
      console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} SUSTAINED_PRESSURE duration=${Math.round(pressureDurationMs / 1000)}s, pausing heavy workers`);
      schedulerPauseHeavyWorkers();
      workersCurrentlyPaused = true;
    }
  } else {
    pressureStartedAt = null;
    consecutiveEvictions = 0;
    evictionCooldownMs = 30000;
    
    if (workersCurrentlyPaused && schedulerResumeHeavyWorkers) {
      console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} PRESSURE_RELIEVED, resuming heavy workers`);
      schedulerResumeHeavyWorkers();
      workersCurrentlyPaused = false;
    }
  }

  return sample;
}

/**
 * Start memory sampling
 */
export function startMemorySentinel(): void {
  if (sampleInterval) {
    return;
  }

  console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} starting sample_interval=${SAMPLE_INTERVAL_MS}ms pressure_threshold=${PRESSURE_THRESHOLD * 100}% max_heap_mb=${MAX_HEAP_SIZE_MB}`);
  
  takeSample();
  
  sampleInterval = setInterval(() => {
    try {
      takeSample();
    } catch (err) {
      console.error(`[MEMORY_SENTINEL] sample_error:`, err);
    }
  }, SAMPLE_INTERVAL_MS);
}

/**
 * Stop memory sampling
 */
export function stopMemorySentinel(): void {
  if (sampleInterval) {
    clearInterval(sampleInterval);
    sampleInterval = null;
    console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} stopped`);
  }
}

/**
 * Get current memory statistics
 */
export function getMemoryStats(): MemoryStats {
  const current = samples.length > 0 ? samples[samples.length - 1] : takeSample();
  
  const avgHeapPercent = samples.length > 0
    ? samples.reduce((sum, s) => sum + s.heapUsedPercent, 0) / samples.length
    : current.heapUsedPercent;

  return {
    current,
    peak: peakSample || current,
    samples: samples.slice(-60),
    avgHeapPercent,
    isUnderPressure: current.heapUsedPercent >= PRESSURE_THRESHOLD,
    loadSheddingActive,
    uptime: process.uptime(),
    sampleCount: samples.length,
  };
}

/**
 * Check if load shedding is active
 */
export function isLoadSheddingActive(): boolean {
  return loadSheddingActive;
}

/**
 * Get blocked request count
 */
export function getBlockedRequestCount(): number {
  return blockedRequestCount;
}

/**
 * Express middleware for load shedding
 * Returns 503 for heavy endpoints when memory pressure is detected
 * Exempt endpoints (ops, health) are always allowed through for operator access
 */
export function loadSheddingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!loadSheddingActive) {
    return next();
  }

  const path = req.path.toLowerCase();
  
  const isExempt = EXEMPT_ENDPOINTS.some(ep => path.startsWith(ep.toLowerCase()));
  if (isExempt) {
    return next();
  }
  
  const isHeavyEndpoint = HEAVY_ENDPOINTS.some(ep => path.startsWith(ep.toLowerCase()));

  if (isHeavyEndpoint) {
    blockedRequestCount++;
    const stats = getMemoryStats();
    
    console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} load_shed_blocked path=${req.path} heap_percent=${(stats.current.heapUsedPercent * 100).toFixed(1)}%`);
    
    res.status(503).json({
      success: false,
      error: "MEMORY_PRESSURE",
      message: "Server is under memory pressure. Please try again later.",
      retryAfter: 30,
      details: {
        heapUsedPercent: Math.round(stats.current.heapUsedPercent * 100),
        loadSheddingActive: true,
        instanceId: INSTANCE_ID,
      },
    });
    return;
  }

  next();
}

/**
 * Get memory trend analysis
 */
export function getMemoryTrend(): {
  slope: number;
  isMonotonicGrowth: boolean;
  trendDescription: string;
} {
  if (samples.length < 10) {
    return {
      slope: 0,
      isMonotonicGrowth: false,
      trendDescription: "INSUFFICIENT_DATA",
    };
  }

  const recentSamples = samples.slice(-60);
  const n = recentSamples.length;
  
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += recentSamples[i].heapUsedPercent;
    sumXY += i * recentSamples[i].heapUsedPercent;
    sumX2 += i * i;
  }
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  
  let increasingCount = 0;
  for (let i = 1; i < recentSamples.length; i++) {
    if (recentSamples[i].heapUsedPercent > recentSamples[i - 1].heapUsedPercent) {
      increasingCount++;
    }
  }
  
  const isMonotonicGrowth = increasingCount > (recentSamples.length * 0.7);
  
  let trendDescription = "STABLE";
  if (slope > 0.001) {
    trendDescription = isMonotonicGrowth ? "MONOTONIC_GROWTH" : "GROWING";
  } else if (slope < -0.001) {
    trendDescription = "DECLINING";
  }

  return {
    slope,
    isMonotonicGrowth,
    trendDescription,
  };
}

/**
 * Force garbage collection if available (requires --expose-gc flag)
 */
export function forceGC(): boolean {
  if (global.gc) {
    console.log(`[MEMORY_SENTINEL] instance=${INSTANCE_ID} forcing_gc`);
    global.gc();
    return true;
  }
  return false;
}

/**
 * Get instance ID for autoscale tracking
 */
export function getInstanceId(): string {
  return INSTANCE_ID;
}

/**
 * Reset peak sample (useful after recovery)
 */
export function resetPeakSample(): void {
  if (samples.length > 0) {
    peakSample = { ...samples[samples.length - 1] };
  }
}

export function getMemorySentinelStatus(): {
  running: boolean;
  instanceId: string;
  sampleCount: number;
  loadSheddingActive: boolean;
  blockedRequests: number;
} {
  return {
    running: sampleInterval !== null,
    instanceId: INSTANCE_ID,
    sampleCount: samples.length,
    loadSheddingActive,
    blockedRequests: blockedRequestCount,
  };
}
