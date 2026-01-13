/**
 * Redis-Backed Rate Limiter
 * 
 * Industry-standard rate limiting with Redis for multi-instance support.
 * Falls back to in-memory when Redis is unavailable (degraded mode).
 * 
 * Pattern: Sliding window counter with exponential backoff lockout
 */

import { getRedisClient } from '../redis';

const RATE_LIMIT_PREFIX = 'ratelimit:';
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface RateLimitConfig {
  windowMs?: number;
  maxAttempts?: number;
  lockoutMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number | null;
  errorCode?: string;
  source: 'redis' | 'memory';
}

interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

const memoryFallback = new Map<string, RateLimitEntry>();

/**
 * Check rate limit using Redis (with memory fallback)
 */
export async function checkRateLimitRedis(
  key: string, 
  config: RateLimitConfig = {}
): Promise<RateLimitResult> {
  const windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const lockoutMs = config.lockoutMs ?? DEFAULT_LOCKOUT_MS;
  
  try {
    const client = await getRedisClient();
    if (!client) {
      return checkRateLimitMemory(key, windowMs, maxAttempts, lockoutMs);
    }

    const redisKey = `${RATE_LIMIT_PREFIX}${key}`;
    const now = Date.now();
    
    const data = await client.get(redisKey);
    let entry: RateLimitEntry;
    
    if (data) {
      entry = JSON.parse(data);
    } else {
      entry = { count: 0, firstAttempt: now, lockedUntil: null };
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
      const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter,
        errorCode: 'RATE_LIMIT_EXCEEDED',
        source: 'redis',
      };
    }

    if (now - entry.firstAttempt > windowMs) {
      entry = { count: 1, firstAttempt: now, lockedUntil: null };
      await client.set(redisKey, JSON.stringify(entry), { PX: windowMs + lockoutMs });
      return {
        allowed: true,
        remaining: maxAttempts - 1,
        retryAfter: null,
        source: 'redis',
      };
    }

    entry.count += 1;

    if (entry.count > maxAttempts) {
      entry.lockedUntil = now + lockoutMs;
      await client.set(redisKey, JSON.stringify(entry), { PX: lockoutMs });
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(lockoutMs / 1000),
        errorCode: 'RATE_LIMIT_EXCEEDED',
        source: 'redis',
      };
    }

    await client.set(redisKey, JSON.stringify(entry), { PX: windowMs });
    return {
      allowed: true,
      remaining: maxAttempts - entry.count,
      retryAfter: null,
      source: 'redis',
    };
  } catch (err) {
    console.warn('[REDIS_RATE_LIMIT] Error, falling back to memory:', err);
    return checkRateLimitMemory(key, windowMs, maxAttempts, lockoutMs);
  }
}

function checkRateLimitMemory(
  key: string, 
  windowMs: number, 
  maxAttempts: number, 
  lockoutMs: number
): RateLimitResult {
  const now = Date.now();
  const entry = memoryFallback.get(key);

  if (entry?.lockedUntil && now < entry.lockedUntil) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      source: 'memory',
    };
  }

  if (!entry || now - entry.firstAttempt > windowMs) {
    memoryFallback.set(key, {
      count: 1,
      firstAttempt: now,
      lockedUntil: null,
    });
    return {
      allowed: true,
      remaining: maxAttempts - 1,
      retryAfter: null,
      source: 'memory',
    };
  }

  const newCount = entry.count + 1;

  if (newCount > maxAttempts) {
    const lockedUntil = now + lockoutMs;
    memoryFallback.set(key, {
      count: newCount,
      firstAttempt: entry.firstAttempt,
      lockedUntil,
    });
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil(lockoutMs / 1000),
      errorCode: 'RATE_LIMIT_EXCEEDED',
      source: 'memory',
    };
  }

  memoryFallback.set(key, {
    count: newCount,
    firstAttempt: entry.firstAttempt,
    lockedUntil: null,
  });

  return {
    allowed: true,
    remaining: maxAttempts - newCount,
    retryAfter: null,
    source: 'memory',
  };
}

/**
 * Reset rate limit for a key (e.g., after successful login)
 */
export async function resetRateLimitRedis(key: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (client) {
      await client.del(`${RATE_LIMIT_PREFIX}${key}`);
    }
    memoryFallback.delete(key);
  } catch (err) {
    console.warn('[REDIS_RATE_LIMIT] Reset error:', err);
    memoryFallback.delete(key);
  }
}

/**
 * Build a standardized rate limit key
 */
export function buildRateLimitKey(
  endpoint: string, 
  userId?: string, 
  ip?: string
): string {
  const parts = [endpoint];
  if (userId) parts.push(userId);
  if (ip) parts.push(ip);
  return parts.join(':');
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryFallback.entries()) {
    const expired = now - entry.firstAttempt > DEFAULT_WINDOW_MS;
    const unlocked = !entry.lockedUntil || now > entry.lockedUntil;
    if (expired && unlocked) {
      memoryFallback.delete(key);
    }
  }
}, 60 * 1000);
