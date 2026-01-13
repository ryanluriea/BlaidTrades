/**
 * Bots Overview Cache Layer
 * 
 * Provides Redis-backed caching for the expensive bots-overview endpoint.
 * Pattern: Background refresh with stale-while-revalidate semantics.
 * 
 * Cache Strategy:
 * - Fast path: Return cached data if fresh (< TTL)
 * - Stale path: Return stale data + trigger background refresh
 * - Cold path: Compute on demand, cache result
 * 
 * TTL Settings:
 * - FRESH_TTL: 30s - Data considered fresh, serve immediately
 * - STALE_TTL: 120s - Data stale but usable, trigger background refresh
 * - MAX_TTL: 300s - Data too old, must recompute
 */

import { getRedisClient } from '../redis';
import { metricsRegistry } from '../observability/metrics';

const CACHE_KEY_PREFIX = 'bots-overview:';
const FRESH_TTL_SECONDS = 30;
const STALE_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 300;

export interface CachedBotsOverview {
  data: any[];
  generatedAt: string;
  snapshotId: string;
  degraded: boolean;
  degradedPhases: string[];
  freshnessContract: any;
  cachedAt: number;
}

export interface CacheResult {
  hit: boolean;
  fresh: boolean;
  stale: boolean;
  data: CachedBotsOverview | null;
  ageSeconds: number | null;
}

/**
 * Get cached bots overview data for a user
 */
export async function getCachedBotsOverview(userId: string): Promise<CacheResult> {
  try {
    const client = await getRedisClient();
    if (!client) {
      metricsRegistry.recordCacheMiss('bots-overview');
      return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
    }

    const key = `${CACHE_KEY_PREFIX}${userId}`;
    const cached = await client.get(key);
    
    if (!cached) {
      metricsRegistry.recordCacheMiss('bots-overview');
      return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
    }

    const parsed: CachedBotsOverview = JSON.parse(cached);
    const ageSeconds = Math.floor((Date.now() - parsed.cachedAt) / 1000);
    
    if (ageSeconds < FRESH_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('bots-overview');
      return { hit: true, fresh: true, stale: false, data: parsed, ageSeconds };
    }
    
    if (ageSeconds < STALE_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('bots-overview');
      return { hit: true, fresh: false, stale: true, data: parsed, ageSeconds };
    }
    
    if (ageSeconds < MAX_TTL_SECONDS) {
      metricsRegistry.recordCacheHit('bots-overview');
      return { hit: true, fresh: false, stale: true, data: parsed, ageSeconds };
    }
    
    // Expired - count as miss
    metricsRegistry.recordCacheMiss('bots-overview');
    return { hit: false, fresh: false, stale: false, data: null, ageSeconds };
  } catch (err) {
    console.warn('[BOTS_CACHE] Get failed:', err);
    metricsRegistry.recordCacheMiss('bots-overview');
    return { hit: false, fresh: false, stale: false, data: null, ageSeconds: null };
  }
}

/**
 * Cache bots overview data for a user
 */
export async function setCachedBotsOverview(
  userId: string, 
  data: Omit<CachedBotsOverview, 'cachedAt'>
): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return false;
    }

    const key = `${CACHE_KEY_PREFIX}${userId}`;
    const cached: CachedBotsOverview = {
      ...data,
      cachedAt: Date.now(),
    };

    await client.set(key, JSON.stringify(cached), {
      EX: MAX_TTL_SECONDS,
    });

    console.log(`[BOTS_CACHE] Cached userId=${userId} bots=${data.data.length} ttl=${MAX_TTL_SECONDS}s`);
    return true;
  } catch (err) {
    console.warn('[BOTS_CACHE] Set failed:', err);
    return false;
  }
}

/**
 * Invalidate cached bots overview for a user (call after bot mutations)
 */
export async function invalidateBotsOverviewCache(userId: string): Promise<boolean> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return false;
    }

    const key = `${CACHE_KEY_PREFIX}${userId}`;
    await client.del(key);
    console.log(`[BOTS_CACHE] Invalidated userId=${userId}`);
    return true;
  } catch (err) {
    console.warn('[BOTS_CACHE] Invalidate failed:', err);
    return false;
  }
}

/**
 * Invalidate ALL cached bots overview entries (for self-healing)
 */
export async function invalidateAllBotsOverviewCache(): Promise<number> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return 0;
    }

    const keys = await client.keys(`${CACHE_KEY_PREFIX}*`);
    if (keys.length === 0) {
      return 0;
    }

    await client.del(keys);
    console.log(`[BOTS_CACHE] Invalidated ALL ${keys.length} cache entries (self-heal)`);
    return keys.length;
  } catch (err) {
    console.warn('[BOTS_CACHE] InvalidateAll failed:', err);
    return 0;
  }
}

/**
 * Check if a background refresh is needed and not already in progress
 */
const refreshInProgress = new Map<string, boolean>();

export function shouldTriggerBackgroundRefresh(userId: string, cacheResult: CacheResult): boolean {
  if (refreshInProgress.get(userId)) {
    return false;
  }
  return cacheResult.stale && !cacheResult.fresh;
}

export function markRefreshInProgress(userId: string, inProgress: boolean): void {
  if (inProgress) {
    refreshInProgress.set(userId, true);
  } else {
    refreshInProgress.delete(userId);
  }
}

/**
 * Get cache statistics for observability
 */
export async function getBotsOverviewCacheStats(): Promise<{
  configured: boolean;
  keyCount: number;
  oldestAgeSeconds: number | null;
}> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { configured: false, keyCount: 0, oldestAgeSeconds: null };
    }

    const keys = await client.keys(`${CACHE_KEY_PREFIX}*`);
    let oldestAge: number | null = null;

    for (const key of keys.slice(0, 10)) {
      const cached = await client.get(key);
      if (cached) {
        const parsed = JSON.parse(cached);
        const age = Math.floor((Date.now() - parsed.cachedAt) / 1000);
        if (oldestAge === null || age > oldestAge) {
          oldestAge = age;
        }
      }
    }

    return {
      configured: true,
      keyCount: keys.length,
      oldestAgeSeconds: oldestAge,
    };
  } catch (err) {
    return { configured: false, keyCount: 0, oldestAgeSeconds: null };
  }
}
