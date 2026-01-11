/**
 * Database Resilience Layer
 * 
 * Industry-standard patterns for database reliability:
 * - Exponential backoff with jitter for transient failures
 * - Circuit breaker for cascading failure prevention
 * - Query timeout management
 * - Connection health monitoring
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  jitterFactor: 0.3
};

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  consecutiveSuccesses: number;
}

const circuitBreaker: CircuitBreakerState = {
  isOpen: false,
  failureCount: 0,
  lastFailureTime: 0,
  consecutiveSuccesses: 0
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30000;
const CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES = 3;

function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, cappedDelay + jitter);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    const retryablePatterns = [
      "connection refused",
      "connection reset",
      "timeout",
      "deadlock",
      "too many connections",
      "connection terminated",
      "econnreset",
      "etimedout",
      "econnrefused",
      "statement_timeout",
      "idle_in_transaction_session_timeout"
    ];
    
    return retryablePatterns.some(pattern => message.includes(pattern));
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkCircuitBreaker(): { allowed: boolean; reason?: string } {
  if (!circuitBreaker.isOpen) {
    return { allowed: true };
  }
  
  const timeSinceFailure = Date.now() - circuitBreaker.lastFailureTime;
  
  if (timeSinceFailure > CIRCUIT_BREAKER_RESET_MS) {
    console.log("[DB_CIRCUIT_BREAKER] Half-open: allowing test request");
    return { allowed: true };
  }
  
  return {
    allowed: false,
    reason: `Circuit breaker open, retry in ${Math.ceil((CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000)}s`
  };
}

function recordSuccess(): void {
  if (circuitBreaker.isOpen) {
    circuitBreaker.consecutiveSuccesses++;
    
    if (circuitBreaker.consecutiveSuccesses >= CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES) {
      console.log("[DB_CIRCUIT_BREAKER] Closed after successful recovery");
      circuitBreaker.isOpen = false;
      circuitBreaker.failureCount = 0;
      circuitBreaker.consecutiveSuccesses = 0;
    }
  } else {
    circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
  }
}

function recordFailure(): void {
  circuitBreaker.failureCount++;
  circuitBreaker.lastFailureTime = Date.now();
  circuitBreaker.consecutiveSuccesses = 0;
  
  if (circuitBreaker.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    console.warn(`[DB_CIRCUIT_BREAKER] OPENED after ${circuitBreaker.failureCount} failures`);
    circuitBreaker.isOpen = true;
  }
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: unknown;
  
  const cbCheck = checkCircuitBreaker();
  if (!cbCheck.allowed) {
    throw new Error(`[DB_RESILIENCE] ${operationName} blocked: ${cbCheck.reason}`);
  }
  
  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const result = await operation();
      recordSuccess();
      return result;
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error)) {
        throw error;
      }
      
      if (attempt < finalConfig.maxRetries) {
        const delay = calculateBackoff(attempt, finalConfig);
        console.warn(
          `[DB_RESILIENCE] ${operationName} failed (attempt ${attempt + 1}/${finalConfig.maxRetries + 1}), ` +
          `retrying in ${Math.round(delay)}ms: ${error instanceof Error ? error.message : String(error)}`
        );
        await sleep(delay);
      } else {
        recordFailure();
        console.error(
          `[DB_RESILIENCE] ${operationName} exhausted all retries after ${finalConfig.maxRetries + 1} attempts`
        );
      }
    }
  }
  
  throw lastError;
}

export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`[DB_RESILIENCE] ${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  circuitBreakerOpen: boolean;
  error?: string;
}> {
  const start = Date.now();
  
  try {
    await withTimeout(
      async () => db.execute(sql`SELECT 1`),
      5000,
      "health_check"
    );
    
    return {
      healthy: true,
      latencyMs: Date.now() - start,
      circuitBreakerOpen: circuitBreaker.isOpen
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      circuitBreakerOpen: circuitBreaker.isOpen,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function getCircuitBreakerState(): CircuitBreakerState {
  return { ...circuitBreaker };
}

export function resetCircuitBreaker(): void {
  circuitBreaker.isOpen = false;
  circuitBreaker.failureCount = 0;
  circuitBreaker.consecutiveSuccesses = 0;
  console.log("[DB_CIRCUIT_BREAKER] Manually reset");
}

export function _testIsRetryableError(error: unknown): boolean {
  return isRetryableError(error);
}

export function _testRecordFailure(): void {
  recordFailure();
}

export function _testRecordSuccess(): void {
  recordSuccess();
}

export const CIRCUIT_BREAKER_CONFIG = {
  THRESHOLD: CIRCUIT_BREAKER_THRESHOLD,
  RESET_MS: CIRCUIT_BREAKER_RESET_MS,
  HALF_OPEN_SUCCESSES: CIRCUIT_BREAKER_HALF_OPEN_SUCCESSES,
};
