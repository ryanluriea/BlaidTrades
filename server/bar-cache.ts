/**
 * Institutional-Grade Bar Cache Service
 * 
 * Caches historical OHLCV data per symbol to enable efficient parallel backtesting.
 * This is the institutional standard approach:
 * - Fetch data ONCE per symbol from Databento
 * - Cache in memory for all bots to share
 * - Refresh on schedule (not per-backtest)
 * - Enables unlimited concurrent backtests without API rate limits
 * 
 * Benefits:
 * - 100 bots can backtest in parallel using the same cached data
 * - No Databento API rate limiting issues
 * - Massive cost savings (1 API call vs 100)
 * - Sub-second backtest startup (no API wait)
 */

import { fetchDatabentoHistoricalBars, type DatabentoBar } from "./databento-client";
import { logActivityEvent } from "./activity-logger";
import { logIntegrationUsage } from "./integration-usage";
import * as coldStorage from "./bar-cold-storage";
import * as redisBarCache from "./redis-bar-cache";

// Institutional standard: 5 years of historical data for comprehensive backtesting
// Memory tier: 14 days (hot data for fast access, conservative for memory stability)
// Disk tier: 5 years (cold data loaded on demand via SQLite)
// MEMORY FIX: Reduced from 30 days to 14 days to prevent OOM crashes with concurrent backtests
export const WARM_TIER_HISTORY_DAYS = 14; // 14 days in memory (hot) - reduced for memory stability
export const COLD_TIER_HISTORY_DAYS = 1825; // 5 years total (warm + cold)
export const BACKTEST_HISTORY_DAYS = COLD_TIER_HISTORY_DAYS; // Full 5 years for backtests
const DEFAULT_HISTORY_DAYS = WARM_TIER_HISTORY_DAYS; // Default to warm tier
const EXTENDED_HISTORY_DAYS = COLD_TIER_HISTORY_DAYS; // Extended = full 5 years

// MEMORY LIMIT: Maximum bars per symbol in warm cache to prevent OOM
// Reduced to 15,000 for better memory stability in development environment
// 15,000 bars = ~10.4 days of 1-minute bars per symbol
// With 4 symbols = 60,000 bars total = ~6 MB (conservative limit)
// NOTE: Backtests requiring >10 days will automatically fetch from cold storage (SQLite)
// PRODUCTION: With 16GB Reserved VM, this limit can be increased to 50,000
const MAX_WARM_BARS_PER_SYMBOL = process.env.NODE_ENV === 'production' 
  ? 50_000  // ~35 days in production with more memory
  : 15_000; // ~10 days in development for memory stability

// Cache refresh intervals
const CACHE_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes during market hours
const CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes before considered stale

// Supported symbols for caching
const CACHEABLE_SYMBOLS = ["MES", "MNQ", "ES", "NQ"];

// Supported timeframes for pre-aggregation
const CACHEABLE_TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];

interface CachedBarData {
  symbol: string;
  bars: DatabentoBar[];
  startDate: Date;
  endDate: Date;
  barCount: number;
  lastRefresh: Date;
  lastRefreshLatencyMs: number;
  isLoading: boolean;
  loadError: string | null;
  refreshCount: number;
}

interface CacheStats {
  symbol: string;
  barCount: number;
  dateRange: { start: string; end: string };
  lastRefresh: string;
  ageMinutes: number;
  isStale: boolean;
  refreshCount: number;
  memorySizeEstimateMB: number;
}

// In-memory cache storage
const barCache: Map<string, CachedBarData> = new Map();

// Cache refresh locks to prevent concurrent fetches for same symbol
const refreshLocks: Map<string, Promise<void>> = new Map();

/**
 * Initialize the bar cache for a symbol
 */
function initializeCacheEntry(symbol: string): CachedBarData {
  return {
    symbol: symbol.toUpperCase(),
    bars: [],
    startDate: new Date(),
    endDate: new Date(),
    barCount: 0,
    lastRefresh: new Date(0), // Never refreshed
    lastRefreshLatencyMs: 0,
    isLoading: false,
    loadError: null,
    refreshCount: 0,
  };
}

/**
 * Get bars from cache for a symbol
 * Returns cached bars if available and fresh, otherwise triggers refresh
 */
export async function getCachedBars(
  symbol: string,
  traceId: string,
  options?: {
    forceRefresh?: boolean;
    historyDays?: number;
  }
): Promise<DatabentoBar[]> {
  const upperSymbol = symbol.toUpperCase();
  
  // Check if symbol is supported
  if (!CACHEABLE_SYMBOLS.includes(upperSymbol)) {
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} not_cacheable using_direct_fetch`);
    // Fall back to direct fetch for unsupported symbols
    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(endDate.getTime() - (options?.historyDays || DEFAULT_HISTORY_DAYS) * 24 * 60 * 60 * 1000);
    const response = await fetchDatabentoHistoricalBars(upperSymbol, startDate, endDate, "1m", traceId);
    return response.bars;
  }

  // Get or create cache entry
  let cacheEntry = barCache.get(upperSymbol);
  if (!cacheEntry) {
    cacheEntry = initializeCacheEntry(upperSymbol);
    barCache.set(upperSymbol, cacheEntry);
  }

  // Check if cache needs refresh
  const now = new Date();
  const cacheAge = now.getTime() - cacheEntry.lastRefresh.getTime();
  const isStale = cacheAge > CACHE_STALE_THRESHOLD_MS || cacheEntry.barCount === 0;
  const needsRefresh = options?.forceRefresh || isStale;

  if (needsRefresh) {
    // Try cold storage first if warm cache is empty (faster than API)
    if (cacheEntry.barCount === 0 && !options?.forceRefresh) {
      const coldBars = coldStorage.getBars(upperSymbol, "1m");
      if (coldBars.length > 0) {
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} hydrated_from_cold_storage bars=${coldBars.length}`);
        
        // Convert cold bars to DatabentoBar format and populate warm cache
        let convertedBars = coldBars.map(bar => ({
          time: new Date(bar.ts_event),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          symbol: upperSymbol,
        }));
        
        // Enforce memory limit - keep only most recent bars
        if (convertedBars.length > MAX_WARM_BARS_PER_SYMBOL) {
          console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} cold_storage_trimming from=${convertedBars.length} to=${MAX_WARM_BARS_PER_SYMBOL}`);
          convertedBars = convertedBars.slice(-MAX_WARM_BARS_PER_SYMBOL);
        }
        
        // Update cache entry
        cacheEntry.bars = convertedBars;
        cacheEntry.barCount = convertedBars.length;
        cacheEntry.lastRefresh = new Date();
        cacheEntry.startDate = new Date(coldBars[0].ts_event);
        cacheEntry.endDate = new Date(coldBars[coldBars.length - 1].ts_event);
        barCache.set(upperSymbol, cacheEntry);
        
        return convertedBars;
      }
    }
    
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} cache_miss refreshing reason=${
      options?.forceRefresh ? 'forced' : cacheEntry.barCount === 0 ? 'empty' : 'stale'
    }`);
    await refreshCache(upperSymbol, traceId, options?.historyDays);
  } else {
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} cache_hit bars=${cacheEntry.barCount} age_min=${Math.floor(cacheAge / 60000)}`);
  }

  // Return cached bars
  cacheEntry = barCache.get(upperSymbol)!;
  return cacheEntry.bars;
}

/**
 * Refresh cache for a specific symbol
 * Uses a lock to prevent concurrent fetches for the same symbol
 */
export async function refreshCache(
  symbol: string,
  traceId: string,
  historyDays: number = DEFAULT_HISTORY_DAYS
): Promise<void> {
  const upperSymbol = symbol.toUpperCase();

  // Check if already refreshing
  const existingLock = refreshLocks.get(upperSymbol);
  if (existingLock) {
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} waiting_for_existing_refresh`);
    await existingLock;
    return;
  }

  // Create refresh promise
  const refreshPromise = (async () => {
    const cacheEntry = barCache.get(upperSymbol) || initializeCacheEntry(upperSymbol);
    cacheEntry.isLoading = true;
    cacheEntry.loadError = null;
    barCache.set(upperSymbol, cacheEntry);

    const startTime = Date.now();

    try {
      // Calculate date range - institutional standard: 1-2 years of data
      const endDate = new Date();
      endDate.setUTCHours(0, 0, 0, 0);
      const startDate = new Date(endDate.getTime() - historyDays * 24 * 60 * 60 * 1000);

      console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} fetching_bars start=${startDate.toISOString()} end=${endDate.toISOString()} days=${historyDays}`);

      // Fetch from Databento
      const response = await fetchDatabentoHistoricalBars(
        upperSymbol,
        startDate,
        endDate,
        "1m",
        traceId
      );

      const latency = Date.now() - startTime;

      // Update cache entry with memory limit enforcement
      let barsToCache = response.bars;
      if (barsToCache.length > MAX_WARM_BARS_PER_SYMBOL) {
        // Keep only the most recent bars to stay within memory limit
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} trimming_bars from=${barsToCache.length} to=${MAX_WARM_BARS_PER_SYMBOL}`);
        barsToCache = barsToCache.slice(-MAX_WARM_BARS_PER_SYMBOL);
      }
      
      cacheEntry.bars = barsToCache;
      cacheEntry.startDate = startDate;
      cacheEntry.endDate = endDate;
      cacheEntry.barCount = barsToCache.length;
      cacheEntry.lastRefresh = new Date();
      cacheEntry.lastRefreshLatencyMs = latency;
      cacheEntry.isLoading = false;
      cacheEntry.refreshCount++;
      barCache.set(upperSymbol, cacheEntry);

      // Calculate memory size estimate (rough: 100 bytes per bar)
      const memorySizeMB = (response.bars.length * 100) / (1024 * 1024);

      console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} refresh_complete bars=${response.bars.length} latency=${latency}ms memory_mb=${memorySizeMB.toFixed(2)}`);

      await logActivityEvent({
        eventType: "INTEGRATION_PROOF",
        severity: "INFO",
        title: `Bar Cache Refreshed: ${upperSymbol}`,
        summary: `Cached ${response.bars.length.toLocaleString()} bars (${historyDays} days) in ${latency}ms`,
        payload: {
          symbol: upperSymbol,
          barCount: response.bars.length,
          historyDays,
          latencyMs: latency,
          memorySizeMB: memorySizeMB.toFixed(2),
          dateRange: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
        },
        traceId,
      });

    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      cacheEntry.isLoading = false;
      cacheEntry.loadError = errorMessage;
      barCache.set(upperSymbol, cacheEntry);

      console.error(`[BAR_CACHE] trace_id=${traceId} symbol=${upperSymbol} refresh_failed error=${errorMessage} latency=${latency}ms`);

      await logActivityEvent({
        eventType: "INTEGRATION_ERROR",
        severity: "ERROR",
        title: `Bar Cache Refresh Failed: ${upperSymbol}`,
        summary: errorMessage.substring(0, 200),
        payload: { symbol: upperSymbol, error: errorMessage, latencyMs: latency },
        traceId,
      });

      throw error;
    }
  })();

  refreshLocks.set(upperSymbol, refreshPromise);

  try {
    await refreshPromise;
  } finally {
    refreshLocks.delete(upperSymbol);
  }
}

/**
 * Pre-warm the cache for all supported symbols
 * Called on startup to ensure bots can backtest immediately
 * 
 * CACHE HIERARCHY (fastest to slowest):
 * 1. Redis (persistent across restarts, shared across workers)
 * 2. SQLite cold storage (disk-based, 5 years of history)
 * 3. Databento API (remote, rate-limited - last resort)
 */
export async function preWarmCache(traceId: string, historyDays: number = DEFAULT_HISTORY_DAYS): Promise<void> {
  const startTime = Date.now();
  const results: { symbol: string; success: boolean; bars?: number; source?: string; error?: string }[] = [];

  let hydratedFromRedis = 0;
  let hydratedFromCold = 0;
  let needsColdFetch: string[] = [];
  let needsRemoteFetch: string[] = [];

  // FIRST PASS: Try Redis (fastest, survives restarts)
  for (const symbol of CACHEABLE_SYMBOLS) {
    let redisBars = await redisBarCache.getRedisBars(symbol, "1m", traceId);
    
    if (redisBars && redisBars.length > 0) {
      // MEMORY LIMIT: Keep only most recent bars to prevent OOM
      const originalCount = redisBars.length;
      if (redisBars.length > MAX_WARM_BARS_PER_SYMBOL) {
        redisBars = redisBars.slice(-MAX_WARM_BARS_PER_SYMBOL);
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} warm_cache_trimmed from=${originalCount} to=${redisBars.length}`);
      }
      
      const cacheEntry = initializeCacheEntry(symbol);
      cacheEntry.bars = redisBars;
      cacheEntry.barCount = redisBars.length;
      cacheEntry.lastRefresh = new Date();
      cacheEntry.startDate = redisBars[0].time;
      cacheEntry.endDate = redisBars[redisBars.length - 1].time;
      barCache.set(symbol, cacheEntry);
      
      console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} HYDRATED_FROM_REDIS bars=${redisBars.length}`);
      results.push({ symbol, success: true, bars: redisBars.length, source: "redis" });
      hydratedFromRedis++;
    } else {
      needsColdFetch.push(symbol);
    }
  }

  if (hydratedFromRedis > 0) {
    const redisLatency = Date.now() - startTime;
    console.log(`[BAR_CACHE] trace_id=${traceId} REDIS_HYDRATION ${hydratedFromRedis}/${CACHEABLE_SYMBOLS.length} symbols in ${redisLatency}ms`);
  }

  // SECOND PASS: Try SQLite cold storage for symbols not in Redis
  for (const symbol of needsColdFetch) {
    const coldBars = coldStorage.getBars(symbol, "1m");
    
    if (coldBars.length > 0) {
      // Check if cold storage data is recent enough (within 24 hours)
      const newestBarTs = coldBars[coldBars.length - 1].ts_event;
      const ageHours = (Date.now() - newestBarTs) / (1000 * 60 * 60);
      
      // Always hydrate from cold storage first (even if stale) as a fallback
      let convertedBars = coldBars.map(bar => ({
        time: new Date(bar.ts_event),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        symbol: symbol,
      }));
      
      // MEMORY LIMIT: Keep only most recent bars to prevent OOM
      const originalCount = convertedBars.length;
      if (convertedBars.length > MAX_WARM_BARS_PER_SYMBOL) {
        convertedBars = convertedBars.slice(-MAX_WARM_BARS_PER_SYMBOL);
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} warm_cache_trimmed from=${originalCount} to=${convertedBars.length}`);
      }
      
      const cacheEntry = initializeCacheEntry(symbol);
      cacheEntry.bars = convertedBars;
      cacheEntry.barCount = convertedBars.length;
      cacheEntry.lastRefresh = new Date();
      cacheEntry.startDate = new Date(coldBars[0].ts_event);
      cacheEntry.endDate = new Date(coldBars[coldBars.length - 1].ts_event);
      barCache.set(symbol, cacheEntry);
      
      if (ageHours < 24) {
        // Fresh enough - use as-is
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} HYDRATED_FROM_COLD_STORAGE bars=${convertedBars.length} age_hours=${ageHours.toFixed(1)}`);
        results.push({ symbol, success: true, bars: convertedBars.length, source: "cold_storage" });
        hydratedFromCold++;
        
        // Persist to Redis for faster next restart (non-blocking)
        redisBarCache.setRedisBars(symbol, convertedBars, "1m", traceId).catch(() => {});
      } else {
        // Stale - hydrated as fallback, but queue refresh to get fresh data
        console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} HYDRATED_STALE_FALLBACK bars=${convertedBars.length} age_hours=${ageHours.toFixed(1)} queuing_refresh`);
        results.push({ symbol, success: true, bars: convertedBars.length, source: "cold_storage_stale" });
        hydratedFromCold++;
        needsRemoteFetch.push(symbol); // Also queue refresh
      }
    } else {
      // No cold storage data
      console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} cold_storage_empty needs_fetch`);
      needsRemoteFetch.push(symbol);
    }
  }

  // Log instant hydration if any symbols loaded from cold storage
  if (hydratedFromCold > 0) {
    const coldLatency = Date.now() - startTime;
    console.log(`[BAR_CACHE] trace_id=${traceId} COLD_STORAGE_HYDRATION ${hydratedFromCold}/${needsColdFetch.length} symbols in ${coldLatency}ms`);
  }

  // THIRD PASS: Fetch remaining symbols from Databento (only if needed)
  if (needsRemoteFetch.length > 0) {
    console.log(`[BAR_CACHE] trace_id=${traceId} FETCHING_FROM_DATABENTO symbols=${needsRemoteFetch.join(',')} history_days=${historyDays}`);
    
    await Promise.all(
      needsRemoteFetch.map(async (symbol) => {
        try {
          await refreshCache(symbol, traceId, historyDays);
          const entry = barCache.get(symbol);
          results.push({ symbol, success: true, bars: entry?.barCount || 0, source: "databento" });
          
          // Persist to cold storage for next restart
          await persistToColdStorage(symbol, traceId);
          
          // Also persist to Redis for faster subsequent restarts
          if (entry?.bars) {
            await redisBarCache.setRedisBars(symbol, entry.bars, "1m", traceId);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({ symbol, success: false, error: errorMessage });
        }
      })
    );
  }

  const totalLatency = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;
  const totalBars = results.reduce((sum, r) => sum + (r.bars || 0), 0);
  const fromRedisCount = results.filter(r => r.source === "redis").length;
  const fromColdCount = results.filter(r => r.source === "cold_storage" || r.source === "cold_storage_stale").length;
  const fromRemoteCount = results.filter(r => r.source === "databento").length;

  console.log(`[BAR_CACHE] trace_id=${traceId} pre_warm_complete success=${successCount}/${CACHEABLE_SYMBOLS.length} total_bars=${totalBars} from_redis=${fromRedisCount} from_cold=${fromColdCount} from_remote=${fromRemoteCount} latency=${totalLatency}ms`);

  // Determine summary message based on source priority
  let summaryMessage: string;
  if (fromRedisCount === CACHEABLE_SYMBOLS.length) {
    summaryMessage = `Instant Redis hydration: ${totalBars.toLocaleString()} bars in ${totalLatency}ms`;
  } else if (fromRedisCount + fromColdCount === CACHEABLE_SYMBOLS.length) {
    summaryMessage = `Loaded ${totalBars.toLocaleString()} bars (${fromRedisCount} from Redis, ${fromColdCount} from disk) in ${totalLatency}ms`;
  } else {
    summaryMessage = `Loaded ${totalBars.toLocaleString()} bars (${fromRedisCount} Redis, ${fromColdCount} disk, ${fromRemoteCount} API) in ${(totalLatency / 1000).toFixed(1)}s`;
  }

  await logActivityEvent({
    eventType: "INTEGRATION_PROOF",
    severity: successCount === CACHEABLE_SYMBOLS.length ? "INFO" : "WARN",
    title: "Bar Cache Ready",
    summary: summaryMessage,
    payload: { results, totalLatency, historyDays, fromRedis: fromRedisCount, fromCold: fromColdCount, fromRemote: fromRemoteCount },
    traceId,
  });

  // Log verification event for System Health panel
  // Only mark as verified when ALL symbols are successfully warmed
  if (successCount === CACHEABLE_SYMBOLS.length && totalBars > 0) {
    await logIntegrationUsage({
      provider: "databento",
      operation: "verify",
      status: "OK",
      traceId,
      latencyMs: totalLatency,
      metadata: { 
        source: fromRedisCount === CACHEABLE_SYMBOLS.length ? "redis_hydration" 
          : fromColdCount === CACHEABLE_SYMBOLS.length ? "cold_storage_hydration" 
          : "bar_cache_warmup",
        symbolsLoaded: successCount,
        totalBars,
        fromRedis: fromRedisCount,
        fromCold: fromColdCount,
        fromRemote: fromRemoteCount,
      },
    });
    const hydrationSource = fromRedisCount === CACHEABLE_SYMBOLS.length ? 'Redis' 
      : fromColdCount === CACHEABLE_SYMBOLS.length ? 'cold storage' : 'API fetch';
    console.log(`[BAR_CACHE] trace_id=${traceId} DATABENTO_VERIFIED via ${hydrationSource}`);
  } else if (successCount > 0 && successCount < CACHEABLE_SYMBOLS.length) {
    // Log degraded status when only partial success
    await logIntegrationUsage({
      provider: "databento",
      operation: "verify",
      status: "ERROR",
      traceId,
      latencyMs: totalLatency,
      metadata: { 
        source: "bar_cache_warmup",
        symbolsLoaded: successCount,
        symbolsExpected: CACHEABLE_SYMBOLS.length,
        totalBars,
        reason: "partial_warmup_failure",
      },
    });
    console.log(`[BAR_CACHE] trace_id=${traceId} DATABENTO_PARTIAL_FAILURE ${successCount}/${CACHEABLE_SYMBOLS.length} symbols`);
  }
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats(): CacheStats[] {
  const stats: CacheStats[] = [];
  const now = new Date();

  for (const [symbol, entry] of barCache.entries()) {
    const ageMs = now.getTime() - entry.lastRefresh.getTime();
    const memorySizeMB = (entry.barCount * 100) / (1024 * 1024);

    stats.push({
      symbol,
      barCount: entry.barCount,
      dateRange: {
        start: entry.startDate.toISOString(),
        end: entry.endDate.toISOString(),
      },
      lastRefresh: entry.lastRefresh.toISOString(),
      ageMinutes: Math.floor(ageMs / 60000),
      isStale: ageMs > CACHE_STALE_THRESHOLD_MS,
      refreshCount: entry.refreshCount,
      memorySizeEstimateMB: parseFloat(memorySizeMB.toFixed(2)),
    });
  }

  return stats;
}

/**
 * Check if cache is ready for a symbol
 */
export function isCacheReady(symbol: string): boolean {
  const entry = barCache.get(symbol.toUpperCase());
  return entry !== undefined && entry.barCount > 0 && !entry.isLoading;
}

/**
 * Get cache entry directly (for advanced use cases)
 */
export function getCacheEntry(symbol: string): CachedBarData | undefined {
  return barCache.get(symbol.toUpperCase());
}

/**
 * Clear cache for a symbol (useful for testing or forced refresh)
 */
export function clearCache(symbol?: string): void {
  if (symbol) {
    barCache.delete(symbol.toUpperCase());
  } else {
    barCache.clear();
  }
}

/**
 * Get total memory usage estimate across all cached symbols
 */
export function getTotalMemoryUsageMB(): number {
  let totalBars = 0;
  for (const entry of barCache.values()) {
    totalBars += entry.barCount;
  }
  return (totalBars * 100) / (1024 * 1024);
}

/**
 * AUTONOMOUS MEMORY RECOVERY: Trim cache to reduce memory pressure
 * Called by Memory Sentinel when sustained pressure is detected
 * Reduces each symbol to 5,000 bars (minimal working set)
 */
export function trimCacheForMemoryPressure(): { symbolsTrimmed: number; barsEvicted: number } {
  const EMERGENCY_BARS_PER_SYMBOL = 5_000; // Minimal working set
  let symbolsTrimmed = 0;
  let barsEvicted = 0;
  
  for (const [symbol, entry] of barCache.entries()) {
    if (entry.barCount > EMERGENCY_BARS_PER_SYMBOL) {
      const evictCount = entry.barCount - EMERGENCY_BARS_PER_SYMBOL;
      // Keep only the most recent bars
      entry.bars = entry.bars.slice(-EMERGENCY_BARS_PER_SYMBOL);
      entry.barCount = entry.bars.length;
      if (entry.bars.length > 0) {
        entry.startDate = entry.bars[0].time;
      }
      barsEvicted += evictCount;
      symbolsTrimmed++;
      console.log(`[BAR_CACHE] MEMORY_PRESSURE_TRIM symbol=${symbol} evicted=${evictCount} remaining=${entry.barCount}`);
    }
  }
  
  // Force garbage collection hint
  if (global.gc) {
    global.gc();
    console.log(`[BAR_CACHE] MEMORY_PRESSURE_TRIM gc_triggered`);
  }
  
  console.log(`[BAR_CACHE] MEMORY_PRESSURE_TRIM complete symbols=${symbolsTrimmed} bars_evicted=${barsEvicted}`);
  return { symbolsTrimmed, barsEvicted };
}

// Export constants for external use
export const BAR_CACHE_CONFIG = {
  WARM_TIER_HISTORY_DAYS,
  COLD_TIER_HISTORY_DAYS,
  BACKTEST_HISTORY_DAYS,
  DEFAULT_HISTORY_DAYS,
  EXTENDED_HISTORY_DAYS,
  CACHE_REFRESH_INTERVAL_MS,
  CACHE_STALE_THRESHOLD_MS,
  CACHEABLE_SYMBOLS,
  CACHEABLE_TIMEFRAMES,
};

// Timeframe multipliers for aggregation (relative to 1m base)
const TIMEFRAME_MULTIPLIERS: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/**
 * Persist warm cache bars to cold storage for long-term archival
 */
export async function persistToColdStorage(symbol: string, traceId: string): Promise<number> {
  const entry = barCache.get(symbol.toUpperCase());
  if (!entry || entry.barCount === 0) {
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} no_bars_to_persist`);
    return 0;
  }

  const coldBars = entry.bars.map(bar => ({
    ts_event: bar.time.getTime(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));

  const storedCount = coldStorage.storeBars(symbol.toUpperCase(), "1m", coldBars);
  console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} persisted_to_cold_storage bars=${storedCount}`);
  return storedCount;
}

/**
 * Load bars from cold storage if warm cache is empty
 */
export async function loadFromColdStorage(
  symbol: string,
  traceId: string,
  startTs?: number,
  endTs?: number
): Promise<DatabentoBar[]> {
  const coldBars = coldStorage.getBars(symbol.toUpperCase(), "1m", startTs, endTs);
  
  if (coldBars.length === 0) {
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} cold_storage_empty`);
    return [];
  }

  console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} loaded_from_cold_storage bars=${coldBars.length}`);
  
  return coldBars.map(bar => ({
    time: new Date(bar.ts_event),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    symbol: symbol.toUpperCase(),
  }));
}

/**
 * Aggregate 1m bars into higher timeframes
 */
export function aggregateBarsToTimeframe(
  bars: DatabentoBar[],
  targetTimeframe: string
): DatabentoBar[] {
  const multiplier = TIMEFRAME_MULTIPLIERS[targetTimeframe];
  if (!multiplier || multiplier === 1) {
    return bars;
  }

  if (bars.length < multiplier) {
    return [];
  }

  const aggregated: DatabentoBar[] = [];
  
  for (let i = 0; i <= bars.length - multiplier; i += multiplier) {
    const chunk = bars.slice(i, i + multiplier);
    if (chunk.length === multiplier) {
      aggregated.push({
        ...chunk[0],
        open: chunk[0].open,
        high: Math.max(...chunk.map(b => b.high)),
        low: Math.min(...chunk.map(b => b.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((sum, b) => sum + b.volume, 0),
      });
    }
  }

  return aggregated;
}

/**
 * Get cached bars with optional timeframe aggregation
 * Supports: 1m, 5m, 15m, 1h, 4h, 1d
 */
export async function getCachedBarsWithTimeframe(
  symbol: string,
  timeframe: string,
  traceId: string,
  options?: {
    forceRefresh?: boolean;
    historyDays?: number;
    startTs?: number;
    endTs?: number;
  }
): Promise<DatabentoBar[]> {
  // Get base 1m bars
  let bars = await getCachedBars(symbol, traceId, {
    forceRefresh: options?.forceRefresh,
    historyDays: options?.historyDays,
  });

  // Filter by time range if specified
  if (options?.startTs || options?.endTs) {
    bars = bars.filter(bar => {
      const barTs = bar.time.getTime();
      if (options.startTs && barTs < options.startTs) return false;
      if (options.endTs && barTs > options.endTs) return false;
      return true;
    });
  }

  // Aggregate if needed
  if (timeframe !== "1m") {
    const aggregatedBars = aggregateBarsToTimeframe(bars, timeframe);
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} aggregated_to_${timeframe} input=${bars.length} output=${aggregatedBars.length}`);
    return aggregatedBars;
  }

  return bars;
}

/**
 * Get extended history from cold storage with optional timeframe
 * Use this for backtests requiring more than 2 years of data
 */
export async function getExtendedHistoryBars(
  symbol: string,
  timeframe: string,
  traceId: string,
  options?: {
    startTs?: number;
    endTs?: number;
  }
): Promise<DatabentoBar[]> {
  // First try warm cache
  const warmEntry = barCache.get(symbol.toUpperCase());
  if (warmEntry && warmEntry.barCount > 0) {
    let bars = warmEntry.bars;
    
    // Filter by range
    if (options?.startTs || options?.endTs) {
      bars = bars.filter(bar => {
        const barTs = bar.time.getTime();
        if (options.startTs && barTs < options.startTs) return false;
        if (options.endTs && barTs > options.endTs) return false;
        return true;
      });
    }
    
    // Aggregate if needed
    if (timeframe !== "1m") {
      return aggregateBarsToTimeframe(bars, timeframe);
    }
    return bars;
  }

  // Fall back to cold storage
  const coldBars = await loadFromColdStorage(symbol, traceId, options?.startTs, options?.endTs);
  
  if (timeframe !== "1m") {
    return aggregateBarsToTimeframe(coldBars, timeframe);
  }
  
  return coldBars;
}

/**
 * Get cold storage statistics
 */
export function getColdStorageStats() {
  return coldStorage.getStorageStats();
}

/**
 * Get cold storage summary with accurate file size
 */
export function getColdStorageSummary() {
  return coldStorage.getStorageSummary();
}

/**
 * Persist all warm cache data to cold storage
 */
export async function persistAllToColdStorage(traceId: string): Promise<{ symbol: string; count: number }[]> {
  const results: { symbol: string; count: number }[] = [];
  
  for (const symbol of CACHEABLE_SYMBOLS) {
    const count = await persistToColdStorage(symbol, traceId);
    results.push({ symbol, count });
  }
  
  console.log(`[BAR_CACHE] trace_id=${traceId} persisted_all_to_cold_storage total_bars=${results.reduce((s, r) => s + r.count, 0)}`);
  return results;
}

/**
 * Pre-aggregate and store higher timeframes in cold storage
 */
export async function preAggregateColdTimeframes(symbol: string, traceId: string): Promise<void> {
  const timeframesToAggregate = ["5m", "15m", "1h", "1d"];
  
  for (const tf of timeframesToAggregate) {
    const multiplier = TIMEFRAME_MULTIPLIERS[tf];
    const aggregatedCount = coldStorage.aggregateBars(
      symbol.toUpperCase(),
      "1m",
      tf,
      multiplier
    );
    console.log(`[BAR_CACHE] trace_id=${traceId} symbol=${symbol} pre_aggregated tf=${tf} bars=${aggregatedCount}`);
  }
}
