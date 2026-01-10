/**
 * Idempotency Key Management
 * 
 * Prevents duplicate operations for critical actions like:
 * - Trade execution
 * - Bot promotions
 * - Backup operations
 * 
 * Uses in-memory store with TTL cleanup for development.
 * Production should use Redis for distributed deployments.
 */

interface IdempotencyEntry {
  key: string;
  result: any;
  status: 'pending' | 'completed' | 'failed';
  createdAt: number;
  expiresAt: number;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();
const DEFAULT_TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS || "3600000", 10); // 1 hour default

/**
 * Generate an idempotency key from operation parameters
 */
export function generateIdempotencyKey(
  operation: string,
  ...params: (string | number | undefined)[]
): string {
  const parts = [operation, ...params.filter(p => p !== undefined)];
  return parts.join(':');
}

/**
 * Check if an operation is already in progress or completed
 */
export function checkIdempotency(key: string): IdempotencyEntry | null {
  cleanupExpiredEntries();
  const entry = idempotencyStore.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry;
  }
  return null;
}

/**
 * Start an idempotent operation
 * Returns true if this is a new operation, false if duplicate
 */
export function startIdempotentOperation(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const existing = checkIdempotency(key);
  if (existing) {
    console.log(`[IDEMPOTENCY] Duplicate operation blocked: ${key} (status=${existing.status})`);
    return false;
  }
  
  const now = Date.now();
  idempotencyStore.set(key, {
    key,
    result: null,
    status: 'pending',
    createdAt: now,
    expiresAt: now + ttlMs,
  });
  
  console.log(`[IDEMPOTENCY] Started operation: ${key}`);
  return true;
}

/**
 * Complete an idempotent operation with result
 */
export function completeIdempotentOperation(key: string, result: any): void {
  const entry = idempotencyStore.get(key);
  if (entry) {
    entry.status = 'completed';
    entry.result = result;
    console.log(`[IDEMPOTENCY] Completed operation: ${key}`);
  }
}

/**
 * Mark an idempotent operation as failed
 */
export function failIdempotentOperation(key: string, error: any): void {
  const entry = idempotencyStore.get(key);
  if (entry) {
    entry.status = 'failed';
    entry.result = { error: error?.message || 'Unknown error' };
    // Reduce TTL for failed operations to allow retry sooner
    entry.expiresAt = Date.now() + 60000; // 1 minute for failed ops
    console.log(`[IDEMPOTENCY] Failed operation: ${key}`);
  }
}

/**
 * Execute an operation with idempotency protection
 */
export async function withIdempotency<T>(
  key: string,
  operation: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ isNew: boolean; result: T | null; cached?: boolean }> {
  const existing = checkIdempotency(key);
  
  if (existing) {
    if (existing.status === 'completed') {
      return { isNew: false, result: existing.result, cached: true };
    }
    if (existing.status === 'pending') {
      return { isNew: false, result: null, cached: false };
    }
    // Failed - allow retry by continuing
  }
  
  if (!startIdempotentOperation(key, ttlMs)) {
    return { isNew: false, result: null };
  }
  
  try {
    const result = await operation();
    completeIdempotentOperation(key, result);
    return { isNew: true, result };
  } catch (error) {
    failIdempotentOperation(key, error);
    throw error;
  }
}

/**
 * Cleanup expired entries periodically
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of idempotencyStore.entries()) {
    if (now >= entry.expiresAt) {
      idempotencyStore.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[IDEMPOTENCY] Cleaned ${cleaned} expired entries`);
  }
}

/**
 * Get stats about idempotency store
 */
export function getIdempotencyStats(): {
  totalEntries: number;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
} {
  cleanupExpiredEntries();
  
  let pendingCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  
  for (const entry of idempotencyStore.values()) {
    switch (entry.status) {
      case 'pending': pendingCount++; break;
      case 'completed': completedCount++; break;
      case 'failed': failedCount++; break;
    }
  }
  
  return {
    totalEntries: idempotencyStore.size,
    pendingCount,
    completedCount,
    failedCount,
  };
}

// Periodic cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 300000);
