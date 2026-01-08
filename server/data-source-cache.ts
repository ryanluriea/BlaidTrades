/**
 * Shared Data Source Cache
 * 
 * Industry-standard caching layer for all data providers with:
 * - In-memory cache with configurable TTL per provider
 * - Request deduplication (coalesces concurrent requests)
 * - Stale-while-revalidate pattern
 * - Provider-specific rate limiting
 * - Graceful degradation when cache misses
 * 
 * INSTITUTIONAL REQUIREMENT: Prevents rate limit exhaustion across multiple bots
 */

import { getRedisClient, isRedisConfigured } from "./redis";

export interface CacheConfig {
  ttlMs: number;
  staleWhileRevalidateMs: number;
  maxEntries: number;
  rateLimitPerMinute: number;
}

export interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  staleAt: number;
}

export interface RateLimitState {
  count: number;
  windowStart: number;
}

const PROVIDER_CONFIGS: Record<string, CacheConfig> = {
  unusual_whales: {
    ttlMs: 60_000,
    staleWhileRevalidateMs: 300_000,
    maxEntries: 100,
    rateLimitPerMinute: 30,
  },
  fred: {
    ttlMs: 3600_000,
    staleWhileRevalidateMs: 86400_000,
    maxEntries: 50,
    rateLimitPerMinute: 120,
  },
  finnhub: {
    ttlMs: 30_000,
    staleWhileRevalidateMs: 120_000,
    maxEntries: 200,
    rateLimitPerMinute: 60,
  },
  newsapi: {
    ttlMs: 300_000,
    staleWhileRevalidateMs: 900_000,
    maxEntries: 100,
    rateLimitPerMinute: 100,
  },
  marketaux: {
    ttlMs: 300_000,
    staleWhileRevalidateMs: 900_000,
    maxEntries: 100,
    rateLimitPerMinute: 100,
  },
  fmp: {
    ttlMs: 300_000,
    staleWhileRevalidateMs: 3600_000,
    maxEntries: 100,
    rateLimitPerMinute: 300,
  },
  databento: {
    ttlMs: 1_000,
    staleWhileRevalidateMs: 5_000,
    maxEntries: 500,
    rateLimitPerMinute: 1000,
  },
  polygon: {
    ttlMs: 1_000,
    staleWhileRevalidateMs: 10_000,
    maxEntries: 500,
    rateLimitPerMinute: 500,
  },
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const rateLimitStates = new Map<string, RateLimitState>();
const pendingRequests = new Map<string, Promise<unknown>>();

function getCacheKey(provider: string, endpoint: string, params?: Record<string, unknown>): string {
  const paramStr = params ? JSON.stringify(params, Object.keys(params).sort()) : "";
  return `${provider}:${endpoint}:${paramStr}`;
}

function getConfig(provider: string): CacheConfig {
  return PROVIDER_CONFIGS[provider] || {
    ttlMs: 60_000,
    staleWhileRevalidateMs: 300_000,
    maxEntries: 100,
    rateLimitPerMinute: 60,
  };
}

function checkRateLimit(provider: string): boolean {
  const config = getConfig(provider);
  const now = Date.now();
  const state = rateLimitStates.get(provider);
  
  if (!state || now - state.windowStart > 60_000) {
    rateLimitStates.set(provider, { count: 1, windowStart: now });
    return true;
  }
  
  if (state.count >= config.rateLimitPerMinute) {
    console.log(`[DATA_CACHE] provider=${provider} rate_limit_exceeded count=${state.count}/${config.rateLimitPerMinute}`);
    return false;
  }
  
  state.count++;
  return true;
}

function evictOldEntries(provider: string): void {
  const config = getConfig(provider);
  const prefix = `${provider}:`;
  const entries: Array<{ key: string; fetchedAt: number }> = [];
  
  for (const [key, entry] of memoryCache.entries()) {
    if (key.startsWith(prefix)) {
      entries.push({ key, fetchedAt: entry.fetchedAt });
    }
  }
  
  if (entries.length > config.maxEntries) {
    entries.sort((a, b) => a.fetchedAt - b.fetchedAt);
    const toEvict = entries.slice(0, entries.length - config.maxEntries);
    for (const { key } of toEvict) {
      memoryCache.delete(key);
    }
  }
}

export interface CacheResult<T> {
  data: T;
  fromCache: boolean;
  isStale: boolean;
  provider: string;
  cacheKey: string;
  fetchedAt: Date;
}

export async function getCachedData<T>(
  provider: string,
  endpoint: string,
  fetcher: () => Promise<T>,
  params?: Record<string, unknown>
): Promise<CacheResult<T>> {
  const cacheKey = getCacheKey(provider, endpoint, params);
  const config = getConfig(provider);
  const now = Date.now();
  
  const cached = memoryCache.get(cacheKey) as CacheEntry<T> | undefined;
  
  if (cached && now < cached.expiresAt) {
    return {
      data: cached.data,
      fromCache: true,
      isStale: false,
      provider,
      cacheKey,
      fetchedAt: new Date(cached.fetchedAt),
    };
  }
  
  if (cached && now < cached.staleAt) {
    if (!pendingRequests.has(cacheKey)) {
      const revalidatePromise = (async () => {
        try {
          if (!checkRateLimit(provider)) {
            return;
          }
          const freshData = await fetcher();
          const entry: CacheEntry<T> = {
            data: freshData,
            fetchedAt: Date.now(),
            expiresAt: Date.now() + config.ttlMs,
            staleAt: Date.now() + config.staleWhileRevalidateMs,
          };
          memoryCache.set(cacheKey, entry);
          evictOldEntries(provider);
        } catch (error) {
          console.error(`[DATA_CACHE] provider=${provider} background_revalidate_failed:`, error);
        } finally {
          pendingRequests.delete(cacheKey);
        }
      })();
      pendingRequests.set(cacheKey, revalidatePromise);
    }
    
    return {
      data: cached.data,
      fromCache: true,
      isStale: true,
      provider,
      cacheKey,
      fetchedAt: new Date(cached.fetchedAt),
    };
  }
  
  const pending = pendingRequests.get(cacheKey);
  if (pending) {
    const data = await pending as T;
    const entry = memoryCache.get(cacheKey) as CacheEntry<T>;
    return {
      data,
      fromCache: true,
      isStale: false,
      provider,
      cacheKey,
      fetchedAt: entry ? new Date(entry.fetchedAt) : new Date(),
    };
  }
  
  if (!checkRateLimit(provider)) {
    if (cached) {
      console.log(`[DATA_CACHE] provider=${provider} using_stale_due_to_rate_limit key=${cacheKey.slice(0, 50)}`);
      return {
        data: cached.data,
        fromCache: true,
        isStale: true,
        provider,
        cacheKey,
        fetchedAt: new Date(cached.fetchedAt),
      };
    }
    throw new Error(`Rate limit exceeded for provider ${provider} and no cached data available`);
  }
  
  const fetchPromise = (async () => {
    try {
      const data = await fetcher();
      const entry: CacheEntry<T> = {
        data,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + config.ttlMs,
        staleAt: Date.now() + config.staleWhileRevalidateMs,
      };
      memoryCache.set(cacheKey, entry);
      evictOldEntries(provider);
      return data;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();
  
  pendingRequests.set(cacheKey, fetchPromise);
  const data = await fetchPromise;
  
  return {
    data,
    fromCache: false,
    isStale: false,
    provider,
    cacheKey,
    fetchedAt: new Date(),
  };
}

export function invalidateCache(provider: string, endpoint?: string): number {
  const prefix = endpoint ? `${provider}:${endpoint}:` : `${provider}:`;
  let count = 0;
  
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
      count++;
    }
  }
  
  console.log(`[DATA_CACHE] invalidated provider=${provider} endpoint=${endpoint || '*'} count=${count}`);
  return count;
}

export function getCacheStats(): Record<string, { entries: number; hitRate: string }> {
  const stats: Record<string, { entries: number; hitRate: string }> = {};
  
  for (const provider of Object.keys(PROVIDER_CONFIGS)) {
    const prefix = `${provider}:`;
    let count = 0;
    for (const key of memoryCache.keys()) {
      if (key.startsWith(prefix)) count++;
    }
    const rateState = rateLimitStates.get(provider);
    stats[provider] = {
      entries: count,
      hitRate: rateState ? `${rateState.count}/min` : "0/min",
    };
  }
  
  return stats;
}

export function warmCache<T>(
  provider: string,
  endpoint: string,
  data: T,
  params?: Record<string, unknown>
): void {
  const cacheKey = getCacheKey(provider, endpoint, params);
  const config = getConfig(provider);
  
  const entry: CacheEntry<T> = {
    data,
    fetchedAt: Date.now(),
    expiresAt: Date.now() + config.ttlMs,
    staleAt: Date.now() + config.staleWhileRevalidateMs,
  };
  
  memoryCache.set(cacheKey, entry);
  evictOldEntries(provider);
}

setInterval(() => {
  const now = Date.now();
  let expired = 0;
  
  for (const [key, entry] of memoryCache.entries()) {
    if (now > entry.staleAt) {
      memoryCache.delete(key);
      expired++;
    }
  }
  
  if (expired > 0) {
    console.log(`[DATA_CACHE] cleanup expired=${expired} remaining=${memoryCache.size}`);
  }
}, 60_000);

setInterval(() => {
  rateLimitStates.clear();
}, 60_000);
