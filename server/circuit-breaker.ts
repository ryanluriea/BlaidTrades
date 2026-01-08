/**
 * Circuit Breaker Pattern for External API Resilience
 * 
 * Prevents cascade failures by:
 * 1. Tracking consecutive failures
 * 2. Opening circuit after threshold exceeded
 * 3. Allowing test requests after cool-down period
 * 4. Auto-recovering when service returns to health
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service unhealthy, requests fail fast
 * - HALF_OPEN: Testing if service recovered
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitConfig {
  name: string;
  failureThreshold: number;      // Failures before opening circuit
  successThreshold: number;      // Successes to close circuit
  cooldownMs: number;            // Time in OPEN state before testing
  timeoutMs: number;             // Request timeout
}

interface CircuitStats {
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  state: CircuitState;
  lastFailureTime: number;
  lastSuccessTime: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
}

const circuits = new Map<string, CircuitStats>();

const DEFAULT_CONFIG: Omit<CircuitConfig, "name"> = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 30_000,  // 30 seconds
  timeoutMs: 30_000,   // 30 seconds
};

function getStats(name: string): CircuitStats {
  if (!circuits.has(name)) {
    circuits.set(name, {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      state: "CLOSED",
      lastFailureTime: 0,
      lastSuccessTime: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    });
  }
  return circuits.get(name)!;
}

function updateState(name: string, config: CircuitConfig): CircuitState {
  const stats = getStats(name);
  const now = Date.now();
  
  if (stats.state === "OPEN") {
    // Check if cool-down period has passed
    if (now - stats.lastFailureTime >= config.cooldownMs) {
      stats.state = "HALF_OPEN";
      console.log(`[CIRCUIT_BREAKER] ${name} -> HALF_OPEN (testing recovery)`);
    }
  }
  
  return stats.state;
}

function recordSuccess(name: string, config: CircuitConfig): void {
  const stats = getStats(name);
  stats.consecutiveSuccesses++;
  stats.consecutiveFailures = 0;
  stats.lastSuccessTime = Date.now();
  stats.totalSuccesses++;
  
  if (stats.state === "HALF_OPEN" && stats.consecutiveSuccesses >= config.successThreshold) {
    stats.state = "CLOSED";
    console.log(`[CIRCUIT_BREAKER] ${name} -> CLOSED (recovered)`);
  }
}

function recordFailure(name: string, config: CircuitConfig, error: string): void {
  const stats = getStats(name);
  stats.consecutiveFailures++;
  stats.consecutiveSuccesses = 0;
  stats.lastFailureTime = Date.now();
  stats.totalFailures++;
  stats.lastError = error;
  
  if (stats.state === "CLOSED" && stats.consecutiveFailures >= config.failureThreshold) {
    stats.state = "OPEN";
    console.error(`[CIRCUIT_BREAKER] ${name} -> OPEN (threshold exceeded: ${stats.consecutiveFailures} failures)`);
  } else if (stats.state === "HALF_OPEN") {
    // Failed during recovery test, back to OPEN
    stats.state = "OPEN";
    console.error(`[CIRCUIT_BREAKER] ${name} -> OPEN (recovery test failed)`);
  }
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>,
  customConfig?: Partial<Omit<CircuitConfig, "name">>
): Promise<T> {
  const config: CircuitConfig = { name, ...DEFAULT_CONFIG, ...customConfig };
  const state = updateState(name, config);
  
  if (state === "OPEN") {
    console.warn(`[CIRCUIT_BREAKER] ${name} is OPEN, failing fast`);
    if (fallback) {
      return await fallback();
    }
    throw new Error(`Circuit breaker ${name} is OPEN - service unavailable`);
  }
  
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Timeout after ${config.timeoutMs}ms`)), config.timeoutMs);
    });
    
    const result = await Promise.race([fn(), timeoutPromise]);
    recordSuccess(name, config);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    recordFailure(name, config, errorMessage);
    
    if (fallback) {
      console.warn(`[CIRCUIT_BREAKER] ${name} failed, using fallback: ${errorMessage}`);
      return await fallback();
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Retry with exponential backoff
 */
export async function withRetry<T>(
  name: string,
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    onRetry,
  } = options;
  
  let lastError: Error | null = null;
  let delay = initialDelayMs;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt > maxRetries) {
        console.error(`[RETRY] ${name} failed after ${maxRetries + 1} attempts: ${lastError.message}`);
        throw lastError;
      }
      
      console.warn(`[RETRY] ${name} attempt ${attempt}/${maxRetries + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }
  
  throw lastError;
}

/**
 * Combine circuit breaker with retry logic
 */
export async function withResiliency<T>(
  name: string,
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    fallback?: () => T | Promise<T>;
    circuitConfig?: Partial<Omit<CircuitConfig, "name">>;
  } = {}
): Promise<T> {
  const { maxRetries = 3, fallback, circuitConfig } = options;
  
  return withCircuitBreaker(
    name,
    () => withRetry(name, fn, { maxRetries }),
    fallback,
    circuitConfig
  );
}

/**
 * Get all circuit breaker stats for monitoring
 */
export function getAllCircuitStats(): Record<string, CircuitStats & { name: string }> {
  const result: Record<string, CircuitStats & { name: string }> = {};
  circuits.forEach((stats, name) => {
    result[name] = { ...stats, name };
  });
  return result;
}

/**
 * Reset a specific circuit (for testing/recovery)
 */
export function resetCircuit(name: string): void {
  circuits.delete(name);
  console.log(`[CIRCUIT_BREAKER] ${name} reset to CLOSED`);
}

/**
 * Reset all circuits (for testing/recovery)
 */
export function resetAllCircuits(): void {
  circuits.clear();
  console.log(`[CIRCUIT_BREAKER] All circuits reset to CLOSED`);
}
