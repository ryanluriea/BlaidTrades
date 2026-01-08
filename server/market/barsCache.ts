/**
 * Shared Redis Bars Cache for Autoscale
 * 
 * This module provides a Redis-backed cache for historical bar data that:
 * - Shares cached bars across all autoscale instances (no duplication)
 * - Uses stampede protection (Redis locks) to prevent duplicate API calls
 * - Compresses data with gzip for efficient Redis memory usage
 * - Provides observability via Redis counters for hits/misses
 * 
 * CACHE KEY FORMAT:
 * bars:{symbol}:{tf}:{sessionMode}:{startTs}:{endTs}
 * 
 * For very long ranges, we hash the key to keep it under Redis key limits:
 * bars:{symbol}:{tf}:{sessionMode}:{hash}
 */

import { getRedisClient, isRedisConfigured } from "../redis";
import { fetchDatabentoHistoricalBars, type DatabentoBar } from "../databento-client";
import { logIntegrationUsage } from "../integration-usage";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import crypto from "crypto";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface BarsCacheParams {
  symbol: string;
  timeframe: string;
  sessionMode: "RTH" | "ETH" | "ALL";
  startTs: number;
  endTs: number;
  provider?: "databento";
}

export interface BarsCacheResult {
  bars: DatabentoBar[];
  cacheHit: boolean;
  lockAcquired: boolean;
  providerFetch: boolean;
  bytesIn: number;
  bytesOut: number;
  durationMs: number;
  instanceId: string;
}

export interface BarsCacheStats {
  hits: number;
  misses: number;
  sets: number;
  bytes: number;
  lockWaits: number;
  providerFetches: number;
  stampedesPrevented: number;
  stampedeFallbacks: number;
  lockTimeoutFallbacks: number;
}

const CACHE_PREFIX = "bars:v2:";
const LOCK_PREFIX = "lock:bars:";
const PENDING_PREFIX = "pending:bars:";
const STATS_PREFIX = "barstats:";
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const LOCK_TTL_MS = 120000;
const LOCK_RENEWAL_INTERVAL_MS = 30000;
const PENDING_TTL_SECONDS = 180;

const INSTANCE_ID = process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT_ID || crypto.randomUUID().slice(0, 8);

function buildCacheKey(params: BarsCacheParams): string {
  const { symbol, timeframe, sessionMode, startTs, endTs } = params;
  const baseKey = `${CACHE_PREFIX}${symbol.toUpperCase()}:${timeframe}:${sessionMode}`;
  const rangeKey = `${startTs}:${endTs}`;
  
  if (rangeKey.length > 100) {
    const hash = crypto.createHash("md5").update(rangeKey).digest("hex").slice(0, 16);
    return `${baseKey}:h${hash}`;
  }
  
  return `${baseKey}:${rangeKey}`;
}

function buildLockKey(cacheKey: string): string {
  return `${LOCK_PREFIX}${cacheKey.replace(CACHE_PREFIX, "")}`;
}

function buildPendingKey(cacheKey: string): string {
  return `${PENDING_PREFIX}${cacheKey.replace(CACHE_PREFIX, "")}`;
}

async function acquireLock(client: any, lockKey: string, traceId: string): Promise<boolean> {
  const result = await client.set(lockKey, `${INSTANCE_ID}:${traceId}`, {
    NX: true,
    PX: LOCK_TTL_MS,
  });
  return result === "OK";
}

async function renewLock(client: any, lockKey: string): Promise<boolean> {
  try {
    const result = await client.pExpire(lockKey, LOCK_TTL_MS);
    return result === 1;
  } catch {
    return false;
  }
}

async function releaseLock(client: any, lockKey: string, pendingKey: string): Promise<void> {
  try {
    await client.del(lockKey);
    await client.del(pendingKey);
  } catch {
  }
}

async function setPending(client: any, pendingKey: string, traceId: string): Promise<void> {
  try {
    await client.setEx(pendingKey, PENDING_TTL_SECONDS, `${INSTANCE_ID}:${traceId}:${Date.now()}`);
  } catch {
  }
}

async function renewPending(client: any, pendingKey: string): Promise<boolean> {
  try {
    const result = await client.expire(pendingKey, PENDING_TTL_SECONDS);
    return result === 1;
  } catch {
    return false;
  }
}

/**
 * Wait for cache to be populated while pending sentinel exists
 * This prevents duplicate provider fetches by ensuring contenders wait
 * as long as the lock holder is actively fetching (refreshing pending sentinel)
 * 
 * The wait continues INDEFINITELY while:
 * 1. Pending sentinel exists (holder is actively fetching and renewing)
 * 
 * The wait stops if:
 * 1. Cache data appears (success - return data)
 * 2. Pending is gone for 5 consecutive checks (holder crashed/failed - return null)
 * 3. No pending after initial grace period of 10s (race condition - check cache once more)
 */
async function waitForCachePopulated(
  client: any,
  cacheKey: string,
  pendingKey: string,
  traceId: string
): Promise<string | null> {
  const startTime = Date.now();
  let pollCount = 0;
  let consecutiveNoPending = 0;
  const GRACE_PERIOD_MS = 10000;
  
  while (true) {
    const cachedData = await client.get(cacheKey);
    if (cachedData) {
      console.log(`[BARS_CACHE] trace_id=${traceId} cache_populated_after_wait polls=${pollCount} waited=${Date.now() - startTime}ms`);
      return cachedData;
    }
    
    const pendingValue = await client.get(pendingKey);
    const elapsed = Date.now() - startTime;
    
    if (!pendingValue) {
      consecutiveNoPending++;
      
      if (elapsed < GRACE_PERIOD_MS) {
        consecutiveNoPending = 0;
      }
      
      if (consecutiveNoPending >= 5) {
        const finalCheck = await client.get(cacheKey);
        if (finalCheck) {
          console.log(`[BARS_CACHE] trace_id=${traceId} cache_found_on_final_check polls=${pollCount} waited=${elapsed}ms`);
          return finalCheck;
        }
        console.warn(`[BARS_CACHE] trace_id=${traceId} pending_cleared_no_data key=${cacheKey.slice(0, 60)} polls=${pollCount} waited=${elapsed}ms`);
        return null;
      }
    } else {
      consecutiveNoPending = 0;
    }
    
    const delay = Math.min(1000 + pollCount * 200, 5000);
    await new Promise(resolve => setTimeout(resolve, delay));
    pollCount++;
    
    if (pollCount % 30 === 0) {
      console.log(`[BARS_CACHE] trace_id=${traceId} still_waiting polls=${pollCount} elapsed=${(elapsed / 1000).toFixed(0)}s pending=${!!pendingValue}`);
    }
  }
}

async function incrementCounter(client: any, counterName: string, runId?: string): Promise<void> {
  try {
    const key = runId ? `${STATS_PREFIX}${runId}:${counterName}` : `${STATS_PREFIX}global:${counterName}`;
    await client.incr(key);
    if (runId) {
      await client.expire(key, 86400);
    }
  } catch {
  }
}

async function compressBars(bars: DatabentoBar[]): Promise<Buffer> {
  const compact = bars.map(b => [
    b.time instanceof Date ? b.time.getTime() : new Date(b.time).getTime(),
    b.open,
    b.high,
    b.low,
    b.close,
    b.volume,
  ]);
  const json = JSON.stringify(compact);
  return await gzipAsync(Buffer.from(json));
}

async function decompressBars(compressed: Buffer, symbol: string): Promise<DatabentoBar[]> {
  const decompressed = await gunzipAsync(compressed);
  const compact: number[][] = JSON.parse(decompressed.toString());
  return compact.map(arr => ({
    time: new Date(arr[0]),
    open: arr[1],
    high: arr[2],
    low: arr[3],
    close: arr[4],
    volume: arr[5],
    symbol: symbol.toUpperCase(),
  }));
}

/**
 * Get bars with shared Redis cache and stampede protection
 * 
 * This is the main entry point for fetching historical bars.
 * It implements the following flow:
 * 1. Check Redis cache for existing data
 * 2. On cache miss, acquire a distributed lock
 * 3. If lock acquired, fetch from Databento and cache
 * 4. If lock not acquired, wait for another instance to populate cache
 * 5. Return bars with metadata about cache status
 */
export async function getBarsCached(
  params: BarsCacheParams,
  traceId: string,
  runId?: string
): Promise<BarsCacheResult> {
  const startTime = Date.now();
  const result: BarsCacheResult = {
    bars: [],
    cacheHit: false,
    lockAcquired: false,
    providerFetch: false,
    bytesIn: 0,
    bytesOut: 0,
    durationMs: 0,
    instanceId: INSTANCE_ID,
  };

  if (!isRedisConfigured()) {
    console.log(`[BARS_CACHE] trace_id=${traceId} redis_not_configured fallback_to_direct`);
    const bars = await fetchFromProvider(params, traceId);
    result.bars = bars;
    result.providerFetch = true;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const client = await getRedisClient();
  if (!client) {
    console.log(`[BARS_CACHE] trace_id=${traceId} redis_unavailable fallback_to_direct`);
    const bars = await fetchFromProvider(params, traceId);
    result.bars = bars;
    result.providerFetch = true;
    result.durationMs = Date.now() - startTime;
    return result;
  }

  const cacheKey = buildCacheKey(params);
  const lockKey = buildLockKey(cacheKey);
  const pendingKey = buildPendingKey(cacheKey);

  try {
    const cachedData = await client.get(cacheKey);
    
    if (cachedData) {
      const compressed = Buffer.from(cachedData, "base64");
      result.bars = await decompressBars(compressed, params.symbol);
      result.cacheHit = true;
      result.bytesIn = compressed.length;
      result.durationMs = Date.now() - startTime;
      
      await incrementCounter(client, "cache_hit", runId);
      
      console.log(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} cache_hit key=${cacheKey.slice(0, 60)} bars=${result.bars.length} duration=${result.durationMs}ms`);
      
      return result;
    }

    await incrementCounter(client, "cache_miss", runId);

    const lockAcquired = await acquireLock(client, lockKey, traceId);
    result.lockAcquired = lockAcquired;

    if (lockAcquired) {
      console.log(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} lock_acquired fetching_from_provider`);
      
      await setPending(client, pendingKey, traceId);
      
      let renewalInterval: NodeJS.Timeout | null = null;
      try {
        renewalInterval = setInterval(async () => {
          await renewLock(client, lockKey);
          await renewPending(client, pendingKey);
        }, LOCK_RENEWAL_INTERVAL_MS);
        
        const bars = await fetchFromProvider(params, traceId);
        result.bars = bars;
        result.providerFetch = true;

        const compressed = await compressBars(bars);
        await client.setEx(cacheKey, DEFAULT_TTL_SECONDS, compressed.toString("base64"));
        result.bytesOut = compressed.length;

        await incrementCounter(client, "cache_set", runId);
        await incrementCounter(client, "provider_fetch", runId);
        await client.incrBy(`${STATS_PREFIX}global:bytes`, compressed.length);

        console.log(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} cache_set key=${cacheKey.slice(0, 60)} bars=${bars.length} compressed_bytes=${compressed.length}`);
        
      } finally {
        if (renewalInterval) clearInterval(renewalInterval);
        await releaseLock(client, lockKey, pendingKey);
      }
    } else {
      console.log(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} lock_wait key=${lockKey}`);
      await incrementCounter(client, "lock_waits", runId);

      const cachedData = await waitForCachePopulated(client, cacheKey, pendingKey, traceId);
      
      if (cachedData) {
        const compressed = Buffer.from(cachedData, "base64");
        result.bars = await decompressBars(compressed, params.symbol);
        result.cacheHit = true;
        result.bytesIn = compressed.length;
        
        await incrementCounter(client, "cache_hit", runId);
        await incrementCounter(client, "stampede_prevented", runId);
        console.log(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} cache_hit_after_wait bars=${result.bars.length} stampede_prevented=true`);
      } else {
        console.warn(`[BARS_CACHE] trace_id=${traceId} instance=${INSTANCE_ID} cache_empty_after_wait fetching_direct`);
        await incrementCounter(client, "stampede_fallback", runId);
        result.bars = await fetchFromProvider(params, traceId);
        result.providerFetch = true;
      }
    }

  } catch (error) {
    console.error(`[BARS_CACHE] trace_id=${traceId} error=${error instanceof Error ? error.message : String(error)}`);
    result.bars = await fetchFromProvider(params, traceId);
    result.providerFetch = true;
  }

  result.durationMs = Date.now() - startTime;
  return result;
}

async function fetchFromProvider(params: BarsCacheParams, traceId: string): Promise<DatabentoBar[]> {
  const startDate = new Date(params.startTs);
  const endDate = new Date(params.endTs);
  
  await logIntegrationUsage({
    provider: "databento",
    operation: "historical_bars",
    status: "OK",
    latencyMs: 0,
    traceId,
    metadata: {
      symbol: params.symbol,
      timeframe: params.timeframe,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  });

  const response = await fetchDatabentoHistoricalBars(
    params.symbol,
    startDate,
    endDate,
    params.timeframe,
    traceId
  );

  return response.bars;
}

/**
 * Get cache statistics for observability
 */
export async function getBarsCacheStats(runId?: string): Promise<BarsCacheStats> {
  const stats: BarsCacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    bytes: 0,
    lockWaits: 0,
    providerFetches: 0,
    stampedesPrevented: 0,
    stampedeFallbacks: 0,
    lockTimeoutFallbacks: 0,
  };

  if (!isRedisConfigured()) {
    return stats;
  }

  const client = await getRedisClient();
  if (!client) {
    return stats;
  }

  try {
    const prefix = runId ? `${STATS_PREFIX}${runId}:` : `${STATS_PREFIX}global:`;
    
    const [hits, misses, sets, bytes, lockWaits, providerFetches, stampedesPrevented, stampedeFallbacks, lockTimeoutFallbacks] = await Promise.all([
      client.get(`${prefix}cache_hit`),
      client.get(`${prefix}cache_miss`),
      client.get(`${prefix}cache_set`),
      client.get(`${prefix}bytes`),
      client.get(`${prefix}lock_waits`),
      client.get(`${prefix}provider_fetch`),
      client.get(`${prefix}stampede_prevented`),
      client.get(`${prefix}stampede_fallback`),
      client.get(`${prefix}lock_timeout_fallback`),
    ]);

    stats.hits = parseInt(hits || "0");
    stats.misses = parseInt(misses || "0");
    stats.sets = parseInt(sets || "0");
    stats.bytes = parseInt(bytes || "0");
    stats.lockWaits = parseInt(lockWaits || "0");
    stats.providerFetches = parseInt(providerFetches || "0");
    stats.stampedesPrevented = parseInt(stampedesPrevented || "0");
    stats.stampedeFallbacks = parseInt(stampedeFallbacks || "0");
    stats.lockTimeoutFallbacks = parseInt(lockTimeoutFallbacks || "0");

  } catch {
  }

  return stats;
}

/**
 * Reset statistics counters
 */
export async function resetBarsCacheStats(runId?: string): Promise<void> {
  if (!isRedisConfigured()) return;

  const client = await getRedisClient();
  if (!client) return;

  try {
    const prefix = runId ? `${STATS_PREFIX}${runId}:` : `${STATS_PREFIX}global:`;
    const keys = await client.keys(`${prefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
  } catch {
  }
}

/**
 * Get current instance ID for autoscale tracking
 */
export function getInstanceId(): string {
  return INSTANCE_ID;
}

/**
 * Clear all cached bars (use with caution)
 */
export async function clearBarsCache(): Promise<number> {
  if (!isRedisConfigured()) return 0;

  const client = await getRedisClient();
  if (!client) return 0;

  try {
    const keys = await client.keys(`${CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`[BARS_CACHE] cleared ${keys.length} cached entries`);
    }
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Get count of cached entries
 */
export async function getBarsCacheCount(): Promise<number> {
  if (!isRedisConfigured()) return 0;

  const client = await getRedisClient();
  if (!client) return 0;

  try {
    const keys = await client.keys(`${CACHE_PREFIX}*`);
    return keys.length;
  } catch {
    return 0;
  }
}
