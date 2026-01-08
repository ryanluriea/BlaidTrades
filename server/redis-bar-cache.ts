/**
 * Redis Bar Cache Service
 * 
 * Provides Redis-backed persistent caching for historical bar data with:
 * - Survives process restarts (unlike in-memory cache)
 * - Shareable across worker processes
 * - Compressed storage for efficient memory usage
 * - TTL-based expiration (30 days default)
 * - Batch operations for efficient hydration
 * 
 * CACHE HIERARCHY:
 * 1. In-memory (bar-cache.ts) - Fastest, volatile
 * 2. Redis (this service) - Fast, persistent across restarts
 * 3. SQLite cold storage - Disk-based, 5 years of history
 * 4. Databento API - Remote, rate-limited (last resort)
 * 
 * MEMORY OPTIMIZATION: Bars are stored as compressed JSON strings
 * to minimize Redis memory usage. Typical compression: 60-70% reduction.
 */

import { getRedisClient, isRedisConfigured } from "./redis";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface RedisBar {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface RedisCacheStats {
  enabled: boolean;
  connected: boolean;
  symbolsCached: number;
  totalBars: number;
  memoryUsedBytes: number;
  lastError?: string;
}

const REDIS_BAR_PREFIX = "bars:";
const REDIS_BAR_TTL_SECONDS = 30 * 24 * 60 * 60;
// REDUCED: Previous 50k limit contributed to OOM crashes with concurrent backtests
const MAX_BARS_PER_SYMBOL = 20_000; // ~14 days of 1-minute bars

let lastError: string | null = null;
let cacheStats: RedisCacheStats = {
  enabled: false,
  connected: false,
  symbolsCached: 0,
  totalBars: 0,
  memoryUsedBytes: 0,
};

/**
 * Convert standard bar format to compact Redis format
 */
function toRedisFormat(bar: { time: Date; open: number; high: number; low: number; close: number; volume: number }): RedisBar {
  return {
    ts: bar.time.getTime(),
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close,
    v: bar.volume,
  };
}

/**
 * Convert Redis format back to standard bar format
 */
function fromRedisFormat(bar: RedisBar, symbol: string): { time: Date; open: number; high: number; low: number; close: number; volume: number; symbol: string } {
  return {
    time: new Date(bar.ts),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
    symbol,
  };
}

/**
 * Compress bars data for storage
 */
async function compressBars(bars: RedisBar[]): Promise<Buffer> {
  const json = JSON.stringify(bars);
  return await gzipAsync(Buffer.from(json));
}

/**
 * Decompress bars data from storage
 */
async function decompressBars(compressed: Buffer): Promise<RedisBar[]> {
  const decompressed = await gunzipAsync(compressed);
  return JSON.parse(decompressed.toString());
}

/**
 * Get cache key for a symbol
 */
function getCacheKey(symbol: string, timeframe: string = "1m"): string {
  return `${REDIS_BAR_PREFIX}${symbol.toUpperCase()}:${timeframe}`;
}

/**
 * Store bars in Redis cache
 * Keeps only the most recent MAX_BARS_PER_SYMBOL bars
 */
export async function setRedisBars(
  symbol: string,
  bars: Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number }>,
  timeframe: string = "1m",
  traceId?: string
): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      lastError = "Redis client not available";
      return false;
    }

    const redisBars = bars.map(toRedisFormat);
    
    const trimmedBars = redisBars.length > MAX_BARS_PER_SYMBOL 
      ? redisBars.slice(-MAX_BARS_PER_SYMBOL) 
      : redisBars;

    const compressed = await compressBars(trimmedBars);
    const key = getCacheKey(symbol, timeframe);
    
    await client.setEx(key, REDIS_BAR_TTL_SECONDS, compressed.toString("base64"));
    
    console.log(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} symbol=${symbol} stored=${trimmedBars.length} bars compressed_size=${compressed.length} bytes`);
    
    lastError = null;
    return true;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} symbol=${symbol} store_error: ${lastError}`);
    return false;
  }
}

/**
 * Get bars from Redis cache
 * Returns null if not cached or on error
 */
export async function getRedisBars(
  symbol: string,
  timeframe: string = "1m",
  traceId?: string
): Promise<Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number; symbol: string }> | null> {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      lastError = "Redis client not available";
      return null;
    }

    const key = getCacheKey(symbol, timeframe);
    const data = await client.get(key);
    
    if (!data) {
      console.log(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} symbol=${symbol} cache_miss`);
      return null;
    }

    const compressed = Buffer.from(data, "base64");
    const redisBars = await decompressBars(compressed);
    const bars = redisBars.map(b => fromRedisFormat(b, symbol.toUpperCase()));
    
    console.log(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} symbol=${symbol} cache_hit bars=${bars.length}`);
    
    lastError = null;
    return bars;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} symbol=${symbol} get_error: ${lastError}`);
    return null;
  }
}

/**
 * Check if symbol is cached in Redis
 */
export async function hasRedisBars(symbol: string, timeframe: string = "1m"): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false;
  }

  try {
    const client = await getRedisClient();
    if (!client) return false;

    const key = getCacheKey(symbol, timeframe);
    const exists = await client.exists(key);
    return exists === 1;
  } catch {
    return false;
  }
}

/**
 * Delete cached bars for a symbol
 */
export async function deleteRedisBars(symbol: string, timeframe: string = "1m"): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false;
  }

  try {
    const client = await getRedisClient();
    if (!client) return false;

    const key = getCacheKey(symbol, timeframe);
    await client.del(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get cache statistics
 */
export async function getRedisCacheStats(): Promise<RedisCacheStats> {
  if (!isRedisConfigured()) {
    return {
      enabled: false,
      connected: false,
      symbolsCached: 0,
      totalBars: 0,
      memoryUsedBytes: 0,
    };
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return {
        enabled: true,
        connected: false,
        symbolsCached: 0,
        totalBars: 0,
        memoryUsedBytes: 0,
        lastError: lastError || "Client not available",
      };
    }

    const keys = await client.keys(`${REDIS_BAR_PREFIX}*`);
    let totalBars = 0;
    let memoryUsed = 0;

    for (const key of keys) {
      try {
        const data = await client.get(key);
        if (data) {
          memoryUsed += data.length;
          const compressed = Buffer.from(data, "base64");
          const bars = await decompressBars(compressed);
          totalBars += bars.length;
        }
      } catch {
      }
    }

    cacheStats = {
      enabled: true,
      connected: true,
      symbolsCached: keys.length,
      totalBars,
      memoryUsedBytes: memoryUsed,
    };

    return cacheStats;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    return {
      enabled: true,
      connected: false,
      symbolsCached: 0,
      totalBars: 0,
      memoryUsedBytes: 0,
      lastError,
    };
  }
}

/**
 * Clear all cached bars (use with caution)
 */
export async function clearAllRedisBars(): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false;
  }

  try {
    const client = await getRedisClient();
    if (!client) return false;

    const keys = await client.keys(`${REDIS_BAR_PREFIX}*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`[REDIS_BAR_CACHE] cleared ${keys.length} cached symbols`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Batch store multiple symbols at once
 */
export async function setBatchRedisBars(
  symbolBars: Map<string, Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number }>>,
  timeframe: string = "1m",
  traceId?: string
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const [symbol, bars] of symbolBars) {
    const result = await setRedisBars(symbol, bars, timeframe, traceId);
    if (result) {
      success++;
    } else {
      failed++;
    }
  }

  console.log(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} batch_store success=${success} failed=${failed}`);
  return { success, failed };
}

/**
 * Batch get multiple symbols at once
 */
export async function getBatchRedisBars(
  symbols: string[],
  timeframe: string = "1m",
  traceId?: string
): Promise<Map<string, Array<{ time: Date; open: number; high: number; low: number; close: number; volume: number; symbol: string }>>> {
  const result = new Map();

  for (const symbol of symbols) {
    const bars = await getRedisBars(symbol, timeframe, traceId);
    if (bars) {
      result.set(symbol.toUpperCase(), bars);
    }
  }

  console.log(`[REDIS_BAR_CACHE] trace_id=${traceId || 'none'} batch_get requested=${symbols.length} found=${result.size}`);
  return result;
}
