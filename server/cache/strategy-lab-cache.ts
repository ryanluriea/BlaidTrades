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
 * TTL Settings:
 * - FRESH_TTL: 60s - Data considered fresh (candidates change less frequently)
 * - STALE_TTL: 180s - Data stale but usable
 * - MAX_TTL: 300s - Data too old, must recompute
 */

import { getRedisClient } from '../redis';
import { metricsRegistry } from '../observability/metrics';

const CACHE_KEY_PREFIX = 'strategy-lab:';
const FRESH_TTL_SECONDS = 60;
const STALE_TTL_SECONDS = 180;
const MAX_TTL_SECONDS = 300;

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
