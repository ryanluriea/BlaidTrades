/**
 * Redis Client Module
 * 
 * Provides centralized Redis connection management with:
 * - Single client instance
 * - Connection health check (pingRedis)
 * - Configuration detection
 * 
 * Redis is classified as OPTIONAL cache infrastructure:
 * - Used for: request caching, rate-limits, ephemeral locks, job debouncing
 * - NEVER a critical blocker for PAPER/TRIALS stages
 * - Missing Redis = DEGRADED performance, not BLOCKED operation
 */

import { createClient, RedisClientType } from 'redis';

interface RedisPingResult {
  configured: boolean;
  connected: boolean;
  latencyMs: number | null;
  error?: string;
  url_masked?: string;
}

let redisClient: RedisClientType | null = null;
let connectionAttempted = false;
let lastConnectionError: string | null = null;

/**
 * Check if Redis is configured via environment variables
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL);
}

/**
 * Mask Redis URL for safe logging (hide password)
 */
function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'invalid-url';
  }
}

/**
 * Get or create Redis client singleton
 * Returns null if not configured or connection failed
 * Connection attempts are cached to avoid repeated failures
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (!isRedisConfigured()) {
    return null;
  }

  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // If we already tried and failed, don't try again
  if (connectionAttempted && lastConnectionError) {
    return null;
  }

  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
  
  if (!redisUrl) {
    return null;
  }

  try {
    connectionAttempted = true;
    const client = createClient({ 
      url: redisUrl,
      socket: {
        connectTimeout: 10000, // 10 second timeout for cloud Redis
        reconnectStrategy: (retries) => {
          if (retries > 3) return false; // Stop after 3 retries
          return Math.min(retries * 500, 3000); // Exponential backoff, max 3s
        },
      }
    });
    
    client.on('error', (err: Error) => {
      // Suppress repeated error logs - just track the error
      if (!lastConnectionError) {
        console.error('[Redis] Client error:', err.message);
      }
      lastConnectionError = err.message;
    });

    // Connect with timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection timeout')), 10000)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);
    
    if (!client.isOpen) {
      throw new Error('Connection failed');
    }
    
    redisClient = client as RedisClientType;
    lastConnectionError = null;
    console.log('[Redis] Connected successfully');
    return redisClient;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Connection failed';
    if (!lastConnectionError) {
      console.error('[Redis] Connection failed:', errorMessage);
    }
    lastConnectionError = errorMessage;
    redisClient = null;
    return null;
  }
}

/**
 * Ping Redis to check connection health
 * Returns detailed status for smoke tests and health checks
 * Non-blocking with timeout protection
 */
export async function pingRedis(): Promise<RedisPingResult> {
  const configured = isRedisConfigured();
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
  
  if (!configured) {
    return {
      configured: false,
      connected: false,
      latencyMs: null,
      error: 'Not configured (optional)',
    };
  }

  const startTime = Date.now();
  
  // If we already have a connection error cached, don't try again
  if (connectionAttempted && lastConnectionError) {
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - startTime,
      error: lastConnectionError,
      url_masked: redisUrl ? maskRedisUrl(redisUrl) : undefined,
    };
  }
  
  try {
    const client = await getRedisClient();
    
    if (!client) {
      return {
        configured: true,
        connected: false,
        latencyMs: Date.now() - startTime,
        error: lastConnectionError || 'Failed to get Redis client',
        url_masked: redisUrl ? maskRedisUrl(redisUrl) : undefined,
      };
    }

    // Ping with timeout
    const pingPromise = client.ping();
    const timeoutPromise = new Promise<string>((_, reject) => 
      setTimeout(() => reject(new Error('Ping timeout')), 2000)
    );
    
    const result = await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Date.now() - startTime;

    return {
      configured: true,
      connected: result === 'PONG',
      latencyMs,
      url_masked: redisUrl ? maskRedisUrl(redisUrl) : undefined,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Ping failed';
    return {
      configured: true,
      connected: false,
      latencyMs: Date.now() - startTime,
      error: errorMessage,
      url_masked: redisUrl ? maskRedisUrl(redisUrl) : undefined,
    };
  }
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    connectionAttempted = false;
    lastConnectionError = null;
    console.log('[Redis] Connection closed');
  }
}

/**
 * Reset connection state (for retry after failures)
 */
export function resetRedisConnection(): void {
  connectionAttempted = false;
  lastConnectionError = null;
}

/**
 * Distributed Lock Result
 */
export interface LockResult {
  acquired: boolean;
  lockId: string | null;
  degraded?: boolean; // true if Redis unavailable - caller can decide to proceed at risk
}

/**
 * Acquire a distributed lock with Redis SET NX EX
 * Returns a lock ID if acquired, null if lock already held
 * 
 * @param key - The lock key (e.g., "bot-start:abc123")
 * @param ttlSeconds - Lock TTL in seconds (default 30s)
 * @returns LockResult with acquired status and lockId for release
 */
export async function acquireLock(key: string, ttlSeconds: number = 30): Promise<LockResult> {
  try {
    const client = await getRedisClient();
    if (!client) {
      // Redis not available - return degraded: true so caller can decide
      // Callers should check degraded flag and proceed at their own risk
      console.warn(`[DISTRIBUTED_LOCK] Redis unavailable, cannot acquire lock for key=${key}`);
      return { acquired: false, lockId: null, degraded: true };
    }

    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const lockKey = `lock:${key}`;
    
    // SET NX EX - atomic set-if-not-exists with expiry
    const result = await client.set(lockKey, lockId, {
      NX: true,
      EX: ttlSeconds,
    });
    
    if (result === 'OK') {
      console.log(`[DISTRIBUTED_LOCK] acquired key=${key} lockId=${lockId} ttl=${ttlSeconds}s`);
      return { acquired: true, lockId };
    } else {
      // Lock already held by another process
      const existingLock = await client.get(lockKey);
      const ttlRemaining = await client.ttl(lockKey);
      console.log(`[DISTRIBUTED_LOCK] blocked key=${key} existing_lock=${existingLock?.slice(0,16)} ttl_remaining=${ttlRemaining}s`);
      return { acquired: false, lockId: null };
    }
  } catch (error) {
    console.error(`[DISTRIBUTED_LOCK] error acquiring lock key=${key}:`, error);
    // On error, return degraded: true so caller can decide whether to proceed
    return { acquired: false, lockId: null, degraded: true };
  }
}

/**
 * Release a distributed lock
 * Only releases if the lockId matches (prevents releasing another process's lock)
 * 
 * @param key - The lock key
 * @param lockId - The lockId returned from acquireLock
 * @returns true if released, false otherwise
 */
export async function releaseLock(key: string, lockId: string | null): Promise<boolean> {
  if (!lockId) {
    // No lock was acquired (Redis unavailable or lock blocked) - nothing to release
    return true;
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return true; // No client means no lock to release
    }

    const lockKey = `lock:${key}`;
    
    // Only delete if we own the lock (atomic check-and-delete via Lua)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await client.eval(script, {
      keys: [lockKey],
      arguments: [lockId],
    });
    
    if (result === 1) {
      console.log(`[DISTRIBUTED_LOCK] released key=${key} lockId=${lockId}`);
      return true;
    } else {
      console.warn(`[DISTRIBUTED_LOCK] release_failed key=${key} lockId=${lockId} (lock not owned or expired)`);
      return false;
    }
  } catch (error) {
    console.error(`[DISTRIBUTED_LOCK] error releasing lock key=${key}:`, error);
    return false;
  }
}

/**
 * Execute a function while holding a distributed lock
 * Automatically acquires and releases the lock
 * 
 * @param key - The lock key
 * @param fn - The async function to execute
 * @param ttlSeconds - Lock TTL in seconds (default 30s)
 * @param allowDegraded - If true, execute fn even when Redis unavailable (with degraded flag set)
 * @returns Result with executed status, degraded flag, and function result
 */
export async function withLock<T>(
  key: string, 
  fn: () => Promise<T>, 
  ttlSeconds: number = 30,
  allowDegraded: boolean = false
): Promise<{ executed: boolean; result: T | null; degraded?: boolean }> {
  const lock = await acquireLock(key, ttlSeconds);
  
  if (!lock.acquired) {
    // If degraded (Redis unavailable) and caller allows it, proceed anyway
    if (lock.degraded && allowDegraded) {
      console.warn(`[DISTRIBUTED_LOCK] executing in degraded mode for key=${key}`);
      try {
        const result = await fn();
        return { executed: true, result, degraded: true };
      } catch (error) {
        throw error;
      }
    }
    // Otherwise, blocked by another process or caller doesn't allow degraded
    return { executed: false, result: null, degraded: lock.degraded };
  }
  
  try {
    const result = await fn();
    return { executed: true, result };
  } finally {
    await releaseLock(key, lock.lockId);
  }
}

/**
 * Check if an error is a PostgreSQL unique constraint violation
 * Used to detect when duplicate inserts are blocked by database constraints
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Error) {
    const anyErr = error as any;
    // PostgreSQL error code for unique_violation is 23505
    return anyErr.code === '23505' || anyErr.message?.includes('unique_running_instance_per_bot');
  }
  return false;
}
