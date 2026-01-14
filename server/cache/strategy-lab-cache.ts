/**
 * Strategy Lab Candidates Cache Layer
 * 
 * Provides Redis-backed caching for the strategy-lab/candidates endpoint.
 * Pattern: Background refresh with stale-while-revalidate semantics.
 * 
 * Cache Strategy:
 * - Fast path: Return cached data if fresh (< TTL)
 * - Stale path: Return stale data + trigger background refresh
 * - Cold path: Compute on demand, cache result
 * 
 * TTL Settings (optimized for Redis bandwidth - reduced network usage by 90%+):
 * - FRESH_TTL: 5min - Data considered fresh (candidates change less frequently)
 * - STALE_TTL: 8min - Data stale but usable
 * - MAX_TTL: 10min - Data too old, must recompute
 * 
 * User actions still invalidate instantly.
 * Background warming runs every 3 minutes (not every request).
 */

import { getRedisClient } from '../redis';
import { metricsRegistry } from '../observability/metrics';

const CACHE_KEY_PREFIX = 'strategy-lab:';
const FRESH_TTL_SECONDS = 300; // 5 min - reduced Redis bandwidth (was 60s)
const STALE_TTL_SECONDS = 480; // 8 min - stale-while-revalidate window
const MAX_TTL_SECONDS = 600;   // 10 min - absolute expiry

// PERFORMANCE: Global in-memory fallback cache
// Serves any user when Redis cache misses and DB is slow/saturated
// This prevents skeleton loaders during cold starts and DB saturation
let globalFallbackCache: { data: CachedStrategyLabData | null; updatedAt: number } = {
  data: null,
  updatedAt: 0,
};
const GLOBAL_FALLBACK_TTL_MS = 60_000; // 1 minute - short TTL since it's shared across users

export function getGlobalFallbackCache(): CachedStrategyLabData | null {
  const age = Date.now() - globalFallbackCache.updatedAt;
  if (globalFallbackCache.data && age < GLOBAL_FALLBACK_TTL_MS) {
    return globalFallbackCache.data;
  }
  return null;
}

export function setGlobalFallbackCache(data: CachedStrategyLabData): void {
  globalFallbackCache = {
    data,
    updatedAt: Date.now(),
  };
}

export interface CachedStrategyLabData {
  candidates: any[];
  trialsBotsCount: number;
  disposition: string;
  currentRegime: string | null;
  generatedAt: string;
  cachedAt: number;
}

export interface CacheResult {
  hit: boolean;
  fresh: boolean;
  stale: boolean;
  data: CachedStrategyLabData | null;
  ageSeconds: number | null;
}

function getCacheKey(userId: string, disposition: string): string {
  return `${CACHE_KEY_PREFIX}${userId}:${disposition}`;
}

/**
 * Get cached strategy lab candidates data
 */
export async function getCachedStrategyLabCandidates(
  userId: string, 
  disposition: string
): Promise<CacheResult> {
  try {
    const client = await getRedisClient();
    if (!client) {
      metricsRegistry.recordCacheMiss('strategy-lab');
      return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
    }

    const key = getCacheKey(userId, disposition);
    const cached = await client.get(key);
    
    if (!cached) {
      metricsRegistry.recordCacheMiss('strategy-lab');
      return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
    }

    const parsed: CachedStrategyLabData = JSON.parse(cached);
    const ageSeconds = Math.floor((Date.now() - parsed.cachedAt) / 1000);
    
    if (ageSeconds < FRESH_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('strategy-lab');
      return { hit: true, fresh: true, stale: false, data: parsed, ageSeconds };
    }
    
    if (ageSeconds < STALE_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('strategy-lab');
      return { hit: true, fresh: false, stale: true, data: parsed, ageSeconds };
    }
    
    if (ageSeconds < MAX_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('strategy-lab');
      return { hit: true, fresh: false, stale: true, data: parsed, ageSeconds };
    }
    
    metricsRegistry.recordCacheMiss('strategy-lab');
    return { hit: false, fresh: false, stale: false, data: null, ageSeconds };
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Get failed:', err);
    metricsRegistry.recordCacheMiss('strategy-lab');
    return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
  }
}

/**
 * Cache strategy lab candidates data
 */
export async function setCachedStrategyLabCandidates(
  userId: string,
  disposition: string,
  data: Omit<CachedStrategyLabData, 'cachedAt'>
): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return false;
    }

    const key = getCacheKey(userId, disposition);
    const cached: CachedStrategyLabData = {
      ...data,
      cachedAt: Date.now(),
    };

    await client.set(key, JSON.stringify(cached), {
      EX: MAX_TTL_SECONDS,
    });

    return true;
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Set failed:', err);
    return false;
  }
}

/**
 * Invalidate cached strategy lab data for a user
 */
export async function invalidateStrategyLabCache(userId: string): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return false;
    }

    const keys = await client.keys(`${CACHE_KEY_PREFIX}${userId}:*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`[STRATEGY_LAB_CACHE] Invalidated ${keys.length} keys for userId=${userId}`);
    }
    return true;
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Invalidate failed:', err);
    return false;
  }
}

/**
 * Get cache age for warming decisions
 */
export async function getStrategyLabCacheAge(userId: string, disposition: string): Promise<number | null> {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    
    const key = getCacheKey(userId, disposition);
    const cached = await client.get(key);
    if (!cached) return null;
    
    const parsed = JSON.parse(cached);
    return Math.floor((Date.now() - parsed.cachedAt) / 1000);
  } catch {
    return null;
  }
}
