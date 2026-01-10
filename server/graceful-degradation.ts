/**
 * Graceful Degradation Patterns
 * 
 * Provides cache fallbacks with staleness warnings and
 * degraded service modes when primary services are unavailable.
 */

interface CachedValue<T> {
  value: T;
  cachedAt: number;
  ttlMs: number;
  source: 'fresh' | 'stale' | 'fallback';
}

interface GracefulCache<T> {
  primary: CachedValue<T> | null;
  fallback: T | null;
}

const caches = new Map<string, GracefulCache<any>>();

// Configurable staleness thresholds
const STALE_WARNING_MS = parseInt(process.env.CACHE_STALE_WARNING_MS || "300000", 10); // 5 min
const STALE_CRITICAL_MS = parseInt(process.env.CACHE_STALE_CRITICAL_MS || "900000", 10); // 15 min

export type DataSource = 'fresh' | 'stale' | 'stale_warning' | 'stale_critical' | 'fallback' | 'error';

export interface DegradedResult<T> {
  data: T | null;
  source: DataSource;
  staleMs?: number;
  warning?: string;
}

/**
 * Get data with graceful degradation
 * Tries primary fetch, falls back to stale cache, then static fallback
 */
export async function withGracefulDegradation<T>(
  key: string,
  primaryFetch: () => Promise<T>,
  options: {
    ttlMs?: number;
    fallbackValue?: T;
    logPrefix?: string;
  } = {}
): Promise<DegradedResult<T>> {
  const { ttlMs = 60000, fallbackValue, logPrefix = '[GRACEFUL]' } = options;
  
  // Try primary fetch first
  try {
    const freshData = await primaryFetch();
    
    // Update cache with fresh data
    setCache(key, freshData, ttlMs);
    
    return {
      data: freshData,
      source: 'fresh',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`${logPrefix} Primary fetch failed for ${key}: ${errorMsg}`);
    
    // Try cached value
    const cached = getCache<T>(key);
    if (cached) {
      const staleMs = Date.now() - cached.cachedAt;
      let source: DataSource = 'stale';
      let warning: string | undefined;
      
      if (staleMs > STALE_CRITICAL_MS) {
        source = 'stale_critical';
        warning = `Data is critically stale (${Math.round(staleMs / 60000)} minutes old)`;
        console.warn(`${logPrefix} ${key}: ${warning}`);
      } else if (staleMs > STALE_WARNING_MS) {
        source = 'stale_warning';
        warning = `Data may be outdated (${Math.round(staleMs / 60000)} minutes old)`;
        console.log(`${logPrefix} ${key}: ${warning}`);
      }
      
      return {
        data: cached.value,
        source,
        staleMs,
        warning,
      };
    }
    
    // Use fallback value
    if (fallbackValue !== undefined) {
      console.log(`${logPrefix} ${key}: Using fallback value`);
      return {
        data: fallbackValue,
        source: 'fallback',
        warning: 'Using fallback value - primary service unavailable',
      };
    }
    
    // No fallback available
    return {
      data: null,
      source: 'error',
      warning: `Primary fetch failed and no cached/fallback data: ${errorMsg}`,
    };
  }
}

/**
 * Set a value in the graceful cache
 */
export function setCache<T>(key: string, value: T, ttlMs: number): void {
  const cache = caches.get(key) || { primary: null, fallback: null };
  cache.primary = {
    value,
    cachedAt: Date.now(),
    ttlMs,
    source: 'fresh',
  };
  caches.set(key, cache);
}

/**
 * Get a value from the graceful cache (returns stale data if expired)
 */
export function getCache<T>(key: string): CachedValue<T> | null {
  const cache = caches.get(key);
  return cache?.primary || null;
}

/**
 * Set a static fallback value for a cache key
 */
export function setFallback<T>(key: string, fallback: T): void {
  const cache = caches.get(key) || { primary: null, fallback: null };
  cache.fallback = fallback;
  caches.set(key, cache);
}

/**
 * Check cache staleness status
 */
export function getCacheStaleness(key: string): {
  exists: boolean;
  staleMs: number;
  status: 'fresh' | 'stale' | 'warning' | 'critical' | 'expired';
} | null {
  const cache = caches.get(key);
  if (!cache?.primary) return null;
  
  const staleMs = Date.now() - cache.primary.cachedAt;
  const isExpired = staleMs > cache.primary.ttlMs;
  
  let status: 'fresh' | 'stale' | 'warning' | 'critical' | 'expired';
  if (isExpired) {
    if (staleMs > STALE_CRITICAL_MS) {
      status = 'critical';
    } else if (staleMs > STALE_WARNING_MS) {
      status = 'warning';
    } else {
      status = 'stale';
    }
  } else {
    status = 'fresh';
  }
  
  return { exists: true, staleMs, status };
}

/**
 * Cleanup expired cache entries
 */
export function cleanupExpiredCaches(maxStaleMs: number = STALE_CRITICAL_MS * 2): number {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, cache] of caches.entries()) {
    if (cache.primary) {
      const staleMs = now - cache.primary.cachedAt;
      if (staleMs > maxStaleMs) {
        cache.primary = null;
        cleaned++;
        
        // Remove entire entry if no fallback
        if (!cache.fallback) {
          caches.delete(key);
        }
      }
    }
  }
  
  if (cleaned > 0) {
    console.log(`[GRACEFUL] Cleaned ${cleaned} expired cache entries`);
  }
  
  return cleaned;
}

/**
 * Get stats about graceful degradation caches
 */
export function getGracefulDegradationStats(): {
  totalCaches: number;
  freshCount: number;
  staleCount: number;
  warningCount: number;
  criticalCount: number;
  fallbackOnlyCount: number;
} {
  let freshCount = 0;
  let staleCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let fallbackOnlyCount = 0;
  
  const now = Date.now();
  
  for (const cache of caches.values()) {
    if (!cache.primary) {
      if (cache.fallback) fallbackOnlyCount++;
      continue;
    }
    
    const staleMs = now - cache.primary.cachedAt;
    const isExpired = staleMs > cache.primary.ttlMs;
    
    if (!isExpired) {
      freshCount++;
    } else if (staleMs > STALE_CRITICAL_MS) {
      criticalCount++;
    } else if (staleMs > STALE_WARNING_MS) {
      warningCount++;
    } else {
      staleCount++;
    }
  }
  
  return {
    totalCaches: caches.size,
    freshCount,
    staleCount,
    warningCount,
    criticalCount,
    fallbackOnlyCount,
  };
}

// Periodic cleanup every 30 minutes
setInterval(() => cleanupExpiredCaches(), 1800000);
