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

// PERFORMANCE: Global fallback cache with Redis persistence + in-memory layer
// Survives Render dyno restarts and prevents skeleton loaders during cold starts
const GLOBAL_FALLBACK_KEY = 'strategy-lab:global-fallback';
const GLOBAL_FALLBACK_TTL_SECONDS = 300; // 5 minutes in Redis (survives restarts)
const GLOBAL_FALLBACK_MEMORY_TTL_MS = 60_000; // 1 minute in-memory (fast path)

// In-memory layer for fast access
let globalFallbackMemory: { data: CachedStrategyLabData | null; updatedAt: number } = {
  data: null,
  updatedAt: 0,
};

/**
 * Get global fallback cache - tries memory first, then Redis
 * This ensures fast page loads even after cold starts
 */
export async function getGlobalFallbackCache(): Promise<CachedStrategyLabData | null> {
  // Fast path: Check in-memory cache first
  const memoryAge = Date.now() - globalFallbackMemory.updatedAt;
  if (globalFallbackMemory.data && memoryAge < GLOBAL_FALLBACK_MEMORY_TTL_MS) {
    return globalFallbackMemory.data;
  }
  
  // Slow path: Try Redis (survives restarts)
  try {
    const client = await getRedisClient();
    if (client) {
      const cached = await client.get(GLOBAL_FALLBACK_KEY);
      if (cached) {
        const parsed: CachedStrategyLabData = JSON.parse(cached);
        // Update in-memory cache for next request
        globalFallbackMemory = { data: parsed, updatedAt: Date.now() };
        console.log(`[STRATEGY_LAB_CACHE] Redis fallback restored, age=${Math.floor((Date.now() - parsed.cachedAt) / 1000)}s`);
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Redis fallback read failed:', err);
  }
  
  return null;
}

/**
 * Set global fallback cache - writes to both memory and Redis
 */
export async function setGlobalFallbackCache(data: CachedStrategyLabData): Promise<void> {
  // Always update in-memory for fast access
  globalFallbackMemory = { data, updatedAt: Date.now() };
  
  // Persist to Redis for durability across restarts
  try {
    const client = await getRedisClient();
    if (client) {
      await client.set(GLOBAL_FALLBACK_KEY, JSON.stringify(data), {
        EX: GLOBAL_FALLBACK_TTL_SECONDS,
      });
    }
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Redis fallback write failed:', err);
  }
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
 * Invalidate ALL strategy lab caches (all users, all dispositions)
 * Used after QC backfill to ensure fresh data is served
 */
export async function invalidateAllStrategyLabCaches(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      console.log('[STRATEGY_LAB_CACHE] No Redis client, clearing in-memory only');
      globalFallbackMemory = { data: null, updatedAt: 0 };
      return true;
    }

    // Clear all strategy-lab cache keys
    const keys = await client.keys(`${CACHE_KEY_PREFIX}*`);
    if (keys.length > 0) {
      await client.del(keys);
      console.log(`[STRATEGY_LAB_CACHE] Invalidated ALL ${keys.length} strategy-lab cache keys`);
    }
    
    // Clear global fallback from Redis
    await client.del(GLOBAL_FALLBACK_KEY);
    
    // Clear in-memory cache
    globalFallbackMemory = { data: null, updatedAt: 0 };
    
    console.log('[STRATEGY_LAB_CACHE] Global cache invalidation complete');
    return true;
  } catch (err) {
    console.warn('[STRATEGY_LAB_CACHE] Global invalidation failed:', err);
    // Still clear in-memory even if Redis fails
    globalFallbackMemory = { data: null, updatedAt: 0 };
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
